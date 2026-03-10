import type {
  MeetingEventV1,
  MeetingSourceInsightsV1,
  SourceInsightActionItemV1,
} from "../../../contracts.js";

type Dict = Record<string, unknown>;

function asObject(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function firstString(value: Dict, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = asString(value[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function parseParticipants(rawParticipants: unknown): string[] {
  if (!Array.isArray(rawParticipants)) {
    return [];
  }
  return rawParticipants
    .map((participant) => {
      if (typeof participant === "string") {
        return participant.trim();
      }
      const participantObj = asObject(participant);
      if (!participantObj) {
        return "";
      }
      return (
        asString(participantObj.name) ??
        asString(participantObj.display_name) ??
        asString(participantObj.email) ??
        ""
      );
    })
    .filter((participant) => participant.length > 0);
}

function parseTranscript(raw: Dict): string | undefined {
  const transcript = raw.transcript;
  if (typeof transcript === "string" && transcript.trim()) {
    return transcript.trim();
  }

  const transcriptObj = asObject(transcript);
  const transcriptText = transcriptObj ? asString(transcriptObj.text) : undefined;
  if (transcriptText) {
    return transcriptText;
  }

  const segments = transcriptObj?.segments;
  if (!Array.isArray(segments)) {
    return undefined;
  }
  const text = segments
    .map((segment) => {
      const segmentObj = asObject(segment);
      return segmentObj ? (asString(segmentObj.text) ?? "") : "";
    })
    .filter((segment) => segment.length > 0)
    .join("\n");
  return text.trim() || undefined;
}

function parseSummary(raw: Dict): string | undefined {
  const summary = raw.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  const summaryObj = asObject(summary);
  return summaryObj ? asString(summaryObj.text) : undefined;
}

function parseActionItems(raw: Dict): SourceInsightActionItemV1[] | undefined {
  const itemsRaw = raw.action_items ?? raw.actionItems;
  if (!Array.isArray(itemsRaw)) {
    return undefined;
  }
  const items = itemsRaw
    .map((item) => {
      if (typeof item === "string") {
        return { title: item.trim() };
      }
      const itemObj = asObject(item);
      if (!itemObj) {
        return null;
      }
      const title =
        asString(itemObj.title) ?? asString(itemObj.text) ?? asString(itemObj.action_item) ?? "";
      if (!title) {
        return null;
      }
      return {
        title,
        owner: asString(itemObj.owner) ?? asString(itemObj.assignee),
        dueDate: asString(itemObj.due_date) ?? asString(itemObj.dueDate),
      };
    })
    .filter((item): item is SourceInsightActionItemV1 => item !== null && item.title.length > 0);
  return items.length > 0 ? items : undefined;
}

function parseSourceInsights(raw: Dict): MeetingSourceInsightsV1 | undefined {
  const summary = parseSummary(raw);
  const actionItems = parseActionItems(raw);
  if (!summary && !actionItems) {
    return undefined;
  }
  return {
    ...(summary ? { summary } : {}),
    ...(actionItems ? { actionItems } : {}),
  };
}

function ensureParticipantFallback(participants: string[], sourceTitle: string): string[] {
  if (participants.length > 0) {
    return participants;
  }
  return [sourceTitle || "Unknown Participant"];
}

export function mapFathomPayloadToMeetingEvent(payload: unknown): MeetingEventV1 {
  const obj = asObject(payload);
  if (!obj) {
    throw new Error("fathom payload must be an object");
  }

  const meetingId = firstString(obj, [
    "meeting_id",
    "meetingId",
    "recording_id",
    "recordingId",
    "id",
  ]);
  const title = firstString(obj, ["title", "name", "meeting_title", "meetingTitle"]);
  const endedAt = firstString(obj, [
    "ended_at",
    "endedAt",
    "end_time",
    "endTime",
    "recorded_at",
    "recordedAt",
  ]);
  const transcript = parseTranscript(obj);

  if (!meetingId) {
    throw new Error("fathom payload missing meeting id");
  }
  if (!title) {
    throw new Error("fathom payload missing title");
  }
  if (!endedAt) {
    throw new Error("fathom payload missing endedAt");
  }
  if (!transcript) {
    throw new Error("fathom payload missing transcript");
  }

  const participants = ensureParticipantFallback(parseParticipants(obj.participants), title);

  return {
    schemaVersion: "meeting-event-v1",
    meetingId,
    source: "fathom",
    platform: firstString(obj, ["platform", "meeting_platform", "meetingPlatform"]),
    title,
    endedAt,
    transcript,
    participants,
    sourceInsights: parseSourceInsights(obj),
  };
}
