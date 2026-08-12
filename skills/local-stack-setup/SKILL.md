---
name: local-stack-setup
description: >-
  Set up and verify the local Agent Studio stack using repo Compose under
  deploy/ (MySQL, optional GitLab) plus Studio API/Web/Bridge, env templates,
  SQL init, SSH/bot git, and health checks. Use when the user asks to install,
  bootstrap, configure, or troubleshoot local MySQL, GitLab, Bridge,
  Studio env, SSH push, or merge-request tokens.
---

# Local stack setup (Agent Studio)

Help the user get a **working local stack**. Prefer **repo compose under `deploy/`**
for MySQL / GitLab. Do **not** assume personal paths or a Dify install —
`deploy/dify` was removed; work orders use `@agent-studio/orchestrator` → Bridge.

Canonical human docs:

- `deploy/README.md`
- `docs/环境配置指南.md`
- `docs/本地GitLab搭建指南.md`
- MySQL detail: [mysql.md](mysql.md)

## Success criteria

Done when all of these pass:

1. Docker MySQL healthy on host port **3316**; `init.sql` applied (`SHOW TABLES` includes `users`, `work_orders`, `run_logs`, `digital_humans`, `pipelines`, `bridges`).
2. (Optional) GitLab Web responds on **8929**.
3. Bridge `GET /health` on **8787**.
4. Studio API `GET /api/health` on **8790**; `POST /api/auth/login` works (bootstrap admin).
5. Studio Web opens login → select team → shell (default **5173**).
6. (If git/MR needed) SSH to GitLab on port **2224** works with the bot key; `GITLAB_TOKEN` can call `/api/v4/user`.

## Fixed port map (default)

| Service | Host port | Notes |
|---------|-----------|--------|
| **MySQL (Docker)** | **3316** → 3306 | `deploy/mysql/docker-compose.yml` |
| GitLab HTTP | 8929 | Optional; API `http://localhost:8929/api/v4` |
| GitLab SSH | 2224 → container 22 | Remotes: `ssh://git@localhost:2224/<group>/<repo>.git` |
| Bridge | 8787 | Studio → `http://127.0.0.1:8787` |
| Studio API | 8790 | Needs MySQL |
| Studio Web | 5173 | Vite proxies `/api` → 8790 |

## Workflow

```text
Setup progress:
- [ ] 1. Ports free / Docker running
- [ ] 2. MySQL Docker up + init.sql
- [ ] 3. (Optional) GitLab up + root login + blank project
- [ ] 4. Studio api/bridge `.env` + processes
- [ ] 5. Login → select team → health checks green
- [ ] 6. (Optional) bot SSH + PAT for push/MR
```

### 1. Preconditions

- Docker available (`docker compose version`).
- Check listeners (especially **3316 / 8790 / 8787 / 8929**).

### 2. MySQL (required)

```bash
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

### 3. GitLab (optional)

```bash
docker compose -f deploy/gitlab/docker-compose.yml up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health
docker exec -it agent-studio-gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

Create blank project(s); record clone URLs for Studio「项目」remotes.

### 4. Agent Studio env

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

Optional clone SSH (UI ensureCloned debug):

```bash
STUDIO_GIT_PREFER_SSH=true
STUDIO_GIT_SSH_KEY=~/.ssh/agent_studio_bot
STUDIO_GIT_SSH_PORT=2224
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

### 5. Bot SSH + PAT (optional)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agent_studio_bot -N "" -C "agent-studio-bot@local"
```

Upload public key in GitLab; create PAT with `api` + `write_repository`.

### 6. Start Studio processes

```bash
npm run build:schema
npm run build -w @agent-studio/orchestrator
npm run start -w @agent-studio/studio-api
npm run dev -w @agent-studio/studio-web
npm run dev:bridge
```

### 7. Verify

```bash
docker compose -f deploy/mysql/docker-compose.yml ps
mysql -h 127.0.0.1 -P 3316 -u root -p123456 -e "SHOW TABLES FROM agent_studio;"
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8790/api/health
# optional: curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health
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

1. Prefer **`deploy/mysql`**, **`deploy/gitlab`** — there is **no** `deploy/dify`.
2. Do **not** invent one-off `docker run` for MySQL/GitLab when compose files exist.
3. MySQL host port **3316**; apply `init.sql` before API boot.
4. Prefer health endpoints over long explanations.
5. Studio → Bridge Bearer = `STUDIO_BRIDGE_TOKEN` / `BRIDGE_HTTP_TOKEN`.
6. Login flow: **login → select team → shell**.

## Additional resources

- Deploy: [`deploy/README.md`](../../deploy/README.md)
- MySQL: [mysql.md](mysql.md)
- Env snippets: [env-templates.md](env-templates.md)
- Failures: [troubleshooting.md](troubleshooting.md)
