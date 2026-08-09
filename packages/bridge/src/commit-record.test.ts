import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommitRecord } from "./git.js";

describe("parseCommitRecord", () => {
  it("parses a review-written commit-record", () => {
    const record = parseCommitRecord(`# Commit record

- run_id: c2978bd5
- committed: true
- sha: b253f3d26db76e1309b972d59dfe20bc2d449a2e
- branch: studio/dev/c2978bd5
- pushed: true
- pr_url: -
- message: feat: add PostgreSQL users DDL and seed SQL (c2978bd5)
- note: committed by review
`);
    assert.ok(record);
    assert.equal(record.committed, true);
    assert.equal(record.sha, "b253f3d26db76e1309b972d59dfe20bc2d449a2e");
    assert.equal(record.branch, "studio/dev/c2978bd5");
    assert.equal(record.pushed, true);
    assert.equal(record.prUrl, undefined);
    assert.match(record.message || "", /PostgreSQL/);
  });

  it("treats reject / missing commit as not committed", () => {
    const record = parseCommitRecord(`# Commit record

- run_id: abc
- committed: false
- sha: -
- branch: studio/dev/abc
- pushed: false
- pr_url: -
`);
    assert.ok(record);
    assert.equal(record.committed, false);
    assert.equal(record.sha, undefined);
    assert.equal(record.pushed, false);
  });

  it("parses markdown table commit-record", () => {
    const record = parseCommitRecord(`# Commit record

| field | value |
| --- | --- |
| run_id | 64c74bb8 |
| committed | true |
| sha | abcdef0123456789abcdef0123456789abcdef01 |
| branch | studio/dev/64c74bb8 |
| pushed | true |
| pr_url | - |
| message | fix: cors for studio |
| note | committed by review |
`);
    assert.ok(record);
    assert.equal(record.committed, true);
    assert.equal(record.sha, "abcdef0123456789abcdef0123456789abcdef01");
    assert.equal(record.branch, "studio/dev/64c74bb8");
    assert.equal(record.pushed, true);
    assert.match(record.message || "", /cors/);
  });
});
