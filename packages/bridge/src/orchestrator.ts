import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveAgentDriver } from "@agent-studio/agent-runtime";
import {
  assertProductionDisabled,
  loadAgentsConfig,
  readTextIfExists,
  resolveRunPath,
  writeStageArtifact,
  writeText,
} from "./config.js";
import { ensureDevBranch, ensureReviewMergeRequest } from "./git.js";
import { applyBridgeGitIdentity, ensureOriginSsh } from "./gitIdentity.js";
import { buildStagePrompt } from "./prompts.js";
import { resolveWorkspaceTarget } from "./workspaceRouter.js";
import type {
  AgentsConfig,
  RunRecord,
  RunStatus,
  Stage,
  StageResult,
} from "./types.js";

const DATA_DIR = path.resolve(
  process.env.BRIDGE_DATA_DIR || path.join(process.cwd(), "data", "bridge-runs"),
);

function runsFile(): string {
  return path.join(DATA_DIR, "runs.json");
}

function loadAll(): Record<string, RunRecord> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = runsFile();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, RunRecord>;
}

function saveAll(all: Record<string, RunRecord>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(runsFile(), JSON.stringify(all, null, 2));
}

function saveRun(run: RunRecord): void {
  const all = loadAll();
  all[run.id] = run;
  saveAll(all);
}

export function getRun(runId: string): RunRecord {
  const run = loadAll()[runId];
  if (!run) throw new Error(`run not found: ${runId}`);
  return run;
}

function artifactMap(config: AgentsConfig, runId: string): Record<string, string> {
  return {
    runs_dir: resolveRunPath(config.pipeline.runs_dir, runId, config.project.repo_path),
    requirement_doc: resolveRunPath(
      config.pipeline.requirement_doc,
      runId,
      config.project.repo_path,
    ),
    plan_doc: resolveRunPath(config.pipeline.plan_doc, runId, config.project.repo_path),
    dev_summary: resolveRunPath(
      config.pipeline.dev_summary,
      runId,
      config.project.repo_path,
    ),
    review_doc: resolveRunPath(
      config.pipeline.review_doc || "docs/dify-runs/{run_id}/review-report.md",
      runId,
      config.project.repo_path,
    ),
    test_report: resolveRunPath(
      config.pipeline.test_report,
      runId,
      config.project.repo_path,
    ),
    release_notes: resolveRunPath(
      config.pipeline.release_notes,
      runId,
      config.project.repo_path,
    ),
    status_doc: resolveRunPath(
      config.pipeline.status_doc,
      runId,
      config.project.repo_path,
    ),
  };
}

function pendingStatus(stage: Stage): RunStatus {
  switch (stage) {
    case "requirement":
      return "requirement_pending_approval";
    case "plan":
      return "plan_pending_approval";
    case "dev":
      return "dev_pending_approval";
    case "review":
      return "review_pending_approval";
    case "test":
      return "test_pending_approval";
    case "release_test":
      return "release_pending_approval";
    default:
      return "created";
  }
}

function primaryArtifact(stage: Stage, artifacts: Record<string, string>): string {
  switch (stage) {
    case "manager":
      return artifacts.status_doc;
    case "requirement":
      return artifacts.requirement_doc;
    case "plan":
      return artifacts.plan_doc;
    case "dev":
      return artifacts.dev_summary;
    case "review":
      return artifacts.review_doc;
    case "test":
      return artifacts.test_report;
    case "release_test":
      return artifacts.release_notes;
  }
}

