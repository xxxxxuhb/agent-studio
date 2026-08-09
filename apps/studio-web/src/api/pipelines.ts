import { del, get, patch, post, put } from "../http";
import type {
  PipelineCreate,
  PipelinePublic,
} from "@agent-studio/agent-schema";

export const pipelinesApi = {
  list(params: { q?: string; enabled?: string }) {
    return get<{ items: PipelinePublic[]; total: number }>("/pipelines", { params });
  },
  get(id: string) {
    return get<PipelinePublic>(`/pipelines/${id}`);
  },
  create(body: PipelineCreate) {
    return post<PipelinePublic>("/pipelines", body);
  },
  update(id: string, body: Partial<PipelineCreate>) {
    return put<PipelinePublic>(`/pipelines/${id}`, body);
  },
  setEnabled(id: string, enabled: boolean) {
    return patch<PipelinePublic>(`/pipelines/${id}/enabled`, { enabled });
  },
  remove(id: string) {
    return del<{ ok: boolean; id: string }>(`/pipelines/${id}`);
  },
  seedDefaults() {
    return post<{ imported: string[]; skipped: string[]; total: number }>("/seed/pipelines");
  },
  compose(body: { prompt: string; id?: string; name?: string; save?: boolean }) {
    return post<{
      draft: PipelineCreate | PipelinePublic;
      saved: boolean;
      generated_by?: "agent" | "rules";
      driver?: string;
      dry_run?: boolean;
      fallback_reason?: string;
    }>("/pipelines/compose", body, { timeout: 130_000 });
  },
  difyHealth(id: string) {
    return post<{
      ok: boolean;
      binding_source?: string;
      api_base?: string;
      app_id?: string;
      error?: string;
      parameters?: unknown;
    }>(`/pipelines/${id}/dify-health`);
  },
  getDifyDsl(id: string) {
    return get<{
      pipeline_id: string;
      filename: string;
      yaml: string;
      hint: string;
    }>(`/pipelines/${id}/dify-dsl`);
  },
  importDifyDsl(id: string, body?: { overwrite?: boolean }) {
    return post<{
      ok: boolean;
      status: string;
      app_id: string;
      import_id: string;
      published?: boolean;
      published_version?: string;
      hint: string;
      pipeline?: unknown;
    }>(`/pipelines/${id}/dify-import`, body || {});
  },
};
