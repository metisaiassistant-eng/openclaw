# Meeting Workflow in OpenClaw (OpenClaw-only)

## Goal

Implement a fully automated workflow where:

1. A meeting ends in a note-taker source (initial adapter: Fathom).
2. OpenClaw receives and normalizes the meeting payload.
3. OpenClaw stores transcript + summary in a document system (initial adapter: Google Drive + Google Docs).
4. OpenClaw creates action tasks in a task system (initial adapter: ClickUp).
5. The architecture is provider-swappable, so source/doc/task providers can be replaced without changing orchestration core logic.

---

## Simple Mental Model

Treat the workflow as Lego blocks:

- **Source block**: receives note-taker event (Fathom now, replaceable later)
- **Document block**: writes transcript/summary to active document provider
- **Extraction block**: converts transcript into structured summary + action items
- **Task block**: writes parent task + subtasks/comments to active task provider

Each block has a clear input and output. Because of that, each block can be changed without rewriting everything else.

---

## Recommended OpenClaw Architecture

Use one dedicated agent for this workflow:

- Agent ID: `meeting-ops`
- Role: process completed meeting events only
- Trigger: webhook mapping (`/hooks/meeting-source`)
- Execution mode: isolated per meeting (one session per meeting ID)

### Why this works well

- Isolated runs avoid context pollution from normal chats.
- Dedicated workspace keeps prompt/context small and token efficient.
- You can version each module independently.
- If one module fails, recovery is easier and safer.

---

## Provider-Swappable Design (Required)

Use **ports and adapters**:

- Core workflow uses provider-neutral interfaces only.
- Providers are implemented as adapters.
- Active adapters are selected by config.

### Core ports (do not put provider logic here)

```ts
type MeetingSourcePort = {
  verifyInbound(headers: Record<string, string>, rawBody: string | Buffer): Promise<void>;
  normalizeInbound(rawBody: string | Buffer): Promise<MeetingEventV1>;
  fetchMeetingFallback(input: {
    meetingId?: string;
    startedAfter?: string;
    startedBefore?: string;
  }): Promise<MeetingEventV1 | null>;
};

type DocumentStorePort = {
  upsertTranscript(input: MeetingEventV1): Promise<MeetingDocV1>;
  appendSummary(input: {
    doc: MeetingDocV1;
    insights: MeetingInsightsV1;
    model: string;
    generatedAt: string;
  }): Promise<void>;
};

type TaskStorePort = {
  upsertMeetingTasks(input: {
    meeting: MeetingEventV1;
    insights: MeetingInsightsV1;
    ownerName: string;
    assigneeIds: string[];
  }): Promise<TaskResultV1>;
};
```

### Adapter implementations (initial + future)

- `MeetingSourcePort`
  - initial: `fathom`
  - future examples: `fireflies`, `otter`, `tl;dv`, custom recorder
- `DocumentStorePort`
  - initial: `google_docs`
  - future examples: `clickup_docs`, `notion`, `confluence`, `obsidian`
- `TaskStorePort`
  - initial: `clickup`
  - future examples: `jira`, `asana`, `linear`, `trello`

### Adapter selection config

```json5
{
  workflow: {
    adapters: {
      source: "fathom",
      document: "google_docs",
      task: "clickup",
    },
  },
}
```

Rule: switching providers should only require changing adapter config + provider credentials, not rewriting the orchestrator.

---

## Fathom AI Integration (Expanded Source Adapter)

This section describes the **current `fathom` source adapter** implementation. Keep all Fathom-specific logic inside this adapter only.

### 1) Integration pattern

Use a **webhook-first + polling fallback** pattern:

- Primary path: Fathom sends webhook when meeting content is ready.
- Fallback path: if webhook processing fails or transcript is incomplete, fetch meeting data via API.

### 2) API basics you must implement

- Base API URL: `https://api.fathom.ai/external/v1`
- Auth header for API calls: `X-Api-Key: <FATHOM_API_KEY>`
- Handle standard API failures explicitly:
  - `400` invalid request parameters
  - `401` missing/invalid auth
  - `429` rate limited (retry with backoff)

### 3) Webhook creation contract

Create webhook through `POST /webhooks` with:

- `destination_url`
- `triggered_for` (at least one value)
- At least one include flag set to `true`:
  - `include_transcript`
  - `include_summary`
  - `include_action_items`
  - `include_crm_matches`

