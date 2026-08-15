import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  WorkOrderCommentThreadSchema,
  type WorkOrderComment,
  type WorkOrderCommentThread,
} from "@agent-studio/agent-schema";

function commentsDir(): string {
  return (
    process.env.STUDIO_WORK_ORDER_COMMENTS_DIR ||
    path.join(process.cwd(), "data", "work-order-comments")
  );
}

function commentsPath(workOrderId: string): string {
  const safe = workOrderId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(commentsDir(), `${safe}.yaml`);
}

export async function loadWorkOrderComments(
  workOrderId: string,
): Promise<WorkOrderCommentThread> {
  const file = commentsPath(workOrderId);
  try {
    const raw = await readFile(file, "utf8");
    return WorkOrderCommentThreadSchema.parse(parseYaml(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { work_order_id: workOrderId, comments: [] };
    }
    throw err;
  }
}

export async function saveWorkOrderComments(
  thread: WorkOrderCommentThread,
): Promise<WorkOrderCommentThread> {
  const next = WorkOrderCommentThreadSchema.parse({
    ...thread,
    updated_at: new Date().toISOString(),
  });
  await mkdir(commentsDir(), { recursive: true });
  await writeFile(commentsPath(next.work_order_id), stringifyYaml(next), "utf8");
  return next;
}

export async function appendWorkOrderComment(
  workOrderId: string,
  comment: WorkOrderComment,
): Promise<WorkOrderCommentThread> {
  const thread = await loadWorkOrderComments(workOrderId);
  thread.comments = [...thread.comments, comment].slice(-500);
  return saveWorkOrderComments(thread);
}
