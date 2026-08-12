# Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| API fails to boot / TypeORM connection refused | MySQL not up or wrong port | `docker compose -f deploy/mysql/docker-compose.yml up -d`; `.env` port **3316** |
| `Table 'agent_studio.xxx' doesn't exist` | Schema not applied | `mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql` |
| Login 401 / no admin | Empty wrong DB or password | Check `STUDIO_MYSQL_*`; first boot creates admin only when `users` is empty |
| Login OK but empty teams / resources | Didn’t select team / not a member | Open `/select-team`; admin: 团队管理 add self or create team |
| `viewer` cannot save | Expected | viewer is read-only; use member/owner |
| Bridge `401 unauthorized` from Studio | Missing Bearer token | Same `STUDIO_BRIDGE_TOKEN` / `BRIDGE_HTTP_TOKEN` on Bridge + Studio |
| GitLab blank / slow first boot | Omnibus still initializing | Wait; `docker compose -f deploy/gitlab/docker-compose.yml logs`; enough Docker RAM |
| `Permission denied (publickey)` | Key not on GitLab / wrong port / HTTP remote | Upload pubkey; use `ssh://git@localhost:2224/...`; set `BRIDGE_GIT_SSH_*` |
| Port already in use | Second Bridge / old API / host MySQL | Check 8787 / 8790 / 3316 / 8929 |
| Commit author is personal name | Bot env not loaded / not forced | Restart Bridge; `BRIDGE_GIT_FORCE_AUTHOR=true` |
| Push OK, no MR | Missing/invalid `GITLAB_TOKEN` or API URL | Token needs `api`; set `BRIDGE_GITLAB_API` / `WEB` |
| Looking for `deploy/dify` | Removed in v2 | Use Studio orchestrator; see `docs/本地GitLab搭建指南.md` |
| Run logs / work orders / pipelines / humans / bridges missing after upgrade | Old YAML only | Restart API once so bootstrap migrates; confirm MySQL tables |

Do not dig through unrelated personal repos unless the user points to them.
