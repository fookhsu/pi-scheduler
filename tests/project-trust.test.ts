import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTaskSessionTrust } from "../src/agents/pi/trust.ts";

const decided = (decision: boolean | null) => ({ get: () => decision });

async function projectWithResources(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-scheduler-trust-"));
  await mkdir(join(dir, ".pi", "skills"), { recursive: true });
  return dir;
}

test("a project with no trust-requiring resources is trusted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-scheduler-trust-"));
  try {
    assert.equal(resolveTaskSessionTrust({ cwd: dir, trustStore: decided(null) }), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a saved decision wins over the default", async () => {
  const dir = await projectWithResources();
  try {
    assert.equal(resolveTaskSessionTrust({ cwd: dir, trustStore: decided(true) }), true);
    assert.equal(
      resolveTaskSessionTrust({ cwd: dir, trustStore: decided(false), defaultProjectTrust: "always" }),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an undecided project is untrusted unless the default is always", async () => {
  const dir = await projectWithResources();
  try {
    assert.equal(resolveTaskSessionTrust({ cwd: dir, trustStore: decided(null) }), false);
    assert.equal(
      resolveTaskSessionTrust({ cwd: dir, trustStore: decided(null), defaultProjectTrust: "ask" }),
      false,
    );
    assert.equal(
      resolveTaskSessionTrust({ cwd: dir, trustStore: decided(null), defaultProjectTrust: "never" }),
      false,
    );
    assert.equal(
      resolveTaskSessionTrust({ cwd: dir, trustStore: decided(null), defaultProjectTrust: "always" }),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
