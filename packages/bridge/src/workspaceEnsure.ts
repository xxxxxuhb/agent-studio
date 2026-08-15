import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildGitBotEnv,
  ensureOriginSsh,
  preferSshEnabled,
  preferSshGitUrl,
} from "./gitIdentity.js";

const execFileAsync = promisify(execFile);

export type WorkspaceEnsureRepoInput = {
  id: string;
  remote_url?: string;
  /** Absolute or project-relative path on the Bridge host; empty → default layout. */
  local_path?: string;
  name?: string;
  role?: string;
  default_branch?: string;
  note?: string;
  agents_md?: string;
};

export type WorkspaceEnsureRepoResult = {
  id: string;
  name: string;
  role: string;
  remote_url: string;
  local_path: string;
  agents_md_path: string;
  clone_status: "ready" | "error";
  clone_error: string;
  note?: string;
};

export type WorkspaceEnsureInput = {
  project_id: string;
  project_name?: string;
  repos: WorkspaceEnsureRepoInput[];
};

function expandHome(p: string): string {
  if (!p) return p;
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}

/** Clone root on the Bridge host (workspace ownership). */
export function bridgeReposRoot(): string {
  const raw = (process.env.BRIDGE_REPOS_DIR || "").trim();
  return path.resolve(expandHome(raw || "~/AgentStudio"));
}

export function resolveBridgeRepoPath(projectId: string, repoId: string): string {
  return path.join(bridgeReposRoot(), projectId, repoId);
}

/**
 * Prefer an explicit local_path (absolute or relative to project dir under repos root).
 * Empty → `{BRIDGE_REPOS_DIR}/{projectId}/{repoId}`.
 */
export function resolveBridgeRepoLocalPath(
  projectId: string,
  repo: Pick<WorkspaceEnsureRepoInput, "id" | "local_path">,
): string {
  const raw = expandHome((repo.local_path || "").trim());
  if (raw) {
    return path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.join(bridgeReposRoot(), projectId, raw);
  }
  return resolveBridgeRepoPath(projectId, repo.id);
}

function resolveCloneRemoteUrl(remoteUrl: string): string {
  return preferSshEnabled() ? preferSshGitUrl(remoteUrl) : remoteUrl;
}

function syncAgentsMdRepoPath(agentsMdPath: string, localRepoPath: string) {
  if (!fs.existsSync(agentsMdPath)) return;
  const raw = fs.readFileSync(agentsMdPath, "utf8");
  if (!/^repo_path:\s*.+$/m.test(raw)) return;
  const next = raw.replace(/^(\s*repo_path:\s*).+$/m, `$1${localRepoPath}`);
  if (next !== raw) {
    fs.writeFileSync(agentsMdPath, next, "utf8");
  }
}

function writeMinimalAgentsMd(opts: {
  agentsMdPath: string;
  projectId: string;
  projectName?: string;
  repo: WorkspaceEnsureRepoInput;
  local: string;
}) {
  const { agentsMdPath, projectId, projectName, repo, local } = opts;
  const content = `---
project:
  name: ${repo.name || repo.id}
  repo_path: ${local}
  default_branch: ${repo.default_branch || "main"}
  role: ${repo.role || "unknown"}

pipeline:
  runs_dir: docs/runs/{run_id}
  requirement_doc: docs/runs/{run_id}/requirement.md
  plan_doc: docs/runs/{run_id}/plan.md
  dev_summary: docs/runs/{run_id}/dev-summary.md
  review_doc: docs/runs/{run_id}/review-report.md
  test_report: docs/runs/{run_id}/test-report.md
  release_notes: docs/runs/{run_id}/release-notes-test.md
  status_doc: docs/runs/{run_id}/run-status.md

commands:
  install: ""
  test: ""
  lint: ""
  deploy_staging: ""
  smoke_staging: ""

release:
  target: staging
  production: disabled

constraints:
  require_human_approval_each_stage: true
  forbidden_paths:
    - .git/
---

# AGENTS

Auto-generated on Bridge for Studio project \`${projectId}\` / repo \`${repo.id}\`${
    projectName ? ` (${projectName})` : ""
  }.
`;
  fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
  fs.writeFileSync(agentsMdPath, content, "utf8");
}

function ensureAgentsMdForLocal(opts: {
  projectId: string;
  projectName?: string;
  repo: WorkspaceEnsureRepoInput;
  local: string;
}): string {
  const rel = ((opts.repo.agents_md || "").trim() || "AGENTS.md").replace(
    /^[/\\]+/,
    "",
  );
  const agentsMd = path.join(opts.local, rel);
  if (!fs.existsSync(agentsMd)) {
    writeMinimalAgentsMd({
      agentsMdPath: agentsMd,
      projectId: opts.projectId,
      projectName: opts.projectName,
      repo: opts.repo,
      local: opts.local,
    });
  } else {
    syncAgentsMdRepoPath(agentsMd, opts.local);
  }
  return agentsMd;
}

