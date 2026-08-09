import type { AgentDriver, AgentRunRequest, AgentRunResult } from "../types.js";
import { resolveExecutable, spawnCapture } from "./proc.js";

/**
 * TraeCode CLI driver (`traecli`).
 * Docs: https://docs.trae.cn/cli_use-cases
 * Auth: TRAECLI_PERSONAL_ACCESS_TOKEN (trae-lt-…) or interactive `/login`.
 */
export class TraeAgentDriver implements AgentDriver {
  readonly id = "trae";
  readonly label = "TraeCode CLI (traecli)";

  private bin(): string | null {
    return resolveExecutable(["traecli"], ["TRAECLI_PATH", "TRAE_BIN"]);
  }

  isAvailable(): boolean {
    return Boolean(this.bin());
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const bin = this.bin();
    if (!bin) {
      throw new Error(
        "Trae driver unavailable: install TraeCode CLI (traecli) and ensure it is on PATH (or set TRAECLI_PATH)",
      );
    }

    const timeoutMs = Number(process.env.TRAE_TIMEOUT_MS || 0) || undefined;
    const yolo = process.env.TRAE_YOLO !== "0";
    const allowed =
      process.env.TRAE_ALLOWED_TOOLS?.trim() ||
      "Bash,Edit,MultiEdit,Write,Read,Replace";

    const args = [
      "--allowed-tool",
      allowed,
      ...(yolo ? ["-y"] : []),
      "-p",
      request.prompt,
    ];

    const env: NodeJS.ProcessEnv = {};
    const token =
      process.env.TRAECLI_PERSONAL_ACCESS_TOKEN ||
      process.env.TRAE_TOKEN ||
      process.env.TRAECLI_TOKEN;
    if (token?.trim()) env.TRAECLI_PERSONAL_ACCESS_TOKEN = token.trim();
    if (process.env.TRAECLI_HOST?.trim()) {
      env.TRAECLI_HOST = process.env.TRAECLI_HOST.trim();
    }

    const { code, stdout, stderr } = await spawnCapture(bin, args, {
      cwd: request.cwd,
      timeoutMs,
      env,
    });

    const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
    if (code !== 0) {
      throw new Error(
        `traecli exited ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
      );
    }

    return {
      summary: raw.slice(0, 500) || `${request.stage} completed via traecli`,
      raw: raw || `(traecli finished with empty output for ${request.stage})`,
      driver: this.id,
      dryRun: false,
    };
  }
}
