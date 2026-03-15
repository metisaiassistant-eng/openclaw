type Dict = Record<string, unknown>;

export type SourceInsightActionItemV1 = {
  title: string;
  owner?: string;
  dueDate?: string;
};

export type MeetingSourceInsightsV1 = {
  summary?: string;
  actionItems?: SourceInsightActionItemV1[];
};

export type MeetingEventV1 = {
  schemaVersion: "meeting-event-v1";
  meetingId: string;
  source: string;
  sourceAccountKey: string;
  sourceAccountLabel: string;
  sourceAccountEmail?: string;
  platform?: string;
  title: string;
  endedAt: string;
  transcript: string;
  participants: string[];
  sourceInsights?: MeetingSourceInsightsV1;
};

export type MeetingActionCommentV1 = {
  speaker: string;
  text: string;
};

export type MeetingActionItemV1 = {
  title: string;
  owner: string;
  ownerConfidence?: "low" | "medium" | "high";
  dueDate?: string;
  comments?: MeetingActionCommentV1[];
};

export type MeetingInsightsV1 = {
  schemaVersion: "meeting-insights-v1";
  meetingId: string;
  sourceAccountKey: string;
  summary: string;
  actionItems: MeetingActionItemV1[];
};

export type MeetingDocV1 = {
  schemaVersion: "meeting-doc-v1";
  meetingId: string;
  sourceAccountKey: string;
  docId: string;
  docUrl: string;
  yearFolderId?: string;
  monthFolderId?: string;
  dayFolderId?: string;
};

export type TaskResultV1 = {
  schemaVersion: "task-result-v1";
  meetingId: string;
  sourceAccountKey: string;
  parentTaskId: string;
  subtaskIds: string[];
  createdCount: number;
  taskUrls?: string[];
};

export type MeetingEventValidationResult =
  | { ok: true; value: MeetingEventV1 }
  | { ok: false; errors: string[] };

const MEETING_EVENT_ALLOWED_KEYS = new Set([
  "schemaVersion",
  "meetingId",
  "source",
  "sourceAccountKey",
  "sourceAccountLabel",
  "sourceAccountEmail",
  "platform",
  "title",
  "endedAt",
  "transcript",
  "participants",
  "sourceInsights",
]);

function asObject(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateActionItem(value: unknown): value is SourceInsightActionItemV1 {
  const obj = asObject(value);
  if (!obj) {
    return false;
  }
  if (!isNonEmptyString(obj.title)) {
    return false;
  }
  if (obj.owner !== undefined && !isNonEmptyString(obj.owner)) {
    return false;
  }
  if (obj.dueDate !== undefined && !isNonEmptyString(obj.dueDate)) {
    return false;
  }
  const allowed = new Set(["title", "owner", "dueDate"]);
  return Object.keys(obj).every((key) => allowed.has(key));
}

function validateSourceInsights(value: unknown): value is MeetingSourceInsightsV1 {
  const obj = asObject(value);
  if (!obj) {
    return false;
  }
  if (obj.summary !== undefined && !isNonEmptyString(obj.summary)) {
    return false;
  }
  if (obj.actionItems !== undefined) {
    if (!Array.isArray(obj.actionItems)) {
      return false;
    }
    if (!obj.actionItems.every((item) => validateActionItem(item))) {
      return false;
    }
  }
  const allowed = new Set(["summary", "actionItems"]);
  return Object.keys(obj).every((key) => allowed.has(key));
}

export function validateMeetingEventV1(value: unknown): MeetingEventValidationResult {
  const obj = asObject(value);
  const errors: string[] = [];
  if (!obj) {
    return { ok: false, errors: ["meeting-event-v1 must be an object"] };
  }

  if (obj.schemaVersion !== "meeting-event-v1") {
    errors.push("schemaVersion must be meeting-event-v1");
  }
  if (!isNonEmptyString(obj.meetingId)) {
    errors.push("meetingId is required");
  }
  if (!isNonEmptyString(obj.source)) {
    errors.push("source is required");
  }
  if (!isNonEmptyString(obj.sourceAccountKey)) {
    errors.push("sourceAccountKey is required");
  }
  if (!isNonEmptyString(obj.sourceAccountLabel)) {
    errors.push("sourceAccountLabel is required");
  }
  if (obj.sourceAccountEmail !== undefined && !isNonEmptyString(obj.sourceAccountEmail)) {
    errors.push("sourceAccountEmail must be a non-empty string when provided");
  }
  if (obj.platform !== undefined && !isNonEmptyString(obj.platform)) {
    errors.push("platform must be a non-empty string when provided");
  }
  if (!isNonEmptyString(obj.title)) {
    errors.push("title is required");
  }
  if (!isNonEmptyString(obj.endedAt)) {
    errors.push("endedAt is required");
  }
  if (!isNonEmptyString(obj.transcript)) {
    errors.push("transcript is required");
  }
  if (
    !Array.isArray(obj.participants) ||
    !obj.participants.every((entry) => isNonEmptyString(entry))
  ) {
    errors.push("participants must be an array of non-empty strings");
  }
  if (obj.sourceInsights !== undefined && !validateSourceInsights(obj.sourceInsights)) {
    errors.push("sourceInsights shape is invalid");
  }

  for (const key of Object.keys(obj)) {
    if (!MEETING_EVENT_ALLOWED_KEYS.has(key)) {
      errors.push(`unknown property: ${key}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: obj as MeetingEventV1 };
}

export function assertMeetingEventV1(value: unknown): MeetingEventV1 {
  const result = validateMeetingEventV1(value);
  if (!result.ok) {
    throw new Error(`meeting-event-v1 validation failed: ${result.errors.join("; ")}`);
  }
  return result.value;
}
