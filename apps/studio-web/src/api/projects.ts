import { del, get, post, put } from "../http";
import type { Project, ProjectCreate, ProjectUpdate } from "@agent-studio/agent-schema";

export const projectsApi = {
  list(params: { q?: string; enabled?: string; team_id?: string } = {}) {
    return get<{
      items: Project[];
      total: number;
      default_clone_root?: string;
    }>("/projects", { params });
  },
  get(id: string) {
    return get<Project>(`/projects/${id}`);
  },
  catalog(id: string) {
    return get<{
      project_id: string;
      project_name: string;
      clone_root: string;
      repos: Array<{
        id: string;
        name: string;
        role: string;
        remote_url: string;
        local_path: string;
        agents_md_path: string;
        clone_status?: string;
        note?: string;
      }>;
    }>(`/projects/${id}/catalog`);
  },
  create(body: ProjectCreate) {
    return post<Project>("/projects", body);
  },
  update(id: string, body: ProjectUpdate) {
    return put<Project>(`/projects/${id}`, body);
  },
  remove(id: string) {
    return del<{ ok: boolean; id: string }>(`/projects/${id}`);
  },
  addRepo(id: string, body: unknown) {
    return post<Project>(`/projects/${id}/repos`, body);
  },
  removeRepo(id: string, repoId: string) {
    return del<Project>(`/projects/${id}/repos/${repoId}`);
  },
  clone(id: string, repo_ids?: string[]) {
    return post<Project>(
      `/projects/${id}/clone`,
      { repo_ids },
      { timeout: 180_000 },
    );
  },
};
