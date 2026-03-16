import { describe, expect, it, vi } from "vitest";
import { createGoogleDocsApiClient } from "./client.js";

describe("createGoogleDocsApiClient", () => {
  it("refreshes token and retries after a 401", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "folder-1", name: "Folder A" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = createGoogleDocsApiClient({
        accessToken: "expired-token",
        refreshToken: "refresh-token",
        clientId: "client-id",
        clientSecret: "client-secret",
      });
      await client.ensureFolder({
        parentId: "parent-1",
        name: "Folder A",
      });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://oauth2.googleapis.com/token");
  });
});
