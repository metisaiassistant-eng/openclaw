import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createMeetingIngressHttpHandler } from "./handler.js";

function makeReq(params: {
  method: string;
  headers?: Record<string, string>;
  body: string;
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = params.method;
  req.headers = params.headers ?? {};
  req.socket = { remoteAddress: "127.0.0.1" } as IncomingMessage["socket"];

  process.nextTick(() => {
    req.emit("data", Buffer.from(params.body));
    req.emit("end");
  });

  return req;
}

function makeRes(): ServerResponse & { _status: number; _body: string } {
  const res = {
    _status: 0,
    _body: "",
    setHeader() {},
    end(body?: string) {
      res._body = body ?? "";
    },
    statusCode: 0,
  } as unknown as ServerResponse & { _status: number; _body: string };

  Object.defineProperty(res, "statusCode", {
    get() {
      return res._status;
    },
    set(value: number) {
      res._status = value;
    },
    configurable: true,
  });

  return res;
}

describe("createMeetingIngressHttpHandler", () => {
  it("returns 401 when source verification fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const handler = createMeetingIngressHttpHandler({
      sourceAdapter: {
        id: "fathom",
        async verifyInbound() {
          throw new Error("bad signature");
        },
        async normalizeInbound() {
          throw new Error("unreachable");
        },
        async fetchMeetingFallback() {
          return null;
        },
      },
      forward: {
        hooksBaseUrl: "http://127.0.0.1:18789",
        hooksPath: "/hooks/meeting-source",
        hooksToken: "hooks-token",
        timeoutMs: 1000,
      },
      maxBodyBytes: 1024,
      fetchImpl: fetchMock,
    });

    const req = makeReq({ method: "POST", headers: {}, body: "{}" });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards normalized payload to hooks endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const handler = createMeetingIngressHttpHandler({
      sourceAdapter: {
        id: "fathom",
        async verifyInbound() {},
        async normalizeInbound() {
          return {
            schemaVersion: "meeting-event-v1",
            meetingId: "meeting-1",
            source: "fathom",
            title: "Weekly",
            endedAt: "2026-03-09T18:30:00Z",
            transcript: "hello",
            participants: ["Carlos"],
          };
        },
        async fetchMeetingFallback() {
          return null;
        },
      },
      forward: {
        hooksBaseUrl: "http://127.0.0.1:18789",
        hooksPath: "/hooks/meeting-source",
        hooksToken: "hooks-token",
        timeoutMs: 1000,
      },
      maxBodyBytes: 1024,
      fetchImpl: fetchMock,
    });

    const req = makeReq({
      method: "POST",
      headers: { "webhook-signature": "good" },
      body: JSON.stringify({ id: "meeting-1" }),
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18789/hooks/meeting-source");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer hooks-token");
  });
});
