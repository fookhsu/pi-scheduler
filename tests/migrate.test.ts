import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyTasks } from "../src/migrate.ts";
import { schedulerPaths } from "../src/paths.ts";
import { loadTasks } from "../src/storage.ts";

async function projectWithLegacy(tasks: unknown[]): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "pi-scheduler-migrate-"));
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await writeFile(join(projectDir, ".pi", "scheduler.json"), JSON.stringify({ version: 1, tasks }));
  return projectDir;
}

test("migrates durable tasks and drops run state and session tasks", async () => {
  const projectDir = await projectWithLegacy([
    {
      id: "task_durable",
      name: "keep me",
      prompt: "Check CI",
      schedule: { kind: "interval", everyMs: 300_000 },
      scope: "durable",
      enabled: true,
      nextRunAt: "2026-09-01T10:05:00.000Z",
      pending: true,
      runCount: 7,
      lastStatus: "error",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:30:00.000Z",
    },
    {
      id: "task_session",
      prompt: "Temporary loop",
      schedule: { kind: "interval", everyMs: 300_000 },
      scope: "session",
      enabled: true,
      pending: false,
      runCount: 2,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
  ]);

  const result = await migrateLegacyTasks(projectDir);

  assert.deepEqual(result, { migrated: 1, skippedSessionTasks: 1 });
  const [task] = await loadTasks(schedulerPaths(projectDir).tasksFile);
  assert.equal(task.id, "task_durable");
  assert.equal(task.nextRunAt, "2026-09-01T10:05:00.000Z");
  assert.equal((task as Record<string, unknown>).runCount, undefined);
  assert.equal((task as Record<string, unknown>).pending, undefined);
  assert.equal((task as Record<string, unknown>).scope, undefined);
});

test("is a no-op when no legacy file exists", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "pi-scheduler-migrate-"));
  assert.deepEqual(await migrateLegacyTasks(projectDir), { migrated: 0, skippedSessionTasks: 0 });
  await assert.rejects(() => readFile(schedulerPaths(projectDir).tasksFile, "utf8"));
});
