import { describe, expect, it } from "vitest";
import { createGoogleDocsDocumentAdapter, type GoogleDocsClient } from "./adapter.js";

function createMemoryGoogleDocsClient() {
  const folders = new Map<string, string>();
  const docs = new Map<string, { body: string; url: string }>();

  const client: GoogleDocsClient = {
    async ensureFolder(input) {
      const key = `${input.parentId}:${input.name}`;
      const existing = folders.get(key);
      if (existing) {
        return { id: existing };
      }
      const id = `folder-${folders.size + 1}`;
      folders.set(key, id);
      return { id };
    },
    async upsertDocument(input) {
      const id = `doc-${input.meetingId}`;
      if (!docs.has(id)) {
        docs.set(id, { body: "", url: `https://docs.google.com/document/d/${id}` });
      }
      return { id, url: `https://docs.google.com/document/d/${id}` };
    },
    async replaceDocumentBody(input) {
      const doc = docs.get(input.docId);
      if (!doc) {
        throw new Error("document not found");
      }
      doc.body = input.body;
    },
    async appendDocumentBody(input) {
      const doc = docs.get(input.docId);
      if (!doc) {
        throw new Error("document not found");
      }
      doc.body += input.body;
    },
    async getDocumentBody(docId) {
      return docs.get(docId)?.body ?? "";
    },
  };

  return { client, folders, docs };
}

describe("createGoogleDocsDocumentAdapter", () => {
  it("creates account/date folder hierarchy and transcript doc", async () => {
    const memory = createMemoryGoogleDocsClient();
    const adapter = createGoogleDocsDocumentAdapter({
      account: {
        accountKey: "job-a",
        label: "Consulting",
        routePath: "/integrations/source/fathom/job-a/webhook",
        provider: "fathom",
        fathom: { apiKey: "a", webhookSecret: "b", baseUrl: "https://api.fathom.ai/external/v1" },
        documents: {
          provider: "google_docs",
          googleDocs: { rootFolderId: "root" },
        },
      },
      client: memory.client,
    });

    const doc = await adapter.upsertTranscript({
      schemaVersion: "meeting-event-v1",
      meetingId: "meeting-1",
      source: "fathom",
      sourceAccountKey: "job-a",
      sourceAccountLabel: "Consulting",
      title: "Weekly Product Sync",
      endedAt: "2026-03-09T18:30:00Z",
      transcript: "line 1",
      participants: ["Carlos", "Ana"],
    });

    expect(doc.docId).toBe("doc-meeting-1");
    expect(memory.folders.size).toBe(4);
  });
});
