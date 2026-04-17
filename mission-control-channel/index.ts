/**
 * Mission Control Channel Plugin for OpenClaw
 *
 * Architecture note: Uses `definePluginEntry` (not `defineChannelPluginEntry`)
 * to avoid a bug in OpenClaw's channel plugin architecture where `registerFull()`
 * is not called for channel plugins unless their channel is configured in
 * cfg.channels with meaningful config (non-enabled keys).
 *
 * Inbound: MC webhook → recordInboundSession → agent session
 * Outbound: agent message → MC channel → mc.addComment()
 */
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { missionControlPlugin } from "./src/channel.js";
import { DEFAULT_ROUTING } from "./src/types.js";

// ─── Inbound event handler ───────────────────────────────────────────────────

function buildEventPrompt(event: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}): string {
  const task = event.task ?? {};
  switch (event.event_type) {
    case "task.assigned":
      return `[Mission Control] Task assigned to ${task.assignee}: "${task.title}" (${task.status})\nPriority: ${task.priority ?? "none"}\nDescription: ${task.description ?? "(none)"}\n\nPlease acknowledge and begin work.`;
    case "task.updated":
      return `[Mission Control] Task updated: "${event.task.title}" — now ${event.task.status}`;
    case "task.completed":
      return `[Mission Control] Task completed: "${event.task.title}"`;
    case "task.comment":
      return `[Mission Control] New comment on task "${event.task.title}" by ${event.actor}:\n${event.comment?.body ?? ""}`;
    default:
      return `[Mission Control] Event: ${event.event_type} on task "${event.task.title}" (${event.task.id})`;
  }
}

function resolveAgentSessionKey(assignee: string | null): string | null {
  if (!assignee) return null;
  const entry = DEFAULT_ROUTING[assignee];
  if (entry) return entry.sessionKey;
  // Fallback: try "agent:<assignee>:main"
  return `agent:${assignee}:main`;
}

// ─── Plugin entry point ─────────────────────────────────────────────────────

export default definePluginEntry({
  id: "mission-control",
  name: "Mission Control",
  description: "Mission Control channel plugin for OpenClaw — MC as a native channel",
  // Config schema is defined in openclaw.plugin.json — configSchema here is optional override
  async register(api) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = (api.pluginConfig ?? {}) as {
      mcUrl?: string;
      agentToken?: string;
      webhookPath?: string;
    };
    const mcUrl = cfg?.mcUrl;
    const agentToken = cfg?.agentToken;
    const webhookPath = cfg?.webhookPath ?? "/mc/webhook";

    if (!mcUrl || !agentToken) {
      api.logger?.warn(
        "[mission-control] Missing mcUrl or agentToken in plugin config — webhook handler will not be available"
      );
      return;
    }

    // Build auth header for MC API calls
    const authHeader = `Bearer ${agentToken}`;

    api.registerHttpRoute({
      path: webhookPath,
      auth: "plugin",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return true;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reqBody = (req as any).body;
        let body: unknown;
        try {
          body = JSON.parse(reqBody ?? "{}");
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return true;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const event = body as any;

        if (!event.event_type || !event.task_id) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Missing event_type or task_id" }));
          return true;
        }

        api.logger?.info(`[mission-control] Webhook: ${event.event_type} task=${event.task_id}`);

        // Echo-loop prevention: skip events from our own outbound (actor is the agent)
        const selfActors = new Set(["alex", "monica", "quinn", "bladerunner2020"]);
        const actor = event.actor ?? "";
        if (selfActors.has(actor.toLowerCase())) {
          api.logger.debug?.(`[mission-control] Skipping echo event from ${actor}`);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, skipped: "echo" }));
          return true;
        }

        try {
          // Resolve target session key from task assignee
          const sessionKey = resolveAgentSessionKey(event.task?.assignee);
          if (!sessionKey) {
            api.logger?.warn(`[mission-control] No routing for assignee: ${event.task?.assignee}`);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, reason: "no routing" }));
            return true;
          }

          const prompt = buildEventPrompt(event);

          // Deliver event to agent session via recordInboundSession
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const runtime = (api as any).runtime;
          if (!(runtime && runtime.channel && runtime.channel.session)) {
            api.logger?.error("[mission-control] runtime.channel.session not available");
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "runtime not available" }));
            return true;
          }

          const ctx = {
            SessionKey: sessionKey,
            MessageId: `mc-${event.task_id}-${Date.now()}`,
            SenderId: "mission-control",
            SenderLabel: "Mission Control",
            Text: prompt,
            TimestampMs: Date.now(),
            Channel: "mission-control" as const,
            Surface: "mission-control" as const,
            Provider: "mission-control" as const,
            OriginatingChannel: "mission-control" as const,
            OriginatingTo: event.task_id,
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (runtime.channel.session as any).recordInboundSession({
            storePath: `plugins/mission-control/${event.task_id}`,
            sessionKey,
            ctx,
            createIfMissing: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onRecordError: (err: any) => {
              api.logger?.error(`[mission-control] recordInboundSession error: ${err}`);
            },
          });

          api.logger?.info(`[mission-control] Delivered ${event.event_type} to ${sessionKey}`);
        } catch (err) {
          api.logger?.error(`[mission-control] Error handling webhook: ${err}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal server error" }));
          return true;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return true;
      },
    });

    api.logger?.info(`[mission-control] HTTP webhook route registered at ${webhookPath}`);

    // Initialize the channel plugin for outbound message handling.
    // missionControlPlugin is a Promise (result of createChatChannelPlugin called at module load).
    // Await it then call the resolved plugin config's register if present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcPlugin = await missionControlPlugin as any;
    if (mcPlugin?.register) {
      await mcPlugin.register(api);
    }
  },
});
