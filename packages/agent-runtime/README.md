# @agent-studio/agent-runtime

Pluggable agent drivers used by Bridge.

## Drivers

| id | Description | Auth | Usage (token/cost) |
|----|-------------|------|--------------------|
| `cursor` | Cursor Agent SDK (`create`/`send`/`wait`, local cwd) | `CURSOR_API_KEY` or `--login` | Yes — `RunResult.usage` + `getUsage()` cost |
| `trae` | TraeCode CLI (`traecli -p …`) | `TRAECLI_PERSONAL_ACCESS_TOKEN` or `/login` | No — CLI has no structured usage |
| `qoder` | Qoder Agent SDK (`query`) | `QODER_PERSONAL_ACCESS_TOKEN` or `QODER_AUTH=qodercli` | Yes — result `usage` + `total_cost_usd` |
| `openai` | Placeholder — not implemented yet | — | — |

## Switch driver

```bash
AGENT_DRIVER=auto      # first available: cursor → trae → qoder
AGENT_DRIVER=cursor
AGENT_DRIVER=trae
AGENT_DRIVER=qoder
```

### Install & auth (quick)

| Driver | Install | Auth |
|--------|---------|------|
| `cursor` | bundled SDK | `CURSOR_API_KEY` or Bridge `start --login` |
| `trae` | install `traecli` ([docs](https://docs.trae.cn/cli_login-token)); optional `TRAECLI_PATH` / `TRAECLI_HOST` | `TRAECLI_PERSONAL_ACCESS_TOKEN` (`trae-lt-…`) or interactive `/login` |
| `qoder` | monorepo `npm install` (SDK + worker); optional `qodercli` | `QODER_PERSONAL_ACCESS_TOKEN` / `QODER_PAT`, or `QODER_AUTH=qodercli` after CLI login |
| `openai` | — | placeholder only |

Full copy-paste recipes: `docs/环境配置指南.md` §3.1a.

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
