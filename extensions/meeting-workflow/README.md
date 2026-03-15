# Meeting Workflow Plugin

This plugin is the in-repo implementation target for the meeting workflow feature.

Current implementation status:

- multi-account Fathom ingress routes
- normalized `meeting-event-v1` contract
- account-aware webhook forwarding into OpenClaw hooks
- per-step LLM extraction interfaces and initial implementation
- Google Docs and ClickUp adapter interfaces with account-aware adapter implementations
- workflow orchestrator skeleton
- `meeting-workflow-analyze` tool for analysis-only structured output
- `meeting-workflow-run` tool for full workflow execution
- state/report persistence under plugin state dir for replay-safe cached runs

Intended account-aware webhook pattern:

- `/integrations/source/fathom/job-a/webhook`
- `/integrations/source/fathom/job-b/webhook`

The plugin is designed so that:

- source providers remain isolated under `src/sources/`
- LLM steps remain isolated under `src/llm/`
- document providers remain isolated under `src/documents/`
- task providers remain isolated under `src/tasks/`
- orchestration remains provider-neutral under `src/workflow/`

For operational setup details, see:

- `MeetingsOps.md`
- `MeetingWorkflowImplementationPlan.md`
- `ops/meeting-ingress/SETUP.md`
