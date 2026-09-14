import type { DefaultProjectTrust } from "@earendil-works/pi-coding-agent";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";

export type TaskSessionTrustInput = {
  cwd: string;
  /** Saved per-folder decisions, normally `~/.pi/agent/trust.json`. */
  trustStore: Pick<ProjectTrustStore, "get">;
  defaultProjectTrust?: DefaultProjectTrust;
};

/**
 * Project trust for a Task Session. A Task Session is always headless — the
 * Task Runner is invoked by cron — so there is never a human to answer the
 * trust prompt: a folder with project resources is trusted only when a saved
 * decision or an explicit `always` says so.
 *
 * This mirrors Pi's own resolver (`dist/core/project-trust.js`), which the
 * package does not export. One deliberate difference: the `project_trust`
 * extension event is not emitted, so project extensions cannot vote here — a
 * project extension must not be able to widen its own trust.
 */
export function resolveTaskSessionTrust(input: TaskSessionTrustInput): boolean {
  if (!hasTrustRequiringProjectResources(input.cwd)) return true;

  const decision = input.trustStore.get(input.cwd);
  if (decision !== null) return decision;

  return input.defaultProjectTrust === "always";
}
