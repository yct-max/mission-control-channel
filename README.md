# mission-control-channel

OpenClaw channel plugin + bridge for Mission Control integration.

## Structure

```
mission-control-channel/   — OpenClaw channel plugin (current approach)
mc-openclaw-bridge/        — Standalone bridge for MC → OpenClaw event delivery
```

### mission-control-channel (Channel Plugin)

Makes Mission Control a **native OpenClaw channel**. MC task events arrive as OpenClaw messages; agent replies go back to MC as task comments.

**Status:** Plugin LOADED in OpenClaw 2026.3.31, but HTTP webhook route registration has a bug.

See `mission-control-channel/README.md` for full docs.

### mc-openclaw-bridge (Legacy Bridge)

Standalone Node.js bridge that receives MC webhook events and routes them to agents via Discord. This is the **older approach** — superseded by the channel plugin but kept for reference.

See `mc-openclaw-bridge/EVENT_CONTRACT.md` for the event contract.

## Quick Start (Channel Plugin)

```bash
cd mission-control-channel
npm install
npm run build
```

Then configure in OpenClaw gateway config:

```json
{
  "channels": {
    "mission-control": {
      "mcUrl": "http://100.78.2.112:18793",
      "routing": {
        "alex": { "assignee": "alex", "sessionKey": "agent:alex:main" },
        "monica": { "assignee": "monica", "sessionKey": "agent:monica:main" },
        "quinn": { "assignee": "quinn", "sessionKey": "agent:quinn:main" }
      }
    }
  },
  "plugins": {
    "entries": { "mission-control": { "enabled": true } },
    "load": { "paths": ["/path/to/mission-control-channel"] }
  }
}
```
