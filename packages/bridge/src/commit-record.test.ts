import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ensureReviewMergeRequest,
  parseCommitRecord,
  parseOriginRemoteUrl,
  readCommitRecord,
} from "./git.js";

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

  it("returns null for empty / non-record text", () => {
    assert.equal(parseCommitRecord(""), null);
    assert.equal(parseCommitRecord("   "), null);
    assert.equal(parseCommitRecord("# notes\n\nno fields"), null);
  });

  it("accepts truthy aliases and keeps pr_url", () => {
    const record = parseCommitRecord(`
- committed: yes
- sha: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
- branch: studio/dev/x
- pushed: 1
- pr_url: http://localhost:8929/root/demo/-/merge_requests/3
`);
    assert.ok(record);
    assert.equal(record.committed, true);
    assert.equal(record.pushed, true);
    assert.equal(
      record.prUrl,
      "http://localhost:8929/root/demo/-/merge_requests/3",
    );
  });

  it("treats no / 0 / - as falsy for committed and pushed", () => {
    const record = parseCommitRecord(`
- committed: no
- sha: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
- branch: studio/dev/x
- pushed: 0
`);
    assert.ok(record);
    assert.equal(record.committed, false);
    assert.equal(record.pushed, false);
  });

  it("prefers list fields when both list and table are present", () => {
    const record = parseCommitRecord(`
- committed: true
- sha: 1111111111111111111111111111111111111111
- branch: from-list
| committed | false |
| sha | 2222222222222222222222222222222222222222 |
| branch | from-table |
`);
    assert.ok(record);
    assert.equal(record.committed, true);
    assert.equal(record.sha, "1111111111111111111111111111111111111111");
    assert.equal(record.branch, "from-list");
  });
});

describe("readCommitRecord", () => {
  it("returns null for missing file and parses existing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-cr-"));
    const missing = path.join(dir, "missing.md");
    assert.equal(readCommitRecord(missing), null);

    const file = path.join(dir, "commit-record.md");
    fs.writeFileSync(
      file,
      `- committed: true
- sha: abcdef0123456789abcdef0123456789abcdef01
- branch: studio/dev/t
- pushed: false
`,
    );
    const record = readCommitRecord(file);
    assert.ok(record);
    assert.equal(record.committed, true);
    assert.equal(record.branch, "studio/dev/t");
  });
});

describe("parseOriginRemoteUrl", () => {
  const prevGitlab = {
    BRIDGE_GITLAB_API: process.env.BRIDGE_GITLAB_API,
    GITLAB_API: process.env.GITLAB_API,
    BRIDGE_GITLAB_WEB: process.env.BRIDGE_GITLAB_WEB,
  };

  function restoreGitlabEnv() {
    for (const [k, v] of Object.entries(prevGitlab)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  function clearGitlabEnv() {
    delete process.env.BRIDGE_GITLAB_API;
    delete process.env.GITLAB_API;
    delete process.env.BRIDGE_GITLAB_WEB;
  }

  it("parses GitLab SSH and HTTP remotes", () => {
    clearGitlabEnv();
    try {
      const ssh = parseOriginRemoteUrl("git@localhost:root/demo.git");
      assert.ok(ssh);
      assert.equal(ssh.kind, "gitlab");
      assert.equal(ssh.projectPath, "root/demo");
      assert.equal(ssh.apiBase, "http://localhost/api/v4");

      const http = parseOriginRemoteUrl("http://127.0.0.1:8929/root/demo.git");
      assert.ok(http);
      assert.equal(http.kind, "gitlab");
      assert.equal(http.projectPath, "root/demo");
      assert.equal(http.apiBase, "http://127.0.0.1/api/v4");
    } finally {
      restoreGitlabEnv();
    }
  });

  it("parses GitHub remotes", () => {
    const gh = parseOriginRemoteUrl("git@github.com:acme/app.git");
    assert.ok(gh);
    assert.equal(gh.kind, "github");
    assert.equal(gh.projectPath, "acme/app");
    assert.equal(gh.apiBase, "https://api.github.com");
  });

  it("honors BRIDGE_GITLAB_API / WEB overlays", () => {
    clearGitlabEnv();
    process.env.BRIDGE_GITLAB_API = "http://localhost:8929/api/v4";
    process.env.BRIDGE_GITLAB_WEB = "http://localhost:8929";
    try {
      const remote = parseOriginRemoteUrl("git@gitlab.internal:group/proj.git");
      assert.ok(remote);
      assert.equal(remote.kind, "gitlab");
      assert.equal(remote.apiBase, "http://localhost:8929/api/v4");
      assert.equal(remote.webBase, "http://localhost:8929");
    } finally {
      restoreGitlabEnv();
    }
  });
});

describe("ensureReviewMergeRequest", () => {
  it("skips when commit-record is missing or incomplete", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mr-"));
    const missing = await ensureReviewMergeRequest({
      repoPath: dir,
      runId: "r1",
      commitRecordPath: path.join(dir, "nope.md"),
    });
    assert.equal(missing.committed, false);
    assert.match(missing.note, /no commit-record/);

    const incompletePath = path.join(dir, "incomplete.md");
    fs.writeFileSync(
      incompletePath,
      `- committed: true
- sha: -
- branch: studio/dev/r1
- pushed: true
`,
    );
    const incomplete = await ensureReviewMergeRequest({
      repoPath: dir,
      runId: "r1",
      commitRecordPath: incompletePath,
    });
    assert.equal(incomplete.committed, false);
  });

  it("skips MR when push is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mr-"));
    const file = path.join(dir, "commit-record.md");
    fs.writeFileSync(
      file,
      `- committed: true
- sha: abcdef0123456789abcdef0123456789abcdef01
- branch: studio/dev/r2
- pushed: false
`,
    );
    const result = await ensureReviewMergeRequest({
      repoPath: dir,
      runId: "r2",
      commitRecordPath: file,
    });
    assert.equal(result.committed, true);
    assert.equal(result.pushed, false);
    assert.equal(result.prUrl, undefined);
    assert.match(result.note, /push missing/);
  });

  it("reuses pr_url already recorded by review", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mr-"));
    const file = path.join(dir, "commit-record.md");
    const pr =
      "http://localhost:8929/root/demo/-/merge_requests/9";
    fs.writeFileSync(
      file,
      `- committed: true
- sha: abcdef0123456789abcdef0123456789abcdef01
- branch: studio/dev/r3
- pushed: true
- pr_url: ${pr}
`,
    );
    const result = await ensureReviewMergeRequest({
      repoPath: dir,
      runId: "r3",
      commitRecordPath: file,
    });
    assert.equal(result.committed, true);
    assert.equal(result.prUrl, pr);
    assert.match(result.note, /MR already recorded/);
  });

  it("honors createPr=false without calling forge APIs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-mr-"));
    const file = path.join(dir, "commit-record.md");
    fs.writeFileSync(
      file,
      `- committed: true
- sha: abcdef0123456789abcdef0123456789abcdef01
- branch: studio/dev/r4
- pushed: true
`,
    );
    const result = await ensureReviewMergeRequest({
      repoPath: dir,
      runId: "r4",
      commitRecordPath: file,
      createPr: false,
    });
    assert.equal(result.committed, true);
    assert.equal(result.prUrl, undefined);
    assert.match(result.note, /PR skipped/);
  });
});
