/**
 * MC Channel Plugin — runtime.ts
 *
 * Runtime store for the MC channel plugin.
 * Stores the runtime reference so it can be accessed from the webhook handler.
 */

import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

export const setMcChannelRuntime = createPluginRuntimeStore<PluginRuntime>(
  "mc-channel runtime not initialized",
);

export function getMcChannelRuntime() {
  return setMcChannelRuntime.getRuntime();
}

export function tryGetMcChannelRuntime() {
  return setMcChannelRuntime.tryGetRuntime();
}
