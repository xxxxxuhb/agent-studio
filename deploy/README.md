# Deploy helpers (Docker Compose)

Portable compose files so anyone can bring up the local Agent Studio dependencies
without hunting personal install directories.

| Path | Service | Host ports |
|------|---------|------------|
| [`mysql/docker-compose.yml`](./mysql/docker-compose.yml) | MySQL 8.4 | **3316** |
| [`gitlab/docker-compose.yml`](./gitlab/docker-compose.yml) | GitLab CE | **8929**, SSH **2224** |
| [`dify/`](./dify/) | Dify 1.16.1 official docker tree | **80** |

Agent Studio app processes (API/Web/Bridge) still run on the host via npm — see
[`skills/local-stack-setup`](../skills/local-stack-setup/).

## Quick start (repo root)

```bash
# 1) MySQL
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql

# 2) GitLab (first boot is slow)
docker compose -f deploy/gitlab/docker-compose.yml up -d

# 3) Dify
cd deploy/dify
cp .env.example .env
# merge knobs from .env.agent-studio.example into .env (SECRET_KEY + SSRF)
docker compose up -d
cd ../..
```

## Docs

- Skill: [`skills/local-stack-setup/`](../skills/local-stack-setup/)
- Human guides: [`docs/环境配置指南.md`](../docs/环境配置指南.md), [`docs/本地Dify与GitLab搭建指南.md`](../docs/本地Dify与GitLab搭建指南.md)