async function gitClone(
  cloneUrl: string,
  local: string,
  branch: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  try {
    await execFileAsync(
      "git",
      ["clone", "--branch", branch, "--single-branch", cloneUrl, local],
      { timeout: 180_000, env },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Remote branch|not found|did not match/i.test(msg)) {
      await execFileAsync("git", ["clone", cloneUrl, local], {
        timeout: 180_000,
        env,
      });
      return;
    }
    throw err;
  }
}

/** Best-effort fetch; never fails the ensure if fetch/pull fails. */
async function softFetch(local: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    await execFileAsync("git", ["fetch", "--all", "--prune"], {
      cwd: local,
      timeout: 120_000,
      env,
    });
    return "fetched";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `fetch skipped: ${msg.slice(0, 160)}`;
  }
}

async function ensureOneRepo(opts: {
  projectId: string;
  projectName?: string;
  repo: WorkspaceEnsureRepoInput;
}): Promise<WorkspaceEnsureRepoResult> {
  const { projectId, projectName, repo } = opts;
  const local = resolveBridgeRepoLocalPath(projectId, repo);
  const remote = (repo.remote_url || "").trim();
  const configuredLocal = (repo.local_path || "").trim();
  const base: WorkspaceEnsureRepoResult = {
    id: repo.id,
    name: repo.name || repo.id,
    role: repo.role || "unknown",
    remote_url: remote,
    local_path: local,
    agents_md_path: path.join(local, (repo.agents_md || "").trim() || "AGENTS.md"),
    clone_status: "error",
    clone_error: "",
    note: repo.note,
  };

  const env = buildGitBotEnv();
  try {
    if (fs.existsSync(local)) {
      if (!fs.existsSync(path.join(local, ".git"))) {
        return {
          ...base,
          clone_error: `路径已存在但不是 git 仓库: ${local}`,
        };
      }
      if (remote) ensureOriginSsh(local);
      const fetchNote = remote
        ? await softFetch(local, env)
        : "local checkout (no remote sync)";
      const agentsMd = ensureAgentsMdForLocal({
        projectId,
        projectName,
        repo,
        local,
      });
      return {
        ...base,
        agents_md_path: agentsMd,
        clone_status: "ready",
        clone_error: "",
        note: [repo.note, fetchNote, configuredLocal ? "reuse local_path" : ""]
          .filter(Boolean)
          .join("; "),
      };
    }

    if (!remote) {
      return {
        ...base,
        clone_error: configuredLocal
          ? `本地路径不存在: ${local}（请确认 Bridge 机器上已 clone）`
          : "缺少 remote_url，且未提供可用的 local_path",
      };
    }

    const branch = (repo.default_branch || "main").trim() || "main";
    const cloneUrl = resolveCloneRemoteUrl(remote);
    await gitClone(cloneUrl, local, branch, env);
    ensureOriginSsh(local);
    const agentsMd = ensureAgentsMdForLocal({
      projectId,
      projectName,
      repo,
      local,
    });
    return {
      ...base,
      agents_md_path: agentsMd,
      clone_status: "ready",
      clone_error: "",
      note: repo.note || "cloned",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, clone_status: "error", clone_error: msg };
  }
}

/**
 * Ensure project repos exist on the Bridge host under BRIDGE_REPOS_DIR.
 * Studio must use returned local_path / agents_md_path (not Studio-local paths).
 */
export async function ensureWorkspaceOnBridge(
  input: WorkspaceEnsureInput,
): Promise<{
  project_id: string;
  repos_root: string;
  repos: WorkspaceEnsureRepoResult[];
}> {
  const projectId = (input.project_id || "").trim();
  if (!projectId) {
    throw Object.assign(new Error("project_id is required"), { statusCode: 400 });
  }
  if (!input.repos?.length) {
    throw Object.assign(new Error("repos must be non-empty"), { statusCode: 400 });
  }

  const root = bridgeReposRoot();
  fs.mkdirSync(root, { recursive: true });

  const repos: WorkspaceEnsureRepoResult[] = [];
  for (const repo of input.repos) {
    repos.push(
      await ensureOneRepo({
        projectId,
        projectName: input.project_name,
        repo,
      }),
    );
  }

  return { project_id: projectId, repos_root: root, repos };
}
