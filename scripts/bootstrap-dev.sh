#!/usr/bin/env bash
# Bootstrap local Agent Studio deps (MySQL only). No Dify / no bundled GitLab.
#
# Usage (repo root):
#   ./scripts/bootstrap-dev.sh
#   SKIP_INIT_SQL=1 ./scripts/bootstrap-dev.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="deploy/docker-compose.yml"

copy_env() {
  local example="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    echo "    keep $dest"
  elif [[ -f "$example" ]]; then
    cp "$example" "$dest"
    echo "    created $dest from example"
  else
    echo "    skip (missing $example)"
  fi
}

echo "==> Env templates"
copy_env "apps/studio-api/.env.example" "apps/studio-api/.env"
copy_env "apps/studio-bridge/.env.example" "apps/studio-bridge/.env"

echo "==> Docker Compose up (MySQL)"
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Wait for MySQL"
for i in $(seq 1 60); do
  if docker exec agent-studio-mysql mysqladmin ping -h 127.0.0.1 -uroot -p123456 --silent 2>/dev/null; then
    echo "    MySQL ready"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "MySQL did not become healthy in time" >&2
    exit 1
  fi
  sleep 1
done

if [[ "${SKIP_INIT_SQL:-0}" != "1" ]]; then
  echo "==> Apply init.sql"
  mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
  echo "    tables applied"
else
  echo "==> Skip init.sql (SKIP_INIT_SQL=1)"
fi

cat <<EOF

==> Next steps (host processes — not in Compose)

  npm run build:schema
  npm run build -w @agent-studio/orchestrator
  npm run start -w @agent-studio/studio-api    # :8790
  npm run dev -w @agent-studio/studio-web      # :5173
  npm run dev:bridge                           # :8787
  # or: npm run build -w @agent-studio/bridge && npm run dev:bridge-desktop

Health checks:
  curl -sS http://127.0.0.1:8790/api/health
  curl -sS http://127.0.0.1:8787/health

Git push / MR: point Bridge at your company GitLab or GitHub
  → docs/对接外部Git.md

Docs: docs/环境配置指南.md (L0–L2), deploy/README.md
EOF
