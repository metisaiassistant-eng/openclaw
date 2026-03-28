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

This personal override keeps ClickUp routing rules local to this OpenClaw host and enforces Carlos's task-capture defaults.

## Task capture defaults

For every ClickUp task request, apply these defaults before writing anything:

1. Proactively gather or confirm the assignee, start date, due date, and priority.
2. Interpret all unspecified dates and times in Costa Rica time (`America/Costa_Rica`, GMT-6) unless the user explicitly says otherwise.
3. If any required fields are missing, ask one concise follow-up question that bundles every missing field together.
4. If the task is job-related, include the `employment` tag.
5. If the task is a meeting, also schedule the Google Calendar event.
6. For meeting scheduling, collect or confirm the start time, end time, and meeting link when they are needed and not already known.
7. When a meeting link is available, include it in the Google Calendar event description and in the ClickUp task description or follow-up comment.
8. Use the primary Google Calendar unless the user specifies another calendar.

## Meeting workflow

- Treat meeting tasks as dual writes: ClickUp task plus Google Calendar event.
- Use `gog calendar create primary --summary "..." --from <iso> --to <iso>` for the calendar event.
- Use Costa Rica offsets in ISO timestamps (for example `2026-03-28T09:00:00-06:00`) unless the user gave another timezone.
- If the meeting task is otherwise ready but the link is not available yet, create the task and event first, then add the link later when it becomes available.

## Routing rules

Before any action that needs a ClickUp list ID, classify the request and route it using the exact mapping below.

- These mappings are for the ClickUp workspace named `OG's`.
- The path format is `Space > Folder > List`.
- The `ID` shown for each entry is the ClickUp **list ID**, not the workspace ID, space ID, or folder ID.
- Because this account has access to more than one ClickUp workspace, first confirm the task belongs in the `OG's` workspace before using any mapping below.

- `Personal > Professional > Professional - METIS` | list ID: `900400309219`
  - Use for personal professional tasks that are not specific to a particular job or employer.
- `Personal > Misc Personal > Misc Personal - METIS` | list ID: `164365508`
  - Use for miscellaneous personal-life tasks.
  - This is the default fallback only for personal tasks when no better personal list applies.
- `CirrusLabs > CirrusLabs > Administrative - METIS` | list ID: `901711775568`
  - Use for CirrusLabs-specific administrative tasks.
- `CirrusLabs > Deloitte > Administrative - METIS` | list ID: `901712191542`
  - Use for Deloitte administrative tasks.
- `CirrusLabs > Deloitte > Work - METIS` | list ID: `901711775623`
  - Use for Deloitte work tasks such as coding, project work, implementations, and studying or learning about Deloitte projects.
- `Prediktive > Prediktive > Administrative - METIS` | list ID: `901712050841`
  - Use for Prediktive-specific administrative tasks.
- `Prediktive > Accela > Administrative - METIS` | list ID: `901711983152`
  - Use for Accela administrative tasks.
- `Prediktive > Accela > Work - METIS` | list ID: `901712191600`
  - Use for Accela work tasks such as coding, project work, implementations, and studying or learning about Accela projects.

## Classification policy

1. Decide whether the request is personal or work-related.
2. Confirm the request belongs in the `OG's` workspace, since the account has access to multiple ClickUp workspaces.
3. For work-related tasks, identify the employer and project context before selecting a list.
4. Prefer the more specific work list when the request clearly mentions coding, implementation, project work, study, or learning for Deloitte or Accela.
5. Use the administrative list when the request is clearly operational or administrative.
6. For personal tasks, prefer the specific personal-professional list when the task is career-oriented but not job-specific.
7. If no suitable personal list exists, use `Personal > Misc Personal > Misc Personal - METIS`.
8. If the task could fit multiple non-personal lists, the workspace is not clearly `OG's`, or the destination is otherwise unclear, do not guess. Ask the user where to include it.

## Execution rules

- Once the destination is determined, use the raw ClickUp list ID from the routing table in the command you run.
- Do not ask the user to remember or provide list IDs when the routing rules already determine the correct destination.
- If the request conflicts with the routing table or lacks enough context, ask exactly one clarification question about the destination list.
- When the task metadata is incomplete, prefer one compact clarification that covers assignee, start date, due date, priority, and any meeting-only details in a single question.

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
python3 {baseDir}/scripts/clickup_api.py create-task <list_id> --name "Fix bug" --priority 2 --start "2026-02-18" --due "2026-02-20" --tag employment --dry-run

# Create a matching calendar event for a meeting task
gog calendar create primary --summary "Project kickoff" --from "2026-02-18T09:00:00-06:00" --to "2026-02-18T10:00:00-06:00"

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
- `create-task <list_id>` - Create task (`--name`, `--description`, `--priority`, `--start`, `--due`, `--assignee`, `--tag`, `--dry-run`)
- `update-task <task_id>` - Update task (`--name`, `--status`, `--priority`, `--start`, `--due`, `--assignee`, `--tag`, `--dry-run`)
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
