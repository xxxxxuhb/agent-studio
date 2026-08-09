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

/** Convert http(s) remotes to SSH (shared with Bridge bot setup). */
export function preferSshGitUrl(remoteUrl: string): string {
  const raw = (remoteUrl || "").trim();
  if (!raw) return raw;
  if (/^git@/i.test(raw) || /^ssh:\/\//i.test(raw)) return raw;

  const http = raw.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!http) return raw;

  const hostPort = http[1];
  const projectPath = http[2].replace(/^\/+/, "").replace(/\.git$/i, "");
  const host = hostPort.replace(/:\d+$/, "");
  const sshUser = (
    process.env.STUDIO_GIT_SSH_USER ||
    process.env.BRIDGE_GIT_SSH_USER ||
    "git"
  ).trim();
  const port = Number(
    process.env.STUDIO_GIT_SSH_PORT || process.env.BRIDGE_GIT_SSH_PORT || 0,
  );

  if (Number.isFinite(port) && port > 0 && port !== 22) {
    return `ssh://${sshUser}@${host}:${port}/${projectPath}.git`;
  }
  return `${sshUser}@${host}:${projectPath}.git`;
}

export function studioPreferSsh(): boolean {
  if (envFlag("STUDIO_GIT_PREFER_SSH", false) || envFlag("BRIDGE_GIT_PREFER_SSH", false)) {
    return true;
  }
  const keyPath = expandHome(
    (
      process.env.STUDIO_GIT_SSH_KEY ||
      process.env.BRIDGE_GIT_SSH_KEY ||
      process.env.GIT_SSH_KEY ||
      ""
    ).trim(),
  );
  return Boolean(keyPath && fs.existsSync(keyPath));
}

export function studioGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const keyPath = expandHome(
    (
      env.STUDIO_GIT_SSH_KEY ||
      env.BRIDGE_GIT_SSH_KEY ||
      env.GIT_SSH_KEY ||
      ""
    ).trim(),
  );
  if (keyPath && fs.existsSync(keyPath)) {
    // Non-22 ports go in the remote URL (ssh://…:PORT/…); avoid duplicate -p here.
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

export function resolveCloneRemoteUrl(remoteUrl: string): string {
  return studioPreferSsh() ? preferSshGitUrl(remoteUrl) : remoteUrl;
}

/** Rewrite local origin to SSH when prefer-ssh is enabled. */
export function ensureLocalOriginSsh(repoPath: string): void {
  if (!studioPreferSsh()) return;
  if (!fs.existsSync(path.join(repoPath, ".git"))) return;
  try {
    const current = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
      encoding: "utf8",
      env: studioGitEnv(),
    }).trim();
    const next = preferSshGitUrl(current);
    if (next && next !== current) {
      execFileSync("git", ["remote", "set-url", "origin", next], {
        cwd: repoPath,
        env: studioGitEnv(),
      });
    }
  } catch {
    /* ignore */
  }
}
