import { z } from "zod";

/** online=connected idle, busy=executing a run, offline=disconnected */
export const BridgeStatusSchema = z.enum(["online", "offline", "busy"]);
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>;

export const BridgeExecutorSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Base URL Studio/Dify should call, e.g. http://192.168.1.8:8787 */
  base_url: z.string().min(1),
  /** Active agent driver on this executor: cursor | trae | qoder | … */
  driver: z.string().default("auto"),
  driver_label: z.string().optional().default(""),
  dry_run: z.boolean().optional().default(false),
  model: z.string().optional().default(""),
  platform: z.string().optional().default(""),
  available_drivers: z.array(z.string()).optional().default([]),
  status: BridgeStatusSchema.default("offline"),
  /** Active Bridge run id when status=busy */
  current_run_id: z.string().optional().default(""),
  last_seen_at: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  note: z.string().optional().default(""),
});
export type BridgeExecutor = z.infer<typeof BridgeExecutorSchema>;

export const BridgeRegisterSchema = z.object({
  name: z.string().min(1),
  base_url: z.string().min(1),
  token: z.string().min(1),
  driver: z.string().optional().default("auto"),
  driver_label: z.string().optional().default(""),
  dry_run: z.boolean().optional().default(false),
  model: z.string().optional().default(""),
  platform: z.string().optional().default(""),
  available_drivers: z.array(z.string()).optional().default([]),
  id: z.string().optional(),
  status: BridgeStatusSchema.optional().default("online"),
});
export type BridgeRegister = z.infer<typeof BridgeRegisterSchema>;

export const BridgeHeartbeatSchema = z.object({
  token: z.string().min(1),
  base_url: z.string().optional(),
  driver: z.string().optional(),
  driver_label: z.string().optional(),
  dry_run: z.boolean().optional(),
  model: z.string().optional(),
  status: BridgeStatusSchema.optional().default("online"),
  current_run_id: z.string().optional(),
});
export type BridgeHeartbeat = z.infer<typeof BridgeHeartbeatSchema>;

export const BridgeAuthModeSchema = z.enum(["key", "login", "none"]);
export type BridgeAuthMode = z.infer<typeof BridgeAuthModeSchema>;

/** Studio UI “添加执行器”：预登记 + 生成安装命令（Agent key 不入服务端，仅 auth_mode） */
export const BridgePrepareSchema = z.object({
  name: z.string().min(1),
  /** Agent driver: auto | cursor | trae | qoder | openai | … */
  driver: z.string().min(1).default("cursor"),
  /** URL Studio/Dify will call on the executor machine */
  base_url: z.string().min(1),
  /** Studio API root the executor should connect to */
  studio_url: z.string().min(1),
  /** How the executor should authenticate the agent (key stays on client / machine) */
  auth_mode: BridgeAuthModeSchema.optional().default("none"),
  note: z.string().optional().default(""),
});
export type BridgePrepare = z.infer<typeof BridgePrepareSchema>;
