import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { Repository } from "typeorm";
import type { BridgeExecutor } from "@agent-studio/agent-schema";
import { BridgesService } from "../../dist/bridges/bridges.service";
import type { BridgeEntity } from "../../dist/bridges/entities/bridge.entity";
import type { RealtimeHub } from "../../dist/realtime/realtime.hub";
import type { TeamsService } from "../../dist/teams/teams.service";

const originalFetch = globalThis.fetch;

function entity(
  partial: Partial<BridgeEntity> & {
    id: string;
    base_url: string;
    status: BridgeExecutor["status"];
  },
): BridgeEntity {
  return {
    name: partial.name || partial.id,
    team_id: partial.team_id || "",
    driver: "cursor",
    driver_label: "",
    dry_run: false,
    model: "",
    platform: "darwin",
    available_drivers: [],
    current_run_id: "",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    note: "",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...partial,
  } as BridgeEntity;
}

function makeService(rows: BridgeEntity[]) {
  const repo = {
    find: async () => rows,
    findOne: async (args: { where: { id: string } }) =>
      rows.find((r) => r.id === args.where.id) || null,
  } as unknown as Repository<BridgeEntity>;
  const teams = {} as TeamsService;
  const realtime = {
    publishBridge: () => undefined,
    publishBridges: () => undefined,
  } as unknown as RealtimeHub;
  return new BridgesService(repo, realtime, teams);
}

describe("BridgesService reachability", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("pickRegisteredBaseUrl prefers online over busy and matches team", async () => {
    const svc = makeService([
      entity({
        id: "offline",
        base_url: "http://offline:8787",
        status: "offline",
        team_id: "t1",
      }),
      entity({
        id: "other-team",
        base_url: "http://other:8787",
        status: "online",
        team_id: "t2",
        last_seen_at: "2026-01-02T00:00:00.000Z",
      }),
      entity({
        id: "mine-busy",
        base_url: "http://mine-busy:8787/",
        status: "busy",
        team_id: "t1",
        last_seen_at: "2026-01-03T00:00:00.000Z",
      }),
      entity({
        id: "mine-idle",
        base_url: "http://mine-idle:8787/",
        status: "online",
        team_id: "t1",
        last_seen_at: "2026-01-01T12:00:00.000Z",
      }),
    ]);
    assert.equal(
      await svc.pickRegisteredBaseUrl({ teamId: "t1" }),
      "http://mine-idle:8787",
    );
    assert.equal(
      await svc.pickRegisteredBaseUrl({ teamId: "t1", preferIdle: true }),
      "http://mine-idle:8787",
    );
    assert.equal(await svc.pickRegisteredBaseUrl({ teamId: "t2" }), "http://other:8787");
    assert.equal(await svc.pickRegisteredBaseUrl({}), "http://other:8787");
  });

  it("does not fall back to another team's Bridge", async () => {
    const svc = makeService([
      entity({
        id: "other",
        base_url: "http://other:8787",
        status: "online",
        team_id: "t2",
      }),
      entity({
        id: "mine-offline",
        base_url: "http://mine:8787",
        status: "offline",
        team_id: "t1",
      }),
    ]);
    assert.equal(await svc.pickRegisteredBaseUrl({ teamId: "t1" }), undefined);
    assert.equal(
      await svc.pickRegisteredBaseUrl({ teamId: "t1", preferIdle: true }),
      undefined,
    );
  });

  it("preferIdle ignores busy-only pools", async () => {
    const svc = makeService([
      entity({
        id: "busy",
        base_url: "http://busy:8787",
        status: "busy",
        team_id: "t1",
      }),
    ]);
    assert.equal(
      await svc.pickRegisteredBaseUrl({ teamId: "t1", preferIdle: true }),
      undefined,
    );
    assert.equal(
      await svc.pickRegisteredBaseUrl({ teamId: "t1" }),
      "http://busy:8787",
    );
  });

  it("resolveForNewRun reports busy_pool when only busy remain", async () => {
    const svc = makeService([
      entity({
        id: "busy",
        base_url: "http://busy:8787",
        status: "busy",
        team_id: "t1",
      }),
    ]);
    const hit = await svc.resolveForNewRun({ teamId: "t1" });
    assert.equal(hit.ok, false);
    if (!hit.ok) {
      assert.equal(hit.reason, "busy_pool");
      assert.match(hit.message, /排队/);
    }
  });

  it("requireReachableBaseUrl fails when nothing configured", async () => {
    const svc = makeService([]);
    await assert.rejects(
      () => svc.requireReachableBaseUrl({}),
      (err: unknown) =>
        err instanceof BadRequestException &&
        String(err.message).includes("无可用 Bridge"),
    );
  });

  it("requireReachableBaseUrl uses registered without health probe", async () => {
    const svc = makeService([
      entity({
        id: "b1",
        base_url: "http://reg:8787",
        status: "online",
        team_id: "t1",
      }),
    ]);
    let probed = false;
    globalThis.fetch = (async () => {
      probed = true;
      return { ok: true } as Response;
    }) as typeof fetch;

    const hit = await svc.requireReachableBaseUrl({
      teamId: "t1",
      configured: "http://settings:8787",
    });
    assert.equal(hit.studioBaseUrl, "http://reg:8787");
    assert.equal(hit.registeredBaseUrl, "http://reg:8787");
    assert.equal(probed, false);
  });

  it("requireReachableBaseUrl probes health for settings-only fallback", async () => {
    const svc = makeService([]);
    globalThis.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
    await assert.rejects(
      () =>
        svc.requireReachableBaseUrl({
          configured: "http://127.0.0.1:8787",
        }),
      (err: unknown) =>
        err instanceof BadRequestException &&
        String(err.message).includes("不可达"),
    );

    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ status: "online" }),
      }) as Response) as typeof fetch;
    const ok = await svc.requireReachableBaseUrl({
      configured: "http://127.0.0.1:8787",
    });
    assert.equal(ok.studioBaseUrl, "http://127.0.0.1:8787");
  });

  it("requireReachableBaseUrl honors explicit override", async () => {
    const svc = makeService([
      entity({
        id: "b1",
        base_url: "http://reg:8787",
        status: "online",
      }),
    ]);
    const hit = await svc.requireReachableBaseUrl({
      override: "http://override:9999/",
    });
    assert.equal(hit.studioBaseUrl, "http://override:9999");
  });
});
