import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

describe("meeting-workflow plugin registration", () => {
  it("registers one route per configured account", async () => {
    const registerTool = vi.fn();
    const registerHttpRoute = vi.fn();
    const on = vi.fn();

    plugin.register?.({
      id: "meeting-workflow",
      name: "Meeting Workflow",
      description: "Meeting Workflow",
      source: "test",
      config: {},
      pluginConfig: {
        enabled: true,
        forward: {
          hooksBaseUrl: "http://127.0.0.1:18789",
          hooksToken: "hooks-token",
        },
        accounts: [
          {
            accountKey: "job-a",
            label: "Consulting",
            routePath: "/integrations/source/fathom/job-a/webhook",
            provider: "fathom",
            fathom: {
              apiKey: "api-key-a",
              webhookSecret: "secret-a",
            },
          },
          {
            accountKey: "job-b",
            label: "Employer",
            routePath: "/integrations/source/fathom/job-b/webhook",
            provider: "fathom",
            fathom: {
              apiKey: "api-key-b",
              webhookSecret: "secret-b",
            },
          },
        ],
      },
      runtime: {} as never,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      registerTool,
      registerHook() {},
      registerHttpRoute,
      registerChannel() {},
      registerGatewayMethod() {},
      registerCli() {},
      registerService() {},
      registerProvider() {},
      registerCommand() {},
      registerContextEngine() {},
      resolvePath(input: string) {
        return input;
      },
      on,
    });

    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).toHaveBeenCalledTimes(2);
    expect(registerHttpRoute.mock.calls[0]?.[0]).toMatchObject({
      path: "/integrations/source/fathom/job-a/webhook",
      auth: "plugin",
      match: "exact",
    });
    expect(registerHttpRoute.mock.calls[1]?.[0]).toMatchObject({
      path: "/integrations/source/fathom/job-b/webhook",
      auth: "plugin",
      match: "exact",
    });
  });

  it("does not register tools or routes when disabled", async () => {
    const registerTool = vi.fn();
    const registerHttpRoute = vi.fn();
    const on = vi.fn();

    plugin.register?.({
      id: "meeting-workflow",
      name: "Meeting Workflow",
      description: "Meeting Workflow",
      source: "test",
      config: {},
      pluginConfig: {
        enabled: false,
      },
      runtime: {} as never,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      registerTool,
      registerHook() {},
      registerHttpRoute,
      registerChannel() {},
      registerGatewayMethod() {},
      registerCli() {},
      registerService() {},
      registerProvider() {},
      registerCommand() {},
      registerContextEngine() {},
      resolvePath(input: string) {
        return input;
      },
      on,
    });

    expect(registerTool).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
    expect(registerHttpRoute).not.toHaveBeenCalled();
  });
});
