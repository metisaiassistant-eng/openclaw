import type { IncomingMessage, ServerResponse } from "node:http";
import type { MeetingEventV1 } from "../contracts.js";
import type { MeetingSourcePort } from "../ports.js";
import { readRawBody } from "./read-body.js";
import { collectStringHeaders, sendJson } from "./response.js";

export type MeetingIngressForwardConfig = {
  hooksBaseUrl: string;
  hooksPath: string;
  hooksToken: string;
  timeoutMs: number;
};

export type MeetingIngressHttpHandlerInput = {
  sourceAdapter: MeetingSourcePort;
  forward: MeetingIngressForwardConfig;
  maxBodyBytes: number;
  fetchImpl?: typeof fetch;
};

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseMeetingIdHint(rawBody: Buffer): string | undefined {
  const text = rawBody.toString("utf8");
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidate =
      parsed.meetingId ??
      parsed.meeting_id ??
      parsed.recordingId ??
      parsed.recording_id ??
      parsed.id;
    return typeof candidate === "string" && candidate.trim().length > 0
      ? candidate.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function normalizeWithFallback(params: {
  sourceAdapter: MeetingSourcePort;
  rawBody: Buffer;
}): Promise<{ event: MeetingEventV1; usedFallback: boolean }> {
  try {
    const event = await params.sourceAdapter.normalizeInbound(params.rawBody);
    return { event, usedFallback: false };
  } catch (error) {
    const meetingIdHint = parseMeetingIdHint(params.rawBody);
    if (!meetingIdHint) {
      throw error;
    }
    const fallback = await params.sourceAdapter.fetchMeetingFallback({ meetingId: meetingIdHint });
    if (!fallback) {
      throw error;
    }
    return { event: fallback, usedFallback: true };
  }
}

async function forwardEvent(params: {
  event: MeetingEventV1;
  forward: MeetingIngressForwardConfig;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  const endpoint = `${stripTrailingSlash(params.forward.hooksBaseUrl)}${params.forward.hooksPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, params.forward.timeoutMs);

  try {
    return await params.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.forward.hooksToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.event),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createMeetingIngressHttpHandler(input: MeetingIngressHttpHandlerInput) {
  const fetchImpl = input.fetchImpl ?? fetch;

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "POST") {
      sendJson(res, 405, {
        ok: false,
        error: "method not allowed",
      });
      return true;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req, input.maxBodyBytes);
    } catch (error) {
      sendJson(res, 413, {
        ok: false,
        error: `invalid request body: ${String(error)}`,
      });
      return true;
    }

    const headers = collectStringHeaders(req.headers);

    try {
      await input.sourceAdapter.verifyInbound(headers, rawBody);
    } catch (error) {
      sendJson(res, 401, {
        ok: false,
        error: `source signature verification failed: ${String(error)}`,
      });
      return true;
    }

    let normalized: { event: MeetingEventV1; usedFallback: boolean };
    try {
      normalized = await normalizeWithFallback({
        sourceAdapter: input.sourceAdapter,
        rawBody,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: `source payload normalization failed: ${String(error)}`,
      });
      return true;
    }

    let forwardResponse: Response;
    try {
      forwardResponse = await forwardEvent({
        event: normalized.event,
        forward: input.forward,
        fetchImpl,
      });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        error: `failed to forward payload to hooks endpoint: ${String(error)}`,
      });
      return true;
    }

    if (!forwardResponse.ok) {
      sendJson(res, 502, {
        ok: false,
        error: `hooks endpoint returned status ${forwardResponse.status}`,
      });
      return true;
    }

    sendJson(res, 202, {
      ok: true,
      sourceProvider: input.sourceAdapter.id,
      meetingId: normalized.event.meetingId,
      usedFallback: normalized.usedFallback,
    });
    return true;
  };
}
