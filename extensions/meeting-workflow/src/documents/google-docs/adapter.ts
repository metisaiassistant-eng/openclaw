import type { MeetingWorkflowAccountConfig } from "../../config.js";
import type { MeetingDocV1, MeetingEventV1, MeetingInsightsV1 } from "../../contracts.js";
import type { MeetingDocumentStorePort } from "../ports.js";

export type GoogleDocsClient = {
  ensureFolder(input: { parentId: string; name: string }): Promise<{ id: string }>;
  upsertDocument(input: {
    parentId: string;
    meetingId: string;
    title: string;
  }): Promise<{ id: string; url: string }>;
  replaceDocumentBody(input: { docId: string; body: string }): Promise<void>;
  appendDocumentBody(input: { docId: string; body: string }): Promise<void>;
  getDocumentBody?: (docId: string) => Promise<string>;
};

function formatDateParts(
  endedAt: string,
  timeZone?: string,
): { year: string; month: string; day: string } {
  const date = new Date(endedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid endedAt timestamp: ${endedAt}`);
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const monthPart = parts.find((part) => part.type === "month")?.value;
  const dayPart = parts.find((part) => part.type === "day")?.value;
  if (!year || !monthPart || !dayPart) {
    throw new Error(`failed to derive date parts for ${endedAt}`);
  }
  const month = `${year}-${monthPart}`;
  const day = `${month}-${dayPart}`;
  return { year, month, day };
}

function buildTranscriptBody(input: MeetingEventV1): string {
  const participants =
    input.participants.length > 0
      ? input.participants.map((name) => `- ${name}`).join("\n")
      : "- Unknown";

  return [
    `# ${input.title}`,
    "",
    `Meeting ID: ${input.meetingId}`,
    `Account: ${input.sourceAccountLabel}`,
    `Source: ${input.source}`,
    `Ended At: ${input.endedAt}`,
    "",
    "## Participants",
    participants,
    "",
    "## Transcript",
    input.transcript,
    "",
  ].join("\n");
}

function buildInsightsBody(input: { insights: MeetingInsightsV1; runId: string }): string {
  const actionItems =
    input.insights.actionItems.length > 0
      ? input.insights.actionItems
          .map((item, index) => {
            const comments =
              item.comments && item.comments.length > 0
                ? `\n  Comments:\n${item.comments.map((comment) => `  - ${comment.speaker}: ${comment.text}`).join("\n")}`
                : "";
            const dueDate = item.dueDate ? ` (due: ${item.dueDate})` : "";
            const confidence = item.ownerConfidence ? ` [${item.ownerConfidence}]` : "";
            return `${index + 1}. ${item.title} - ${item.owner}${confidence}${dueDate}${comments}`;
          })
          .join("\n")
      : "1. No action items extracted.";

  return [
    "",
    `<!-- meeting-insights-run:${input.runId} -->`,
    "## Summary",
    input.insights.summary,
    "",
    "## Action Items",
    actionItems,
    "",
  ].join("\n");
}

export function createGoogleDocsDocumentAdapter(params: {
  account: MeetingWorkflowAccountConfig;
  client: GoogleDocsClient;
}): MeetingDocumentStorePort {
  const appendedRuns = new Set<string>();

  return {
    id: "google_docs",

    async upsertTranscript(input) {
      const rootFolderId = params.account.documents?.googleDocs?.rootFolderId;
      if (!rootFolderId) {
        throw new Error(
          `google_docs rootFolderId missing for account ${params.account.accountKey}`,
        );
      }
      const dateParts = formatDateParts(
        input.endedAt,
        params.account.documents?.googleDocs?.timeZone,
      );
      const accountFolder = await params.client.ensureFolder({
        parentId: rootFolderId,
        name: input.sourceAccountLabel,
      });
      const yearFolder = await params.client.ensureFolder({
        parentId: accountFolder.id,
        name: dateParts.year,
      });
      const monthFolder = await params.client.ensureFolder({
        parentId: yearFolder.id,
        name: dateParts.month,
      });
      const dayFolder = await params.client.ensureFolder({
        parentId: monthFolder.id,
        name: dateParts.day,
      });
      const doc = await params.client.upsertDocument({
        parentId: dayFolder.id,
        meetingId: input.meetingId,
        title: `${params.account.documents?.googleDocs?.titlePrefix ?? "Meeting"} ${dateParts.day} ${input.title}`,
      });
      await params.client.replaceDocumentBody({
        docId: doc.id,
        body: buildTranscriptBody(input),
      });

      return {
        schemaVersion: "meeting-doc-v1",
        meetingId: input.meetingId,
        sourceAccountKey: input.sourceAccountKey,
        yearFolderId: yearFolder.id,
        monthFolderId: monthFolder.id,
        dayFolderId: dayFolder.id,
        docId: doc.id,
        docUrl: doc.url,
      };
    },

    async appendInsights(input) {
      const runId = `${input.meeting.sourceAccountKey}:${input.meeting.meetingId}`;
      const marker = `<!-- meeting-insights-run:${runId} -->`;
      const dedupeKey = `${input.doc.docId}:${runId}`;
      if (appendedRuns.has(dedupeKey)) {
        return;
      }
      if (typeof params.client.getDocumentBody === "function") {
        const existing = await params.client.getDocumentBody(input.doc.docId);
        if (existing.includes(marker)) {
          appendedRuns.add(dedupeKey);
          return;
        }
      }
      await params.client.appendDocumentBody({
        docId: input.doc.docId,
        body: buildInsightsBody({ insights: input.insights, runId }),
      });
      appendedRuns.add(dedupeKey);
    },
  };
}
