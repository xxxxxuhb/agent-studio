import { get } from "../http";
import type { BridgeExecutor } from "@agent-studio/agent-schema";

export const bridgesApi = {
  list(params: { status?: string; team_id?: string } = {}) {
    return get<{
      items: BridgeExecutor[];
      total: number;
      token_configured: boolean;
    }>("/bridges", { params });
  },
};
