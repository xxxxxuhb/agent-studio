import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RUN_ARTIFACT_DIR_NAMES } from "./artifacts.js";
import { bridgeDataDir } from "./orchestrator.js";
import type { RunRecord, RunStatus } from "./types.js";
import { bridgeReposRoot } from "./workspaceEnsure.js";

const TERMINAL: ReadonlySet<RunStatus> = new Set([
  "completed",
  "rejected",
  "failed",
]);

export type GcDeleted = {
  path: string;
  kind: "prompt" | "artifact_dir" | "runs_json_entry";
  bytes: number;
  runId?: string;
};

export type GcSkipped = {
  path: string;
  reason: string;
};

export type GcOptions = {
  dryRun: boolean;
  /** Max age for `.agent-studio/prompt-*.txt` (default 24h). */
  promptMaxAgeMs: number;
  /** Max age for terminal/orphan `docs/runs|{dify-runs}/{runId}` dirs (default 14d). */
  artifactMaxAgeMs: number;
  /** Max age for terminal entries pruned from runs.json (default 30d). */
  runsJsonMaxAgeMs: number;
  reposRoot?: string;
  dataDir?: string;
  now?: number;
  /** Extra run ids to protect (e.g. in-flight HTTP stages). */
  protectedRunIds?: Iterable<string>;
};

export type GcResult = {
  dryRun: boolean;
  reposRoot: string;
  dataDir: string;
  deleted: GcDeleted[];
  skipped: GcSkipped[];
  prunedRunIds: string[];
  bytesFreed: number;
};

function envBool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function resolveGcOptionsFromEnv(
  overrides: Partial<GcOptions> = {},
): GcOptions {
  const promptHours = envNumber("BRIDGE_GC_PROMPT_HOURS", 24);
  const artifactDays = envNumber("BRIDGE_GC_ARTIFACT_DAYS", 14);
  const runsDays = envNumber("BRIDGE_GC_RUNS_JSON_DAYS", 30);
  return {
    dryRun: overrides.dryRun ?? envBool("BRIDGE_GC_DRY_RUN", true),
    promptMaxAgeMs: overrides.promptMaxAgeMs ?? promptHours * 3600_000,
    artifactMaxAgeMs: overrides.artifactMaxAgeMs ?? artifactDays * 86_400_000,
    runsJsonMaxAgeMs: overrides.runsJsonMaxAgeMs ?? runsDays * 86_400_000,
    reposRoot: overrides.reposRoot,
    dataDir: overrides.dataDir,
    now: overrides.now,
    protectedRunIds: overrides.protectedRunIds,
  };
}

function isTerminalStatus(status: RunStatus | string | undefined): boolean {
  return TERMINAL.has(status as RunStatus);
}

function runsFileIn(dataDir: string): string {
  return path.join(dataDir, "runs.json");
}

function loadRuns(dataDir: string): Record<string, RunRecord> {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = runsFileIn(dataDir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, RunRecord>;
  } catch {
    return {};
  }
}

function saveRuns(dataDir: string, all: Record<string, RunRecord>): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(runsFileIn(dataDir), JSON.stringify(all, null, 2));
}

function dirBytes(target: string): number {
  try {
    const st = fs.statSync(target);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
  } catch {
    return 0;
  }
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      try {
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile()) total += fs.statSync(p).size;
      } catch {
        /* skip */
      }
    }
  }
  return total;
}

function mtimeMs(target: string): number {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}

