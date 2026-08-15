export const STATUS_LABEL: Record<string, { color: string; text: string }> = {
  draft: { color: "#64748B", text: "草稿" },
  queued: { color: "#2563EB", text: "排队中" },
  running: { color: "#2563EB", text: "运行中" },
  pending_approval: { color: "#D97706", text: "待确认" },
  waiting: { color: "#0891B2", text: "等待事件" },
  completed: { color: "#16A34A", text: "已完成" },
  rejected: { color: "#DC2626", text: "已驳回" },
  failed: { color: "#DC2626", text: "失败" },
  cancelled: { color: "#64748B", text: "已取消" },
};

export const BRIDGE_STATUS_LABEL: Record<
  string,
  { color: string; text: string }
> = {
  online: { color: "#16A34A", text: "在线" },
  busy: { color: "#D97706", text: "忙碌" },
  offline: { color: "#64748B", text: "离线" },
};

export const CATEGORY_OPTIONS = [
  { value: "requirement", label: "需求" },
  { value: "bug", label: "Bug" },
  { value: "enhancement", label: "优化" },
  { value: "chore", label: "杂项" },
  { value: "other", label: "其他" },
];

export const PRIORITY_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];
