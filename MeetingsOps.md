# Meetings Ops

This document describes the current production setup for the meeting workflow feature in this fork.

## Overview

The feature uses the `meeting-workflow` plugin under `extensions/meeting-workflow/`.

Runtime flow:

1. Fathom sends a webhook to an account-specific public route.
2. Cloudflare Tunnel routes the request to the Ubuntu server.
3. OpenClaw gateway receives the request through the `meeting-workflow` plugin.
4. The plugin verifies the `webhook-signature`.
5. The plugin normalizes the payload into `meeting-event-v1`.
6. The plugin runs the meeting workflow directly.
7. The workflow:
   - generates a summary,
   - extracts action items,
   - writes Google Docs output,
   - writes ClickUp tasks,
   - persists a cached result and run report.

## Code Location

- Production plugin: `extensions/meeting-workflow/`
- Setup templates: `ops/meeting-ingress/`
- Fork implementation guidelines: `FORK_FEATURE_IMPLEMENTATION_GUIDELINES.md`
- Original design doc: `MeetingWorkflowOpenClaw.md`
- Implementation plan: `MeetingWorkflowImplementationPlan.md`
- Migration runbook: `ops/meeting-ingress/MIGRATION_TO_MEETING_WORKFLOW.md`

## Public Endpoints

- `https://hooks.metisaiassistant.win/integrations/source/fathom/cirruslabs-deloitte/webhook`
- `https://hooks.metisaiassistant.win/integrations/source/fathom/prediktive-accela/webhook`
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

## OpenClaw Runtime State

The current production setup no longer depends on hook mappings or a dedicated `meeting-ops` agent for webhook execution.

Normal chat traffic stays on the default/main agent.

The production gateway is managed by the OpenClaw-installed **user systemd service**:

- `systemctl --user status openclaw-gateway.service`
- `systemctl --user restart openclaw-gateway.service`
- `journalctl --user -u openclaw-gateway.service -n 200 --no-pager`

The old custom system service and the old `meeting-workflow-ingress` plugin config were removed because they caused duplicate supervision/confusing startup behavior.

The meeting workflow persists runtime artifacts under the OpenClaw state directory, including:

- cached workflow results
- run reports

Example paths:

- `~/.openclaw/meeting-workflow/results/cirruslabs-deloitte/*.json`
- `~/.openclaw/meeting-workflow/results/prediktive-accela/*.json`
- `~/.openclaw/meeting-workflow/reports/*.json`

Google Docs hierarchy is now:

```text
<root>/<Account>/Meeting Transcripts/YYYY/YYYY-MM/YYYY-MM-DD/
```

The `Meeting Transcripts` segment is configurable through `documents.googleDocs.transcriptsFolderName` and defaults to `Meeting Transcripts`.

## Account Profiles

The workflow is partitioned by account profile, not by free-form email inference.

Current account keys:

- `cirruslabs-deloitte`
- `prediktive-accela`

Each account profile contains:

- dedicated webhook route
- Fathom API key
- Fathom webhook secret
- Google Docs destination config
- ClickUp destination config
- per-step LLM model config

Current account labels:

- `cirruslabs-deloitte` -> `CirrusLabs / Deloitte`
- `prediktive-accela` -> `Prediktive / Accela`

## Plugin Configuration

Plugin ID:

- `meeting-workflow`

Primary config template:

- `ops/meeting-ingress/meeting-workflow.plugin.example.json5`

This template defines one account profile per Fathom job/email, each with:

- `accountKey`
- `label`
- `email`
- dedicated `routePath`
- Fathom credentials
- Google Docs destination + auth config
- ClickUp destination + API key + assignee ids
- per-step summary/action-item model settings

Workflow tools exposed by the extension:

- `meeting-workflow-analyze` - summary + action-items extraction only
- `meeting-workflow-run` - full workflow execution (summary + action items + Google Docs + ClickUp)

Production webhook handling uses direct workflow execution in the plugin route handler rather than relying on the agent to decide whether to invoke these tools.

## Fathom Configuration

For each Fathom account, create a webhook with:

- account-specific Destination URL
- Scope: `My Recordings`
- Events enabled:
  - `Transcript`

The webhook secret returned by Fathom must match the secret configured in OpenClaw.

Current production scope:

- `Transcript` is required.
- `Summary` and `Action items` from Fathom are optional because OpenClaw generates its own summary and action items.

## Validation

Basic reachability checks:

```bash
curl -i "https://hooks.metisaiassistant.win/integrations/source/fathom/cirruslabs-deloitte/webhook"
curl -i "https://hooks.metisaiassistant.win/integrations/source/fathom/prediktive-accela/webhook"
```

Expected result:

- `405 Method Not Allowed`

Signed webhook check example:

```bash
payload='{"id":"cirruslabs-deloitte-check-009","title":"CirrusLabs Deloitte Check","ended_at":"2026-03-16T01:20:00Z","transcript":"Carlos: final verification after route recovery","participants":[{"name":"Carlos"}]}'
sig=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "<SOURCE_FATHOM_CIRRUSLABS_DELOITTE_WEBHOOK_SECRET>" -binary | openssl base64)

curl -i -X POST "https://hooks.metisaiassistant.win/integrations/source/fathom/cirruslabs-deloitte/webhook" \
  -H "Content-Type: application/json" \
  -H "webhook-signature: $sig" \
  --data-binary "$payload"
```

Expected result:

- `202 Accepted`

Validated live:

- `cirruslabs-deloitte` -> summary generated, Google Doc created, ClickUp parent + subtask created
- `prediktive-accela` -> validated separately in production

## Operational Notes

- Keep real secrets out of git.
- Keep config templates in `ops/meeting-ingress/` as the source of truth.
- If Fathom signature checks fail, verify the exact webhook secret for the specific Fathom webhook entry.
- If public endpoint fails, verify Cloudflare Tunnel service is running and `hooks.metisaiassistant.win` resolves correctly.

Refresh-token support is now implemented in the plugin. Preferred Google Docs auth config is:

- `accessToken` for immediate use
- `refreshToken`
- `clientId`
- `clientSecret`

When refresh credentials are present, the plugin can mint a fresh access token automatically after expiry or after a 401 response from Google APIs.

Google Docs folder partitioning is timezone-aware. Set `documents.googleDocs.timeZone` per account so meeting documents are grouped by the intended local calendar day rather than raw UTC.
