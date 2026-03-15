type GoogleDriveFile = {
  id: string;
  name?: string;
  webViewLink?: string;
};

type GoogleDriveListResponse = {
  files?: GoogleDriveFile[];
};

type GoogleDocsResponse = {
  body?: {
    content?: Array<{
      endIndex?: number;
      paragraph?: {
        elements?: Array<{
          textRun?: {
            content?: string;
          };
        }>;
      };
    }>;
  };
};

function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function requestJson<T>(params: {
  url: string;
  accessToken: string;
  method?: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(params.url, {
    method: params.method ?? "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      ...(params.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`google api request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function getDocumentEndIndex(doc: GoogleDocsResponse): number {
  const content = doc.body?.content ?? [];
  const last = content.at(-1);
  return typeof last?.endIndex === "number" ? last.endIndex : 1;
}

function getDocumentText(doc: GoogleDocsResponse): string {
  return (doc.body?.content ?? [])
    .flatMap((block) => block.paragraph?.elements ?? [])
    .map((element) => element.textRun?.content ?? "")
    .join("");
}

export function createGoogleDocsApiClient(params: { accessToken: string }) {
  return {
    async ensureFolder(input: { parentId: string; name: string }): Promise<{ id: string }> {
      const query = [
        `'${escapeDriveQueryValue(input.parentId)}' in parents`,
        `name = '${escapeDriveQueryValue(input.name)}'`,
        "mimeType = 'application/vnd.google-apps.folder'",
        "trashed = false",
      ].join(" and ");
      const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("fields", "files(id,name)");
      const search = await requestJson<GoogleDriveListResponse>({
        url: searchUrl.toString(),
        accessToken: params.accessToken,
      });
      const existing = search.files?.[0];
      if (existing?.id) {
        return { id: existing.id };
      }
      const created = await requestJson<GoogleDriveFile>({
        url: "https://www.googleapis.com/drive/v3/files?fields=id,name",
        accessToken: params.accessToken,
        method: "POST",
        body: {
          name: input.name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [input.parentId],
        },
      });
      return { id: created.id };
    },

    async upsertDocument(input: {
      parentId: string;
      meetingId: string;
      title: string;
    }): Promise<{ id: string; url: string }> {
      const query = [
        `'${escapeDriveQueryValue(input.parentId)}' in parents`,
        `name contains '${escapeDriveQueryValue(`[${input.meetingId}]`)}'`,
        "mimeType = 'application/vnd.google-apps.document'",
        "trashed = false",
      ].join(" and ");
      const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("fields", "files(id,name,webViewLink)");
      const search = await requestJson<GoogleDriveListResponse>({
        url: searchUrl.toString(),
        accessToken: params.accessToken,
      });
      const existing = search.files?.[0];
      if (existing?.id) {
        return {
          id: existing.id,
          url: existing.webViewLink ?? `https://docs.google.com/document/d/${existing.id}`,
        };
      }
      const created = await requestJson<GoogleDriveFile>({
        url: "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink",
        accessToken: params.accessToken,
        method: "POST",
        body: {
          name: `[${input.meetingId}] ${input.title}`,
          mimeType: "application/vnd.google-apps.document",
          parents: [input.parentId],
        },
      });
      return {
        id: created.id,
        url: created.webViewLink ?? `https://docs.google.com/document/d/${created.id}`,
      };
    },

    async replaceDocumentBody(input: { docId: string; body: string }): Promise<void> {
      const doc = await requestJson<GoogleDocsResponse>({
        url: `https://docs.googleapis.com/v1/documents/${input.docId}`,
        accessToken: params.accessToken,
      });
      const endIndex = getDocumentEndIndex(doc);
      const requests: unknown[] = [];
      if (endIndex > 2) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
      }
      if (input.body.length > 0) {
        requests.push({ insertText: { location: { index: 1 }, text: input.body } });
      }
      if (requests.length === 0) {
        return;
      }
      await requestJson({
        url: `https://docs.googleapis.com/v1/documents/${input.docId}:batchUpdate`,
        accessToken: params.accessToken,
        method: "POST",
        body: { requests },
      });
    },

    async appendDocumentBody(input: { docId: string; body: string }): Promise<void> {
      const doc = await requestJson<GoogleDocsResponse>({
        url: `https://docs.googleapis.com/v1/documents/${input.docId}`,
        accessToken: params.accessToken,
      });
      const endIndex = Math.max(1, getDocumentEndIndex(doc) - 1);
      await requestJson({
        url: `https://docs.googleapis.com/v1/documents/${input.docId}:batchUpdate`,
        accessToken: params.accessToken,
        method: "POST",
        body: {
          requests: [{ insertText: { location: { index: endIndex }, text: input.body } }],
        },
      });
    },

    async getDocumentBody(docId: string): Promise<string> {
      const doc = await requestJson<GoogleDocsResponse>({
        url: `https://docs.googleapis.com/v1/documents/${docId}`,
        accessToken: params.accessToken,
      });
      return getDocumentText(doc);
    },
  };
}
