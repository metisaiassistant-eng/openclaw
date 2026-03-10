# Fork Feature Implementation Guidelines (Sync-Safe)

Use this guide for all new custom features in this fork.

## Goal

Minimize merge/rebase conflicts with upstream `openclaw/openclaw` while shipping custom behavior safely.

## Core Principle

Keep custom logic out of core whenever possible.

Preferred implementation order:

1. External plugin package (best)
2. In-repo plugin/extension (`extensions/*`)
3. Tiny core integration seam (only if strictly required)
4. Broad core refactor (avoid)

## Recommended Architecture

### 1) Plugin-first by default

- Implement custom features as plugins using `api.registerHttpRoute(...)`, `registerTool`, `registerHook`, etc.
- Keep plugin config in `openclaw.plugin.json` (do not rewrite core config schemas unless necessary).
- Use `auth: "plugin"` for webhooks that do their own signature verification.

### 2) Ports and adapters

- Keep business logic provider-agnostic.
- Define narrow interfaces (ports) and provider-specific adapters.
- Swapping providers must require adapter/config changes, not orchestrator rewrites.

### 3) Strict contracts

- Use versioned payload contracts (for example `meeting-event-v1`).
- Validate inputs early and fail with explicit errors.
- Keep contracts stable and additive.

### 4) Idempotency and replay safety

- Use deterministic keys (`meetingId`, event hashes).
- Design writes as upsert/idempotent operations.
- Handle retries and duplicate deliveries safely.

## What To Avoid

- Editing gateway bootstrap/router internals unless unavoidable.
- Large config pipeline rewrites for feature-specific settings.
- Cross-cutting changes in many core modules for one feature.
- Embedding provider SDK specifics directly in shared orchestration code.

## Allowed Core Changes (Exception Policy)

Only touch core when all are true:

1. Plugin API cannot support required behavior.
2. Change is minimal, isolated, and generic (not vendor-specific).
3. There is no lower-conflict alternative.
4. Tests prove no regression in existing flows.

If core touch is required:

- Keep it to one small integration seam.
- No architectural rewrites.
- No unrelated cleanup in the same PR.

## Implementation Workflow (Required)

1. **Design location decision**
   - Record why plugin vs core was chosen.
2. **Scope isolation**
   - Place all feature code in one plugin directory.
3. **API boundaries**
   - Define ports/contracts before provider calls.
4. **Security**
   - Verify webhook signatures on raw body.
   - Keep secrets in plugin config/env, never hardcoded.
5. **Reliability**
   - Add retry, timeout, and dedupe behavior.
6. **Tests**
   - Unit tests for adapters, validation, and handler behavior.
7. **Quality gates**
   - Run format + lint + plugin test suite.

## Sync Hygiene Rules

- Keep custom features in separate commits from formatting/refactors.
- Avoid touching upstream-hot files unless required.
- Prefer additive files over edits in shared internals.
- Keep commit messages scoped (`plugin(meeting-workflow-ingress): ...`).
- Rebase frequently to detect conflicts early.

## Plugin Project Shape (Template)

```text
external-plugins/<feature>/
  index.ts
  openclaw.plugin.json
  package.json
  README.md
  src/
    contracts.ts
    config.ts
    ports.ts
    adapters/
    http/
  vitest.config.ts
```

## Release/Deploy Pattern

- Preferred: publish plugin separately and install via `openclaw plugins install <npm-spec>`.
- Dev path: link local plugin directory with `openclaw plugins install -l <path>`.
- Keep plugin lifecycle independent from core OpenClaw upgrades.

## Pre-Merge Checklist

- [ ] Implemented as external plugin unless a justified exception exists
- [ ] No unnecessary core file edits
- [ ] Provider logic isolated behind adapters
- [ ] Inputs validated with strict contracts
- [ ] Webhook/security checks implemented
- [ ] Idempotency/replay handling implemented
- [ ] Tests added and passing
- [ ] Lint/format passing
- [ ] README documents install/config/run flow

Following this guide keeps fork customizations maintainable and significantly reduces future upstream sync conflicts.
