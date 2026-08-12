# Env templates (portable)

Repo-relative files only. Replace secrets; do not commit.

## Docker MySQL

```bash
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

## Docker GitLab

```bash
docker compose -f deploy/gitlab/docker-compose.yml up -d
```

Compose index: `deploy/README.md`.

## `apps/studio-api/.env`

```bash
STUDIO_API_PORT=8790

STUDIO_MYSQL_HOST=127.0.0.1
STUDIO_MYSQL_PORT=3316
STUDIO_MYSQL_USER=root
STUDIO_MYSQL_PASSWORD=123456
STUDIO_MYSQL_DATABASE=agent_studio

STUDIO_JWT_SECRET=dev-studio-jwt-secret-change-me
STUDIO_ADMIN_USER=admin
STUDIO_ADMIN_PASSWORD=admin123

STUDIO_BRIDGE_TOKEN=dev-bridge-token
BRIDGE_HTTP_TOKEN=dev-bridge-token

STUDIO_GIT_PREFER_SSH=true
STUDIO_GIT_SSH_KEY=~/.ssh/agent_studio_bot
STUDIO_GIT_SSH_PORT=2224
STUDIO_GIT_SSH_USER=git

DIFY_ENABLED=true
DIFY_API_BASE=http://localhost/v1
# Install-level default; per-team overlays: data/team-secrets/{teamId}.yaml (UI 设置)
DIFY_API_KEY=
DIFY_BRIDGE_BASE_URL=http://host.docker.internal:8787
DIFY_AGENTS_MD_PATH=auto
DIFY_RESPONSE_MODE=streaming
```

## `apps/studio-bridge/.env`

```bash
BRIDGE_PORT=8787
BRIDGE_HOST=0.0.0.0
BRIDGE_NAME=local-dev
AGENT_DRIVER=cursor
CURSOR_API_KEY=

STUDIO_URL=http://127.0.0.1:8790
STUDIO_BRIDGE_TOKEN=dev-bridge-token
BRIDGE_HTTP_TOKEN=dev-bridge-token
BRIDGE_PUBLIC_URL=http://127.0.0.1:8787
BRIDGE_REPOS_DIR=~/AgentStudio

BRIDGE_GIT_AUTHOR_NAME=agent-studio-bot
BRIDGE_GIT_AUTHOR_EMAIL=bot@agent-studio.local
BRIDGE_GIT_FORCE_AUTHOR=true
BRIDGE_GIT_PREFER_SSH=true
BRIDGE_GIT_SSH_KEY=~/.ssh/agent_studio_bot
BRIDGE_GIT_SSH_PORT=2224
BRIDGE_GIT_SSH_USER=git
BRIDGE_GIT_PUSH=true
BRIDGE_GIT_CREATE_PR=true
GITLAB_TOKEN=
BRIDGE_GITLAB_API=http://localhost:8929/api/v4
BRIDGE_GITLAB_WEB=http://localhost:8929
```

## GitLab `deploy/gitlab/docker-compose.yml`

See repo file `deploy/gitlab/docker-compose.yml` (container `agent-studio-gitlab`, ports 8929 / 2224).