export function createRun(input: {
  agentsMdPath?: string;
  rawRequirement: string;
  /** explicit = honor agentsMdPath; auto = may re-route by keywords */
  routingMode?: "auto" | "explicit";
}): RunRecord {
  const hint = (input.agentsMdPath || "").trim();
  let mode = input.routingMode || (hint && hint !== "auto" ? "explicit" : "auto");

  // Dify published workflows often omit routing_mode in the HTTP body.
  // If Studio already sent a real AGENTS.md path, never keyword-reroute away from it.
  if (hint && hint.toLowerCase() !== "auto") {
    const abs = path.resolve(hint);
    if (fs.existsSync(abs) && /agents\.md$/i.test(path.basename(abs))) {
      mode = "explicit";
    }
  }

  let agentsMdPath: string;
  let routing: RunRecord["routing"];

  if (mode === "explicit" && hint && hint.toLowerCase() !== "auto") {
    const { config, absolutePath } = loadAgentsConfig(hint);
    assertProductionDisabled(config);
    agentsMdPath = absolutePath;
    routing = {
      projectName: config.project.name,
      role: config.project.role || "unknown",
      score: 100,
      reasons: ["explicit path from Studio Manager"],
      candidates: [
        {
          projectName: config.project.name,
          role: config.project.role || "unknown",
          agentsMdPath: absolutePath,
          score: 100,
        },
      ],
    };
    return finishCreateRun({
      agentsMdPath,
      repoPath: config.project.repo_path,
      rawRequirement: input.rawRequirement,
      routing,
    });
  }

  const route = resolveWorkspaceTarget({
    rawRequirement: input.rawRequirement,
    agentsMdHint: input.agentsMdPath,
  });
  const { config, absolutePath } = loadAgentsConfig(route.agentsMdPath);
  assertProductionDisabled(config);
  return finishCreateRun({
    agentsMdPath: absolutePath,
    repoPath: config.project.repo_path,
    rawRequirement: input.rawRequirement,
    routing: {
      projectName: route.projectName,
      role: route.role,
      score: route.score,
      reasons: route.reasons,
      overriddenHint: route.overriddenHint,
      candidates: route.candidates,
    },
  });
}

function finishCreateRun(opts: {
  agentsMdPath: string;
  repoPath: string;
  rawRequirement: string;
  routing: RunRecord["routing"];
}): RunRecord {
  const { config, absolutePath } = loadAgentsConfig(opts.agentsMdPath);
  assertProductionDisabled(config);
  const id = randomUUID().slice(0, 8);
  const artifacts = artifactMap(config, id);
  fs.mkdirSync(artifacts.runs_dir, { recursive: true });

  const now = new Date().toISOString();
  const driver = resolveAgentDriver();
  const run: RunRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    agentsMdPath: absolutePath,
    repoPath: opts.repoPath || config.project.repo_path,
    rawRequirement: opts.rawRequirement,
    status: "created",
    currentStage: "manager",
    feedback: "",
    lastSummary: `run created → ${opts.routing?.projectName} · driver=${driver.id}`,
    artifacts,
    agentDriver: driver.id,
    routing: opts.routing,
  };

  writeText(
    artifacts.status_doc,
    [
      `# Run Status`,
      "",
      `- run_id: ${id}`,
      `- created_at: ${now}`,
      `- status: created`,
      `- current_stage: manager`,
      `- agent_driver: ${driver.id}`,
      `- requirement: ${opts.rawRequirement}`,
      `- routed_project: ${opts.routing?.projectName}`,
      `- routed_agents_md: ${absolutePath}`,
      "",
      `Next: run manager, then requirement with human approval gates.`,
      "",
    ].join("\n"),
  );

  saveRun(run);
  return run;
}

