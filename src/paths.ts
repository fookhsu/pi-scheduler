import { join } from "node:path";

/** Pi's project config directory. Mirrors CONFIG_DIR_NAME from the Pi SDK. */
const PI_DIR = ".pi";

export type SchedulerPaths = {
  dir: string;
  tasksFile: string;
  lockFile: string;
  runsDir: string;
  sessionsDir: string;
};

/** Project-local scheduler storage layout: <project>/.pi/scheduler/... */
export function schedulerPaths(projectDir: string): SchedulerPaths {
  const dir = join(projectDir, PI_DIR, "scheduler");
  return {
    dir,
    tasksFile: join(dir, "tasks.json"),
    lockFile: join(dir, "run.lock"),
    runsDir: join(dir, "runs"),
    sessionsDir: join(dir, "sessions"),
  };
}

/** Session file for one task run: sessions/<taskId>/<runId>.jsonl */
export function sessionFileFor(paths: SchedulerPaths, taskId: string, runId: string): string {
  return join(paths.sessionsDir, taskId, `${runId}.jsonl`);
}
