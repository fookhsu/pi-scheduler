# ADR 0001: Session-first project scheduler

- Status: Accepted
- Date: 2026-09-01

## Context

Pi does not include a built-in background scheduler. Existing packages range from an in-process session scheduler to a detached process that launches `pi -p`, or a bridge to an external MCP scheduler. A first-party extension needs predictable behavior without introducing a daemon, arbitrary command execution, or a second permission model.

## Decision

Implement the first release as a native Pi extension with these boundaries:

- schedule prompt messages, not arbitrary shell commands;
- run tasks only while the current Pi process is active;
- persist project-scoped durable tasks in `.pi/scheduler.json`;
- keep session tasks in memory;
- execute one task at a time and only when Pi is idle;
- collapse missed recurring intervals to one catch-up run;
- require interactive confirmation for durable mutations made by the Agent tool;
- use a project lock so only one Pi instance polls and triggers tasks;
- reserve detached/background execution for a later, separately designed mode.

## Consequences

The first release is small, testable, and uses Pi's existing session and tool permission behavior. A closed Pi process cannot execute tasks, and users who need operating-system-level scheduling must use a future daemon mode or an external scheduler. Project-local task files are human-readable but may contain sensitive prompts and must be treated as trusted project data.

## Alternatives considered

- **External MCP bridge:** quick to adopt, but adds a runtime dependency and hides scheduling semantics outside the Pi extension.
- **Detached `pi -p` subprocesses:** supports execution while Pi is closed, but requires explicit decisions about credentials, sessions, logs, concurrency, and permissions.
- **Arbitrary shell scheduling:** rejected for the first release because it creates a second command-execution path and a larger security surface.
