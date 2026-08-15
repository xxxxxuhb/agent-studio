import { Agent, CursorAgentError } from "@cursor/sdk";
import type { AgentDriver, AgentRunRequest, AgentRunResult } from "../types.js";
import { usageFromCursorTokens } from "../usage.js";
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
      // create/send/wait (vs Agent.prompt) so we can call getUsage before dispose.
      const agent = await Agent.create({
        ...(apiKey ? { apiKey } : {}),
        model: { id: modelId() },
        local: { cwd: request.cwd },
      });
      try {
        const run = await agent.send(request.prompt);
        const result = await run.wait();
        if (result.status === "error") {
          throw new Error(
            `Cursor run failed: ${result.id}${
              result.error?.message ? ` (${result.error.message})` : ""
            }`,
          );
        }

        let costCents: number | undefined;
        let billedUsage = result.usage;
        try {
          const billed = await agent.getUsage();
          if (!billedUsage && billed.usage) billedUsage = billed.usage;
          if (billed.cost && typeof billed.cost.chargedCents === "number") {
            costCents = billed.cost.chargedCents;
          } else if (
            billed.cost &&
            typeof billed.cost.rawCostCents === "number"
          ) {
            costCents = billed.cost.rawCostCents;
          }
        } catch {
          // Cost is eventually consistent / optional; tokens from the run still count.
        }

        return {
          summary: result.result || `${request.stage} completed`,
          raw: result.result || "",
          driver: this.id,
          dryRun: false,
          providerRunId: agent.agentId || result.id,
          usage: usageFromCursorTokens(billedUsage, costCents),
        };
      } finally {
        agent.close();
      }
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
