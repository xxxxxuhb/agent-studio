import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BadRequestException, Logger } from "@nestjs/common";
import type { WorkOrder } from "@agent-studio/agent-schema";
import type { DifyConfigService } from "../../dist/dify/dify-config.service";
import type { ProjectsService } from "../../dist/projects/projects.service";
import {
  ensureWorkspaceViaBridge,
  mergeCatalogWithBridgePaths,
  prepareProjectRouting,
} from "../../dist/work-orders/work-order-routing";
import {
  resolveStudioBridgeBase,
  studioReachableBridgeBase,
} from "../../dist/work-orders/work-order-dify-utils";

const originalFetch = globalThis.fetch;

describe("Studio Bridge URL resolution (routing)", () => {
  it("rewrites host.docker.internal for Studio HTTP", () => {
    assert.equal(
      studioReachableBridgeBase("http://host.docker.internal:8787"),
      "http://127.0.0.1:8787",
    );
  });

  it("keeps LAN / public Bridge URLs", () => {
    assert.equal(
      studioReachableBridgeBase("http://192.168.1.8:8787/"),
      "http://192.168.1.8:8787",
    );
  });

  it("prefers override → registered → configured", () => {
    assert.equal(
      resolveStudioBridgeBase({
        override: "http://override:8787",
        registeredBaseUrl: "http://registered:8787",
        configured: "http://configured:8787",
      }),
      "http://override:8787",
    );
    assert.equal(
      resolveStudioBridgeBase({
        registeredBaseUrl: "http://registered:8787",
        configured: "http://configured:8787",
      }),
      "http://registered:8787",
    );
    assert.equal(
      resolveStudioBridgeBase({
        configured: "http://host.docker.internal:8787",
      }),
      "http://127.0.0.1:8787",
    );
  });
});

describe("mergeCatalogWithBridgePaths", () => {
  it("keeps only Bridge-ready repos and adopts Bridge paths", () => {
    const merged = mergeCatalogWithBridgePaths(
      [
        {
          id: "backend",
          name: "Backend",
          role: "api",
          remote_url: "git@x/backend.git",
          local_path: "/studio/old",
          agents_md_path: "/studio/old/AGENTS.md",
        },
        {
          id: "frontend",
          name: "Frontend",
          role: "web",
          remote_url: "git@x/frontend.git",
          local_path: "",
          agents_md_path: "",
        },
      ],
      [
        {
          id: "backend",
          local_path: "/bridge/backend",
          agents_md_path: "/bridge/backend/AGENTS.md",
          clone_status: "ready",
        },
        {
          id: "frontend",
          local_path: "",
          agents_md_path: "",
          clone_status: "error",
          clone_error: "clone failed",
        },
      ],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.id, "backend");
    assert.equal(merged[0]!.local_path, "/bridge/backend");
    assert.equal(merged[0]!.agents_md_path, "/bridge/backend/AGENTS.md");
  });
});

describe("ensureWorkspaceViaBridge", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns Bridge repos on success", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          repos: [
            {
              id: "r1",
              local_path: "/bridge/r1",
              agents_md_path: "/bridge/r1/AGENTS.md",
              clone_status: "ready",
            },
          ],
        }),
      }) as Response) as typeof fetch;

    const repos = await ensureWorkspaceViaBridge(
      { logger: new Logger("test") },
      {
        bridgeBase: "http://127.0.0.1:8787",
        projectId: "p1",
        repos: [{ id: "r1", remote_url: "git@x/r1.git" }],
      },
    );
    assert.equal(repos[0]!.clone_status, "ready");
  });

  it("wraps Bridge failure as BadRequestException", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 503,
        text: async () => "bridge_busy",
      }) as Response) as typeof fetch;

    await assert.rejects(
      () =>
        ensureWorkspaceViaBridge(
          { logger: new Logger("test") },
          {
            bridgeBase: "http://127.0.0.1:8787",
            projectId: "p1",
            repos: [{ id: "r1", remote_url: "git@x/r1.git" }],
          },
        ),
      (err: unknown) =>
        err instanceof BadRequestException &&
        String(err.message).includes("workspace/ensure"),
    );
  });
});

