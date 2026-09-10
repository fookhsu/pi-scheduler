# Scheduled Tasks

Use the `schedule_task` tool when the user asks Pi to do something later or repeatedly.

## Rules

- Use `scope: "session"` for temporary loops that should disappear when the current Pi session ends.
- Use `scope: "durable"` for project tasks that should survive Pi restarts.
- A durable task requires interactive confirmation before it is created, deleted, or cleared.
- Scheduled tasks contain prompts for Pi; they do not contain arbitrary shell commands.
- Use `once` with an ISO timestamp, `interval` with a duration such as `30m`, or `cron` with a 5- or 6-field expression.
- Do not create duplicate tasks when an existing task already represents the same request.
- Explain the task ID and next run time after creating a task.
