import type { ServerResponse } from "node:http";

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function collectStringHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      const joined = value.filter((entry): entry is string => typeof entry === "string").join(", ");
      if (joined.length > 0) {
        out[key] = joined;
      }
    }
  }
  return out;
}