Recommended for this workflow:

- `include_transcript: true`
- `include_summary: true`
- `include_action_items: true`

Store webhook creation response values securely:

- `id` (for lifecycle management)
- `secret` (required to verify signatures)

### 4) Signature verification (required)

Verify every incoming webhook before any processing.

- Header to read: `webhook-signature`
- Verification logic:
  1. Read **raw request body bytes/string** (not parsed JSON stringified back).
  2. Compute `HMAC-SHA256(secret, rawBody)`.
  3. Base64-encode digest.
  4. Compare with signature values in `webhook-signature` header.

You can use SDK helpers:

- TypeScript: `Fathom.verifyWebhook(webhookSecret, headers, rawBody)`
- Python: `Fathom.verify_webhook(webhook_secret, headers, raw_body)`

Reject invalid signatures with `401` and do not process payload.

### 5) Why an ingress adapter is recommended

OpenClaw hooks require OpenClaw auth headers, while Fathom webhook creation docs expose `destination_url` and include flags (no documented custom header injection in webhook create payload).

Recommended design:

1. Create a small **Fathom ingress adapter** endpoint.
2. Adapter verifies Fathom signature.
3. Adapter forwards normalized payload to OpenClaw mapped hook (`/hooks/meeting-source`) using OpenClaw bearer token.

This preserves both security models:

- Fathom signature verification
- OpenClaw hook token verification

### 6) Polling fallback (API)

If webhook payload is missing required data or processing fails repeatedly, fetch meeting data from API:

- Endpoint: `GET /meetings`
- Use filters (`created_after`, `created_before`, optional `recorded_by[]`)
- Request transcript with `include_transcript=true`
- Handle pagination via `next_cursor` until target meeting is found

### 7) SDK choice and usage

Use one SDK consistently in your adapter/service:

- TypeScript package: `fathom-typescript`
- Python package: `fathom-python`

Required operations for this workflow:

- Create/list/delete webhooks
- List meetings (fallback)
- Verify webhook signatures

### 8) Fathom-to-internal field mapping

In the `fathom` adapter, map Fathom payload to internal `meeting-event-v1` with stable keys:

- `meetingId` (prefer stable recording/meeting identifier)
- `title`
- `endedAt`
- `transcript`
- `participants[]`
- optional: `summary`, `actionItems` if included by Fathom webhook

If webhook has summary/action items, keep them as `sourceInsights` and still run your own extraction for consistency.

---

## Module Design

## 1) Source Module (`MeetingSourcePort`)

**Responsibility**

- Receive note-taker "meeting completed" events.
- Validate source signature/auth inside adapter.
- Normalize payload into one stable internal JSON shape.

**Input**

- Raw provider webhook payload.

**Output (example)**

```json
{
  "schemaVersion": "meeting-event-v1",
  "meetingId": "abc123",
  "source": "fathom",
  "platform": "google_meet",
  "title": "Weekly Product Sync",
  "endedAt": "2026-03-09T18:30:00Z",
  "transcript": "...",
  "participants": ["Carlos Valverde Solera", "Ana", "Luis"]
}
```

---

## 2) Document Module (`DocumentStorePort`)

**Responsibility**

- Build provider-specific storage structure from `endedAt`:
  - year folder
  - month folder
  - day folder
- Create/update the canonical transcript document/record.
- Write transcript body.
- Append LLM summary later in same document/record.

**Input**

- `meeting-event-v1`

**Output (example)**

```json
{
  "schemaVersion": "meeting-doc-v1",
  "meetingId": "abc123",
  "yearFolderId": "...",
  "monthFolderId": "...",
  "dayFolderId": "...",
  "docId": "...",
  "docUrl": "https://docs.google.com/document/d/..."
}
```

---

## 3) Extraction Module (LLM)

**Responsibility**

- Read transcript.
- Produce structured output:
  - summary
  - action items
  - owners
  - due dates
  - speaker comments linked to tasks

**Input**

- transcript text + participant list

**Output (example)**

```json
{
  "schemaVersion": "meeting-insights-v1",
  "summary": "...",
  "actionItems": [
    {
      "title": "Prepare pricing proposal",
      "owner": "Carlos Valverde Solera",
      "dueDate": "2026-03-15",
      "comments": [
        {
          "speaker": "Ana",
          "text": "Please include enterprise discount options."
        }
      ]
    }
  ]
}
```

