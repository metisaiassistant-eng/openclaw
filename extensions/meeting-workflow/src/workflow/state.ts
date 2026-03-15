import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MeetingWorkflowRunResult } from "./orchestrator.js";

export type MeetingWorkflowStoredResult = {
  meetingId: string;
  sourceAccountKey: string;
  eventFingerprint: string;
  result: MeetingWorkflowRunResult;
  savedAt: string;
  reportPath?: string;
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function resultFilePath(stateDir: string, sourceAccountKey: string, meetingId: string): string {
  return path.join(
    stateDir,
    "meeting-workflow",
    "results",
    sanitizeSegment(sourceAccountKey),
    `${sanitizeSegment(meetingId)}.json`,
  );
}

function reportsDir(stateDir: string): string {
  return path.join(stateDir, "meeting-workflow", "reports");
}

export function computeMeetingEventFingerprint(input: {
  meetingId: string;
  sourceAccountKey: string;
  title: string;
  endedAt: string;
  transcript: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        meetingId: input.meetingId,
        sourceAccountKey: input.sourceAccountKey,
        title: input.title,
        endedAt: input.endedAt,
        transcript: input.transcript,
      }),
    )
    .digest("hex");
}

export function createMeetingWorkflowStateStore(stateDir: string) {
  return {
    async read(
      sourceAccountKey: string,
      meetingId: string,
    ): Promise<MeetingWorkflowStoredResult | null> {
      const filePath = resultFilePath(stateDir, sourceAccountKey, meetingId);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw) as MeetingWorkflowStoredResult;
      } catch {
        return null;
      }
    },

    async write(record: MeetingWorkflowStoredResult): Promise<string> {
      const filePath = resultFilePath(stateDir, record.sourceAccountKey, record.meetingId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8");
      return filePath;
    },

    async writeReport(record: Record<string, unknown>): Promise<string> {
      const dir = reportsDir(stateDir);
      await fs.mkdir(dir, { recursive: true });
      const now = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = path.join(
        dir,
        `${now}-${sanitizeSegment(String(record.sourceAccountKey ?? "account"))}-${sanitizeSegment(String(record.meetingId ?? "meeting"))}.json`,
      );
      await fs.writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8");
      return filePath;
    },
  };
}
