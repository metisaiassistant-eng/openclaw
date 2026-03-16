import { describe, expect, it } from "vitest";
import {
  buildFathomWebhookSignature,
  buildFathomWebhookSignatureV1,
  verifyFathomWebhookSignature,
} from "./signature.js";

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

  it("accepts current documented webhook signature format", () => {
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const secretPart = Buffer.from("super-secret-key").toString("base64");
    const docsSecret = `whsec_${secretPart}`;
    const signature = buildFathomWebhookSignatureV1({
      secret: docsSecret,
      webhookId: "msg-123",
      webhookTimestamp: timestamp,
      rawBody,
    });

    expect(
      verifyFathomWebhookSignature({
        secret: docsSecret,
        signatureHeader: `v1,${signature}`,
        webhookId: "msg-123",
        webhookTimestamp: timestamp,
        rawBody,
      }),
    ).toBe(true);
  });

  it("rejects stale timestamp in current documented format", () => {
    const staleTimestamp = `${Math.floor(Date.now() / 1000) - 1000}`;
    const secretPart = Buffer.from("super-secret-key").toString("base64");
    const docsSecret = `whsec_${secretPart}`;
    const signature = buildFathomWebhookSignatureV1({
      secret: docsSecret,
      webhookId: "msg-123",
      webhookTimestamp: staleTimestamp,
      rawBody,
    });

    expect(
      verifyFathomWebhookSignature({
        secret: docsSecret,
        signatureHeader: `v1,${signature}`,
        webhookId: "msg-123",
        webhookTimestamp: staleTimestamp,
        rawBody,
      }),
    ).toBe(false);
  });
});
