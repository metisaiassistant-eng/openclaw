type ClickUpTaskResponse = {
  id: string;
  name?: string;
  description?: string;
  url?: string;
};

type ClickUpListTasksResponse = {
  tasks?: ClickUpTaskResponse[];
};

const DEDUPE_MARKER_PREFIX = "[[meeting-workflow-dedupe:";

function buildDedupeMarker(dedupeKey: string): string {
  return `${DEDUPE_MARKER_PREFIX}${dedupeKey}]]`;
}

async function requestJson<T>(params: {
  url: string;
  apiKey: string;
  method?: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(params.url, {
    method: params.method ?? "GET",
    headers: {
      Authorization: params.apiKey,
      ...(params.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`clickup api request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function buildDescriptionWithMarker(input: { description: string; dedupeKey: string }): string {
  const marker = buildDedupeMarker(input.dedupeKey);
  return `${marker}\n${input.description}`;
}

function hasDedupeMarker(description: string | undefined, dedupeKey: string): boolean {
  return typeof description === "string" && description.includes(buildDedupeMarker(dedupeKey));
}

export function createClickUpApiClient(params: { apiKey: string }) {
  return {
    async upsertTask(input: {
      dedupeKey: string;
      listId: string;
      name: string;
      description: string;
      assigneeIds?: string[];
      dueDate?: string;
      parentTaskId?: string;
    }): Promise<{ id: string; url?: string }> {
      const listUrl = new URL(`https://api.clickup.com/api/v2/list/${input.listId}/task`);
      listUrl.searchParams.set("subtasks", "true");
      listUrl.searchParams.set("include_closed", "true");
      const listTasks = await requestJson<ClickUpListTasksResponse>({
        url: listUrl.toString(),
        apiKey: params.apiKey,
      });
      const existing = (listTasks.tasks ?? []).find((task) =>
        hasDedupeMarker(task.description, input.dedupeKey),
      );
      if (existing?.id) {
        return { id: existing.id, ...(existing.url ? { url: existing.url } : {}) };
      }

      const body: Record<string, unknown> = {
        name: input.name,
        description: buildDescriptionWithMarker({
          description: input.description,
          dedupeKey: input.dedupeKey,
        }),
      };
      if (input.assigneeIds && input.assigneeIds.length > 0) {
        body.assignees = input.assigneeIds;
      }
      if (input.dueDate) {
        body.due_date = new Date(input.dueDate).getTime();
      }
      if (input.parentTaskId) {
        body.parent = input.parentTaskId;
      }

      const created = await requestJson<ClickUpTaskResponse>({
        url: `https://api.clickup.com/api/v2/list/${input.listId}/task`,
        apiKey: params.apiKey,
        method: "POST",
        body,
      });
      return { id: created.id, ...(created.url ? { url: created.url } : {}) };
    },

    async addComment(taskId: string, text: string): Promise<void> {
      await requestJson({
        url: `https://api.clickup.com/api/v2/task/${taskId}/comment`,
        apiKey: params.apiKey,
        method: "POST",
        body: { comment_text: text },
      });
    },
  };
}
