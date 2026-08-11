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

Tables: `users`, `teams`, `team_members`, `projects`, `work_orders`, `run_logs`, `run_log_entries`, `digital_humans`, `pipelines`, `bridges`.

Connection settings: `apps/studio-api/.env` (`STUDIO_MYSQL_*`).  
Compose: [`deploy/mysql`](../../deploy/mysql/) · Skill [`skills/local-stack-setup/mysql.md`](../../../skills/local-stack-setup/mysql.md).

On API boot, leftover YAML under `data/{agents,pipelines,bridges,projects,work-orders,run-logs}` is **imported once** into MySQL (source files kept; not runtime storage).

## Backup

```bash
# Core business data (share this dump across API instances)
mysqldump -h 127.0.0.1 -P 3316 -u root -p123456 \
  --single-transaction --routines --triggers agent_studio \
  > agent_studio-$(date +%Y%m%d).sql
```

Also back up live files (not in MySQL yet):

- `apps/studio-api/data/team-settings/`
- `apps/studio-api/data/team-secrets/` (0600; per-team Dify/Git overlays)
- `apps/studio-api/data/work-order-chats/`
- `apps/studio-api/data/dify-config.yaml`
- `apps/studio-api/data/dify-secrets.yaml` (0600)
- `apps/studio-api/data/studio-config.yaml`

Legacy dirs `data/{agents,pipelines,bridges,projects,work-orders,run-logs}` can be archived/deleted after a successful migrate; they are not the source of truth.

Team secret rotation / least privilege: [`docs/团队密钥与轮换.md`](../../docs/团队密钥与轮换.md).

## Multi-instance

- Run multiple Studio API processes against **one** MySQL.
- Do **not** sync or share `data/{agents,pipelines,bridges}` between instances (unused at runtime).
- Mount or share sticky volumes for the live file dirs above (settings / secrets / chats) until those move to MySQL.
- Bridge workspace (`BRIDGE_REPOS_DIR`) lives on the executor host, not on the API disk.
