import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveMeetingWorkflowConfig } from "./src/config.js";
import { createMeetingIngressHttpHandler } from "./src/ingress/http-handler.js";
import { createFathomSourceAdapter } from "./src/sources/fathom/adapter.js";
import {
  createMeetingWorkflowAnalyzeTool,
  createMeetingWorkflowRunTool,
  MEETING_WORKFLOW_GUIDANCE,
} from "./src/tool.js";

const plugin = {
  id: "meeting-workflow",
  name: "Meeting Workflow",
  description:
    "Receives Fathom webhooks, normalizes meeting events, and forwards them into OpenClaw hooks.",
  register(api: OpenClawPluginApi) {
    const config = resolveMeetingWorkflowConfig(api.pluginConfig);

    if (!config.enabled) {
      api.logger.info("[meeting-workflow] plugin disabled; no routes registered");
      return;
    }

    api.registerTool(createMeetingWorkflowAnalyzeTool(api));
    api.registerTool(createMeetingWorkflowRunTool(api));
    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx.agentId !== "meeting-ops") {
        return;
      }
      return {
        prependSystemContext: MEETING_WORKFLOW_GUIDANCE,
      };
    });

    for (const account of config.accounts) {
      const sourceAdapter = createFathomSourceAdapter(account);
      const routeHandler = createMeetingIngressHttpHandler({
        sourceAdapter,
        forward: config.forward,
        maxBodyBytes: config.maxBodyBytes,
      });

      api.registerHttpRoute({
        path: account.routePath,
        auth: "plugin",
        match: "exact",
        handler: routeHandler,
      });

      api.logger.info(
        `[meeting-workflow] registered route ${account.routePath} (provider=${account.provider}, account=${account.accountKey})`,
      );
    }
  },
};

export default plugin;
