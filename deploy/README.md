# Deploy helpers (Docker Compose)

Portable compose so anyone can bring up **MySQL** for local Agent Studio
without hunting personal install directories.

| Path | Service | Host ports |
|------|---------|------------|
| [`mysql/docker-compose.yml`](./mysql/docker-compose.yml) | MySQL 8.4 | **3316** |
| [`docker-compose.yml`](./docker-compose.yml) | unified entry (MySQL) | **3316** |

Agent Studio app processes (API / Web / Bridge) run on the host via npm — see
[`skills/local-stack-setup`](../skills/local-stack-setup/) or
[`scripts/bootstrap-dev.sh`](../scripts/bootstrap-dev.sh).

> 本仓库**不再内置 GitLab Compose**（`deploy/gitlab` 已删除）。Push / MR 请对接
> 你们已有的 GitLab / GitHub；配置见 [`docs/对接外部Git.md`](../docs/对接外部Git.md)。
>
> Dify Compose 同样已移除（`v2`：Studio orchestrator 直连 Bridge）。

## Quick start (repo root)

```bash
./scripts/bootstrap-dev.sh
# or:
docker compose -f deploy/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

Standalone MySQL file still works:

```bash
docker compose -f deploy/mysql/docker-compose.yml up -d
```

## Docs

- Skill: [`skills/local-stack-setup/`](../skills/local-stack-setup/)
- Human guides: [`docs/环境配置指南.md`](../docs/环境配置指南.md), [`docs/对接外部Git.md`](../docs/对接外部Git.md)
