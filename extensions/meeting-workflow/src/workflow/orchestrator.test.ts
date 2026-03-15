import { describe, expect, it } from "vitest";
import { createMeetingWorkflowOrchestrator } from "./orchestrator.js";

describe("createMeetingWorkflowOrchestrator", () => {
  it("runs summary, action items, docs, and tasks in order", async () => {
    const orchestrator = createMeetingWorkflowOrchestrator({
      summaryStep: {
        async run() {
          return "Meeting summary";
        },
      },
      actionItemsStep: {
        async run() {
          return [
            {
              title: "Prepare proposal",
              owner: "Carlos",
              ownerConfidence: "high",
            },
          ];
        },
      },
      documents: {
        id: "google_docs",
        async upsertTranscript(input) {
          return {
            schemaVersion: "meeting-doc-v1",
            meetingId: input.meetingId,
            sourceAccountKey: input.sourceAccountKey,
            docId: "doc-1",
            docUrl: "https://docs.example/doc-1",
          };
        },
        async appendInsights() {},
      },
      tasks: {
        id: "clickup",
        async upsertMeetingTasks(input) {
          return {
            schemaVersion: "task-result-v1",
            meetingId: input.meeting.meetingId,
            sourceAccountKey: input.meeting.sourceAccountKey,
            parentTaskId: "task-parent-1",
            subtaskIds: ["task-sub-1"],
            createdCount: 1,
          };
        },
      },
    });

    const result = await orchestrator.run({
      schemaVersion: "meeting-event-v1",
      meetingId: "meeting-1",
      source: "fathom",
      sourceAccountKey: "job-a",
      sourceAccountLabel: "Consulting",
      title: "Weekly sync",
      endedAt: "2026-03-13T18:00:00Z",
      transcript: "Carlos: ship it",
      participants: ["Carlos"],
    });

    expect(result.insights.summary).toBe("Meeting summary");
    expect(result.doc.docId).toBe("doc-1");
    expect(result.tasks.parentTaskId).toBe("task-parent-1");
  });
});
