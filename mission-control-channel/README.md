# Mission Control — OpenClaw Channel Plugin

Makes Mission Control a first-class OpenClaw channel. MC task events arrive as native OpenClaw messages; agent replies go back to MC as task comments.

## Quick Install

```bash
cd mission-control-channel
npm install
npm run build
```

## Gateway Config

Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "mission-control": {
      "mcUrl": "http://100.78.2.112:18793",
      "apiKey": "<your MC API key>",
      "webhookPath": "/mc/webhook",
      "routing": {
        "alex": { "assignee": "alex", "sessionKey": "agent:alex:main", "displayName": "Agent Alex" },
        "monica": { "assignee": "monica", "sessionKey": "agent:monica:main", "displayName": "Agent Monica" },
        "quinn": { "assignee": "quinn", "sessionKey": "agent:quinn:main", "displayName": "Agent Quinn" }
      }
    }
  },
  "plugins": {
    "entries": {
      "mission-control": {
        "enabled": true
      }
    },
    "load": {
      "paths": [
        "/path/to/mission-control-channel"
      ]
    }
  }
}
```

Then restart the gateway: `openclaw gateway restart`

## Container Test Harness

For a clean isolated test on the Mac mini:

**1. Build the plugin (on host):**
```bash
cd /Users/petersky/.openclaw/workspace-alex/mission-control-channel
npm install && npm run build
```

**2. Start a clean OpenClaw container:**
```bash
cd /Users/petersky/openclaw  # wherever the openclaw repo is
OPENCLAW_WORKSPACE_DIR=/Users/petersky/.openclaw/workspace-alex \
OPENCLAW_EXTRA_MOUNTS=/Users/petersky/.openclaw/workspace-alex/mission-control-channel:/home/node/.openclaw/plugins/mission-control \
./scripts/docker/setup.sh
```

Or with Docker Compose, add to your compose file:
```yaml
services:
  openclaw-gateway:
    volumes:
      - /Users/petersky/.openclaw/workspace-alex/mission-control-channel:/home/node/.openclaw/plugins/mission-control
```

**3. Configure inside the container:**
```bash
docker compose exec openclaw-gateway node dist/index.js config set channels.mission-control.mcUrl "http://100.78.2.112:18793"
docker compose exec openclaw-gateway node dist/index.js config set channels.mission-control.apiKey "<key>"
docker compose exec openclaw-gateway node dist/index.js config set plugins.entries.mission-control.enabled true
docker compose exec openclaw-gateway node dist/index.js config set plugins.load.paths '["/home/node/.openclaw/plugins/mission-control"]'
```

**4. Restart the gateway:**
```bash
docker compose restart openclaw-gateway
```

**5. Verify the channel registered:**
```bash
docker compose exec openclaw-gateway node dist/index.js status
```

**6. Test the webhook endpoint:**
```bash
curl -X POST http://localhost:18789/mc/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "task.assigned",
    "task_id": "test-123",
    "actor": "Max",
    "timestamp": "2026-03-31T00:00:00Z",
    "task": {
      "id": "test-123",
      "title": "[test] Container test task",
      "status": "in_progress",
      "assignee": "alex",
      "priority": "high",
      "description": "Testing the MC channel plugin in a container",
      "tags": ["test"]
    }
  }'
```

Expected: `{"ok": true}` — agent alex's session receives the task context.

## MC Webhook Config

Configure MC to POST task events to the gateway:

```
POST http://<gateway-host>:<port>/mc/webhook
Content-Type: application/json

{
  "event_type": "task.assigned",
  "task_id": "<task-uuid>",
  "actor": "Max",
  "timestamp": "2026-03-31T00:00:00Z",
  "task": {
    "id": "<task-uuid>",
    "title": "Task title",
    "status": "in_progress",
    "assignee": "alex",
    "priority": "high",
    "description": "...",
    "tags": []
  }
}
```

## Event Types

| event_type | Trigger | Action |
|---|---|---|
| `task.assigned` | Task assigned | Wake assignee, inject task context |
| `task.unblocked` | Blocked → in_progress | Wake assignee, inject unblock |
| `task.review_requested` | Status → ready_for_review | Wake reviewer |
| `task.blocked` | Status → blocked | Wake assignee, inject blocker |
| `task.mention` | Comment mentions @agent | Wake mentioned agent |
| `task.created` | New task assigned | Wake assignee |

Write-back events (`task.comment`, `task.status_changed`, `task.progress_updated`) are skipped if the actor matches the target assignee — no echo loops.

## Agent Usage

Reply to a task from any OpenClaw session:

```
/message channel=mission-control to=task:<task_id> text=Here's my update...
```

The plugin posts the message as a comment on the MC task.

## File Structure

```
mission-control-channel/
├── package.json           # openclaw.channel manifest + npm config
├── openclaw.plugin.json   # Plugin manifest (id, kind, configSchema)
├── tsconfig.json
├── .gitignore
├── README.md
├── setup-entry.ts        # Setup-only entry (for disabled/setup mode)
└── src/
    ├── index.ts           # Full entry: defineChannelPluginEntry + registerHttpRoute
    ├── channel.ts         # createChatChannelPlugin with MC-specific adapters
    ├── client.ts          # MC REST API client (addComment, getTask, updateStatus)
    └── types.ts           # Shared types (McTaskEvent, AgentRoutingTable)
```

## Troubleshooting

**Plugin not loading:**
- Check `openclaw gateway status` for plugin load errors
- Verify `plugins.load.paths` includes the plugin directory
- Check the plugin directory has `openclaw.plugin.json`

**Webhook 500 error:**
- Check gateway logs: `docker compose logs openclaw-gateway | grep mission-control`
- Verify `channels.mission-control.mcUrl` is reachable from inside the container
- Ensure `plugins.entries.mission-control.enabled` is `true`

**Channel not registering:**
- Channel plugin needs to be allowlisted if `plugins.allow` is set
- Add `"mission-control"` to `plugins.allow`
