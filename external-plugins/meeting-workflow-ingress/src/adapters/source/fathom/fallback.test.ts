import { describe, expect, it, vi } from "vitest";
import { fetchFathomMeetingFallback } from "./fallback.js";

describe("fetchFathomMeetingFallback", () => {
  it("does not send non-documented meeting_id query param", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).not.toContain("meeting_id=");
      return new Response(
        JSON.stringify({
          meetings: [
            {
              id: "meeting-1",
              title: "Fallback",
              ended_at: "2026-03-09T18:30:00Z",
              transcript: "Recovered transcript",
              participants: [{ name: "Carlos" }],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const result = await fetchFathomMeetingFallback({
      baseUrl: "https://api.fathom.ai/external/v1",
      apiKey: "test-key",
      meetingId: "meeting-1",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.meetingId).toBe("meeting-1");
  });
});
