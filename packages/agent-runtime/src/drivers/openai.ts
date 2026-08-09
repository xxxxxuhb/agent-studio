import type { AgentDriver } from "../types.js";

/**
 * Placeholder for OpenAI (or compatible) agents.
 * Implement later without touching Bridge orchestration.
 */
export class OpenAIAgentDriver implements AgentDriver {
  readonly id = "openai";
  readonly label = "OpenAI Agents (not implemented)";

  isAvailable(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  async run(): Promise<never> {
    throw new Error(
      "OpenAI agent driver is not implemented yet. Set AGENT_DRIVER=cursor|trae|qoder, or contribute drivers/openai.ts",
    );
  }
}
