# Env templates (portable)

Repo-relative files only. Replace secrets; do not commit.

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

## `apps/studio-api/.env`

```bash
STUDIO_API_PORT=8790
STUDIO_BRIDGE_TOKEN=dev-bridge-token
BRIDGE_HTTP_TOKEN=dev-bridge-token

STUDIO_GIT_PREFER_SSH=true
STUDIO_GIT_SSH_KEY=~/.ssh/agent_studio_bot
STUDIO_GIT_SSH_PORT=2224
STUDIO_GIT_SSH_USER=git

DIFY_ENABLED=true
DIFY_API_BASE=http://localhost/v1
DIFY_API_KEY=
DIFY_BRIDGE_BASE_URL=http://host.docker.internal:8787
DIFY_AGENTS_MD_PATH=auto
DIFY_RESPONSE_MODE=streaming
```

## GitLab `docker-compose.yml` (minimal)

Place in **any** directory the user chooses:

```yaml
services:
  gitlab:
    image: gitlab/gitlab-ce:latest
    container_name: gitlab
    hostname: localhost
    restart: unless-stopped
    environment:
      GITLAB_OMNIBUS_CONFIG: |
        external_url 'http://localhost:8929'
        nginx['listen_port'] = 8929
        nginx['listen_https'] = false
        gitlab_rails['gitlab_shell_ssh_port'] = 2224
        puma['worker_processes'] = 2
        sidekiq['max_concurrency'] = 10
        prometheus_monitoring['enable'] = false
    ports:
      - "8929:8929"
      - "2224:22"
    volumes:
      - ./config:/etc/gitlab
      - ./logs:/var/log/gitlab
      - ./data:/var/opt/gitlab
    shm_size: "256m"
```

## Dify docker `.env` knobs

```env
SECRET_KEY=
SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
SSRF_PROXY_ALLOW_PRIVATE_IPS=192.168.65.2,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
APP_MAX_EXECUTION_TIME=7200
```
