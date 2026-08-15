import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedAttachmentContentType,
  sanitizeAttachmentFilename,
  WORK_ORDER_ATTACHMENT_MAX_BYTES,
} from "@agent-studio/agent-schema";

describe("work-order attachments helpers", () => {
  it("sanitizes filename to basename", () => {
    assert.equal(sanitizeAttachmentFilename("../../a b.png"), "a_b.png");
    assert.equal(sanitizeAttachmentFilename("说明.pdf"), "说明.pdf");
  });

  it("allowlists image pdf text", () => {
    assert.equal(isAllowedAttachmentContentType("image/png", "a.png"), true);
    assert.equal(isAllowedAttachmentContentType("application/pdf", "a.pdf"), true);
    assert.equal(isAllowedAttachmentContentType("text/plain", "a.log"), true);
    assert.equal(
      isAllowedAttachmentContentType("application/zip", "a.zip"),
      false,
    );
  });

  it("exposes 5MB cap", () => {
    assert.equal(WORK_ORDER_ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024);
  });
});
