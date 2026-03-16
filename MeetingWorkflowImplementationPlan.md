# Meeting Workflow Implementation Plan

This plan completes the meeting automation feature on top of the working account-specific Fathom ingress setup.

## Goal

Build the full workflow so that a finished meeting can:

1. enter OpenClaw through the existing Fathom webhook ingress,
2. be summarized with configurable LLM steps,
3. be written to Google Docs,
4. create tasks in ClickUp,
5. remain modular so source/document/task providers can be swapped later without rewriting the orchestrator.

## Architectural Decision

Use a single plugin with strong internal boundaries.

For codebase consistency, the preferred in-repo source location is:

- package: `extensions/meeting-workflow/`

Why this is better than a new top-level `external-plugins/` directory for the final implementation:

- the current OpenClaw codebase already uses `extensions/*` for plugin/extension packages,
- it matches repo structure and contributor expectations,
- it is still additive and low-conflict for upstream syncs,
- it keeps the implementation aligned with existing package discovery and maintenance patterns.

Deployment can still treat it like an external plugin by installing that directory as a linked plugin on the server.

Design rules:

- keep ingress, workflow logic, LLM steps, and provider adapters in one deployable plugin
- keep vendor-specific logic behind provider ports
- keep model choice at the workflow-step layer, not inside adapters

This is the best balance of:

- low upstream sync conflict risk,
- lower operational complexity than multiple plugins,
- clean modularity,
- step-level model flexibility.

## Current Baseline

Already working:

- public webhook endpoint via Cloudflare Tunnel
- account-specific Fathom webhook routes
- Fathom webhook signature verification
- direct webhook -> workflow runtime execution
- summary generation runtime
- structured action-item extraction runtime
- Google Docs runtime integration
- ClickUp runtime integration
- cached workflow results and reporting

Remaining hardening work:

- optionally persist refreshed Google access tokens back into config or state
- optionally add service-account-based Google auth as an alternative auth mode
- keep server runbooks aligned with the production user-service deployment model

## Final Plugin Structure

```text
extensions/
  meeting-workflow/
    index.ts
    package.json
    openclaw.plugin.json
    README.md
    vitest.config.ts

    src/
      config/
        schema.ts
        load.ts
        types.ts

      contracts/
        meeting-event-v1.ts
        meeting-insights-v1.ts
        meeting-doc-v1.ts
        task-result-v1.ts

      ingress/
        http-handler.ts
        read-body.ts
        response.ts

      sources/
        ports.ts
        registry.ts
        fathom/
          adapter.ts
          signature.ts
          mapper.ts
          fallback.ts

      workflow/
        orchestrator.ts
        idempotency.ts
        reporting.ts
        run-context.ts

      llm/
        ports.ts
        registry.ts
        summary-step.ts
        action-items-step.ts
        schemas.ts

      documents/
        ports.ts
        registry.ts
        google-docs/
          adapter.ts

      tasks/
        ports.ts
        registry.ts
        clickup/
          adapter.ts

      runtime/
        hook-dispatch.ts
        session-key.ts

      shared/
        errors.ts
        logger.ts
        strings.ts
        dates.ts
```

## Contracts To Implement

### `meeting-event-v1`

Input from source ingress/runtime:

- `meetingId`
- `source`
- `sourceAccountKey`
- `sourceAccountLabel`
- optional `sourceAccountEmail`
- `title`
- `endedAt`
- `transcript`
- `participants`
- optional `sourceInsights`

### `meeting-insights-v1`

Output from LLM workflow:

- `summary`
- `actionItems[]`
  - `title`
  - `owner`
  - `ownerConfidence`
  - `dueDate`
  - `comments[]`

### `meeting-doc-v1`

Output from document adapter:

- `sourceAccountKey`
- `docId`
- `docUrl`
- optional folder hierarchy ids

### `task-result-v1`

Output from task adapter:

- `parentTaskId`
- `subtaskIds[]`
- `taskUrls[]`
- `createdCount`

## Multi-Account Source Design

The workflow must support multiple Fathom accounts, one per job/email.

