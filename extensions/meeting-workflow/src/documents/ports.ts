import type { MeetingDocV1, MeetingEventV1, MeetingInsightsV1 } from "../contracts.js";

export type MeetingDocumentStorePort = {
  readonly id: string;
  upsertTranscript(input: MeetingEventV1): Promise<MeetingDocV1>;
  appendInsights(input: {
    meeting: MeetingEventV1;
    doc: MeetingDocV1;
    insights: MeetingInsightsV1;
  }): Promise<void>;
};
