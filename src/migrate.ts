import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schedulerPaths } from "./paths.ts";
import { calculateNextRun, normalizeScheduleDefinition } from "./scheduling.ts";
import { saveTasks } from "./storage.ts";
import type { ScheduleTask } from "./types.ts";

const LEGACY_FILE = "scheduler.json";

export type MigrationResult = {
  migrated: number;
  skippedSessionTasks: number;
};

type LegacyTask = {
  id?: unknown;
  name?: unknown;
  prompt?: unknown;
  schedule?: unknown;
  scope?: unknown;
  enabled?: unknown;
  nextRunAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

/** Move legacy `.pi/scheduler.json` durable tasks into the new store, dropping run state. */
export async function migrateLegacyTasks(
  projectDir: string,
  options: { now?: Date; force?: boolean } = {},
): Promise<MigrationResult> {
  const paths = schedulerPaths(projectDir);
  const legacyPath = join(projectDir, ".pi", LEGACY_FILE);

  let raw: string;
  try {
    raw = await readFile(legacyPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { migrated: 0, skippedSessionTasks: 0 };
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as { tasks?: unknown };
  const legacyTasks = Array.isArray(parsed.tasks) ? (parsed.tasks as LegacyTask[]) : [];

  if (!options.force && (await tasksFileExists(paths.tasksFile))) {
    throw new Error(`${paths.tasksFile} already exists; pass --force to overwrite it`);
  }

  const now = options.now ?? new Date();
  const tasks: ScheduleTask[] = [];
  let skippedSessionTasks = 0;
  for (const legacy of legacyTasks) {
    if (legacy.scope === "session") {
      skippedSessionTasks += 1;
      continue;
    }
    const task = toScheduleTask(legacy, now);
    if (task) tasks.push(task);
  }

  await saveTasks(paths.tasksFile, tasks);
  return { migrated: tasks.length, skippedSessionTasks };
}

function toScheduleTask(legacy: LegacyTask, now: Date): ScheduleTask | undefined {
  if (
    typeof legacy.id !== "string" ||
    typeof legacy.prompt !== "string" ||
    !legacy.prompt ||
    typeof legacy.createdAt !== "string" ||
    !isLegacySchedule(legacy.schedule)
  ) {
    return undefined;
  }

  const schedule = normalizeScheduleDefinition(legacy.schedule);
  const nextRunAt =
    typeof legacy.nextRunAt === "string"
      ? legacy.nextRunAt
      : calculateNextRun(schedule, now)?.toISOString() ??
        (schedule.kind === "once" ? schedule.runAt : undefined);

  return {
    id: legacy.id,
    ...(typeof legacy.name === "string" ? { name: legacy.name } : {}),
    prompt: legacy.prompt,
    schedule,
    enabled: typeof legacy.enabled === "boolean" ? legacy.enabled : true,
    nextRunAt,
    createdAt: legacy.createdAt,
    updatedAt: typeof legacy.updatedAt === "string" ? legacy.updatedAt : legacy.createdAt,
  };
}

function isLegacySchedule(value: unknown): value is Parameters<typeof normalizeScheduleDefinition>[0] {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Record<string, unknown>;
  if (schedule.kind === "once") return typeof schedule.runAt === "string";
  if (schedule.kind === "interval") return typeof schedule.everyMs === "number";
  if (schedule.kind === "cron") return typeof schedule.expression === "string";
  return false;
}

async function tasksFileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
