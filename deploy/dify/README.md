# Dify (Docker) — Agent Studio

Vendored from **Dify `1.16.1`** official `docker/` tree (see `DIFY_VERSION`).
Runtime data stays in local `volumes/` (gitignored).

Upstream project: https://github.com/langgenius/dify

## Start

From **this directory** (`deploy/dify`):

```bash
cp .env.example .env

# Required Agent Studio knobs — merge into .env:
#   SECRET_KEY=<openssl rand -base64 42>
#   SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
#   SSRF_PROXY_ALLOW_PRIVATE_IPS=192.168.65.2,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
#   APP_MAX_EXECUTION_TIME=7200
#
# Or append the snippet:
cat .env.agent-studio.example >> .env
# then edit SECRET_KEY to a real random value

docker compose up -d
```

From repo root:

```bash
docker compose -f deploy/dify/docker-compose.yaml --project-directory deploy/dify up -d
```

(`--project-directory` keeps relative volume/nginx paths correct.)

Browser: http://localhost — register the first admin.

## Bridge from Dify

Use **`http://host.docker.internal:8787`** in HTTP nodes / Studio `DIFY_BRIDGE_BASE_URL`.
`docker-compose.override.yml` adds `extra_hosts` so containers resolve the host gateway.

## Upgrade

Replace this tree from a newer Dify release `docker/` folder (exclude `volumes/`,
`.env`, personal patches). Keep `.env.agent-studio.example` and
`docker-compose.override.yml` from Agent Studio.

## Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost/
curl -sS http://127.0.0.1:8787/health
```
