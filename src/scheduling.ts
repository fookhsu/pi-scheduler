import { Cron } from "croner";

export type ScheduleDefinition =
  | { kind: "once"; runAt: string }
  | { kind: "interval"; everyMs: number }
  | { kind: "cron"; expression: string; timezone?: string };

export type ScheduleInput =
  | { kind: "once"; runAt: string }
  | { kind: "interval"; every: string }
  | { kind: "cron"; expression: string; timezone?: string };

/** The Task Runner is invoked on a cron heartbeat, so sub-minute intervals are meaningless. */
export const MIN_INTERVAL_MS = 60_000;

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

export function parseDuration(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);

  const unit = DURATION_UNITS[match[2].toLowerCase()];
  if (!unit) throw new Error(`Invalid duration unit in: ${value}`);

  const duration = Number(match[1]) * unit;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Duration must be greater than zero: ${value}`);
  }
  return duration;
}

export function normalizeCronExpression(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length === 5) return `0 ${fields.join(" ")}`;
  if (fields.length === 6) return fields.join(" ");
  throw new Error("Cron expression must have 5 or 6 fields");
}

export function parseScheduleInput(input: ScheduleInput): ScheduleDefinition {
  if (input.kind === "once") {
    const date = new Date(input.runAt);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid runAt: ${input.runAt}`);
    return { kind: "once", runAt: date.toISOString() };
  }

  if (input.kind === "interval") {
    const everyMs = parseDuration(input.every);
    if (everyMs < MIN_INTERVAL_MS) throw new Error("Intervals must be at least 1 minute");
    return { kind: "interval", everyMs };
  }

  const expression = normalizeCronExpression(input.expression);
  new Cron(expression, { timezone: input.timezone });
  return { kind: "cron", expression, timezone: input.timezone };
}

export function calculateNextRun(
  schedule: ScheduleDefinition,
  from: Date,
): Date | undefined {
  if (schedule.kind === "once") {
    const runAt = new Date(schedule.runAt);
    return runAt.getTime() > from.getTime() ? runAt : undefined;
  }

  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.everyMs);
  }

  const next = new Cron(schedule.expression, { timezone: schedule.timezone }).nextRun(from);
  return next ?? undefined;
}

/** The planned time of a task has arrived at the moment the runner is invoked. */
export function isDue(task: Pick<ScheduleTaskLike, "nextRunAt">, now: Date): boolean {
  if (!task.nextRunAt) return false;
  const nextRunAt = new Date(task.nextRunAt);
  return !Number.isNaN(nextRunAt.getTime()) && nextRunAt.getTime() <= now.getTime();
}

type ScheduleTaskLike = { nextRunAt?: string };
