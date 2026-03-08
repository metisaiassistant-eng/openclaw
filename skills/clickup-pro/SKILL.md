---
name: clickup-pro
description: ClickUp project management for tasks, spaces, folders, time tracking, and comments, with optional AI prioritization and standup generation.
homepage: https://developer.clickup.com/docs
license: MIT
compatibility: Python 3.10+, ClickUp API key
metadata:
  {
    "openclaw":
      {
        "emoji": "✅",
        "requires": { "bins": ["python3"], "env": ["CLICKUP_API_KEY"] },
        "primaryEnv": "CLICKUP_API_KEY",
        "homepage": "https://developer.clickup.com/docs",
        "install":
          [
            {
              "id": "python-brew",
              "kind": "brew",
              "formula": "python",
              "bins": ["python3"],
              "label": "Install Python (brew)",
            },
          ],
      },
  }
---

# ClickUp Pro

Security-hardened ClickUp task management for OpenClaw agents.

## Security and data handling

- AI commands (`prioritize`, `standup`) support `--ai-mode off|redacted|full`.
- Default is `--ai-mode full` (best output quality, highest data sharing).
- In `redacted` mode, task names and usernames are minimized before sending data to OpenRouter.
- In `off` mode, no task data is sent to OpenRouter and local fallback output is used.
- `delete-task` is protected and requires `--confirm --confirm-task-id <exact_task_id>`.
- Mutating commands support `--dry-run` to preview requests before execution.
- Upstream API error bodies are not printed to stderr; optional debug log path: `CLICKUP_DEBUG_LOG=/path/to/log`.

## Requirements

| Variable             | Required | Description                                      |
| -------------------- | -------- | ------------------------------------------------ |
| `CLICKUP_API_KEY`    | Yes      | ClickUp personal API token                       |
| `OPENROUTER_API_KEY` | Optional | Required only for AI modes `redacted` and `full` |

## Quick start

```bash
# List workspaces
python3 {baseDir}/scripts/clickup_api.py workspaces

# Create task (preview only)
python3 {baseDir}/scripts/clickup_api.py create-task <list_id> --name "Fix bug" --priority 2 --due "2026-02-20" --dry-run

# Protected delete
python3 {baseDir}/scripts/clickup_api.py delete-task <task_id> --confirm --confirm-task-id <task_id>

# AI prioritization modes
python3 {baseDir}/scripts/clickup_api.py prioritize <list_id> --ai-mode full
python3 {baseDir}/scripts/clickup_api.py prioritize <list_id> --ai-mode redacted
python3 {baseDir}/scripts/clickup_api.py prioritize <list_id> --ai-mode off
```

## Commands

### Navigation

- `workspaces` - List workspaces/teams
- `spaces <team_id>` - List spaces in a workspace
- `folders <space_id>` - List folders in a space
- `lists <folder_id>` - List lists in a folder
- `folderless-lists <space_id>` - List lists directly under a space

### Tasks

- `tasks <list_id>` - List tasks (`--status`, `--assignee`, `--subtasks`)
- `get-task <task_id>` - Get task details
- `create-task <list_id>` - Create task (`--name`, `--description`, `--priority`, `--due`, `--assignee`, `--dry-run`)
- `update-task <task_id>` - Update task (`--name`, `--status`, `--priority`, `--due`, `--assignee`, `--dry-run`)
- `delete-task <task_id>` - Delete task (requires `--confirm --confirm-task-id`, supports `--dry-run`)

### Time tracking

- `start-timer <task_id>` - Start timer (`--dry-run`)
- `stop-timer <team_id>` - Stop running timer (`--dry-run`)
- `log-time <task_id>` - Log time (`--duration`, `--description`, `--dry-run`)

### Comments

- `comment <task_id>` - Add comment (`--text`, `--dry-run`)

### AI features

- `prioritize <list_id>` - Task prioritization (`--ai-mode off|redacted|full`, default `full`)
- `standup <list_id>` - Standup summary (`--ai-mode off|redacted|full`, default `full`)
