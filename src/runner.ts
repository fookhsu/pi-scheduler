import { acquireLock } from "./lock.ts";
import { schedulerPaths, type SchedulerPaths } from "./paths.ts";
import { createRunId, pruneRuns, reclaimStaleRuns, writeRun } from "./runs.ts";
import { calculateNextRun, isDue } from "./scheduling.ts";
import { loadTasks, saveTasks } from "./storage.ts";
import type { RunRecord, ScheduleTask, Trigger } from "./types.ts";

const DEFAULT_RUN_TIMEOUT_MINUTES = 30;
const DEFAULT_MISSED_GRACE_MINUTES = 5;
const DEFAULT_KEEP_RUNS = 20;

export type TaskSessionResult = {
  sessionFile?: string;
  summary?: string;
};

/** Adapter seam: how a Task Run becomes an isolated Pi Task Session. */
export interface TaskExecutor {
  execute(task: ScheduleTask, run: RunRecord, projectDir: string): Promise<TaskSessionResult>;
}

export type RunnerOptions = {
  projectDir: string;
  executor: TaskExecutor;
  now?: Date;
  runTimeoutMinutes?: number;
  missedGraceMinutes?: number;
  paths?: SchedulerPaths;
};

export type RunOutcome = {
  taskId: string;
  runId: string;
  status: RunRecord["status"];
};

export type RunDueResult = {
  /** Another live invocation owned the lock, so nothing was attempted. */
  skipped: boolean;
  runs: RunOutcome[];
  failures: number;
  missed: number;
};

export class TaskNotFoundError extends Error {}

/**
 * The Task Runner: one idempotent pass over the project's tasks. Callers invoke
 * it from cron (`run-due`) or directly for a single task (`run <id>`).
 */
export async function runDue(options: RunnerOptions): Promise<RunDueResult> {
  const now = options.now ?? new Date();
  const paths = options.paths ?? schedulerPaths(options.projectDir);
  const tasks = await loadTasks(paths.tasksFile);

  const lock = await acquireLock(paths.lockFile);
  if (!lock) return { skipped: true, runs: [], failures: 0, missed: 0 };

  try {
    await reclaimStaleRuns(paths.runsDir, now, options.runTimeoutMinutes ?? DEFAULT_RUN_TIMEOUT_MINUTES);

    const due = tasks
      .filter((task) => task.enabled && isDue(task, now))
      .sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""));

    const result: RunDueResult = { skipped: false, runs: [], failures: 0, missed: 0 };
    for (const task of due) {
      const outcome = isBeyondGrace(task, now, options.missedGraceMinutes ?? DEFAULT_MISSED_GRACE_MINUTES)
        ? await markMissed(task, paths, now)
        : await executeTask(task, paths, options, "scheduled", now);
      result.runs.push(outcome);
      if (outcome.status === "error") result.failures += 1;
      if (outcome.status === "missed") result.missed += 1;
      await saveTasks(paths.tasksFile, tasks);
    }
    if (result.runs.length > 0) await pruneRuns(paths.runsDir, DEFAULT_KEEP_RUNS);
    return result;
  } finally {
    await lock.release();
  }
}

/** Execute one task immediately, without disturbing its schedule. */
export async function runTask(
  projectDir: string,
  taskId: string,
  options: Omit<RunnerOptions, "projectDir">,
): Promise<RunOutcome> {
  const now = options.now ?? new Date();
  const paths = options.paths ?? schedulerPaths(projectDir);
  const tasks = await loadTasks(paths.tasksFile);
  const task = findTask(tasks, taskId);
  if (!task) throw new TaskNotFoundError(`Task not found: ${taskId}`);

  const lock = await acquireLock(paths.lockFile);
  if (!lock) return { taskId: task.id, runId: "", status: "skipped" };

  try {
    await reclaimStaleRuns(paths.runsDir, now, options.runTimeoutMinutes ?? DEFAULT_RUN_TIMEOUT_MINUTES);
    return await executeTask(task, paths, { executor: options.executor, projectDir }, "manual", now, false);
  } finally {
    await lock.release();
  }
}

export function findTask(tasks: ScheduleTask[], id: string): ScheduleTask | undefined {
  const exact = tasks.find((task) => task.id === id);
  if (exact) return exact;
  const matches = tasks.filter((task) => task.id.startsWith(id));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new TaskNotFoundError(`Task ID is ambiguous: ${id}`);
  return undefined;
}

async function executeTask(
  task: ScheduleTask,
  paths: SchedulerPaths,
  options: Pick<RunnerOptions, "executor" | "projectDir">,
  trigger: Trigger,
  now: Date,
  advanceSchedule = true,
): Promise<RunOutcome> {
  const runId = createRunId(now);
  const run: RunRecord = {
    runId,
    taskId: task.id,
    trigger,
    startedAt: now.toISOString(),
    status: "running",
  };
  await writeRun(paths.runsDir, run);

  try {
    const result = await options.executor.execute(task, run, options.projectDir);
    await writeRun(paths.runsDir, {
      ...run,
      status: "success",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      sessionFile: result.sessionFile,
      summary: result.summary,
    });
    if (advanceSchedule) advance(task, now);
    return { taskId: task.id, runId, status: "success" };
  } catch (error) {
    await writeRun(paths.runsDir, {
      ...run,
      status: "error",
      finishedAt: new Date().toISOString(),
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
    });
    if (advanceSchedule) advance(task, now);
    return { taskId: task.id, runId, status: "error" };
  }
}

async function markMissed(task: ScheduleTask, paths: SchedulerPaths, now: Date): Promise<RunOutcome> {
  const runId = createRunId(now);
  await writeRun(paths.runsDir, {
    runId,
    taskId: task.id,
    trigger: "scheduled",
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    status: "missed",
    exitCode: 1,
    error: "Planned time passed before any run claimed this task",
  });
  task.enabled = false;
  task.updatedAt = now.toISOString();
  return { taskId: task.id, runId, status: "missed" };
}

/**
 * A one-shot task is terminal after its first attempt: it succeeds, fails, or
 * misses, and never retries on its own. A recurring task moves to its next
 * occurrence measured from now, so missed periods collapse into one catch-up.
 */
function advance(task: ScheduleTask, now: Date): void {
  task.updatedAt = now.toISOString();
  if (task.schedule.kind === "once") {
    task.enabled = false;
    return;
  }
  const next = calculateNextRun(task.schedule, now);
  task.nextRunAt = next?.toISOString();
  if (!next) task.enabled = false;
}

function isBeyondGrace(task: ScheduleTask, now: Date, graceMinutes: number): boolean {
  if (task.schedule.kind !== "once") return false;
  const planned = new Date(task.schedule.runAt).getTime();
  if (Number.isNaN(planned)) return false;
  return now.getTime() - planned > graceMinutes * 60_000;
}
