import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SchedulerRuntime } from "./runtime.ts";
import type { ScheduleInput } from "./scheduling.ts";
import type { ScheduleTask } from "./types.ts";

const actionSchema = StringEnum([
  "add",
  "list",
  "enable",
  "disable",
  "delete",
  "run",
  "clear",
] as const);

const scheduleSchema = Type.Object({
  kind: StringEnum(["once", "interval", "cron"] as const),
  runAt: Type.Optional(Type.String()),
  every: Type.Optional(Type.String()),
  expression: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  scope: Type.Optional(StringEnum(["session", "durable"] as const)),
});

export function registerTools(pi: ExtensionAPI, runtime: SchedulerRuntime): void {
  pi.registerTool({
    name: "schedule_task",
    label: "Schedule Task",
    description: "Create, inspect, enable, disable, run, or delete scheduled prompt tasks for this Pi project.",
    promptSnippet: "Manage scheduled prompt tasks",
    promptGuidelines: [
      "Use schedule_task when the user asks Pi to perform a task later or repeatedly.",
      "Use a session scope for temporary loops and a durable scope for project reminders that should survive restarts.",
    ],
    parameters: Type.Object({
      action: actionSchema,
      id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      scope: Type.Optional(StringEnum(["session", "durable"] as const)),
      schedule: Type.Optional(scheduleSchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scheduler = runtime.getScheduler();
      const scope = params.scope ?? params.schedule?.scope ?? "durable";

      if (params.action === "add") {
        if (!params.prompt || !params.schedule) {
          throw new Error("add requires prompt and schedule");
        }
        await confirmMutation(ctx, scope === "durable", `Create ${scope} scheduled task?`);
        const task = await scheduler.add({
          name: params.name,
          prompt: params.prompt,
          scope,
          schedule: toScheduleInput(params.schedule, scope),
        });
        return result(`Created ${task.id}; next run ${task.nextRunAt ?? "never"}`, task);
      }

      if (params.action === "list") {
        const tasks = scheduler.list();
        return result(tasks.length ? tasks.map(formatTask).join("\n") : "No scheduled tasks.", { tasks });
      }

      if (!params.id && params.action !== "clear") throw new Error(`${params.action} requires id`);
      if (params.action === "enable") return result(`Enabled ${params.id}`, await scheduler.enable(params.id!));
      if (params.action === "disable") return result(`Disabled ${params.id}`, await scheduler.disable(params.id!));
      if (params.action === "run") {
        await scheduler.runNow(params.id!);
        return result(`Queued ${params.id}`);
      }
      if (params.action === "delete") {
        await confirmMutation(ctx, true, `Delete scheduled task ${params.id}?`);
        await scheduler.delete(params.id!);
        return result(`Deleted ${params.id}`);
      }
      if (params.action === "clear") {
        await confirmMutation(ctx, true, "Delete all scheduled tasks?");
        return result(`Cleared ${await scheduler.clear()} task(s)`);
      }

      throw new Error(`Unsupported action: ${params.action}`);
    },
  });
}

async function confirmMutation(
  ctx: { hasUI: boolean; ui: { confirm(title: string, body: string): Promise<boolean> } },
  required: boolean,
  message: string,
): Promise<void> {
  if (!required) return;
  if (!ctx.hasUI) throw new Error("This persistent mutation requires interactive confirmation");
  if (!(await ctx.ui.confirm("Confirm scheduler change", message))) {
    throw new Error("Scheduler change cancelled");
  }
}

function toScheduleInput(
  schedule: {
    kind: "once" | "interval" | "cron";
    runAt?: string;
    every?: string;
    expression?: string;
    timezone?: string;
  },
  scope: "session" | "durable",
): ScheduleInput {
  if (schedule.kind === "once") {
    if (!schedule.runAt) throw new Error("once schedule requires runAt");
    return { kind: "once", runAt: schedule.runAt, scope };
  }
  if (schedule.kind === "interval") {
    if (!schedule.every) throw new Error("interval schedule requires every");
    return { kind: "interval", every: schedule.every, scope };
  }
  if (!schedule.expression) throw new Error("cron schedule requires expression");
  return {
    kind: "cron",
    expression: schedule.expression,
    timezone: schedule.timezone,
    scope,
  };
}

function result(text: string, details: unknown = {}): {
  content: [{ type: "text"; text: string }];
  details: unknown;
} {
  return { content: [{ type: "text", text }], details };
}

function formatTask(task: ScheduleTask): string {
  const schedule = task.schedule.kind === "interval"
    ? `every ${task.schedule.everyMs}ms`
    : task.schedule.kind === "cron"
      ? `cron ${task.schedule.expression}`
      : `once ${task.schedule.runAt}`;
  return `${task.id} [${task.enabled ? "enabled" : "disabled"}] ${schedule} → ${task.nextRunAt ?? "never"}`;
}
