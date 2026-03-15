import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MeetingActionItemV1 } from "../contracts.js";
import type { MeetingActionItemsStep } from "./ports.js";
import { runMeetingLlmPrompt } from "./subagent-runner.js";

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match?.[1] ?? trimmed).trim();
}

function extractJsonCandidate(raw: string): string | null {
  const stripped = stripCodeFences(raw);
  if (!stripped) {
    return null;
  }
  if (stripped.startsWith("[") || stripped.startsWith("{")) {
    return stripped;
  }

  const arrayStart = stripped.indexOf("[");
  const arrayEnd = stripped.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return stripped.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return stripped.slice(objectStart, objectEnd + 1);
  }

  return null;
}

function validateConfidence(value: unknown): "low" | "medium" | "high" | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeActionItems(value: unknown): MeetingActionItemV1[] {
  if (!Array.isArray(value)) {
    throw new Error("action items output must be an array");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`action item ${index} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const owner = typeof record.owner === "string" ? record.owner.trim() : "";
    if (!title) {
      throw new Error(`action item ${index} missing title`);
    }
    if (!owner) {
      throw new Error(`action item ${index} missing owner`);
    }
    const commentsRaw = record.comments;
    const comments = Array.isArray(commentsRaw)
      ? commentsRaw.map((comment, commentIndex) => {
          if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
            throw new Error(`action item ${index} comment ${commentIndex} must be an object`);
          }
          const speaker = typeof comment.speaker === "string" ? comment.speaker.trim() : "";
          const text = typeof comment.text === "string" ? comment.text.trim() : "";
          if (!speaker || !text) {
            throw new Error(
              `action item ${index} comment ${commentIndex} requires speaker and text`,
            );
          }
          return { speaker, text };
        })
      : undefined;

    return {
      title,
      owner,
      ownerConfidence: validateConfidence(record.ownerConfidence),
      dueDate:
        typeof record.dueDate === "string" && record.dueDate.trim()
          ? record.dueDate.trim()
          : undefined,
      ...(comments && comments.length > 0 ? { comments } : {}),
    };
  });
}

function fromSourceInsights(input: unknown): MeetingActionItemV1[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: MeetingActionItemV1[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) {
      continue;
    }
    const owner =
      typeof record.owner === "string" && record.owner.trim() ? record.owner.trim() : "Unassigned";
    const dueDate =
      typeof record.dueDate === "string" && record.dueDate.trim()
        ? record.dueDate.trim()
        : undefined;
    out.push({
      title,
      owner,
      ownerConfidence: owner === "Unassigned" ? "low" : "medium",
      ...(dueDate ? { dueDate } : {}),
    });
  }
  return out;
}

export function createMeetingActionItemsStep(api: OpenClawPluginApi): MeetingActionItemsStep {
  return {
    async run(input) {
      const participants = input.meeting.participants.join(", ");
      const prompt = [
        "Extract action items from the meeting transcript.",
        "Return ONLY valid JSON.",
        "Return STRICT JSON.",
        "Return a JSON array.",
        "Do not include prose before or after the JSON.",
        "Do not include markdown fences.",
        "Do not include comments.",
        "Do not include trailing commas.",
        "Each item must include: title, owner, ownerConfidence, dueDate, comments.",
        'ownerConfidence must be one of: "low", "medium", "high".',
        "If the owner is ambiguous, still choose the best owner and set ownerConfidence to low.",
        "Use comments as an array of {speaker, text} objects only when useful.",
        "Response format example:",
        '[{"title":"Prepare proposal","owner":"Carlos Valverde Solera","ownerConfidence":"high","dueDate":"2026-03-20","comments":[{"speaker":"Ana","text":"Include discounts."}]}]',
        "",
        `Meeting ID: ${input.meeting.meetingId}`,
        `Account: ${input.meeting.sourceAccountLabel}`,
        `Title: ${input.meeting.title}`,
        `Participants: ${participants}`,
        "",
        "Transcript:",
        input.meeting.transcript,
      ].join("\n");

      const raw = await runMeetingLlmPrompt({
        api,
        sessionKey: `meeting-workflow:action-items:${input.meeting.sourceAccountKey}:${input.meeting.meetingId}`,
        prompt,
        modelConfig: input.config,
      });

      let parsed: unknown;
      try {
        const candidate = extractJsonCandidate(raw);
        if (!candidate) {
          throw new Error("no json candidate");
        }
        parsed = JSON.parse(candidate);
      } catch {
        const fallback = fromSourceInsights(input.meeting.sourceInsights?.actionItems);
        if (fallback.length > 0) {
          return fallback;
        }
        return [];
      }

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record.actionItems)) {
          return normalizeActionItems(record.actionItems);
        }
      }

      return normalizeActionItems(parsed);
    },
  };
}
