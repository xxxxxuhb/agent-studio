# Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Bridge `401 unauthorized` from Dify/Studio | Missing Bearer token | Set same `STUDIO_BRIDGE_TOKEN` / `BRIDGE_HTTP_TOKEN` on Bridge + Studio; pass `bridge_token` in workflow inputs; re-import DSL with Authorization header |
| GitLab blank / slow first boot | Omnibus still initializing | Wait; check `docker compose logs`; ensure enough Docker RAM |
| `Permission denied (publickey)` | Key not on GitLab / wrong port / HTTP remote | Upload pubkey; use `ssh://git@localhost:2224/...`; set `BRIDGE_GIT_SSH_*` |
| Dify editor “同步” / WS 401 | Empty `SECRET_KEY` | Set key, recreate API/ws services, clear localhost cookies |
| SSRF blocked `host.docker.internal` | Allowlist missing | Set `SSRF_PROXY_ALLOW_PRIVATE_DOMAINS` (+ IPs if needed), recreate |
| Dify HTTP node can’t reach Bridge | Used `127.0.0.1` inside container | Use `http://host.docker.internal:8787` |
| Port already in use | Second Bridge / old process | `lsof -iTCP:8787 -sTCP:LISTEN`; keep a single Bridge |
| Commit author is personal name | Bot env not loaded / not forced | Restart Bridge; check log for `git bot identity`; `BRIDGE_GIT_FORCE_AUTHOR=true` |
| Push OK, no MR | Missing/invalid `GITLAB_TOKEN` or API URL | Token needs `api`; set `BRIDGE_GITLAB_API` / `WEB`; `BRIDGE_GIT_CREATE_PR` not false |
| Studio can’t talk to Dify | Wrong `api_base` / App Key | `http://localhost/v1` + `app-...`; enable in 设置 or `.env` |

Do not dig through unrelated personal repos unless the user points to them.
