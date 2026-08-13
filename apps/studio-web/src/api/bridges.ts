import { get, del, post } from "../http";
import type { BridgeExecutor, BridgeLinkType } from "@agent-studio/agent-schema";

export type BridgePrepareInput = {
  name: string;
  team_id: string;
  driver: string;
  base_url: string;
  studio_url: string;
  auth_mode?: "key" | "login" | "none";
  link_type?: BridgeLinkType;
  note?: string;
};

export type BridgePrepareResult = {
  bridge: BridgeExecutor;
  install_command: string;
  local_command: string;
  auth_mode: string;
  link_type: BridgeLinkType;
  agent_env_key: string;
  token_configured: boolean;
};

export const bridgesApi = {
  list(params: { status?: string; team_id?: string } = {}) {
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
