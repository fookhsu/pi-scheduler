import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ScheduleDefinition } from "./scheduling.ts";
import type { ScheduleTask } from "./types.ts";

const STORAGE_VERSION = 1;

type StorageFile = {
  version: number;
  tasks: unknown;
};

export class FileTaskStore {
  constructor(private readonly filePath: string) {}

  load(): Promise<ScheduleTask[]> {
    return loadTasks(this.filePath);
  }

  save(tasks: ScheduleTask[]): Promise<void> {
    return saveTasks(this.filePath, tasks);
  }
}

export async function loadTasks(filePath: string): Promise<ScheduleTask[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  let parsed: StorageFile;
  try {
    parsed = JSON.parse(raw) as StorageFile;
  } catch (error) {
    await backupCorruptFile(filePath);
    throw new Error(`Invalid scheduler file ${filePath}: ${(error as Error).message}`);
  }

  if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.tasks)) {
    throw new Error(`Unsupported scheduler file format in ${filePath}`);
  }

  return parsed.tasks.filter(isScheduleTask);
}

export async function saveTasks(filePath: string, tasks: ScheduleTask[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  const payload = JSON.stringify({ version: STORAGE_VERSION, tasks }, null, 2) + "\n";

  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function isScheduleTask(value: unknown): value is ScheduleTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<ScheduleTask>;
  return (
    typeof task.id === "string" &&
    typeof task.prompt === "string" &&
    task.prompt.length > 0 &&
    (task.scope === "session" || task.scope === "durable") &&
    typeof task.enabled === "boolean" &&
    typeof task.pending === "boolean" &&
    typeof task.createdAt === "string" &&
    typeof task.updatedAt === "string" &&
    typeof task.runCount === "number" &&
    Number.isInteger(task.runCount) &&
    task.runCount >= 0 &&
    isScheduleDefinition(task.schedule)
  );
}

function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<ScheduleDefinition>;
  if (schedule.kind === "once") return typeof schedule.runAt === "string";
  if (schedule.kind === "interval") {
    return typeof schedule.everyMs === "number" && schedule.everyMs > 0;
  }
  if (schedule.kind === "cron") return typeof schedule.expression === "string";
  return false;
}

async function backupCorruptFile(filePath: string): Promise<void> {
  const backupPath = `${filePath}.corrupt.${Date.now()}`;
  await rename(filePath, backupPath).catch(() => undefined);
}

export { STORAGE_VERSION };
