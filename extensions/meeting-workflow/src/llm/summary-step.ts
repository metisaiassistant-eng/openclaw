import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { runMeetingLlmPrompt } from "./embedded-agent.js";
import type { MeetingSummaryStep } from "./ports.js";

export function createMeetingSummaryStep(api: OpenClawPluginApi): MeetingSummaryStep {
  return {
    async run(input) {
      const participants = input.meeting.participants.join(", ");
      const prompt = [
        "Summarize the meeting in 4-8 bullet points.",
        "Focus on decisions, conclusions, and important context.",
        "Do not include markdown headings.",
        "Do not invent details not present in the transcript.",
        "",
        `Meeting ID: ${input.meeting.meetingId}`,
        `Account: ${input.meeting.sourceAccountLabel}`,
        `Title: ${input.meeting.title}`,
        `Ended At: ${input.meeting.endedAt}`,
        `Participants: ${participants}`,
        "",
        "Transcript:",
        input.meeting.transcript,
      ].join("\n");

      return await runMeetingLlmPrompt({
        api,
        sessionKey: `meeting-workflow:summary:${input.meeting.sourceAccountKey}:${input.meeting.meetingId}`,
        prompt,
        modelConfig: input.config,
      });
    },
  };
}
