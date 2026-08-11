import fs from "node:fs";
import path from "node:path";
import { getRun } from "./orchestrator.js";
import type { RunRecord } from "./types.js";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export type RunArtifactListItem = {
  name: string;
  bytes: number;
  updated_at: string;
  /** Key from RunRecord.artifacts when matched (e.g. review_doc). */
  role?: string;
};

export type RunArtifactContent = {
  name: string;
  bytes: number;
  updated_at: string;
  content_type: string;
  content: string;
  role?: string;
};

function assertSafeArtifactName(name: string): string {
  const raw = String(name || "").trim();
  if (!raw) throw new Error("artifact name required");
  if (raw.includes("\0")) throw new Error("invalid artifact name");
  // Reject absolute / traversal / nested paths — basename only.
  if (raw !== path.basename(raw) || raw === "." || raw === "..") {
    throw new Error("artifact name must be a single file name (no path)");
  }
  if (!/^[a-zA-Z0-9._@+-]+$/.test(raw)) {
    throw new Error("artifact name has unsupported characters");
  }
  return raw;
}

/** Allowed root: registered runs_dir, else repo/docs/dify-runs/{runId}. */
export function artifactRootForRun(run: RunRecord): string {
  const fromMap = (run.artifacts?.runs_dir || "").trim();
  if (fromMap) return path.resolve(fromMap);
  const repo = (run.repoPath || "").trim();
  if (!repo) {
    throw new Error(`run ${run.id} has no repoPath / runs_dir for artifacts`);
  }
  return path.resolve(repo, "docs", "dify-runs", run.id);
}

function roleForPath(run: RunRecord, absFile: string): string | undefined {
  for (const [key, value] of Object.entries(run.artifacts || {})) {
    if (key === "runs_dir") continue;
    if (!value) continue;
    if (path.resolve(value) === absFile) return key;
  }
  return undefined;
}

function isUnderRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function resolveSafeArtifactPath(run: RunRecord, name: string): string {
  const safeName = assertSafeArtifactName(name);
  const root = artifactRootForRun(run);
  const full = path.resolve(root, safeName);
  if (!isUnderRoot(root, full) && full !== root) {
    throw new Error("artifact path escapes allowlisted runs dir");
  }
  // Prefer known registered file paths when they resolve to same basename under root.
  for (const value of Object.values(run.artifacts || {})) {
    if (!value || value === run.artifacts.runs_dir) continue;
    const abs = path.resolve(value);
    if (path.basename(abs) === safeName && isUnderRoot(root, abs)) {
      return abs;
    }
  }
  return full;
}

function contentTypeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown; charset=utf-8";
  }
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return "text/yaml; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

export function listRunArtifacts(runId: string): {
  run_id: string;
  root: string;
  items: RunArtifactListItem[];
} {
  const run = getRun(runId);
  const root = artifactRootForRun(run);
  const items: RunArtifactListItem[] = [];
  if (!fs.existsSync(root)) {
    return { run_id: runId, root, items };
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { run_id: runId, root, items };
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    try {
      assertSafeArtifactName(ent.name);
    } catch {
      continue;
    }
    const full = path.join(root, ent.name);
    try {
      const st = fs.statSync(full);
      items.push({
        name: ent.name,
        bytes: st.size,
        updated_at: st.mtime.toISOString(),
        role: roleForPath(run, path.resolve(full)),
      });
    } catch {
      /* skip */
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { run_id: runId, root, items };
}

export function readRunArtifact(
  runId: string,
  name: string,
): RunArtifactContent {
  const run = getRun(runId);
  const full = resolveSafeArtifactPath(run, name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`artifact not found: ${name}`);
  }
  const st = fs.statSync(full);
  if (st.size > MAX_ARTIFACT_BYTES) {
    throw new Error(
      `artifact too large (${st.size} bytes); max ${MAX_ARTIFACT_BYTES}`,
    );
  }
  const content = fs.readFileSync(full, "utf8");
  const safeName = path.basename(full);
  return {
    name: safeName,
    bytes: st.size,
    updated_at: st.mtime.toISOString(),
    content_type: contentTypeForName(safeName),
    content,
    role: roleForPath(run, path.resolve(full)),
  };
}
