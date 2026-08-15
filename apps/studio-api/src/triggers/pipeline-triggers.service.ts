import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import {
  cronMatches,
  renderTriggerTemplate,
  type Pipeline,
  type PipelineForgeWebhookTrigger,
  type PipelineTrigger,
  type WorkOrder,
} from "@agent-studio/agent-schema";
import { PipelinesService } from "../pipelines/pipelines.service";
import { StudioConfigService } from "../studio-config/studio-config.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";

export type NormalizedForgeEvent = {
  forge: "gitlab" | "github";
  event: "mr_merged" | "issue_labeled";
  title: string;
  body: string;
  labels: string[];
  url: string;
  project_path: string;
};

@Injectable()
export class PipelineTriggersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineTriggersService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly pipelines: PipelinesService,
    private readonly orders: WorkOrdersService,
    private readonly studioConfig: StudioConfigService,
  ) {}

  onModuleInit() {
    const role = (process.env.STUDIO_PROCESS_ROLE || "api").trim().toLowerCase();
    if (role === "worker") {
      this.logger.log("pipeline cron triggers skipped on studio-worker");
      return;
    }
    const enabled = (process.env.STUDIO_TRIGGERS_CRON || "true").trim() !== "false";
    if (!enabled) {
      this.logger.log("pipeline cron triggers disabled (STUDIO_TRIGGERS_CRON=false)");
      return;
    }
    // Align near minute boundaries; tick every 30s and de-dupe via last_fired_at.
    this.timer = setInterval(() => {
      void this.tickCron();
    }, 30_000);
    this.logger.log("pipeline cron triggers armed (every 30s)");
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tickCron(now = new Date()): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let fired = 0;
    try {
      const pipelines = await this.pipelines.listWithTriggers();
      for (const pipeline of pipelines) {
        for (const trigger of pipeline.triggers || []) {
          if (!trigger.enabled || trigger.kind !== "cron") continue;
          if (!cronMatches(trigger.cron, now)) continue;
          const minuteKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
          const last = (trigger.last_fired_at || "").slice(0, 16);
          if (last && last === minuteKey) continue;
          try {
            await this.fireCron(pipeline, trigger, now);
            await this.pipelines.patchTriggerLastFired(
              pipeline.id,
              trigger.id,
              now.toISOString(),
            );
            fired += 1;
          } catch (err) {
            this.logger.error(
              `cron trigger ${pipeline.id}/${trigger.id} failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    } finally {
      this.ticking = false;
    }
    return fired;
  }

  private async fireCron(
    pipeline: Pipeline,
    trigger: Extract<PipelineTrigger, { kind: "cron" }>,
    now: Date,
  ): Promise<WorkOrder> {
    const vars = {
      pipeline: pipeline.name,
      pipeline_id: pipeline.id,
      trigger: trigger.id,
      time: now.toISOString(),
    };
    const title =
      renderTriggerTemplate(
        trigger.title_template || "定时 · {{pipeline}} · {{time}}",
        vars,
      ) || `定时工单 ${pipeline.name}`;
    const requirement =
      renderTriggerTemplate(
        trigger.requirement_template ||
          "由 cron 触发器 {{trigger}} 自动创建（{{time}}）。",
        vars,
      ) || "定时触发";
    return this.orders.createAndStartFromTrigger({
      pipeline_id: pipeline.id,
      title,
      requirement,
      project_id: trigger.project_id,
      auto_approve: trigger.auto_approve,
      trigger_id: trigger.id,
      source: "cron",
    });
  }

  async handleForgeWebhook(opts: {
    pipelineId: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer | string;
    body: unknown;
  }): Promise<
    | {
        ok: true;
        action: "create_and_start";
        work_order_id: string;
        trigger_id: string;
      }
    | {
        ok: true;
        action: "advance";
        trigger_id: string;
        work_order_ids: string[];
        advanced: number;
      }
    | { ok: true; skipped: string }
  > {
    const pipeline = await this.pipelines.get(opts.pipelineId);
    if (!pipeline.enabled) {
      throw new BadRequestException(`流水线已停用: ${pipeline.id}`);
    }
    const triggers = (pipeline.triggers || []).filter(
      (t): t is PipelineForgeWebhookTrigger =>
        t.enabled && t.kind === "forge_webhook",
    );
    if (!triggers.length) {
      throw new BadRequestException("该流水线未配置 forge_webhook 触发器");
    }

    const normalized = normalizeForgePayload(opts.headers, opts.body);
    if (!normalized) {
      return { ok: true, skipped: "unrecognized_event" };
    }

    const matched = triggers.find((t) =>
      this.forgeTriggerMatches(pipeline, t, normalized, opts.headers, opts.rawBody),
    );
    if (!matched) {
      return { ok: true, skipped: "no_matching_trigger" };
    }

    if (matched.action === "advance") {
      const advanced = await this.orders.advanceWaitingFromEvent({
        pipeline_id: pipeline.id,
        event: normalized.event,
        labels: normalized.labels,
        feedback: `forge:${normalized.forge}:${normalized.event}`,
      });
      return {
        ok: true,
        action: "advance",
        trigger_id: matched.id,
        work_order_ids: advanced.map((o) => o.id),
        advanced: advanced.length,
      };
    }

    const vars = {
      pipeline: pipeline.name,
      pipeline_id: pipeline.id,
      trigger: matched.id,
      title: normalized.title,
      url: normalized.url,
      forge: normalized.forge,
      event: normalized.event,
    };
    const title =
      renderTriggerTemplate(
        matched.title_template || "{{event}} · {{title}}",
        vars,
      ) || normalized.title;
    const requirement =
      renderTriggerTemplate(
        matched.requirement_template ||
          "Forge 事件 {{event}}（{{forge}}）\n{{url}}\n\n{{title}}\n\n{{body}}",
        { ...vars, body: normalized.body },
      ) || normalized.body || normalized.title;

    const order = await this.orders.createAndStartFromTrigger({
      pipeline_id: pipeline.id,
      title,
      requirement,
      project_id: matched.project_id || "",
      auto_approve: matched.auto_approve,
      trigger_id: matched.id,
      source: `forge:${normalized.forge}:${normalized.event}`,
      tags: normalized.labels.slice(0, 8),
    });
    return {
      ok: true,
      action: "create_and_start",
      work_order_id: order.id,
      trigger_id: matched.id,
    };
  }

  private forgeTriggerMatches(
    pipeline: Pipeline,
    trigger: PipelineForgeWebhookTrigger,
    event: NormalizedForgeEvent,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
  ): boolean {
    if (trigger.forge !== "any" && trigger.forge !== event.forge) return false;
    if (!trigger.events.includes(event.event)) return false;
    if (event.event === "issue_labeled" && (trigger.labels || []).length) {
      const want = new Set(trigger.labels.map((l) => l.toLowerCase()));
      if (!event.labels.some((l) => want.has(l.toLowerCase()))) return false;
    }
    this.assertWebhookAuth(pipeline, trigger, headers, rawBody, event.forge);
    return true;
  }

  private assertWebhookAuth(
    pipeline: Pipeline,
    trigger: PipelineForgeWebhookTrigger,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
    forge: "gitlab" | "github",
  ) {
    const teamSecret =
      this.studioConfig.getTeamSecrets(pipeline.team_id || "").forge_webhook_secret ||
      "";
    const expected =
      (trigger.secret || "").trim() ||
      teamSecret.trim() ||
      (process.env.STUDIO_FORGE_WEBHOOK_SECRET || "").trim();
    if (!expected) {
      throw new UnauthorizedException(
        "未配置 webhook secret（触发器 secret / 团队 forge_webhook_secret / STUDIO_FORGE_WEBHOOK_SECRET）",
      );
    }

    const headerToken = headerValue(headers, "x-studio-webhook-token");
    const gitlabToken = headerValue(headers, "x-gitlab-token");
    const githubSig = headerValue(headers, "x-hub-signature-256");

    if (forge === "github" && githubSig) {
      const raw =
        typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
      const digest = createHmac("sha256", expected).update(raw).digest("hex");
      const expectedHeader = `sha256=${digest}`;
      if (!safeEqual(expectedHeader, githubSig)) {
        throw new UnauthorizedException("invalid GitHub signature");
      }
      return;
    }

    const provided = headerToken || gitlabToken;
    if (!provided || !safeEqual(expected, provided)) {
      throw new UnauthorizedException("invalid webhook token");
    }
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return String(raw || "").trim();
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function normalizeForgePayload(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): NormalizedForgeEvent | null {
  const gitlabEvent = headerValue(headers, "x-gitlab-event");
  const githubEvent = headerValue(headers, "x-github-event");
  const data = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;

  if (gitlabEvent || data.object_kind) {
    const kind = String(data.object_kind || "").toLowerCase();
    const attrs = (data.object_attributes || {}) as Record<string, unknown>;
    const project = (data.project || {}) as Record<string, unknown>;
    const projectPath = String(
      project.path_with_namespace || project.path || "",
    );
    if (
      (kind === "merge_request" || /merge request/i.test(gitlabEvent)) &&
      String(attrs.action || "") === "merge"
    ) {
      return {
        forge: "gitlab",
        event: "mr_merged",
        title: String(attrs.title || data.title || "MR merged"),
        body: String(attrs.description || ""),
        labels: [],
        url: String(attrs.url || attrs.web_url || ""),
        project_path: projectPath,
      };
    }
    if (kind === "issue" || /issue/i.test(gitlabEvent)) {
      const labels = Array.isArray(data.labels)
        ? data.labels.map((l) =>
            typeof l === "object" && l && "title" in l
              ? String((l as { title: string }).title)
              : String(l),
          )
        : [];
      const action = String(attrs.action || "");
      if (action === "update" || action === "open" || labels.length) {
        // Prefer label events; GitLab may send label changes as issue update.
        if (!labels.length && action !== "open") return null;
        return {
          forge: "gitlab",
          event: "issue_labeled",
          title: String(attrs.title || "Issue"),
          body: String(attrs.description || ""),
          labels,
          url: String(attrs.url || attrs.web_url || ""),
          project_path: projectPath,
        };
      }
    }
    return null;
  }

  if (githubEvent) {
    const action = String(data.action || "");
    const repo = (data.repository || {}) as Record<string, unknown>;
    const projectPath = String(repo.full_name || "");
    if (githubEvent === "pull_request") {
      const pr = (data.pull_request || {}) as Record<string, unknown>;
      if (action === "closed" && pr.merged === true) {
        return {
          forge: "github",
          event: "mr_merged",
          title: String(pr.title || "PR merged"),
          body: String(pr.body || ""),
          labels: [],
          url: String(pr.html_url || ""),
          project_path: projectPath,
        };
      }
    }
    if (githubEvent === "issues" && action === "labeled") {
      const issue = (data.issue || {}) as Record<string, unknown>;
      const label = (data.label || {}) as Record<string, unknown>;
      const labels = [
        String(label.name || ""),
        ...((Array.isArray(issue.labels)
          ? issue.labels.map((l) =>
              typeof l === "object" && l && "name" in l
                ? String((l as { name: string }).name)
                : String(l),
            )
          : []) as string[]),
      ].filter(Boolean);
      return {
        forge: "github",
        event: "issue_labeled",
        title: String(issue.title || "Issue"),
        body: String(issue.body || ""),
        labels,
        url: String(issue.html_url || ""),
        project_path: projectPath,
      };
    }
  }

  return null;
}
