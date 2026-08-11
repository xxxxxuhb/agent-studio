import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createBridgeApp } from "./server.js";
import {
  bridgeReposRoot,
  ensureWorkspaceOnBridge,
  resolveBridgeRepoPath,
} from "./workspaceEnsure.js";

describe("workspace ensure", () => {
  const prevRepos = process.env.BRIDGE_REPOS_DIR;
  let tmpRoot = "";
  let remoteBare = "";

  before(() => {
    tmpRoot = fs.mkdtempSync(
      path.join(path.resolve(import.meta.dirname, ".."), ".tmp-ws-"),
    );
    process.env.BRIDGE_REPOS_DIR = path.join(tmpRoot, "repos");
    remoteBare = path.join(tmpRoot, "remote.git");
    execFileSync("git", ["init", "--bare", remoteBare], { stdio: "ignore" });

    const seed = path.join(tmpRoot, "seed");
    fs.mkdirSync(seed, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: seed, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: seed,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: seed,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(seed, "README.md"), "# seed\n");
    execFileSync("git", ["add", "."], { cwd: seed, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: seed,
      stdio: "ignore",
    });
    execFileSync("git", ["remote", "add", "origin", remoteBare], {
      cwd: seed,
      stdio: "ignore",
    });
    execFileSync("git", ["push", "-u", "origin", "HEAD:main"], {
      cwd: seed,
      stdio: "ignore",
    });
  });

  after(() => {
    if (prevRepos === undefined) delete process.env.BRIDGE_REPOS_DIR;
    else process.env.BRIDGE_REPOS_DIR = prevRepos;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("bridgeReposRoot respects BRIDGE_REPOS_DIR", () => {
    assert.equal(bridgeReposRoot(), path.resolve(process.env.BRIDGE_REPOS_DIR!));
  });

  it("clones under project/repo and writes AGENTS.md", async () => {
    const result = await ensureWorkspaceOnBridge({
      project_id: "proj-a",
      project_name: "Demo",
      repos: [
        {
          id: "backend",
          remote_url: remoteBare,
          name: "backend",
          role: "backend",
          default_branch: "main",
        },
      ],
    });
    assert.equal(result.repos.length, 1);
    const repo = result.repos[0]!;
    assert.equal(repo.clone_status, "ready");
    assert.equal(repo.local_path, resolveBridgeRepoPath("proj-a", "backend"));
    assert.ok(fs.existsSync(path.join(repo.local_path, ".git")));
    assert.ok(fs.existsSync(repo.agents_md_path));
    const md = fs.readFileSync(repo.agents_md_path, "utf8");
    assert.match(md, new RegExp(`repo_path:\\s*${repo.local_path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("POST /workspace/ensure requires auth and returns bridge paths", async () => {
    process.env.BRIDGE_HTTP_TOKEN = "ws-test-token";
    const app = createBridgeApp();
    await app.ready();
    try {
      const denied = await app.inject({
        method: "POST",
        url: "/workspace/ensure",
        payload: {
          project_id: "proj-b",
          repos: [{ id: "r1", remote_url: remoteBare }],
        },
      });
      assert.equal(denied.statusCode, 401);

      const ok = await app.inject({
        method: "POST",
        url: "/workspace/ensure",
        headers: { authorization: "Bearer ws-test-token" },
        payload: {
          project_id: "proj-b",
          repos: [{ id: "r1", remote_url: remoteBare, name: "r1" }],
        },
      });
      assert.equal(ok.statusCode, 200);
      const body = ok.json() as {
        repos: Array<{ clone_status: string; local_path: string }>;
      };
      assert.equal(body.repos[0]?.clone_status, "ready");
      assert.ok(body.repos[0]?.local_path.includes(`${path.sep}proj-b${path.sep}r1`));
    } finally {
      await app.close();
      delete process.env.BRIDGE_HTTP_TOKEN;
    }
  });
});
