import { randomBytes } from "node:crypto";
import { calculateNextRun, isDue, parseScheduleInput, type ScheduleInput } from "./scheduling.ts";
import type { ScheduleTask } from "./types.ts";

export interface TaskStore {
  load(): Promise<ScheduleTask[]>;
  save(tasks: ScheduleTask[]): Promise<void>;
}

export interface SchedulerHost {
  isIdle(): boolean;
  confirm?(title: string, body: string): Promise<boolean>;
  sendUserMessage(
    content: string,
    options: { deliverAs: "followUp"; triggerTurn: true },
  ): Promise<void> | void;
  notify?(message: string, level: "info" | "warning" | "error"): void;
  setStatus?(status: string | undefined): void;
}

export type AddTaskInput = {
  id?: string;
  name?: string;
  prompt: string;
  schedule: ScheduleInput;
  scope: "session" | "durable";
  now?: Date;
};

const CLAIM_TIMEOUT_MS = 10 * 60_000;
const MAX_ACTIVE_TASKS = 50;

type SchedulerOptions = {
  store: TaskStore;
  host: SchedulerHost;
  maxActiveTasks?: number;
};

export class Scheduler {
  private readonly tasks = new Map<string, ScheduleTask>();
  private readonly store: TaskStore;
  private readonly host: SchedulerHost;
  private readonly maxActiveTasks: number;
  private started = false;
  private running = false;
  private readonly missedOneShots: ScheduleTask[] = [];

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.host = options.host;
    this.maxActiveTasks = options.maxActiveTasks ?? MAX_ACTIVE_TASKS;
  }

  async start(now = new Date(), recoverMissed = true): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const task of await this.store.load()) {
      if (task.scope !== "durable") continue;
      if (recoverMissed && task.schedule.kind === "once" && isDue(task, now)) {
        task.enabled = false;
        task.lastStatus = "missed";
        task.updatedAt = now.toISOString();
        this.missedOneShots.push(structuredClone(task));
      }
      this.tasks.set(task.id, task);
    }
    if (this.missedOneShots.length > 0) await this.persist();
  }

  missedOneShotTasks(): ScheduleTask[] {
    return this.missedOneShots.map((task) => structuredClone(task));
  }

  async resumeMissedTask(id: string, now = new Date()): Promise<ScheduleTask> {
    const task = this.requireTask(id);
    task.enabled = true;
    task.pending = true;
    task.nextRunAt = now.toISOString();
    task.lastStatus = undefined;
    task.updatedAt = now.toISOString();
    await this.persist();
    return structuredClone(task);
  }

  async reloadDurableTasks(): Promise<void> {
    const sessionTasks = [...this.tasks.values()].filter((task) => task.scope === "session");
    this.tasks.clear();
    for (const task of sessionTasks) this.tasks.set(task.id, task);
    for (const task of await this.store.load()) {
      if (task.scope === "durable") this.tasks.set(task.id, task);
    }
  }

  isExecuting(): boolean {
    return this.running;
  }

  list(): ScheduleTask[] {
    return [...this.tasks.values()]
      .sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""))
      .map((task) => structuredClone(task));
  }

  async add(input: AddTaskInput): Promise<ScheduleTask> {
    const activeCount = [...this.tasks.values()].filter((task) => task.enabled).length;
    if (activeCount >= this.maxActiveTasks) {
      throw new Error(`Maximum active task count (${this.maxActiveTasks}) reached`);
    }
    if (!input.prompt.trim()) throw new Error("Task prompt must not be empty");

    const now = input.now ?? new Date();
    const schedule = parseScheduleInput({ ...input.schedule, scope: input.scope });
    const id = input.id ?? createId("task");
    if (this.tasks.has(id)) throw new Error(`Task already exists: ${id}`);

    const task: ScheduleTask = {
      id,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      prompt: input.prompt.trim(),
      schedule,
      scope: input.scope,
      enabled: true,
      nextRunAt: initialNextRun(schedule, now),
      pending: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      runCount: 0,
    };
    this.tasks.set(id, task);
    await this.persist();
    return structuredClone(task);
  }

  async enable(id: string): Promise<ScheduleTask> {
    const task = this.requireTask(id);
    task.enabled = true;
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(task);
  }

  async disable(id: string): Promise<ScheduleTask> {
    const task = this.requireTask(id);
    task.enabled = false;
    task.pending = false;
    task.claim = undefined;
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(task);
  }

  async delete(id: string): Promise<void> {
    this.requireTask(id);
    this.tasks.delete(id);
    await this.persist();
  }

  async clear(): Promise<number> {
    const count = this.tasks.size;
    this.tasks.clear();
    await this.persist();
    return count;
  }

  async runNow(id: string, now = new Date()): Promise<void> {
    const task = this.requireTask(id);
    task.pending = true;
    task.nextRunAt = now.toISOString();
    task.updatedAt = now.toISOString();
    await this.persist();
    await this.tick(now);
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.started || this.running) return;

    const dueTasks = this.getDueTasks(now);
    if (dueTasks.length === 0) return;

    if (!this.host.isIdle()) {
      for (const task of dueTasks) task.pending = true;
      await this.persist();
      this.host.setStatus?.(`scheduler: ${dueTasks.length} task(s) pending`);
      return;
    }

    const task = dueTasks[0];
    this.running = true;
    const runId = createId("run");
    task.claim = { runId, claimedAt: now.toISOString() };
    task.pending = false;
    task.updatedAt = now.toISOString();
    await this.persist();
    this.host.setStatus?.(`scheduler: running ${task.name ?? task.id}`);

    try {
      await this.host.sendUserMessage(formatScheduledPrompt(task, runId), {
        deliverAs: "followUp",
        triggerTurn: true,
      });
      task.runCount += 1;
      task.lastRunAt = now.toISOString();
      task.lastStatus = "success";
      task.lastError = undefined;
      task.claim = undefined;
      this.removeMissedTask(task.id);
      if (task.schedule.kind === "once") {
        this.tasks.delete(task.id);
      } else {
        task.nextRunAt = calculateNextRun(task.schedule, now)?.toISOString();
        task.updatedAt = now.toISOString();
      }
    } catch (error) {
      task.runCount += 1;
      task.lastRunAt = now.toISOString();
      task.lastStatus = "error";
      task.lastError = error instanceof Error ? error.message : String(error);
      task.claim = undefined;
      task.pending = false;
      task.updatedAt = now.toISOString();
      if (task.schedule.kind === "once") {
        task.enabled = false;
      } else {
        task.nextRunAt = calculateNextRun(task.schedule, now)?.toISOString();
      }
      this.host.notify?.(`Scheduled task ${task.name ?? task.id} failed: ${task.lastError}`, "error");
    } finally {
      this.running = false;
      await this.persist();
      this.host.setStatus?.(undefined);
    }
  }

  private getDueTasks(now: Date): ScheduleTask[] {
    const due: ScheduleTask[] = [];
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      if (task.claim && !isStaleClaim(task.claim.claimedAt, now)) continue;
      if (task.claim) task.claim = undefined;
      if (isDue(task, now)) due.push(task);
    }
    return due.sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""));
  }

  private requireTask(id: string): ScheduleTask {
    const exact = this.tasks.get(id);
    if (exact) return exact;
    const matches = [...this.tasks.values()].filter((task) => task.id.startsWith(id));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Task ID is ambiguous: ${id}`);
    throw new Error(`Task not found: ${id}`);
  }

  private async persist(): Promise<void> {
    await this.store.save([...this.tasks.values()].filter((task) => task.scope === "durable"));
  }

  private removeMissedTask(id: string): void {
    const index = this.missedOneShots.findIndex((task) => task.id === id);
    if (index >= 0) this.missedOneShots.splice(index, 1);
  }
}

function initialNextRun(schedule: ScheduleTask["schedule"], now: Date): string | undefined {
  if (schedule.kind === "once") return schedule.runAt;
  return calculateNextRun(schedule, now)?.toISOString();
}

function formatScheduledPrompt(task: ScheduleTask, runId: string): string {
  return [
    "[Scheduled task]",
    `Task ID: ${task.id}`,
    `Task name: ${task.name ?? "(unnamed)"}`,
    `Run ID: ${runId}`,
    "",
    task.prompt,
  ].join("\n");
}

function isStaleClaim(claimedAt: string, now: Date): boolean {
  const timestamp = new Date(claimedAt).getTime();
  return Number.isNaN(timestamp) || now.getTime() - timestamp >= CLAIM_TIMEOUT_MS;
}

function createId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}
