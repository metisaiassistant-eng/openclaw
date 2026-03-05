#!/usr/bin/env python3
"""Security-hardened ClickUp CLI for OpenClaw skills."""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import ssl
import sys
import time
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


BASE_URL = "https://api.clickup.com/api/v2"
LLM_URL = "https://openrouter.ai/api/v1/chat/completions"
ALLOWED_HOSTS = {"api.clickup.com", "openrouter.ai"}

SSL_CONTEXT = ssl.create_default_context()

REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_STATUS_CODES = {429, 500, 502, 503, 504}
MAX_DEBUG_LOG_BYTES = 5000

MAX_NAME_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 10_000
MAX_COMMENT_LENGTH = 5_000
MAX_STATUS_LENGTH = 120
MAX_IDENTIFIER_LENGTH = 128

LLM_MIN_INTERVAL_SECONDS = 1.0
LAST_LLM_REQUEST_TS = 0.0

IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class ClickupSkillError(Exception):
    """Base class for expected command errors."""


class ConfigError(ClickupSkillError):
    """Raised for missing configuration."""


class ValidationError(ClickupSkillError):
    """Raised for invalid user input."""


class ApiError(ClickupSkillError):
    """Raised for failed API requests."""


def debug_log(message: str) -> None:
    path = os.environ.get("CLICKUP_DEBUG_LOG", "").strip()
    if not path:
        return

    payload = message[:MAX_DEBUG_LOG_BYTES]
    line = f"[{datetime.utcnow().isoformat()}Z] {payload}\n"
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as handle:
        handle.write(line)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def validate_identifier(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValidationError(f"{field} cannot be empty")
    if len(cleaned) > MAX_IDENTIFIER_LENGTH:
        raise ValidationError(f"{field} exceeds max length ({MAX_IDENTIFIER_LENGTH})")
    if not IDENTIFIER_RE.match(cleaned):
        raise ValidationError(f"{field} contains invalid characters")
    return cleaned


def sanitize_text(value: str, field: str, max_length: int) -> str:
    cleaned = "".join(ch for ch in value if ch.isprintable() or ch in "\n\t")
    cleaned = cleaned.strip()
    if not cleaned:
        raise ValidationError(f"{field} cannot be empty")
    if len(cleaned) > max_length:
        raise ValidationError(f"{field} exceeds max length ({max_length})")
    return cleaned


def parse_due_date(due: str) -> int:
    try:
        return int(datetime.strptime(due, "%Y-%m-%d").timestamp() * 1000)
    except ValueError as exc:
        raise ValidationError("Invalid due date format. Use YYYY-MM-DD") from exc


def validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValidationError(f"Refusing non-HTTPS URL: {url}")
    host = parsed.hostname or ""
    if host not in ALLOWED_HOSTS:
        raise ValidationError(f"Refusing untrusted host: {host}")


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return max(0.0, min(parsed, 30.0))


def backoff_seconds(attempt: int, retry_after: str | None) -> float:
    explicit = parse_retry_after(retry_after)
    if explicit is not None:
        return explicit
    base = min(2 ** (attempt - 1), 8)
    return base + random.uniform(0.0, 0.3)


def request_json(
    *,
    url: str,
    method: str,
    headers: dict[str, str],
    data: dict[str, Any] | None = None,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    validate_url(url)

    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = Request(url, data=body, headers=headers, method=method)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw) if raw.strip() else {}
        except HTTPError as exc:
            raw_error = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
            debug_log(f"HTTP {exc.code} {method} {url} body={raw_error}")
            if exc.code in RETRY_STATUS_CODES and attempt < MAX_RETRIES:
                time.sleep(backoff_seconds(attempt, exc.headers.get("Retry-After")))
                continue
            raise ApiError(
                f"Request failed ({exc.code}) for {method} {urlparse(url).path}"
            ) from exc
        except URLError as exc:
            debug_log(f"URLERROR {method} {url} reason={exc}")
            if attempt < MAX_RETRIES:
                time.sleep(backoff_seconds(attempt, None))
                continue
            raise ApiError(f"Network request failed for {method} {urlparse(url).path}") from exc

    raise ApiError(f"Request retries exhausted for {method} {urlparse(url).path}")


def api_request(
    endpoint: str,
    *,
    method: str = "GET",
    data: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not endpoint.startswith("/"):
        raise ValidationError("API endpoint must start with '/'")

    query = ""
    if params:
        compact = {k: v for k, v in params.items() if v is not None}
        if compact:
            query = "?" + urlencode(compact, doseq=True)

    url = f"{BASE_URL}{endpoint}{query}"
    return request_json(
        url=url,
        method=method,
        data=data,
        headers={
            "Authorization": required_env("CLICKUP_API_KEY"),
            "Content-Type": "application/json",
        },
    )


def llm_request(prompt: str, system: str = "You are a project management expert.") -> str:
    global LAST_LLM_REQUEST_TS

    elapsed = time.time() - LAST_LLM_REQUEST_TS
    if elapsed < LLM_MIN_INTERVAL_SECONDS:
        time.sleep(LLM_MIN_INTERVAL_SECONDS - elapsed)

    payload = {
        "model": "anthropic/claude-haiku-4.5",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 2000,
    }
    data = request_json(
        url=LLM_URL,
        method="POST",
        data=payload,
        headers={
            "Authorization": f"Bearer {required_env('OPENROUTER_API_KEY')}",
            "Content-Type": "application/json",
        },
    )
    LAST_LLM_REQUEST_TS = time.time()

    choices = data.get("choices", [])
    if not choices:
        raise ApiError("LLM response did not contain choices")
    content = choices[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise ApiError("LLM response content was empty")
    return content


def due_date_display(due_ms: str | None) -> str:
    if not due_ms:
        return ""
    try:
        return datetime.fromtimestamp(int(due_ms) / 1000).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return ""


def due_in_days(due_ms: str | None) -> int | None:
    if not due_ms:
        return None
    try:
        due_dt = datetime.fromtimestamp(int(due_ms) / 1000)
        return (due_dt.date() - datetime.now().date()).days
    except (TypeError, ValueError):
        return None


def status_text(task: dict[str, Any]) -> str:
    status = task.get("status", {})
    if isinstance(status, dict):
        return str(status.get("status", "?"))
    return "?"


def priority_text(task: dict[str, Any]) -> str:
    priority = task.get("priority") or {}
    if isinstance(priority, dict):
        return str(priority.get("priority", "none"))
    return "none"


def assignee_list(task: dict[str, Any]) -> list[str]:
    assignees = task.get("assignees", [])
    if not isinstance(assignees, list):
        return []
    result: list[str] = []
    for assignee in assignees:
        if isinstance(assignee, dict):
            result.append(str(assignee.get("username", "?")).strip())
    return result


def dry_run(method: str, endpoint: str, payload: dict[str, Any] | None = None) -> None:
    print("  DRY RUN")
    print(f"  {method} {endpoint}")
    if payload is not None:
        print(json.dumps(payload, indent=2))


def cmd_workspaces(args: argparse.Namespace) -> None:
    data = api_request("/team")
    for team in data.get("teams", []):
        print(f"  {team['name']} | ID: {team['id']} | Members: {len(team.get('members', []))}")


def cmd_spaces(args: argparse.Namespace) -> None:
    team_id = validate_identifier(args.team_id, "team_id")
    data = api_request(f"/team/{team_id}/space")
    for space in data.get("spaces", []):
        print(f"  {space['name']} | ID: {space['id']} | Private: {space.get('private', False)}")


def cmd_folders(args: argparse.Namespace) -> None:
    space_id = validate_identifier(args.space_id, "space_id")
    data = api_request(f"/space/{space_id}/folder")
    for folder in data.get("folders", []):
        print(f"  {folder['name']} | ID: {folder['id']} | Lists: {len(folder.get('lists', []))}")


def cmd_lists(args: argparse.Namespace) -> None:
    folder_id = validate_identifier(args.folder_id, "folder_id")
    data = api_request(f"/folder/{folder_id}/list")
    for item in data.get("lists", []):
        print(f"  {item['name']} | ID: {item['id']} | Tasks: {item.get('task_count', '?')}")


def cmd_folderless_lists(args: argparse.Namespace) -> None:
    space_id = validate_identifier(args.space_id, "space_id")
    data = api_request(f"/space/{space_id}/list")
    for item in data.get("lists", []):
        print(f"  {item['name']} | ID: {item['id']} | Tasks: {item.get('task_count', '?')}")


def cmd_tasks(args: argparse.Namespace) -> None:
    list_id = validate_identifier(args.list_id, "list_id")
    params: dict[str, Any] = {"subtasks": "true"} if args.subtasks else {}
    if args.status:
        params["statuses[]"] = sanitize_text(args.status, "status", MAX_STATUS_LENGTH)
    if args.assignee:
        params["assignees[]"] = validate_identifier(args.assignee, "assignee")

    data = api_request(f"/list/{list_id}/task", params=params)
    tasks = data.get("tasks", [])
    if not tasks:
        print("  No tasks found.")
        return

    for task in tasks:
        due = due_date_display(task.get("due_date"))
        due_part = f" | Due: {due}" if due else ""
        assignees = ", ".join(assignee_list(task))
        print(
            f"  [{status_text(task)}] {task.get('name', '?')} | ID: {task.get('id', '?')}"
            f" | P: {priority_text(task)}{due_part} | {assignees}"
        )


def cmd_get_task(args: argparse.Namespace) -> None:
    task_id = validate_identifier(args.task_id, "task_id")
    data = api_request(f"/task/{task_id}")
    print(json.dumps(data, indent=2))


def cmd_create_task(args: argparse.Namespace) -> None:
    list_id = validate_identifier(args.list_id, "list_id")
    body: dict[str, Any] = {
        "name": sanitize_text(args.name, "name", MAX_NAME_LENGTH),
    }
    if args.description:
        body["description"] = sanitize_text(args.description, "description", MAX_DESCRIPTION_LENGTH)
    if args.priority is not None:
        if args.priority < 1 or args.priority > 4:
            raise ValidationError("priority must be between 1 and 4")
        body["priority"] = args.priority
    if args.due:
        body["due_date"] = parse_due_date(args.due)
    if args.assignee:
        body["assignees"] = [validate_identifier(args.assignee, "assignee")]

    endpoint = f"/list/{list_id}/task"
    if args.dry_run:
        dry_run("POST", endpoint, body)
        return

    result = api_request(endpoint, method="POST", data=body)
    print(f"  Task created: {result.get('name', '?')} | ID: {result.get('id', '?')}")


def cmd_update_task(args: argparse.Namespace) -> None:
    task_id = validate_identifier(args.task_id, "task_id")
    body: dict[str, Any] = {}

    if args.name:
        body["name"] = sanitize_text(args.name, "name", MAX_NAME_LENGTH)
    if args.status:
        body["status"] = sanitize_text(args.status, "status", MAX_STATUS_LENGTH)
    if args.priority is not None:
        if args.priority < 1 or args.priority > 4:
            raise ValidationError("priority must be between 1 and 4")
        body["priority"] = args.priority
    if args.due:
        body["due_date"] = parse_due_date(args.due)
    if args.assignee:
        body["assignees"] = {"add": [validate_identifier(args.assignee, "assignee")]}

    if not body:
        raise ValidationError("No update fields provided")

    endpoint = f"/task/{task_id}"
    if args.dry_run:
        dry_run("PUT", endpoint, body)
        return

    result = api_request(endpoint, method="PUT", data=body)
    print(f"  Task updated: {result.get('name', '?')}")


def cmd_delete_task(args: argparse.Namespace) -> None:
    task_id = validate_identifier(args.task_id, "task_id")
    if not args.confirm:
        raise ValidationError("delete-task requires --confirm")
    if args.confirm_task_id != task_id:
        raise ValidationError("delete-task requires --confirm-task-id that exactly matches task_id")

    endpoint = f"/task/{task_id}"
    if args.dry_run:
        dry_run("DELETE", endpoint)
        return

    task = api_request(endpoint)
    print(f"  Deleting task: {task.get('name', '?')} | ID: {task_id}")
    api_request(endpoint, method="DELETE")
    print(f"  Task {task_id} deleted.")


def cmd_comment(args: argparse.Namespace) -> None:
    task_id = validate_identifier(args.task_id, "task_id")
    comment_text = sanitize_text(args.text, "text", MAX_COMMENT_LENGTH)
    endpoint = f"/task/{task_id}/comment"
    body = {"comment_text": comment_text}

    if args.dry_run:
        dry_run("POST", endpoint, body)
        return

    result = api_request(endpoint, method="POST", data=body)
    print(f"  Comment added: {result.get('id', 'OK')}")


def cmd_start_timer(args: argparse.Namespace) -> None:
    task_id = validate_identifier(args.task_id, "task_id")
    endpoint = f"/task/{task_id}/time"
    body = {"start": True}

    if args.dry_run:
        dry_run("POST", endpoint, body)
        return

    api_request(endpoint, method="POST", data=body)
    print(f"  Timer started on {task_id}")


def cmd_stop_timer(args: argparse.Namespace) -> None:
    team_id = validate_identifier(args.team_id, "team_id")
    running_endpoint = f"/team/{team_id}/time_entries/running"
    stop_endpoint = f"/team/{team_id}/time_entries/stop"

    if args.dry_run:
        dry_run("GET", running_endpoint)
        dry_run("POST", stop_endpoint)
        return

    running = api_request(running_endpoint).get("data", [])
    if not running:
        print("  No running timers.")
        return

    api_request(stop_endpoint, method="POST")
    names = [str(entry.get("task", {}).get("name", "?")) for entry in running[:3]]
    suffix = "" if len(running) <= 3 else " ..."
    print(f"  Timer stop requested for {len(running)} running timer(s): {', '.join(names)}{suffix}")


def cmd_log_time(args: argparse.Namespace) -> None:
    task_id = validate_identifier(args.task_id, "task_id")
    if args.duration <= 0:
        raise ValidationError("duration must be > 0 milliseconds")

    body: dict[str, Any] = {"duration": args.duration}
    if args.description:
        body["description"] = sanitize_text(args.description, "description", MAX_DESCRIPTION_LENGTH)

    endpoint = f"/task/{task_id}/time"
    if args.dry_run:
        dry_run("POST", endpoint, body)
        return

    api_request(endpoint, method="POST", data=body)
    print(f"  Time logged: {args.duration}ms on {task_id}")


def local_priority_score(task: dict[str, Any]) -> tuple[int, str]:
    score = 0
    reasons: list[str] = []

    priority = priority_text(task).lower()
    priority_scores = {
        "urgent": 35,
        "high": 24,
        "normal": 12,
        "low": 4,
        "none": 0,
    }
    p_score = priority_scores.get(priority, 0)
    score += p_score
    if p_score:
        reasons.append(f"priority={priority}")

    due_days = due_in_days(task.get("due_date"))
    if due_days is not None:
        if due_days <= 0:
            score += 35
            reasons.append("overdue_or_today")
        elif due_days <= 1:
            score += 25
            reasons.append("due_in_1d")
        elif due_days <= 3:
            score += 18
            reasons.append("due_in_3d")
        elif due_days <= 7:
            score += 10
            reasons.append("due_in_7d")

    status = status_text(task).lower()
    if "block" in status or "hold" in status:
        score += 20
        reasons.append("blocked")
    if any(token in status for token in ("done", "complete", "closed")):
        score -= 40
        reasons.append("already_done")
    elif any(token in status for token in ("progress", "active", "doing")):
        score += 8
        reasons.append("in_progress")

    score = max(0, min(score, 100))
    return score, ", ".join(reasons) if reasons else "baseline"


def local_prioritize(tasks: list[dict[str, Any]]) -> None:
    ranked = []
    for task in tasks:
        score, reason = local_priority_score(task)
        ranked.append((score, reason, task))
    ranked.sort(key=lambda item: item[0], reverse=True)

    print("  LOCAL TASK PRIORITIZATION (ai-mode=off)")
    print(f"  {'=' * 50}")
    for score, reason, task in ranked:
        due = due_date_display(task.get("due_date"))
        due_part = f" | Due: {due}" if due else ""
        print(
            f"  [{score:>3}] [{status_text(task)}] {task.get('name', '?')}"
            f" | ID: {task.get('id', '?')}{due_part} | {reason}"
        )


def standup_bucket(status: str) -> str:
    normalized = status.lower()
    if any(token in normalized for token in ("done", "complete", "closed")):
        return "done"
    if any(token in normalized for token in ("block", "hold")):
        return "blocked"
    if any(token in normalized for token in ("progress", "active", "doing", "review")):
        return "in_progress"
    return "todo"


def local_standup(tasks: list[dict[str, Any]]) -> None:
    buckets: dict[str, list[str]] = {
        "done": [],
        "in_progress": [],
        "blocked": [],
        "todo": [],
    }

    for task in tasks:
        status = status_text(task)
        item = f"{task.get('name', '?')} [{status}]"
        buckets[standup_bucket(status)].append(item)

    print("  DAILY STANDUP (ai-mode=off)")
    print(f"  {'=' * 50}")
    print("  DONE")
    for item in buckets["done"] or ["(none)"]:
        print(f"    - {item}")
    print("  IN PROGRESS")
    for item in buckets["in_progress"] or ["(none)"]:
        print(f"    - {item}")
    print("  BLOCKED")
    for item in buckets["blocked"] or ["(none)"]:
        print(f"    - {item}")
    print("  TO DO")
    for item in buckets["todo"] or ["(none)"]:
        print(f"    - {item}")


def ai_task_payload(tasks: list[dict[str, Any]], ai_mode: str) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for idx, task in enumerate(tasks, start=1):
        if ai_mode == "redacted":
            payload.append(
                {
                    "task_ref": f"T{idx}",
                    "status": status_text(task),
                    "priority": priority_text(task),
                    "due_in_days": due_in_days(task.get("due_date")),
                    "assignee_count": len(assignee_list(task)),
                }
            )
        else:
            payload.append(
                {
                    "id": task.get("id"),
                    "name": task.get("name"),
                    "status": status_text(task),
                    "priority": priority_text(task),
                    "due_date": task.get("due_date"),
                    "assignees": assignee_list(task),
                }
            )
    return payload


def cmd_prioritize(args: argparse.Namespace) -> None:
    list_id = validate_identifier(args.list_id, "list_id")
    tasks = api_request(f"/list/{list_id}/task").get("tasks", [])
    if not tasks:
        print("  No tasks to prioritize.")
        return

    if args.ai_mode == "off":
        local_prioritize(tasks)
        return

    print(f"  Warning: ai-mode={args.ai_mode} sends task data to third-party provider OpenRouter.")
    prompt = f"""Score these tasks by urgency x importance (0-100). Consider:
- Due dates (closer = more urgent)
- Current priority level
- Status (blocked items need attention)
- Task context available in payload

Return a ranked list with scores and brief reasoning.

Tasks:
{json.dumps(ai_task_payload(tasks, args.ai_mode), indent=2)}"""

    result = llm_request(prompt)
    print("  AI TASK PRIORITIZATION")
    print(f"  {'=' * 50}")
    print(result)


def cmd_standup(args: argparse.Namespace) -> None:
    list_id = validate_identifier(args.list_id, "list_id")
    tasks = api_request(f"/list/{list_id}/task").get("tasks", [])
    if not tasks:
        print("  No tasks for standup.")
        return

    if args.ai_mode == "off":
        local_standup(tasks)
        return

    print(f"  Warning: ai-mode={args.ai_mode} sends task data to third-party provider OpenRouter.")
    prompt = f"""Generate a daily standup summary from these tasks. Group into:
1. Done (completed/closed tasks)
2. In Progress (active tasks)
3. Blocked (blocked/on hold tasks)
4. To Do (not started)

Keep it concise with bullet points.

Tasks:
{json.dumps(ai_task_payload(tasks, args.ai_mode), indent=2)}"""

    result = llm_request(prompt)
    print("  DAILY STANDUP")
    print(f"  {'=' * 50}")
    print(result)


def add_dry_run(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dry-run", action="store_true", help="Preview request without executing")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ClickUp Pro API")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("workspaces")

    p = sub.add_parser("spaces")
    p.add_argument("team_id")

    p = sub.add_parser("folders")
    p.add_argument("space_id")

    p = sub.add_parser("lists")
    p.add_argument("folder_id")

    p = sub.add_parser("folderless-lists")
    p.add_argument("space_id")

    p = sub.add_parser("tasks")
    p.add_argument("list_id")
    p.add_argument("--status")
    p.add_argument("--assignee")
    p.add_argument("--subtasks", action="store_true")

    p = sub.add_parser("get-task")
    p.add_argument("task_id")

    p = sub.add_parser("create-task")
    p.add_argument("list_id")
    p.add_argument("--name", required=True)
    p.add_argument("--description")
    p.add_argument("--priority", type=int)
    p.add_argument("--due")
    p.add_argument("--assignee")
    add_dry_run(p)

    p = sub.add_parser("update-task")
    p.add_argument("task_id")
    p.add_argument("--name")
    p.add_argument("--status")
    p.add_argument("--priority", type=int)
    p.add_argument("--due")
    p.add_argument("--assignee")
    add_dry_run(p)

    p = sub.add_parser("delete-task")
    p.add_argument("task_id")
    p.add_argument("--confirm", action="store_true", help="Required for destructive delete")
    p.add_argument("--confirm-task-id", default="", help="Must exactly match task_id")
    add_dry_run(p)

    p = sub.add_parser("comment")
    p.add_argument("task_id")
    p.add_argument("--text", required=True)
    add_dry_run(p)

    p = sub.add_parser("start-timer")
    p.add_argument("task_id")
    add_dry_run(p)

    p = sub.add_parser("stop-timer")
    p.add_argument("team_id")
    add_dry_run(p)

    p = sub.add_parser("log-time")
    p.add_argument("task_id")
    p.add_argument("--duration", type=int, required=True)
    p.add_argument("--description")
    add_dry_run(p)

    p = sub.add_parser("prioritize")
    p.add_argument("list_id")
    p.add_argument(
        "--ai-mode",
        choices=["off", "redacted", "full"],
        default="full",
        help="AI data sharing mode for third-party summarization",
    )

    p = sub.add_parser("standup")
    p.add_argument("list_id")
    p.add_argument(
        "--ai-mode",
        choices=["off", "redacted", "full"],
        default="full",
        help="AI data sharing mode for third-party summarization",
    )

    return parser


def main() -> int:
    args = build_parser().parse_args()
    commands = {
        "workspaces": cmd_workspaces,
        "spaces": cmd_spaces,
        "folders": cmd_folders,
        "lists": cmd_lists,
        "folderless-lists": cmd_folderless_lists,
        "tasks": cmd_tasks,
        "get-task": cmd_get_task,
        "create-task": cmd_create_task,
        "update-task": cmd_update_task,
        "delete-task": cmd_delete_task,
        "comment": cmd_comment,
        "start-timer": cmd_start_timer,
        "stop-timer": cmd_stop_timer,
        "log-time": cmd_log_time,
        "prioritize": cmd_prioritize,
        "standup": cmd_standup,
    }
    try:
        commands[args.command](args)
        return 0
    except ClickupSkillError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
