type GoogleDriveFile = {
  id: string;
  name?: string;
  webViewLink?: string;
};

type GoogleTokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
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

type GoogleDocsAuthConfig = {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
};

function createGoogleTokenProvider(auth: GoogleDocsAuthConfig) {
  let cachedToken = auth.accessToken?.trim() || "";
  let cachedExpiresAt = 0;

  async function refreshAccessToken(): Promise<string> {
    if (!auth.refreshToken || !auth.clientId || !auth.clientSecret) {
      throw new Error("google docs refresh credentials are not configured");
    }
    const body = new URLSearchParams({
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`google token refresh failed with status ${response.status}`);
    }
    const payload = (await response.json()) as GoogleTokenRefreshResponse;
    const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    if (!token) {
      throw new Error("google token refresh response missing access_token");
    }
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    cachedToken = token;
    cachedExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    return cachedToken;
  }

  return {
    async getAccessToken(forceRefresh = false): Promise<string> {
      if (!forceRefresh) {
        if (cachedToken && (cachedExpiresAt === 0 || Date.now() < cachedExpiresAt)) {
          return cachedToken;
        }
      }
      if (auth.refreshToken && auth.clientId && auth.clientSecret) {
        return await refreshAccessToken();
      }
      if (cachedToken) {
        return cachedToken;
      }
      throw new Error("google docs access token is not configured");
    },
    canRefresh(): boolean {
      return Boolean(auth.refreshToken && auth.clientId && auth.clientSecret);
    },
  };
}

async function requestJson<T>(params: {
  url: string;
  tokenProvider: ReturnType<typeof createGoogleTokenProvider>;
  method?: string;
  body?: unknown;
}): Promise<T> {
  const request = async (forceRefresh = false): Promise<Response> => {
    const accessToken = await params.tokenProvider.getAccessToken(forceRefresh);
    return await fetch(params.url, {
      method: params.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(params.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    });
  };

  let response = await request(false);
  if (response.status === 401 && params.tokenProvider.canRefresh()) {
    response = await request(true);
  }
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

export function createGoogleDocsApiClient(params: GoogleDocsAuthConfig) {
  const tokenProvider = createGoogleTokenProvider(params);
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
        tokenProvider,
      });
      const existing = search.files?.[0];
      if (existing?.id) {
        return { id: existing.id };
      }
      const created = await requestJson<GoogleDriveFile>({
        url: "https://www.googleapis.com/drive/v3/files?fields=id,name",
        tokenProvider,
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
        tokenProvider,
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
        tokenProvider,
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
        tokenProvider,
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
        tokenProvider,
        method: "POST",
        body: { requests },
      });
    },

    async appendDocumentBody(input: { docId: string; body: string }): Promise<void> {
      const doc = await requestJson<GoogleDocsResponse>({
        url: `https://docs.googleapis.com/v1/documents/${input.docId}`,
        tokenProvider,
      });
      const endIndex = Math.max(1, getDocumentEndIndex(doc) - 1);
      await requestJson({
        url: `https://docs.googleapis.com/v1/documents/${input.docId}:batchUpdate`,
        tokenProvider,
        method: "POST",
        body: {
          requests: [{ insertText: { location: { index: endIndex }, text: input.body } }],
        },
      });
    },

    async getDocumentBody(docId: string): Promise<string> {
      const doc = await requestJson<GoogleDocsResponse>({
        url: `https://docs.googleapis.com/v1/documents/${docId}`,
        tokenProvider,
      });
      return getDocumentText(doc);
    },
  };
}
