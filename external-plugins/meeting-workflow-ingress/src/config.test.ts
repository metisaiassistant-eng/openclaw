import { describe, expect, it } from "vitest";
import { MeetingIngressConfigError, resolveMeetingIngressPluginConfig } from "./config.js";

describe("resolveMeetingIngressPluginConfig", () => {
  it("returns disabled config when plugin is disabled", () => {
    const config = resolveMeetingIngressPluginConfig({
      pluginConfig: {},
      env: {},
    });

    expect(config.enabled).toBe(false);
    expect(config.routePath).toBe("/integrations/source/fathom/webhook");
  });

  it("resolves enabled config with env fallbacks", () => {
    const config = resolveMeetingIngressPluginConfig({
      pluginConfig: {
        enabled: true,
        forward: {
          hooksBaseUrl: "http://127.0.0.1:18789",
        },
      },
      env: {
        SOURCE_FATHOM_API_KEY: "fathom-api-key",
        SOURCE_FATHOM_WEBHOOK_SECRET: "fathom-secret",
        OPENCLAW_HOOKS_TOKEN: "hooks-token",
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.source.fathom.apiKey).toBe("fathom-api-key");
    expect(config.forward.hooksToken).toBe("hooks-token");
  });

  it("throws when enabled and required keys are missing", () => {
    expect(() =>
      resolveMeetingIngressPluginConfig({
        pluginConfig: { enabled: true },
        env: {},
      }),
    ).toThrowError(MeetingIngressConfigError);
  });
});
