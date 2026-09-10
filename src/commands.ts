import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseDuration } from "./scheduling.ts";
import { SchedulerRuntime } from "./runtime.ts";
import type { ScheduleTask } from "./types.ts";

export function registerCommands(pi: ExtensionAPI, runtime: SchedulerRuntime): void {
  pi.registerCommand("loop", {
    description: "Create a recurring session task: /loop 5m check CI",
    handler: async (args, ctx) => {
      try {
        const match = /^\s*(\S+)\s+([\s\S]+?)\s*$/.exec(args);
        if (!match) throw new Error("Usage: /loop <duration> <prompt>");
        const scheduler = runtime.getScheduler();
        const task = await scheduler.add({
          prompt: match[2],
          schedule: { kind: "interval", every: match[1], scope: "session" },
          scope: "session",
        });
        ctx.ui.notify(`Created session task ${task.id}; next run ${formatDate(task.nextRunAt)}`, "info");
      } catch (error) {
        ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("remind", {
    description: "Create a one-time task: /remind in 45m check the PR",
    handler: async (args, ctx) => {
      try {
        const parsed = parseReminder(args);
        const task = await runtime.getScheduler().add({
          prompt: parsed.prompt,
          schedule: { kind: "once", runAt: parsed.runAt, scope: "durable" },
          scope: "durable",
        });
        ctx.ui.notify(`Created reminder ${task.id}; scheduled for ${formatDate(task.nextRunAt)}`, "info");
      } catch (error) {
        ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("schedule", {
    description: "List and manage scheduled tasks",
    handler: async (args, ctx) => {
      try {
        const scheduler = runtime.getScheduler();
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const action = tokens[0] ?? "list";
        const id = tokens[1];
        if (action === "list") {
          ctx.ui.notify(formatTaskList(scheduler.list()), "info");
        } else if (action === "enable" && id) {
          await scheduler.enable(id);
          ctx.ui.notify(`Enabled ${id}`, "info");
        } else if (action === "disable" && id) {
          await scheduler.disable(id);
          ctx.ui.notify(`Disabled ${id}`, "info");
        } else if (action === "run" && id) {
          await scheduler.runNow(id);
          ctx.ui.notify(`Queued ${id}`, "info");
        } else if (action === "delete" && id) {
          await scheduler.delete(id);
          ctx.ui.notify(`Deleted ${id}`, "info");
        } else if (action === "clear" && tokens.length === 1) {
          const count = await scheduler.clear();
          ctx.ui.notify(`Cleared ${count} task(s)`, "info");
        } else {
          throw new Error("Usage: /schedule [list|enable|disable|run|delete] <id> or /schedule clear");
        }
      } catch (error) {
        ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("unschedule", {
    description: "Delete a scheduled task: /unschedule <id>",
    handler: async (args, ctx) => {
      try {
        if (!args.trim()) throw new Error("Usage: /unschedule <id>");
        await runtime.getScheduler().delete(args.trim());
        ctx.ui.notify(`Deleted ${args.trim()}`, "info");
      } catch (error) {
        ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });
}

function parseReminder(args: string): { runAt: string; prompt: string } {
  const inMatch = /^\s*in\s+(\S+)\s+([\s\S]+?)\s*$/i.exec(args);
  if (inMatch) {
    return {
      runAt: new Date(Date.now() + parseDuration(inMatch[1])).toISOString(),
      prompt: inMatch[2],
    };
  }

  const atMatch = /^\s*at\s+(\d{1,2}):(\d{2})\s+([\s\S]+?)\s*$/i.exec(args);
  if (!atMatch) throw new Error("Usage: /remind in <duration> <prompt> or /remind at HH:MM <prompt>");
  const hour = Number(atMatch[1]);
  const minute = Number(atMatch[2]);
  if (hour > 23 || minute > 59) throw new Error("Time must be in HH:MM format");
  const runAt = new Date();
  runAt.setHours(hour, minute, 0, 0);
  if (runAt.getTime() <= Date.now()) runAt.setDate(runAt.getDate() + 1);
  return { runAt: runAt.toISOString(), prompt: atMatch[3] };
}

export function formatTaskList(tasks: ScheduleTask[]): string {
  if (tasks.length === 0) return "No scheduled tasks.";
  return tasks.map((task) => {
    const state = task.enabled ? (task.pending ? "pending" : "enabled") : "disabled";
    const schedule = task.schedule.kind === "interval"
      ? `every ${task.schedule.everyMs}ms`
      : task.schedule.kind === "cron"
        ? `cron ${task.schedule.expression}`
        : `once ${task.schedule.runAt}`;
    return `${task.id} [${state}, ${task.scope}] ${task.name ?? "-"} — ${schedule} — next ${formatDate(task.nextRunAt)} — runs ${task.runCount}`;
  }).join("\n");
}

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : "never";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
