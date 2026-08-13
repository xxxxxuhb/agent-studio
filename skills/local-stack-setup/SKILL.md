---
name: local-stack-setup
description: >-
  Set up and verify the local Agent Studio stack using repo Compose under
  deploy/ (MySQL only) plus Studio API/Web/Bridge, env templates, SQL init,
  and optional external GitLab/GitHub for push/MR. Use when the user asks to
  install, bootstrap, configure, or troubleshoot local MySQL, Bridge, Studio
  env, SSH push, or merge-request tokens. Do not suggest deploy/gitlab — it
  was removed; forge is external.
---

# Local stack setup (Agent Studio)

Help the user get a **working local stack**. Prefer **repo compose under `deploy/`**
for **MySQL only**. Do **not** assume personal paths, a Dify install, or bundled
GitLab — `deploy/dify` and `deploy/gitlab` were removed. Work orders use
`@agent-studio/orchestrator` → Bridge. Push/MR → external forge
(`docs/对接外部Git.md`).

Canonical human docs:

- `deploy/README.md`
- `docs/环境配置指南.md`
- `docs/对接外部Git.md`
- MySQL detail: [mysql.md](mysql.md)

## Success criteria

Done when all of these pass:

1. Docker MySQL healthy on host port **3316**; `init.sql` applied (`SHOW TABLES` includes `users`, `work_orders`, `run_logs`, `digital_humans`, `pipelines`, `bridges`).
2. Bridge `GET /health` on **8787**.
3. Studio API `GET /api/health` on **8790**; `POST /api/auth/login` works (bootstrap admin).
4. Studio Web opens login → select team → shell (default **5173**).
5. (If git/MR needed) SSH + PAT against **your** GitLab/GitHub work; Bridge `.env` points at that forge.

## Fixed port map (default)

| Service | Host port | Notes |
|---------|-----------|--------|
| **MySQL (Docker)** | **3316** → 3306 | `deploy/docker-compose.yml` |
| Bridge | 8787 | Studio → `http://127.0.0.1:8787` |
| Studio API | 8790 | Needs MySQL |
| Studio Web | 5173 | Vite proxies `/api` → 8790 |

## Workflow

```text
Setup progress:
- [ ] 1. Ports free / Docker running
- [ ] 2. MySQL via bootstrap-dev.sh + init.sql
- [ ] 3. Studio api/bridge `.env` + processes
- [ ] 4. Login → select team → health checks green
- [ ] 5. (Optional L2) bot SSH + PAT against external forge
```

### 1. Preconditions

- Docker available (`docker compose version`).
- Check listeners (especially **3316 / 8790 / 8787**).

### 2. MySQL (required)

```bash
./scripts/bootstrap-dev.sh
# or:
docker compose -f deploy/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

Standalone still works: `deploy/mysql/docker-compose.yml`.

### 3. Agent Studio env

```bash
cp apps/studio-bridge/.env.example apps/studio-bridge/.env
cp apps/studio-api/.env.example apps/studio-api/.env
```

**API** — MySQL + JWT + Bridge token:

```bash
STUDIO_API_PORT=8790
STUDIO_MYSQL_HOST=127.0.0.1
STUDIO_MYSQL_PORT=3316
STUDIO_MYSQL_USER=root
STUDIO_MYSQL_PASSWORD=123456
STUDIO_MYSQL_DATABASE=agent_studio
STUDIO_JWT_SECRET=<random long string>
STUDIO_ADMIN_USER=admin
STUDIO_ADMIN_PASSWORD=admin123
STUDIO_BRIDGE_TOKEN=dev-bridge-token
```

**Bridge**:

```bash
BRIDGE_PORT=8787
AGENT_DRIVER=cursor
CURSOR_API_KEY=...
STUDIO_URL=http://127.0.0.1:8790
STUDIO_BRIDGE_TOKEN=dev-bridge-token
BRIDGE_HTTP_TOKEN=dev-bridge-token
```

Never commit real `.env` or `data/team-secrets/*.yaml`.

Settings UI: language + `bridge_base_url` + Git SSH (no Dify).

### 4. External Git (optional L2)

Do **not** start `deploy/gitlab`. Configure Bridge for company GitLab/GitHub —
see `docs/对接外部Git.md`.

### 5. Start Studio processes

```bash
npm run build:schema
npm run build -w @agent-studio/orchestrator
npm run start -w @agent-studio/studio-api
npm run dev -w @agent-studio/studio-web
npm run dev:bridge
```

### 6. Verify

```bash
docker compose -f deploy/docker-compose.yml ps
mysql -h 127.0.0.1 -P 3316 -u root -p123456 -e "SHOW TABLES FROM agent_studio;"
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8790/api/health
```

Browser: `/login` → **选择团队** → workbench → start a work order (Studio orchestrator).

## Data ownership

| Data | Storage |
|------|---------|
| users / teams / members / projects / work_orders / run_logs | **MySQL** |
| pipelines / digital humans / bridges | **MySQL** |
| team-settings / team-secrets / chats | YAML under `apps/studio-api/data/` |
| work-order git workspace | **Bridge** `BRIDGE_REPOS_DIR` via `POST /workspace/ensure` |

## Remote Bridge

1. Bridge: `BRIDGE_PUBLIC_URL`, `STUDIO_URL`, shared `STUDIO_BRIDGE_TOKEN`, git bot + agent keys.
2. Studio settings `bridge_base_url` = that reachable Bridge URL.
3. See `docs/环境配置指南.md` §3.4.

## Hard rules

1. Prefer **`deploy/docker-compose.yml`** (MySQL) — there is **no** `deploy/dify` or `deploy/gitlab`.
2. Do **not** invent one-off `docker run` for MySQL when compose files exist.
3. MySQL host port **3316**; apply `init.sql` before API boot.
4. Prefer health endpoints over long explanations.
5. Studio → Bridge Bearer = `STUDIO_BRIDGE_TOKEN` / `BRIDGE_HTTP_TOKEN`.
6. Login flow: **login → select team → shell**.
7. Default onboarding: **shared remote control plane + local Bridge / bridge-desktop** (L0); local MySQL stack (L1); external forge for MR (L2).

## Additional resources

- Deploy: [`deploy/README.md`](../../deploy/README.md)
- Bootstrap: [`scripts/bootstrap-dev.sh`](../../scripts/bootstrap-dev.sh)
- External Git: [`docs/对接外部Git.md`](../../docs/对接外部Git.md)
- MySQL: [mysql.md](mysql.md)
- Env snippets: [env-templates.md](env-templates.md)
- Failures: [troubleshooting.md](troubleshooting.md)
