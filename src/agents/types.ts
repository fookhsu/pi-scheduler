import type { RunRecord, ScheduleTask } from "../types.ts";

/** A Task Run handed to an agent adapter: what to run, where, and why. */
export type AgentRunRequest = {
  task: ScheduleTask;
  run: RunRecord;
  projectDir: string;
};

/** What an agent adapter reports back after driving one Task Run. */
export type AgentRunResult = {
  /** Path to the agent's own session record, when that agent writes one. */
  sessionFile?: string;
  /** Short human-readable outcome, e.g. the agent's final message. */
  summary?: string;
};

/**
 * Agent Adapter: drives one Task Run in a concrete agent runtime (Pi, Codex,
 * ...). An adapter owns everything runtime-specific — process or SDK startup,
 * session creation, model resolution, credentials — and nothing else. The
 * scheduler core owns scheduling, storage, locking, and run records, so adding
 * an agent means adding an adapter, not touching the core.
 */
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
