import type { MeetingEventV1 } from "../../../contracts.js";
import { mapFathomPayloadToMeetingEvent } from "./mapper.js";

type Dict = Record<string, unknown>;

export type FathomMeetingsFallbackInput = {
  baseUrl: string;
  apiKey: string;
  meetingId?: string;
  startedAfter?: string;
  startedBefore?: string;
  fetchImpl?: typeof fetch;
};

type FathomMeetingsPage = {
  meetings: unknown[];
  nextCursor?: string;
};

const RETRY_STATUSES = new Set([429]);

function asObject(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractPage(payload: unknown): FathomMeetingsPage {
  const obj = asObject(payload);
  if (!obj) {
    return { meetings: [] };
  }

  const meetings = Array.isArray(obj.meetings)
    ? obj.meetings
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(obj.results)
        ? obj.results
        : [];
  const paging = asObject(obj.paging);
  const nextCursor =
    asString(obj.next_cursor) ??
    asString(obj.nextCursor) ??
    asString(paging?.next_cursor) ??
    asString(paging?.nextCursor);

  return { meetings, nextCursor };
}

function buildMeetingsUrl(params: {
  baseUrl: string;
  startedAfter?: string;
  startedBefore?: string;
  cursor?: string;
}): string {
  const url = new URL(
    "meetings",
    params.baseUrl.endsWith("/") ? params.baseUrl : `${params.baseUrl}/`,
  );
  url.searchParams.set("include_transcript", "true");
  if (params.startedAfter) {
    url.searchParams.set("created_after", params.startedAfter);
  }
  if (params.startedBefore) {
    url.searchParams.set("created_before", params.startedBefore);
  }
  if (params.cursor) {
    url.searchParams.set("next_cursor", params.cursor);
  }
  return url.toString();
}

async function fetchPageWithRetry(params: {
  url: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  maxRetries?: number;
}): Promise<FathomMeetingsPage> {
  const maxRetries = params.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await params.fetchImpl(params.url, {
      method: "GET",
      headers: {
        "X-Api-Key": params.apiKey,
      },
    });

    if (response.ok) {
      const body = (await response.json()) as unknown;
      return extractPage(body);
    }

    if (response.status === 400) {
      throw new Error("fathom fallback request failed with 400 (invalid parameters)");
    }
    if (response.status === 401) {
      throw new Error("fathom fallback request failed with 401 (invalid api key)");
    }
    if (!RETRY_STATUSES.has(response.status) || attempt === maxRetries) {
      throw new Error(`fathom fallback request failed with status ${response.status}`);
    }

    const delayMs = 250 * 2 ** attempt;
    await sleep(delayMs);
  }

  throw new Error("fathom fallback request failed after retry budget exhausted");
}

export async function fetchFathomMeetingFallback(
  input: FathomMeetingsFallbackInput,
): Promise<MeetingEventV1 | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let cursor: string | undefined;

  while (true) {
    const url = buildMeetingsUrl({
      baseUrl: input.baseUrl,
      startedAfter: input.startedAfter,
      startedBefore: input.startedBefore,
      cursor,
    });

    const page = await fetchPageWithRetry({
      url,
      apiKey: input.apiKey,
      fetchImpl,
    });

    for (const rawMeeting of page.meetings) {
      let mapped: MeetingEventV1;
      try {
        mapped = mapFathomPayloadToMeetingEvent(rawMeeting);
      } catch {
        continue;
      }
      if (input.meetingId && mapped.meetingId !== input.meetingId) {
        continue;
      }
      return mapped;
    }

    if (!page.nextCursor) {
      return null;
    }
    cursor = page.nextCursor;
  }
}
