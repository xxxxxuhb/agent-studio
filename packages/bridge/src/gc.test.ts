import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runBridgeGc } from "./gc.js";

function touchOld(filePath: string, ageMs: number) {
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, when, when);
}

describe("runBridgeGc", () => {
  let root = "";
  let reposRoot = "";
  let dataDir = "";
  let repoPath = "";

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-gc-"));
    reposRoot = path.join(root, "repos");
    dataDir = path.join(root, "data");
    repoPath = path.join(reposRoot, "proj", "demo");
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], {
      cwd: repoPath,
      stdio: "ignore",
    });

    const promptDir = path.join(repoPath, ".agent-studio");
    fs.mkdirSync(promptDir, { recursive: true });
    const oldPrompt = path.join(promptDir, "prompt-old.txt");
    const newPrompt = path.join(promptDir, "prompt-new.txt");
    fs.writeFileSync(oldPrompt, "old");
    fs.writeFileSync(newPrompt, "new");
    touchOld(oldPrompt, 48 * 3600_000);

    const oldRun = path.join(repoPath, "docs", "runs", "oldrun");
    const liveRun = path.join(repoPath, "docs", "runs", "liverun");
    const legacyOrphan = path.join(repoPath, "docs", "dify-runs", "legorphan");
    fs.mkdirSync(oldRun, { recursive: true });
    fs.mkdirSync(liveRun, { recursive: true });
    fs.mkdirSync(legacyOrphan, { recursive: true });
    fs.writeFileSync(path.join(oldRun, "note.md"), "done");
    fs.writeFileSync(path.join(liveRun, "note.md"), "live");
    fs.writeFileSync(path.join(legacyOrphan, "note.md"), "legacy");
    touchOld(oldRun, 20 * 86_400_000);
    touchOld(path.join(oldRun, "note.md"), 20 * 86_400_000);
    touchOld(legacyOrphan, 20 * 86_400_000);
    touchOld(path.join(legacyOrphan, "note.md"), 20 * 86_400_000);

    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "runs.json"),
      JSON.stringify(
        {
          oldrun: {
            id: "oldrun",
            createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
            updatedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
            agentsMdPath: "x",
            repoPath,
            rawRequirement: "x",
            status: "completed",
            currentStage: "review",
            feedback: "",
            lastSummary: "ok",
            artifacts: {},
          },
          liverun: {
            id: "liverun",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            agentsMdPath: "x",
            repoPath,
            rawRequirement: "x",
            status: "review_pending_approval",
            currentStage: "review",
            feedback: "",
            lastSummary: "wait",
            artifacts: {},
          },
        },
        null,
        2,
      ),
    );
  });

  after(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("dry-run reports deletions without removing files", () => {
    const result = runBridgeGc({
      dryRun: true,
      promptMaxAgeMs: 24 * 3600_000,
      artifactMaxAgeMs: 14 * 86_400_000,
      runsJsonMaxAgeMs: 30 * 86_400_000,
      reposRoot,
      dataDir,
    });
    assert.equal(result.dryRun, true);
    assert.ok(result.deleted.some((d) => d.kind === "prompt"));
    assert.ok(result.deleted.some((d) => d.kind === "artifact_dir" && d.runId === "oldrun"));
    assert.ok(
      result.deleted.some((d) => d.kind === "artifact_dir" && d.runId === "legorphan"),
    );
    assert.ok(result.prunedRunIds.includes("oldrun"));
    assert.ok(
      fs.existsSync(path.join(repoPath, "docs", "runs", "oldrun")),
    );
    assert.ok(
      fs.existsSync(path.join(repoPath, "docs", "dify-runs", "legorphan")),
    );
    assert.ok(
      fs.existsSync(path.join(repoPath, ".agent-studio", "prompt-old.txt")),
    );
  });

  it("apply removes stale prompts/artifacts and prunes runs.json", () => {
    const result = runBridgeGc({
      dryRun: false,
      promptMaxAgeMs: 24 * 3600_000,
      artifactMaxAgeMs: 14 * 86_400_000,
      runsJsonMaxAgeMs: 30 * 86_400_000,
      reposRoot,
      dataDir,
    });
    assert.equal(result.dryRun, false);
    assert.equal(
      fs.existsSync(path.join(repoPath, ".agent-studio", "prompt-old.txt")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(repoPath, ".agent-studio", "prompt-new.txt")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(repoPath, "docs", "runs", "oldrun")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(repoPath, "docs", "dify-runs", "legorphan")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(repoPath, "docs", "runs", "liverun")),
      true,
    );
    const runs = JSON.parse(
      fs.readFileSync(path.join(dataDir, "runs.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal("oldrun" in runs, false);
    assert.equal("liverun" in runs, true);
  });
});
