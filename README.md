# mission-control-channel

OpenClaw channel plugin + bridge for Mission Control integration.

## Structure

```
mission-control-channel/   — OpenClaw channel plugin (current approach)
mc-openclaw-bridge/        — Standalone bridge for MC → OpenClaw event delivery
```

### mission-control-channel (Channel Plugin)

Makes Mission Control a **native OpenClaw channel**. MC task events arrive as OpenClaw messages; agent replies go back to MC as task comments.

Each agent authenticates with its own **agent integration token** (create via `POST /api/agent-integrations` in MC).

See `mission-control-channel/README.md` for full setup docs.

### mc-openclaw-bridge (Legacy Bridge)

Standalone Node.js bridge that receives MC webhook events and routes them to agents via Discord. This is the **older approach** — superseded by the channel plugin but kept for reference.

See `mc-openclaw-bridge/EVENT_CONTRACT.md` for the event contract.

## Quick Start (Channel Plugin)

```bash
cd mission-control-channel
npm install
npm run build
```

Create an agent integration in MC:
```bash
curl -X POST "http://100.78.2.112:18793/api/agent-integrations" \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "alex"}'
# Save the returned token!
```

Then configure in OpenClaw gateway config (per agent):

```json
{
  "channels": {
    "mission-control": { "enabled": true }
  },
  "plugins": {
    "entries": {
      "mission-control": {
        "config": {
          "mcUrl": "http://100.78.2.112:18793",
          "agentToken": "mc_<token from MC>"
        }
      }
    },
    "load": { "paths": ["/path/to/mission-control-channel"] }
  }
}
```
