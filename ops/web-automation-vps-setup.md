# Web Automation VPS Setup

This runbook keeps browser automation changes versioned in the fork while keeping credentials and live runtime state only on the VPS.

## Branch Strategy

- Long-lived branch: `my-main`
- Feature branches: branch from `my-main`, merge back into `my-main` when stable
- Do not treat feature branches as the canonical server branch

## Canonical VPS Layout

- Clean deploy checkout: `~/openclaw-my-main`
- Runtime config: `~/.openclaw/openclaw.json`
- Per-agent workspaces: `~/.openclaw/workspaces/<agent>`
- Managed skills: `~/.openclaw/skills/<skill>`
- User service: `~/.config/systemd/user/openclaw-gateway.service`
- CLI wrapper: `/usr/local/bin/openclaw`

Keep credentials, browser auth vault state, generated screenshots, and runtime workspaces out of the repo checkout.

## Dedicated Agent Workspaces

If an isolated cron job runs browser automation on the default `main` agent and times out inside the model call, move it to a dedicated agent with a minimal runtime workspace.

Why this is the fix:

- `cron run` only queues work; finished history appears later.
- `lightContext` only trims bootstrap-file injection.
- Isolated cron runs still load the target agent workspace skill snapshot.
- Large workspaces can push browser automations over the model timeout budget.

Recommended pattern:

```bash
mkdir -p "$HOME/.openclaw/workspaces/<site-agent>"
openclaw agents add <site-agent> --workspace "$HOME/.openclaw/workspaces/<site-agent>"
openclaw config set agents.list[<index>].skills '["agent-browser","<site-skill>"]' --strict-json
openclaw config validate
```

Then create the cron job with:

- `--agent <site-agent>`
- `--thinking off`
- `--timeout-seconds 600`

## VPS One-Time Setup

1. Install `agent-browser` on the VPS and confirm it is on `PATH`.
2. Create the auth-vault profile for the site.

```bash
echo "$SITE_PASSWORD" | agent-browser auth save <site-profile-name> --url <https://example.com/login> --username "$SITE_USERNAME" --password-stdin
agent-browser auth show <site-profile-name>
```

3. If the website needs custom selectors for the login form, re-save the profile with selector overrides.
4. Restart OpenClaw or start a fresh session so the new skills or workspace changes are visible.

## Gateway Exec Approval

Scheduled isolated agent runs may need exec approval to launch local binaries. If a cron job stays marked as running without producing a run-log entry, allowlist `agent-browser` on the gateway host:

```bash
openclaw approvals allowlist add --gateway --agent "*" "$(command -v agent-browser)"
openclaw approvals get --gateway
```

## Manual Test Flow

Run the automation manually before scheduling it:

```bash
export AGENT_BROWSER_ALLOWED_DOMAINS="<example.com,*.example.com>"
export AGENT_BROWSER_ACTION_POLICY="automation/policies/<site-name>.json"
agent-browser open <https://example.com/app>
agent-browser wait --load networkidle
agent-browser auth login <site-profile-name>
```

Then verify the site-specific task step by step.

## VPS Deploy Flow

Update and deploy only from `my-main`:

```bash
cd "$HOME/openclaw-my-main"
git fetch origin
git switch my-main
git pull --ff-only origin my-main
corepack pnpm install
corepack pnpm build
systemctl --user restart openclaw-gateway.service
systemctl --user status openclaw-gateway.service --no-pager
ss -ltnp | grep 18789
openclaw channels status --probe
```

## Important Notes

- Do not commit credentials, cookies, or session state.
- Prefer `agent-browser auth login <profile>` over manual password filling.
- Treat repo paths as templates or source, not as the live runtime home for agent workspaces.
- If the live checkout is dirty, rescue the runtime state into `~/.openclaw/...` and deploy from a fresh clean clone instead of forcing an in-place merge.
