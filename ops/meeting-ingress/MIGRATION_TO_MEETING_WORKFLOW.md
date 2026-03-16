# Migration To `meeting-workflow`

This runbook migrates the server from the current ingress-only plugin:

- `external-plugins/meeting-workflow-ingress/`

to the new integrated plugin:

- `extensions/meeting-workflow/`

## Goal

Move to a single plugin that supports:

- multi-account Fathom ingress
- per-account Google Docs destinations
- per-account ClickUp destinations
- per-step LLM model selection
- cached workflow results and run reports

## Pre-checks

1. Pull the latest branch containing `extensions/meeting-workflow/`.
2. Confirm the old ingress path is still working before migration.
3. Prepare all real secrets and destination IDs for each account.

## 1) Install the new plugin

```bash
openclaw plugins install -l /opt/openclaw/extensions/meeting-workflow
openclaw plugins enable meeting-workflow
```

## 2) Configure the new plugin

Use `ops/meeting-ingress/meeting-workflow.plugin.example.json5` as the template.

Important values to set per account:

- `accountKey`
- `label`
- `email`
- `routePath`
- `fathom.apiKey`
- `fathom.webhookSecret`
- `documents.googleDocs.rootFolderId`
- `documents.googleDocs.accessToken`
- `documents.googleDocs.refreshToken`
- `documents.googleDocs.clientId`
- `documents.googleDocs.clientSecret`
- `tasks.clickup.listId`
- `tasks.clickup.apiKey`
- `tasks.clickup.assigneeIds[]`
- `models.summary`
- `models.actionItems`

Current production account keys:

- `cirruslabs-deloitte`
- `prediktive-accela`

## 3) Direct runtime execution

The new plugin executes the meeting workflow directly from the webhook route.

No hook mapping or `meeting-ops` agent is required for normal production execution.

`meeting-ops` can still be kept temporarily for manual investigation and dry runs, but it is not required for the webhook path.

## 4) Create per-account Fathom webhooks

For each account, create a webhook using that account's dedicated route path.

Example:

- `https://hooks.metisaiassistant.win/integrations/source/fathom/cirruslabs-deloitte/webhook`
- `https://hooks.metisaiassistant.win/integrations/source/fathom/prediktive-accela/webhook`

Enable:

- Transcript

## 5) Disable the old plugin after verification

Once the new plugin is confirmed working:

```bash
openclaw config set plugins.entries.meeting-workflow-ingress.enabled false
```

## 6) Restart gateway

Production uses the OpenClaw-installed **user systemd service**.

```bash
systemctl --user restart openclaw-gateway.service
systemctl --user status openclaw-gateway.service --no-pager
ss -ltnp | grep 18789
journalctl --user -u openclaw-gateway.service -n 120 --no-pager
```

## 7) Verify each new route

Method check:

```bash
curl -i "https://hooks.metisaiassistant.win/integrations/source/fathom/cirruslabs-deloitte/webhook"
curl -i "https://hooks.metisaiassistant.win/integrations/source/fathom/prediktive-accela/webhook"
```

Expected: `405 Method Not Allowed`

## 8) Validate signed delivery per account

For each account, sign with that account's webhook secret and expect `202 Accepted`.

## 9) Confirm workflow output

Check:

- Google Docs document created/updated in the correct account partition
- ClickUp tasks created in the correct account list
- cached reruns do not duplicate output

## Rollback

If needed:

```bash
openclaw config set plugins.entries.meeting-workflow.enabled false
openclaw config set plugins.entries.meeting-workflow-ingress.enabled true
systemctl --user restart openclaw-gateway.service
```
