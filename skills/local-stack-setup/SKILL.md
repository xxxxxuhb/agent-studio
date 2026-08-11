---
name: local-stack-setup
description: >-
  Set up and verify the local Agent Studio stack using repo Compose under
  deploy/ (MySQL, GitLab, Dify) plus Studio API/Web/Bridge, env templates,
  SQL init, SSH/bot git, and health checks. Use when the user asks to install,
  bootstrap, configure, or troubleshoot local MySQL, Dify, GitLab, Bridge,
  Studio env, SSH push, or merge-request tokens.
---

# Local stack setup (Agent Studio)

Help the user get a **working local stack**. Prefer **repo compose under `deploy/`**
for MySQL / GitLab / Dify. Do **not** assume personal paths like `~/dify-1.16.1`.
Only ask for an external cwd if they insist on their own Dify/GitLab install.

Canonical human docs:

- `deploy/README.md`
- `docs/环境配置指南.md`
- `docs/本地Dify与GitLab搭建指南.md`
- MySQL detail: [mysql.md](mysql.md)

Prefer the checklists below over copying machine-specific narrative from those docs.

## Success criteria

Done when all of these pass:

1. Docker MySQL healthy on host port **3316**; `init.sql` applied (`SHOW TABLES` includes `users`, `work_orders`, `run_logs`).
2. GitLab Web responds on the agreed HTTP port (default **8929**).
3. Dify Web responds on **http://localhost** (or the port they mapped).
4. Bridge `GET /health` on **8787**.
5. Studio API `GET /api/health` on **8790**; `POST /api/auth/login` works (bootstrap admin).
6. Studio Web opens login → select team → shell (default **5173**).
7. From Dify’s network, Bridge is reachable as **`http://host.docker.internal:8787`** (never `127.0.0.1` inside Docker).
8. (If git/MR needed) SSH to GitLab on port **2224** works with the bot key; `GITLAB_TOKEN` can call `/api/v4/user`.

## Fixed port map (default)

| Service | Host port | Notes |
|---------|-----------|--------|
| **MySQL (Docker)** | **3316** → 3306 | Compose: `apps/studio-api/docker-compose.mysql.yml` |
| Dify | 80 | App API `http://localhost/v1` |
| GitLab HTTP | 8929 | API `http://localhost:8929/api/v4` |
| GitLab SSH | 2224 → container 22 | Remotes: `ssh://git@localhost:2224/<group>/<repo>.git` |
| Bridge | 8787 | Dify → `host.docker.internal:8787` |
| Studio API | 8790 | Needs MySQL |
| Studio Web | 5173 | Vite proxies `/api` → 8790 |

If a port is taken, change it **consistently** in compose, remotes, and `.env`.

## Workflow

Copy and track:

```text
Setup progress:
- [ ] 1. Ports free / Docker running
- [ ] 2. MySQL Docker up + init.sql
- [ ] 3. GitLab up + root login
- [ ] 4. At least one blank project for remotes
- [ ] 5. Dify up + SECRET_KEY + SSRF allowlist
- [ ] 6. Studio api/bridge `.env` + processes
- [ ] 7. Login → select team → health checks green
- [ ] 8. (Optional) bot SSH + PAT for push/MR
```

### 1. Preconditions

- Docker available (`docker compose version`).
- Check listeners before starting anything new (especially **3316 / 8790 / 8787 / 8929 / 80**).

### 2. MySQL (required — use Docker)

**Do this before starting Studio API.** Prefer the repo compose file (do not invent one-off `docker run` unless the user insists).

```bash
# monorepo root
docker compose -f deploy/mysql/docker-compose.yml up -d

# wait until healthy, then apply schema (idempotent)
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql

mysql -h 127.0.0.1 -P 3316 -u root -p123456 -e "SHOW TABLES FROM agent_studio;"
```

Default root password in compose is **`123456`**. If changed, update compose **and** `apps/studio-api/.env` together.

Full notes: [mysql.md](mysql.md). Alias path: `apps/studio-api/docker-compose.mysql.yml`.

### 3. GitLab

Use the **repo** compose (do not invent paths):

```bash
docker compose -f deploy/gitlab/docker-compose.yml up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health
```

- Web: http://localhost:8929  
- SSH: host **2224** → container 22  
- Container name: `agent-studio-gitlab`

Initial root password (Omnibus):

