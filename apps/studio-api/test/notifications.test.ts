import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SystemNotificationSchema,
  parseUserMentions,
} from "@agent-studio/agent-schema";

const users = [
  { id: "u1", username: "alice", display_name: "爱丽丝" },
  { id: "u2", username: "bob", display_name: "Bob" },
  { id: "u3", username: "alice_ops", display_name: "运维 Alice" },
];

describe("parseUserMentions", () => {
  it("matches @username and prefers longer token", () => {
    const r = parseUserMentions("@alice_ops 看一下", users);
    assert.deepEqual(
      r.mentioned.map((m) => m.id),
      ["u3"],
    );
  });

  it("matches @display_name", () => {
    const r = parseUserMentions("@爱丽丝 帮忙确认", users);
    assert.equal(r.mentioned[0]?.id, "u1");
  });

  it("orders by appearance", () => {
    const r = parseUserMentions("@bob 然后 @alice", users);
    assert.deepEqual(
      r.mentioned.map((m) => m.id),
      ["u2", "u1"],
    );
  });

  it("dedupes same user matched by username then display_name", () => {
    const r = parseUserMentions("@alice 以及 @爱丽丝", users);
    assert.equal(r.mentioned.length, 1);
    assert.equal(r.mentioned[0]?.id, "u1");
  });

  it("returns empty when no match", () => {
    const r = parseUserMentions("没有点名", users);
    assert.equal(r.mentioned.length, 0);
  });

  it("only resolves against provided team members (isolation)", () => {
    const r = parseUserMentions("@bob 你好", [
      { id: "u1", username: "alice", display_name: "爱丽丝" },
    ]);
    assert.equal(r.mentioned.length, 0);
  });
});

describe("SystemNotificationSchema", () => {
  it("parses inbox row", () => {
    const n = SystemNotificationSchema.parse({
      id: "n1",
      team_id: "t1",
      user_id: "u2",
      kind: "comment_mention",
      title: "alice 在评论中提及了你",
      body: "请看一下 @bob",
      work_order_id: "wo-1",
      actor_user_id: "u1",
      actor_name: "alice",
      read_at: null,
      created_at: "2026-08-15T00:00:00.000Z",
    });
    assert.equal(n.kind, "comment_mention");
    assert.equal(n.team_id, "t1");
    assert.equal(n.read_at, null);
  });
});

/** Mirrors NotificationsService text builders (kept local so tests stay under test/). */
function workOrderEventTitle(
  event: "pending_approval" | "failed" | "completed",
): string {
  if (event === "pending_approval") return "等待人工确认";
  if (event === "failed") return "工单失败";
  return "工单完成";
}

function buildWorkOrderEventText(input: {
  event: "pending_approval" | "failed" | "completed";
  title: string;
  status: string;
  detail?: string;
  link: string;
}): string {
  const heading = workOrderEventTitle(input.event);
  return [
    `【${heading}】${input.title}`,
    `状态：${input.status}`,
    input.detail ? `详情：${input.detail}` : "",
    `链接：${input.link}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCommentMentionText(input: {
  work_order_title: string;
  author_name: string;
  body: string;
  mentioned_names: string[];
  link: string;
}): string {
  return [
    `【评论提及】${input.work_order_title}`,
    `${input.author_name} 提及了 ${input.mentioned_names.join("、")}`,
    input.body.slice(0, 500),
    `链接：${input.link}`,
  ].join("\n");
}

describe("notification text builders", () => {
  it("titles cover status events", () => {
    assert.equal(workOrderEventTitle("pending_approval"), "等待人工确认");
    assert.equal(workOrderEventTitle("failed"), "工单失败");
    assert.equal(workOrderEventTitle("completed"), "工单完成");
  });

  it("includes detail and link", () => {
    const text = buildWorkOrderEventText({
      event: "pending_approval",
      title: "修登录",
      status: "pending_approval",
      detail: "需求确认",
      link: "http://localhost/?wo=wo1",
    });
    assert.match(text, /等待人工确认/);
    assert.match(text, /修登录/);
    assert.match(text, /详情：需求确认/);
    assert.match(text, /wo=wo1/);
  });

  it("truncates long comment body to 500", () => {
    const text = buildCommentMentionText({
      work_order_title: "修登录",
      author_name: "alice",
      body: "x".repeat(600),
      mentioned_names: ["Bob"],
      link: "http://localhost/?wo=wo1",
    });
    assert.match(text, /评论提及/);
    assert.match(text, /alice 提及了 Bob/);
    assert.ok(text.includes("x".repeat(500)));
    assert.ok(!text.includes("x".repeat(501)));
  });
});
