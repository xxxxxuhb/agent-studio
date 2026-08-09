import type { AgentsConfig, Stage } from "./types.js";

export function buildStagePrompt(opts: {
  stage: Stage;
  config: AgentsConfig;
  agentsBody: string;
  runId: string;
  rawRequirement: string;
  feedback?: string;
  artifactPaths: Record<string, string>;
}): string {
  const {
    stage,
    config,
    agentsBody,
    runId,
    rawRequirement,
    feedback = "",
    artifactPaths,
  } = opts;

  const common = `
You are the "${stage}" agent in a multi-agent delivery pipeline.
Manager is the global orchestrator; you must stay in role.

Project: ${config.project.name}
Repo: ${config.project.repo_path}
Run ID: ${runId}
Release target: ${config.release.target}
Production: ${config.release.production}

AGENTS.md body:
---
${agentsBody.trim()}
---

Artifact paths (write/update these files as required):
${Object.entries(artifactPaths)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Commands from config:
- install: ${config.commands.install || "(empty)"}
- test: ${config.commands.test || "(empty)"}
- lint: ${config.commands.lint || "(empty)"}
- deploy_staging: ${config.commands.deploy_staging || "(empty)"}
- smoke_staging: ${config.commands.smoke_staging || "(empty)"}

Forbidden paths: ${(config.constraints.forbidden_paths || []).join(", ") || "(none)"}

Raw requirement:
${rawRequirement}

Human feedback (may be empty):
${feedback || "(none)"}
`.trim();

  const byStage: Record<Stage, string> = {
    manager: `
${common}

Manager tasks:
1. Ensure run directories exist.
2. Update run-status.md with current stage, next action, risks.
3. The Bridge already selected this repository for the requirement — stay in this repo; do not redirect work to another repo's docs or code.
4. Do NOT modify business source code.
5. Return a short global status summary.
`,
    requirement: `
${common}

Requirement agent tasks:
1. Clarify and structure the requirement for THIS repository (already selected by Bridge routing).
2. Write a complete requirement.md at the configured path.
3. If the requirement clearly belongs here, implementable acceptance criteria must target this repo's code.
4. List open questions if any.
5. Do NOT modify business source code.
`,
    plan: `
${common}

Plan agent tasks:
1. Read requirement.md and inspect the repository structure.
2. Write plan.md with: goals, technical approach, task breakdown, acceptance criteria, risks.
3. Respect tech stack in AGENTS.md.
4. Do NOT implement code changes yet.
`,
    dev: `
${common}

Dev agent tasks:
1. Bridge has already checked out feature branch studio/dev/${runId} (or equivalent). Stay on that branch — do NOT work on main/master.
2. Read plan.md (and requirement.md if needed) and implement the approved plan in this local repo.
3. Respect forbidden_paths and AGENTS.md conventions.
4. Provisioning / seed assets ("灌流") — keep full baseline and versioned increments in SEPARATE folders. Default layout (override only if AGENTS.md already defines one):
   - 灌流/sql/full/            → system-wide full SQL (single maintainable baseline set)
   - 灌流/sql/incremental/     → versioned delta SQL (e.g. V20260809_01_add_login.sql)
   - 灌流/config/full/         → full config baselines
   - 灌流/config/incremental/  → versioned config deltas
   - Same pattern for other seedable content: 灌流/<type>/full|incremental (dicts, menus, permissions, …)
   Prefer appending incremental files for schema/config changes; update full/ only when refreshing a rebuildable baseline, and note why in dev-summary.
5. Write/update dev-summary.md with: current branch name, changed files (incl. 灌流 paths), how to verify, residual risks.
6. Prefer small, reviewable changes. Do NOT deploy.
7. Do NOT git commit or git push. Commit/push is done by the code_review agent only when the review passes.
`,
    review: `
${common}

Code-review agent tasks:
1. Confirm work is on a feature/dev branch (not main/master). Inspect the working tree / diff vs the default branch.
2. Write review-report.md at the configured path with: findings (blocker / major / nit), verdict (pass or reject), and commit guidance.
3. Do NOT modify business source code. Fixes belong in a later /dev loop.
4. If there is any blocker (count > 0) → verdict reject, and do NOT git commit or push. Say clearly that commit is forbidden because of blockers (avoid bare "禁止 commit" in unrelated prose about the earlier dev stage).
5. If pass (blocker = 0) → YOU must git add / commit / push on the current feature branch (never main/master). Prefer conventional subjects that mention the run id: feat: … (${runId}).
   Use the Bridge-provided git identity (GIT_AUTHOR_* / GIT_COMMITTER_* already in the environment). Do NOT override with a personal name/email.
   Prefer pushing via origin (SSH is configured by Bridge when enabled).
6. After a successful commit+push, write docs/dify-runs/${runId}/commit-record.md with fields: run_id, committed, sha, branch, pushed, pr_url (- for now), message, note.
   Prefer list style (- key: value) so Bridge can parse it; a markdown table is also accepted.
7. Do NOT open a merge PR/MR — Bridge opens the MR after reading commit-record.md.
`,
    test: `
${common}

Test agent tasks:
1. Run configured test/lint commands when present.
2. Write test-report.md with commands, results, failures, recommendations.
3. Do not do large unrelated refactors. If code must change for a tiny fix, keep it minimal and document it.
`,
    release_test: `
${common}

Release-test agent tasks:
1. Production release is DISABLED. Only staging/test deploy is allowed.
2. Run deploy_staging and smoke_staging when configured.
3. Write release-notes-test.md with steps, results, rollback notes.
4. If commands are empty, produce a manual checklist instead of inventing production deploys.
`,
  };

  return byStage[stage].trim();
}
