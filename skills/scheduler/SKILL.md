# Scheduled Tasks

Use the `schedule_task` tool when the user asks Pi to do something later or repeatedly.

## Rules

- Every task is project-scoped and persists in `.pi/scheduler/tasks.json`; there is no session scope.
- Each run executes in its own isolated Task Session. Results are never injected into this session; use `runs` to inspect them, and tell the user they can open one with `pi --session <path>`.
- Creating, deleting, and clearing tasks requires interactive confirmation.
- Tasks contain prompts for Pi; they never contain arbitrary shell commands.
- Use `once` with an ISO timestamp, `interval` with a duration of at least 1 minute such as `30m`, or `cron` with a 5- or 6-field expression.
- Execution only happens when an external scheduler invokes `pi-scheduler run-due`; Pi does not run tasks in the background by itself. Mention the cron entry if the user expects unattended runs.
- Do not create duplicate tasks when an existing task already represents the same request.
- Explain the task ID and next run time after creating a task.
