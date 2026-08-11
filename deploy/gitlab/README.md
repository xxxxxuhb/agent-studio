# GitLab CE (Docker) — Agent Studio

```bash
docker compose -f deploy/gitlab/docker-compose.yml up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health
```

- Web: http://localhost:8929  
- SSH: `ssh://git@localhost:2224/<group>/<repo>.git`  
- Container: `agent-studio-gitlab`

Initial root password (first boot):

```bash
docker exec -it agent-studio-gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

Create blank projects in the UI; point Studio「项目」`remote_url` at them.
Bot SSH / PAT: see `docs/环境配置指南.md`.
