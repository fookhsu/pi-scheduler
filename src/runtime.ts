import { mkdir } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { acquireLock, type SchedulerLock } from "./lock.ts";
import { Scheduler, type SchedulerHost } from "./scheduler.ts";
import { FileTaskStore } from "./storage.ts";

const TASK_FILE = "scheduler.json";
const LOCK_FILE = "scheduler.lock";

export class SchedulerRuntime {
  private scheduler?: Scheduler;
  private lock?: SchedulerLock;
  private timer?: ReturnType<typeof setInterval>;
  private watcher?: FSWatcher;
  private reloadTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly pi: ExtensionAPI) {}

  async start(ctx: ExtensionContext): Promise<void> {
    if (this.scheduler) return;

    const configDir = join(ctx.cwd, CONFIG_DIR_NAME);
    await mkdir(configDir, { recursive: true });
    const taskPath = join(configDir, TASK_FILE);
    const lockPath = join(configDir, LOCK_FILE);
    const host: SchedulerHost = {
      isIdle: () => ctx.isIdle(),
      confirm: (title, body) => ctx.ui.confirm(title, body),
      sendUserMessage: (content, options) => this.pi.sendUserMessage(content, options),
      notify: (message, level) => {
        if (ctx.hasUI) ctx.ui.notify(message, level);
      },
      setStatus: (status) => ctx.ui.setStatus("pi-scheduler", status),
    };

    this.scheduler = new Scheduler({
      store: new FileTaskStore(taskPath),
      host,
    });

    this.lock = await acquireLock(lockPath);
    await this.scheduler.start(new Date(), Boolean(this.lock));
    if (!this.lock) {
      if (ctx.hasUI) {
        ctx.ui.notify("Another Pi instance owns the scheduler; task management remains available.", "warning");
      }
      return;
    }

    for (const task of this.scheduler.missedOneShotTasks()) {
      const shouldRun = ctx.hasUI && await ctx.ui.confirm(
        "Run missed scheduled task?",
        `${task.name ?? task.id} was due at ${task.nextRunAt ?? "an unknown time"}. Run it now?`,
      );
      if (shouldRun) await this.scheduler.resumeMissedTask(task.id);
    }

    this.timer = setInterval(() => {
      void this.scheduler?.tick();
    }, 1_000);

    this.watcher = watch(configDir, (_event, filename) => {
      if (filename?.toString() !== TASK_FILE || !this.scheduler) return;
      clearTimeout(this.reloadTimer);
      const reload = () => {
        if (!this.scheduler) return;
        if (this.scheduler.isExecuting()) {
          this.reloadTimer = setTimeout(reload, 100);
          return;
        }
        void this.scheduler.reloadDurableTasks().catch((error) => {
          if (ctx.hasUI) ctx.ui.notify(`Failed to reload scheduler tasks: ${String(error)}`, "error");
        });
      };
      this.reloadTimer = setTimeout(reload, 50);
    });
    this.watcher.on("error", (error) => {
      if (ctx.hasUI) ctx.ui.notify(`Scheduler watcher error: ${String(error)}`, "error");
    });
  }

  getScheduler(): Scheduler {
    if (!this.scheduler) throw new Error("Scheduler is not ready yet");
    return this.scheduler;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.watcher?.close();
    await this.lock?.release();
    this.timer = undefined;
    this.reloadTimer = undefined;
    this.watcher = undefined;
    this.lock = undefined;
    this.scheduler = undefined;
  }
}
