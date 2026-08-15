import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors apps/studio-api/src/work-orders/studio-job.types.ts helpers. */
function orchestratorMode(
  env: NodeJS.ProcessEnv = process.env,
): "inline" | "worker" {
  const v = (env.STUDIO_ORCHESTRATOR_MODE || "inline").trim().toLowerCase();
  return v === "worker" ? "worker" : "inline";
}

function processRole(env: NodeJS.ProcessEnv = process.env): "api" | "worker" {
  const v = (env.STUDIO_PROCESS_ROLE || "api").trim().toLowerCase();
  return v === "worker" ? "worker" : "api";
}

function shouldRunStudioJobs(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = orchestratorMode(env);
  const role = processRole(env);
  if (mode === "worker") return role === "worker";
  return role === "api";
}

describe("studio job role / mode", () => {
  it("defaults to inline API runner", () => {
    const env = {} as NodeJS.ProcessEnv;
    assert.equal(orchestratorMode(env), "inline");
    assert.equal(processRole(env), "api");
    assert.equal(shouldRunStudioJobs(env), true);
  });

  it("worker mode: only worker process runs jobs", () => {
    assert.equal(
      shouldRunStudioJobs({
        STUDIO_ORCHESTRATOR_MODE: "worker",
        STUDIO_PROCESS_ROLE: "api",
      } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      shouldRunStudioJobs({
        STUDIO_ORCHESTRATOR_MODE: "worker",
        STUDIO_PROCESS_ROLE: "worker",
      } as NodeJS.ProcessEnv),
      true,
    );
  });
});
