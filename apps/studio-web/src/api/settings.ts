import { get, put } from "../http";
import type { StudioConfig, StudioLanguage } from "@agent-studio/agent-schema";

export type StudioSettingsUpdate = {
  language?: StudioLanguage;
};

export const settingsApi = {
  get(params: { team_id: string }) {
    return get<StudioConfig>("/settings", { params });
  },
  update(body: StudioSettingsUpdate, params: { team_id: string }) {
    return put<StudioConfig>("/settings", body, { params });
  },
};