### Recommendation

Use explicit account profiles in config, not implicit email-only routing.

Each account should have:

- `accountKey` - stable internal identifier, for example `job-a` or `job-b`
- `label` - human-readable label used in folder/task naming
- optional `email` - for operator visibility
- `apiKey`
- `webhookSecret`
- dedicated `routePath`

Example:

```json5
{
  sourceAccounts: {
    jobA: {
      label: "Consulting",
      email: "me+consulting@example.com",
      routePath: "/integrations/source/fathom/job-a/webhook",
      apiKey: "${SOURCE_FATHOM_JOB_A_API_KEY}",
      webhookSecret: "${SOURCE_FATHOM_JOB_A_WEBHOOK_SECRET}",
    },
    jobB: {
      label: "Employer",
      email: "me+employer@example.com",
      routePath: "/integrations/source/fathom/job-b/webhook",
      apiKey: "${SOURCE_FATHOM_JOB_B_API_KEY}",
      webhookSecret: "${SOURCE_FATHOM_JOB_B_WEBHOOK_SECRET}",
    },
  },
}
```

### Why explicit account profiles are better

- avoids ambiguity between two Fathom accounts
- separates secrets cleanly
- lets each account use different storage/task destinations
- makes replay/reporting easier
- does not rely on Fathom always sending the same account-identifying field shape

### Best routing choice

Use one webhook endpoint per account profile.

Examples:

- `/integrations/source/fathom/job-a/webhook`
- `/integrations/source/fathom/job-b/webhook`

This is simpler and safer than trying to infer which account sent the webhook from payload contents alone.

### Folder and task partitioning

Document and task outputs should be partitioned by `sourceAccountKey` or `label`.

Recommended Google Docs hierarchy:

```text
Meetings/
  <sourceAccountLabel>/
    YYYY/
      YYYY-MM/
        YYYY-MM-DD/
          <meeting doc>
```

Use an explicit per-account Google Docs timezone (for example `America/Costa_Rica`) so meetings near midnight UTC are grouped into the correct local day folder.

Use a dedicated transcript container folder under each account, for example `Meeting Transcripts`, so Drive clearly separates transcripts from any future meeting artifacts.

Recommended ClickUp partitioning:

- allow per-account destination config
- for example one ClickUp list/folder/space per account profile

This prevents work from different jobs from mixing.

## Provider Ports

### Source Port

Responsibilities:

- verify inbound source authenticity
- normalize provider payload
- optionally fetch fallback meeting details

### Document Port

Responsibilities:

- create/update transcript document
- append summary and action items
- return provider-neutral document result
- route writes using `sourceAccountKey`

### Task Port

Responsibilities:

- create/update meeting task structure
- map owners/assignees
- return provider-neutral task result
- route writes using `sourceAccountKey`

## LLM Workflow Design

Use two reasoning steps only:

1. `summary-step`
2. `action-items-step`

Owner extraction should be merged into `action-items-step`.

Each action item should include:

- `owner`
- `ownerConfidence`

This keeps the pipeline simpler while preserving uncertainty handling.

## Model Configuration

Each step can use a different model:

```json5
{
  models: {
    summary: {
      model: "openai/gpt-5.2-mini",
      thinking: "low",
    },
    actionItems: {
      model: "openai/gpt-5.4",
      thinking: "medium",
    },
  },
}
```

Rules:

- model selection belongs to LLM steps, not adapters
- adapters should perform side effects only

## Implementation Phases

### Phase 1 — Move plugin to codebase-aligned location

Tasks:

- move/reshape `external-plugins/meeting-workflow-ingress/` into `extensions/meeting-workflow/`
- preserve current ingress behavior exactly
- move source-specific logic under `src/sources/fathom/`
- move HTTP logic under `src/ingress/`
- prepare for multiple route paths keyed by source account profile

Done when:

- existing `405` / `401` / `202` behavior still passes unchanged

### Phase 2 — Add provider-neutral contracts and config layer

Tasks:

