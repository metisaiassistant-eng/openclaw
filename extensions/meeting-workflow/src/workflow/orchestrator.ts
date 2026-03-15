import type { MeetingInsightsV1 } from "../contracts.js";
import type { MeetingEventV1, MeetingDocV1, TaskResultV1 } from "../contracts.js";
import type { MeetingDocumentStorePort } from "../documents/ports.js";
import type { MeetingActionItemsStep, MeetingSummaryStep } from "../llm/ports.js";
import type { MeetingTaskStorePort } from "../tasks/ports.js";

export type MeetingWorkflowRunResult = {
  meeting: MeetingEventV1;
  insights: MeetingInsightsV1;
  doc: MeetingDocV1;
  tasks: TaskResultV1;
};

export type MeetingWorkflowOrchestrator = {
  run(meeting: MeetingEventV1): Promise<MeetingWorkflowRunResult>;
};

export function createMeetingWorkflowOrchestrator(input: {
  summaryStep: MeetingSummaryStep;
  actionItemsStep: MeetingActionItemsStep;
  documents: MeetingDocumentStorePort;
  tasks: MeetingTaskStorePort;
}): MeetingWorkflowOrchestrator {
  return {
    async run(meeting) {
      const [summary, actionItems] = await Promise.all([
        input.summaryStep.run({ meeting }),
        input.actionItemsStep.run({ meeting }),
      ]);

      const insights: MeetingInsightsV1 = {
        schemaVersion: "meeting-insights-v1",
        meetingId: meeting.meetingId,
        sourceAccountKey: meeting.sourceAccountKey,
        summary,
        actionItems,
      };

      const doc = await input.documents.upsertTranscript(meeting);
      await input.documents.appendInsights({
        meeting,
        doc,
        insights,
      });

      const tasks = await input.tasks.upsertMeetingTasks({
        meeting,
        insights,
      });

      return {
        meeting,
        insights,
        doc,
        tasks,
      };
    },
  };
}
