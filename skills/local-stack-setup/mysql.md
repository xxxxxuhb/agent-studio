# MySQL (Docker) — Agent Studio

Recommended for all local setups. Host port **3316** → container **3306**.

## Start

From monorepo root:

```bash
docker compose -f deploy/mysql/docker-compose.yml up -d
docker compose -f deploy/mysql/docker-compose.yml ps
```

Alias: `apps/studio-api/docker-compose.mysql.yml` (same content).

Wait until health is healthy (`mysqladmin ping` via compose healthcheck).

## Schema

```bash
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

Idempotent. Tables: `users`, `teams`, `team_members`, `projects`, `work_orders`, `run_logs`, `run_log_entries`, `digital_humans`, `pipelines`, `bridges`.

## Studio API `.env`

```bash
STUDIO_MYSQL_HOST=127.0.0.1
STUDIO_MYSQL_PORT=3316
STUDIO_MYSQL_USER=root
STUDIO_MYSQL_PASSWORD=123456
STUDIO_MYSQL_DATABASE=agent_studio
```

## Notes for the agent

- Prefer `deploy/mysql/docker-compose.yml`.
- Do not require host MySQL on 3306.
- After schema apply, restart Studio API so bootstrap can create admin + default team.
