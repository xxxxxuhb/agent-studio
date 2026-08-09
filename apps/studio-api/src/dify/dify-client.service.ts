import { BadRequestException, Injectable } from "@nestjs/common";
import { DifyConfigService, type DifyAuth } from "./dify-config.service";

export type DifyRunDetail = {
  id: string;
  workflow_id?: string;
  status: string;
  inputs?: string | Record<string, unknown> | null;
  outputs?: Record<string, unknown>;
  error?: string | null;
  total_steps?: number;
  total_tokens?: number;
  elapsed_time?: number | null;
  created_at?: number;
  finished_at?: number | null;
};

export type DifyHumanFormAction = {
  id: string;
  title?: string;
  button_style?: string;
};

export type DifyHumanFormField = {
  type?: string;
  output_variable_name: string;
};

export type DifyHumanForm = {
  form_content?: string;
  inputs?: DifyHumanFormField[];
  user_actions?: DifyHumanFormAction[];
  expiration_time?: number | null;
  resolved_default_values?: Record<string, unknown>;
};

export type DifyStartResult = {
  workflow_run_id: string;
  task_id?: string;
  workflow_id?: string;
  status: string;
  outputs?: Record<string, unknown>;
  error?: string | null;
  form_token?: string | null;
  form_node_title?: string;
};

type SseEvent = {
  event?: string;
  task_id?: string;
  workflow_run_id?: string;
  data?: {
    id?: string;
    workflow_id?: string;
    status?: string;
    outputs?: Record<string, unknown>;
    error?: string | null;
    form_token?: string | null;
    node_id?: string;
    node_title?: string;
    title?: string;
  };
  form_token?: string | null;
};

type ConsumeOpts = {
  /** After workflow_run_id is known, return even if still running (ms). */
  softTimeoutMs?: number;
  /** Hard cap for the whole SSE wait (ms). */
  hardTimeoutMs?: number;
};

@Injectable()
export class DifyClientService {
  constructor(private readonly config: DifyConfigService) {}

  private resolveAuth(auth?: DifyAuth): DifyAuth {
    if (auth?.api_key && auth?.api_base) return auth;
    return this.config.resolveAuthForPipeline(null);
  }

  private baseUrl(auth?: DifyAuth) {
    return this.resolveAuth(auth).api_base.replace(/\/$/, "");
  }

  private headers(auth?: DifyAuth) {
    const a = this.resolveAuth(auth);
    return {
      Authorization: `Bearer ${a.api_key}`,
      "Content-Type": "application/json",
    };
  }

