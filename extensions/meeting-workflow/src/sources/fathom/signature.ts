import { createHmac, timingSafeEqual } from "node:crypto";

function normalizeSignatureCandidates(rawHeader: string): string[] {
  return rawHeader
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const splitIndex = part.indexOf("=");
      if (splitIndex <= 0 || splitIndex >= part.length - 1) {
        return part;
      }
      const left = part.slice(0, splitIndex).trim();
      const right = part.slice(splitIndex + 1).trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(left) || right.startsWith("=")) {
        return part;
      }
      return right;
    })
    .filter((part) => part.length > 0);
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeWebhookSecret(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) {
    return Buffer.from(secret);
  }
  const encoded = secret.slice("whsec_".length);
  return Buffer.from(encoded, "base64");
}

function isTimestampWithinTolerance(webhookTimestamp: string, toleranceSeconds = 300): boolean {
  const timestamp = Number.parseInt(webhookTimestamp, 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const currentTimestamp = Math.floor(Date.now() / 1000);
  return Math.abs(currentTimestamp - timestamp) <= toleranceSeconds;
}

export function buildFathomWebhookSignature(secret: string, rawBody: string | Buffer): string {
  const bodyBuffer = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  return createHmac("sha256", secret).update(bodyBuffer).digest("base64");
}

export function buildFathomWebhookSignatureV1(params: {
  secret: string;
  webhookId: string;
  webhookTimestamp: string;
  rawBody: string | Buffer;
}): string {
  const body =
    typeof params.rawBody === "string" ? params.rawBody : params.rawBody.toString("utf8");
  const signedContent = `${params.webhookId}.${params.webhookTimestamp}.${body}`;
  return createHmac("sha256", decodeWebhookSecret(params.secret))
    .update(signedContent)
    .digest("base64");
}

export function verifyFathomWebhookSignature(params: {
  secret: string;
  signatureHeader: string;
  rawBody: string | Buffer;
  webhookId?: string;
  webhookTimestamp?: string;
}): boolean {
  const candidates = normalizeSignatureCandidates(params.signatureHeader);
  if (candidates.length === 0) {
    return false;
  }

  if (params.webhookId && params.webhookTimestamp) {
    if (!isTimestampWithinTolerance(params.webhookTimestamp)) {
      return false;
    }
    const expected = buildFathomWebhookSignatureV1({
      secret: params.secret,
      webhookId: params.webhookId,
      webhookTimestamp: params.webhookTimestamp,
      rawBody: params.rawBody,
    });
    return candidates.some((candidate) => safeCompare(candidate, expected));
  }

  const expected = buildFathomWebhookSignature(params.secret, params.rawBody);
  return candidates.some((candidate) => safeCompare(candidate, expected));
}