Use schema validation so downstream modules get deterministic JSON.

---

## 4) Task Module (`TaskStorePort`)

**Responsibility**

- Filter extracted action items where owner is Carlos.
- Create one parent task in configured task-system location.
- Create one subtask per Carlos action item.
- Assign each task/subtask to:
  - Carlos Valverde Solera
  - METIS AI Assistant
- Add due dates and comments when available.

**Input**

- `meeting-insights-v1` + task-provider config (project/list/folder IDs + assignee IDs)

**Output (example)**

```json
{
  "schemaVersion": "task-result-v1",
  "parentTaskId": "...",
  "subtaskIds": ["...", "..."],
  "createdCount": 2
}
```

---

## End-to-End Flow

1. Active source adapter receives webhook (initial: Fathom) and verifies authenticity.
2. Source adapter forwards normalized payload to OpenClaw mapped hook with deterministic session key (`hook:meeting:<meetingId>`).
3. Source module returns canonical `meeting-event-v1`.
4. Document module writes transcript using active document adapter (initial: Google Docs).
5. Extraction module generates canonical `meeting-insights-v1`.
6. Document module appends summary via active document adapter.
7. Task module creates parent + subtasks via active task adapter (initial: ClickUp).
8. Workflow writes final execution report (doc URL + task URLs + errors/warnings + adapter IDs).

---

## Control Plane: Who Controls What

- **OpenClaw config** controls:
  - webhook auth
  - mapping routes
  - allowed target agents
  - model overrides per webhook
- **`meeting-ops` agent** controls:
  - orchestration logic
  - module order
  - fallback/retry behavior
- **Adapter layer** controls:
  - provider-specific API calls and auth for source/document/task systems
- **Skills/scripts** control:
  - reusable helper logic used by adapters and orchestrator

---

## Token-Efficient Specialization

Keep `meeting-ops` cheap and focused:

1. **Small workspace context**
   - Keep `AGENTS.md` short and workflow-specific.
   - Do not load unrelated large files.

2. **Restrictive tool policy**
   - Allow only required tools/skills.
   - Deny browser/canvas/nodes/other unused tools.

3. **Cheap model by default**
   - Use a small model for extraction (for example `openai/gpt-5.2-mini`).
   - Increase model size only for low-confidence fallback.

4. **Schema-first extraction**
   - Force JSON output to reduce retries and parsing noise.

5. **Idempotent session keys**
   - Use `hook:meeting:<meetingId>` so retries do not duplicate task/doc creation.

6. **No heartbeat for this agent unless required**
   - Avoid background token usage.

---

## Suggested Folder Structure (inside `meeting-ops` workspace)

```text
meeting-ops/
  AGENTS.md
  workflows/
    meeting/
      contracts/
        meeting-event-v1.json
        meeting-doc-v1.json
        meeting-insights-v1.json
        task-result-v1.json
      adapters/
        source/
          fathom/
            adapter.ts
            signature.ts
            mapper.ts
            fallback.ts
          _template/
            adapter.ts
        document/
          google-docs/
            adapter.ts
          _template/
            adapter.ts
        task/
          clickup/
            adapter.ts
          _template/
            adapter.ts
      prompts/
        extract-insights.md
      runbook.md
  skills/
    meeting-source/
      SKILL.md
    meeting-document/
      SKILL.md
    meeting-extract/
      SKILL.md
    meeting-task/
      SKILL.md
```

This layout keeps contracts, prompts, and modules separate and reusable.

---

## OpenClaw Config Skeleton (illustrative)

```json5
{
  workflow: {
    adapters: {
      source: "fathom",
      document: "google_docs",
      task: "clickup",
    },
  },
  hooks: {
    enabled: true,
    token: "${OPENCLAW_HOOKS_TOKEN}",
    path: "/hooks",
    allowRequestSessionKey: false,
    allowedAgentIds: ["meeting-ops"],
    defaultSessionKey: "hook:meeting",
    mappings: [
      {
        match: { path: "meeting-source" },
        action: "agent",
        agentId: "meeting-ops",
        name: "Meeting Source Event",
        wakeMode: "now",
        sessionKey: "hook:meeting:{{meetingId}}",
        deliver: false,
        model: "openai/gpt-5.2-mini",
        thinking: "low",
      },
    ],
  },
  agents: {
    list: [
      {
        id: "meeting-ops",
        workspace: "~/.openclaw/workspace-meeting-ops",
        tools: {
          allow: ["read", "write", "edit", "apply_patch", "exec", "process"],
          deny: ["browser", "canvas", "nodes", "cron"],
        },
        model: "openai/gpt-5.2-mini",
      },
    ],
  },
}
```

