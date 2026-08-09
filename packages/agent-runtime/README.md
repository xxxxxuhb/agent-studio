# @agent-studio/agent-runtime

Pluggable agent drivers used by Bridge.

## Drivers

| id | Description | Auth |
|----|-------------|------|
| `cursor` | Cursor Agent SDK (`Agent.prompt`, local cwd) | `CURSOR_API_KEY` or `--login` |
| `trae` | TraeCode CLI (`traecli -p …`) | `TRAECLI_PERSONAL_ACCESS_TOKEN` or `/login` |
| `qoder` | Qoder Agent SDK (`query`) | `QODER_PERSONAL_ACCESS_TOKEN` or `QODER_AUTH=qodercli` |
| `openai` | Placeholder — not implemented yet | — |

## Switch driver

```bash
AGENT_DRIVER=auto      # first available: cursor → trae → qoder
AGENT_DRIVER=cursor
AGENT_DRIVER=trae
AGENT_DRIVER=qoder
```

## Add a custom driver

```ts
import { registerAgentDriver, type AgentDriver } from "@agent-studio/agent-runtime";

registerAgentDriver("my-agent", () => ({
  id: "my-agent",
  label: "My Agent",
  isAvailable: () => true,
  async run({ stage, cwd, prompt }) {
    return { summary: `${stage} ok`, raw: "...", driver: "my-agent" };
  },
}));
```
