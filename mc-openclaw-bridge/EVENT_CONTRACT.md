# MC → OpenClaw Event Contract

## Events that trigger session wake

| MC event type | Trigger condition | Action |
|---|---|---|
| `task.assigned` | Task assigned to an agent | Wake that agent's session, inject task context |
| `task.unblocked` | Blocked task transitions to in_progress | Wake assignee, inject unblock context |
| `task.review_requested` | Status → ready_for_review | Wake reviewer (from task assignee or linked reviewer) |
| `task.blocked` | Status → blocked | Wake assignee, inject blocker context |
| `task.mention` | Comment mentions an agent (@alex) | Wake mentioned agent, inject comment context |
| `task.created` | New task created and assigned | Wake assignee on new assignment |

## Events that do NOT trigger wake (write-back events)

These are skipped to prevent echo loops:
- `task.comment` — from the same agent that just wrote it
- `task.status_changed` — from the same agent that triggered it
- `task.progress_updated` — from the same agent

## Event payload from MC

```typescript
interface McTaskEvent {
  event_type: string;          // e.g. "task.assigned"
  task_id: string;            // UUID
  timestamp: string;           // ISO 8601
  actor: string;               // who triggered: "Max", "alex", "system"
  task: {
    id: string;
    title: string;
    status: string;
    assignee: string | null;  // "alex", "Max", null
    priority: string | null;
    description: string | null;
    tags: string[];
  };
  comment?: {
    id: number;
    body: string;             // for mention events
  };
}
```

## Compact context injection format

When waking an agent session, inject a compact system message:

```
📋 Task update: [{event_type}]
**{task.title}** (${task.id})
Status: {status} | Priority: {priority}
Link: {MC_URL}/tasks/{task_id}

{optional: comment body or blocker reason}

Respond with HEARTBEAT_OK if you acknowledge.
```

## Session-to-agent mapping

The bridge maintains a routing table:

```
task_assignee → session_key / delivery target

"alex"    → Discord DM to Alex bot (or session: alex/main)
"monica"  → Discord DM to Monica bot
"quinn"   → Discord DM to Quinn bot
"Max"     → Discord DM to Max
"Kyle"    → Discord DM to Kyle
```

Note: Discord DMs require the bot to have previously opened a DM with the user.
Alternatively, route to a designated `#task-alerts` channel and have all agents monitor it.

## Echo loop prevention

Each event carries:
- `event_id`: monotonic integer, MC assigns sequentially
- `actor`: who triggered the event

The bridge tracks the last `event_id` processed per task. On each webhook:
1. If `event_id <= last_processed_event_id` → skip (already processed or reorder)
2. If `actor` matches the target agent AND the last event from that agent was a write-back → skip

Additionally, MC must tag write-back events with a header or flag so the bridge can identify them:
- Header: `X-MC-Event-Source: agent` vs `X-MC-Event-Source: human|automation`
- Or: `actor` starting with `agent:` prefix for agent-generated events

**Requires MC backend confirmation**: Does MC currently differentiate agent vs human events?

## Deduplication

Webhook delivery is not guaranteed-at-most-once. The bridge uses:
- `event_id` dedup: per-task last-processed tracking (5-minute TTL in memory)
- Idempotency key on any side effects (Discord message edits vs re-post)

## MC webhook endpoint

The bridge exposes a single HTTP endpoint:

```
POST /webhook/mc
Content-Type: application/json
X-MC-Signature: <hmac-sha256 of body, optional>
```

MC is configured to POST to: `https://<bridge-host>/webhook/mc`

## OpenClaw delivery

Two options (see architecture decision):

### Option A: Channel relay (default for Phase 1)
Bridge POSTs to Discord channel via Discord Bot API:
```
POST https://discord.com/api/v10/channels/{channel_id}/messages
Authorization: Bot {DISCORD_BOT_TOKEN}
```
→ Discord delivers to OpenClaw → OpenClaw delivers to agent session

### Option B: Direct Gateway WebSocket
Bridge connects to OpenClaw Gateway WS as `role: operator`, authenticates,
calls `sessions.send` to inject into the correct agent session.
- Requires Gateway WS token
- Cleaner semantics (no Discord message pollution)
- More complex to implement

## Architecture decision needed

See: https://github.com/orgs/yct-max/projects/1/views/1 (Phase B card)
