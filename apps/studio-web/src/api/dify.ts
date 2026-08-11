import { get, post, put } from "../http";
import type { DifyConfigPublicForTeam } from "@agent-studio/agent-schema";

export type DifyConfigUpdate = {
  enabled?: boolean;
  api_base?: string;
  api_key?: string;
  bridge_base_url?: string;
  agents_md_path?: string;
  response_mode?: "streaming" | "blocking";
  console_base?: string;
  console_email?: string;
  console_token?: string;
  git_ssh_key_path?: string;
  git_prefer_ssh?: boolean;
  git_ssh_port?: number;
  git_ssh_user?: string;
};

export type DifyConsoleLoginBody = {
  email: string;
  password: string;
  console_base?: string;
};

export type DifyConsoleLoginResult = {
  ok: true;
  source: "body" | "cookie";
  config: DifyConfigPublicForTeam;
};

export const difyApi = {
  getConfig(params: { team_id: string }) {
    return get<DifyConfigPublicForTeam>("/dify/config", { params });
  },
  updateConfig(body: DifyConfigUpdate, params: { team_id: string }) {
    return put<DifyConfigPublicForTeam>("/dify/config", body, { params });
  },
  consoleLogin(body: DifyConsoleLoginBody, params: { team_id: string }) {
    return post<DifyConsoleLoginResult>("/dify/console/login", body, { params });
  },
  health(params: { team_id: string }) {
    return get<
      DifyConfigPublicForTeam & {
        ok: boolean;
        error?: string;
        parameters?: unknown;
        auth_source?: string;
      }
    >("/dify/health", { params });
  },
};
