import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAbsoluteRepoLocalPath,
  projectNeedsPreferredBridge,
  ProjectSchema,
} from "@agent-studio/agent-schema";

describe("project local path + preferred bridge", () => {
  it("detects absolute paths", () => {
    assert.equal(isAbsoluteRepoLocalPath("/Users/me/code/app"), true);
    assert.equal(isAbsoluteRepoLocalPath("C:\\repos\\app"), true);
    assert.equal(isAbsoluteRepoLocalPath("frontend"), false);
    assert.equal(isAbsoluteRepoLocalPath(""), false);
  });

  it("requires preferred_bridge_id when local absolute repos", () => {
    assert.equal(
      projectNeedsPreferredBridge({
        repos: [{ local_path: "/data/repos/api" }],
      }),
      true,
    );
    assert.throws(() =>
      ProjectSchema.parse({
        id: "demo",
        team_id: "t1",
        name: "Demo",
        repos: [
          {
            id: "api",
            name: "API",
            local_path: "/data/repos/api",
            remote_url: "",
          },
        ],
      }),
    );
    const ok = ProjectSchema.parse({
      id: "demo",
      team_id: "t1",
      name: "Demo",
      preferred_bridge_id: "bridge-1",
      repos: [
        {
          id: "api",
          name: "API",
          local_path: "/data/repos/api",
          remote_url: "",
        },
      ],
    });
    assert.equal(ok.preferred_bridge_id, "bridge-1");
  });
});
