# 本地 GitLab 搭建指南

目标：**用仓库 Compose 把 GitLab（可选）和 MySQL 跑通，接到 Agent Studio + Bridge**。

> `v2` 起工单由 Studio orchestrator 直连 Bridge，**不再部署 Dify**（`deploy/dify` 已删除）。

Studio 的 `.env`、SSH bot、Cursor Key：见 [环境配置指南.md](./环境配置指南.md)。  
Compose 总览：[`deploy/README.md`](../deploy/README.md)。  
Agent 流程：Skill [`skills/local-stack-setup/`](../skills/local-stack-setup/)。

---

## 0. 链路与地址

```text
浏览器
  ├─ Agent Studio Web  :5173
  ├─ Agent Studio API  :8790
  ├─ MySQL (Docker)    :3316   ← deploy/mysql
  ├─ Bridge            :8787
  └─ GitLab            :8929   ← deploy/gitlab（SSH :2224，可选）
```

| 调用方 | 访问 | 地址 |
|--------|------|------|
| 浏览器 | GitLab | `http://localhost:8929` |
| Studio API | MySQL | `127.0.0.1:3316` |
| Studio API / 本机 | Bridge | `http://127.0.0.1:8787` |
| Bridge | GitLab API | `http://localhost:8929/api/v4` |
| Bridge / git | GitLab SSH | `ssh://git@localhost:2224/<group>/<repo>.git` |

---

## 1. 前提

- Docker Desktop（或等价环境）
- 端口空闲：

| 端口 | 服务 | Compose |
|------|------|---------|
| **3316** | MySQL | `deploy/mysql/docker-compose.yml` |
| 8929 | GitLab HTTP | `deploy/gitlab/docker-compose.yml` |
| 2224 | GitLab SSH | 同上 |
| 8787 | Bridge | 本机 npm |
| 8790 | Studio API | 本机 npm |
| 5173 | Studio Web | 本机 npm |

```bash
lsof -nP -iTCP:3316,8929,2224,8787,8790,5173 -sTCP:LISTEN
```

---

## 2. MySQL

```bash
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

细节：[环境配置指南.md §1.1](./环境配置指南.md)。

---

## 3. GitLab（可选）

开 MR / SSH 推送时需要；纯本地改文件可先不启。

```bash
docker compose -f deploy/gitlab/docker-compose.yml up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health   # 期望 200
```

首次启动较慢。浏览器打开 http://localhost:8929  

初始 root 密码：

```bash
docker exec -it agent-studio-gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

登录后改密码。在 UI 建空白项目，记下 clone URL，填进 Studio「项目」的 `remote_url`。每个业务仓根目录需要 `AGENTS.md`。

机器人 SSH / PAT：见 [环境配置指南.md §4](./环境配置指南.md)。

自检：

```bash
curl -sS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" http://localhost:8929/api/v4/user | head
export GIT_SSH_COMMAND='ssh -i ~/.ssh/agent_studio_bot -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
git ls-remote ssh://git@localhost:2224/<group>/<repo>.git HEAD
```

---

## 4. Studio + Bridge

```bash
cp apps/studio-api/.env.example apps/studio-api/.env
cp apps/studio-bridge/.env.example apps/studio-bridge/.env
# 对齐 STUDIO_BRIDGE_TOKEN / BRIDGE_HTTP_TOKEN；MySQL 端口 3316

npm run build:schema
npm run build -w @agent-studio/orchestrator
npm run dev:api
npm run dev:web
npm run dev:bridge
```

设置页配置 `bridge_base_url`（本机 `http://127.0.0.1:8787`）。工单「开始流水线」走 Studio 编排，不再依赖 Dify。

---

## 5. 推荐启动顺序

1. MySQL + `init.sql`  
2.（可选）GitLab  
3. Bridge → Studio API → Web  

完整环境变量见 [环境配置指南.md](./环境配置指南.md)。
