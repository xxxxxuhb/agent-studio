import assert from "node:assert/strict";
import {
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { afterEach, describe, it } from "node:test";
import type { Project, WorkOrder } from "@agent-studio/agent-schema";
import {
  buildBridgeWorkspaceUrl,
  sanitizeRelPath,
  WorkspaceBrowseService,
} from "../dist/workspace/workspace-browse.service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("sanitizeRelPath / buildBridgeWorkspaceUrl", () => {
  it("rejects traversal and absolute paths", () => {
    assert.equal(sanitizeRelPath(""), "");
    assert.equal(sanitizeRelPath("src/app.ts"), "src/app.ts");
    assert.throws(() => sanitizeRelPath("../etc/passwd"), BadRequestException);
    assert.throws(() => sanitizeRelPath("/etc/passwd"), BadRequestException);
  });

  it("builds Bridge URL with relative path only", () => {
    const url = buildBridgeWorkspaceUrl("http://bridge:8787/", "file", {
      project_id: "p1",
      repo_id: "backend",
      path: "src/index.ts",
      local_path: "/host/AgentStudio/p1/backend",
    });
    assert.equal(
      url,
      "http://bridge:8787/workspace/file?project_id=p1&repo_id=backend&path=src%2Findex.ts&local_path=%2Fhost%2FAgentStudio%2Fp1%2Fbackend",
    );
  });
});

function fakeOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo-1",
    team_id: "team-1",
    title: "t",
    requirement: "r",
    status: "draft",
    priority: "medium",
    category: "requirement",
    project_id: "proj-a",
    preferred_bridge_id: "",
    pipeline_id: "",
    tags: [],
    created_at: "",
    updated_at: "",
    ...over,
  } as WorkOrder;
}

function fakeProject(over: Partial<Project> = {}): Project {
  return {
    id: "proj-a",
    team_id: "team-1",
    name: "Demo",
    description: "",
    clone_root: "",
    preferred_bridge_id: "br-1",
    enabled: true,
    tags: [],
    repos: [
      {
        id: "backend",
        name: "backend",
        remote_url: "git@x/backend.git",
        local_path: "",
        role: "backend",
        agents_md: "AGENTS.md",
        default_branch: "main",
        note: "",
        clone_status: "pending",
        clone_error: "",
      },
    ],
    ...over,
  } as Project;
}

function makeService(opts: {
  getOrder?: () => Promise<WorkOrder>;
  getProject?: () => Promise<Project>;
  getBridge?: () => Promise<{
    id: string;
    name: string;
    status: string;
    driver: string;
    base_url: string;
    team_id: string;
  }>;
}) {
  const workOrders = {
    getForUser: async () => {
      if (!opts.getOrder) throw new NotFoundException("not found: wo-x");
      return opts.getOrder();
    },
  };
  const projects = {
    getForUser: async () => {
      if (!opts.getProject) throw new NotFoundException("project not found");
      return opts.getProject();
    },
    catalogForManager: async () => ({
      project_id: "proj-a",
      project_name: "Demo",
      clone_root: "",
      repos: [],
    }),
  };
  const bridges = {
    getForUser: async () => {
      if (!opts.getBridge) throw new NotFoundException("bridge not found");
      return opts.getBridge();
    },
    pickRegisteredExecutor: async () => undefined,
  };
  const studioConfig = {
    getEffectiveForTeam: () => ({
      bridge_base_url: "http://127.0.0.1:8787",
      agents_md_path: "auto",
    }),
  };
  return new WorkspaceBrowseService(
    workOrders as never,
    projects as never,
    bridges as never,
    studioConfig as never,
  );
}

describe("WorkspaceBrowseService", () => {
  it("404 when the work order is not visible to the user", async () => {
    const svc = makeService({});
    await assert.rejects(
      () => svc.describeWorkOrder("u1", "wo-x"),
      NotFoundException,
    );
  });

  it("proxies relative path to Bridge and maps missing workspace to 404", async () => {
    const svc = makeService({
      getProject: async () => fakeProject(),
      getBridge: async () => ({
        id: "br-1",
        name: "cloud",
        status: "online",
        driver: "cursor",
        base_url: "http://bridge:8787",
        team_id: "team-1",
      }),
    });
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          error: "not_found",
          message: "workspace not found",
        }),
        { status: 404 },
      );
    }) as typeof fetch;

    await assert.rejects(
      () =>
        svc.treeProject("u1", "proj-a", {
          repo_id: "backend",
          path: "src",
        }),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundException);
        assert.match(String((err as Error).message), /尚未在该执行器上准备/);
        return true;
      },
    );
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /\/workspace\/tree\?/);
    assert.match(urls[0]!, /project_id=proj-a/);
    assert.match(urls[0]!, /repo_id=backend/);
    assert.match(urls[0]!, /path=src/);
    assert.ok(!urls[0]!.includes(".."));
  });

  it("returns repo list for a work order from repo_targets", async () => {
    const svc = makeService({
      getOrder: async () =>
        fakeOrder({
          run: {
            run_id: "r1",
            pipeline_id: "p",
            pipeline_name: "p",
            executor: "studio",
            current_step_index: 0,
            steps: [],
            current_repo_index: 0,
            repo_targets: [
              {
                repo_id: "backend",
                name: "API",
                role: "backend",
                agents_md_path: "/bridge/proj-a/backend/AGENTS.md",
                local_path: "/bridge/proj-a/backend",
                status: "running",
                bridge_run_id: "",
                note: "",
              },
            ],
            studio: {
              bridge_id: "br-1",
              bridge_name: "cloud",
              bridge_driver: "cursor",
              bridge_base_url: "http://bridge:8787",
            },
          } as unknown as WorkOrder["run"],
        }),
      getProject: async () => fakeProject(),
      getBridge: async () => ({
        id: "br-1",
        name: "cloud",
        status: "online",
        driver: "cursor",
        base_url: "http://bridge:8787",
        team_id: "team-1",
      }),
    });
    const desc = await svc.describeWorkOrder("u1", "wo-1");
    assert.equal(desc.default_repo_id, "backend");
    assert.equal(desc.bridge?.id, "br-1");
    assert.equal(desc.repos[0]?.name, "API");
    assert.ok(!JSON.stringify(desc).includes("/bridge/proj-a"));
  });
});
