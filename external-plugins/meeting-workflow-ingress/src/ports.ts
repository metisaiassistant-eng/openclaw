import type { MeetingEventV1 } from "./contracts.js";

export type MeetingFallbackInput = {
  meetingId?: string;
  startedAfter?: string;
  startedBefore?: string;
};

export type MeetingSourcePort = {
  readonly id: string;
  verifyInbound(headers: Record<string, string>, rawBody: string | Buffer): Promise<void>;
  normalizeInbound(rawBody: string | Buffer): Promise<MeetingEventV1>;
  fetchMeetingFallback(input: MeetingFallbackInput): Promise<MeetingEventV1 | null>;
};
