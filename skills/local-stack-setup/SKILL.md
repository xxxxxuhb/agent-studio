---
name: local-stack-setup
description: >-
  Set up and verify the local Agent Studio stack (GitLab, Dify, Studio API/Web,
  Bridge) with ports, env templates, SSH/bot git, and health checks. Use when
  the user asks to install, bootstrap, configure, or troubleshoot local Dify,
  GitLab, Bridge, Studio env, SSH push, or merge-request tokens — without
  depending on any one machine's folder layout.
---

# Local stack setup (Agent Studio)

Help the user get a **working local stack**. Do **not** assume or invent paths
like `~/dify-pipeline`, `~/dify-1.16.1`, or personal clone roots. Ask where
their GitLab compose / Dify docker directory lives if a command needs a cwd;
otherwise use **ports, URLs, and repo-relative `.env` files** only.

Canonical human docs in this repo (optional deeper reading):

- `docs/环境配置指南.md`
- `docs/本地Dify与GitLab搭建指南.md`

Prefer the checklists below over copying machine-specific narrative from those docs.

## Success criteria

Done when all of these pass:

1. GitLab Web responds on the agreed HTTP port (default **8929**).
2. Dify Web responds on **http://localhost** (or the port they mapped).
3. Bridge `GET /health` on **8787**.
4. Studio API `GET /api/health` on **8790**.
5. From Dify’s network, Bridge is reachable as **`http://host.docker.internal:8787`** (never `127.0.0.1` inside Docker).
6. (If git/MR needed) SSH to GitLab on port **2224** works with the bot key; `GITLAB_TOKEN` can call `/api/v4/user`.

## Fixed port map (default)

| Service | Host port | Notes |
|---------|-----------|--------|
| Dify | 80 | App API `http://localhost/v1` |
| GitLab HTTP | 8929 | API `http://localhost:8929/api/v4` |
| GitLab SSH | 2224 → container 22 | Remotes: `ssh://git@localhost:2224/<group>/<repo>.git` |
| Bridge | 8787 | Dify → `host.docker.internal:8787` |
| Studio API | 8790 | |
| Studio Web | 5173 | |

If a port is taken, change it **consistently** in compose, remotes, and `.env`.

## Workflow

Copy and track:

```text
Setup progress:
- [ ] 1. Ports free / Docker running
- [ ] 2. GitLab up + root login
- [ ] 3. At least one blank project for remotes
- [ ] 4. Dify up + SECRET_KEY + SSRF allowlist
- [ ] 5. Studio bridge/api `.env` + processes
- [ ] 6. (Optional) bot SSH + PAT for push/MR
- [ ] 7. Health checks all green
```

### 1. Preconditions

- Docker available.
- Check listeners before starting anything new.

### 2. GitLab

Use **their** compose directory (ask if unknown). Minimal service shape:

- `external_url 'http://localhost:8929'`
- publish `8929:8929` and `2224:22`
- `gitlab_shell_ssh_port = 2224`

Start with `docker compose up -d`. First boot is slow; wait until `/-/health` is 200.

Initial root password (Omnibus):

```bash
docker exec -it gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

Create blank project(s) in the UI; record HTTP clone URLs for Studio「项目」remotes. Do not hardcode group/repo names unless the user already has them.

### 3. Dify

Use **their** official Dify `docker` directory (ask if unknown):

```bash
cp .env.example .env   # if needed
# edit .env — required knobs below
docker compose up -d
```

**Required `.env` knobs:**

```env
SECRET_KEY=<long random string>   # empty → WS/sync 401
SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
APP_MAX_EXECUTION_TIME=7200
```

Optional: `SSRF_PROXY_ALLOW_PRIVATE_IPS=...` for private ranges.

After changing `SECRET_KEY`, clear browser site data for localhost and re-login.

Create or import a Workflow app; copy **App API Key** (`app-...`).

### 4. Agent Studio env (repo-relative only)

```bash
cp apps/studio-bridge/.env.example apps/studio-bridge/.env
cp apps/studio-api/.env.example apps/studio-api/.env
```

**Bridge** (`apps/studio-bridge/.env`) — minimum:

```bash
BRIDGE_PORT=8787
AGENT_DRIVER=cursor
CURSOR_API_KEY=...
```

**Bridge** — GitLab bot + MR (when needed):

```bash
BRIDGE_GIT_AUTHOR_NAME=agent-studio-bot
BRIDGE_GIT_AUTHOR_EMAIL=bot@agent-studio.local
BRIDGE_GIT_FORCE_AUTHOR=true
BRIDGE_GIT_PREFER_SSH=true
BRIDGE_GIT_SSH_KEY=~/.ssh/agent_studio_bot
BRIDGE_GIT_SSH_PORT=2224
BRIDGE_GIT_CREATE_PR=true
GITLAB_TOKEN=glpat-...
BRIDGE_GITLAB_API=http://localhost:8929/api/v4
BRIDGE_GITLAB_WEB=http://localhost:8929
```

**API** (`apps/studio-api/.env`) — clone SSH + Dify:

```bash
STUDIO_BRIDGE_TOKEN=dev-bridge-token   # same as Bridge if registering
STUDIO_GIT_PREFER_SSH=true
STUDIO_GIT_SSH_KEY=~/.ssh/agent_studio_bot
STUDIO_GIT_SSH_PORT=2224

DIFY_ENABLED=true
DIFY_API_BASE=http://localhost/v1
DIFY_API_KEY=app-...
DIFY_BRIDGE_BASE_URL=http://host.docker.internal:8787
```

Or configure Dify in Studio UI **设置** (writes `apps/studio-api/data/dify-config.yaml` — do not commit secrets).

Never commit real `.env` or `dify-config.yaml` secrets.

### 5. Bot SSH + PAT (optional but recommended for push/MR)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agent_studio_bot -N "" -C "agent-studio-bot@local"
```

Upload **public** key in GitLab → SSH Keys. Create PAT with `api` + `write_repository`. Put token only in Bridge `.env`.

Verify:

```bash
export GIT_SSH_COMMAND='ssh -i ~/.ssh/agent_studio_bot -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
git ls-remote ssh://git@localhost:2224/<group>/<repo>.git HEAD
```

Rewrite existing remotes to `ssh://git@localhost:2224/...` when prefer-SSH is on (Bridge can also rewrite on run).

### 6. Start Studio processes

From monorepo root (or their usual scripts): API **8790**, Web **5173**, Bridge **8787**. After `.env` changes, **restart** the matching process.

Bridge log should include bot identity + `prefer_ssh` when git env is set.

### 7. Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost/
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8790/api/health
```

Confirm only **one** process owns `:8787` (do not run a second legacy Bridge).

## Hard rules for the agent

1. **No personal directory trees** in instructions, examples, or commits unless the user pastes them.
2. **Ask** for GitLab/Dify install directories when a shell `cd` is required.
3. Dify → Bridge URL is always `host.docker.internal` on Docker Desktop (macOS/Windows); host curl uses `127.0.0.1`.
4. Prefer checking health endpoints over long explanations.
5. If something fails, fix the specific layer (GitLab / Dify SSRF|SECRET_KEY / Bridge env / port clash) — see [troubleshooting.md](troubleshooting.md).
6. After enabling Bridge HTTP auth, ensure Studio and Dify send `Authorization: Bearer <STUDIO_BRIDGE_TOKEN>`; re-import generated DSL if old workflows lack `bridge_token`.

## Additional resources

- Env var tables & copy-paste templates: [env-templates.md](env-templates.md)
- Failure modes: [troubleshooting.md](troubleshooting.md)
