/** The slice of a Pi UI context that a confirmation needs. */
export type ConfirmContext = {
  hasUI: boolean;
  ui: { confirm(title: string, message: string): Promise<boolean> };
};

/**
 * Gate a persistent mutation behind one interactive confirmation. Headless
 * callers (cron, SDK, RPC without a dialog) have nobody to ask, so they refuse
 * rather than assume consent.
 */
export async function confirmMutation(ctx: ConfirmContext, message: string): Promise<void> {
  if (!ctx.hasUI) throw new Error("This persistent mutation requires interactive confirmation");
  if (!(await ctx.ui.confirm("Confirm scheduler change", message))) {
    throw new Error("Scheduler change cancelled");
  }
}
