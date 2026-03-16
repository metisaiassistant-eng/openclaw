const CONTROL_TAG_RE = /\[\[[^\]]+\]\]/g;
const NO_REPLY_RE = /\bNO_REPLY\b/g;

export function sanitizeMeetingLlmText(input: string): string {
  return input.replace(CONTROL_TAG_RE, " ").replace(NO_REPLY_RE, " ").replace(/\s+/g, " ").trim();
}

export function isMeaningfulMeetingLlmText(input: string): boolean {
  const sanitized = sanitizeMeetingLlmText(input);
  return sanitized.length > 0;
}
