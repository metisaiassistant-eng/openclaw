import type { MeetingIngressPluginConfig } from "../../../config.js";
import { assertMeetingEventV1 } from "../../../contracts.js";
import type { MeetingFallbackInput, MeetingSourcePort } from "../../../ports.js";
import { fetchFathomMeetingFallback } from "./fallback.js";
import { mapFathomPayloadToMeetingEvent } from "./mapper.js";
import { verifyFathomWebhookSignature } from "./signature.js";

function readHeader(headers: Record<string, string>, headerName: string): string | undefined {
  const direct = headers[headerName];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const target = headerName.toLowerCase();
  const entry = Object.entries(headers).find(
    ([key, value]) => key.toLowerCase() === target && typeof value === "string" && value.trim(),
  );
  return entry?.[1].trim();
}

function parseJson(rawBody: string | Buffer): unknown {
  const text = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("fathom payload is not valid JSON");
  }
}

export function createFathomSourceAdapter(
  config: MeetingIngressPluginConfig["source"]["fathom"],
  fetchImpl?: typeof fetch,
): MeetingSourcePort {
  return {
    id: "fathom",

    async verifyInbound(headers, rawBody) {
      const signature = readHeader(headers, "webhook-signature");
      if (!signature) {
        throw new Error("fathom webhook missing webhook-signature header");
      }
      const valid = verifyFathomWebhookSignature({
        secret: config.webhookSecret,
        signatureHeader: signature,
        rawBody,
      });
      if (!valid) {
        throw new Error("fathom webhook signature verification failed");
      }
    },

    async normalizeInbound(rawBody) {
      const payload = parseJson(rawBody);
      return assertMeetingEventV1(mapFathomPayloadToMeetingEvent(payload));
    },

    async fetchMeetingFallback(input: MeetingFallbackInput) {
      const meeting = await fetchFathomMeetingFallback({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        meetingId: input.meetingId,
        startedAfter: input.startedAfter,
        startedBefore: input.startedBefore,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      return meeting ? assertMeetingEventV1(meeting) : null;
    },
  };
}
