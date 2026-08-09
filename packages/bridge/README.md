# Agent Studio Bridge (executor)

Run on any machine that should execute Agent work (Cursor / Trae / Qoder / …).

## Local (monorepo)

```bash
npm run build -w @agent-studio/agent-runtime
npm run build -w @agent-studio/bridge
npx @agent-studio/bridge start --driver cursor
```

Or keep using the thin local app:

```bash
npm run dev:bridge
```

## CLI

```bash
npx @agent-studio/bridge start --driver cursor \
  --studio-url http://127.0.0.1:8790 \
  --token <STUDIO_BRIDGE_TOKEN> \
  --public-url http://192.168.x.x:8787 \
  --name my-mac
```

If `--driver` is omitted and stdin is a TTY, the CLI interactively asks you to pick:

| driver | meaning |
|--------|---------|
| `auto` | first available: cursor → trae → qoder |
| `cursor` | Cursor Agent SDK |
| `trae` | TraeCode CLI |
| `qoder` | Qoder Agent SDK |
| `openai` | placeholder |

## Stages

`manager` → `requirement` → `plan` → `dev` → `review` → `test` → `release_test`

- Dify/Studio pipelines may call a subset (e.g. `code-dev` ends at `review`).
- `review`: agent writes the review report; on pass the **review agent** git **commits** + **pushes** and writes `commit-record.md`. Bridge then opens a merge **PR/MR** via forge API (`BRIDGE_GIT_CREATE_PR` + `GITLAB_TOKEN` / `GITHUB_TOKEN`).

Set a shared token on Studio (`STUDIO_BRIDGE_TOKEN`) and pass the same `--token`.
执行器通过 **WebSocket**（`/bridges`）向 Studio 同步状态：`online` / `offline` / `busy`。
