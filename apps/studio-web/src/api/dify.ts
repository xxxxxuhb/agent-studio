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
  getConfig() {
    return get<DifyConfigPublic>("/dify/config");
  },
  updateConfig(body: DifyConfigUpdate) {
    return put<DifyConfigPublic>("/dify/config", body);
  },
  consoleLogin(body: DifyConsoleLoginBody) {
    return post<DifyConsoleLoginResult>("/dify/console/login", body);
  },
  health() {
    return get<DifyConfigPublic & { ok: boolean; error?: string; parameters?: unknown }>(
      "/dify/health",
    );
  },
};
