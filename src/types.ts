import type { ScheduleDefinition } from "./scheduling.ts";

/** What caused a Task Run: the planned time arriving, or an explicit request. */
export type Trigger = "scheduled" | "manual";

export type RunStatus = "running" | "success" | "error" | "skipped" | "missed";

export type ScheduleTask = {
  id: string;
  name?: string;
  prompt: string;
  schedule: ScheduleDefinition;
  enabled: boolean;
  nextRunAt?: string;
  model?: string;
  thinking?: string;
  cwd?: string;
  tools?: string[];
  createdAt: string;
  updatedAt: string;
};

export type RunRecord = {
  runId: string;
  taskId: string;
  trigger: Trigger;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  exitCode?: number;
  sessionFile?: string;
  summary?: string;
  error?: string;
};
