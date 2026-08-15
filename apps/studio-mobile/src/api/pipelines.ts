import { get } from "../http";
import type { PipelinePublic } from "@agent-studio/agent-schema";

export const pipelinesApi = {
  list(params: { team_id?: string; enabled?: string } = {}) {
    return get<{ items: PipelinePublic[]; total: number }>("/pipelines", {
      params,
    });
  },
};
