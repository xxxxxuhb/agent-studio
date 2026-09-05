import fs from "node:fs";
import path from "node:path";
import { resolveBridgeRepoLocalPath } from "./workspaceEnsure.js";

export const MAX_WORKSPACE_FILE_BYTES = 1 * 1024 * 1024;
const MAX_DIR_ENTRIES = 500;
const BINARY_SCAN_BYTES = 8000;

export const WORKSPACE_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  ".cache",
  "build",
  "out",
]);

export type WorkspaceTreeEntry = {
  name: string;
  type: "dir" | "file";
  bytes?: number;
  updated_at?: string;
};

export type WorkspaceTreeResult = {
  project_id: string;
  repo_id: string;
  path: string;
  entries: WorkspaceTreeEntry[];
};

export type WorkspaceFileResult = {
  project_id: string;
  repo_id: string;
  path: string;
  name: string;
  bytes: number;
  updated_at: string;
  content_type: string;
  content?: string;
  binary?: boolean;
  truncated?: boolean;
};

export type WorkspaceBrowseQuery = {
  project_id: string;
  repo_id: string;
  path?: string;
  local_path?: string;
};

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Normalize a repo-relative path; empty means the repo root. Always posix. */
export function normalizeRelPath(raw: string | undefined): string {
  const s = String(raw || "").trim().replace(/\\/g, "/");
  if (!s || s === ".") return "";
  if (s.includes("\0")) throw httpError(400, "invalid path");
  if (path.isAbsolute(s) || s.startsWith("/")) {
    throw httpError(400, "path must be relative to the repo root");
  }
  const parts: string[] = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw httpError(400, "path must not contain '..'");
    }
    parts.push(part);
  }
  for (const part of parts) {
    if (WORKSPACE_SKIP_DIRS.has(part)) {
      throw httpError(400, `path is inside ignored directory: ${part}`);
    }
  }
  return parts.join("/");
}

export function resolveBrowseRoot(input: {
  project_id: string;
  repo_id: string;
  local_path?: string;
}): string {
  const projectId = (input.project_id || "").trim();
  const repoId = (input.repo_id || "").trim();
  if (!projectId) throw httpError(400, "project_id is required");
  if (!repoId) throw httpError(400, "repo_id is required");
  return resolveBridgeRepoLocalPath(projectId, {
    id: repoId,
    local_path: (input.local_path || "").trim(),
  });
}

function isUnderRoot(root: string, candidate: string): boolean {
  if (root === candidate) return true;
  const rel = path.relative(root, candidate);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveUnderRoot(root: string, relPath: string): string {
  const full = relPath ? path.resolve(root, relPath) : path.resolve(root);
  if (!isUnderRoot(root, full)) {
    throw httpError(400, "path escapes repo root");
  }
  return full;
}

function requireExistingRoot(root: string): void {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw httpError(
      404,
      "workspace not found (run POST /workspace/ensure first)",
    );
  }
}

function isBinaryBuffer(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SCAN_BYTES);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
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
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return "text/typescript; charset=utf-8";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html; charset=utf-8";
  }
  if (lower.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function listWorkspaceTree(
  query: WorkspaceBrowseQuery,
): WorkspaceTreeResult {
  const project_id = (query.project_id || "").trim();
  const repo_id = (query.repo_id || "").trim();
  const rel = normalizeRelPath(query.path);
  const root = resolveBrowseRoot({
    project_id,
    repo_id,
    local_path: query.local_path,
  });
  requireExistingRoot(root);
  const dir = resolveUnderRoot(root, rel);
  if (!fs.existsSync(dir)) {
    throw httpError(404, `path not found: ${rel || "."}`);
  }
  const st = fs.statSync(dir);
  if (!st.isDirectory()) {
    throw httpError(400, "path is not a directory");
  }

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw httpError(404, `path not found: ${rel || "."}`);
  }

  const entries: WorkspaceTreeEntry[] = [];
  for (const ent of dirents) {
    if (entries.length >= MAX_DIR_ENTRIES) break;
    if (ent.isDirectory() && WORKSPACE_SKIP_DIRS.has(ent.name)) continue;
    if (ent.name === "." || ent.name === "..") continue;
    const full = path.join(dir, ent.name);
    if (!isUnderRoot(root, full)) continue;
    try {
      const info = fs.statSync(full);
      if (ent.isDirectory() || info.isDirectory()) {
        entries.push({
          name: ent.name,
          type: "dir",
          updated_at: info.mtime.toISOString(),
        });
      } else if (ent.isFile() || info.isFile()) {
        entries.push({
          name: ent.name,
          type: "file",
          bytes: info.size,
          updated_at: info.mtime.toISOString(),
        });
      }
    } catch {
      /* skip unreadable */
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { project_id, repo_id, path: rel, entries };
}

export function readWorkspaceFile(
  query: WorkspaceBrowseQuery,
): WorkspaceFileResult {
  const project_id = (query.project_id || "").trim();
  const repo_id = (query.repo_id || "").trim();
  const rel = normalizeRelPath(query.path);
  if (!rel) throw httpError(400, "file path is required");
  const root = resolveBrowseRoot({
    project_id,
    repo_id,
    local_path: query.local_path,
  });
  requireExistingRoot(root);
  const full = resolveUnderRoot(root, rel);
  if (!fs.existsSync(full)) {
    throw httpError(404, `file not found: ${rel}`);
  }
  const st = fs.statSync(full);
  if (!st.isFile()) {
    throw httpError(400, "path is not a file");
  }
  const name = path.basename(full);
  const base: Omit<WorkspaceFileResult, "content" | "binary" | "truncated"> = {
    project_id,
    repo_id,
    path: rel,
    name,
    bytes: st.size,
    updated_at: st.mtime.toISOString(),
    content_type: contentTypeForName(name),
  };

  if (st.size > MAX_WORKSPACE_FILE_BYTES) {
    return { ...base, truncated: true };
  }

  const buf = fs.readFileSync(full);
  if (isBinaryBuffer(buf)) {
    return { ...base, binary: true };
  }
  return { ...base, content: buf.toString("utf8") };
}
