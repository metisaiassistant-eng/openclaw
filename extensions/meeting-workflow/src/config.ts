type Dict = Record<string, unknown>;

export type MeetingThinkingLevel = "none" | "low" | "medium" | "high";

export type MeetingModelConfig = {
  model: string;
  thinking?: MeetingThinkingLevel;
};

export type MeetingWorkflowAccountConfig = {
  accountKey: string;
  label: string;
  email?: string;
  routePath: string;
  provider: "fathom";
  fathom: {
    apiKey: string;
    webhookSecret: string;
    baseUrl: string;
  };
  documents?: {
    provider?: "google_docs";
    googleDocs?: {
      rootFolderId?: string;
      accessToken?: string;
      titlePrefix?: string;
    };
  };
  tasks?: {
    provider?: "clickup";
    clickup?: {
      listId?: string;
      apiKey?: string;
      assigneeIds?: string[];
    };
  };
  models?: {
    summary?: MeetingModelConfig;
    actionItems?: MeetingModelConfig;
  };
};

export type MeetingWorkflowPluginConfig = {
  enabled: boolean;
  maxBodyBytes: number;
  forward: {
    hooksBaseUrl: string;
    hooksPath: string;
    hooksToken: string;
    timeoutMs: number;
  };
  accounts: MeetingWorkflowAccountConfig[];
};

export type MeetingWorkflowConfigIssue = {
  key: string;
  message: string;
};

export class MeetingWorkflowConfigError extends Error {
  readonly issues: MeetingWorkflowConfigIssue[];

  constructor(issues: MeetingWorkflowConfigIssue[]) {
    super(
      `meeting-workflow config is invalid:\n${issues.map((issue) => `- ${issue.key}: ${issue.message}`).join("\n")}`,
    );
    this.name = "MeetingWorkflowConfigError";
    this.issues = issues;
  }
}

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
  return path.startsWith("/") ? path : `/${path}`;
}

function parseModelConfig(raw: unknown): MeetingModelConfig | undefined {
  const obj = asObject(raw);
  if (!obj) {
    return undefined;
  }
  const model = asString(obj.model);
  if (!model) {
    return undefined;
  }
  const thinkingRaw = asString(obj.thinking);
  const thinking =
    thinkingRaw === "none" ||
    thinkingRaw === "low" ||
    thinkingRaw === "medium" ||
    thinkingRaw === "high"
      ? thinkingRaw
      : undefined;
  return { model, ...(thinking ? { thinking } : {}) };
}

function requiredString(params: {
  key: string;
  value: unknown;
  issues: MeetingWorkflowConfigIssue[];
}): string {
  const value = asString(params.value);
  if (!value) {
    params.issues.push({ key: params.key, message: "is required" });
    return "";
  }
  return value;
}

