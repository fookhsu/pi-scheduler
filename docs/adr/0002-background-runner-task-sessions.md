# ADR 0002: Background Task Runner with per-run Task Sessions

- Status: Accepted
- Supersedes: ADR 0001
- Date: 2026-09-10

## Context

ADR 0001 chose a session-first scheduler that runs tasks only while the current Pi process is active. That model cannot run tasks after Pi exits, and it injects scheduled work into the user's interactive session, mixing run history into one session tree. The requirement changed: tasks must run after Pi exits, be triggered by system cron, and keep task-granularity session records separate from the user's Pi window.

## Decision

Rebuild the plugin around a background Task Runner with these boundaries:

- Pi is only a management surface; a `pi-scheduler run-due` CLI is the single execution entry point, invoked by system cron.
- Each Task Run creates a fully isolated Task Session through the Pi SDK, stored under `.pi/scheduler/sessions/<taskId>/<runId>.jsonl`.
- Task definitions and run records are persisted project-locally under `.pi/scheduler/`; a `run.lock` and per-run claims make `run-due` idempotent.
- The plugin never manages the system crontab; it never executes arbitrary shell commands; run results are never injected into the user's Pi session.
- The old in-process scheduler is removed, not kept for compatibility.

## Consequences

Execution survives Pi exit and is isolated per run, at the cost of dropping in-process `/loop` semantics (now redefined as durable tasks) and requiring the user to install a cron entry. Scheduled prompts and session files may be sensitive, so they live gitignored under `.pi/` with `0600` permissions.

## Alternatives considered

- **Extend the in-process scheduler**: cannot run after Pi exits and pollutes the user session; rejected.
- **A persistent daemon**: better latency but adds lifecycle, PID, and upgrade management; deferred as an optional loop wrapper around `run-due`.
- **Per-task crontab entries**: high operational and portability cost, conflicts with the KISS principle; ruled out of scope.