Adjust the `tools` list to your real skill/tool requirements.

---

## Error Handling and Safety

1. **Idempotency**
   - Persist `meetingId -> docId/taskIds` mapping.
   - On retry, update existing records instead of creating duplicates.

2. **Partial failures**
   - If task adapter fails, still keep doc created and log failure status.
   - If summary fails, keep transcript and mark summary as pending.

3. **Confidence guards**
   - If owner assignment is uncertain, log as "needs review" rather than auto-create task.

4. **Audit logs**
   - Store final run report with:
     - meetingId
     - doc URL
     - created task IDs
     - warnings/errors

---

## Sequential Implementation Steps (Do in Order)

Follow this sequence exactly. For each step, complete all "Implement" bullets and verify "Done when" before moving on.

1. **Prepare provider-agnostic configuration**
   - Implement:
     - Add top-level provider selectors: `WORKFLOW_SOURCE_PROVIDER`, `WORKFLOW_DOCUMENT_PROVIDER`, `WORKFLOW_TASK_PROVIDER`.
     - Add global keys: `OPENCLAW_HOOKS_TOKEN`, `CANONICAL_OWNER_NAME`, `OWNER_ALIASES`.
     - Add per-provider config namespaces, for example:
       - `source.fathom.*`
       - `document.google_docs.*`
       - `task.clickup.*`
     - Build config validation so only selected providers are required.
   - Done when:
     - Missing keys are reported only for active providers.
     - Switching provider selector changes which keys are required, without code changes.

2. **Create the dedicated workflow agent**
   - Implement:
     - Add `meeting-ops` to `agents.list`.
     - Set isolated workspace (for example `~/.openclaw/workspace-meeting-ops`).
     - Set a small default model (for example `openai/gpt-5.2-mini`) and low thinking.
   - Done when:
     - `meeting-ops` appears in `openclaw agents list --bindings`.
     - Agent runs are isolated from the main agent workspace.

3. **Restrict tool access for safety and token efficiency**
   - Implement:
     - In `agents.list[].tools`, allow minimum required tools only.
     - Deny unrelated tools (`browser`, `canvas`, `nodes`, and `cron` unless used intentionally).
     - Keep elevated exec disabled unless required by a specific adapter.
   - Done when:
     - Workflow works with restricted tools.
     - Blocked tools fail with policy errors.

4. **Implement adapter interfaces and registry**
   - Implement:
     - Create interfaces for `MeetingSourcePort`, `DocumentStorePort`, and `TaskStorePort`.
     - Create adapter registry/factory that resolves implementation by provider selector.
     - Ensure orchestrator imports only interfaces and registry, never provider SDKs directly.
   - Done when:
     - Changing provider selectors instantiates different adapters.
     - Core orchestrator code has zero provider-specific imports.

5. **Configure source ingress for active source adapter (initial: Fathom)**
   - Implement:
     - Build source adapter endpoint (for example `/integrations/source/fathom/webhook`).
     - Verify source signature/auth in adapter (for Fathom: `webhook-signature` + secret).
     - Forward normalized payload to OpenClaw mapped endpoint `POST /hooks/meeting-source` with OpenClaw bearer token.
     - Configure OpenClaw mapping for `/hooks/meeting-source` to `meeting-ops`.
     - Use deterministic session key format `hook:meeting:<meetingId>` in mapping template.
   - Done when:
     - Valid source event triggers exactly one `meeting-ops` run.
     - Invalid signature/auth returns `401` and triggers zero runs.
     - Replay of same meeting ID reuses same session key.

6. **Define versioned provider-neutral contracts**
   - Implement:
     - Create JSON schema files for `meeting-event-v1`, `meeting-doc-v1`, `meeting-insights-v1`, and `task-result-v1`.
     - Require `schemaVersion` and `meetingId` where applicable.
     - Set `additionalProperties: false` for strictness.
   - Done when:
     - Invalid payloads fail schema validation with clear errors.
     - Valid sample payloads pass all contract validators.

