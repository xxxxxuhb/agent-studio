# 本地 Dify 与 GitLab 搭建指南（小白向）

目标：**本机把 GitLab、Dify 跑通，并接到 Agent Studio**。不绑定某台机器上的目录名；compose / Dify 装在哪由你自定。

Studio 的 `.env`、SSH bot、Cursor Key 见：[环境配置指南.md](./环境配置指南.md)。  
Agent 侧流程见项目 Skill：`skills/local-stack-setup/`。

> Agent Studio **不内置** GitLab / Dify 镜像。两套服务需另起，端口建议按下表对齐。

---

## 0. 链路与地址

```text
浏览器
  ├─ Agent Studio Web  :5173
  ├─ Agent Studio API  :8790
  ├─ Bridge            :8787
  ├─ Dify              :80
  └─ GitLab            :8929   （SSH 映射 :2224）
```

| 调用方 | 访问 | 地址 |
|--------|------|------|
| 浏览器 | Dify | `http://localhost` |
| 浏览器 | GitLab | `http://localhost:8929` |
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

| 端口 | 服务 |
|------|------|
| 80 | Dify |
| 8929 | GitLab HTTP |
| 2224 | GitLab SSH → 容器 22 |
| 8787 | Bridge |
| 8790 | Studio API |
| 5173 | Studio Web |

```bash
lsof -nP -iTCP:80,8929,2224,8787,8790 -sTCP:LISTEN
```

---

## 2. GitLab

在**任意目录**放 `docker-compose.yml`：

```yaml
services:
  gitlab:
    image: gitlab/gitlab-ce:latest
    container_name: gitlab
    hostname: localhost
    restart: unless-stopped
    environment:
      GITLAB_OMNIBUS_CONFIG: |
        external_url 'http://localhost:8929'
        nginx['listen_port'] = 8929
        nginx['listen_https'] = false
        gitlab_rails['gitlab_shell_ssh_port'] = 2224
        puma['worker_processes'] = 2
        sidekiq['max_concurrency'] = 10
        prometheus_monitoring['enable'] = false
    ports:
      - "8929:8929"
      - "2224:22"
    volumes:
      - ./config:/etc/gitlab
      - ./logs:/var/log/gitlab
      - ./data:/var/opt/gitlab
    shm_size: "256m"
```

```bash
docker compose up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8929/-/health   # 期望 200
```

首次启动较慢。浏览器打开 http://localhost:8929  

初始 root 密码：

```bash
docker exec -it gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

登录后改密码。在 UI 建空白项目，记下 HTTP clone URL，填进 Studio「项目」的 `remote_url`。每个业务仓根目录需要 `AGENTS.md`。

机器人 SSH / PAT：见 [环境配置指南.md §4](./环境配置指南.md)。

自检：

```bash
curl -sS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" http://localhost:8929/api/v4/user | head
export GIT_SSH_COMMAND='ssh -i ~/.ssh/agent_studio_bot -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
git ls-remote ssh://git@localhost:2224/<group>/<repo>.git HEAD
```

---

## 3. Dify

使用官方发布包里的 `docker` 目录（版本自选）：

```bash
cd <你的-dify-docker目录>
cp .env.example .env   # 若还没有
# 先改必改项，再：
docker compose up -d
```

浏览器：http://localhost → 注册管理员。

### 必改 `.env`

```env
SECRET_KEY=<openssl rand -base64 42 生成>
SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
# 按需：
# SSRF_PROXY_ALLOW_PRIVATE_IPS=192.168.65.2,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
APP_MAX_EXECUTION_TIME=7200
```

- `SECRET_KEY` 为空 → 登录后协作 WS /「同步数据」401  
- 改完重建相关服务，并清掉浏览器 localhost 站点数据后重登  
- SSRF 不放行 → HTTP 节点访问 Bridge 被拦  

### Bridge 地址

| 场景 | 填写 |
|------|------|
| Dify 节点 / `bridge_base_url` | `http://host.docker.internal:8787` |
| 本机 curl | `http://127.0.0.1:8787` |

先保证：`curl -sS http://127.0.0.1:8787/health`

### 接到 Studio

创建或导入 Workflow，复制 App Key（`app-...`）。

- **设置页**：启用 Dify，`api_base=http://localhost/v1`，填 Key，`bridge_base_url=http://host.docker.internal:8787`  
- 或写 `apps/studio-api/.env` 的 `DIFY_*`（见环境配置指南）

配置会落到 `apps/studio-api/data/dify-config.yaml`（含密钥，勿提交）。

---

## 4. 推荐启动顺序

1. Docker 已开  
2. GitLab compose up  
3. Dify compose up  
4. Agent Studio：API / Web / Bridge（改 `.env` 后重启对应进程）  
5. 健康检查：GitLab、Dify、`8787/health`、`8790/api/health`、Web  

同一时刻只跑 **一个** Bridge 占用 `:8787`。

Bridge 日志期望：`git bot identity: ...; ssh_key=true; prefer_ssh=true`（若已配 Git bot）。

---

## 5. 检查清单

- [ ] GitLab `http://localhost:8929` 可登录  
- [ ] SSH `2224` 对目标仓 `git ls-remote` 成功（若要用 push）  
- [ ] `GITLAB_TOKEN` 可调 `/api/v4/user`（若要开 MR）  
- [ ] Dify 可登录，`SECRET_KEY` 已设，SSRF 已放行  
- [ ] Bridge health OK；Dify 侧用 `host.docker.internal:8787`  
- [ ] Studio 已启用 Dify 并填好 `app-` Key  
- [ ] 项目 remote 指向本机 GitLab；工作副本根目录有 `AGENTS.md`  

环境变量细节：[环境配置指南.md](./环境配置指南.md)。
