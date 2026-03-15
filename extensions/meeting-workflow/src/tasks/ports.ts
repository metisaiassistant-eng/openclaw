import type { MeetingEventV1, MeetingInsightsV1, TaskResultV1 } from "../contracts.js";

export type MeetingTaskStorePort = {
  readonly id: string;
  upsertMeetingTasks(input: {
    meeting: MeetingEventV1;
    insights: MeetingInsightsV1;
  }): Promise<TaskResultV1>;
};