  async getParameters(auth?: DifyAuth) {
    const res = await fetch(`${this.baseUrl(auth)}/parameters`, {
      headers: this.headers(auth),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(
        `Dify parameters failed: ${(data as { message?: string }).message || (data as { code?: string }).code || res.statusText}`,
      );
    }
    return data;
  }

  async getRun(workflowRunId: string, auth?: DifyAuth): Promise<DifyRunDetail> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl(auth)}/workflows/run/${workflowRunId}`, {
        headers: this.headers(auth),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Dify get run failed (network): ${msg}`);
    }
    const data = (await res.json().catch(() => ({}))) as DifyRunDetail & {
      message?: string;
      code?: string;
    };
    if (!res.ok) {
      throw new BadRequestException(
        `Dify get run failed (${res.status}): ${data.message || data.code || res.statusText}`,
      );
    }
    return data;
  }

  async getHumanInputForm(formToken: string, auth?: DifyAuth): Promise<DifyHumanForm> {
    const res = await fetch(`${this.baseUrl(auth)}/form/human_input/${formToken}`, {
      headers: this.headers(auth),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as DifyHumanForm & {
      message?: string;
      code?: string;
    };
    if (!res.ok) {
      throw new BadRequestException(
        `Dify get human form failed: ${data.message || data.code || res.statusText}`,
      );
    }
    return data;
  }

  async submitHumanInputForm(opts: {
    formToken: string;
    action: string;
    user: string;
    inputs?: Record<string, unknown>;
    auth?: DifyAuth;
  }) {
    const res = await fetch(
      `${this.baseUrl(opts.auth)}/form/human_input/${opts.formToken}`,
      {
        method: "POST",
        headers: this.headers(opts.auth),
        body: JSON.stringify({
          inputs: opts.inputs || {},
          action: opts.action,
          user: opts.user,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(
        `Dify submit human form failed: ${(data as { message?: string }).message || (data as { code?: string }).code || res.statusText}`,
      );
    }
    return data;
  }

  async stopTask(taskId: string, user: string, auth?: DifyAuth) {
    const res = await fetch(`${this.baseUrl(auth)}/workflows/tasks/${taskId}/stop`, {
      method: "POST",
      headers: this.headers(auth),
      body: JSON.stringify({ user }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new BadRequestException(
        `Dify stop failed: ${(data as { message?: string }).message || res.statusText}`,
      );
    }
    return data;
  }

  /**
   * Stop the active Dify workflow for a Studio run.
   * Tries task_id first, then workflow_run_id (some Dify builds accept either),
   * then POST /workflows/run/:id/stop as a fallback.
   */
  async stopWorkflow(opts: {
    taskId?: string | null;
    workflowRunId?: string | null;
    user: string;
    auth?: DifyAuth;
  }): Promise<{ ok: boolean; detail: string }> {
    const user = opts.user?.trim();
    if (!user) {
      return { ok: false, detail: "missing Dify user; cannot stop workflow" };
    }

    const tried: string[] = [];
    const errors: string[] = [];
    const taskCandidates = [opts.taskId, opts.workflowRunId]
      .map((v) => (v || "").trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    for (const id of taskCandidates) {
      tried.push(`tasks/${id}/stop`);
      try {
        await this.stopTask(id, user, opts.auth);
        return { ok: true, detail: `stopped Dify task ${id}` };
      } catch (err) {
        errors.push(
          `tasks/${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const runId = (opts.workflowRunId || "").trim();
    if (runId) {
      tried.push(`workflows/run/${runId}/stop`);
      try {
        const res = await fetch(
          `${this.baseUrl(opts.auth)}/workflows/run/${runId}/stop`,
          {
            method: "POST",
            headers: this.headers(opts.auth),
            body: JSON.stringify({ user }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          return { ok: true, detail: `stopped Dify workflow_run ${runId}` };
        }
        errors.push(
          `run/${runId}: ${(data as { message?: string }).message || res.statusText || res.status}`,
        );
      } catch (err) {
        errors.push(
          `run/${runId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      ok: false,
      detail: `未能停掉 Dify（tried ${tried.join(", ") || "none"}）: ${errors.join(" | ") || "no stop target"}`,
    };
  }

  /**
   * Start workflow via streaming. Returns as soon as we have workflow_run_id,
   * waiting a short soft window for an early Human Input pause.
   * Long Bridge/agent steps must not block the Studio HTTP request.
   */
  async startWorkflow(opts: {
    inputs: Record<string, unknown>;
    user: string;
    auth?: DifyAuth;
  }): Promise<DifyStartResult> {
    const body = {
      inputs: opts.inputs,
      response_mode: "streaming" as const,
      user: opts.user,
    };
    return this.consumeSseUntilPauseOrFinish(
      await this.openStream(`${this.baseUrl(opts.auth)}/workflows/run`, {
        method: "POST",
        headers: this.headers(opts.auth),
        body: JSON.stringify(body),
      }),
      {},
      { softTimeoutMs: 8_000, hardTimeoutMs: 25_000 },
    );
  }

  /**
   * Re-open event stream briefly to recover form_token after a pause.
   */
  async recoverPauseInfo(opts: {
    workflowRunId: string;
    user: string;
    auth?: DifyAuth;
  }): Promise<Partial<DifyStartResult>> {
    const qs = new URLSearchParams({
      user: opts.user,
      include_state_snapshot: "true",
    });
    const res = await this.openStream(
      `${this.baseUrl(opts.auth)}/workflow/${opts.workflowRunId}/events?${qs}`,
      {
        method: "GET",
        headers: this.headers(opts.auth),
      },
    );
    return this.consumeSseUntilPauseOrFinish(
      res,
      {
        workflow_run_id: opts.workflowRunId,
        status: "running",
      },
      { softTimeoutMs: 5_000, hardTimeoutMs: 12_000 },
    );
  }

  private async openStream(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Dify 连接失败（检查 api_base / 网络）: ${msg}`,
      );
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new BadRequestException(
        `Dify stream failed: ${(data as { message?: string }).message || res.statusText}`,
      );
    }
    return res;
  }

  private async consumeSseUntilPauseOrFinish(
    res: Response,
    seed: Partial<DifyStartResult> = {},
    opts: ConsumeOpts = {},
  ): Promise<DifyStartResult> {
    const softTimeoutMs = opts.softTimeoutMs ?? 8_000;
    const hardTimeoutMs = opts.hardTimeoutMs ?? 25_000;
    const startedAt = Date.now();
    let runIdAt: number | null = seed.workflow_run_id ? Date.now() : null;
    /** True only after workflow_finished / error / pause — not node_finished. */
    let workflowTerminal = false;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const result: DifyStartResult = {
      workflow_run_id: seed.workflow_run_id || "",
      task_id: seed.task_id,
      workflow_id: seed.workflow_id,
      status: seed.status || "running",
      outputs: seed.outputs,
      error: seed.error ?? null,
      form_token: seed.form_token ?? null,
      form_node_title: seed.form_node_title,
    };

    const finishEarly = () => {
      void this.drainReader(reader);
      if (!result.workflow_run_id) {
        throw new BadRequestException("Dify 未在超时前返回 workflow_run_id");
      }
      // Soft/hard disconnect: Dify is still executing unless we saw a real terminal event.
      if (!workflowTerminal) {
        result.status =
          result.status === "paused" || result.form_token ? "paused" : "running";
      }
      return result;
    };

    while (true) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= hardTimeoutMs) return finishEarly();
      if (runIdAt && Date.now() - runIdAt >= softTimeoutMs) return finishEarly();

      const waitBudget = Math.max(
        200,
        Math.min(
          hardTimeoutMs - elapsed,
          runIdAt ? softTimeoutMs - (Date.now() - runIdAt) : hardTimeoutMs - elapsed,
        ),
      );

      const readResult = await this.readWithTimeout(reader, waitBudget);
      if (readResult === "timeout") {
        if (result.workflow_run_id) return finishEarly();
        continue;
      }
      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const line = chunk
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.replace(/^data:\s*/, "");
        if (!payload || payload === "[DONE]") continue;
        let evt: SseEvent;
        try {
          evt = JSON.parse(payload) as SseEvent;
        } catch {
          continue;
        }
        const beforeId = result.workflow_run_id;
        this.applySseEvent(result, evt);
        if (!beforeId && result.workflow_run_id) {
          runIdAt = Date.now();
        }

        if (
          evt.event === "human_input_required" ||
          evt.event === "workflow_paused"
        ) {
          result.status = "paused";
          workflowTerminal = true;
          void this.drainReader(reader);
          if (!result.workflow_run_id) {
            throw new BadRequestException("Dify 暂停但未返回 workflow_run_id");
          }
          return result;
        }
        if (evt.event === "workflow_finished" || evt.event === "error") {
          workflowTerminal = true;
          if (!result.workflow_run_id && evt.data?.id) {
            result.workflow_run_id = evt.data.id;
          }
          // Prefer workflow payload status; default failed on error event.
          if (evt.event === "error" && result.status === "running") {
            result.status = "failed";
          }
          void this.drainReader(reader);
          if (!result.workflow_run_id) {
            throw new BadRequestException("Dify 未返回 workflow_run_id");
          }
          return result;
        }

        if (evt.event === "workflow_started" && result.workflow_run_id && !runIdAt) {
          runIdAt = Date.now();
        }
      }
    }

    if (!result.workflow_run_id) {
      throw new BadRequestException("Dify 流结束但未获得 workflow_run_id");
    }
    if (!workflowTerminal) {
      result.status =
        result.status === "paused" || result.form_token ? "paused" : "running";
    }
    return result;
  }

  private async readWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    ms: number,
  ): Promise<"timeout" | ReadableStreamReadResult<Uint8Array>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private applySseEvent(result: DifyStartResult, evt: SseEvent) {
    if (evt.task_id) result.task_id = evt.task_id;
    if (evt.workflow_run_id) result.workflow_run_id = evt.workflow_run_id;
    if (evt.data?.workflow_id) result.workflow_id = evt.data.workflow_id;

    // Node events (node_finished, etc.) also carry data.status=succeeded.
    // Only workflow-level events may update run status, or Studio falsely completes.
    const workflowLevel =
      evt.event === "workflow_started" ||
      evt.event === "workflow_finished" ||
      evt.event === "workflow_paused" ||
      evt.event === "human_input_required" ||
      evt.event === "error";
    if (workflowLevel) {
      if (evt.event === "workflow_started") {
        result.status = "running";
      } else if (evt.data?.status) {
        result.status = evt.data.status;
      }
    }

    if (evt.data?.outputs && workflowLevel) result.outputs = evt.data.outputs;
    if (evt.data?.error !== undefined && workflowLevel) {
      result.error = evt.data.error;
    }

    const token = evt.form_token ?? evt.data?.form_token ?? null;
    if (token) {
      result.form_token = token;
      result.status = "paused";
    }
    const title = evt.data?.node_title || evt.data?.title;
    if (title) result.form_node_title = title;
    if (
      evt.data?.id &&
      !result.workflow_run_id &&
      evt.event === "workflow_finished"
    ) {
      result.workflow_run_id = evt.data.id;
    }
  }

  private async drainReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Login to Dify Console with email/password and persist access_token (+ csrf when present).
   * Password is never stored. Tries Base64 password first (common), then plaintext.
   */
  async loginConsole(opts: {
    email: string;
    password: string;
    console_base?: string;
  }): Promise<{
    ok: true;
    source: "body" | "cookie";
    config: ReturnType<DifyConfigService["getPublic"]>;
  }> {
    const email = opts.email.trim();
    const password = opts.password;
    if (!email || !password) {
      throw new BadRequestException("请填写 Dify Console 邮箱和密码");
    }

    const console_base = (
      opts.console_base?.trim() ||
      this.config.get().console_base?.trim() ||
      this.config.deriveConsoleBase()
    ).replace(/\/$/, "");

    const attempts: Array<{ label: string; password: string }> = [
      { label: "base64", password: Buffer.from(password, "utf8").toString("base64") },
      { label: "plain", password },
    ];
    // Prefer plain if password already looks like base64 of itself? No — try both.

    let lastError = "";
    for (const attempt of attempts) {
      let res: Response;
      try {
        res = await fetch(`${console_base}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password: attempt.password,
            remember_me: true,
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `Dify Console 登录失败（网络，检查 console_base=${console_base}）: ${msg}`,
        );
      }

      const data = (await res.json().catch(() => ({}))) as {
        result?: string;
        data?: string | { access_token?: string; refresh_token?: string };
        message?: string;
        code?: string;
        error?: string;
      };

      const cookies = this.parseSetCookies(res);
      const bodyToken =
        typeof data.data === "object" && data.data
          ? data.data.access_token?.trim() || ""
          : "";
      const cookieToken = cookies.access_token || "";
      const token = bodyToken || cookieToken;
      const csrf = cookies.csrf_token || "";

      if (res.ok && token) {
        const pub = this.config.setConsoleSession({
          console_base,
          console_email: email,
          console_token: token,
          console_csrf: csrf,
        });
        return {
          ok: true,
          source: bodyToken ? "body" : "cookie",
          config: pub,
        };
      }

      // Some versions return success with only cookies — already handled if token present.
      lastError =
        data.message ||
        data.error ||
        data.code ||
        (typeof data.data === "string" ? data.data : "") ||
        `${res.status} ${res.statusText}`;

      // Wrong password encoding → try next attempt; hard auth failure still try both.
      if (res.status === 401 || res.status === 400) {
        continue;
      }
      if (!res.ok) {
        throw new BadRequestException(`Dify Console 登录失败: ${lastError}`);
      }
      if (!token) {
        lastError =
          "登录成功但未返回 access_token（检查 Dify 版本是否仅支持 HttpOnly Cookie，且 Cookie 是否被中间层剥离）";
      }
    }

    throw new BadRequestException(`Dify Console 登录失败: ${lastError || "邮箱或密码错误"}`);
  }

  private parseSetCookies(res: Response): Record<string, string> {
    const out: Record<string, string> = {};
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const rawList =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (() => {
            const single = res.headers.get("set-cookie");
            return single ? [single] : [];
          })();
    for (const raw of rawList) {
      const first = raw.split(";")[0] || "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) out[name] = decodeURIComponent(value);
    }
    return out;
  }

  private consoleHeaders() {
    const { console_token, console_csrf } = this.config.assertConsoleReady();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${console_token}`,
      "Content-Type": "application/json",
    };
    if (console_csrf) {
      headers["X-CSRF-Token"] = console_csrf;
      headers.Cookie = `access_token=${console_token}; csrf_token=${console_csrf}`;
    }
    return headers;
  }

  /**
   * Import DSL via Dify Console API (requires console access token).
   * POST /console/api/apps/imports
   */
  async importDsl(opts: {
    yaml: string;
    name?: string;
    description?: string;
    /** When set, overwrite existing app */
    app_id?: string;
  }): Promise<{
    status: string;
    app_id?: string;
    import_id?: string;
    error?: string;
    raw: unknown;
  }> {
    const { console_base } = this.config.assertConsoleReady();
    const body: Record<string, unknown> = {
      mode: "yaml-content",
      yaml_content: opts.yaml,
    };
    if (opts.name) body.name = opts.name;
    if (opts.description) body.description = opts.description;
    if (opts.app_id) body.app_id = opts.app_id;

    let res: Response;
    try {
      res = await fetch(`${console_base}/apps/imports`, {
        method: "POST",
        headers: this.consoleHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Dify Console 导入失败（网络）: ${msg}`);
    }

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      app_id?: string;
      error?: string;
      message?: string;
    };

    // 202 = pending confirm (version mismatch)
    if (res.status === 202 && data.id) {
      const confirmed = await this.confirmDslImport(data.id);
      return {
        status: confirmed.status || "completed",
        app_id: confirmed.app_id || data.app_id,
        import_id: data.id,
        error: confirmed.error,
        raw: { import: data, confirm: confirmed.raw },
      };
    }

    if (!res.ok || data.status === "failed") {
      const detail = data.error || data.message || res.statusText;
      const expired =
        res.status === 401 ||
        /token has expired|unauthorized|invalid.*token|jwt.*expired/i.test(
          String(detail),
        );
      throw new BadRequestException(
        expired
          ? `Dify Console Token 已过期：请打开「设置」→ 输入 Console 密码 →「登录并获取 Token」，然后再导入 DSL（${detail}）`
          : `Dify Console 导入失败: ${detail}`,
      );
    }

    return {
      status: data.status || "completed",
      app_id: data.app_id,
      import_id: data.id,
      error: data.error,
      raw: data,
    };
  }

  async confirmDslImport(importId: string) {
    const { console_base } = this.config.assertConsoleReady();
    const res = await fetch(`${console_base}/apps/imports/${importId}/confirm`, {
      method: "POST",
      headers: this.consoleHeaders(),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      app_id?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok || data.status === "failed") {
      throw new BadRequestException(
        `Dify Console 确认导入失败: ${data.error || data.message || res.statusText}`,
      );
    }
    return {
      status: data.status || "completed",
      app_id: data.app_id,
      error: data.error,
      raw: data,
    };
  }

  /**
   * Publish the current draft workflow so App API runs use the imported graph.
   * POST /console/api/apps/{appId}/workflows/publish
   */
  async publishWorkflow(appId: string): Promise<{
    ok: boolean;
    version?: string;
    raw: unknown;
  }> {
    const id = appId.trim();
    if (!id) {
      throw new BadRequestException("publishWorkflow 需要 app_id");
    }
    const { console_base } = this.config.assertConsoleReady();
    let res: Response;
    try {
      res = await fetch(`${console_base}/apps/${id}/workflows/publish`, {
        method: "POST",
        headers: this.consoleHeaders(),
        body: JSON.stringify({ marked_name: "", marked_comment: "" }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Dify 发布工作流失败（网络）: ${msg}`);
    }

    const data = (await res.json().catch(() => ({}))) as {
      result?: string;
      version?: string;
      message?: string;
      error?: string;
      code?: string;
    };

    if (!res.ok || (data.result && data.result !== "success")) {
      const detail = data.error || data.message || data.code || res.statusText;
      const expired =
        res.status === 401 ||
        /token has expired|unauthorized|invalid.*token|jwt.*expired/i.test(
          String(detail),
        );
      throw new BadRequestException(
        expired
          ? `Dify Console Token 已过期：请到「设置」重新登录后再发布（${detail}）`
          : `Dify 发布工作流失败: ${detail}`,
      );
    }

    return {
      ok: true,
      version: data.version,
      raw: data,
    };
  }
}
