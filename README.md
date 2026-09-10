# pi-scheduler

Native scheduled prompt tasks for [Pi](https://pi.dev).

## Features

- One-time reminders
- Session loops and project durable tasks
- Interval schedules such as `30m` and `2h`
- Five- and six-field Cron expressions
- Tasks wait for Pi to become idle and execute serially
- Project persistence in `.pi/scheduler.json`
- Project-level lock to avoid duplicate execution
- Atomic writes and malformed-task isolation
- Agent tool plus slash commands

## Install

From this repository:

```bash
pi install .
```

After installation, restart Pi or run `/reload`.

## Commands

```text
/loop 30m 检查 CI 状态
/remind in 45m 查看发布结果
/remind at 15:30 检查生产环境
/schedule list
/schedule enable <id>
/schedule disable <id>
/schedule run <id>
/schedule delete <id>
/schedule clear
/unschedule <id>
```

`/loop` creates a session task. `/remind` creates a durable one-time task.

## Agent tool

The `schedule_task` tool supports `add`, `list`, `enable`, `disable`, `delete`, `run`, and `clear`.

Example input:

```json
{
  "action": "add",
  "name": "check-ci",
  "prompt": "检查当前项目 CI 是否通过；如果失败请分析原因",
  "scope": "durable",
  "schedule": {
    "kind": "interval",
    "every": "30m"
  }
}
```

Durable mutations made through the Agent require confirmation. The first release does not execute arbitrary shell commands and does not run tasks after Pi exits.

## Storage and recovery

Durable tasks are stored at `<project>/.pi/scheduler.json`. Times are stored as UTC ISO strings and displayed in local time. If Pi is busy when a task becomes due, one pending run is retained and executed after the Agent settles. Missed recurring periods collapse into one catch-up run; missed one-shot tasks require confirmation in an interactive session.

Only one Pi instance per project owns the scheduler poller. Other instances can still inspect and manage the task file.

## Development

```bash
npm install
npm run check
```

The extension entry point is `extensions/scheduler.ts`; scheduling, persistence, locking, and Pi integration live under `src/`.
