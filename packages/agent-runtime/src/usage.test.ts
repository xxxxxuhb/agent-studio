import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUsageMetrics,
  usageFromCursorTokens,
  usageFromQoderResult,
} from "./usage.js";

describe("buildUsageMetrics", () => {
  it("returns undefined when empty", () => {
    assert.equal(buildUsageMetrics({}), undefined);
  });

  it("sums prompt+completion when total missing", () => {
    assert.deepEqual(
      buildUsageMetrics({ prompt_tokens: 10, completion_tokens: 5 }),
      {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    );
  });

  it("keeps explicit total_tokens", () => {
    assert.deepEqual(
      buildUsageMetrics({
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 9,
      }),
      {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 9,
      },
    );
  });
});

describe("usageFromCursorTokens", () => {
  it("maps TokenUsage and cents→USD", () => {
    assert.deepEqual(
      usageFromCursorTokens(
        { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        12.5,
      ),
      {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        cost_usd: 0.125,
      },
    );
  });
});

describe("usageFromQoderResult", () => {
  it("maps usage + total_cost_usd", () => {
    assert.deepEqual(
      usageFromQoderResult({
        usage: { input_tokens: 7, output_tokens: 3 },
        total_cost_usd: 0.0042,
      }),
      {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10,
        cost_usd: 0.0042,
      },
    );
  });
});
