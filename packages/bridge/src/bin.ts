#!/usr/bin/env node
import { Command } from "commander";
import { select } from "@inquirer/prompts";
import { listAgentDriverIds } from "@agent-studio/agent-runtime";
import { loadDotEnv } from "./env.js";
import { startBridge } from "./server.js";

loadDotEnv();

const DRIVER_HINTS: Record<string, string> = {
  auto: "first available: cursor → trae → qoder",
  cursor: "Cursor Agent SDK (API key or --login)",
  trae: "TraeCode CLI traecli (TRAECLI_PERSONAL_ACCESS_TOKEN or /login)",
  qoder: "Qoder SDK (PAT or QODER_AUTH=qodercli)",
  openai: "placeholder (not implemented)",
};

async function promptDriver(): Promise<string> {
  if (!process.stdin.isTTY) return process.env.AGENT_DRIVER || "auto";
  const ids = ["auto", ...listAgentDriverIds()];
  return select({
    message: "Select agent driver for this executor",
    choices: ids.map((id) => ({
      name: DRIVER_HINTS[id] ? `${id} — ${DRIVER_HINTS[id]}` : id,
      value: id,
    })),
    default: "auto",
  });
}

const program = new Command();

program
  .name("agent-studio-bridge")
  .description("Agent Studio Bridge — run an executor on any machine")
  .version("0.1.0");

program
  .command("drivers")
  .description("List available agent drivers")
  .action(() => {
    console.log(["auto", ...listAgentDriverIds()].join("\n"));
  });

program
  .command("start")
  .description("Start Bridge HTTP server and link to Studio via WebSocket")
  .option("-d, --driver <id>", "Agent type: auto | cursor | trae | qoder | openai")
  .option("-p, --port <n>", "Listen port", (v) => Number(v), 8787)
  .option("--host <addr>", "Bind host", "0.0.0.0")
  .option("-n, --name <label>", "Executor display name")
  .option("--public-url <url>", "URL Studio should call")
  .option("--studio-url <url>", "Studio API root (e.g. http://127.0.0.1:8790)")
  .option("-t, --token <secret>", "Shared register token (STUDIO_BRIDGE_TOKEN)")
  .option(
    "--login",
    "If no CURSOR_API_KEY, open browser for Cursor SDK login",
  )
  .option("--env <file>", "Extra .env file")
  .action(async (opts: {
    driver?: string;
    port?: number;
    host?: string;
    name?: string;
    publicUrl?: string;
    studioUrl?: string;
    token?: string;
    login?: boolean;
    env?: string;
  }) => {
    if (opts.env) loadDotEnv([opts.env]);

    let driver = opts.driver || process.env.AGENT_DRIVER || "";
    if (!driver) driver = await promptDriver();

    await startBridge({
      driver,
      port: opts.port,
      host: opts.host,
      name: opts.name,
      publicUrl: opts.publicUrl,
      studioUrl: opts.studioUrl,
      studioToken: opts.token,
      login: Boolean(opts.login),
    });
  });

program
  .command("gc")
  .description(
    "Clean stale Bridge prompt temps + terminal docs/runs artifacts (safe; never deletes whole clones)",
  )
  .option("--apply", "Actually delete (default is dry-run)", false)
  .option("--dry-run", "Force dry-run even if BRIDGE_GC_DRY_RUN=false", false)
  .option(
    "--prompt-hours <n>",
    "Max age for .agent-studio/prompt-* files",
    (v) => Number(v),
  )
  .option(
    "--artifact-days <n>",
    "Max age for terminal/orphan docs/runs/{runId} (also legacy docs/dify-runs)",
    (v) => Number(v),
  )
  .option(
    "--runs-json-days <n>",
    "Max age for terminal entries pruned from runs.json",
    (v) => Number(v),
  )
  .option("--env <file>", "Extra .env file")
  .action(async (opts: {
    apply?: boolean;
    dryRun?: boolean;
    promptHours?: number;
    artifactDays?: number;
    runsJsonDays?: number;
    env?: string;
  }) => {
    if (opts.env) loadDotEnv([opts.env]);
    const { resolveGcOptionsFromEnv, runBridgeGc } = await import("./gc.js");
    const dryRun = opts.dryRun ? true : opts.apply ? false : undefined;
    const resolved = resolveGcOptionsFromEnv({
      dryRun,
      promptMaxAgeMs:
        opts.promptHours != null && Number.isFinite(opts.promptHours)
          ? opts.promptHours * 3600_000
          : undefined,
      artifactMaxAgeMs:
        opts.artifactDays != null && Number.isFinite(opts.artifactDays)
          ? opts.artifactDays * 86_400_000
          : undefined,
      runsJsonMaxAgeMs:
        opts.runsJsonDays != null && Number.isFinite(opts.runsJsonDays)
          ? opts.runsJsonDays * 86_400_000
          : undefined,
    });
    const result = runBridgeGc(resolved);
    console.log(
      JSON.stringify(
        {
          dryRun: result.dryRun,
          reposRoot: result.reposRoot,
          dataDir: result.dataDir,
          deleted: result.deleted.length,
          skipped: result.skipped.length,
          prunedRunIds: result.prunedRunIds,
          bytesFreed: result.bytesFreed,
          sample: result.deleted.slice(0, 20),
        },
        null,
        2,
      ),
    );
    if (result.dryRun) {
      console.error(
        "dry-run only — re-run with --apply to delete (never removes whole repo clones)",
      );
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
