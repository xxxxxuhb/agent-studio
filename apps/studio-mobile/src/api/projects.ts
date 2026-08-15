import { get } from "../http";
import type { Project } from "@agent-studio/agent-schema";

export const projectsApi = {
  list(params: { team_id?: string } = {}) {
    return get<{ items: Project[]; total: number }>("/projects", { params });
  },
};
