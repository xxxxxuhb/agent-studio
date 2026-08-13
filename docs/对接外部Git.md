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

## 5. 常见问题

| 现象 | 排查 |
|------|------|
| `Permission denied (publickey)` | 公钥是否挂到 Forge；`BRIDGE_GIT_SSH_KEY` / 端口是否匹配 remote |
| 能 push 不开 MR | `GITLAB_TOKEN` / `GITHUB_TOKEN` 权限；`BRIDGE_GITLAB_API`/`WEB` 是否指向同一实例 |
| 仍在找 `deploy/gitlab` | 已移除；改配外部 Forge，见上文 |
