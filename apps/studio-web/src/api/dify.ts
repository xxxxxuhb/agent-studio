import { get, post, put } from "../http";
import type { DifyConfigPublic } from "@agent-studio/agent-schema";

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
};

export type DifyConsoleLoginBody = {
  email: string;
  password: string;
  console_base?: string;
};

export type DifyConsoleLoginResult = {
  ok: true;
  source: "body" | "cookie";
  config: DifyConfigPublic;
};

export const difyApi = {
  getConfig(params: { team_id: string }) {
    return get<DifyConfigPublic>("/dify/config", { params });
  },
  updateConfig(body: DifyConfigUpdate, params: { team_id: string }) {
    return put<DifyConfigPublic>("/dify/config", body, { params });
  },
  consoleLogin(body: DifyConsoleLoginBody, params: { team_id: string }) {
    return post<DifyConsoleLoginResult>("/dify/console/login", body, { params });
  },
  health(params: { team_id: string }) {
    return get<DifyConfigPublic & { ok: boolean; error?: string; parameters?: unknown }>(
      "/dify/health",
      { params },
    );
  },
};
