# Pi Scheduler Context

This project defines scheduled work for Pi sessions and keeps the language around planning, execution, and recovery explicit.

## Scheduling

**Schedule Task**:
A user-defined instruction intended to be performed at a specified time or recurring cadence.
_Avoid_: Job, cron job, reminder (unless referring specifically to a task type).

**Session Task**:
A schedule task that belongs only to the currently running Pi session.
_Avoid_: Temporary job.

**Durable Task**:
A schedule task that belongs to a project and remains available across Pi restarts.
_Avoid_: Persistent job, global task.

**Task Run**:
One attempted execution of a schedule task.
_Avoid_: Task, schedule.

**Pending Task**:
A due schedule task waiting for Pi to become available for execution.
_Avoid_: Queued job (unless discussing the implementation queue).

**Missed Task**:
A schedule task whose planned time passed while Pi was not available to execute it.
_Avoid_: Expired task.

**Scheduler**:
The component that determines when schedule tasks are due and starts their task runs.
_Avoid_: Daemon (the first release is not a daemon).
