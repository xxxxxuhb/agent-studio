import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildGitBotEnv } from "./gitIdentity.js";

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: buildGitBotEnv(),
  }).trim();
}

function gitOk(repoPath: string, args: string[]): boolean {
  try {
    git(repoPath, args);
    return true;
  } catch {
    return false;
  }
}

export type ReviewCommitResult = {
  committed: boolean;
  sha?: string;
  branch?: string;
  pushed?: boolean;
  prUrl?: string;
  message?: string;
  note: string;
};

export type DevBranchResult = {
  branch: string;
  created: boolean;
  note: string;
};

type RemoteInfo = {
  kind: "github" | "gitlab" | "unknown";
  apiBase: string;
  /** owner/repo or group/repo without .git */
  projectPath: string;
  webBase: string;
};

export function featureBranchName(runId: string): string {
  return `studio/dev/${runId}`;
}

/**
 * Ensure we are on a feature branch before the dev agent edits code.
 * Never leave the agent on main/master for implementation work.
 */
export function ensureDevBranch(opts: {
  repoPath: string;
  runId: string;
  defaultBranch?: string;
}): DevBranchResult {
  const repoPath = path.resolve(opts.repoPath);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return {
      branch: "",
      created: false,
      note: `not a git repo: ${repoPath}`,
    };
  }

  const defaultBranch = (opts.defaultBranch || "main").trim() || "main";
  const feature = featureBranchName(opts.runId);

  let current = "";
  try {
    current = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch (e) {
    return {
      branch: "",
      created: false,
      note: `git branch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (current === feature) {
    return {
      branch: feature,
      created: false,
      note: `already on ${feature}`,
    };
  }

  // Prefer creating from default branch tip when currently on default / detached.
  if (current === defaultBranch || current === "HEAD" || current === "master") {
    if (gitOk(repoPath, ["checkout", "-B", feature])) {
      return {
        branch: feature,
        created: true,
        note: `created/switched to ${feature} from ${current}`,
      };
    }
    return {
      branch: current,
      created: false,
      note: `failed to create ${feature} from ${current}`,
    };
  }

  // Already on some other feature branch: create/switch to run-scoped branch from here.
  if (gitOk(repoPath, ["checkout", "-B", feature])) {
    return {
      branch: feature,
      created: true,
      note: `created/switched to ${feature} (was ${current})`,
    };
  }
  return {
    branch: current,
    created: false,
    note: `failed to switch to ${feature}; stayed on ${current}`,
  };
}

export type CommitRecord = {
  runId?: string;
  committed: boolean;
  sha?: string;
  branch?: string;
  pushed?: boolean;
  prUrl?: string;
  message?: string;
  note?: string;
};

function fieldValue(text: string, key: string): string | undefined {
  // List style: `- committed: true`
  const list = text.match(new RegExp(`^-\\s*${key}:\\s*(.+)$`, "mi"));
  if (list?.[1]) return list[1].trim();
  // Markdown table style: `| committed | true |` or `| committed | true |`
  const table = text.match(
    new RegExp(`^\\|\\s*${key}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "mi"),
  );
  if (table?.[1]) return table[1].trim();
  return undefined;
}

function isTruthyField(value?: string): boolean {
  if (value == null) return false;
  const v = value.trim();
  if (!v || v === "-") return false;
  return !/^(false|no|0)$/i.test(v);
}

function cleanField(value?: string): string | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (!v || v === "-") return undefined;
  return v;
}

/** Parse docs/.../commit-record.md written by the review agent. */
export function parseCommitRecord(text: string): CommitRecord | null {
  if (!text?.trim()) return null;
  const committedRaw = fieldValue(text, "committed");
  const sha = cleanField(fieldValue(text, "sha"));
  if (committedRaw == null && !sha) return null;
  return {
    runId: cleanField(fieldValue(text, "run_id")),
    committed: isTruthyField(committedRaw),
    sha,
    branch: cleanField(fieldValue(text, "branch")),
    pushed: isTruthyField(fieldValue(text, "pushed")),
    prUrl: cleanField(fieldValue(text, "pr_url")),
    message: cleanField(fieldValue(text, "message")),
    note: cleanField(fieldValue(text, "note")),
  };
}

