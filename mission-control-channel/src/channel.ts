/**
 * MC Channel Plugin — channel.ts
 *
 * Mission Control as a first-class OpenClaw channel.
 *
 * Architecture:
 * - Outbound: agent message(to=task:<id>) → MC API (add task comment)
 * - Inbound: MC POSTs to /mc/webhook → recordInboundSession → agent session
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
} from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { createMcClient } from "./client.js";
import type { AgentRoutingTable } from "./types.js";
import { DEFAULT_ROUTING } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McChannelAccount {
  accountId: string;
  mcUrl: string;
  apiKey: string;
  webhookPath: string;
  routing: AgentRoutingTable;
}

// ─── Config Resolution ───────────────────────────────────────────────────────

export function resolveMcAccount(cfg: OpenClawConfig, accountId?: string | null): McChannelAccount {
  // Config lives at cfg.plugins.entries["mission-control"].config
  const section = (
    (cfg as Record<string, unknown>)?.plugins as Record<string, unknown>
  )?.entries as Record<string, Record<string, unknown>> | undefined;
  const pluginCfg = section?.["mission-control"] as Record<string, unknown> | undefined;
  const config = pluginCfg?.config as Record<string, unknown> | undefined;
  if (!config?.mcUrl || !config.apiKey) {
    throw new Error("mission-control: mcUrl and apiKey are required in plugins.entries.mission-control.config");
  }
  return {
    accountId: (accountId ?? "default") as string,
    mcUrl: config.mcUrl as string,
    apiKey: config.apiKey as string,
    webhookPath: (config.webhookPath as string | undefined) ?? "/mc/webhook",
    routing: {
      ...DEFAULT_ROUTING,
      ...((config.routing as Record<string, unknown>) ?? {}),
    } as AgentRoutingTable,
  };
}

// ─── Plugin ────────────────────────────────────────────────────────────────

export const missionControlPlugin = createChatChannelPlugin({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: createChannelPluginBase({
    id: "mission-control",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setup: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveAccount: resolveMcAccount as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inspectAccount: ((cfg: OpenClawConfig, accountId?: string | null) => {
        const section = (
          (cfg as Record<string, unknown>)?.plugins as Record<string, unknown>
        )?.entries as Record<string, Record<string, unknown>> | undefined;
        const pluginCfg = section?.["mission-control"] as Record<string, unknown> | undefined;
        const config = pluginCfg?.config as Record<string, unknown> | undefined;
        return {
          enabled: Boolean(config?.mcUrl && config.apiKey),
          configured: Boolean(config?.mcUrl && config.apiKey),
          tokenStatus: config?.apiKey ? "available" : "missing",
        };
      }) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    capabilities: {
      chatTypes: ["direct"],
      reactions: false,
      threads: false,
      media: false,
      nativeCommands: false,
      blockStreaming: true,
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any,

  // M2M auth — no user pairing
  security: {
    dm: {
      channelKey: "mission-control",
      resolvePolicy: () => "allowlist",
      resolveAllowFrom: () => [],
      defaultPolicy: "deny",
    },
  },

  // One session per task
  threading: {
    topLevelReplyToMode: "channel",
  },

  outbound: {
    base: {
      deliveryMode: "direct",
    },
    attachedResults: {
      channel: "mission-control",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async sendText({ cfg, to, text, accountId }: any) {
        const account = resolveMcAccount(cfg, accountId ?? null);
        const taskId = String(to)?.startsWith("task:")
          ? String(to).slice(5)
          : String(to);
        if (!taskId) throw new Error("mission-control: missing task_id in target");

        const mc = createMcClient({ baseUrl: account.mcUrl, apiKey: account.apiKey });
        const comment = await mc.addComment(taskId, text);
        return { messageId: String(comment.id), chatId: taskId };
      },
    },
  },


});
