import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../src/lock.ts";
import { schedulerPaths } from "../src/paths.ts";
import { listRuns, writeRun } from "../src/runs.ts";
import { runDue, runTask, type TaskExecutor } from "../src/runner.ts";
import { loadTasks, saveTasks } from "../src/storage.ts";
import type { RunRecord, ScheduleTask } from "../src/types.ts";

class FakeExecutor implements TaskExecutor {
  calls: Array<{ taskId: string; runId: string; projectDir: string }> = [];
  fail = false;

  async execute(task: ScheduleTask, run: RunRecord, projectDir: string) {
    this.calls.push({ taskId: task.id, runId: run.runId, projectDir });
    if (this.fail) throw new Error("provider unavailable");
    return { sessionFile: `/tmp/${run.runId}.jsonl`, summary: `Ran ${task.name ?? task.id}` };
  }
}

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-scheduler-proj-"));
}

function task(overrides: Partial<ScheduleTask> & Pick<ScheduleTask, "id" | "schedule">): ScheduleTask {
  return {
    prompt: "Check CI",
    enabled: true,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

test("runs a due recurring task and advances its next run from now", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_a", name: "check-ci", schedule: { kind: "interval", everyMs: 300_000 }, nextRunAt: "2026-09-01T10:05:00.000Z" }),
  ]);
  const executor = new FakeExecutor();

  const result = await runDue({ projectDir, executor, now: new Date("2026-09-01T10:07:00.000Z") });

  assert.equal(result.skipped, false);
  assert.equal(result.failures, 0);
  assert.deepEqual(executor.calls.map((call) => call.runId), [result.runs[0].runId]);
  const [stored] = await loadTasks(paths.tasksFile);
  assert.equal(stored.nextRunAt, "2026-09-01T10:12:00.000Z");
  assert.equal(stored.enabled, true);
  const [run] = await listRuns(paths.runsDir);
  assert.equal(run.status, "success");
  assert.equal(run.sessionFile, `/tmp/${run.runId}.jsonl`);
  assert.match(run.summary ?? "", /check-ci/);
});

test("runs a one-shot task within its grace window, then disables it", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_once", schedule: { kind: "once", runAt: "2026-09-01T10:01:00.000Z" }, nextRunAt: "2026-09-01T10:01:00.000Z" }),
  ]);
  const executor = new FakeExecutor();

  const result = await runDue({ projectDir, executor, now: new Date("2026-09-01T10:02:00.000Z") });

  assert.equal(result.runs[0].status, "success");
  const [stored] = await loadTasks(paths.tasksFile);
  assert.equal(stored.enabled, false);
});

test("marks a one-shot task missed beyond its grace window", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_late", schedule: { kind: "once", runAt: "2026-09-01T09:00:00.000Z" }, nextRunAt: "2026-09-01T09:00:00.000Z" }),
  ]);
  const executor = new FakeExecutor();

  const result = await runDue({ projectDir, executor, now: new Date("2026-09-01T10:00:00.000Z") });

  assert.equal(result.missed, 1);
  assert.equal(executor.calls.length, 0);
  const [stored] = await loadTasks(paths.tasksFile);
  assert.equal(stored.enabled, false);
  const [run] = await listRuns(paths.runsDir);
  assert.equal(run.status, "missed");
});

test("records a failure without retrying a one-shot task", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_fail", schedule: { kind: "once", runAt: "2026-09-01T10:01:00.000Z" }, nextRunAt: "2026-09-01T10:01:00.000Z" }),
  ]);
  const executor = new FakeExecutor();
  executor.fail = true;

  const first = await runDue({ projectDir, executor, now: new Date("2026-09-01T10:01:30.000Z") });
  const second = await runDue({ projectDir, executor, now: new Date("2026-09-01T10:02:00.000Z") });

  assert.equal(first.failures, 1);
  assert.equal(second.runs.length, 0);
  assert.equal(executor.calls.length, 1);
  const [run] = await listRuns(paths.runsDir);
  assert.equal(run.status, "error");
  assert.match(run.error ?? "", /provider unavailable/);
});

test("advances a failed recurring task to its next cycle", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_loop", schedule: { kind: "interval", everyMs: 300_000 }, nextRunAt: "2026-09-01T10:05:00.000Z" }),
  ]);
  const executor = new FakeExecutor();
  executor.fail = true;

  await runDue({ projectDir, executor, now: new Date("2026-09-01T10:07:00.000Z") });

  const [stored] = await loadTasks(paths.tasksFile);
  assert.equal(stored.nextRunAt, "2026-09-01T10:12:00.000Z");
  assert.equal(stored.enabled, true);
});

test("skips while another live invocation owns the lock", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_locked", schedule: { kind: "interval", everyMs: 300_000 }, nextRunAt: "2026-09-01T10:05:00.000Z" }),
  ]);
  const lock = await acquireLock(paths.lockFile);
  const executor = new FakeExecutor();

  const result = await runDue({ projectDir, executor, now: new Date("2026-09-01T10:07:00.000Z") });

  assert.equal(result.skipped, true);
  assert.equal(executor.calls.length, 0);
  await lock?.release();
});

test("reclaims a stale running run and executes the task again", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_crash", schedule: { kind: "interval", everyMs: 300_000 }, nextRunAt: "2026-09-01T10:05:00.000Z" }),
  ]);
  await writeRun(paths.runsDir, {
    runId: "run_crashed",
    taskId: "task_crash",
    trigger: "scheduled",
    startedAt: "2026-09-01T09:00:00.000Z",
    status: "running",
  });
  const executor = new FakeExecutor();

  await runDue({ projectDir, executor, now: new Date("2026-09-01T10:07:00.000Z") });

  const runs = await listRuns(paths.runsDir);
  const crashed = runs.find((run) => run.runId === "run_crashed");
  assert.equal(crashed?.status, "error");
  assert.equal(executor.calls.length, 1);
});

test("manual run executes a task without changing its schedule", async () => {
  const projectDir = await project();
  const paths = schedulerPaths(projectDir);
  await saveTasks(paths.tasksFile, [
    task({ id: "task_manual", schedule: { kind: "interval", everyMs: 300_000 }, nextRunAt: "2026-09-03T10:05:00.000Z" }),
  ]);
  const executor = new FakeExecutor();

  const outcome = await runTask(projectDir, "task_manual", { executor, now: new Date("2026-09-01T10:07:00.000Z") });

  assert.equal(outcome.status, "success");
  const [stored] = await loadTasks(paths.tasksFile);
  assert.equal(stored.nextRunAt, "2026-09-03T10:05:00.000Z");
  const [run] = await listRuns(paths.runsDir);
  assert.equal(run.trigger, "manual");
});
