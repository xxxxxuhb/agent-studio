import { Agent, CursorAgentError } from "@cursor/sdk";
import type { AgentDriver, AgentRunRequest, AgentRunResult } from "../types.js";
import { hasCursorCredentials } from "./cursor-auth.js";

function modelId() {
  return process.env.CURSOR_MODEL || process.env.AGENT_MODEL || "composer-2.5";
}

export class CursorAgentDriver implements AgentDriver {
  readonly id = "cursor";
  readonly label = "Cursor Agent SDK (local)";

  isAvailable(): boolean {
    return hasCursorCredentials();
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "Cursor driver unavailable: set CURSOR_API_KEY or run with --login",
      );
    }
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    try {
      const result = await Agent.prompt(request.prompt, {
        ...(apiKey ? { apiKey } : {}),
        model: { id: modelId() },
        local: { cwd: request.cwd },
      });
      if (result.status === "error") {
        throw new Error(`Cursor run failed: ${result.id}`);
      }
      return {
        summary: result.result || `${request.stage} completed`,
        raw: result.result || "",
        driver: this.id,
        dryRun: false,
        providerRunId: result.id,
      };
    } catch (err) {
      if (err instanceof CursorAgentError) {
        throw new Error(
          `Cursor agent startup failed: ${err.message} (retryable=${err.isRetryable})`,
        );
      }
      throw err;
    }
  }
}
