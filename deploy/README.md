# Deploy helpers (Docker Compose)

Portable compose files so anyone can bring up the local Agent Studio dependencies
without hunting personal install directories.

| Path | Service | Host ports |
|------|---------|------------|
| [`mysql/docker-compose.yml`](./mysql/docker-compose.yml) | MySQL 8.4 | **3316** |
| [`gitlab/docker-compose.yml`](./gitlab/docker-compose.yml) | GitLab CE | **8929**, SSH **2224** |

Agent Studio app processes (API / Web / Bridge) run on the host via npm — see
[`skills/local-stack-setup`](../skills/local-stack-setup/).

> Dify Compose 已从本仓库移除（`v2`：Studio orchestrator 直连 Bridge）。

## Quick start (repo root)

```bash
# 1) MySQL
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql

# 2) GitLab（可选；开 MR / SSH 推送时需要；首次启动较慢）
docker compose -f deploy/gitlab/docker-compose.yml up -d
```

## Docs

- Skill: [`skills/local-stack-setup/`](../skills/local-stack-setup/)
- Human guides: [`docs/环境配置指南.md`](../docs/环境配置指南.md), [`docs/本地GitLab搭建指南.md`](../docs/本地GitLab搭建指南.md)
