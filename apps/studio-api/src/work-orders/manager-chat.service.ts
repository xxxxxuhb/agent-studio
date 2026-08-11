import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  ManagerChatPostSchema,
  ManagerChatThreadSchema,
  type ManagerChatMessage,
  type ManagerChatThread,
  type WorkOrder,
} from "@agent-studio/agent-schema";
import { WorkOrdersService } from "./work-orders.service";
import { PipelinesService } from "../pipelines/pipelines.service";

const HELP = `我是总管 Agent（Manager）。可以帮你：

- 查状态：现在怎样了 / 卡在哪 / /status
- 澄清需求：澄清：xxx / 需求补充：xxx
- 通过当前步骤：通过 / 批准 / /approve [反馈]（Dify Human Input）
- 驳回结束：驳回结束 / /reject [反馈]
- 启动流水线：启动 standard-delivery / /start full-delivery-with-review（走 Dify Workflow）
- 重新执行：重新执行 / /restart（结束旧 run 后按上次流水线再启）
- 同步 Dify：同步 dify / /sync-dify

说明：我管流程与合规；可在 Studio 确认 Human Input（需 Web App 投递以获得 form_token）。`;

@Injectable()
export class ManagerChatService implements OnModuleInit {
  private dataDir = "";

  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly pipelines: PipelinesService,
  ) {}

  onModuleInit() {
    this.dataDir = path.resolve(
      process.env.STUDIO_CHAT_DIR ||
        path.join(process.cwd(), "data", "work-order-chats"),
    );
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private filePath(workOrderId: string) {
    return path.join(this.dataDir, `${workOrderId}.yaml`);
  }

  private nowIso() {
    return new Date().toISOString();
  }

  async getThread(workOrderId: string): Promise<ManagerChatThread> {
    await this.workOrders.get(workOrderId); // ensure exists
    const fp = this.filePath(workOrderId);
    if (!fs.existsSync(fp)) {
      return ManagerChatThreadSchema.parse({
        work_order_id: workOrderId,
        messages: [
          {
            id: randomUUID().slice(0, 8),
            role: "manager",
            content: HELP,
            created_at: this.nowIso(),
            actions: ["help"],
          },
        ],
        updated_at: this.nowIso(),
      });
    }
    return ManagerChatThreadSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8")));
  }

  private saveThread(thread: ManagerChatThread) {
    const next = ManagerChatThreadSchema.parse({
      ...thread,
      updated_at: this.nowIso(),
    });
    fs.writeFileSync(
      this.filePath(thread.work_order_id),
      `# Manager chat for ${thread.work_order_id}\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return next;
  }

  async chat(workOrderId: string, input: unknown) {
    const body = ManagerChatPostSchema.parse(input);
    const text = body.message.trim();
    let thread = await this.getThread(workOrderId);
    const userMsg: ManagerChatMessage = {
      id: randomUUID().slice(0, 8),
      role: "user",
      content: text,
      created_at: this.nowIso(),
      actions: [],
    };
    thread.messages.push(userMsg);

    const { reply, actions, workOrder } = await this.handle(workOrderId, text);
    const managerMsg: ManagerChatMessage = {
      id: randomUUID().slice(0, 8),
      role: "manager",
      content: reply,
      created_at: this.nowIso(),
      actions,
    };
    thread.messages.push(managerMsg);
    thread = this.saveThread(thread);

    return {
      reply,
      actions,
      work_order: workOrder || (await this.workOrders.get(workOrderId)),
      thread,
    };
  }

  private async handle(
    workOrderId: string,
    text: string,
  ): Promise<{ reply: string; actions: string[]; workOrder?: WorkOrder }> {
    const raw = text.trim();
    const lower = raw.toLowerCase();

    if (/^(帮助|help|\/help|\?)$/i.test(raw) || /你能做什么|怎么用/.test(raw)) {
      return { reply: HELP, actions: ["help"] };
    }

    if (
      /\/status|状态|卡在哪|现在怎样|进度|跑到哪/.test(lower) ||
      raw === "status"
    ) {
      return {
        reply: await this.workOrders.describeStatus(workOrderId),
        actions: ["status"],
      };
    }

    const clarify =
      raw.match(/^(?:澄清|需求补充|补充需求|clarify)[:：\s]+(.+)$/is) ||
      raw.match(/^\/clarify\s+(.+)$/is);
    if (clarify?.[1]) {
      const order = await this.workOrders.clarify(workOrderId, clarify[1].trim());
      return {
        reply: `已记录澄清，并写回工单需求。\n\n补充内容：\n${clarify[1].trim()}\n\n${await this.workOrders.describeStatus(workOrderId)}`,
        actions: ["clarify"],
        workOrder: order,
      };
    }

    const approve =
      /^(通过|批准|同意|approve)(?:[:：\s]+(.*))?$/is.exec(raw) ||
      /^\/approve(?:\s+(.*))?$/is.exec(raw);
    if (approve) {
      try {
        const order = await this.workOrders.decide(workOrderId, {
          decision: "approve",
          feedback: (approve[1] || "").trim(),
        });
        return {
          reply: `已通过当前步骤。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["approve"],
          workOrder: order,
        };
      } catch (err) {
        return {
          reply: err instanceof Error ? err.message : String(err),
          actions: ["approve_failed"],
        };
      }
    }

    const rejectEnd =
      /^(驳回结束|结束驳回)(?:[:：\s]+(.*))?$/is.exec(raw) ||
      /^\/reject(?:\s+(.*))?$/is.exec(raw);
    if (rejectEnd) {
      try {
        const feedback = raw.startsWith("/")
          ? (rejectEnd[1] || "").trim()
          : (rejectEnd[2] || "").trim();
        const order = await this.workOrders.rejectAndEnd(workOrderId, feedback);
        return {
          reply: `已驳回并结束本轮运行。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["reject_end"],
          workOrder: order,
        };
      } catch (err) {
        return {
          reply: err instanceof Error ? err.message : String(err),
          actions: ["reject_failed"],
        };
      }
    }

    // plain 驳回 → use step on_reject policy
    const rejectPolicy = /^(驳回|拒绝)(?:[:：\s]+(.*))?$/is.exec(raw);
    if (rejectPolicy && !/返工|回到|goto|rework/.test(raw)) {
      try {
        const order = await this.workOrders.decide(workOrderId, {
          decision: "reject",
          feedback: (rejectPolicy[2] || "").trim(),
        });
        return {
          reply: `已按当前步骤驳回策略处理。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["reject"],
          workOrder: order,
        };
      } catch (err) {
        return {
          reply: err instanceof Error ? err.message : String(err),
          actions: ["reject_failed"],
        };
      }
    }

    const rework =
      raw.match(/^(?:返工到|回到|rework|\/rework)\s+([a-z0-9_-]+)(?:[:：\s]+(.*))?$/is) ||
      raw.match(/^让\s*([a-z0-9_-]+)\s*返工(?:[:：\s]+(.*))?$/is);
    if (rework?.[1]) {
      try {
        const order = await this.workOrders.rework(
          workOrderId,
          rework[1].trim(),
          (rework[2] || "").trim(),
        );
        return {
          reply: `已指派返工到「${rework[1].trim()}」并重新执行。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["rework"],
          workOrder: order,
        };
      } catch (err) {
        return {
          reply: err instanceof Error ? err.message : String(err),
          actions: ["rework_failed"],
        };
      }
    }

    const syncDify = /^(同步\s*dify|同步dify|\/sync-dify|sync\s*dify)$/i.test(raw);
    if (syncDify) {
      try {
        const order = await this.workOrders.syncDify(workOrderId);
        return {
          reply: `已同步 Dify 状态。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["sync_dify"],
          workOrder: order,
        };
      } catch (err) {
        return {
          reply: err instanceof Error ? err.message : String(err),
          actions: ["sync_dify_failed"],
        };
      }
    }

    const restart =
      /^(重新执行|重跑|再跑一次|\/restart|restart)$/i.test(raw);
    if (restart) {
      try {
        const order = await this.workOrders.restart(workOrderId, {});
        return {
          reply: `已重新执行（结束旧运行后按上次配置再启）。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["restart"],
          workOrder: order,
        };
      } catch (err) {
        return {
          reply: err instanceof Error ? err.message : String(err),
          actions: ["restart_failed"],
        };
      }
    }

    const startDify =
      raw.match(/^(?:启动\s*dify|\/start-dify)\s+([a-z0-9_-]+)$/i) ||
      raw.match(/^启动流水线\s+dify\s+([a-z0-9_-]+)$/i);
    if (startDify?.[1]) {
      try {
        this.pipelines.get(startDify[1]);
        const order = await this.workOrders.start(workOrderId, {
          pipeline_id: startDify[1],
          executor: "dify",
        });
        return {
          reply: `已启动流水线 \`${startDify[1]}\`（Dify）。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["start_dify"],
          workOrder: order,
        };
      } catch (err) {
        const pipes = this.pipelines
          .list({ enabled: "true" })
          .map((p) => `- ${p.id}：${p.name}`)
          .join("\n");
        return {
          reply: `${err instanceof Error ? err.message : String(err)}\n\n可用流水线：\n${pipes || "（无）"}`,
          actions: ["start_dify_failed"],
        };
      }
    }

    const start =
      raw.match(/^(?:启动|开始|start|\/start)\s+([a-z0-9_-]+)$/i) ||
      raw.match(/^启动流水线\s+([a-z0-9_-]+)$/i);
    if (start?.[1]) {
      try {
        this.pipelines.get(start[1]);
        const order = await this.workOrders.start(workOrderId, {
          pipeline_id: start[1],
          executor: "dify",
        });
        return {
          reply: `已启动流水线 \`${start[1]}\`（Dify）。\n\n${await this.workOrders.describeStatus(workOrderId)}`,
          actions: ["start"],
          workOrder: order,
        };
      } catch (err) {
        const pipes = this.pipelines
          .list({ enabled: "true" })
          .map((p) => `- ${p.id}：${p.name}`)
          .join("\n");
        return {
          reply: `${err instanceof Error ? err.message : String(err)}\n\n可用流水线：\n${pipes || "（无）"}`,
          actions: ["start_failed"],
        };
      }
    }

    // fallback: status + hint
    try {
      const status = await this.workOrders.describeStatus(workOrderId);
      return {
        reply: `我是总管，先给你当前状态；若要执行操作请用明确指令（输入「帮助」查看）。\n\n${status}`,
        actions: ["fallback_status"],
      };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }
}
