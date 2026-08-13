import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function envFlag(name: string, defaultTrue = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultTrue;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function expandHome(p: string): string {
  if (!p) return p;
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}

/**
 * Convert http(s) git remotes to SSH.
 * Self-hosted GitLab often maps SSH to a non-22 port — set BRIDGE_GIT_SSH_PORT.
 */
export function preferSshGitUrl(
  remoteUrl: string,
  opts?: { sshPort?: number; sshUser?: string },
): string {
  const raw = (remoteUrl || "").trim();
  if (!raw) return raw;
  if (/^git@/i.test(raw) || /^ssh:\/\//i.test(raw)) return raw;

  const http = raw.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!http) return raw;

  const hostPort = http[1];
  const projectPath = http[2].replace(/^\/+/, "").replace(/\.git$/i, "");
  const host = hostPort.replace(/:\d+$/, "");
  const sshUser = (opts?.sshUser || process.env.BRIDGE_GIT_SSH_USER || "git").trim();
  const portRaw =
    opts?.sshPort ??
    Number(process.env.BRIDGE_GIT_SSH_PORT || process.env.STUDIO_GIT_SSH_PORT || 0);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 0;

  // Self-hosted HTTP may use a custom port while SSH uses another — set BRIDGE_GIT_SSH_PORT.
  if (port && port !== 22) {
    return `ssh://${sshUser}@${host}:${port}/${projectPath}.git`;
  }
  return `${sshUser}@${host}:${projectPath}.git`;
}

export function preferSshEnabled(): boolean {
  if (
    envFlag("BRIDGE_GIT_PREFER_SSH", false) ||
    envFlag("STUDIO_GIT_PREFER_SSH", false)
  ) {
    return true;
  }
  // Auto-enable when a bot SSH private key is configured and present.
  const keyPath = expandHome(
    (process.env.BRIDGE_GIT_SSH_KEY || process.env.GIT_SSH_KEY || "").trim(),
  );
  return Boolean(keyPath && fs.existsSync(keyPath));
}

/** Build env overrides for git commit identity + SSH key. */
export function buildGitBotEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  const name = (
    env.BRIDGE_GIT_AUTHOR_NAME ||
    env.GIT_AUTHOR_NAME ||
    "agent-studio-bot"
  ).trim();
  const email = (
    env.BRIDGE_GIT_AUTHOR_EMAIL ||
    env.GIT_AUTHOR_EMAIL ||
    "bot@agent-studio.local"
  ).trim();

  if (envFlag("BRIDGE_GIT_FORCE_AUTHOR", true)) {
    env.GIT_AUTHOR_NAME = name;
    env.GIT_AUTHOR_EMAIL = email;
    env.GIT_COMMITTER_NAME = name;
    env.GIT_COMMITTER_EMAIL = email;
  }

  const keyPath = expandHome(
    (env.BRIDGE_GIT_SSH_KEY || env.GIT_SSH_KEY || "").trim(),
  );
  if (keyPath && fs.existsSync(keyPath)) {
    // Non-22 SSH ports belong in the remote URL (ssh://git@host:PORT/...),
    // not here — git already passes -p from ssh:// URLs.
    env.GIT_SSH_COMMAND = [
      "ssh",
      "-i",
      keyPath,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
    ].join(" ");
  }

  return env;
}

/** Apply bot identity + SSH into process.env (Bridge child agents inherit this). */
export function applyBridgeGitIdentity(): {
  author: string;
  ssh: boolean;
  preferSsh: boolean;
} {
  const next = buildGitBotEnv(process.env);
  for (const key of [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_SSH_COMMAND",
  ] as const) {
    if (next[key]) process.env[key] = next[key];
  }
  return {
    author: `${process.env.GIT_AUTHOR_NAME || ""} <${process.env.GIT_AUTHOR_EMAIL || ""}>`,
    ssh: Boolean(process.env.GIT_SSH_COMMAND),
    preferSsh: preferSshEnabled(),
  };
}

function git(
  repoPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: env || buildGitBotEnv(),
  }).trim();
}

/**
 * Ensure origin uses SSH when BRIDGE_GIT_PREFER_SSH/STUDIO_GIT_PREFER_SSH is on.
 */
export function ensureOriginSsh(repoPath: string): { changed: boolean; url: string; note: string } {
  const resolved = path.resolve(repoPath);
  if (!preferSshEnabled()) {
    let url = "";
    try {
      url = git(resolved, ["remote", "get-url", "origin"]);
    } catch {
      /* ignore */
    }
    return { changed: false, url, note: "SSH prefer disabled" };
  }
  let current = "";
  try {
    current = git(resolved, ["remote", "get-url", "origin"]);
  } catch (e) {
    return {
      changed: false,
      url: "",
      note: `no origin: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const next = preferSshGitUrl(current);
  if (!next || next === current) {
    return { changed: false, url: current, note: `origin already ${current}` };
  }
  try {
    git(resolved, ["remote", "set-url", "origin", next]);
    return { changed: true, url: next, note: `origin ${current} → ${next}` };
  } catch (e) {
    return {
      changed: false,
      url: current,
      note: `set-url failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
