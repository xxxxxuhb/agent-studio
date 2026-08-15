import type { BridgeClient, CreateRunResult, StageResult } from "./types";

export type HttpBridgeClientOptions = {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const t = (token || "").trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export function createHttpBridgeClient(
  opts: HttpBridgeClientOptions,
): BridgeClient {
  const base = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl || fetch;

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: authHeaders(opts.token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readJson(res);
    return { status: res.status, data };
  }

  return {
    async createRun(body) {
      const { status, data } = await request("POST", "/runs", body);
      if (status === 503) {
        const msg =
          (data as { message?: string })?.message ||
          "bridge_busy";
        throw Object.assign(new Error(msg), {
          code: "bridge_busy",
          statusCode: 503,
          data,
        });
      }
      if (status < 200 || status >= 300) {
        const msg =
          (data as { message?: string; error?: string })?.message ||
          (data as { error?: string })?.error ||
          `Bridge POST /runs failed (${status})`;
        throw Object.assign(new Error(String(msg)), {
          statusCode: status,
          data,
        });
      }
      return data as CreateRunResult;
    },

    async executeStage(runId, stage, body) {
      const { status, data } = await request(
        "POST",
        `/runs/${encodeURIComponent(runId)}/${encodeURIComponent(stage)}`,
        body || {},
      );
      if (status < 200 || status >= 300) {
        const msg =
          (data as { message?: string; error?: string })?.message ||
          (data as { error?: string })?.error ||
          `Bridge stage ${stage} failed (${status})`;
        throw Object.assign(new Error(String(msg)), {
          statusCode: status,
          data,
        });
      }
      return data as StageResult;
    },

    async decide(runId, body) {
      const { status, data } = await request(
        "POST",
        `/runs/${encodeURIComponent(runId)}/decision`,
        body,
      );
      if (status < 200 || status >= 300) {
        const msg =
          (data as { message?: string; error?: string })?.message ||
          (data as { error?: string })?.error ||
          `Bridge decision failed (${status})`;
        throw Object.assign(new Error(String(msg)), {
          statusCode: status,
          data,
        });
      }
      return data;
    },

    async writeInbox(runId, files) {
      const { status, data } = await request(
        "POST",
        `/runs/${encodeURIComponent(runId)}/inbox`,
        { files },
      );
      if (status < 200 || status >= 300) {
        const msg =
          (data as { message?: string; error?: string })?.message ||
          (data as { error?: string })?.error ||
          `Bridge writeInbox failed (${status})`;
        throw Object.assign(new Error(String(msg)), {
          statusCode: status,
          data,
        });
      }
      return data as { written: string[] };
    },
  };
}
