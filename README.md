# pi-scheduler

Native scheduled prompt tasks for [Pi](https://pi.dev).

Pi is the management surface; a `pi-scheduler` CLI is the execution surface. A
cron entry invokes `pi-scheduler run-due`, which creates a fully isolated **Task
Session** through the Pi SDK for each due task. The plugin never schedules
itself and never injects task output into your interactive Pi session.

## Features

- One-time, interval, and cron schedules
- One isolated Task Session per run, stored as its own session file
- Project-local task and run storage under `.pi/scheduler/`
- Idempotent `run-due` with a project run lock and per-run records
- Crash recovery: stale runs are reclaimed on the next invocation
- Agent tool plus slash commands for management

## Install

```bash
pi install .      # register the extension and skill
npm run build     # produce the pi-scheduler CLI in dist/
```

After installation, restart Pi or run `/reload`.

## Cron setup

`run-due` is the only execution entry point. Add one line to your crontab, once
per project (or point `--project` at each project):

```cron
*/5 * * * * cd /path/to/project && /path/to/pi-scheduler run-due >> .pi/scheduler/cron.log 2>&1
```

The CLI does not manage your crontab for you.

## CLI

```text
pi-scheduler run-due [--project <path>]     # cron entry point
pi-scheduler run <taskId> [--project <path>]
pi-scheduler list [--project <path>] [--json]
pi-scheduler add --prompt <text> (--at <iso>|--every <duration>|--cron <expr>) [--name n]
pi-scheduler enable <taskId> | disable <taskId> | remove <taskId>
pi-scheduler prune --keep <n>
pi-scheduler migrate [--force]
```

Exit codes: `0` success (including "no due tasks" and "another instance holds
the lock"), `1` at least one task failed, `2` configuration or storage error.

## Pi commands

```text
/loop 30m check CI status
/remind in 45m review the release
/remind at 15:30 check production
/schedule list
/schedule enable <id>
/schedule disable <id>
/schedule run <id>
/schedule remove <id>
/schedule runs <id>
/schedule open <runId>
/schedule clear
/unschedule <id>
```

`/schedule open <runId>` prints the Task Session file path and suggests
`pi --session <path>`. Task Sessions are never merged into the current session.

## Agent tool

The `schedule_task` tool supports `add`, `list`, `enable`, `disable`, `delete`,
`run`, `runs`, and `clear`.

```json
{
  "action": "add",
  "name": "check-ci",
  "prompt": "检查当前项目 CI 是否通过；如果失败请分析原因",
  "schedule": { "kind": "interval", "every": "30m" }
}
```

Creating, deleting, and clearing tasks requires interactive confirmation.

## Storage and recovery

```text
<project>/.pi/scheduler/              # gitignored, files are 0600
├── tasks.json                        # versioned task definitions
├── run.lock                          # project-wide run lock
├── runs/<runId>.json                 # one record per run
└── sessions/<taskId>/<runId>.jsonl   # the Task Session
```

- A task stores a prompt and a time rule, never a shell command.
- Task definitions and run records are separate; run state is never inlined into
  `tasks.json`.
- `run-due` takes `run.lock`, executes due tasks serially, and advances each
  task's `nextRunAt` from the current time. Missed recurring periods collapse
  into one catch-up run.
- A one-shot task is terminal after its first attempt: success disables it,
  failure does not retry, and a run that passed the grace window (default 5
  minutes) is recorded as `missed` and needs `run <id>`.
- A run still marked `running` after the timeout (default 30 minutes) is
  reclaimed as `error` on the next invocation.

## Migration from the in-process MVP

`pi-scheduler migrate` reads the legacy `.pi/scheduler.json` and writes
`.pi/scheduler/tasks.json`, keeping only durable tasks and discarding run state.
Session tasks are not migrated. The old in-process scheduler, `/loop` session
semantics, and daemon-free-in-session execution are gone.

## Development

```bash
npm install
npm run check    # typecheck + tests + build
```

`extensions/scheduler.ts` is the management surface; the Task Runner, stores,
locking, CLI, and Pi SDK executor live under `src/`.
