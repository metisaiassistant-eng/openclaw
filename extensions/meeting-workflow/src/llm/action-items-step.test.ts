import { describe, expect, it, vi } from "vitest";
import { createMeetingActionItemsStep } from "./action-items-step.js";

describe("createMeetingActionItemsStep", () => {
  it("falls back to source insights when llm output is not valid json", async () => {
    const step = createMeetingActionItemsStep({
      runtime: {
        subagent: {
          async run() {
            return { runId: "run-1" };
          },
          async waitForRun() {
            return { status: "ok" as const };
          },
          async getSessionMessages() {
            return {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "not json" }],
                },
              ],
            };
          },
          async getSession() {
            return { messages: [] };
          },
          async deleteSession() {},
        },
      },
    } as never);

    const result = await step.run({
      meeting: {
        schemaVersion: "meeting-event-v1",
        meetingId: "meeting-1",
        source: "fathom",
        sourceAccountKey: "job-a",
        sourceAccountLabel: "Consulting",
        title: "Weekly sync",
        endedAt: "2026-03-15T23:00:00Z",
        transcript: "hello",
        participants: ["Carlos"],
        sourceInsights: {
          actionItems: [{ title: "Prepare proposal", owner: "Carlos" }],
        },
      },
    });

    expect(result).toEqual([
      {
        title: "Prepare proposal",
        owner: "Carlos",
        ownerConfidence: "medium",
      },
    ]);
  });

  it("extracts json array embedded inside text", async () => {
    const step = createMeetingActionItemsStep({
      runtime: {
        subagent: {
          async run() {
            return { runId: "run-2" };
          },
          async waitForRun() {
            return { status: "ok" as const };
          },
          async getSessionMessages() {
            return {
              messages: [
                {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: 'Here you go:\n[{"title":"Prepare proposal","owner":"Carlos","ownerConfidence":"high"}]',
                    },
                  ],
                },
              ],
            };
          },
          async getSession() {
            return { messages: [] };
          },
          async deleteSession() {},
        },
      },
    } as never);

    const result = await step.run({
      meeting: {
        schemaVersion: "meeting-event-v1",
        meetingId: "meeting-2",
        source: "fathom",
        sourceAccountKey: "job-a",
        sourceAccountLabel: "Consulting",
        title: "Weekly sync",
        endedAt: "2026-03-15T23:00:00Z",
        transcript: "hello",
        participants: ["Carlos"],
      },
    });

    expect(result[0]?.title).toBe("Prepare proposal");
    expect(result[0]?.ownerConfidence).toBe("high");
  });
});
