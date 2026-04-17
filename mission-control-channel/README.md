# Mission Control — OpenClaw Channel Plugin

Makes Mission Control a first-class OpenClaw channel. MC task events arrive as native OpenClaw messages; agent replies go back to MC as task comments.

## Architecture

```
Agent → OpenClaw Gateway → MC Channel Plugin → MC API (POST /api/tasks/:id/comments)
                                                              ↑
                                                    Bearer <agentToken>
MC → Webhook (/mc/webhook) → Gateway → Agent Session (by task assignee)
```

Each agent has its own **agent integration token** registered in MC. Tokens identify which agent is connecting and enable MC to route events to the correct agent session.

## Setup

### 1. Build the plugin

```bash
cd mission-control-channel
npm install
npm run build
```

### 2. Create an agent integration in MC

On the Mac mini (or wherever MC is running), create an integration for each agent:

```bash
# Replace with your MC URL and agent name
MC_URL="http://100.78.2.112:18793"
AGENT_NAME="alex"  # alex, monica, quinn, etc.

# Create integration — save the returned token
curl -X POST "${MC_URL}/api/agent-integrations" \
  -H "Content-Type: application/json" \
  -d "{\"agent_name\": \"${AGENT_NAME}\"}"
```

Response:
```json
{
  "id": 1,
  "agent_name": "alex",
  "token": "mc_a1b2c3d4e5f6...",
  "created_at": "2026-04-16T22:00:00Z"
}
```

**⚠️ The token is shown only once.** Store it in the agent's OpenClaw config immediately.

### 3. Configure the plugin in OpenClaw

Add to `~/.openclaw/openclaw.json` **per agent** (each agent has its own token):

```json
{
  "channels": {
    "mission-control": {
      "enabled": true
    }
  },
  "plugins": {
    "entries": {
      "mission-control": {
        "config": {
          "mcUrl": "http://100.78.2.112:18793",
          "agentToken": "mc_a1b2c3d4e5f6..."
        }
      }
    },
    "load": {
      "paths": [
        "/home/petersky/repos/mission-control-channel/mission-control-channel"
      ]
    }
  }
}
```

Then restart:
```bash
openclaw gateway restart
```

### 4. Configure MC webhook (so MC sends events to the gateway)

In MC's `app/config.py`, set the webhook URL to point to the OpenClaw gateway. The gateway must be reachable from the Mac mini.

Example (gateway on same host, port 18789):
```python
# In app/config.py or environment
MC_WEBHOOK_URL = "http://localhost:18789/mc/webhook"
```

Or if MC is on a different host than the gateway, point to the gateway's address:
```
http://<gateway-host>:<port>/mc/webhook
```

## Per-Agent Token Management

Tokens are managed via the MC API:

```bash
MC_URL="http://100.78.2.112:18793"

# List all integrations
curl "${MC_URL}/api/agent-integrations"

# Revoke an integration
curl -X DELETE "${MC_URL}/api/agent-integrations/alex"
```

When an agent's token is revoked and re-created, update the agent's `agentToken` in the OpenClaw config and restart the gateway.

## Event Flow

### Inbound (MC → Agent)

MC POSTs task events to `/mc/webhook`. The plugin uses `task.assignee` to route to the correct agent session:

| event_type | Trigger | Action |
|---|---|---|
| `task.assigned` | Task assigned | Wake assignee, inject task context |
| `task.updated` | Task updated | Wake assignee with update |
| `task.completed` | Task completed | Notify assignee |
| `task.comment` | New comment | Forward comment to assignee |

Echo loop prevention: events with `actor` matching known agents are skipped.

### Outbound (Agent → MC)

Agent sends from any session:
```
/message channel=mission-control to=task:<task_id> text=Here's my update...
```

The plugin posts to `POST /api/tasks/:id/comments` with `Authorization: Bearer <agentToken>`.

## Troubleshooting

**Plugin not loading:**
```bash
openclaw gateway status
# Check plugins.load.paths includes the plugin directory
```

**Webhook returning 500:**
- Check gateway logs: `openclaw logs` or `docker compose logs`
- Verify `mcUrl` is reachable from the gateway
- Confirm `agentToken` is correct (no trailing spaces)

**Agent not receiving events:**
- Verify the integration exists in MC: `curl ${MC_URL}/api/agent-integrations`
- Confirm `last_seen_at` updates when the agent makes requests
- Check the task's `assignee` matches the agent's `agent_name` in MC

**Token issues:**
- Tokens use HMAC-SHA256 — no external dependencies
- A new secret is generated on first run if `MC_TOKEN_SECRET` env var is not set
- To rotate the secret: set `MC_TOKEN_SECRET=<new-hex>` and restart MC (existing tokens will be invalid)

## File Structure

```
mission-control-channel/
├── package.json
├── openclaw.plugin.json   # Plugin manifest (id, kind, configSchema, version)
├── tsconfig.json
├── README.md
├── setup-entry.ts        # Setup-only entry (disabled/setup mode)
└── src/
    ├── index.ts           # definePluginEntry + HTTP webhook handler
    ├── channel.ts         # createChatChannelPlugin + MC client integration
    ├── client.ts          # MC REST API client (authenticated)
    └── types.ts           # Shared types
```
