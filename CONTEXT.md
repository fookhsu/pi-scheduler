# Pi Scheduler Context

This project executes scheduled prompt tasks for Pi. Triggering is owned by an external scheduler, so the language separates planned time from execution: the plugin decides which tasks are due and runs them, and never owns timing.

## Scheduling

**Schedule Task**:
A stored prompt plus a time rule defining work to be performed at a planned time or cadence.
_Avoid_: Job, cron job, reminder, durable task, session task.

**Due Task**:
A schedule task whose planned time has arrived at the moment the task runner is invoked.
_Avoid_: Pending task, queued job.

**Missed Task**:
A due task whose grace window ended before any task run claimed it.
_Avoid_: Expired task.

**Trigger**:
The cause of a task run: `scheduled` when the task's planned time arrived, `manual` when a user requested it directly.
_Avoid_: Event, cause, cron.

## Execution

**Task Runner**:
The component that executes due schedule tasks, creating one task session per task run. It is invoked by an external scheduler and never schedules itself.
_Avoid_: Scheduler, daemon, worker.

**Task Run**:
One execution attempt of a schedule task.
_Avoid_: Task, job run, execution.

**Run Claim**:
The exclusive marker that one task run has been taken up by a task runner. A claim left behind by a crashed run is stale and may be reclaimed by a later invocation.
_Avoid_: Lock, lease.

**Run Lock**:
The project-wide exclusive lock that allows at most one task runner to execute at a time.
_Avoid_: Claim, mutex.

**Task Session**:
An isolated Pi session belonging to one task run and separate from the user's interactive session.
_Avoid_: Background session, shared session.

## Sessions

**Pi Session**:
A conversation and its recorded context owned by one Pi runtime.
_Avoid_: Window, task, run.

**User Pi Session**:
The interactive Pi session in which a user creates and manages schedule tasks.
_Avoid_: Main session, global session.
