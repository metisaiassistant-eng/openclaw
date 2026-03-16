import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MeetingLlmStepConfig } from "./ports.js";
import { isMeaningfulMeetingLlmText, sanitizeMeetingLlmText } from "./sanitize.js";

type SessionMessageTextPart = { type?: string; text?: string };

function extractTextFromUnknownMessage(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as Record<string, unknown>;
  const role = record.role;
  if (role !== "assistant") {
    return "";
  }
  const content = record.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const item = part as SessionMessageTextPart;
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join("\n")
    .trim();
}

function buildExtraSystemPrompt(config?: MeetingLlmStepConfig): string {
  const lines = [
    "You are executing a meeting workflow extraction step.",
    "Follow the task exactly and keep the response concise.",
    "Never output OpenClaw control tags or messaging directives.",
    "Never output [[reply_to_current]], [[final]], [[thinking]], or NO_REPLY.",
    "Return only the requested content.",
  ];
  if (config?.model) {
    lines.push(`Preferred model: ${config.model}`);
  }
  if (config?.thinking) {
    lines.push(`Preferred thinking level: ${config.thinking}`);
  }
  return lines.join("\n");
}

export async function runMeetingLlmPrompt(params: {
  api: OpenClawPluginApi;
  sessionKey: string;
  prompt: string;
  modelConfig?: MeetingLlmStepConfig;
  timeoutMs?: number;
}): Promise<string> {
  const run = await params.api.runtime.subagent.run({
    sessionKey: params.sessionKey,
    message: params.prompt,
    extraSystemPrompt: buildExtraSystemPrompt(params.modelConfig),
    deliver: false,
    idempotencyKey: `${params.sessionKey}:${params.prompt.length}`,
  });
  const waitResult = await params.api.runtime.subagent.waitForRun({
    runId: run.runId,
    timeoutMs: params.timeoutMs ?? 60_000,
  });
  if (waitResult.status !== "ok") {
    throw new Error(
      waitResult.error
        ? `meeting workflow LLM run failed: ${waitResult.error}`
        : `meeting workflow LLM run ended with status ${waitResult.status}`,
    );
  }

  const session = await params.api.runtime.subagent.getSessionMessages({
    sessionKey: params.sessionKey,
    limit: 20,
  });
  const assistantText = [...session.messages]
    .reverse()
    .map((message) => sanitizeMeetingLlmText(extractTextFromUnknownMessage(message)))
    .find((text) => isMeaningfulMeetingLlmText(text));

  if (!assistantText) {
    throw new Error("Meeting workflow LLM step returned empty output");
  }
  return assistantText;
}
