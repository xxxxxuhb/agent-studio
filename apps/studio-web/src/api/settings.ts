import { get, put } from "../http";
import type { StudioConfig, StudioLanguage } from "@agent-studio/agent-schema";

export type StudioSettingsUpdate = {
  language?: StudioLanguage;
};

export const settingsApi = {
  get() {
    return get<StudioConfig>("/settings");
  },
  update(body: StudioSettingsUpdate) {
    return put<StudioConfig>("/settings", body);
  },
};
