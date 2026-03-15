# Meetings Ops

This document describes how the meeting webhook feature is set up in this fork.

Note: the currently deployed ingress on the server uses the earlier ingress plugin path, while the in-repo long-term implementation target now lives under `extensions/meeting-workflow/`.

## Overview

The feature uses an OpenClaw plugin that receives Fathom webhooks, verifies the webhook signature, normalizes the payload, and runs the meeting workflow directly.

Flow:

1. Fathom sends a webhook to `https://hooks.metisaiassistant.win/integrations/source/fathom/webhook`
2. Cloudflare Tunnel routes the request to the Ubuntu server
3. OpenClaw gateway receives the request through the meeting workflow plugin
4. The plugin verifies `webhook-signature`
5. The plugin maps the payload to `meeting-event-v1`
6. The plugin executes the meeting workflow runtime directly
7. The workflow generates summary + action items, writes Google Docs output, creates ClickUp tasks, and stores a run report

## Code Location

- Current ingress implementation: `external-plugins/meeting-workflow-ingress/`
- Long-term in-repo plugin implementation target: `extensions/meeting-workflow/`
- Setup templates: `ops/meeting-ingress/`
- Fork implementation guidelines: `FORK_FEATURE_IMPLEMENTATION_GUIDELINES.md`
- Original design doc: `MeetingWorkflowOpenClaw.md`
- Implementation plan: `MeetingWorkflowImplementationPlan.md`
- Migration runbook: `ops/meeting-ingress/MIGRATION_TO_MEETING_WORKFLOW.md`

## Public Endpoint

- Production webhook URL: `https://hooks.metisaiassistant.win/integrations/source/fathom/webhook`
- Public hostname is provided by Cloudflare Tunnel
- OpenClaw gateway stays bound to loopback: `127.0.0.1:18789`

## Cloudflare Tunnel

- Tunnel name: `openclaw-meeting`
- Tunnel forwards `hooks.metisaiassistant.win` to `http://127.0.0.1:18789`
- Service config template: `ops/meeting-ingress/cloudflared.config.example.yml`

Expected runtime config shape:

```yaml
tunnel: openclaw-meeting
credentials-file: /home/valverdesolera/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: hooks.metisaiassistant.win
    service: http://127.0.0.1:18789
  - service: http_status:404
```

## OpenClaw Hook Configuration

Legacy note: hooks and the `meeting-ops` agent were used in the earlier ingress-only setup.
The new `extensions/meeting-workflow/` runtime executes the workflow directly from the webhook route and does not depend on hook dispatch for normal production processing.

Hooks are enabled with:

- `hooks.path = /hooks`
- `hooks.defaultSessionKey = hook:meeting`
- `hooks.allowRequestSessionKey = false`
- `hooks.allowedAgentIds = ["meeting-ops"]`

Hook mapping:

- path: `meeting-source`
- action: `agent`
- agent: `meeting-ops`
- session key: `hook:meeting:{{meetingId}}`

The mapping includes a required `messageTemplate` because OpenClaw agent hook mappings require a non-empty message.
This remains useful for manual/legacy paths, but the current long-term workflow runtime no longer depends on this mapping to perform the real meeting processing.

Current template:

```text
Meeting {{meetingId}} ended: {{title}}
Participants: {{participants}}

Transcript:
{{transcript}}
```

The long-term `meeting-workflow-run` tool should persist run reports and cached workflow results under the plugin state directory so repeated runs for the same unchanged meeting can reuse the previous result.

## Agent Setup

Meeting webhooks are routed to a dedicated agent:

- Agent ID: `meeting-ops`
- Workspace: `~/.openclaw/workspace-meeting-ops`
- Model: `openai/gpt-5.2-mini`

Restricted tools:

- allow: `read`, `write`, `edit`, `apply_patch`, `exec`, `process`
- deny: `browser`, `canvas`, `nodes`, `cron`

This keeps meeting automation isolated from the main interactive agent.

In the new runtime, `meeting-ops` is still useful for manual investigation and tool-driven dry runs, but the webhook path itself now runs the workflow directly.

## Plugin Configuration

Plugin ID:

- `meeting-workflow-ingress`

Important config keys:

- `plugins.entries.meeting-workflow-ingress.enabled = true`
- `plugins.entries.meeting-workflow-ingress.config.enabled = true`
- `plugins.entries.meeting-workflow-ingress.config.routePath = /integrations/source/fathom/webhook`
- `plugins.entries.meeting-workflow-ingress.config.sourceProvider = fathom`
- `plugins.entries.meeting-workflow-ingress.config.source.fathom.apiKey = ${SOURCE_FATHOM_API_KEY}`
- `plugins.entries.meeting-workflow-ingress.config.source.fathom.webhookSecret = ${SOURCE_FATHOM_WEBHOOK_SECRET}`
- `plugins.entries.meeting-workflow-ingress.config.forward.hooksBaseUrl = http://127.0.0.1:18789`
- `plugins.entries.meeting-workflow-ingress.config.forward.hooksPath = /hooks/meeting-source`
- `plugins.entries.meeting-workflow-ingress.config.forward.hooksToken = ${OPENCLAW_HOOKS_TOKEN}`

Long-term multi-account plugin config template:

- `ops/meeting-ingress/meeting-workflow.plugin.example.json5`

This template defines one account profile per Fathom job/email, each with:

- `accountKey`
- `label`
- `email`
- dedicated `routePath`
- Fathom credentials
- Google Docs destination
- ClickUp destination
- per-step summary/action-item model settings

Long-term workflow tools exposed by the new extension:

- `meeting-workflow-analyze` - summary + action-items extraction only
- `meeting-workflow-run` - full workflow execution (summary + action items + Google Docs + ClickUp)

Production webhook handling should use direct workflow execution in the plugin route handler rather than relying on the agent to decide whether to invoke these tools.

## Fathom Configuration

The webhook must be created in Fathom with:

- Destination URL: `https://hooks.metisaiassistant.win/integrations/source/fathom/webhook`
- Scope: `My Recordings`
- Events enabled:
  - `Transcript`
  - `Summary`
  - `Action items`

The webhook secret returned by Fathom must match the secret configured in OpenClaw.

## Validation

Basic reachability check:

```bash
curl -i "https://hooks.metisaiassistant.win/integrations/source/fathom/webhook"
```

Expected result:

- `405 Method Not Allowed`

Signed webhook check:

```bash
payload='{"id":"m-prod-check-001","title":"Webhook Production Check","ended_at":"2026-03-13T18:00:00Z","transcript":"Carlos: checking production webhook path","participants":[{"name":"Carlos"},{"name":"METIS AI Assistant"}]}'
sig=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "<SOURCE_FATHOM_WEBHOOK_SECRET>" -binary | openssl base64)

curl -i -X POST "https://hooks.metisaiassistant.win/integrations/source/fathom/webhook" \
  -H "Content-Type: application/json" \
  -H "webhook-signature: $sig" \
  --data-binary "$payload"
```

Expected result:

- `202 Accepted`

## Operational Notes

- Keep real secrets out of git.
- Keep config templates in `ops/meeting-ingress/` as the source of truth.
- If Fathom signature checks fail, verify the exact webhook secret for the specific Fathom webhook entry.
- If hook dispatch fails, verify `messageTemplate` is present and `meeting-ops` is in `hooks.allowedAgentIds`.
- If public endpoint fails, verify Cloudflare Tunnel service is running and `hooks.metisaiassistant.win` resolves correctly.
