#!/usr/bin/env node
"use strict";
/**
 * MC → OpenClaw Webhook Ingress
 *
 * Receives task lifecycle events from Mission Control via HTTP POST webhooks,
 * resolves the target agent session, and delivers a compact task context message.
 *
 * Architecture options:
 *   Option A (default): Relay via Discord channel → OpenClaw → agent session
 *   Option B: Direct WebSocket client to OpenClaw Gateway (cleaner, more complex)
 *
 * Usage:
 *   MC_WEBHOOK_SECRET=... DISCORD_BOT_TOKEN=... node dist/index.js
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const crypto_1 = require("crypto");
// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '9477', 10);
const MC_WEBHOOK_SECRET = process.env.MC_WEBHOOK_SECRET ?? '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
// ─── Routing ─────────────────────────────────────────────────────────────────
// Map agent names → Discord channel ID or session key
const AGENT_ROUTING = {
    alex: process.env.ALEX_DISCORD_CHANNEL_ID ?? '',
    monica: process.env.MONICA_DISCORD_CHANNEL_ID ?? '',
    quinn: process.env.QUINN_DISCORD_CHANNEL_ID ?? '',
};
// Fallback: route all to a shared alerts channel
const FALLBACK_CHANNEL_ID = process.env.DISCORD_ALERTS_CHANNEL_ID ?? '';
// ─── Echo Prevention ─────────────────────────────────────────────────────────
// Track last processed event_id per task (simple in-memory dedup)
// MC event_id is a monotonically increasing integer
const lastProcessedEventSeq = new Map();
const PROCESSED_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Note: MC doesn't currently expose event_id in the webhook payload.
// This function uses task_id + event_type as a proxy for deduplication.
// TODO: once MC adds event_id to the webhook payload, update to use actual event_id.
function markEventProcessed(taskId) {
    lastProcessedEventSeq.set(taskId, Date.now());
    setTimeout(() => lastProcessedEventSeq.delete(taskId), PROCESSED_TTL_MS);
}
function wasRecentlyProcessed(taskId, eventType) {
    const last = lastProcessedEventSeq.get(taskId);
    if (last === undefined)
        return false;
    // Very rough dedup: if the same event type arrived within the TTL window, skip it
    // This prevents rapid duplicate webhooks from MC retry logic
    return true; // placeholder: always process for now until event_id is available
}
function isAgentWriteback(event) {
    // Agent-generated events have actor prefixed with "agent:"
    const actor = event.actor ?? '';
    if (actor.startsWith('agent:'))
        return true;
    // If the actor is the same as the assignee and it's a write-back event type, skip
    const writebackEvents = ['task.comment', 'task.status_changed', 'task.progress_updated'];
    if (writebackEvents.includes(event.event_type) && actor === event.task.assignee) {
        return true;
    }
    return false;
}
// ─── Context Formatting ────────────────────────────────────────────────────────
function formatTaskContext(event) {
    const task = event.task;
    let body = `📋 Task update: ${event.event_type}\n`;
    body += `**${task.title}**\n`;
    body += `Status: ${task.status} | Priority: ${task.priority ?? 'none'}`;
    if (task.description) {
        body += `\nDescription: ${task.description.slice(0, 200)}${task.description.length > 200 ? '...' : ''}`;
    }
    body += `\nID: \`${task.id}\``;
    if (event.comment) {
        body += `\n\n💬 Comment: ${event.comment.body.slice(0, 300)}`;
    }
    body += `\n\nRespond with HEARTBEAT_OK to acknowledge.`;
    return body;
}
// ─── Discord Relay (Option A) ────────────────────────────────────────────────
async function sendDiscordMessage(channelId, content) {
    if (!DISCORD_BOT_TOKEN || !channelId) {
        console.warn('[bridge] Discord not configured, skipping delivery');
        return;
    }
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Discord API error ${response.status}: ${text}`);
    }
}
// ─── Event Processing ────────────────────────────────────────────────────────
async function processEvent(event) {
    // 1. Echo prevention + dedup
    if (isAgentWriteback(event)) {
        console.log(`[bridge] Skipping agent write-back event: ${event.event_type} on ${event.task_id}`);
        return;
    }
    if (wasRecentlyProcessed(event.task_id, event.event_type)) {
        console.log(`[bridge] Skipping duplicate event: ${event.event_type} on ${event.task_id}`);
        return;
    }
    markEventProcessed(event.task_id);
    // 2. Determine target channel
    const assignee = event.task.assignee;
    const channelId = (assignee ? AGENT_ROUTING[assignee] : null) ?? FALLBACK_CHANNEL_ID;
    if (!channelId) {
        console.warn(`[bridge] No routing target for assignee: ${assignee}, task: ${event.task_id}`);
        return;
    }
    // 3. Format and deliver
    const message = formatTaskContext(event);
    await sendDiscordMessage(channelId, message);
    console.log(`[bridge] Delivered ${event.event_type} for task ${event.task_id} → ${assignee ?? 'unassigned'}`);
}
// ─── HTTP Server ─────────────────────────────────────────────────────────────
function verifySignature(body, signature) {
    if (!MC_WEBHOOK_SECRET)
        return true; // No secret configured
    if (!signature)
        return false;
    const expected = (0, crypto_1.createHmac)('sha256', MC_WEBHOOK_SECRET).update(body).digest('hex');
    return `sha256=${expected}` === signature;
}
const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/mc') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            // Verify HMAC signature
            const signature = req.headers['x-mc-signature'];
            if (!verifySignature(body, signature)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid signature' }));
                return;
            }
            let event;
            try {
                event = JSON.parse(body);
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }
            console.log(`[bridge] Received ${event.event_type} for task ${event.task_id}`);
            try {
                await processEvent(event);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            }
            catch (err) {
                console.error('[bridge] Processing error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Processing failed' }));
            }
        });
        return;
    }
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
        return;
    }
    res.writeHead(404);
    res.end();
});
server.listen(PORT, () => {
    console.log(`[bridge] MC→OpenClaw webhook ingress listening on port ${PORT}`);
    console.log(`[bridge] Discord relay: ${DISCORD_BOT_TOKEN ? 'enabled' : 'disabled (no DISCORD_BOT_TOKEN)'}`);
    console.log(`[bridge] Webhook secret: ${MC_WEBHOOK_SECRET ? 'enabled' : 'disabled (no MC_WEBHOOK_SECRET)'}`);
});
// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
    console.log('[bridge] SIGTERM, shutting down');
    server.close(() => process.exit(0));
});
