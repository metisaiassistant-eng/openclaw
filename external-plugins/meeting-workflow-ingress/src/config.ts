type Dict = Record<string, unknown>;

export type MeetingIngressPluginConfig = {
  enabled: boolean;
  routePath: string;
  maxBodyBytes: number;
  sourceProvider: "fathom";
  source: {
    fathom: {
      apiKey: string;
      webhookSecret: string;
      baseUrl: string;
    };
  };
  forward: {
    hooksBaseUrl: string;
    hooksPath: string;
    hooksToken: string;
    timeoutMs: number;
  };
};

export type MeetingIngressConfigIssue = {
  key: string;
  message: string;
};

export class MeetingIngressConfigError extends Error {
  readonly issues: MeetingIngressConfigIssue[];

  constructor(issues: MeetingIngressConfigIssue[]) {
    super(
      `meeting-workflow-ingress config is invalid:\n${issues.map((issue) => `- ${issue.key}: ${issue.message}`).join("\n")}`,
    );
    this.name = "MeetingIngressConfigError";
    this.issues = issues;
  }
}

const DEFAULT_ROUTE_PATH = "/integrations/source/fathom/webhook";
const DEFAULT_SOURCE_PROVIDER = "fathom";
const DEFAULT_FATHOM_BASE_URL = "https://api.fathom.ai/external/v1";
const DEFAULT_HOOKS_PATH = "/hooks/meeting-source";
const DEFAULT_FORWARD_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function asObject(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizePath(path: string): string {
  if (!path.trim()) {
    return DEFAULT_ROUTE_PATH;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function readRequiredString(params: {
  key: string;
  pluginValue: unknown;
  envValue?: string;
  issues: MeetingIngressConfigIssue[];
}): string {
  const value = asString(params.pluginValue) ?? asString(params.envValue);
  if (!value) {
    params.issues.push({ key: params.key, message: "is required" });
    return "";
  }
  return value;
}

export function resolveMeetingIngressPluginConfig(params: {
  pluginConfig: unknown;
  env?: NodeJS.ProcessEnv;
}): MeetingIngressPluginConfig {
  const env = params.env ?? process.env;
  const raw = asObject(params.pluginConfig) ?? {};
  const source = asObject(raw.source) ?? {};
  const sourceFathom = asObject(source.fathom) ?? {};
  const forward = asObject(raw.forward) ?? {};

  const enabled = raw.enabled === true;
  const routePath = normalizePath(asString(raw.routePath) ?? DEFAULT_ROUTE_PATH);
  const maxBodyBytes = asPositiveInt(raw.maxBodyBytes) ?? DEFAULT_MAX_BODY_BYTES;
  const sourceProvider = (asString(raw.sourceProvider) ?? DEFAULT_SOURCE_PROVIDER) as "fathom";

  if (!enabled) {
    return {
      enabled,
      routePath,
      maxBodyBytes,
      sourceProvider,
      source: {
        fathom: {
          apiKey: "",
          webhookSecret: "",
          baseUrl: DEFAULT_FATHOM_BASE_URL,
        },
      },
      forward: {
        hooksBaseUrl: "",
        hooksPath: DEFAULT_HOOKS_PATH,
        hooksToken: "",
        timeoutMs: DEFAULT_FORWARD_TIMEOUT_MS,
      },
    };
  }

  const issues: MeetingIngressConfigIssue[] = [];
  if (sourceProvider !== "fathom") {
    issues.push({ key: "sourceProvider", message: "must be fathom" });
  }

  const apiKey = readRequiredString({
    key: "source.fathom.apiKey",
    pluginValue: sourceFathom.apiKey,
    envValue: env.SOURCE_FATHOM_API_KEY,
    issues,
  });
  const webhookSecret = readRequiredString({
    key: "source.fathom.webhookSecret",
    pluginValue: sourceFathom.webhookSecret,
    envValue: env.SOURCE_FATHOM_WEBHOOK_SECRET,
    issues,
  });
  const hooksBaseUrl = readRequiredString({
    key: "forward.hooksBaseUrl",
    pluginValue: forward.hooksBaseUrl,
    envValue: env.OPENCLAW_HOOKS_BASE_URL,
    issues,
  });
  const hooksToken = readRequiredString({
    key: "forward.hooksToken",
    pluginValue: forward.hooksToken,
    envValue: env.OPENCLAW_HOOKS_TOKEN,
    issues,
  });

  const baseUrl = asString(sourceFathom.baseUrl) ?? DEFAULT_FATHOM_BASE_URL;
  const hooksPath = normalizePath(asString(forward.hooksPath) ?? DEFAULT_HOOKS_PATH);
  const timeoutMs = asPositiveInt(forward.timeoutMs) ?? DEFAULT_FORWARD_TIMEOUT_MS;

  if (issues.length > 0) {
    throw new MeetingIngressConfigError(issues);
  }

  return {
    enabled,
    routePath,
    maxBodyBytes,
    sourceProvider,
    source: {
      fathom: {
        apiKey,
        webhookSecret,
        baseUrl,
      },
    },
    forward: {
      hooksBaseUrl,
      hooksPath,
      hooksToken,
      timeoutMs,
    },
  };
}