```bash
docker exec -it agent-studio-gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

Create blank project(s) in the UI; record HTTP/SSH clone URLs for Studio「项目」remotes. Do not hardcode group/repo names unless the user already has them.

### 4. Dify

Use the **vendored** official stack under `deploy/dify/` (Dify **1.16.1**):

```bash
cd deploy/dify
cp .env.example .env
cat .env.agent-studio.example >> .env
# edit .env → set a real SECRET_KEY (openssl rand -base64 42)
docker compose up -d
cd ../..
```

Or from repo root (keep relative paths correct):

```bash
docker compose -f deploy/dify/docker-compose.yaml --project-directory deploy/dify up -d
```

**Required `.env` knobs** (also in `.env.agent-studio.example`):

```env
SECRET_KEY=<long random string>   # empty → WS/sync 401
SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
SSRF_PROXY_ALLOW_PRIVATE_IPS=192.168.65.2,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
APP_MAX_EXECUTION_TIME=7200
```

After changing `SECRET_KEY`, clear browser site data for localhost and re-login.

Create or import a Workflow app; copy **App API Key** (`app-...`).

### 5. Agent Studio env (repo-relative only)

```bash
cp apps/studio-bridge/.env.example apps/studio-bridge/.env
cp apps/studio-api/.env.example apps/studio-api/.env
```

**API** (`apps/studio-api/.env`) — MySQL + JWT (required):

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

**API** — Dify + clone SSH (when needed):

```bash
STUDIO_GIT_PREFER_SSH=true
STUDIO_GIT_SSH_KEY=~/.ssh/agent_studio_bot
STUDIO_GIT_SSH_PORT=2224

DIFY_ENABLED=true
DIFY_API_BASE=http://localhost/v1
DIFY_API_KEY=app-...
DIFY_BRIDGE_BASE_URL=http://host.docker.internal:8787
```

Or configure Dify in Studio UI **设置** (team-scoped language; Dify secrets still install-level — do not commit).

**Bridge** (`apps/studio-bridge/.env`) — minimum:

```bash
BRIDGE_PORT=8787
AGENT_DRIVER=cursor
CURSOR_API_KEY=...
STUDIO_URL=http://127.0.0.1:8790
STUDIO_BRIDGE_TOKEN=dev-bridge-token
BRIDGE_HTTP_TOKEN=dev-bridge-token
```

**Bridge** — GitLab bot + MR (when needed): see [env-templates.md](env-templates.md).

Never commit real `.env` or `data/dify-secrets.yaml`.

### 6. Bot SSH + PAT (optional but recommended for push/MR)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agent_studio_bot -N "" -C "agent-studio-bot@local"
```

Upload **public** key in GitLab → SSH Keys. Create PAT with `api` + `write_repository`. Put token only in Bridge `.env`.

Verify:

```bash
export GIT_SSH_COMMAND='ssh -i ~/.ssh/agent_studio_bot -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
git ls-remote ssh://git@localhost:2224/<group>/<repo>.git HEAD
```

### 7. Start Studio processes

From monorepo root:

```bash
# typical
npm run build:schema
npm run start -w @agent-studio/studio-api    # or: node apps/studio-api/dist/main.js after build
npm run dev -w @agent-studio/studio-web
npm run bridge -- start --driver cursor ...  # or their usual Bridge start
```

After `.env` changes, **restart** the matching process.

First API boot (empty `users`): creates admin + slug=`default` team; may migrate leftover YAML projects / work orders / run-logs into MySQL (source files kept).

### 8. Verify

```bash
docker compose -f deploy/mysql/docker-compose.yml ps
mysql -h 127.0.0.1 -P 3316 -u root -p123456 -e "SHOW TABLES FROM agent_studio;"

curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost/
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8790/api/health
```

Browser: open Web → `/login` with `STUDIO_ADMIN_*` → **选择团队** → workbench.

Confirm only **one** process owns `:8787` and `:8790`.

## Data ownership (quick map)

| Data | Storage |
|------|---------|
| users / teams / members / projects / work_orders / run_logs | **MySQL** |
| pipelines / digital humans / bridges / team-settings | YAML under `apps/studio-api/data/` (`team_id` scoped) |
| manager chat threads | files under `data/chats/` (still) |
| Dify App Key / console token | env or `data/dify-secrets.yaml` |

## Hard rules for the agent

1. Prefer **`deploy/mysql`**, **`deploy/gitlab`**, **`deploy/dify`** over personal install dirs.
2. Do **not** invent one-off `docker run` for MySQL/GitLab when compose files exist.
3. **MySQL** host port **3316**; apply `apps/studio-api/sql/init.sql` before API boot.
4. Dify → Bridge URL is always `host.docker.internal` on Docker Desktop; host curl uses `127.0.0.1`.
5. Prefer checking health endpoints over long explanations.
6. If something fails, fix the specific layer — see [troubleshooting.md](troubleshooting.md).
7. After enabling Bridge HTTP auth, ensure Studio and Dify send `Authorization: Bearer <STUDIO_BRIDGE_TOKEN>`.
8. Login flow is **login → select team → shell**; only `is_admin` configures teams; `viewer` is read-only.

## Additional resources

- Deploy compose index: [`deploy/README.md`](../../deploy/README.md)
- MySQL Docker + SQL: [mysql.md](mysql.md)
- Env var tables & copy-paste templates: [env-templates.md](env-templates.md)
- Failure modes: [troubleshooting.md](troubleshooting.md)
