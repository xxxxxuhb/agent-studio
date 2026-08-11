# Studio API SQL

Single entrypoint + Docker MySQL:

| File | Purpose |
|------|---------|
| [`init.sql`](./init.sql) | Create DB `agent_studio` + tables |
| [`../docker-compose.mysql.yml`](../docker-compose.mysql.yml) | MySQL 8.4 on host port **3316** |

```bash
# start MySQL
docker compose -f deploy/mysql/docker-compose.yml up -d

# apply schema (idempotent)
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

Tables: `users`, `teams`, `team_members`, `projects`, `work_orders`, `run_logs`, `run_log_entries`.

Connection settings: `apps/studio-api/.env` (`STUDIO_MYSQL_*`).  
Compose: [`deploy/mysql`](../../deploy/mysql/) · Skill [`skills/local-stack-setup/mysql.md`](../../../skills/local-stack-setup/mysql.md).
