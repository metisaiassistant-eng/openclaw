# SIAP Fundacion UCR Runbook

## Purpose

Run the weekly SIAP automation against `siap.fundacionucr.org`.

## Why A Dedicated Agent Is Required

The cron docs are accurate: `cron run` only queues the work, and `cron runs` only shows entries after the job reaches `finished`.

Timed-out SIAP runs usually happen because the job is still running on the default `main` agent, which loads a larger workspace than the task needs. In code, `lightContext` only changes bootstrap-file injection, but isolated cron runs still build the workspace skill snapshot for the target agent.

Definite fix: run SIAP on a dedicated `siap` agent with a minimal runtime workspace and an explicit skills filter.

## Dedicated Agent Setup

Create the dedicated agent once on the VPS:

```bash
mkdir -p "$HOME/.openclaw/workspaces/siap"
openclaw agents add siap --workspace "$HOME/.openclaw/workspaces/siap"
openclaw config set agents.list[1].skills '["agent-browser","web-automation-common","siap-fundacionucr"]' --strict-json
openclaw config validate
openclaw agents list
```

The `skills` filter is essential. Without `agents.list[].skills`, the `siap` agent still receives the full bundled skills list, which can push the run over the model timeout budget.

## Auth Vault Setup On VPS

Create the saved login profile on the VPS:

```bash
echo "$SIAP_PASSWORD" | agent-browser auth save test-profile --url https://siap.fundacionucr.org/index.php?module=auth&view=login --username "$SIAP_USERNAME" --password-stdin
agent-browser auth show test-profile
```

If the login form needs custom selectors, re-save the profile with selector overrides after inspecting the page.

## Gateway Exec Approval

If isolated cron runs stay stuck in `runningAtMs` with no entry in `~/.openclaw/cron/runs/<job-id>.jsonl`, the gateway is usually waiting for exec approval before it can launch `agent-browser`.

Allow the binary on the gateway host:

```bash
openclaw approvals allowlist add --gateway --agent "*" "$(command -v agent-browser)"
openclaw approvals get --gateway
```

## Manual Test

```bash
export AGENT_BROWSER_ALLOWED_DOMAINS="siap.fundacionucr.org"
export AGENT_BROWSER_ACTION_POLICY="automation/policies/siap-fundacionucr.json"
agent-browser open https://siap.fundacionucr.org/
agent-browser wait --load networkidle
agent-browser auth login test-profile
agent-browser open https://siap.fundacionucr.org/
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Then complete the skill steps manually once to confirm the popup labels and final URL still match.

Confirmed navigation note from manual validation:

- The correct target is not the first visible `Mis Pendientes` link.
- The correct link is in `Administracion de Proyectos` -> `Operacion Presupuestaria` -> `Mis Pendientes`.
- That link resolves to `index.php?module=analisis&view=enPendiente&tipo=1&operacion=25&p=1&ch=0&cx=5`.
- After project selection, the page rerenders and the agent should take a fresh snapshot before clicking the final `Mis Pendientes` link.

## Suggested Cron Prompt

Use the `siap-fundacionucr` skill. Open `https://siap.fundacionucr.org/`. If login is needed, use `agent-browser auth login test-profile`. In the `Seleccion de Proyecto` popup, select project `9523-85` in `Codigo de Proyecto`. Under `Administracion de Proyectos`, find the `Operacion Presupuestaria` row and open its `Mis Pendientes` link. Verify the final URL is `https://siap.fundacionucr.org/index.php?module=analisis&view=enPendiente&tipo=1&operacion=25&p=1&ch=0&cx=5`. Save a screenshot and report the filename. Never click actions related to delete, submit, or remove.

## Suggested Cron Command

```bash
openclaw cron add \
  --name "SIAP Friday check" \
  --cron "0 9 * * 5" \
  --agent siap \
  --session isolated \
  --thinking off \
  --timeout-seconds 600 \
  --message "Use agent-browser on https://siap.fundacionucr.org/. If login is required, use auth profile test-profile. In the Seleccion de Proyecto popup, select 9523-85 in Codigo de Proyecto. After the project is selected, take a fresh snapshot because the page rerenders and refs change. Under Administracion de Proyectos, find the Operacion Presupuestaria row and click its Mis Pendientes link. Verify the final URL is https://siap.fundacionucr.org/index.php?module=analisis&view=enPendiente&tipo=1&operacion=25&p=1&ch=0&cx=5. Save a screenshot as siap-mis-pendientes.png. Never click delete, submit, or remove. Report whether login was needed, whether the URL matched, and whether the screenshot was saved." \
  --light-context \
  --no-deliver
```

## Suggested Test Rollout

1. Manual run from the VPS shell.
2. Forced OpenClaw cron run.
3. One-shot cron test a few minutes in the future.
4. Real Friday schedule after repeated success.

## Debug Breadcrumbs

Useful commands after a failed run:

```bash
cat ~/.openclaw/cron/debug/<job-id>.jsonl
tail -n 40 ~/.openclaw/cron/debug/<job-id>.jsonl
```

Look for the last completed step, for example:

- `isolated-run-start`
- `prompt-start`
- `attempt-start`
- `attempt-success`
- `attempt-error`
- `isolated-run-error`
- `isolated-run-aborted`
