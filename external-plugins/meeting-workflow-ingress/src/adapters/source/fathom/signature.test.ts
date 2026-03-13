import { describe, expect, it } from "vitest";
import { buildFathomWebhookSignature, verifyFathomWebhookSignature } from "./signature.js";

describe("fathom webhook signature", () => {
  const secret = "test-secret";
  const rawBody = JSON.stringify({ meetingId: "abc123" });

  it("accepts a valid signature", () => {
    const signature = buildFathomWebhookSignature(secret, rawBody);
    expect(
      verifyFathomWebhookSignature({
        secret,
        signatureHeader: signature,
        rawBody,
      }),
    ).toBe(true);
  });

  it("accepts valid signature in multipart header", () => {
    const signature = buildFathomWebhookSignature(secret, rawBody);
    expect(
      verifyFathomWebhookSignature({
        secret,
        signatureHeader: `v1=invalid,sha256=${signature}`,
        rawBody,
      }),
    ).toBe(true);
  });

  it("rejects invalid signature", () => {
    expect(
      verifyFathomWebhookSignature({
        secret,
        signatureHeader: "wrong",
        rawBody,
      }),
    ).toBe(false);
  });
});
