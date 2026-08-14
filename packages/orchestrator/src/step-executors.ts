import type {
  PipelineCiStep,
  PipelineHttpStep,
} from "@agent-studio/agent-schema";
import type { OrchestratorStep, StageResult } from "./types";

export type StepExecContext = {
  bridge_run_id: string;
  raw_requirement: string;
  title?: string;
  work_order_id?: string;
  run_id?: string;
  feedback?: string;
};

function renderTemplate(template: string, ctx: StepExecContext): string {
  const vars: Record<string, string> = {
    requirement: ctx.raw_requirement || "",
    title: ctx.title || "",
    work_order_id: ctx.work_order_id || "",
    run_id: ctx.run_id || "",
    bridge_run_id: ctx.bridge_run_id || "",
    feedback: ctx.feedback || "",
  };
  return (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

function stageResult(
  runId: string,
  stage: string,
  opts: {
    status: "ok" | "error";
    summary: string;
    artifacts?: string[];
  },
): StageResult {
  return {
    runId,
    stage,
    status: opts.status,
    summary: opts.summary,
    artifacts: opts.artifacts || [],
    pendingHumanApproval: false,
  };
}

async function fetchHttp(
  cfg: PipelineHttpStep,
  ctx: StepExecContext,
  stage: string,
): Promise<StageResult> {
  const method = (cfg.method || "POST").toUpperCase();
  const url = renderTemplate(cfg.url, ctx);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(cfg.headers || {}),
  };
  for (const [k, v] of Object.entries(headers)) {
    headers[k] = renderTemplate(v, ctx);
  }
  const bodyText = renderTemplate(cfg.body || "", ctx);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    cfg.timeout_ms || 30_000,
  );
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "DELETE" ? undefined : bodyText || undefined,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    const okStatuses = cfg.success_statuses?.length
      ? cfg.success_statuses
      : [200, 201, 202, 204];
    if (!okStatuses.includes(res.status)) {
      return stageResult(ctx.bridge_run_id, stage, {
        status: "error",
        summary: `HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`,
      });
    }
    return stageResult(ctx.bridge_run_id, stage, {
      status: "ok",
      summary: text.slice(0, 2000) || `HTTP ${res.status} ok`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return stageResult(ctx.bridge_run_id, stage, {
      status: "error",
      summary: `HTTP 请求失败: ${msg}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runCi(
  cfg: PipelineCiStep,
  ctx: StepExecContext,
): Promise<StageResult> {
  const trigger = await fetchHttp(
    {
      url: cfg.trigger_url,
      method: cfg.method || "POST",
      headers: cfg.headers || {},
      body: cfg.body || "",
      success_statuses: cfg.success_statuses || [200, 201, 202, 204],
      timeout_ms: cfg.timeout_ms || 30_000,
    },
    ctx,
    "ci",
  );
  if (trigger.status === "error") return trigger;

  const pollUrl = (cfg.poll_url || "").trim();
  if (!pollUrl) {
    return stageResult(ctx.bridge_run_id, "ci", {
      status: "ok",
      summary: trigger.summary || "CI 已触发",
    });
  }

  const deadline = Date.now() + (cfg.poll_timeout_ms || 600_000);
  const successNeedle = (cfg.success_includes || "success").toLowerCase();
  const failureNeedle = (cfg.failure_includes || "failure").toLowerCase();
  while (Date.now() < deadline) {
    await sleep(cfg.poll_interval_ms || 5_000);
    const poll = await fetchHttp(
      {
        url: pollUrl,
        method: "GET",
        headers: cfg.headers || {},
        body: "",
        success_statuses: [200, 201, 202, 204],
        timeout_ms: cfg.timeout_ms || 30_000,
      },
      ctx,
      "ci_poll",
    );
    const body = (poll.summary || "").toLowerCase();
    if (failureNeedle && body.includes(failureNeedle)) {
      return stageResult(ctx.bridge_run_id, "ci", {
        status: "error",
        summary: `CI 失败: ${poll.summary.slice(0, 500)}`,
      });
    }
    if (successNeedle && body.includes(successNeedle)) {
      return stageResult(ctx.bridge_run_id, "ci", {
        status: "ok",
        summary: poll.summary.slice(0, 2000) || "CI 成功",
      });
    }
  }
  return stageResult(ctx.bridge_run_id, "ci", {
    status: "error",
    summary: `CI 轮询超时（${cfg.poll_timeout_ms || 600_000}ms）`,
  });
}

/**
 * Execute a non-agent step. Returns null when the caller should use Bridge agent stage.
 */
export async function executeNonAgentStep(
  step: OrchestratorStep,
  ctx: StepExecContext,
): Promise<StageResult | { kind: "waiting_event"; summary: string; event: string } | null> {
  const kind = step.kind || "agent";
  if (kind === "agent") return null;

  if (kind === "wait_event") {
    const event = step.wait_event?.event || "manual";
    return {
      kind: "waiting_event",
      event,
      summary: step.wait_event?.labels?.length
        ? `等待事件：${event}（labels=${step.wait_event.labels.join(",")}）`
        : `等待事件：${event}`,
    };
  }

  if (kind === "http") {
    if (!step.http?.url) {
      return stageResult(ctx.bridge_run_id, "http", {
        status: "error",
        summary: "http 步骤缺少 url",
      });
    }
    return fetchHttp(step.http, ctx, "http");
  }

  if (kind === "ci") {
    if (!step.ci?.trigger_url) {
      return stageResult(ctx.bridge_run_id, "ci", {
        status: "error",
        summary: "ci 步骤缺少 trigger_url",
      });
    }
    return runCi(step.ci, ctx);
  }

  if (kind === "gateway") {
    return stageResult(ctx.bridge_run_id, "gateway", {
      status: "ok",
      summary: "控制节点已通过",
    });
  }

  if (kind === "delay") {
    const seconds = Math.max(1, Math.min(86_400, step.delay?.seconds || 60));
    await new Promise((r) => setTimeout(r, seconds * 1000));
    return stageResult(ctx.bridge_run_id, "delay", {
      status: "ok",
      summary: `延时 ${seconds}s 完成`,
    });
  }

  return stageResult(ctx.bridge_run_id, kind, {
    status: "error",
    summary: `未知步骤类型: ${kind}`,
  });
}