export function readCommitRecord(filePath: string): CommitRecord | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseCommitRecord(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Parse a git origin URL into forge API targets (used before opening MR/PR). */
export function parseOriginRemoteUrl(raw: string): RemoteInfo | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let host = "";
  let projectPath = "";
  const ssh = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
  const sshUrl = trimmed.match(
    /^ssh:\/\/([^@]+)@([^/:]+)(?::(\d+))?\/(.+?)(?:\.git)?$/i,
  );
  const http = trimmed.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (ssh) {
    host = ssh[1];
    projectPath = ssh[2].replace(/^\/+/, "");
  } else if (sshUrl) {
    host = sshUrl[2];
    projectPath = sshUrl[4].replace(/^\/+/, "");
  } else if (http) {
    host = http[1].replace(/:\d+$/, "");
    projectPath = http[2].replace(/^\/+/, "");
  } else {
    return {
      kind: "unknown",
      apiBase: "",
      projectPath: trimmed,
      webBase: "",
    };
  }

  const hostLower = host.toLowerCase();
  const isGithub =
    hostLower === "github.com" || hostLower.endsWith(".github.com");

  if (isGithub) {
    return {
      kind: "github",
      apiBase: "https://api.github.com",
      projectPath,
      webBase: `https://${host}`,
    };
  }

  // Prefer explicit API/web base (HTTP GitLab UI) when remotes are SSH-only.
  const apiBase =
    (process.env.BRIDGE_GITLAB_API || process.env.GITLAB_API || "").trim() ||
    `http://${host}/api/v4`;
  const webBase =
    (process.env.BRIDGE_GITLAB_WEB || "").trim() || `http://${host}`;
  return {
    kind: "gitlab",
    apiBase,
    projectPath,
    webBase,
  };
}

function parseOriginRemote(repoPath: string): RemoteInfo | null {
  let raw = "";
  try {
    raw = git(repoPath, ["remote", "get-url", "origin"]).trim();
  } catch {
    return null;
  }
  return parseOriginRemoteUrl(raw);
}

async function httpJson(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Open a merge PR/MR from feature branch → default branch after push.
 * Uses HTTP API + env tokens only (no gh/glab dependency).
 */
export async function createMergePr(opts: {
  repoPath: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<{ url?: string; note: string }> {
  const enabled =
    String(process.env.BRIDGE_GIT_CREATE_PR || "true")
      .trim()
      .toLowerCase() !== "false";
  if (!enabled) {
    return { note: "PR creation skipped (BRIDGE_GIT_CREATE_PR=false)" };
  }

  const repoPath = path.resolve(opts.repoPath);
  const base = opts.baseBranch || "main";
  const head = opts.branch;
  if (!head || head === base || head === "main" || head === "master") {
    return { note: `skip PR: invalid head=${head} base=${base}` };
  }

  const remote = parseOriginRemote(repoPath);
  if (!remote || remote.kind === "unknown" || !remote.projectPath) {
    return {
      note: "PR skipped: could not parse origin remote (set GITLAB_TOKEN or GITHUB_TOKEN)",
    };
  }

  if (remote.kind === "github") {
    const token = (
      process.env.BRIDGE_GITHUB_TOKEN ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      ""
    ).trim();
    if (!token) {
      return {
        note: "PR skipped: set GITHUB_TOKEN (or BRIDGE_GITHUB_TOKEN) in bridge .env",
      };
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "agent-studio-bridge",
    };
    const res = await httpJson(
      `${remote.apiBase}/repos/${remote.projectPath}/pulls`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: opts.title,
          head,
          base,
          body: opts.body,
          draft: false,
        }),
      },
    );
    if (res.ok && res.data && typeof res.data === "object") {
      const url = String((res.data as { html_url?: string }).html_url || "");
      return { url, note: `opened GitHub PR: ${url}` };
    }
    if (res.status === 422) {
      const owner = remote.projectPath.split("/")[0] || "";
      const list = await httpJson(
        `${remote.apiBase}/repos/${remote.projectPath}/pulls?head=${encodeURIComponent(
          `${owner}:${head}`,
        )}&state=open`,
        { method: "GET", headers },
      );
      if (Array.isArray(list.data) && list.data[0]) {
        const url = String(
          (list.data[0] as { html_url?: string }).html_url || "",
        );
        if (url) return { url, note: `existing GitHub PR: ${url}` };
      }
    }
    return {
      note: `GitHub PR failed: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`,
    };
  }

  // GitLab MR
  const token = (
    process.env.BRIDGE_GITLAB_TOKEN ||
    process.env.GITLAB_TOKEN ||
    process.env.PRIVATE_TOKEN ||
    ""
  ).trim();
  if (!token) {
    return {
      note: "PR/MR skipped: set GITLAB_TOKEN (or BRIDGE_GITLAB_TOKEN) in bridge .env",
    };
  }
  const projectId = encodeURIComponent(remote.projectPath);
  const headers = {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json",
  };
  const res = await httpJson(
    `${remote.apiBase}/projects/${projectId}/merge_requests`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_branch: head,
        target_branch: base,
        title: opts.title,
        description: opts.body,
        remove_source_branch: false,
      }),
    },
  );
  if (res.ok && res.data && typeof res.data === "object") {
    const url = String((res.data as { web_url?: string }).web_url || "");
    return { url, note: `opened GitLab MR: ${url}` };
  }
  if (res.status === 409 || res.status === 400) {
    const list = await httpJson(
      `${remote.apiBase}/projects/${projectId}/merge_requests?source_branch=${encodeURIComponent(
        head,
      )}&state=opened`,
      { method: "GET", headers: { "PRIVATE-TOKEN": token } },
    );
    if (Array.isArray(list.data) && list.data[0]) {
      const url = String((list.data[0] as { web_url?: string }).web_url || "");
      if (url) return { url, note: `existing GitLab MR: ${url}` };
    }
  }
  return {
    note: `GitLab MR failed: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`,
  };
}

