import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bridgeStageForAgent } from "./stage-map";

describe("bridgeStageForAgent", () => {
  it("maps known agent ids", () => {
    assert.equal(bridgeStageForAgent(null, "fullstack_dev"), "dev");
    assert.equal(bridgeStageForAgent(null, "plan"), "plan");
  });

  it("prefers bridge.stage_id", () => {
    assert.equal(
      bridgeStageForAgent(
        { bridge: { stage_id: "custom_stage" } },
        "fullstack_dev",
      ),
      "custom_stage",
    );
  });

  it("falls back to legacy dify.agent_id", () => {
    assert.equal(
      bridgeStageForAgent({ dify: { agent_id: "legacy_stage" } }, "fullstack_dev"),
      "legacy_stage",
    );
  });

  it("maps by role", () => {
    assert.equal(bridgeStageForAgent({ role: "implement" }, "x"), "dev");
  });
});
