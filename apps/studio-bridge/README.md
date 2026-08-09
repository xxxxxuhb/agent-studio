# Agent Studio Bridge — local debug entry

Thin wrapper around `@agent-studio/bridge`. Prefer the CLI on real executors:

```bash
npx @agent-studio/bridge start --driver cursor
```

Local:

```bash
cp .env.example .env   # set AGENT_DRIVER / CURSOR_API_KEY
npm run start -w @agent-studio/studio-bridge
```
