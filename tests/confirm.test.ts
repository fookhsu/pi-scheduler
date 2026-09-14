import test from "node:test";
import assert from "node:assert/strict";
import { confirmMutation } from "../src/agents/pi/confirm.ts";

test("refuses to mutate when there is no UI to ask", async () => {
  const error = await confirmMutation(
    { hasUI: false, ui: { confirm: async () => true } },
    "Delete scheduled task?",
  ).catch((caught: unknown) => caught);

  assert.ok(error instanceof Error);
  assert.match(error.message, /interactive confirmation/);
});

test("aborts the mutation when the user declines", async () => {
  const error = await confirmMutation(
    { hasUI: true, ui: { confirm: async () => false } },
    "Delete scheduled task?",
  ).catch((caught: unknown) => caught);

  assert.ok(error instanceof Error);
  assert.match(error.message, /cancelled/);
});

test("asks with the given message and proceeds on approval", async () => {
  const asked: string[] = [];
  await confirmMutation(
    {
      hasUI: true,
      ui: {
        confirm: async (_title, message) => {
          asked.push(message);
          return true;
        },
      },
    },
    "Delete scheduled task task_123?",
  );

  assert.deepEqual(asked, ["Delete scheduled task task_123?"]);
});
