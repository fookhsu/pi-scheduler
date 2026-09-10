import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.ts";
import { registerTools } from "../src/tools.ts";
import { TASK_SESSION_ENV } from "../src/env.ts";

/**
 * Management surface only. The extension never schedules, locks, polls, or
 * executes: cron invokes `pi-scheduler run-due`, and this only reads/writes the
 * store. Inside a Task Session it stays completely inert.
 */
export default function (pi: ExtensionAPI): void {
  if (process.env[TASK_SESSION_ENV]) return;

  registerCommands(pi);
  registerTools(pi);
}
