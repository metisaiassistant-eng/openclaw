import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveMeetingWorkflowConfig } from "./config.js";
import { createMeetingActionItemsStep } from "./llm/action-items-step.js";
import type { MeetingLlmStepConfig } from "./llm/ports.js";
import { createMeetingSummaryStep } from "./llm/summary-step.js";
import {
  createMeetingWorkflowRuntime,
  resolveMeetingWorkflowAccount,
} from "./runtime/bootstrap.js";

const MeetingWorkflowAnalyzeSchema = Type.Object(
  {
    meetingId: Type.String(),
    source: Type.String(),
    sourceAccountKey: Type.String(),
    sourceAccountLabel: Type.String(),
    sourceAccountEmail: Type.Optional(Type.String()),
    title: Type.String(),
    endedAt: Type.String(),
    transcript: Type.String(),
    participants: Type.Array(Type.String()),
    summaryModel: Type.Optional(Type.String()),
    summaryThinking: Type.Optional(
      Type.Unsafe<"none" | "low" | "medium" | "high">({
        type: "string",
        enum: ["none", "low", "medium", "high"],
      }),
    ),
    actionItemsModel: Type.Optional(Type.String()),
    actionItemsThinking: Type.Optional(
      Type.Unsafe<"none" | "low" | "medium" | "high">({
        type: "string",
        enum: ["none", "low", "medium", "high"],
      }),
    ),
  },
  { additionalProperties: false },
);

const MeetingWorkflowRunSchema = MeetingWorkflowAnalyzeSchema;

export const MEETING_WORKFLOW_GUIDANCE = [
  "When the meeting-ops agent receives a meeting webhook message, call the meeting-workflow-run tool.",
  "Extract the meeting fields from the webhook message and pass them into the tool exactly.",
  "Use meeting-workflow-analyze only for analysis-only dry runs.",
  "Return the tool result to the operator clearly.",
].join(" ");

function toStepConfig(model: unknown, thinking: unknown): MeetingLlmStepConfig | undefined {
  if (typeof model !== "string" || !model.trim()) {
    return undefined;
  }
  return {
    model,
    ...(thinking === "none" || thinking === "low" || thinking === "medium" || thinking === "high"
      ? { thinking }
      : {}),
  };
}

export function createMeetingWorkflowAnalyzeTool(api: OpenClawPluginApi): AnyAgentTool {
  const summaryStep = createMeetingSummaryStep(api);
  const actionItemsStep = createMeetingActionItemsStep(api);

  return {
    name: "meeting-workflow-analyze",
    label: "Meeting Workflow Analyze",
    description:
      "Analyze a normalized meeting payload and return structured summary plus action items.",
    parameters: MeetingWorkflowAnalyzeSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const meeting = {
        schemaVersion: "meeting-event-v1" as const,
        meetingId: String(params.meetingId ?? ""),
        source: String(params.source ?? ""),
        sourceAccountKey: String(params.sourceAccountKey ?? ""),
        sourceAccountLabel: String(params.sourceAccountLabel ?? ""),
        ...(typeof params.sourceAccountEmail === "string"
          ? { sourceAccountEmail: params.sourceAccountEmail }
          : {}),
        title: String(params.title ?? ""),
        endedAt: String(params.endedAt ?? ""),
        transcript: String(params.transcript ?? ""),
        participants: Array.isArray(params.participants)
          ? params.participants.map((value) => String(value))
          : [],
      };

      const [summary, actionItems] = await Promise.all([
        summaryStep.run({
          meeting,
          config: toStepConfig(params.summaryModel, params.summaryThinking),
        }),
        actionItemsStep.run({
          meeting,
          config: toStepConfig(params.actionItemsModel, params.actionItemsThinking),
        }),
      ]);

      const result = {
        schemaVersion: "meeting-insights-v1",
        meetingId: meeting.meetingId,
        sourceAccountKey: meeting.sourceAccountKey,
        summary,
        actionItems,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { json: result },
      };
    },
  };
}

export function createMeetingWorkflowRunTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: "meeting-workflow-run",
    label: "Meeting Workflow Run",
    description:
      "Run the full meeting workflow: summary, action items, Google Docs update, and ClickUp task creation.",
    parameters: MeetingWorkflowRunSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as Record<string, unknown>;
      const config = resolveMeetingWorkflowConfig(api.pluginConfig);
      const account = resolveMeetingWorkflowAccount({
        config,
        sourceAccountKey:
          typeof params.sourceAccountKey === "string" && params.sourceAccountKey.trim()
            ? params.sourceAccountKey
            : undefined,
        sourceAccountLabel:
          typeof params.sourceAccountLabel === "string" && params.sourceAccountLabel.trim()
            ? params.sourceAccountLabel
            : undefined,
      });
      const meeting = {
        schemaVersion: "meeting-event-v1" as const,
        meetingId: String(params.meetingId ?? ""),
        source: String(params.source ?? ""),
        sourceAccountKey: account.accountKey,
        sourceAccountLabel: account.label,
        ...(account.email ? { sourceAccountEmail: account.email } : {}),
        title: String(params.title ?? ""),
        endedAt: String(params.endedAt ?? ""),
        transcript: String(params.transcript ?? ""),
        participants: Array.isArray(params.participants)
          ? params.participants.map((value) => String(value))
          : [],
      };

      const runtime = createMeetingWorkflowRuntime({
        api,
        config,
        account,
      });
      const result = await runtime.run(meeting);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { json: result },
      };
    },
  };
}
