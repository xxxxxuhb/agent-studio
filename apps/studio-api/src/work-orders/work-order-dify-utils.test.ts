import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultDifyUserForWorkOrder,
  difyFacingBridgeBase,
  isDifyRemoteTerminal,
  isHumanFormExpired,
  isInvalidOrExpiredHumanFormError,
  isTransientDifyFailure,
  resolveDifyBridgeBase,
  shouldClearFormTokenOnRemoteStatus,
} from "./work-order-dify-utils.js";

describe("human form / form_token helpers", () => {
  it("builds stable dify user ids", () => {
    assert.equal(defaultDifyUserForWorkOrder("wo-1"), "work-order:wo-1");
  });

  it("treats only terminal remote statuses as form-clearing", () => {
    assert.equal(shouldClearFormTokenOnRemoteStatus("running"), false);
    assert.equal(shouldClearFormTokenOnRemoteStatus("paused"), false);
    assert.equal(shouldClearFormTokenOnRemoteStatus("succeeded"), true);
    assert.equal(shouldClearFormTokenOnRemoteStatus("failed"), true);
    assert.equal(isDifyRemoteTerminal("partial-succeeded"), true);
  });

  it("detects expired forms in seconds or milliseconds", () => {
    const now = 1_700_000_000_000;
    assert.equal(isHumanFormExpired(null, now), false);
    assert.equal(isHumanFormExpired(undefined, now), false);
    assert.equal(isHumanFormExpired(Math.floor(now / 1000) - 10, now), true);
    assert.equal(isHumanFormExpired(Math.floor(now / 1000) + 60, now), false);
    assert.equal(isHumanFormExpired(now - 1, now), true);
    assert.equal(isHumanFormExpired(now + 60_000, now), false);
  });

  it("classifies invalid/expired human-form errors", () => {
    assert.equal(
      isInvalidOrExpiredHumanFormError("Dify get human form failed: 404"),
      true,
    );
    assert.equal(
      isInvalidOrExpiredHumanFormError("form token has expired"),
      true,
    );
    assert.equal(
      isInvalidOrExpiredHumanFormError("Dify get run failed (network): timeout"),
      false,
    );
  });

  it("detects transient bridge/network failures", () => {
    assert.equal(isTransientDifyFailure("HTTP 503"), true);
    assert.equal(isTransientDifyFailure("fetch failed"), true);
    assert.equal(isTransientDifyFailure("validation error"), false);
  });

  it("rewrites loopback for Dify-facing Bridge URL", () => {
    assert.equal(
      difyFacingBridgeBase("http://127.0.0.1:8787"),
      "http://host.docker.internal:8787",
    );
    assert.equal(
      resolveDifyBridgeBase({
        registeredBaseUrl: "http://127.0.0.1:8787",
        configured: "http://host.docker.internal:9999",
      }),
      "http://host.docker.internal:8787",
    );
  });
});
