import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeMeetingEventFingerprint, createMeetingWorkflowStateStore } from "./state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("meeting workflow state store", () => {
  it("writes and reads stored workflow results", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-workflow-state-"));
    tempDirs.push(stateDir);
    const store = createMeetingWorkflowStateStore(stateDir);
    const fingerprint = computeMeetingEventFingerprint({
      meetingId: "meeting-1",
      sourceAccountKey: "job-a",
      title: "Weekly sync",
      endedAt: "2026-03-13T18:00:00Z",
      transcript: "hello",
    });

    await store.write({
      meetingId: "meeting-1",
      sourceAccountKey: "job-a",
      eventFingerprint: fingerprint,
      result: {
        meeting: {
          schemaVersion: "meeting-event-v1",
          meetingId: "meeting-1",
          source: "fathom",
          sourceAccountKey: "job-a",
          sourceAccountLabel: "Consulting",
          title: "Weekly sync",
          endedAt: "2026-03-13T18:00:00Z",
          transcript: "hello",
          participants: ["Carlos"],
        },
        insights: {
          schemaVersion: "meeting-insights-v1",
          meetingId: "meeting-1",
          sourceAccountKey: "job-a",
          summary: "Summary",
          actionItems: [],
        },
        doc: {
          schemaVersion: "meeting-doc-v1",
          meetingId: "meeting-1",
          sourceAccountKey: "job-a",
          docId: "doc-1",
          docUrl: "https://docs.example/doc-1",
        },
        tasks: {
          schemaVersion: "task-result-v1",
          meetingId: "meeting-1",
          sourceAccountKey: "job-a",
          parentTaskId: "task-1",
          subtaskIds: [],
          createdCount: 0,
        },
      },
      savedAt: "2026-03-13T18:00:00Z",
    });

    const stored = await store.read("job-a", "meeting-1");
    expect(stored?.eventFingerprint).toBe(fingerprint);
    expect(stored?.result.doc.docId).toBe("doc-1");
  });
});
