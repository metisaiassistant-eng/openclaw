import { describe, expect, it } from "vitest";
import { isMeaningfulMeetingLlmText, sanitizeMeetingLlmText } from "./sanitize.js";

describe("meeting llm sanitize helpers", () => {
  it("removes control tags and no-reply tokens", () => {
    const text = sanitizeMeetingLlmText("[[reply_to_current]] [[final]] NO_REPLY Summary here");
    expect(text).toBe("Summary here");
  });

  it("detects non-meaningful control-only responses", () => {
    expect(isMeaningfulMeetingLlmText("[[reply_to_current]] NO_REPLY")).toBe(false);
    expect(isMeaningfulMeetingLlmText("Actual summary")).toBe(true);
  });
});