export function resolveMeetingWorkflowConfig(pluginConfig: unknown): MeetingWorkflowPluginConfig {
  const raw = asObject(pluginConfig) ?? {};
  const enabled = raw.enabled === true;
  const maxBodyBytes = asPositiveInt(raw.maxBodyBytes) ?? DEFAULT_MAX_BODY_BYTES;
  const forwardRaw = asObject(raw.forward) ?? {};
  const accountsRaw = Array.isArray(raw.accounts) ? raw.accounts : [];

  if (!enabled) {
    return {
      enabled,
      maxBodyBytes,
      forward: {
        hooksBaseUrl: "",
        hooksPath: DEFAULT_HOOKS_PATH,
        hooksToken: "",
        timeoutMs: DEFAULT_FORWARD_TIMEOUT_MS,
      },
      accounts: [],
    };
  }

  const issues: MeetingWorkflowConfigIssue[] = [];
  const hooksBaseUrl = requiredString({
    key: "forward.hooksBaseUrl",
    value: forwardRaw.hooksBaseUrl,
    issues,
  });
  const hooksToken = requiredString({
    key: "forward.hooksToken",
    value: forwardRaw.hooksToken,
    issues,
  });
  const hooksPath = normalizePath(asString(forwardRaw.hooksPath) ?? DEFAULT_HOOKS_PATH);
  const timeoutMs = asPositiveInt(forwardRaw.timeoutMs) ?? DEFAULT_FORWARD_TIMEOUT_MS;

  const accounts: MeetingWorkflowAccountConfig[] = accountsRaw.map((entry, index) => {
    const baseKey = `accounts[${index}]`;
    const obj = asObject(entry) ?? {};
    const provider = (asString(obj.provider) ?? "fathom") as "fathom";
    if (provider !== "fathom") {
      issues.push({ key: `${baseKey}.provider`, message: "must be fathom" });
    }
    const fathom = asObject(obj.fathom) ?? {};
    const documents = asObject(obj.documents) ?? {};
    const googleDocs = asObject(documents.googleDocs) ?? {};
    const tasks = asObject(obj.tasks) ?? {};
    const clickup = asObject(tasks.clickup) ?? {};
    const models = asObject(obj.models) ?? {};

    return {
      accountKey: requiredString({ key: `${baseKey}.accountKey`, value: obj.accountKey, issues }),
      label: requiredString({ key: `${baseKey}.label`, value: obj.label, issues }),
      email: asString(obj.email),
      routePath: normalizePath(
        requiredString({ key: `${baseKey}.routePath`, value: obj.routePath, issues }),
      ),
      provider,
      fathom: {
        apiKey: requiredString({ key: `${baseKey}.fathom.apiKey`, value: fathom.apiKey, issues }),
        webhookSecret: requiredString({
          key: `${baseKey}.fathom.webhookSecret`,
          value: fathom.webhookSecret,
          issues,
        }),
        baseUrl: asString(fathom.baseUrl) ?? DEFAULT_FATHOM_BASE_URL,
      },
      documents:
        Object.keys(documents).length > 0
          ? {
              provider: (asString(documents.provider) ?? "google_docs") as "google_docs",
              googleDocs: {
                rootFolderId: asString(googleDocs.rootFolderId),
                accessToken: asString(googleDocs.accessToken),
                titlePrefix: asString(googleDocs.titlePrefix),
              },
            }
          : undefined,
      tasks:
        Object.keys(tasks).length > 0
          ? {
              provider: (asString(tasks.provider) ?? "clickup") as "clickup",
              clickup: {
                listId: asString(clickup.listId),
                apiKey: asString(clickup.apiKey),
                assigneeIds: Array.isArray(clickup.assigneeIds)
                  ? clickup.assigneeIds.filter(
                      (value): value is string => typeof value === "string",
                    )
                  : undefined,
              },
            }
          : undefined,
      models:
        Object.keys(models).length > 0
          ? {
              summary: parseModelConfig(models.summary),
              actionItems: parseModelConfig(models.actionItems),
            }
          : undefined,
    };
  });

  if (accounts.length === 0) {
    issues.push({ key: "accounts", message: "must contain at least one source account" });
  }

  const routePaths = new Set<string>();
  const accountKeys = new Set<string>();
  for (const account of accounts) {
    if (routePaths.has(account.routePath)) {
      issues.push({
        key: `accounts.${account.accountKey}.routePath`,
        message: `duplicate routePath ${account.routePath}`,
      });
    }
    routePaths.add(account.routePath);
    if (accountKeys.has(account.accountKey)) {
      issues.push({
        key: `accounts.${account.accountKey}.accountKey`,
        message: `duplicate accountKey ${account.accountKey}`,
      });
    }
    accountKeys.add(account.accountKey);
  }

  if (issues.length > 0) {
    throw new MeetingWorkflowConfigError(issues);
  }

  return {
    enabled,
    maxBodyBytes,
    forward: {
      hooksBaseUrl,
      hooksPath,
      hooksToken,
      timeoutMs,
    },
    accounts,
  };
}
