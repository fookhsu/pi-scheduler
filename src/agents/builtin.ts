import { registerAgent } from "./registry.ts";

/**
 * Composition root for built-in adapters. Importing this module only records
 * lazy loaders, so no agent SDK is imported until a run actually resolves it.
 */
registerAgent("pi", "Pi", async () => {
  const { createPiAdapter } = await import("./pi/adapter.ts");
  return createPiAdapter();
});
