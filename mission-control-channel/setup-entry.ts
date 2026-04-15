/**
 * MC Channel Plugin — setup-entry.ts
 *
 * Lightweight entry for setup/disabled mode.
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { missionControlPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(missionControlPlugin);
