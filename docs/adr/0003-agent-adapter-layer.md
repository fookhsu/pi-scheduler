# ADR 0003: Agent adapter layer

- Status: Accepted
- Date: 2026-09-12

## Context

ADR 0002 put the Pi SDK inside the Task Runner: every run was created by Pi-specific code in `src/executor.ts`. But the scheduler's own job — scheduling, storage, locking, run records — has nothing to do with which agent executes the prompt, and a user may want scheduled work to run in more than one agent runtime. Keeping the SDK inline also made Pi a hard import for the cron CLI, so the package could not run without it.

## Decision

Introduce an agent adapter layer:

- An `AgentAdapter` (`src/agents/types.ts`) drives one Task Run in a concrete runtime — session creation, model resolution, credentials. Its contract is `run(request): Promise<AgentRunResult>`.
- An `AgentRegistry` (`src/agents/registry.ts`) resolves an agent id to its adapter. Adapters register lazily, so an unused agent SDK is never imported, and the first registered adapter is the default.
- The Task Runner depends on the registry, never on an SDK. A task may name its `agent`; otherwise the runner uses the invocation's default (`--agent`).
- All Pi-specific code moves under `src/agents/pi/`: the SDK adapter plus the extension, tools, and slash commands.
- A `RunRecord` records the `agent` that drove the run.

## Consequences

The core is agent-agnostic and testable with a fake adapter. Adding an agent is a folder plus one `registerAgent` line, with no change to the runner, stores, CLI, or Pi surface. Pi becomes an optional peer dependency rather than a requirement of the CLI.

## Alternatives considered

- **Keep the Pi-only executor and fork per agent**: duplicates the runner, storage, and CLI for each agent.
- **A generic adapter that shells out to an agent CLI**: loses the session file and structured summary, and reintroduces arbitrary shell execution, which the plugin forbids.