7. **Implement source adapter + ingest normalization (initial: Fathom)**
   - Implement:
     - Implement `MeetingSourcePort.verifyInbound`, `normalizeInbound`, and `fetchMeetingFallback`.
     - Normalize provider payload to `meeting-event-v1` (`meetingId`, `endedAt`, `transcript`, `participants`).
     - Map optional provider-native summary/action items to optional `sourceInsights`.
     - Add API fallback for missing transcript.
   - Done when:
     - Valid source payload returns `meeting-event-v1`.
     - Missing required fields fail with explicit errors.
     - Fallback recovery works when webhook transcript is absent.

8. **Implement document adapter (initial: Google Docs)**
   - Implement:
     - Implement `DocumentStorePort.upsertTranscript`.
     - For Google adapter, create/reuse `YYYY/MM/YYYY-MM-DD` folders and create one doc per meeting.
     - Write deterministic transcript structure (`title`, `date`, `participants`, `transcript`).
     - Return `meeting-doc-v1`.
   - Done when:
     - Transcript record is created and retrievable using returned `docId`.
     - Folder hierarchy logic is isolated to Google adapter only.

9. **Implement extraction core (provider-independent)**
   - Implement:
     - Build extraction function that consumes only `meeting-event-v1` and outputs `meeting-insights-v1`.
     - Enforce strict JSON output and schema validation.
     - Add one bounded retry for JSON repair.
   - Done when:
     - Output always validates against `meeting-insights-v1`.
     - Retry behavior is bounded and logged.

10. **Implement summary append via active document adapter**
    - Implement:
      - Implement `DocumentStorePort.appendSummary`.
      - Append `Summary` and `Action Items` sections + metadata (`generatedAt`, `model`, `schemaVersion`).
      - Ensure idempotent append semantics per run id.
    - Done when:
      - Existing transcript remains unchanged.
      - Summary/action sections are not duplicated on replay.

11. **Implement task adapter (initial: ClickUp)**
    - Implement:
      - Implement `TaskStorePort.upsertMeetingTasks`.
      - Filter action items for Carlos using normalized owner matching + aliases.
      - Create parent task and one subtask per Carlos action item.
      - Assign Carlos + METIS and add due dates/comments.
      - Return provider-neutral `task-result-v1`.
    - Done when:
      - Correct parent/subtask counts are created.
      - Assignees, due dates, and comments are correctly applied.

12. **Add idempotency, dedupe, and concurrency locks**
    - Implement:
      - Create persistent idempotency store keyed by `meetingId`.
      - Persist provider event fingerprint as `sourceEventHash`.
      - Save linkage: `meetingId -> docId, parentTaskId, subtaskIds, lastRunStatus`.
      - Add per-`meetingId` lock to prevent parallel duplicate runs.
    - Done when:
      - Replay does not duplicate docs/tasks.
      - Concurrent duplicates collapse into one effective run.

13. **Add run reporting and adapter telemetry**
    - Implement:
      - Emit per-run report with `meetingId`, `sessionKey`, selected adapters (`source`, `document`, `task`), IDs/URLs, duration, retries, warnings, errors.
      - Persist reports and include correlation IDs in logs.
    - Done when:
      - Every run has one report artifact.
      - Failures are diagnosable and replayable.

14. **Run local test suite (including swap tests)**
    - Implement:
      - Add fixtures: normal scenarios, invalid signature, missing transcript with fallback.
      - Add adapter contract tests for each port.
      - Add swap test: replace one adapter with a stub/mock implementation and run full orchestrator tests unchanged.
    - Done when:
      - Contract tests and fixture tests pass.
      - Swap test proves orchestrator works without provider-specific changes.

15. **Run live validation and go-live hardening**
    - Implement:
      - Run one live E2E flow using current adapters (Fathom + Google Docs + ClickUp).
      - Verify outputs (doc creation/append + task creation).
      - Rotate tokens/secrets, enable alerts, and finalize runbook.
      - Run one provider-swap drill in staging (for example task adapter stub or Jira adapter prototype) without orchestrator edits.
    - Done when:
      - Live run succeeds with expected outputs.
      - Monitoring and runbook are active.
      - Provider-swap drill succeeds with config/adapter changes only.

---

## Final Notes

- This design keeps everything in OpenClaw while preserving modularity.
- The key to modular reuse is strict input/output contracts per module.
- The key to reliability is idempotency + isolated per-meeting runs.
- The key to token efficiency is a small, dedicated agent with minimal context and strict tool access.
