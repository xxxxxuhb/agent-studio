import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createBridgeApp } from "./server.js";

describe("bridge HTTP auth", () => {
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
  });

  it("allows /health without token and rejects /runs without token", async () => {
    const app = createBridgeApp();
    await app.ready();
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      assert.equal(health.statusCode, 200);

      const denied = await app.inject({
        method: "GET",
        url: "/runs",
      });
      assert.equal(denied.statusCode, 401);

      const ok = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { authorization: "Bearer test-bridge-secret" },
      });
      assert.equal(ok.statusCode, 200);
    } finally {
      await app.close();
    }
  });
});
