import { describe, expect, it } from "vitest";
import { resolveMeetingWorkflowAccount } from "./bootstrap.js";

describe("resolveMeetingWorkflowAccount", () => {
  const config = {
    enabled: true,
    maxBodyBytes: 1024,
    forward: {
      hooksBaseUrl: "http://127.0.0.1:18789",
      hooksPath: "/hooks/meeting-source",
      hooksToken: "token",
      timeoutMs: 1000,
    },
    accounts: [
      {
        accountKey: "job-a",
        label: "Consulting",
        routePath: "/integrations/source/fathom/job-a/webhook",
        provider: "fathom" as const,
        fathom: { apiKey: "a", webhookSecret: "b", baseUrl: "https://api.fathom.ai/external/v1" },
      },
      {
        accountKey: "job-b",
        label: "Employer",
        routePath: "/integrations/source/fathom/job-b/webhook",
        provider: "fathom" as const,
        fathom: { apiKey: "c", webhookSecret: "d", baseUrl: "https://api.fathom.ai/external/v1" },
      },
    ],
  };

  it("resolves by account key", () => {
    const account = resolveMeetingWorkflowAccount({
      config,
      sourceAccountKey: "job-b",
    });
    expect(account.label).toBe("Employer");
  });

  it("throws when multiple accounts exist and no key is provided", () => {
    expect(() => resolveMeetingWorkflowAccount({ config })).toThrow("sourceAccountKey is required");
  });

  it("supports account configs with refresh-token based docs auth fields", () => {
    const account = {
      accountKey: "job-a",
      label: "Consulting",
      routePath: "/integrations/source/fathom/job-a/webhook",
      provider: "fathom" as const,
      fathom: { apiKey: "a", webhookSecret: "b", baseUrl: "https://api.fathom.ai/external/v1" },
      documents: {
        provider: "google_docs" as const,
        googleDocs: {
          rootFolderId: "root-1",
          refreshToken: "refresh-1",
          clientId: "client-1",
          clientSecret: "secret-1",
        },
      },
      tasks: {
        provider: "clickup" as const,
        clickup: { listId: "list-1", apiKey: "clickup-key" },
      },
    };

    expect(account.documents.googleDocs.refreshToken).toBe("refresh-1");
  });
});
