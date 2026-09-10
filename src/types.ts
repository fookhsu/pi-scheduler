import type { ScheduleDefinition, TaskScope } from "./scheduling.ts";

export type TaskStatus = "success" | "error" | "missed" | "skipped";

export type TaskClaim = {
  runId: string;
  claimedAt: string;
};

export type ScheduleTask = {
  id: string;
  name?: string;
  prompt: string;
  schedule: ScheduleDefinition;
  scope: TaskScope;
  enabled: boolean;
  nextRunAt?: string;
  pending: boolean;
  claim?: TaskClaim;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunAt?: string;
  lastStatus?: TaskStatus;
  lastError?: string;
};
