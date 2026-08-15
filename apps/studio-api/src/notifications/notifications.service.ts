import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { In, IsNull, Repository } from "typeorm";
import type {
  NotifyEvent,
  SystemNotification,
  SystemNotificationKind,
  SystemNotificationList,
  WorkOrder,
} from "@agent-studio/agent-schema";
import { RealtimeHub } from "../realtime/realtime.hub";
import { StudioConfigService } from "../studio-config/studio-config.service";
import { NotificationEntity } from "./entities/notification.entity";

export type NotifyPayload = {
  event: NotifyEvent;
  title: string;
  text: string;
  work_order_id?: string;
  work_order_title?: string;
  status?: string;
  link?: string;
};

export function workOrderEventTitle(
  event: Exclude<NotifyEvent, "comment_mention">,
): string {
  if (event === "pending_approval") return "等待人工确认";
  if (event === "failed") return "工单失败";
  return "工单完成";
}

export function buildWorkOrderEventText(input: {
  event: Exclude<NotifyEvent, "comment_mention">;
  title: string;
  status: string;
  detail?: string;
  link: string;
}): string {
  const heading = workOrderEventTitle(input.event);
  return [
    `【${heading}】${input.title}`,
    `状态：${input.status}`,
    input.detail ? `详情：${input.detail}` : "",
    `链接：${input.link}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCommentMentionText(input: {
  work_order_title: string;
  author_name: string;
  body: string;
  mentioned_names: string[];
  link: string;
}): string {
  return [
    `【评论提及】${input.work_order_title}`,
    `${input.author_name} 提及了 ${input.mentioned_names.join("、")}`,
    input.body.slice(0, 500),
    `链接：${input.link}`,
  ].join("\n");
}

function toPublic(row: NotificationEntity): SystemNotification {
  return {
    id: row.id,
    team_id: row.team_id,
    user_id: row.user_id,
    kind: row.kind as SystemNotificationKind,
    title: row.title,
    body: row.body || "",
    work_order_id: row.work_order_id || "",
    actor_user_id: row.actor_user_id || "",
    actor_name: row.actor_name || "",
    read_at: row.read_at ?? null,
    created_at: row.created_at,
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly config: StudioConfigService,
    private readonly hub: RealtimeHub,
    @InjectRepository(NotificationEntity)
    private readonly inbox: Repository<NotificationEntity>,
  ) {}

  webOrigin(): string {
    return (
      process.env.STUDIO_WEB_ORIGIN?.trim() ||
      process.env.STUDIO_PUBLIC_URL?.trim() ||
      "http://127.0.0.1:5173"
    );
  }

  workOrderLink(orderId: string): string {
    const base = this.webOrigin().replace(/\/$/, "");
    return `${base}/work-orders?wo=${encodeURIComponent(orderId)}`;
  }

  /** Best-effort notify for a work-order status change. Never throws. */
  scheduleWorkOrderEvent(
    order: WorkOrder,
    event: Exclude<NotifyEvent, "comment_mention">,
    detail?: string,
  ) {
    const title = workOrderEventTitle(event);
    const text = buildWorkOrderEventText({
      event,
      title: order.title || order.id,
      status: order.status,
      detail,
      link: this.workOrderLink(order.id),
    });
    void this.notifyTeam(order.team_id || "", {
      event,
      title,
      text,
      work_order_id: order.id,
      work_order_title: order.title,
      status: order.status,
      link: this.workOrderLink(order.id),
    });
  }

  scheduleCommentMention(input: {
    team_id: string;
    work_order_id: string;
    work_order_title: string;
    author_name: string;
    body: string;
    mentioned_names: string[];
  }) {
    const text = buildCommentMentionText({
      work_order_title: input.work_order_title || input.work_order_id,
      author_name: input.author_name,
      body: input.body,
      mentioned_names: input.mentioned_names,
      link: this.workOrderLink(input.work_order_id),
    });
    void this.notifyTeam(input.team_id, {
      event: "comment_mention",
      title: "评论提及",
      text,
      work_order_id: input.work_order_id,
      work_order_title: input.work_order_title,
      link: this.workOrderLink(input.work_order_id),
    });
  }

  /**
   * Persist in-app notifications for team members (isolated by team_id).
   * Skips empty recipients; never throws to callers.
   */
  async createInboxMany(input: {
    team_id: string;
    user_ids: string[];
    kind: SystemNotificationKind;
    title: string;
    body: string;
    work_order_id?: string;
    actor_user_id?: string;
    actor_name?: string;
  }): Promise<SystemNotification[]> {
    const teamId = (input.team_id || "").trim();
    const ids = [
      ...new Set(
        input.user_ids.map((id) => id.trim()).filter(Boolean),
      ),
    ];
    if (!teamId || !ids.length) return [];

    const now = new Date().toISOString();
    const rows = ids.map((userId) =>
      this.inbox.create({
        id: randomUUID(),
        team_id: teamId,
        user_id: userId,
        kind: input.kind,
        title: (input.title || "").slice(0, 256),
        body: input.body || "",
        work_order_id: (input.work_order_id || "").trim(),
        actor_user_id: (input.actor_user_id || "").trim(),
        actor_name: (input.actor_name || "").trim(),
        read_at: null,
        created_at: now,
      }),
    );

    try {
      const saved = await this.inbox.save(rows);
      const pubs = saved.map(toPublic);
      for (const n of pubs) {
        this.hub.publishNotification(n);
      }
      return pubs;
    } catch (err) {
      this.logger.warn(
        `createInboxMany: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  async listForUser(
    userId: string,
    teamId: string,
    opts?: { unread_only?: boolean; limit?: number },
  ): Promise<SystemNotificationList> {
    const tid = teamId.trim();
    const uid = userId.trim();
    const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100);
    const where: {
      team_id: string;
      user_id: string;
      read_at?: ReturnType<typeof IsNull>;
    } = { team_id: tid, user_id: uid };
    if (opts?.unread_only) where.read_at = IsNull();

    const [rows, unread_count] = await Promise.all([
      this.inbox.find({
        where,
        order: { created_at: "DESC" },
        take: limit,
      }),
      this.inbox.count({
        where: { team_id: tid, user_id: uid, read_at: IsNull() },
      }),
    ]);

    return {
      items: rows.map(toPublic),
      unread_count,
    };
  }

  async markRead(
    userId: string,
    teamId: string,
    ids: string[],
  ): Promise<SystemNotificationList> {
    const tid = teamId.trim();
    const uid = userId.trim();
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (unique.length) {
      const now = new Date().toISOString();
      await this.inbox.update(
        {
          id: In(unique),
          team_id: tid,
          user_id: uid,
          read_at: IsNull(),
        },
        { read_at: now },
      );
    }
    return this.listForUser(uid, tid);
  }

  async markAllRead(
    userId: string,
    teamId: string,
  ): Promise<SystemNotificationList> {
    const tid = teamId.trim();
    const uid = userId.trim();
    const now = new Date().toISOString();
    await this.inbox.update(
      { team_id: tid, user_id: uid, read_at: IsNull() },
      { read_at: now },
    );
    return this.listForUser(uid, tid);
  }

  async notifyTeam(teamId: string, payload: NotifyPayload): Promise<void> {
    const tid = (teamId || "").trim();
    if (!tid) return;
    try {
      const secrets = this.config.getTeamSecrets(tid);
      const notifyOn = secrets.notify_on?.length
        ? secrets.notify_on
        : (["pending_approval", "failed", "completed"] as NotifyEvent[]);
      if (!notifyOn.includes(payload.event)) return;

      const slack = (secrets.slack_webhook_url || "").trim();
      const feishu = (secrets.feishu_webhook_url || "").trim();
      if (!slack && !feishu) return;

      const tasks: Promise<void>[] = [];
      if (slack) tasks.push(this.postSlack(slack, payload));
      if (feishu) tasks.push(this.postFeishu(feishu, payload));
      await Promise.allSettled(tasks);
    } catch (err) {
      this.logger.warn(
        `notifyTeam ${tid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async postSlack(url: string, payload: NotifyPayload) {
    await this.postJson(url, { text: payload.text });
  }

  private async postFeishu(url: string, payload: NotifyPayload) {
    await this.postJson(url, {
      msg_type: "text",
      content: { text: payload.text },
    });
  }

  private async postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }
}