function currentBranch(repoPath: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function listRepoRoots(reposRoot: string): string[] {
  if (!fs.existsSync(reposRoot)) return [];
  const out: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(reposRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const project of projects) {
    if (!project.isDirectory() || project.name.startsWith(".")) continue;
    const projectPath = path.join(reposRoot, project.name);
    let repos: fs.Dirent[];
    try {
      repos = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const repo of repos) {
      if (!repo.isDirectory() || repo.name.startsWith(".")) continue;
      const repoPath = path.join(projectPath, repo.name);
      if (fs.existsSync(path.join(repoPath, ".git"))) out.push(repoPath);
    }
  }
  return out;
}

function removePath(target: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Safe Bridge disk GC:
 * - prompt temps under `{repo}/.agent-studio/prompt-*`
 * - terminal / orphan `docs/runs/{runId}` (and legacy `docs/dify-runs/{runId}`) dirs past retention
 * - optional prune of old terminal entries from runs.json
 *
 * Never deletes whole clones or non-`docs/(dify-)runs` source trees.
 */
export function runBridgeGc(opts: GcOptions): GcResult {
  const now = opts.now ?? Date.now();
  const reposRoot = path.resolve(opts.reposRoot || bridgeReposRoot());
  const dataDir = path.resolve(opts.dataDir || bridgeDataDir());
  const protectedIds = new Set(
    [...(opts.protectedRunIds || [])].map((id) => String(id).trim()).filter(Boolean),
  );

  const runs = loadRuns(dataDir);
  for (const [id, run] of Object.entries(runs)) {
    if (!isTerminalStatus(run.status)) protectedIds.add(id);
  }

  const deleted: GcDeleted[] = [];
  const skipped: GcSkipped[] = [];
  const prunedRunIds: string[] = [];

  for (const repoPath of listRepoRoots(reposRoot)) {
    const promptDir = path.join(repoPath, ".agent-studio");
    if (fs.existsSync(promptDir)) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(promptDir);
      } catch {
        files = [];
      }
      for (const name of files) {
        if (!/^prompt-/i.test(name)) continue;
        const full = path.join(promptDir, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const age = now - st.mtimeMs;
        if (age < opts.promptMaxAgeMs) {
          skipped.push({ path: full, reason: "prompt_too_new" });
          continue;
        }
        deleted.push({
          path: full,
          kind: "prompt",
          bytes: st.size,
        });
        removePath(full, opts.dryRun);
      }
    }

    const branch = currentBranch(repoPath);
    // Prefer docs/runs; also GC legacy docs/dify-runs.
    for (const dirName of RUN_ARTIFACT_DIR_NAMES) {
      const runsDir = path.join(repoPath, "docs", dirName);
      if (!fs.existsSync(runsDir)) continue;
      let runDirs: fs.Dirent[] = [];
      try {
        runDirs = fs.readdirSync(runsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of runDirs) {
        if (!ent.isDirectory()) continue;
        const runId = ent.name;
        const full = path.join(runsDir, runId);
        if (protectedIds.has(runId)) {
          skipped.push({ path: full, reason: "run_active_or_non_terminal" });
          continue;
        }
        if (branch === `studio/dev/${runId}`) {
          skipped.push({ path: full, reason: "checked_out_feature_branch" });
          continue;
        }

        const record = runs[runId] as RunRecord | undefined;
        const age = now - mtimeMs(full);
        const terminal = record ? isTerminalStatus(record.status) : false;
        const orphan = !record;

        if (!terminal && !orphan) {
          skipped.push({ path: full, reason: "unknown_non_terminal" });
          continue;
        }
        if (age < opts.artifactMaxAgeMs) {
          skipped.push({
            path: full,
            reason: orphan ? "orphan_too_new" : "artifact_too_new",
          });
          continue;
        }

        const bytes = dirBytes(full);
        deleted.push({
          path: full,
          kind: "artifact_dir",
          bytes,
          runId,
        });
        removePath(full, opts.dryRun);
      }
    }
  }

  const nextRuns: Record<string, RunRecord> = { ...runs };
  let runsChanged = false;
  for (const [id, run] of Object.entries(runs)) {
    if (protectedIds.has(id)) continue;
    if (!isTerminalStatus(run.status)) continue;
    const updated = Date.parse(run.updatedAt || run.createdAt || "");
    const stamp = Number.isFinite(updated) ? updated : 0;
    if (now - stamp < opts.runsJsonMaxAgeMs) continue;
    prunedRunIds.push(id);
    deleted.push({
      path: runsFileIn(dataDir),
      kind: "runs_json_entry",
      bytes: 0,
      runId: id,
    });
    delete nextRuns[id];
    runsChanged = true;
  }
  if (runsChanged && !opts.dryRun) {
    saveRuns(dataDir, nextRuns);
  }

  const bytesFreed = deleted.reduce((sum, d) => sum + d.bytes, 0);
  return {
    dryRun: opts.dryRun,
    reposRoot,
    dataDir,
    deleted,
    skipped,
    prunedRunIds,
    bytesFreed,
  };
}
