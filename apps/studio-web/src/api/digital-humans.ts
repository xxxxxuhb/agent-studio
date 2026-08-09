import type { DigitalHuman, DigitalHumanCreate } from "@agent-studio/agent-schema";
import { del, get, patch, post, put } from "../http";

export const digitalHumansApi = {
  list(params: { q?: string; role?: string; enabled?: string }) {
    return get<{ items: DigitalHuman[]; total: number }>("/digital-humans", { params });
  },
  create(body: DigitalHumanCreate) {
    return post<DigitalHuman>("/digital-humans", body);
  },
  update(id: string, body: Partial<DigitalHumanCreate>) {
    return put<DigitalHuman>(`/digital-humans/${id}`, body);
  },
  setEnabled(id: string, enabled: boolean) {
    return patch<DigitalHuman>(`/digital-humans/${id}/enabled`, { enabled });
  },
  remove(id: string) {
    return del<{ ok: boolean; id: string }>(`/digital-humans/${id}`);
  },
  seedDefaults() {
    return post<{ imported: string[]; skipped: string[]; total: number }>("/seed/defaults");
  },
};
