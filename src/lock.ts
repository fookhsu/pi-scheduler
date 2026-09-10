import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SchedulerLock = {
  path: string;
  release(): Promise<void>;
};

type LockRecord = {
  pid: number;
  hostname: string;
  startedAt: string;
};

export async function acquireLock(path: string): Promise<SchedulerLock | undefined> {
  await mkdir(dirname(path), { recursive: true });
  const record: LockRecord = {
    pid: process.pid,
    hostname: process.env.HOSTNAME ?? "unknown",
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(record, null, 2));
      } finally {
        await handle.close();
      }
      return {
        path,
        async release() {
          await unlink(path).catch(() => undefined);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await isStaleLock(path))) return undefined;
      await unlink(path).catch(() => undefined);
    }
  }
  return undefined;
}

async function isStaleLock(path: string): Promise<boolean> {
  let record: Partial<LockRecord>;
  try {
    record = JSON.parse(await readFile(path, "utf8")) as Partial<LockRecord>;
  } catch {
    return true;
  }
  if (typeof record.pid !== "number" || record.pid <= 0) return true;
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
