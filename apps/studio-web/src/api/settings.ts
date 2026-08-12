import { get, put } from "../http";
import type {
  StudioConfig,
  StudioConfigPublic,
  StudioLanguage,
} from "@agent-studio/agent-schema";

export type StudioSettingsUpdate = Partial<
  Pick<
    StudioConfig,
    | "language"
    | "bridge_base_url"
    | "agents_md_path"
    | "git_ssh_key_path"
    | "git_prefer_ssh"
    | "git_ssh_port"
    | "git_ssh_user"
  >
> & {
  language?: StudioLanguage;
};

export const settingsApi = {
  get(params: { team_id: string }) {
    return get<StudioConfigPublic>("/settings", { params });
  },
  update(body: StudioSettingsUpdate, params: { team_id: string }) {
    return put<StudioConfigPublic>("/settings", body, { params });
  },
};
