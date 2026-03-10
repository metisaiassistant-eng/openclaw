import { createFathomSourceAdapter } from "./src/adapters/source/fathom/adapter.js";
import { MeetingIngressConfigError, resolveMeetingIngressPluginConfig } from "./src/config.js";
import { createMeetingIngressHttpHandler } from "./src/http/handler.js";

type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (message: string) => void;
  };
  registerHttpRoute: (params: {
    path: string;
    auth: "gateway" | "plugin";
    match?: "exact" | "prefix";
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => Promise<boolean>;
  }) => void;
};

const plugin = {
  id: "meeting-workflow-ingress",
  name: "Meeting Workflow Ingress",
  description: "Verifies Fathom webhooks and forwards normalized meetings to OpenClaw hooks.",
  register(api: OpenClawPluginApi) {
    const config = resolveMeetingIngressPluginConfig({
      pluginConfig: api.pluginConfig,
      env: process.env,
    });

    if (!config.enabled) {
      api.logger.info("[meeting-workflow-ingress] plugin disabled; no routes registered");
      return;
    }

    const sourceAdapter = createFathomSourceAdapter(config.source.fathom);
    const routeHandler = createMeetingIngressHttpHandler({
      sourceAdapter,
      forward: config.forward,
      maxBodyBytes: config.maxBodyBytes,
    });

    api.registerHttpRoute({
      path: config.routePath,
      auth: "plugin",
      match: "exact",
      handler: routeHandler,
    });

    api.logger.info(
      `[meeting-workflow-ingress] registered route ${config.routePath} (provider=${config.sourceProvider})`,
    );
  },
};

export { MeetingIngressConfigError };
export default plugin;
