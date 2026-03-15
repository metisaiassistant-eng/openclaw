import type { MeetingEventV1, MeetingInsightsV1 } from "../contracts.js";

export type MeetingLlmStepConfig = {
  model: string;
  thinking?: "none" | "low" | "medium" | "high";
};

export type MeetingSummaryStep = {
  run(input: { meeting: MeetingEventV1; config?: MeetingLlmStepConfig }): Promise<string>;
};

export type MeetingActionItemsStep = {
  run(input: {
    meeting: MeetingEventV1;
    config?: MeetingLlmStepConfig;
  }): Promise<MeetingInsightsV1["actionItems"]>;
};
