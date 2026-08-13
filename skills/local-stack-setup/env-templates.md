# Env templates (portable)

Repo-relative files only. Replace secrets; do not commit.

## Docker MySQL

```bash
./scripts/bootstrap-dev.sh
# or:
docker compose -f deploy/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

Compose index: `deploy/README.md`. **No bundled GitLab** — see `docs/对接外部Git.md`.

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

# Optional install-level Bridge defaults (UI / team-secrets can override)
# STUDIO_BRIDGE_BASE_URL=http://127.0.0.1:8787
# STUDIO_AGENTS_MD_PATH=auto

STUDIO_GIT_PREFER_SSH=true
STUDIO_GIT_SSH_KEY=~/.ssh/agent_studio_bot
STUDIO_GIT_SSH_PORT=22
STUDIO_GIT_SSH_USER=git
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
BRIDGE_GIT_AUTHOR_EMAIL=bot@example.com
BRIDGE_GIT_FORCE_AUTHOR=true
BRIDGE_GIT_PREFER_SSH=true
BRIDGE_GIT_SSH_KEY=~/.ssh/agent_studio_bot
BRIDGE_GIT_SSH_PORT=22
BRIDGE_GIT_SSH_USER=git
BRIDGE_GIT_PUSH=true
BRIDGE_GIT_CREATE_PR=true
GITLAB_TOKEN=
BRIDGE_GITLAB_API=https://gitlab.example.com/api/v4
BRIDGE_GITLAB_WEB=https://gitlab.example.com
```
