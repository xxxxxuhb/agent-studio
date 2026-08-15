import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  artifactRootForRun,
  listRunArtifacts,
  readRunArtifact,
  resolveSafeArtifactPath,
} from "./artifacts.js";
import { replaceAllRuns } from "./orchestrator.js";
import type { RunRecord } from "./types.js";

describe("run artifacts allowlist", () => {
  let root = "";
  let runsDir = "";
  const runId = "artrun1";

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-art-"));
    runsDir = path.join(root, "repo", "docs", "runs", runId);
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, "review-report.md"), "# review\nok\n");
    fs.writeFileSync(path.join(runsDir, "commit-record.md"), "- committed: true\n");
    fs.mkdirSync(path.join(root, "repo", "secret"), { recursive: true });
    fs.writeFileSync(path.join(root, "repo", "secret", "key.txt"), "nope");

    const run: RunRecord = {
      id: runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentsMdPath: path.join(root, "repo", "AGENTS.md"),
      repoPath: path.join(root, "repo"),
      rawRequirement: "x",
      status: "completed",
      currentStage: "review",
      feedback: "",
      lastSummary: "done",
      artifacts: {
        runs_dir: runsDir,
        review_doc: path.join(runsDir, "review-report.md"),
        status_doc: path.join(runsDir, "status.md"),
      },
    };
    replaceAllRuns({ [runId]: run });
  });

  after(() => {
    try {
      replaceAllRuns({});
    } catch {
      /* ignore */
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists only files under runs_dir", () => {
    const listed = listRunArtifacts(runId);
    assert.equal(listed.root, path.resolve(runsDir));
    assert.ok(listed.items.some((i) => i.name === "review-report.md"));
    assert.ok(listed.items.some((i) => i.name === "commit-record.md"));
    const review = listed.items.find((i) => i.name === "review-report.md");
    assert.equal(review?.role, "review_doc");
  });

  it("reads markdown body", () => {
    const body = readRunArtifact(runId, "review-report.md");
    assert.match(body.content, /# review/);
    assert.match(body.content_type, /markdown/);
  });

  it("rejects path traversal names", () => {
    const stub = {
      id: runId,
      createdAt: "",
      updatedAt: "",
      agentsMdPath: "",
      repoPath: path.join(root, "repo"),
      rawRequirement: "",
      status: "completed" as const,
      currentStage: "review" as const,
      feedback: "",
      lastSummary: "",
      artifacts: { runs_dir: runsDir },
    };
    assert.throws(() => resolveSafeArtifactPath(stub, "../secret/key.txt"));
    assert.throws(() => readRunArtifact(runId, "../secret/key.txt"));
    assert.throws(() => readRunArtifact(runId, "secret/key.txt"));
  });

  it("artifactRootForRun falls back to docs/runs/{id}", () => {
    const fallback = artifactRootForRun({
      id: "x",
      createdAt: "",
      updatedAt: "",
      agentsMdPath: "",
      repoPath: "/tmp/demo",
      rawRequirement: "",
      status: "completed",
      currentStage: "review",
      feedback: "",
      lastSummary: "",
      artifacts: {},
    });
    assert.equal(
      fallback,
      path.resolve("/tmp/demo", "docs", "runs", "x"),
    );
  });

  it("artifactRootForRun dual-reads legacy docs/dify-runs when new path missing", () => {
    const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-art-leg-"));
    try {
      const repo = path.join(legacyRoot, "repo");
      const legacy = path.join(repo, "docs", "dify-runs", "legacy1");
      fs.mkdirSync(legacy, { recursive: true });
      const resolved = artifactRootForRun({
        id: "legacy1",
        createdAt: "",
        updatedAt: "",
        agentsMdPath: "",
        repoPath: repo,
        rawRequirement: "",
        status: "completed",
        currentStage: "review",
        feedback: "",
        lastSummary: "",
        artifacts: {},
      });
      assert.equal(resolved, path.resolve(legacy));
    } finally {
      fs.rmSync(legacyRoot, { recursive: true, force: true });
    }
  });

  it("artifactRootForRun prefers docs/runs over legacy when both exist", () => {
    const bothRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-art-both-"));
    try {
      const repo = path.join(bothRoot, "repo");
      const preferred = path.join(repo, "docs", "runs", "both1");
      const legacy = path.join(repo, "docs", "dify-runs", "both1");
      fs.mkdirSync(preferred, { recursive: true });
      fs.mkdirSync(legacy, { recursive: true });
      const resolved = artifactRootForRun({
        id: "both1",
        createdAt: "",
        updatedAt: "",
        agentsMdPath: "",
        repoPath: repo,
        rawRequirement: "",
        status: "completed",
        currentStage: "review",
        feedback: "",
        lastSummary: "",
        artifacts: {},
      });
      assert.equal(resolved, path.resolve(preferred));
    } finally {
      fs.rmSync(bothRoot, { recursive: true, force: true });
    }
  });
});
