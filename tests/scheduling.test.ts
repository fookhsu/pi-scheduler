import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateNextRun,
  parseDuration,
  parseScheduleInput,
} from "../src/scheduling.ts";

test("parses compact durations", () => {
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("5m"), 300_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("1 day"), 86_400_000);
});

test("rejects invalid or sub-minute durable durations", () => {
  assert.throws(() => parseDuration("nope"), /duration/i);
  assert.throws(() => parseScheduleInput({ kind: "interval", every: "30s", scope: "durable" }), /minute/i);
});

test("calculates once and interval schedules", () => {
  const now = new Date("2026-09-01T10:00:00.000Z");
  assert.equal(
    calculateNextRun(
      parseScheduleInput({ kind: "once", runAt: "2026-09-01T11:00:00.000Z" }),
      now,
    )?.toISOString(),
    "2026-09-01T11:00:00.000Z",
  );
  assert.equal(
    calculateNextRun(
      parseScheduleInput({ kind: "interval", every: "5m", scope: "session" }),
      now,
    )?.toISOString(),
    "2026-09-01T10:05:00.000Z",
  );
});

test("calculates five-field cron schedules", () => {
  const now = new Date("2026-09-01T10:01:00.000Z");
  assert.equal(
    calculateNextRun(
      parseScheduleInput({ kind: "cron", expression: "*/5 * * * *", scope: "durable" }),
      now,
    )?.toISOString(),
    "2026-09-01T10:05:00.000Z",
  );
});
