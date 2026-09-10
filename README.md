# pi-scheduler

Cron-driven scheduled prompt tasks for [Pi](https://pi.dev).

Pi is the management surface; the `pi-scheduler` CLI is the execution surface. A
cron entry invokes `pi-scheduler run-due`, which creates a fully isolated **Task
Session** through the Pi SDK for each due task. The plugin never schedules
itself and never injects task output into your interactive Pi session.

## Features

- One-time, interval, and cron schedules
- One isolated Task Session per run, stored as its own session file
- Project-local task and run storage under `.pi/scheduler/`
- Idempotent `run-due` with a project run lock and per-run records
- Crash recovery: stale runs are reclaimed on the next invocation
- Per-task and per-project configuration overrides
- Agent tool plus slash commands for management

## Install

```bash
# From npm (recommended)
pi install npm:@fookhsu/pi-scheduler

# Or from a checkout
pi install .
npm run build     # produce the pi-scheduler CLI in dist/
```

Restart Pi or run `/reload` after installing. Installed with `pi install -l`,
the package is recorded in the project's `.pi/settings.json` instead of your
user settings.

## Cron setup

`run-due` is the only execution entry point, and the CLI never manages your
crontab. Add one line per project (or point `--project` at each project):

```cron
*/5 * * * * cd /path/to/project && "$HOME/.pi/agent/npm/node_modules/.bin/pi-scheduler" run-due >> .pi/scheduler/cron.log 2>&1
```

Project installs put the binary at `.pi/npm/node_modules/.bin/pi-scheduler`
instead. If you linked it onto your `PATH`, plain `pi-scheduler` works.

## CLI

```text
pi-scheduler run-due [--project <path>]     # cron entry point
pi-scheduler run <taskId> [--project <path>]
pi-scheduler list [--project <path>] [--json]
pi-scheduler add --prompt <text> (--at <iso>|--every <duration>|--cron <expr>) [options]
pi-scheduler enable <taskId> | disable <taskId> | remove <taskId>
pi-scheduler prune --keep <n>
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

## Configuration and overrides

A Task Session is an ordinary Pi session: it runs in the task's `cwd` (the
project root by default) and loads that project's settings, `AGENTS.md`, skills,
and extensions. You can override what it uses at two levels.

Resolution order, highest priority first:

1. Per-task fields (`model`, `thinking`, `cwd`, `tools`).
2. Project settings in `<project>/.pi/settings.json`.
3. User settings in `~/.pi/agent/settings.json`.

### Override a run with `.pi/settings.json`

Project settings merge over global settings, so a repository can pin the model
that scheduled work uses without touching your global default:

```json
{
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-v4-flash",
  "defaultThinkingLevel": "low"
}
```

The same file can disable scheduler resources for a project that should not run
scheduled tasks, using the package-filter object form:

```json
{
  "packages": [
    {
      "source": "npm:@fookhsu/pi-scheduler",
      "extensions": [],
      "skills": []
    }
  ]
}
```

Project overrides only apply after the project is trusted; commit
`.pi/settings.json` to share them with your team. `pi config -l` opens the same
file in an editor with inherited global resources dimmed.

### Override one task

Any task can override the model, thinking level, working directory, and tool
allowlist. In `.pi/scheduler/tasks.json`:

```json
{
  "id": "task_a1b2c3d4",
  "name": "daily-audit",
  "prompt": "检查 CI 并分析失败原因",
  "schedule": { "kind": "cron", "expression": "0 9 * * *" },
  "model": "anthropic/claude-opus-4-5",
  "thinking": "high",
  "cwd": "packages/api",
  "tools": ["read", "bash", "grep"],
  "enabled": true,
  "nextRunAt": "2026-09-11T09:00:00.000Z",
  "createdAt": "2026-09-10T09:00:00.000Z",
  "updatedAt": "2026-09-10T09:00:00.000Z"
}
```

`cwd` is resolved relative to the project root. Omitting a field falls back to
the project and user settings; omitting `tools` keeps Pi's default tool set.

The same overrides are available on the CLI and the Agent tool:

```bash
pi-scheduler add \
  --prompt "检查 CI 并分析失败原因" \
  --cron "0 9 * * *" \
  --model anthropic/claude-opus-4-5 \
  --thinking high \
  --cwd packages/api \
  --tools read,bash,grep
```

```json
{
  "action": "add",
  "prompt": "检查 CI 并分析失败原因",
  "schedule": { "kind": "cron", "expression": "0 9 * * *" },
  "model": "anthropic/claude-opus-4-5",
  "thinking": "high",
  "cwd": "packages/api",
  "tools": ["read", "bash", "grep"]
}
```

## Storage and recovery

```text
<project>/.pi/scheduler/
├── tasks.json                        # versioned task definitions, 0600
├── run.lock                          # project-wide run lock, 0600
├── runs/<runId>.json                 # one record per run, 0600
└── sessions/<taskId>/<runId>.jsonl   # the Task Session, forced to 0600
```

The whole directory is gitignored. Every scheduler file, including Task Session
JSONL files, is written with `0600` permissions.

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

## Development

```bash
npm install
npm run check    # typecheck + tests + build
```

`extensions/scheduler.ts` is the management surface; the Task Runner, stores,
locking, CLI, and Pi SDK executor live under `src/`.

## Releasing

The package follows the [Pi package](https://pi.dev/docs/latest/packages)
conventions: the `pi-package` keyword and a `pi` manifest in `package.json`.

```bash
npm run check        # typecheck + tests + build
npm pack --dry-run   # inspect the published file list
npm publish          # prepare builds dist/, prepublishOnly re-runs check
```

`files` ships `bin/`, `dist/`, `extensions/`, `skills/`, and `src/` — the
extension imports `src/*.ts` at runtime, so `src/` must stay in the tarball.
