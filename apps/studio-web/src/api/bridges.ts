import { get, del, post } from "../http";
import type { BridgeExecutor } from "@agent-studio/agent-schema";

export type BridgePrepareInput = {
  name: string;
  driver: string;
  base_url: string;
  studio_url: string;
  auth_mode?: "key" | "login" | "none";
  note?: string;
};

export type BridgePrepareResult = {
  bridge: BridgeExecutor;
  install_command: string;
  local_command: string;
  auth_mode: string;
  agent_env_key: string;
  token_configured: boolean;
};

export const bridgesApi = {
  list(params: { status?: string } = {}) {
    return get<{
      items: BridgeExecutor[];
      total: number;
      token_configured: boolean;
    }>("/bridges", { params });
  },
  get(id: string) {
    return get<BridgeExecutor>(`/bridges/${id}`);
  },
  prepare(body: BridgePrepareInput) {
    return post<BridgePrepareResult>("/bridges/prepare", body);
  },
  remove(id: string) {
    return del<{ ok: boolean; id: string }>(`/bridges/${id}`);
  },
};
