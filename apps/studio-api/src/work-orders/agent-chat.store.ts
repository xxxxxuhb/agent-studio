import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  AgentChatThreadSchema,
  type AgentChatMessage,
  type AgentChatThread,
} from "@agent-studio/agent-schema";

function chatDir(): string {
  return (
    process.env.STUDIO_AGENT_CHAT_DIR ||
    path.join(process.cwd(), "data", "work-order-agent-chats")
  );
}

function chatPath(workOrderId: string): string {
  const safe = workOrderId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(chatDir(), `${safe}.yaml`);
}

export async function loadAgentChatThread(
  workOrderId: string,
): Promise<AgentChatThread> {
  const file = chatPath(workOrderId);
  try {
    const raw = await readFile(file, "utf8");
    return AgentChatThreadSchema.parse(parseYaml(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { work_order_id: workOrderId, messages: [] };
    }
    throw err;
  }
}

export async function saveAgentChatThread(
  thread: AgentChatThread,
): Promise<AgentChatThread> {
  const next = AgentChatThreadSchema.parse({
    ...thread,
    updated_at: new Date().toISOString(),
  });
  await mkdir(chatDir(), { recursive: true });
  await writeFile(chatPath(next.work_order_id), stringifyYaml(next), "utf8");
  return next;
}

export async function appendAgentChatMessages(
  workOrderId: string,
  messages: AgentChatMessage[],
): Promise<AgentChatThread> {
  const thread = await loadAgentChatThread(workOrderId);
  thread.messages = [...thread.messages, ...messages].slice(-200);
  return saveAgentChatThread(thread);
}
