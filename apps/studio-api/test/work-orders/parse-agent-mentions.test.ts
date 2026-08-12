import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentMentions } from "@agent-studio/agent-schema";

const agents = [
  { id: "requirement", name: "需求" },
  { id: "requirement_intake", name: "需求接入" },
  { id: "fullstack_dev", name: "全栈开发" },
  { id: "plan", name: "计划" },
];

describe("parseAgentMentions", () => {
  it("matches @id and prefers longer id", () => {
    const r = parseAgentMentions("@requirement_intake 澄清一下", agents);
    assert.equal(r.primary?.id, "requirement_intake");
    assert.deepEqual(
      r.mentioned.map((m) => m.id),
      ["requirement_intake"],
    );
  });

  it("matches @name when unique", () => {
    const r = parseAgentMentions("@全栈开发 加个空状态", agents);
    assert.equal(r.primary?.id, "fullstack_dev");
  });

  it("takes first mention in text as primary when multiple", () => {
    const r = parseAgentMentions(
      "@fullstack_dev 实现，@plan 同步更新方案",
      agents,
    );
    assert.equal(r.primary?.id, "fullstack_dev");
    assert.deepEqual(
      r.others.map((o) => o.id),
      ["plan"],
    );
  });

  it("orders by appearance not token length", () => {
    const r = parseAgentMentions("@plan 然后 @fullstack_dev", agents);
    assert.equal(r.primary?.id, "plan");
    assert.equal(r.others[0]?.id, "fullstack_dev");
  });

  it("returns empty when no match", () => {
    const r = parseAgentMentions("没有点名", agents);
    assert.equal(r.primary, null);
    assert.equal(r.mentioned.length, 0);
  });
});
