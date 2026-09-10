# ADR 0002: Background Task Runner with per-run Task Sessions

- Status: Accepted
- Date: 2026-09-10

## Context

Pi is an interactive runtime and does not run work on its own after it exits. Scheduled tasks must run unattended, be triggered by system cron, and keep task-granularity session records separate from the user's Pi window instead of mixing run history into one session tree. A reasonable reader might otherwise expect the plugin to own a timer or daemon.

## Decision

Build the plugin around a background Task Runner with these boundaries:

- Pi is only a management surface; a `pi-scheduler run-due` CLI is the single execution entry point, invoked by system cron.
- Each Task Run creates a fully isolated Task Session through the Pi SDK, stored under `.pi/scheduler/sessions/<taskId>/<runId>.jsonl`.
- Task definitions and run records are persisted project-locally under `.pi/scheduler/`; a `run.lock` and per-run records make `run-due` idempotent.
- The plugin never manages the system crontab; it never executes arbitrary shell commands; run results are never injected into the user's Pi session.

## Consequences

Execution survives Pi exit and is isolated per run, at the cost of requiring the user to install a cron entry. Scheduled prompts and session files may be sensitive, so they live gitignored under `.pi/` with `0600` permissions.

## Alternatives considered

- **A persistent daemon**: better latency but adds lifecycle, PID, and upgrade management; deferred as an optional loop wrapper around `run-due`.
- **Per-task crontab entries**: high operational and portability cost, conflicts with the KISS principle; ruled out of scope.
