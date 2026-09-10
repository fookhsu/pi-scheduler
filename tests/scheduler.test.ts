import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler, type SchedulerHost, type TaskStore } from "../src/scheduler.ts";
import type { ScheduleTask } from "../src/types.ts";

class MemoryStore implements TaskStore {
  tasks: ScheduleTask[] = [];
  async load() { return structuredClone(this.tasks); }
  async save(tasks: ScheduleTask[]) { this.tasks = structuredClone(tasks); }
}

class FakeHost implements SchedulerHost {
  idle = true;
  sent: string[] = [];
  isIdle() { return this.idle; }
  async sendUserMessage(content: string) { this.sent.push(content); }
  notify() {}
}

const now = new Date("2026-09-01T10:00:00.000Z");

test("runs a due recurring task and advances its next run", async () => {
  const host = new FakeHost();
  const scheduler = new Scheduler({ store: new MemoryStore(), host });
  await scheduler.start();
  const created = await scheduler.add({
    name: "check-ci",
    prompt: "Check CI",
    schedule: { kind: "interval", every: "5m", scope: "durable" },
    scope: "durable",
    now,
  });

  await scheduler.tick(new Date("2026-09-01T10:05:00.000Z"));

  assert.equal(host.sent.length, 1);
  assert.match(host.sent[0], /Check CI/);
  assert.match(host.sent[0], new RegExp(created.id));
  assert.equal(scheduler.list()[0].runCount, 1);
  assert.equal(scheduler.list()[0].lastStatus, "success");
  assert.equal(scheduler.list()[0].nextRunAt, "2026-09-01T10:10:00.000Z");
});

test("keeps one pending run while Pi is busy", async () => {
  const host = new FakeHost();
  const scheduler = new Scheduler({ store: new MemoryStore(), host });
  await scheduler.start();
  await scheduler.add({
    prompt: "Run once",
    schedule: { kind: "once", runAt: "2026-09-01T10:01:00.000Z", scope: "session" },
    scope: "session",
    now,
  });

  host.idle = false;
  await scheduler.tick(new Date("2026-09-01T10:02:00.000Z"));
  assert.equal(host.sent.length, 0);
  assert.equal(scheduler.list()[0].pending, true);

  host.idle = true;
  await scheduler.tick(new Date("2026-09-01T10:03:00.000Z"));
  assert.equal(host.sent.length, 1);
  assert.equal(scheduler.list().length, 0);
});

test("does not retry a failed one-shot task automatically", async () => {
  const host = new FakeHost();
  host.sendUserMessage = async () => { throw new Error("provider unavailable"); };
  const scheduler = new Scheduler({ store: new MemoryStore(), host });
  await scheduler.start();
  await scheduler.add({
    prompt: "Run once",
    schedule: { kind: "once", runAt: "2026-09-01T10:01:00.000Z", scope: "durable" },
    scope: "durable",
    now,
  });

  await scheduler.tick(new Date("2026-09-01T10:01:00.000Z"));
  const task = scheduler.list()[0];
  assert.equal(task.lastStatus, "error");
  assert.match(task.lastError ?? "", /provider unavailable/);
  assert.equal(task.enabled, false);
});

test("moves a failed recurring task to its next cycle", async () => {
  const host = new FakeHost();
  host.sendUserMessage = async () => { throw new Error("provider unavailable"); };
  const scheduler = new Scheduler({ store: new MemoryStore(), host });
  await scheduler.start();
  await scheduler.add({
    prompt: "Check later",
    schedule: { kind: "interval", every: "5m", scope: "session" },
    scope: "session",
    now,
  });

  await scheduler.tick(new Date("2026-09-01T10:05:00.000Z"));
  assert.equal(scheduler.list()[0].lastStatus, "error");
  assert.equal(scheduler.list()[0].nextRunAt, "2026-09-01T10:10:00.000Z");
});

test("marks missed one-shot tasks and allows explicit recovery", async () => {
  const host = new FakeHost();
  const store = new MemoryStore();
  const scheduler = new Scheduler({ store, host });
  await scheduler.start(new Date("2026-09-01T11:00:00.000Z"));
  await scheduler.add({
    prompt: "Missed task",
    schedule: { kind: "once", runAt: "2026-09-01T10:00:00.000Z", scope: "durable" },
    scope: "durable",
    now: new Date("2026-08-01T10:00:00.000Z"),
  });

  const restarted = new Scheduler({ store, host });
  await restarted.start(new Date("2026-09-01T11:00:00.000Z"));
  assert.equal(restarted.list()[0].lastStatus, "missed");
  assert.equal(restarted.list()[0].enabled, false);
  assert.equal(restarted.missedOneShotTasks().length, 1);
  await restarted.resumeMissedTask(restarted.list()[0].id, new Date("2026-09-01T11:01:00.000Z"));
  await restarted.tick(new Date("2026-09-01T11:01:00.000Z"));
  assert.equal(host.sent.length, 1);
});

test("runs a task immediately when requested and idle", async () => {
  const host = new FakeHost();
  const scheduler = new Scheduler({ store: new MemoryStore(), host });
  await scheduler.start();
  const task = await scheduler.add({
    prompt: "Run now",
    schedule: { kind: "interval", every: "5m", scope: "session" },
    scope: "session",
    now,
  });
  await scheduler.runNow(task.id, now);
  assert.equal(host.sent.length, 1);
});
