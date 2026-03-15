import type { MeetingWorkflowAccountConfig } from "../../config.js";
import type { MeetingActionItemV1, TaskResultV1 } from "../../contracts.js";
import type { MeetingTaskStorePort } from "../ports.js";

export type ClickUpTaskCreateInput = {
  dedupeKey: string;
  listId: string;
  name: string;
  description: string;
  assigneeIds?: string[];
  dueDate?: string;
  parentTaskId?: string;
};

export type ClickUpClient = {
  upsertTask(input: ClickUpTaskCreateInput): Promise<{ id: string; url?: string }>;
  addComment(taskId: string, text: string): Promise<void>;
};

function buildParentDescription(params: {
  meetingTitle: string;
  meetingId: string;
  summary: string;
}): string {
  return [
    `Meeting: ${params.meetingTitle}`,
    `Meeting ID: ${params.meetingId}`,
    "",
    "Summary:",
    params.summary,
  ].join("\n");
}

function buildSubtaskDescription(item: MeetingActionItemV1): string {
  const dueDateLine = item.dueDate ? `Due: ${item.dueDate}` : "Due: not specified";
  const confidenceLine = item.ownerConfidence ? `Owner Confidence: ${item.ownerConfidence}` : "";
  const comments =
    item.comments && item.comments.length > 0
      ? item.comments.map((comment) => `- ${comment.speaker}: ${comment.text}`).join("\n")
      : "- none";
  return [dueDateLine, confidenceLine, "", "Linked comments:", comments]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function createClickUpTaskAdapter(params: {
  account: MeetingWorkflowAccountConfig;
  client: ClickUpClient;
}): MeetingTaskStorePort {
  return {
    id: "clickup",

    async upsertMeetingTasks(input) {
      const listId = params.account.tasks?.clickup?.listId;
      if (!listId) {
        throw new Error(`clickup listId missing for account ${params.account.accountKey}`);
      }
      const assigneeIds = params.account.tasks?.clickup?.assigneeIds;

      const parentTask = await params.client.upsertTask({
        dedupeKey: `meeting:${input.meeting.sourceAccountKey}:${input.meeting.meetingId}:parent`,
        listId,
        name: `Meeting follow-up: ${input.meeting.title}`,
        description: buildParentDescription({
          meetingTitle: input.meeting.title,
          meetingId: input.meeting.meetingId,
          summary: input.insights.summary,
        }),
        assigneeIds,
      });

      const subtaskIds: string[] = [];
      const taskUrls: string[] = [];
      if (parentTask.url) {
        taskUrls.push(parentTask.url);
      }

      for (const [index, actionItem] of input.insights.actionItems.entries()) {
        const subtask = await params.client.upsertTask({
          dedupeKey: `meeting:${input.meeting.sourceAccountKey}:${input.meeting.meetingId}:subtask:${index}:${actionItem.title}`,
          listId,
          parentTaskId: parentTask.id,
          name: actionItem.title,
          description: buildSubtaskDescription(actionItem),
          assigneeIds,
          dueDate: actionItem.dueDate,
        });
        subtaskIds.push(subtask.id);
        if (subtask.url) {
          taskUrls.push(subtask.url);
        }
        if (actionItem.comments) {
          for (const comment of actionItem.comments) {
            await params.client.addComment(subtask.id, `${comment.speaker}: ${comment.text}`);
          }
        }
      }

      const result: TaskResultV1 = {
        schemaVersion: "task-result-v1",
        meetingId: input.meeting.meetingId,
        sourceAccountKey: input.meeting.sourceAccountKey,
        parentTaskId: parentTask.id,
        subtaskIds,
        createdCount: input.insights.actionItems.length,
        ...(taskUrls.length > 0 ? { taskUrls } : {}),
      };
      return result;
    },
  };
}
