import { describe, expect, it } from "vitest";
import {
  createClickUpTaskAdapter,
  type ClickUpClient,
  type ClickUpTaskCreateInput,
} from "./adapter.js";

function createMemoryClickUpClient() {
  const createdTasks: ClickUpTaskCreateInput[] = [];
  const comments = new Map<string, string[]>();

  const client: ClickUpClient = {
    async upsertTask(input) {
      createdTasks.push(input);
      const id = `task-${createdTasks.length}`;
      return { id, url: `https://app.clickup.com/t/${id}` };
    },
    async addComment(taskId, text) {
      const bucket = comments.get(taskId) ?? [];
      bucket.push(text);
      comments.set(taskId, bucket);
    },
  };

  return { client, createdTasks, comments };
}

describe("createClickUpTaskAdapter", () => {
  it("creates parent and subtasks for account-specific ClickUp list", async () => {
    const memory = createMemoryClickUpClient();
    const adapter = createClickUpTaskAdapter({
      account: {
        accountKey: "job-a",
        label: "Consulting",
        routePath: "/integrations/source/fathom/job-a/webhook",
        provider: "fathom",
        fathom: { apiKey: "a", webhookSecret: "b", baseUrl: "https://api.fathom.ai/external/v1" },
        tasks: {
          provider: "clickup",
          clickup: { listId: "list-1" },
        },
      },
      client: memory.client,
    });

    const result = await adapter.upsertMeetingTasks({
      meeting: {
        schemaVersion: "meeting-event-v1",
        meetingId: "meeting-1",
        source: "fathom",
        sourceAccountKey: "job-a",
        sourceAccountLabel: "Consulting",
        title: "Weekly sync",
        endedAt: "2026-03-09T18:30:00Z",
        transcript: "...",
        participants: ["Carlos", "Ana"],
      },
      insights: {
        schemaVersion: "meeting-insights-v1",
        meetingId: "meeting-1",
        sourceAccountKey: "job-a",
        summary: "Summary",
        actionItems: [
          {
            title: "Prepare proposal",
            owner: "Carlos Valverde Solera",
            ownerConfidence: "high",
            dueDate: "2026-03-15",
            comments: [{ speaker: "Ana", text: "Include discounts" }],
          },
        ],
      },
    });

    expect(result.createdCount).toBe(1);
    expect(memory.createdTasks).toHaveLength(2);
    expect(memory.comments.get("task-2")).toEqual(["Ana: Include discounts"]);
  });
});