describe("prepareProjectRouting", () => {
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function deps(opts?: {
    registered?: string;
    agents_md_path?: string;
    bridge_base_url?: string;
  }) {
    const projects = {
      getById: async (id: string) => ({
        id,
        enabled: true,
        repos: [
          {
            id: "backend",
            name: "Backend",
            role: "api",
            remote_url: "git@x/backend.git",
            default_branch: "main",
          },
        ],
      }),
      catalogForManager: async () => ({
        project_name: "Demo",
        repos: [
          {
            id: "backend",
            name: "Backend",
            role: "api",
            remote_url: "git@x/backend.git",
            local_path: "",
            agents_md_path: "",
            default_branch: "main",
          },
        ],
      }),
    } as unknown as ProjectsService;

    const difyConfig = {
      get: () => ({
        agents_md_path: opts?.agents_md_path || "auto",
        bridge_base_url:
          opts?.bridge_base_url || "http://host.docker.internal:8787",
      }),
      getEffectiveForTeam: () => ({
        agents_md_path: opts?.agents_md_path || "auto",
        bridge_base_url:
          opts?.bridge_base_url || "http://host.docker.internal:8787",
      }),
    } as unknown as DifyConfigService;

    return {
      projects,
      difyConfig,
      logger: new Logger("test"),
      registeredBridgeBaseUrl: opts?.registered,
    };
  }

  function order(partial?: Partial<WorkOrder>): WorkOrder {
    return {
      id: "wo-1",
      team_id: "team-a",
      project_id: "proj-1",
      title: "t",
      requirement: "fix login",
      status: "draft",
      category: "requirement",
      priority: "medium",
      tags: [],
      pipeline_id: "p1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...partial,
    } as WorkOrder;
  }

  it("returns auto routing when no project bound", async () => {
    const result = await prepareProjectRouting(
      deps(),
      order({ project_id: "" }),
      {},
    );
    assert.equal(result.routing_mode, "auto");
    assert.deepEqual(result.selected_repo_ids, []);
    assert.match(result.manager_routing_reason, /no project/);
  });

  it("uses registered Bridge URL for ensure + select", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/workspace/ensure")) {
        return {
          ok: true,
          json: async () => ({
            repos: [
              {
                id: "backend",
                local_path: "/bridge/backend",
                agents_md_path: "/bridge/backend/AGENTS.md",
                clone_status: "ready",
              },
            ],
          }),
        } as Response;
      }
      if (url.includes("/routing/select")) {
        return {
          ok: true,
          json: async () => ({
            repo_ids: ["backend"],
            reason: "backend owns login",
          }),
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "no" } as Response;
    }) as typeof fetch;

    const result = await prepareProjectRouting(
      deps({ registered: "http://10.0.0.5:8787" }),
      order(),
      {},
    );
    assert.equal(result.selected_repo_ids[0], "backend");
    assert.equal(result.repo_targets[0]!.local_path, "/bridge/backend");
    assert.ok(calls.every((u) => u.startsWith("http://10.0.0.5:8787")));
  });

  it("fails when Bridge clones produce no ready repos", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          repos: [
            {
              id: "backend",
              local_path: "",
              agents_md_path: "",
              clone_status: "error",
              clone_error: "auth failed",
            },
          ],
        }),
      }) as Response) as typeof fetch;

    await assert.rejects(
      () => prepareProjectRouting(deps(), order(), {}),
      (err: unknown) =>
        err instanceof BadRequestException &&
        String(err.message).includes("克隆失败"),
    );
  });

  it("fails clearly when /routing/select is unreachable", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/workspace/ensure")) {
        return {
          ok: true,
          json: async () => ({
            repos: [
              {
                id: "backend",
                local_path: "/bridge/backend",
                agents_md_path: "/bridge/backend/AGENTS.md",
                clone_status: "ready",
              },
            ],
          }),
        } as Response;
      }
      throw new Error("fetch failed");
    }) as typeof fetch;

    await assert.rejects(
      () => prepareProjectRouting(deps(), order(), {}),
      (err: unknown) =>
        err instanceof BadRequestException &&
        String(err.message).includes("/routing/select"),
    );
  });

  it("honors manual agents_md_path override without select", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return {
        ok: true,
        json: async () => ({
          repos: [
            {
              id: "backend",
              local_path: "/bridge/backend",
              agents_md_path: "/bridge/backend/AGENTS.md",
              clone_status: "ready",
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const result = await prepareProjectRouting(deps(), order(), {
      agentsMdPath: "/bridge/backend/AGENTS.md",
    });
    assert.equal(result.routing_mode, "explicit");
    assert.equal(result.selected_repo_ids[0], "backend");
    assert.ok(calls.every((u) => u.includes("/workspace/ensure")));
    assert.ok(!calls.some((u) => u.includes("/routing/select")));
  });
});
