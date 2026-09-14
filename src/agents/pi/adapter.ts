import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { sessionFileFor, schedulerPaths } from "../../paths.ts";
import type { RunRecord, ScheduleTask } from "../../types.ts";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../types.ts";
import { TASK_SESSION_ENV } from "./env.ts";

/** Names the `pi` executable the adapter spawns, for cron's minimal PATH. */
export const PI_BIN_ENV = "PI_SCHEDULER_PI_BIN";

/**
 * Agent adapter for Pi: one fresh, isolated Pi session per Task Run, driven by
 * spawning `pi --print`.
 *
 * The adapter deliberately does not import the Pi SDK. A Task Run has to work
 * from a bare `node` process under cron, where that SDK is not resolvable: it is
 * a peer that Pi provides to its own extension loader, not to standalone CLIs.
 * Spawning `pi` also means a Task Session runs on the user's own Pi — same
 * model, credentials, and project-trust rules — instead of a second copy of the
 * SDK that can drift from it.
 */
export function createPiAdapter(): AgentAdapter {
  return {
    id: "pi",
    displayName: "Pi",
    run: runInTaskSession,
  };
}

async function runInTaskSession({
  task,
  run,
  projectDir,
}: AgentRunRequest): Promise<AgentRunResult> {
  const cwd = task.cwd ? resolve(projectDir, task.cwd) : projectDir;
  const sessionFile = sessionFileFor(schedulerPaths(projectDir), task.id, run.runId);
  await mkdir(dirname(sessionFile), { recursive: true });

  const bin = resolvePiBinary();
  const { code, stdout, stderr } = await spawnPi(bin, piArgs(task, run, sessionFile), cwd);
  if (code !== 0) {
    throw new Error(`pi exited with ${code}${stderr.trim() ? `: ${lastLines(stderr)}` : ""}`);
  }

  await chmod(sessionFile, 0o600).catch(() => undefined);
  return { sessionFile, summary: summarize(stdout) };
}

/**
 * The argv for one Task Run. `--print` keeps the run non-interactive, which is
 * also what makes the spawned Pi resolve project trust headlessly instead of
 * prompting — the same rule any other non-interactive Pi mode follows.
 */
export function piArgs(task: ScheduleTask, run: RunRecord, sessionFile: string): string[] {
  return [
    "--print",
    "--session",
    sessionFile,
    ...(task.model ? ["--model", task.model] : []),
    ...(task.thinking ? ["--thinking", task.thinking] : []),
    ...(task.tools?.length ? ["--tools", task.tools.join(",")] : []),
    formatPrompt(task, run),
  ];
}

/** Finds the `pi` executable: an explicit override first, then $PATH. */
export function resolvePiBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PI_BIN_ENV]?.trim();
  if (override) return override;

  const windows = process.platform === "win32";
  const names = windows ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
  const mode = windows ? constants.F_OK : constants.X_OK;

  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, mode);
        return candidate;
      } catch {
        // Not in this directory; keep looking.
      }
    }
  }

  throw new Error(
    `Could not find "pi" on PATH, which is expected under cron. Set ${PI_BIN_ENV} to the full path of the pi executable.`,
  );
}

type PiProcessResult = { code: number | null; stdout: string; stderr: string };

function spawnPi(bin: string, args: string[], cwd: string): Promise<PiProcessResult> {
  return new Promise((settle, fail) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, [TASK_SESSION_ENV]: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => fail(new Error(`Could not run ${bin}: ${error.message}`)));
    child.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

function formatPrompt(task: ScheduleTask, run: RunRecord): string {
  return [
    "[Scheduled task]",
    `Task ID: ${task.id}`,
    `Task name: ${task.name ?? "(unnamed)"}`,
    `Run ID: ${run.runId}`,
    "",
    task.prompt,
  ].join("\n");
}

/** `pi --print` writes the assistant's last message to stdout. */
function summarize(stdout: string): string | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  return text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
}

function lastLines(text: string, count = 3): string {
  return text.trim().split("\n").filter(Boolean).slice(-count).join(" / ");
}
