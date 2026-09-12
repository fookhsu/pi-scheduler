import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { sessionFileFor, schedulerPaths } from "../../paths.ts";
import type { RunRecord, ScheduleTask } from "../../types.ts";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../types.ts";
import { TASK_SESSION_ENV } from "./env.ts";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Agent adapter for Pi: one fresh, isolated Pi session per Task Run. */
export function createPiAdapter(): AgentAdapter {
  return {
    id: "pi",
    displayName: "Pi",
    run: runInTaskSession,
  };
}

async function runInTaskSession({
  task,
  run,
  projectDir,
}: AgentRunRequest): Promise<AgentRunResult> {
  const cwd = task.cwd ? resolve(projectDir, task.cwd) : projectDir;
  const sessionFile = sessionFileFor(schedulerPaths(projectDir), task.id, run.runId);
  const sessionManager = SessionManager.open(sessionFile, dirname(sessionFile), cwd);

  const modelRuntime = task.model ? await ModelRuntime.create() : undefined;
  let model;
  let thinkingLevel = task.thinking as ThinkingLevel | undefined;
  if (task.model && modelRuntime) {
    const resolved = resolveCliModel({ cliModel: task.model, modelRuntime });
    if (resolved.error || !resolved.model) {
      throw new Error(resolved.error ?? `Could not resolve model: ${task.model}`);
    }
    model = resolved.model;
    thinkingLevel = thinkingLevel ?? resolved.thinkingLevel;
  }
  if (thinkingLevel && !THINKING_LEVELS.includes(thinkingLevel)) {
    throw new Error(`Unknown thinking level: ${thinkingLevel}`);
  }

  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });

  // Set before reload(): extension factories run while resources load, and the
  // scheduler extension must stay inert inside its own Task Session.
  const previous = process.env[TASK_SESSION_ENV];
  process.env[TASK_SESSION_ENV] = "1";
  try {
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      sessionManager,
      resourceLoader,
      ...(modelRuntime ? { modelRuntime } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(task.tools?.length ? { tools: task.tools } : {}),
    });

    try {
      await session.prompt(formatPrompt(task, run));
      const file = session.sessionFile ?? sessionFile;
      await chmod(file, 0o600).catch(() => undefined);
      return {
        sessionFile: file,
        summary: lastAssistantText(session.messages),
      };
    } finally {
      session.dispose();
    }
  } finally {
    if (previous === undefined) delete process.env[TASK_SESSION_ENV];
    else process.env[TASK_SESSION_ENV] = previous;
  }
}

function formatPrompt(task: ScheduleTask, run: RunRecord): string {
  return [
    "[Scheduled task]",
    `Task ID: ${task.id}`,
    `Task name: ${task.name ?? "(unnamed)"}`,
    `Run ID: ${run.runId}`,
    "",
    task.prompt,
  ].join("\n");
}

function lastAssistantText(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown };
    if (message.role !== "assistant") continue;
    const text = contentToText(message.content);
    if (text) return text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
  }
  return undefined;
}

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((part): part is { type: "text"; text: string } => {
      return (
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      );
    })
    .map((part) => part.text);
  return parts.length ? parts.join("\n") : undefined;
}
