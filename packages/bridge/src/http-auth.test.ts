import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  bridgeHttpToken,
  extractRequestToken,
} from "./httpAuth.js";
import { createBridgeApp } from "./server.js";

describe("bridgeHttpToken / extractRequestToken", () => {
  const prev = {
    BRIDGE_HTTP_TOKEN: process.env.BRIDGE_HTTP_TOKEN,
    STUDIO_BRIDGE_TOKEN: process.env.STUDIO_BRIDGE_TOKEN,
    BRIDGE_TOKEN: process.env.BRIDGE_TOKEN,
  };

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("prefers BRIDGE_HTTP_TOKEN then STUDIO_BRIDGE_TOKEN then BRIDGE_TOKEN", () => {
    delete process.env.BRIDGE_HTTP_TOKEN;
    delete process.env.STUDIO_BRIDGE_TOKEN;
    delete process.env.BRIDGE_TOKEN;
    assert.equal(bridgeHttpToken(), "");

    process.env.BRIDGE_TOKEN = "legacy";
    assert.equal(bridgeHttpToken(), "legacy");

    process.env.STUDIO_BRIDGE_TOKEN = "studio";
    assert.equal(bridgeHttpToken(), "studio");

    process.env.BRIDGE_HTTP_TOKEN = "primary";
    assert.equal(bridgeHttpToken(), "primary");
  });

  it("reads Bearer and X-Bridge-Token headers", () => {
    assert.equal(
      extractRequestToken({
        headers: { authorization: "Bearer abc" },
      } as never),
      "abc",
    );
    assert.equal(
      extractRequestToken({
        headers: { authorization: "bearer XYZ" },
      } as never),
      "XYZ",
    );
    assert.equal(
      extractRequestToken({
        headers: { "x-bridge-token": "via-header" },
      } as never),
      "via-header",
    );
    assert.equal(
      extractRequestToken({
        headers: { "x-bridge-token": ["first", "second"] },
      } as never),
      "first",
    );
    assert.equal(extractRequestToken({ headers: {} } as never), "");
  });
});

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
      assert.equal((denied.json() as { error?: string }).error, "unauthorized");

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

  it("accepts X-Bridge-Token and rejects wrong tokens", async () => {
    const app = createBridgeApp();
    await app.ready();
    try {
      const wrong = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { authorization: "Bearer wrong" },
      });
      assert.equal(wrong.statusCode, 401);

      const ok = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { "x-bridge-token": "test-bridge-secret" },
      });
      assert.equal(ok.statusCode, 200);
    } finally {
      await app.close();
    }
  });
});

describe("bridge HTTP auth aliases and disabled mode", () => {
  const prev = {
    BRIDGE_HTTP_TOKEN: process.env.BRIDGE_HTTP_TOKEN,
    STUDIO_BRIDGE_TOKEN: process.env.STUDIO_BRIDGE_TOKEN,
    BRIDGE_TOKEN: process.env.BRIDGE_TOKEN,
  };

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("accepts STUDIO_BRIDGE_TOKEN when BRIDGE_HTTP_TOKEN is unset", async () => {
    delete process.env.BRIDGE_HTTP_TOKEN;
    delete process.env.BRIDGE_TOKEN;
    process.env.STUDIO_BRIDGE_TOKEN = "studio-shared-secret";

    const app = createBridgeApp();
    await app.ready();
    try {
      const denied = await app.inject({ method: "GET", url: "/runs" });
      assert.equal(denied.statusCode, 401);

      const ok = await app.inject({
        method: "GET",
        url: "/runs",
        headers: { authorization: "Bearer studio-shared-secret" },
      });
      assert.equal(ok.statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it("allows protected routes when no token is configured", async () => {
    delete process.env.BRIDGE_HTTP_TOKEN;
    delete process.env.STUDIO_BRIDGE_TOKEN;
    delete process.env.BRIDGE_TOKEN;

    const app = createBridgeApp();
    await app.ready();
    try {
      const ok = await app.inject({ method: "GET", url: "/runs" });
      assert.equal(ok.statusCode, 200);
    } finally {
      await app.close();
    }
  });
});