- implement typed contracts for meeting event, insights, docs, and task results
- add plugin config schema for:
  - source accounts
  - document provider
  - task provider
  - per-step models
  - provider credentials/config
  - per-account destination settings

Done when:

- runtime code uses contracts at all module boundaries
- config can select models per LLM step
- each webhook path is bound to a known `sourceAccountKey`

### Phase 3 — Add workflow orchestrator and idempotency

Tasks:

- implement `workflow/orchestrator.ts`
- implement idempotency store keyed by `meetingId`
- implement workflow run reporting

Flow:

1. ingest `meeting-event-v1`
2. summarize
3. extract action items
4. write document into the account-specific document destination
5. create tasks in the account-specific task destination
6. persist report

Done when:

- replay of same meeting does not duplicate output
- each run produces a report artifact

### Phase 4 — Implement LLM steps

Tasks:

- implement `summary-step.ts`
- implement `action-items-step.ts`
- enforce structured output validation
- add one bounded repair retry for malformed model output

Done when:

- `meeting-insights-v1` is always validated before adapter calls

### Phase 5 — Implement Google Docs adapter

Tasks:

- create/reuse date-based folder structure
- partition under account label/key first
- create canonical transcript doc
- append summary/action items
- make writes idempotent per run/meeting

Done when:

- same meeting updates same document
- document result returns stable id/url

### Phase 6 — Implement ClickUp adapter

Tasks:

- create parent task for meeting
- create subtasks for action items
- map owners/assignees
- resolve ClickUp destination from `sourceAccountKey`
- support due dates/comments
- prevent duplicates on replay

Done when:

- task creation is deterministic and replay-safe

### Phase 7 — Connect `meeting-ops` runtime

Tasks:

- add a deterministic runtime entry under `src/runtime/`
- support `meeting-ops` for manual and dry-run invocation through plugin tools
- for production webhook handling, execute the workflow directly in the route handler

Done when:

- incoming webhook executes the workflow directly without depending on agent prompt/tool choice

### Phase 8 — Tests and live validation

Tests to add:

- ingress tests
- contract validation tests
- LLM step tests
- Google Docs adapter tests
- ClickUp adapter tests
- orchestrator replay/dedupe tests
- provider swap stub tests

Live validation:

- signed test webhook -> `202`
- real Fathom meeting -> workflow runs successfully
- verify doc creation and ClickUp task creation

## Operational Rules

- Never commit live secrets.
- Keep server config represented as templates in `ops/meeting-ingress/`.
- Keep provider logic out of orchestrator.
- Keep LLM logic out of adapters.
- Route all meeting events to `meeting-ops`, not `main`.
- Keep account separation explicit through `sourceAccountKey`, not inferred ad hoc from display strings.

## Immediate Next Build Order

1. rename/restructure plugin package
2. add multi-account contracts/config/types
3. add summary + action-items steps
4. add orchestrator + idempotency + reporting
5. add Google Docs adapter
6. add ClickUp adapter
7. integrate `meeting-ops`
8. add tests and docs updates

## Current Implementation Progress

Implemented now:

- `extensions/meeting-workflow/` package scaffold
- multi-account ingress config and contract model
- per-account Fathom route registration
- account-aware Fathom normalization and fallback
- summary step and action-items step interfaces plus embedded-agent-based implementations
- Google Docs and ClickUp adapter interfaces with working adapter implementations around client abstractions
- workflow orchestrator skeleton
- `meeting-workflow-analyze` tool registration for `meeting-ops`

Still pending for a fully deployable end-to-end runtime:

- live credential deployment and server migration to the new extension package
- migration from the currently deployed ingress-only package to the final extension package

Implemented now as part of the new extension:

- persistent cached result store keyed by `sourceAccountKey + meetingId`
- workflow event fingerprinting
- run report writing under the plugin state directory

## Success Criteria

The implementation is complete when:

- a real Fathom webhook triggers the workflow,
- the meeting is summarized,
- transcript + summary are stored in Google Docs,
- tasks are created in ClickUp,
- reruns are idempotent,
- models can be selected independently for summary and action-item extraction,
- the whole feature remains isolated from OpenClaw core.
