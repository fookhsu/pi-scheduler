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
The component that determines when schedule tasks are due.
_Avoid_: Runner.

**Task Runner**:
The component that starts a Task Session for a due task run.
_Avoid_: Daemon, scheduler.

**Task Session**:
An isolated Pi session belonging to one Task Run and separate from the user's interactive Pi session.
_Avoid_: Background session, shared session.

**Pi Session**:
A conversation and its recorded context owned by one Pi runtime.
_Avoid_: Window, task, run.

**User Pi Session**:
The interactive Pi session in which a user creates and manages schedule tasks.
_Avoid_: Main session, global session.
