# Meeting Workflow Ingress Plugin

External plugin for OpenClaw that:

1. Receives Fathom webhooks.
2. Verifies `webhook-signature`.
3. Normalizes payload to `meeting-event-v1`.
4. Forwards normalized payload to OpenClaw hooks endpoint (`/hooks/meeting-source` by default).

This design keeps core OpenClaw untouched, which minimizes upstream merge conflicts in a fork.

## Install (linked local path)

From the machine where OpenClaw gateway runs:

```bash
openclaw plugins install -l /path/to/openclaw/external-plugins/meeting-workflow-ingress
openclaw plugins enable meeting-workflow-ingress
```

Then restart the gateway.

## Minimal config

```json5
{
  plugins: {
    entries: {
      "meeting-workflow-ingress": {
        enabled: true,
        config: {
          enabled: true,
          routePath: "/integrations/source/fathom/webhook",
          sourceProvider: "fathom",
          source: {
            fathom: {
              apiKey: "${SOURCE_FATHOM_API_KEY}",
              webhookSecret: "${SOURCE_FATHOM_WEBHOOK_SECRET}",
              baseUrl: "https://api.fathom.ai/external/v1",
            },
          },
          forward: {
            hooksBaseUrl: "http://127.0.0.1:18789",
            hooksPath: "/hooks/meeting-source",
            hooksToken: "${OPENCLAW_HOOKS_TOKEN}",
            timeoutMs: 10000,
          },
        },
      },
    },
  },
}
```

## Notes

- Keep `hooks.allowRequestSessionKey` disabled; this plugin forwards only normalized payload.
- Session idempotency should be configured in your hooks mapping with `hook:meeting:{{meetingId}}`.
- If webhook payload is incomplete and includes a meeting identifier, the plugin attempts API fallback via `GET /meetings`.
