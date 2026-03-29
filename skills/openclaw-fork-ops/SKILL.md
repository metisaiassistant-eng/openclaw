---
name: openclaw-fork-ops
description: Maintain this fork's canonical `my-main` branch and its clean Linux deployment checkout. Use when syncing from upstream, creating feature branches, logging into the VPS, deploying to the server, verifying the live gateway, or cleaning server-local state out of the repo checkout. Ignore older `/opt/openclaw` instructions for this fork unless the user explicitly says the server was rebuilt that way.
metadata: { "openclaw": { "requires": { "bins": ["git", "ssh"] } } }
---

# OpenClaw Fork Ops

Use this skill for branch hygiene, server login, deployment, cutovers, and cleanup on this fork.

## Canonical Structure

- Source-of-truth integration and deployment branch: `my-main`
- Feature branches: branch from `my-main`, merge back into `my-main`, then deploy `my-main`
- Live Linux checkout: `~/openclaw-my-main`
- Live config: `~/.openclaw/openclaw.json`
- Live agent workspaces: `~/.openclaw/workspaces/<agent>`
- Live managed skills: `~/.openclaw/skills/<skill>`
- Live systemd unit: `~/.config/systemd/user/openclaw-gateway.service`
- Live CLI wrapper: `/usr/local/bin/openclaw`
- Current rescued runtime examples: `~/.openclaw/workspaces/siap` and `~/.openclaw/skills/metis-memory`
- Historical/stale path for this fork: `/opt/openclaw`

If an older runbook still assumes `/opt/openclaw`, translate it to the structure above before acting.

## Hard Rules

1. Never deploy a feature branch as the canonical live branch.
2. Never resolve upstream merge conflicts directly in the live server checkout.
3. Never keep server-local state inside the live repo checkout.
4. Never `git pull` or `git switch` inside a dirty live checkout.
5. Keep the systemd unit and `/usr/local/bin/openclaw` wrapper pointed at the same checkout.
6. Before deleting or replacing a checkout, rescue any live workspace or local-only skill into `~/.openclaw/...`.
7. Prefer SSH key auth. If the user explicitly gives a password, use it only for the current task and do not write it to disk, config, or shell startup files.

## Structural Learnings

- Repo files are versioned source and templates. Runtime state belongs under `~/.openclaw`.
- `automation/workspaces/*` can store versioned workspace source, but the live server agent should use `~/.openclaw/workspaces/<agent>`.
- Repo `skills/*` can be source material, but machine-specific or rescued live skills should live in `~/.openclaw/skills/<skill>`.
- A clean deployment checkout should be disposable and rebuildable. If it becomes dirty, create a fresh clone rather than forcing risky in-place merges.
- The deploy checkout, systemd unit, and CLI wrapper form one bundle. If one points to a new checkout, all three should be verified together.

## Local Fork Workflow

### Sync upstream into `my-main`

```bash
git fetch upstream
git switch my-main
git pull --ff-only origin my-main
git merge upstream/main
# resolve conflicts locally, run validation, then:
git push origin my-main
```

Use merge for the shared `my-main` branch unless the user explicitly asks for a rebase/force-push workflow.

### Start a new feature branch

```bash
git switch my-main
git pull --ff-only origin my-main
git switch -c feature/<topic>
```

### Land a feature branch back into `my-main`

```bash
git switch my-main
git pull --ff-only origin my-main
git merge --no-ff feature/<topic>
git push origin my-main
```

## Server Login

- Ask for the exact SSH target if it is not already known.
- Test auth with a harmless command first.

```bash
ssh <user>@<host> hostname
```

- If the user mentions a jump host, password auth, or a specific login path, use it verbatim. Do not rewrite SSH config or assume host aliases.

## Canonical Deploy Flow

```bash
ssh <user>@<host>
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

## Dirty Checkout Recovery

If the live checkout is dirty:

1. Inspect `git status --short --branch` and classify which files are live runtime state versus disposable scratch output.
2. Move or copy live agent workspaces to `~/.openclaw/workspaces/<agent>`.
3. Move or copy local-only skills to `~/.openclaw/skills/<skill>`.
4. Back up `~/.openclaw/openclaw.json` and `~/.config/systemd/user/openclaw-gateway.service` before repointing anything.
5. Deploy from a fresh clean clone instead of forcing the dirty checkout to switch branches.

## Clean Cutover Pattern

```bash
ssh <user>@<host>
git clone --branch my-main --single-branch <fork-url> "$HOME/openclaw-my-main"
cd "$HOME/openclaw-my-main"
corepack pnpm install
corepack pnpm build
# update ~/.openclaw/openclaw.json paths if needed
# update ~/.config/systemd/user/openclaw-gateway.service and /usr/local/bin/openclaw
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
```

## Verification Checklist

- `systemctl --user show openclaw-gateway.service -p ExecStart -p Environment --no-pager`
- `ss -ltnp | grep 18789`
- `openclaw --help`
- `openclaw channels status --probe`
- `openclaw config get agents.defaults.userTimezone`
- confirm `~/.openclaw/openclaw.json` no longer points at stale checkout paths

## Cleanup Rules

- Delete old deployment folders only after the new checkout, wrapper, and service are verified.
- Before deleting an old checkout, confirm:
  - `~/.openclaw/openclaw.json` does not point there
  - `~/.config/systemd/user/openclaw-gateway.service` does not point there
  - `/usr/local/bin/openclaw` does not point there
  - any live workspace or local-only skill has already been copied out
- Cache-only references such as shell history or pnpm store metadata are cosmetic. Clean them only if the user asks for full cleanup.
