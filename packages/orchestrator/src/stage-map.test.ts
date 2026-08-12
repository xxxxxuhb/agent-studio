import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bridgeStageForAgent } from "./stage-map";

describe("bridgeStageForAgent", () => {
  it("maps known agent ids", () => {
    assert.equal(bridgeStageForAgent(null, "fullstack_dev"), "dev");
    assert.equal(bridgeStageForAgent(null, "plan"), "plan");
  });

  it("prefers dify.agent_id", () => {
    assert.equal(
      bridgeStageForAgent({ dify: { agent_id: "custom_stage" } }, "fullstack_dev"),
      "custom_stage",
    );
  });

  it("maps by role", () => {
    assert.equal(bridgeStageForAgent({ role: "implement" }, "x"), "dev");
  });
});
