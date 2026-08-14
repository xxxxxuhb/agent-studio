# 对接外部 Git（GitLab / GitHub）

本仓库**不再内置 GitLab Docker Compose**（`deploy/gitlab` 已删除）。  
本地栈只负责 MySQL + Studio + Bridge；代码托管用你们已有的 Forge。

相关：[`环境配置指南.md`](./环境配置指南.md) · [`deploy/README.md`](../deploy/README.md) · Skill [`skills/local-stack-setup/`](../skills/local-stack-setup/)

---

## 1. 本地栈（无 Forge）

```bash
./scripts/bootstrap-dev.sh
# MySQL :3316 → API :8790 → Web :5173 → Bridge :8787
```

纯改文件 / 跑 Agent、不 push 时，不必配 Git。

---

## 2. Bridge → 外部 GitLab

在 `apps/studio-bridge/.env`（或执行机 `.env`）填写**你们实例**的地址与 bot 凭证：

```bash
BRIDGE_GIT_AUTHOR_NAME=agent-studio-bot
BRIDGE_GIT_AUTHOR_EMAIL=bot@example.com
BRIDGE_GIT_FORCE_AUTHOR=true
BRIDGE_GIT_PREFER_SSH=true
BRIDGE_GIT_SSH_KEY=~/.ssh/agent_studio_bot
BRIDGE_GIT_SSH_PORT=22          # 自建若映射了非 22，改成实际端口
BRIDGE_GIT_SSH_USER=git
BRIDGE_GIT_PUSH=true
BRIDGE_GIT_CREATE_PR=true

GITLAB_TOKEN=glpat-…           # bot PAT：api + write_repository
BRIDGE_GITLAB_API=https://gitlab.example.com/api/v4
BRIDGE_GITLAB_WEB=https://gitlab.example.com
```

Studio 项目里的 `remote_url` 用同一套可达地址，例如：

```text
ssh://git@gitlab.example.com/<group>/<repo>.git
# 或 https://gitlab.example.com/<group>/<repo>.git（仍建议 prefer SSH）
```

检查：

```bash
ssh -T -p 22 -i ~/.ssh/agent_studio_bot git@gitlab.example.com
curl -sS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" https://gitlab.example.com/api/v4/user
```

---

## 3. Bridge → GitHub

```bash
GITHUB_TOKEN=ghp-…             # 或 BRIDGE_GITHUB_TOKEN
# api.github.com 为默认；GitHub Enterprise 再按需设兼容 base
BRIDGE_GIT_CREATE_PR=true
```

Remote 形如 `git@github.com:org/repo.git`。

---

## 4. Studio 侧（可选）

UI「设置」或 `STUDIO_GIT_*`：仅影响 Studio 本机调试克隆（`ensureCloned`）。  
**工单工作区与 push/MR 始终在 Bridge 主机**，以 Bridge `.env` 为准。

---

## 5. 入站 Webhook / 定时开工单

Studio 可按流水线 `triggers` 自动 **创建并启动** 工单（不经 JWT）。

### Forge webhook

```http
POST /api/webhooks/pipelines/{pipelineId}/forge
X-Gitlab-Token: <secret>          # GitLab
# 或 X-Studio-Webhook-Token: <secret>
# 或 X-Hub-Signature-256: sha256=…  # GitHub HMAC
```

Secret 优先级：触发器 `secret` → 团队 YAML `forge_webhook_secret` → 环境变量 `STUDIO_FORGE_WEBHOOK_SECRET`。

流水线示例（保存到 pipeline.triggers）：

```json
[{
  "id": "mr_done",
  "kind": "forge_webhook",
  "enabled": true,
  "forge": "gitlab",
  "events": ["mr_merged", "issue_labeled"],
  "labels": ["agent-studio"],
  "action": "create_and_start",
  "project_id": "",
  "auto_approve": false,
  "secret": "change-me",
  "title_template": "{{event}} · {{title}}",
  "requirement_template": "{{url}}\n\n{{body}}"
}]
```

`action`：

- `create_and_start`（默认）：新建工单并启动流水线。
- `advance`：推进该流水线上处于 `waiting`、且当前步为匹配的 `wait_event` 的工单（用于「等 MR 合并」类步骤）。

支持事件：`mr_merged`（GitLab MR merge / GitHub PR merged）、`issue_labeled`。

### Cron

```json
[{
  "id": "weekday_morning",
  "kind": "cron",
  "enabled": true,
  "cron": "0 9 * * 1-5",
  "project_id": "",
  "auto_approve": false,
  "title_template": "定时 · {{pipeline}} · {{time}}"
}]
```

API 进程内每 30s 扫一次（`STUDIO_TRIGGERS_CRON=false` 可关）。五段 cron：`分 时 日 月 周`。

---

## 6. 常见问题

| 现象 | 排查 |
|------|------|
| `Permission denied (publickey)` | 公钥是否挂到 Forge；`BRIDGE_GIT_SSH_KEY` / 端口是否匹配 remote |
| 能 push 不开 MR | `GITLAB_TOKEN` / `GITHUB_TOKEN` 权限；`BRIDGE_GITLAB_API`/`WEB` 是否指向同一实例 |
| 仍在找 `deploy/gitlab` | 已移除；改配外部 Forge，见上文 |
| webhook 401 | secret 是否与 `X-Gitlab-Token` / `STUDIO_FORGE_WEBHOOK_SECRET` 一致 |
| cron 不触发 | 流水线 `enabled` + trigger `enabled`；API 进程是否在跑；`cron` 五段是否匹配本机时区 |
