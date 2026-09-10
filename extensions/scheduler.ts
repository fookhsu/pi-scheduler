import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "../src/commands.ts";
import { SchedulerRuntime } from "../src/runtime.ts";
import { registerTools } from "../src/tools.ts";

export default function (pi: ExtensionAPI): void {
  const runtime = new SchedulerRuntime(pi);
  registerCommands(pi, runtime);
  registerTools(pi, runtime);

  pi.on("session_start", async (_event, ctx) => {
    try {
      await runtime.start(ctx);
    } catch (error) {
      await runtime.stop();
      if (ctx.hasUI) ctx.ui.notify(`Failed to start scheduler: ${String(error)}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    await runtime.stop();
  });
}
