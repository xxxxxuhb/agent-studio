import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createBridgeApp } from "./server.js";
import {
  listWorkspaceTree,
  normalizeRelPath,
  readWorkspaceFile,
  resolveBrowseRoot,
} from "./workspaceBrowse.js";

describe("workspace browse", () => {
  const prevRepos = process.env.BRIDGE_REPOS_DIR;
  const prevToken = process.env.BRIDGE_HTTP_TOKEN;
  let tmpRoot = "";
  let repoRoot = "";

  before(() => {
    tmpRoot = fs.mkdtempSync(
      path.join(path.resolve(import.meta.dirname, ".."), ".tmp-ws-browse-"),
    );
    process.env.BRIDGE_REPOS_DIR = path.join(tmpRoot, "repos");
    repoRoot = path.join(process.env.BRIDGE_REPOS_DIR, "proj-a", "backend");
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# hello\n");
    fs.writeFileSync(path.join(repoRoot, "src", "index.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(repoRoot, "node_modules", "pkg", "index.js"), "module.exports=1;\n");
    fs.writeFileSync(path.join(repoRoot, ".git", "config"), "[core]\n");
    fs.writeFileSync(path.join(repoRoot, "dist", "out.js"), "1");
    fs.writeFileSync(path.join(repoRoot, "blob.bin"), Buffer.from([0, 1, 2, 3, 0]));
  });

  after(() => {
    if (prevRepos === undefined) delete process.env.BRIDGE_REPOS_DIR;
    else process.env.BRIDGE_REPOS_DIR = prevRepos;
    if (prevToken === undefined) delete process.env.BRIDGE_HTTP_TOKEN;
    else process.env.BRIDGE_HTTP_TOKEN = prevToken;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("normalizeRelPath rejects traversal and absolute paths", () => {
    assert.equal(normalizeRelPath(""), "");
    assert.equal(normalizeRelPath("src/index.ts"), "src/index.ts");
    assert.throws(() => normalizeRelPath("../secret"), /'\.\.'/);
    assert.throws(() => normalizeRelPath("/etc/passwd"), /relative/);
    assert.throws(() => normalizeRelPath("node_modules/pkg"), /ignored/);
  });

  it("resolveBrowseRoot uses default layout", () => {
    assert.equal(
      resolveBrowseRoot({ project_id: "proj-a", repo_id: "backend" }),
      repoRoot,
    );
  });

  it("lists one level and skips bulky dirs", () => {
    const tree = listWorkspaceTree({
      project_id: "proj-a",
      repo_id: "backend",
    });
    const names = tree.entries.map((e) => e.name);
    assert.ok(names.includes("README.md"));
    assert.ok(names.includes("src"));
    assert.ok(names.includes("blob.bin"));
    assert.ok(!names.includes("node_modules"));
    assert.ok(!names.includes(".git"));
    assert.ok(!names.includes("dist"));
    const src = tree.entries.find((e) => e.name === "src");
    assert.equal(src?.type, "dir");
    const readme = tree.entries.find((e) => e.name === "README.md");
    assert.equal(readme?.type, "file");
  });

  it("lists a nested directory", () => {
    const tree = listWorkspaceTree({
      project_id: "proj-a",
      repo_id: "backend",
      path: "src",
    });
    assert.equal(tree.path, "src");
    assert.deepEqual(
      tree.entries.map((e) => e.name),
      ["index.ts"],
    );
  });

  it("reads a text file", () => {
    const file = readWorkspaceFile({
      project_id: "proj-a",
      repo_id: "backend",
      path: "src/index.ts",
    });
    assert.equal(file.content, "export const n = 1;\n");
    assert.equal(file.binary, undefined);
    assert.match(file.content_type, /typescript|plain/);
  });

  it("returns binary metadata without content", () => {
    const file = readWorkspaceFile({
      project_id: "proj-a",
      repo_id: "backend",
      path: "blob.bin",
    });
    assert.equal(file.binary, true);
    assert.equal(file.content, undefined);
    assert.equal(file.bytes, 5);
  });

  it("404 when the workspace directory is missing", () => {
    assert.throws(
      () =>
        listWorkspaceTree({
          project_id: "missing",
          repo_id: "none",
        }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /workspace not found/);
        return true;
      },
    );
  });

  it("GET /workspace/tree and /file require auth and return relative paths", async () => {
    process.env.BRIDGE_HTTP_TOKEN = "browse-token";
    const app = createBridgeApp();
    await app.ready();
    try {
      const denied = await app.inject({
        method: "GET",
        url: "/workspace/tree?project_id=proj-a&repo_id=backend",
      });
      assert.equal(denied.statusCode, 400);

      const tree = await app.inject({
        method: "GET",
        url: "/workspace/tree?project_id=proj-a&repo_id=backend",
        headers: { authorization: "Bearer browse-token" },
      });
      assert.equal(tree.statusCode, 200);
      const body = tree.json() as {
        path: string;
        entries: Array<{ name: string; type: string }>;
      };
      assert.equal(body.path, "");
      assert.ok(body.entries.some((e) => e.name === "src"));
      assert.ok(!JSON.stringify(body).includes(tmpRoot));

      const escaped = await app.inject({
        method: "GET",
        url: "/workspace/file?project_id=proj-a&repo_id=backend&path=../secret",
        headers: { authorization: "Bearer browse-token" },
      });
      assert.equal(escaped.statusCode, 400);

      const file = await app.inject({
        method: "GET",
        url: "/workspace/file?project_id=proj-a&repo_id=backend&path=README.md",
        headers: { authorization: "Bearer browse-token" },
      });
      assert.equal(file.statusCode, 200);
      const fileBody = file.json() as { content?: string; path: string };
      assert.equal(fileBody.path, "README.md");
      assert.equal(fileBody.content, "# hello\n");
    } finally {
      await app.close();
    }
  });
});
