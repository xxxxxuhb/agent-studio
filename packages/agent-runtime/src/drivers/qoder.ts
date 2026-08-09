import type { AgentDriver, AgentRunRequest, AgentRunResult } from "../types.js";
import { resolveExecutable } from "./proc.js";

function qoderPat(): string {
  return (
    process.env.QODER_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.QODER_PAT?.trim() ||
    ""
  );
}

function preferCliLogin(): boolean {
  const v = (process.env.QODER_AUTH || "").trim().toLowerCase();
  return v === "qodercli" || v === "login" || process.env.QODER_USE_CLI_LOGIN === "1";
}

/**
 * Qoder Agent SDK driver (`@qoder-ai/qoder-agent-sdk`).
 * Auth: QODER_PERSONAL_ACCESS_TOKEN / QODER_PAT, or local qodercli login (QODER_AUTH=qodercli).
 */
export class QoderAgentDriver implements AgentDriver {
  readonly id = "qoder";
  readonly label = "Qoder Agent SDK";

  isAvailable(): boolean {
    if (qoderPat()) return true;
    if (preferCliLogin()) return true;
    return Boolean(resolveExecutable(["qodercli"], ["QODERCLI_PATH"]));
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "Qoder driver unavailable: set QODER_PERSONAL_ACCESS_TOKEN (or QODER_PAT), or QODER_AUTH=qodercli after `qodercli` login",
      );
    }

    // Normalize alias before SDK env reader.
    if (!process.env.QODER_PERSONAL_ACCESS_TOKEN?.trim() && process.env.QODER_PAT?.trim()) {
      process.env.QODER_PERSONAL_ACCESS_TOKEN = process.env.QODER_PAT.trim();
    }

    let sdk: typeof import("@qoder-ai/qoder-agent-sdk");
    try {
      sdk = await import("@qoder-ai/qoder-agent-sdk");
    } catch (err) {
      throw new Error(
        `Failed to load @qoder-ai/qoder-agent-sdk: ${err instanceof Error ? err.message : String(err)}. Run npm install in the monorepo (allow postinstall to fetch the worker runtime, or set QODERCLI_PATH / QODER_WORKER_RUNTIME_PATH).`,
      );
    }

    const auth =
      preferCliLogin() || !qoderPat()
        ? sdk.qodercliAuth()
        : sdk.accessTokenFromEnv();

    const texts: string[] = [];
    let sessionId = "";
    let resultText = "";

    try {
      const stream = sdk.query({
        prompt: request.prompt,
        options: {
          auth,
          cwd: request.cwd,
          model: process.env.QODER_MODEL || process.env.AGENT_MODEL || undefined,
          canUseTool: async (_toolName, input) => ({
            behavior: "allow",
            updatedInput: input,
          }),
        },
      });

      for await (const message of stream) {
        if (!message || typeof message !== "object") continue;
        const msg = message as {
          type?: string;
          subtype?: string;
          session_id?: string;
          result?: string;
          errors?: string[];
          message?: { content?: unknown };
        };
        if (msg.session_id) sessionId = msg.session_id;
        if (msg.type === "result") {
          if (msg.subtype === "success" && typeof msg.result === "string") {
            resultText = msg.result;
          } else if (msg.errors?.length) {
            throw new Error(`Qoder run failed: ${msg.errors.join("; ")}`);
          }
        }
        if (msg.type === "assistant") {
          const content = msg.message?.content;
          if (typeof content === "string") texts.push(content);
          else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block &&
                typeof block === "object" &&
                "type" in block &&
                (block as { type: string }).type === "text" &&
                "text" in block
              ) {
                texts.push(String((block as { text: string }).text));
              }
            }
          }
        }
      }
    } catch (err) {
      throw new Error(
        `Qoder agent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const raw = resultText || texts.join("\n").trim();
    return {
      summary: raw.slice(0, 500) || `${request.stage} completed via qoder`,
      raw: raw || `(qoder finished with empty output for ${request.stage})`,
      driver: this.id,
      dryRun: false,
      providerRunId: sessionId || undefined,
    };
  }
}
