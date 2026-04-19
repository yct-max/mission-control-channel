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
  agentToken: string;
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
  if (!config?.mcUrl) {
    throw new Error("mission-control: mcUrl is required in plugins.entries.mission-control.config");
  }

  // Support legacy single agentToken + new per-agent agents{} map
  const legacyToken = (config.agentToken as string | undefined) ?? "";
  const agentsConfig = (config.agents as Record<string, { token?: string }> | undefined) ?? {};

  // Build routing table with per-agent tokens merged in
  const routing: AgentRoutingTable = { ...DEFAULT_ROUTING };
  for (const [name, agentCfg] of Object.entries(agentsConfig)) {
    if (routing[name] && agentCfg?.token) {
      routing[name] = { ...routing[name], token: agentCfg.token };
    }
  }

  // If no per-agent config, use legacy single token for all agents
  if (Object.keys(agentsConfig).length === 0 && legacyToken) {
    for (const entry of Object.values(routing)) {
      entry.token = legacyToken;
    }
  }

  const resolvedAccountId = (accountId ?? "default") as string;
  // Look up token for this accountId (agent name)
  const routingEntry = routing[resolvedAccountId];
  const agentToken = routingEntry?.token ?? legacyToken;

  if (!agentToken) {
    throw new Error(`mission-control: no token found for agent '${resolvedAccountId}' — set agents.${resolvedAccountId}.token or agentToken in plugin config`);
  }

  return {
    accountId: resolvedAccountId,
    mcUrl: config.mcUrl as string,
    agentToken,
    webhookPath: (config.webhookPath as string | undefined) ?? "/mc/webhook",
    routing,
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
          enabled: Boolean(config?.mcUrl && config.agentToken),
          configured: Boolean(config?.mcUrl && config.agentToken),
          tokenStatus: config?.agentToken ? "available" : "missing",
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
      async sendText({ cfg, to, text, accountId, sessionKey }: any) {
        // Extract agent name from sessionKey (format: "agent:<name>:main")
        const agentName = (sessionKey ?? accountId ?? "default")
          .toString()
          .split(":")[1]
          ?? accountId
          ?? "default";
        const account = resolveMcAccount(cfg, agentName);
        const taskId = String(to)?.startsWith("task:")
          ? String(to).slice(5)
          : String(to);
        if (!taskId) throw new Error("mission-control: missing task_id in target");

        const mc = createMcClient({ baseUrl: account.mcUrl, agentToken: account.agentToken });
        const comment = await mc.addComment(taskId, text);
        return { messageId: String(comment.id), chatId: taskId };
      },
    },
  },


});
