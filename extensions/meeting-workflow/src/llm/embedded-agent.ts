import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { MeetingLlmStepConfig } from "./ports.js";

type EmbeddedPiRunResultLike = {
  payloads?: Array<{ text?: string; isError?: boolean }>;
};

type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<EmbeddedPiRunResultLike>;

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  try {
    // @ts-expect-error source-tree internal import is only available in source/dev checkouts
    const mod = await import("../../../src/agents/pi-embedded-runner.ts");
    const fn = (mod as { runEmbeddedPiAgent?: unknown }).runEmbeddedPiAgent;
    if (typeof fn === "function") {
      return fn as RunEmbeddedPiAgentFn;
    }
  } catch {
    // ignore source-tree resolution failure
  }

  // @ts-expect-error packaged install fallback exists only in built distributions
  const mod = (await import("../../../dist/extensionAPI.js")) as {
    runEmbeddedPiAgent?: unknown;
  };
  const fn = mod.runEmbeddedPiAgent;
  if (typeof fn !== "function") {
    throw new Error("Internal error: runEmbeddedPiAgent not available");
  }
  return fn as RunEmbeddedPiAgentFn;
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((payload) => !payload.isError && typeof payload.text === "string")
    .map((payload) => payload.text ?? "")
    .join("\n")
    .trim();
}

function splitModelId(value: string): { provider: string; model: string } {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    throw new Error(`Invalid model identifier: ${value}`);
  }
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

function normalizeThinkLevel(value: MeetingLlmStepConfig["thinking"]): string | undefined {
  if (!value) {
    return undefined;
  }
  return value === "none" ? "off" : value;
}

export async function runMeetingLlmPrompt(params: {
  api: OpenClawPluginApi;
  sessionKey: string;
  prompt: string;
  modelConfig?: MeetingLlmStepConfig;
  timeoutMs?: number;
  extraSystemPrompt?: string;
}): Promise<string> {
  const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();
  const defaultsModel = params.api.config?.agents?.defaults?.model;
  const modelId =
    params.modelConfig?.model ??
    (typeof defaultsModel === "string" ? defaultsModel : defaultsModel?.primary);
  if (typeof modelId !== "string" || !modelId.trim()) {
    throw new Error("No model configured for meeting workflow LLM step");
  }

  const { provider, model } = splitModelId(modelId);
  const result = await runEmbeddedPiAgent({
    sessionId: `meeting-workflow-${Date.now()}`,
    sessionKey: params.sessionKey,
    agentId: "meeting-ops",
    workspaceDir: process.cwd(),
    config: params.api.config,
    prompt: params.prompt,
    provider,
    model,
    thinkLevel: normalizeThinkLevel(params.modelConfig?.thinking),
    timeoutMs: params.timeoutMs ?? 30_000,
    runId: `meeting-workflow-${Date.now()}`,
    disableTools: true,
    ...(params.extraSystemPrompt ? { extraSystemPrompt: params.extraSystemPrompt } : {}),
  });

  const text = collectText(result.payloads);
  if (!text) {
    throw new Error("Meeting workflow LLM step returned empty output");
  }
  return text;
}
