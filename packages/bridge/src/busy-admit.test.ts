import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  __testGetActiveRuns,
  __testSetActiveRuns,
  createBridgeApp,
} from "./server.js";

describe("bridge busy admit for new runs", () => {
  const prev = {
    BRIDGE_HTTP_TOKEN: process.env.BRIDGE_HTTP_TOKEN,
    STUDIO_BRIDGE_TOKEN: process.env.STUDIO_BRIDGE_TOKEN,
    BRIDGE_TOKEN: process.env.BRIDGE_TOKEN,
  };

  before(() => {
    process.env.BRIDGE_HTTP_TOKEN = "test-bridge-secret";
    delete process.env.STUDIO_BRIDGE_TOKEN;
    delete process.env.BRIDGE_TOKEN;
  });

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __testSetActiveRuns(0);
  });

  it("returns 503 for POST /runs while another run is active", async () => {
    const app = createBridgeApp();
    await app.ready();
    const headers = { authorization: "Bearer test-bridge-secret" };
    try {
      __testSetActiveRuns(1);
      assert.equal(__testGetActiveRuns(), 1);

      const busy = await app.inject({
        method: "POST",
        url: "/runs",
        headers,
        payload: {
          raw_requirement: "should be rejected while busy",
          agents_md_path: "auto",
        },
      });
      assert.equal(busy.statusCode, 503);
      assert.equal((busy.json() as { error?: string }).error, "bridge_busy");

      const health = await app.inject({ method: "GET", url: "/health" });
      assert.equal(health.statusCode, 200);
      assert.equal((health.json() as { status?: string }).status, "busy");
    } finally {
      __testSetActiveRuns(0);
      await app.close();
    }
  });
});
