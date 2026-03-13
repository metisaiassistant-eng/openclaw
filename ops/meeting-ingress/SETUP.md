# Meeting Ingress Production Setup

This runbook captures the production setup used for the external meeting ingress plugin.

## Scope

- Public endpoint: `https://hooks.metisaiassistant.win/integrations/source/fathom/webhook`
- OpenClaw gateway bind: `127.0.0.1:18789`
- Tunnel provider: Cloudflare Tunnel (named tunnel)
- Source provider: Fathom

## Prerequisites

1. OpenClaw repo checked out on server at `/opt/openclaw`.
2. Plugin code present at `external-plugins/meeting-workflow-ingress/`.
3. Domain delegated to Cloudflare and Active (`metisaiassistant.win`).
4. Installed binaries:
   - `openclaw`
   - `cloudflared`

## 1) Install and enable plugin

Run on server:

```bash
openclaw plugins install -l /opt/openclaw/external-plugins/meeting-workflow-ingress
openclaw plugins enable meeting-workflow-ingress
```

## 2) Configure hooks and plugin (use real secrets)

```bash
openclaw config set hooks.enabled true
openclaw config set hooks.path /hooks
openclaw config set hooks.token "<OPENCLAW_HOOKS_TOKEN>"
openclaw config set hooks.defaultSessionKey hook:meeting
openclaw config set hooks.allowRequestSessionKey false
openclaw config set hooks.allowedAgentIds '["meeting-ops"]'
openclaw config set hooks.mappings '[{"match":{"path":"meeting-source"},"action":"agent","agentId":"meeting-ops","name":"Meeting Source Event","wakeMode":"now","sessionKey":"hook:meeting:{{meetingId}}","deliver":false,"thinking":"low","messageTemplate":"Meeting {{meetingId}} ended: {{title}}\\nParticipants: {{participants}}\\n\\nTranscript:\\n{{transcript}}"}]'

python3 - <<'PY'
import json
from pathlib import Path

cfg_path = Path.home() / ".openclaw" / "openclaw.json"
cfg = json.loads(cfg_path.read_text())
agents = cfg.setdefault("agents", {})
agent_list = agents.setdefault("list", [])

if not any(agent.get("id") == "meeting-ops" for agent in agent_list):
    agent_list.append({
        "id": "meeting-ops",
        "workspace": "~/.openclaw/workspace-meeting-ops",
        "model": "openai/gpt-5.2-mini",
        "tools": {
            "allow": ["read", "write", "edit", "apply_patch", "exec", "process"],
            "deny": ["browser", "canvas", "nodes", "cron"],
        },
    })

cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")
print("Ensured meeting-ops agent in", cfg_path)
PY

openclaw config set plugins.entries.meeting-workflow-ingress.enabled true
openclaw config set plugins.entries.meeting-workflow-ingress.config.enabled true
openclaw config set plugins.entries.meeting-workflow-ingress.config.routePath /integrations/source/fathom/webhook
openclaw config set plugins.entries.meeting-workflow-ingress.config.sourceProvider fathom
openclaw config set plugins.entries.meeting-workflow-ingress.config.source.fathom.apiKey "<SOURCE_FATHOM_API_KEY>"
openclaw config set plugins.entries.meeting-workflow-ingress.config.source.fathom.webhookSecret "<SOURCE_FATHOM_WEBHOOK_SECRET>"
openclaw config set plugins.entries.meeting-workflow-ingress.config.source.fathom.baseUrl https://api.fathom.ai/external/v1
openclaw config set plugins.entries.meeting-workflow-ingress.config.forward.hooksBaseUrl http://127.0.0.1:18789
openclaw config set plugins.entries.meeting-workflow-ingress.config.forward.hooksPath /hooks/meeting-source
openclaw config set plugins.entries.meeting-workflow-ingress.config.forward.hooksToken "<OPENCLAW_HOOKS_TOKEN>"
openclaw config set plugins.entries.meeting-workflow-ingress.config.forward.timeoutMs 10000
```

## 3) Configure Cloudflare Tunnel

Authenticate and create tunnel (run once):

```bash
cloudflared tunnel login
cloudflared tunnel create openclaw-meeting
cloudflared tunnel route dns openclaw-meeting hooks.metisaiassistant.win
```

Create `/etc/cloudflared/config.yml` from `ops/meeting-ingress/cloudflared.config.example.yml` and replace `<TUNNEL_ID>`.

Install service and start:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

## 4) Run OpenClaw gateway

```bash
pkill -f "openclaw gateway run" || true
nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &
sleep 2
ss -ltnp | grep 18789
```

## 5) Validation checklist

From local machine:

```bash
curl -i "https://hooks.metisaiassistant.win/integrations/source/fathom/webhook"
```

Expected: `HTTP/2 405` with `{"ok":false,"error":"method not allowed"}`.

Signed POST check (replace secret):

```bash
payload='{"id":"m-prod-check-001","title":"Webhook Production Check","ended_at":"2026-03-13T18:00:00Z","transcript":"Carlos: checking production webhook path","participants":[{"name":"Carlos"},{"name":"METIS AI Assistant"}]}'
sig=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "<SOURCE_FATHOM_WEBHOOK_SECRET>" -binary | openssl base64)

curl -i -X POST "https://hooks.metisaiassistant.win/integrations/source/fathom/webhook" \
  -H "Content-Type: application/json" \
  -H "webhook-signature: $sig" \
  --data-binary "$payload"
```

Expected: `HTTP/2 202` and body including `"ok":true`.

## 6) Operational notes

- Never commit live secrets.
- Rotate exposed tokens/secrets immediately if they were ever pasted in chat/logs.
- Keep the hook mapping `messageTemplate`; agent mappings require non-empty message text.
- Keep meeting ingest mapped to `meeting-ops` to isolate automation runs from the primary `main` agent.
