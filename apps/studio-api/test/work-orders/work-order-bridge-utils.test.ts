import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveStudioBridgeBase,
  studioReachableBridgeBase,
} from "../../dist/work-orders/work-order-bridge-utils";

describe("Studio Bridge URL resolution", () => {
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
        configured: "http://configured:8787",
      }),
      "http://configured:8787",
    );
  });
});
