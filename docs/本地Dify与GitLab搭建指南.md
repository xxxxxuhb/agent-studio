# 本地 Dify 与 GitLab 搭建指南（小白向）

目标：**用仓库里的 Compose 把 GitLab、Dify、MySQL 跑通，并接到 Agent Studio**。

Studio 的 `.env`、SSH bot、Cursor Key 见：[环境配置指南.md](./环境配置指南.md)。  
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
  ├─ Dify              :80     ← deploy/dify
  └─ GitLab            :8929   ← deploy/gitlab（SSH :2224）
```

| 调用方 | 访问 | 地址 |
|--------|------|------|
| 浏览器 | Dify | `http://localhost` |
| 浏览器 | GitLab | `http://localhost:8929` |
| Studio API | MySQL | `127.0.0.1:3316` |
| Studio API | Dify App API | `http://localhost/v1` |
| Dify 容器内 HTTP 节点 | Bridge | **`http://host.docker.internal:8787`** |
| 本机 curl | Bridge | `http://127.0.0.1:8787` |
| Bridge | GitLab API | `http://localhost:8929/api/v4` |
| Bridge / git | GitLab SSH | `ssh://git@localhost:2224/<group>/<repo>.git` |

容器里的 `127.0.0.1` 不是宿主机。Dify → Bridge 必须用 `host.docker.internal`。

---

## 1. 前提

- Docker Desktop（或等价环境）
- 端口空闲：

| 端口 | 服务 | Compose |
|------|------|---------|
| **3316** | MySQL | `deploy/mysql/docker-compose.yml` |
| 80 | Dify | `deploy/dify/` |
| 8929 | GitLab HTTP | `deploy/gitlab/docker-compose.yml` |
| 2224 | GitLab SSH | 同上 |
| 8787 | Bridge | 本机 npm |
| 8790 | Studio API | 本机 npm |
| 5173 | Studio Web | 本机 npm |

```bash
lsof -nP -iTCP:80,3316,8929,2224,8787,8790,5173 -sTCP:LISTEN
```

---

## 2. MySQL

```bash
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql
```

细节：[环境配置指南.md §1.1](./环境配置指南.md)。

---

## 3. GitLab

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

## 4. Dify

仓库已 vendored **Dify 1.16.1** 官方 `docker/`（见 `deploy/dify/DIFY_VERSION`）：

```bash
cd deploy/dify
cp .env.example .env
cat .env.agent-studio.example >> .env
# 编辑 .env：把 SECRET_KEY 改成 `openssl rand -base64 42` 的结果
docker compose up -d
cd ../..
```

浏览器：http://localhost → 注册管理员。

### 必改项（已写在 `.env.agent-studio.example`）

```env
SECRET_KEY=<openssl rand -base64 42 生成>
SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
SSRF_PROXY_ALLOW_PRIVATE_IPS=192.168.65.2,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
APP_MAX_EXECUTION_TIME=7200
```

- `SECRET_KEY` 为空 → 登录后协作 WS /「同步数据」401  
- 改完重建相关服务，并清掉浏览器 localhost 站点数据后重登  
- SSRF 不放行 → HTTP 节点访问 Bridge 被拦  
- **注意**：若错误文案是 `blocked by SSRF protection` 且 URL 为 `host.docker.internal:8787/runs`，优先查 Bridge **HTTP token**（常被误报）；见 [问题记录.md](./问题记录.md)

`docker-compose.override.yml` 已为容器加上 `host.docker.internal:host-gateway`。

### Bridge 地址

| 场景 | 填写 |
|------|------|
| Dify 节点 / `bridge_base_url` | `http://host.docker.internal:8787` |
| 本机 curl | `http://127.0.0.1:8787` |

先保证：`curl -sS http://127.0.0.1:8787/health`

### 接到 Studio

创建或导入 Workflow，复制 App Key（`app-...`）。

- **设置页**：启用 Dify，`api_base=http://localhost/v1`，填 Key，`bridge_base_url=http://host.docker.internal:8787`  
- 或写 `apps/studio-api/.env` 的 `DIFY_*`

---

## 5. 推荐启动顺序

1. Docker 已开  
2. `deploy/mysql` up + `init.sql`  
3. `deploy/gitlab` up  
4. `deploy/dify` up  
5. Agent Studio：API / Web / Bridge（改 `.env` 后重启对应进程）  
6. 健康检查：MySQL、GitLab、Dify、`8787/health`、`8790/api/health`、Web 登录选团队  

同一时刻只跑 **一个** Bridge 占用 `:8787`。

---

## 6. 检查清单

- [ ] MySQL `:3316` + `SHOW TABLES FROM agent_studio`  
- [ ] GitLab `http://localhost:8929` 可登录  
- [ ] SSH `2224` 对目标仓 `git ls-remote` 成功（若要用 push）  
- [ ] `GITLAB_TOKEN` 可调 `/api/v4/user`（若要开 MR）  
- [ ] Dify 可登录，`SECRET_KEY` 已设，SSRF 已放行  
- [ ] Bridge health OK；Dify 侧用 `host.docker.internal:8787`  
- [ ] Studio 已启用 Dify 并填好 `app-` Key  
- [ ] 项目 remote 指向本机 GitLab；工作副本根目录有 `AGENTS.md`  

环境变量细节：[环境配置指南.md](./环境配置指南.md)。