export async function executeStage(
  runId: string,
  stage: Stage,
  feedback = "",
): Promise<StageResult> {
  const run = getRun(runId);
  const { config, body } = loadAgentsConfig(run.agentsMdPath);
  assertProductionDisabled(config);

  if (feedback) run.feedback = feedback;
  run.currentStage = stage;
  run.updatedAt = new Date().toISOString();

  const artifacts = artifactMap(config, run.id);
  run.artifacts = artifacts;
  fs.mkdirSync(artifacts.runs_dir, { recursive: true });

  let branchNote = "";
  // Bot identity + SSH for any git ops the agent / Bridge performs in this repo.
  applyBridgeGitIdentity();
  const ssh = ensureOriginSsh(config.project.repo_path);
  if (ssh.changed) {
    branchNote = `[bridge] git remote: ${ssh.note}`;
  }

  if (stage === "dev") {
    const branch = ensureDevBranch({
      repoPath: config.project.repo_path,
      runId: run.id,
      defaultBranch: config.project.default_branch,
    });
    branchNote = branchNote
      ? `${branchNote}\n[bridge] git branch: ${branch.note}`
      : `[bridge] git branch: ${branch.note}`;
  }

  const prompt = buildStagePrompt({
    stage,
    config,
    agentsBody: body,
    runId: run.id,
    rawRequirement: run.rawRequirement,
    feedback: run.feedback,
    artifactPaths: artifacts,
  });

  const driver = resolveAgentDriver();
  run.agentDriver = driver.id;

  const result = await driver.run({
    stage,
    cwd: config.project.repo_path,
    prompt,
    meta: { runId: run.id, agentsMdPath: run.agentsMdPath },
  });

  const target = primaryArtifact(stage, artifacts);
  const existing = readTextIfExists(target);
  if (!existing.trim()) {
    writeStageArtifact(
      target,
      result.raw ||
        `# ${stage}\n\n${result.summary}\n\n(auto-written because agent did not create the file)\n`,
    );
  } else if (stage === "manager") {
    writeStageArtifact(
      target,
      [
        existing.trim(),
        "",
        `## Manager update (${new Date().toISOString()})`,
        "",
        result.summary,
        "",
      ].join("\n"),
    );
  }

  let summary = branchNote
    ? `${branchNote}\n\n${result.summary}`
    : result.summary;
  if (stage === "review") {
    // Review agent owns git commit/push + commit-record.md; Bridge only opens MR/PR.
    const commitRecord = resolveRunPath(
      "docs/dify-runs/{run_id}/commit-record.md",
      run.id,
      config.project.repo_path,
    );
    const merge = await ensureReviewMergeRequest({
      repoPath: config.project.repo_path,
      runId: run.id,
      commitRecordPath: commitRecord,
      defaultBranch: config.project.default_branch,
      workOrderHint: `review: pass and merge (bridge run ${run.id})`,
    });
    summary = `${summary}\n\n[bridge] git: ${merge.note}`;
    if (merge.committed && merge.sha) {
      const existingRecord = readTextIfExists(commitRecord).trim();
      writeStageArtifact(
        commitRecord,
        existingRecord
          ? [
              existingRecord,
              "",
              `## Bridge MR`,
              "",
              `- pr_url: ${merge.prUrl || "-"}`,
              `- note: ${merge.note}`,
              "",
            ].join("\n")
          : [
              `# Commit record`,
              "",
              `- run_id: ${run.id}`,
              `- committed: ${merge.committed}`,
              `- sha: ${merge.sha || "-"}`,
              `- branch: ${merge.branch || "-"}`,
              `- pushed: ${merge.pushed ?? false}`,
              `- pr_url: ${merge.prUrl || "-"}`,
              `- message: ${merge.message || "-"}`,
              `- note: ${merge.note}`,
              "",
            ].join("\n"),
      );
      const report = readTextIfExists(artifacts.review_doc);
      if (report.trim()) {
        writeStageArtifact(
          artifacts.review_doc,
          `${report.trim()}\n\n## Bridge MR\n\n- sha: \`${merge.sha}\`\n- branch: \`${merge.branch || "-"}\`\n- pushed: ${merge.pushed ?? false}\n- pr: ${merge.prUrl || "-"}\n- note: ${merge.note}\n`,
        );
      }
    }
  }

  run.lastSummary = summary;
  if (result.providerRunId) run.cursorAgentId = result.providerRunId;
  run.status = stage === "manager" ? "created" : pendingStatus(stage);
  run.updatedAt = new Date().toISOString();
  saveRun(run);

  return {
    runId: run.id,
    stage,
    status: "ok",
    summary,
    artifacts: Object.values(artifacts),
    pendingHumanApproval: stage !== "manager",
    raw: result.raw,
    driver: result.driver,
    dryRun: result.dryRun,
  };
}

export function approveStage(
  runId: string,
  decision: "approve" | "reject",
  feedback = "",
): RunRecord {
  const run = getRun(runId);
  run.updatedAt = new Date().toISOString();
  if (feedback) run.feedback = feedback;

  if (decision === "reject") {
    run.status = "rejected";
    run.lastSummary = `rejected at ${run.currentStage}: ${feedback || "no feedback"}`;
    saveRun(run);
    return run;
  }

  // Default full Bridge order. Dify may call a subset (e.g. code-dev ends at review).
  const order: Stage[] = [
    "requirement",
    "plan",
    "dev",
    "review",
    "test",
    "release_test",
  ];
  const idx = order.indexOf(run.currentStage as (typeof order)[number]);
  if (run.currentStage === "release_test") {
    run.status = "completed";
    run.lastSummary = "all stages approved";
  } else if (idx >= 0 && idx < order.length - 1) {
    run.status = "created";
    run.currentStage = order[idx + 1];
    run.lastSummary = `approved; next stage ${run.currentStage}`;
  } else {
    run.status = "created";
    run.lastSummary = "approved";
  }
  saveRun(run);
  return run;
}

export function listRuns(): RunRecord[] {
  return Object.values(loadAll()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}
