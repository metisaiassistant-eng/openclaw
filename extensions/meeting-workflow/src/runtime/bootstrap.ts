import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MeetingWorkflowAccountConfig, MeetingWorkflowPluginConfig } from "../config.js";
import { createGoogleDocsDocumentAdapter } from "../documents/google-docs/adapter.js";
import { createGoogleDocsApiClient } from "../documents/google-docs/client.js";
import { createMeetingActionItemsStep } from "../llm/action-items-step.js";
import { createMeetingSummaryStep } from "../llm/summary-step.js";
import { createClickUpTaskAdapter } from "../tasks/clickup/adapter.js";
import { createClickUpApiClient } from "../tasks/clickup/client.js";
import { createMeetingWorkflowOrchestrator } from "../workflow/orchestrator.js";
import {
  computeMeetingEventFingerprint,
  createMeetingWorkflowStateStore,
} from "../workflow/state.js";

export function resolveMeetingWorkflowAccount(params: {
  config: MeetingWorkflowPluginConfig;
  sourceAccountKey?: string;
  sourceAccountLabel?: string;
}): MeetingWorkflowAccountConfig {
  if (params.sourceAccountKey) {
    const byKey = params.config.accounts.find(
      (account) => account.accountKey === params.sourceAccountKey,
    );
    if (!byKey) {
      throw new Error(`Unknown meeting workflow account key: ${params.sourceAccountKey}`);
    }
    return byKey;
  }
  if (params.sourceAccountLabel) {
    const byLabel = params.config.accounts.find(
      (account) => account.label === params.sourceAccountLabel,
    );
    if (byLabel) {
      return byLabel;
    }
  }
  if (params.config.accounts.length === 1) {
    return params.config.accounts[0] as MeetingWorkflowAccountConfig;
  }
  throw new Error(
    "sourceAccountKey is required when multiple meeting workflow accounts are configured",
  );
}

export function createMeetingWorkflowRuntime(params: {
  api: OpenClawPluginApi;
  config: MeetingWorkflowPluginConfig;
  account: MeetingWorkflowAccountConfig;
}) {
  const docsAccessToken = params.account.documents?.googleDocs?.accessToken;
  const clickupApiKey = params.account.tasks?.clickup?.apiKey;
  if (!docsAccessToken) {
    throw new Error(`google_docs accessToken missing for account ${params.account.accountKey}`);
  }
  if (!clickupApiKey) {
    throw new Error(`clickup apiKey missing for account ${params.account.accountKey}`);
  }

  const summaryStep = createMeetingSummaryStep(params.api);
  const actionItemsStep = createMeetingActionItemsStep(params.api);
  const documents = createGoogleDocsDocumentAdapter({
    account: params.account,
    client: createGoogleDocsApiClient({ accessToken: docsAccessToken }),
  });
  const tasks = createClickUpTaskAdapter({
    account: params.account,
    client: createClickUpApiClient({ apiKey: clickupApiKey }),
  });

  const orchestrator = createMeetingWorkflowOrchestrator({
    summaryStep: {
      run: async (input) =>
        await summaryStep.run({
          meeting: input.meeting,
          config: input.config ?? params.account.models?.summary,
        }),
    },
    actionItemsStep: {
      run: async (input) =>
        await actionItemsStep.run({
          meeting: input.meeting,
          config: input.config ?? params.account.models?.actionItems,
        }),
    },
    documents,
    tasks,
  });

  const stateStore = createMeetingWorkflowStateStore(params.api.runtime.state.resolveStateDir());

  return {
    async run(meeting: Parameters<typeof orchestrator.run>[0]) {
      const eventFingerprint = computeMeetingEventFingerprint({
        meetingId: meeting.meetingId,
        sourceAccountKey: meeting.sourceAccountKey,
        title: meeting.title,
        endedAt: meeting.endedAt,
        transcript: meeting.transcript,
      });

      const existing = await stateStore.read(meeting.sourceAccountKey, meeting.meetingId);
      if (existing && existing.eventFingerprint === eventFingerprint) {
        return {
          ...existing.result,
          reportPath: existing.reportPath,
          cached: true,
        };
      }

      const result = await orchestrator.run(meeting);
      const reportPath = await stateStore.writeReport({
        meetingId: result.meeting.meetingId,
        sourceAccountKey: result.meeting.sourceAccountKey,
        sourceAccountLabel: result.meeting.sourceAccountLabel,
        docUrl: result.doc.docUrl,
        taskUrls: result.tasks.taskUrls ?? [],
        createdCount: result.tasks.createdCount,
        generatedAt: new Date().toISOString(),
      });

      await stateStore.write({
        meetingId: result.meeting.meetingId,
        sourceAccountKey: result.meeting.sourceAccountKey,
        eventFingerprint,
        result,
        savedAt: new Date().toISOString(),
        reportPath,
      });

      return {
        ...result,
        reportPath,
        cached: false,
      };
    },
  };
}
