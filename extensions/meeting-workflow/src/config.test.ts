import { describe, expect, it } from "vitest";
import { MeetingWorkflowConfigError, resolveMeetingWorkflowConfig } from "./config.js";

describe("resolveMeetingWorkflowConfig", () => {
  it("returns disabled config when plugin is disabled", () => {
    const config = resolveMeetingWorkflowConfig({});
    expect(config.enabled).toBe(false);
    expect(config.accounts).toEqual([]);
  });

  it("allows enabled direct-runtime config without forward auth values", () => {
    const config = resolveMeetingWorkflowConfig({
      enabled: true,
      accounts: [
        {
          accountKey: "job-a",
          label: "Consulting",
          routePath: "/integrations/source/fathom/job-a/webhook",
          provider: "fathom",
          fathom: {
            apiKey: "api-key-a",
            webhookSecret: "secret-a",
          },
        },
      ],
    });

    expect(config.enabled).toBe(true);
    expect(config.forward.hooksBaseUrl).toBe("");
    expect(config.forward.hooksToken).toBe("");
  });

  it("parses multi-account config", () => {
    const config = resolveMeetingWorkflowConfig({
      enabled: true,
      forward: {
        hooksBaseUrl: "http://127.0.0.1:18789",
        hooksToken: "token",
      },
      accounts: [
        {
          accountKey: "job-a",
          label: "Consulting",
          email: "consulting@example.com",
          routePath: "/integrations/source/fathom/job-a/webhook",
          provider: "fathom",
          fathom: {
            apiKey: "api-key-a",
            webhookSecret: "secret-a",
          },
          documents: {
            provider: "google_docs",
            googleDocs: {
              rootFolderId: "root-a",
              accessToken: "google-token-a",
              refreshToken: "google-refresh-a",
              clientId: "google-client-a",
              clientSecret: "google-secret-a",
              transcriptsFolderName: "Meeting Transcripts",
              timeZone: "America/Costa_Rica",
            },
          },
          tasks: {
            provider: "clickup",
            clickup: {
              listId: "list-a",
              apiKey: "clickup-token-a",
              assigneeIds: ["user-1", "user-2"],
            },
          },
          models: {
            summary: { model: "openai/gpt-5.2-mini", thinking: "low" },
          },
        },
        {
          accountKey: "job-b",
          label: "Employer",
          routePath: "/integrations/source/fathom/job-b/webhook",
          provider: "fathom",
          fathom: {
            apiKey: "api-key-b",
            webhookSecret: "secret-b",
          },
        },
      ],
    });

    expect(config.accounts).toHaveLength(2);
    expect(config.accounts[0]?.accountKey).toBe("job-a");
    expect(config.accounts[0]?.models?.summary?.model).toBe("openai/gpt-5.2-mini");
    expect(config.accounts[0]?.documents?.googleDocs?.accessToken).toBe("google-token-a");
    expect(config.accounts[0]?.documents?.googleDocs?.refreshToken).toBe("google-refresh-a");
    expect(config.accounts[0]?.documents?.googleDocs?.transcriptsFolderName).toBe(
      "Meeting Transcripts",
    );
    expect(config.accounts[0]?.documents?.googleDocs?.timeZone).toBe("America/Costa_Rica");
    expect(config.accounts[0]?.tasks?.clickup?.apiKey).toBe("clickup-token-a");
    expect(config.accounts[1]?.routePath).toBe("/integrations/source/fathom/job-b/webhook");
    expect(config.forward.hooksPath).toBe("/hooks/meeting-source");
  });

  it("rejects duplicate account keys and route paths", () => {
    expect(() =>
      resolveMeetingWorkflowConfig({
        enabled: true,
        forward: {
          hooksBaseUrl: "http://127.0.0.1:18789",
          hooksToken: "token",
        },
        accounts: [
          {
            accountKey: "job-a",
            label: "Consulting",
            routePath: "/integrations/source/fathom/job-a/webhook",
            provider: "fathom",
            fathom: { apiKey: "a", webhookSecret: "a" },
          },
          {
            accountKey: "job-a",
            label: "Employer",
            routePath: "/integrations/source/fathom/job-a/webhook",
            provider: "fathom",
            fathom: { apiKey: "b", webhookSecret: "b" },
          },
        ],
      }),
    ).toThrowError(MeetingWorkflowConfigError);
  });
});