/**
 * After review agent commits + pushes, Bridge only opens the merge PR/MR.
 * Commit/push are intentionally NOT done here (avoids brittle review-text heuristics).
 */
export async function ensureReviewMergeRequest(opts: {
  repoPath: string;
  runId: string;
  commitRecordPath: string;
  workOrderHint?: string;
  defaultBranch?: string;
  createPr?: boolean;
}): Promise<ReviewCommitResult> {
  const repoPath = path.resolve(opts.repoPath);
  const record = readCommitRecord(opts.commitRecordPath);
  if (!record?.committed || !record.sha || !record.branch) {
    return {
      committed: false,
      note: "no commit-record from review (expected commit+push on pass) — skipped MR",
    };
  }

  const defaultBranch = (opts.defaultBranch || "main").trim() || "main";
  const wantPr =
    opts.createPr ??
    String(process.env.BRIDGE_GIT_CREATE_PR || "true")
      .trim()
      .toLowerCase() !== "false";

  const base: ReviewCommitResult = {
    committed: true,
    sha: record.sha,
    branch: record.branch,
    pushed: !!record.pushed,
    message: record.message,
    prUrl: record.prUrl,
    note: record.pushed
      ? `committed ${record.sha} on ${record.branch} (by review) and pushed to origin`
      : `committed ${record.sha} on ${record.branch} (by review); push missing — skipped MR`,
  };

  if (!record.pushed) return base;
  if (record.prUrl) {
    return {
      ...base,
      note: `${base.note}; MR already recorded: ${record.prUrl} | pr: ${record.prUrl}`,
    };
  }
  if (!wantPr) {
    return {
      ...base,
      note: `${base.note} (PR skipped; BRIDGE_GIT_CREATE_PR=false)`,
    };
  }

  const title =
    opts.workOrderHint?.trim() ||
    record.message?.trim() ||
    `studio: merge ${record.branch} (run ${opts.runId})`;
  const pr = await createMergePr({
    repoPath,
    branch: record.branch,
    baseBranch: defaultBranch,
    title,
    body: [
      `Auto-opened by Agent Studio Bridge after code review committed + pushed.`,
      "",
      `- run_id: \`${opts.runId}\``,
      `- branch: \`${record.branch}\``,
      `- sha: \`${record.sha}\``,
      `- committed_by: review agent`,
    ].join("\n"),
  });
  const note = `${base.note}; ${pr.note}`;
  return {
    ...base,
    prUrl: pr.url,
    note: pr.url ? `${note} | pr: ${pr.url}` : note,
  };
}
