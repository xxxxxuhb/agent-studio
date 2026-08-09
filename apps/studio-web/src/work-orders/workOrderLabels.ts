/** Shared work-order / step status labels for Studio UI. */

export const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  draft: { color: "default", text: "草稿" },
  running: { color: "processing", text: "运行中" },
  pending_approval: { color: "warning", text: "待确认" },
  completed: { color: "success", text: "已完成" },
  rejected: { color: "error", text: "已驳回" },
  failed: { color: "error", text: "失败" },
  cancelled: { color: "default", text: "已取消" },
};

export const CATEGORY_LABEL: Record<
  string,
  { color: string; text: string }
> = {
  requirement: { color: "blue", text: "需求" },
  bug: { color: "red", text: "Bug" },
  enhancement: { color: "purple", text: "优化" },
  chore: { color: "default", text: "杂项" },
  other: { color: "cyan", text: "其他" },
};

export const CATEGORY_OPTIONS = [
  { value: "requirement", label: "需求" },
  { value: "bug", label: "Bug" },
  { value: "enhancement", label: "优化" },
  { value: "chore", label: "杂项" },
  { value: "other", label: "其他" },
] as const;

export const STEP_STATUS_LABEL: Record<string, { color: string; text: string }> = {
  pending: { color: "default", text: "待执行" },
  running: { color: "processing", text: "执行中" },
  pending_approval: { color: "warning", text: "待确认" },
  approved: { color: "success", text: "已通过" },
  rejected: { color: "error", text: "已驳回" },
  failed: { color: "error", text: "失败" },
  skipped: { color: "default", text: "已跳过" },
};

/** Ant Design Steps status mapping */
export const STEP_STATUS_MAP = {
  pending: "wait",
  running: "process",
  pending_approval: "process",
  approved: "finish",
  rejected: "error",
  failed: "error",
  skipped: "wait",
} as const;
