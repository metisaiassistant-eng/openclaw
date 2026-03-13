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
  platform?: string;
  title: string;
  endedAt: string;
  transcript: string;
  participants: string[];
  sourceInsights?: MeetingSourceInsightsV1;
};

export type MeetingEventValidationResult =
  | { ok: true; value: MeetingEventV1 }
  | { ok: false; errors: string[] };

const MEETING_EVENT_ALLOWED_KEYS = new Set([
  "schemaVersion",
  "meetingId",
  "source",
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
