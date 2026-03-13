import { createHmac, timingSafeEqual } from "node:crypto";

function normalizeSignatureCandidates(rawHeader: string): string[] {
  return rawHeader
    .split(",")
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

export function buildFathomWebhookSignature(secret: string, rawBody: string | Buffer): string {
  const bodyBuffer = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  return createHmac("sha256", secret).update(bodyBuffer).digest("base64");
}

export function verifyFathomWebhookSignature(params: {
  secret: string;
  signatureHeader: string;
  rawBody: string | Buffer;
}): boolean {
  const expected = buildFathomWebhookSignature(params.secret, params.rawBody);
  const candidates = normalizeSignatureCandidates(params.signatureHeader);
  if (candidates.length === 0) {
    return false;
  }
  return candidates.some((candidate) => safeCompare(candidate, expected));
}
