# Agent Studio

独立的 **数字人（Agent）管理系统** + **可插拔 Bridge 执行层**。

- Monorepo（npm workspaces）
- 后端：NestJS（`apps/studio-api`）
- 前端：React + Vite（`apps/studio-web`）
- Bridge：Fastify（`apps/studio-bridge`）— Dify HTTP 编排的执行端
- Agent 运行时：`packages/agent-runtime`（可切换 cursor / trae / qoder / 自定义驱动）
- 共享契约：`packages/agent-schema`
- 示例仓：`examples/demo-repo`

## 目录

```text
apps/studio-api        NestJS API :8790
apps/studio-web        React UI   :5173
apps/studio-bridge     Bridge API :8787
packages/agent-schema  Zod / 类型
packages/agent-runtime 可插拔 Agent 驱动
examples/demo-repo     示例 AGENTS.md 目标仓
```

## 启动

```bash
npm install
npm run build:schema
npm run build:runtime

# MySQL（必做，Docker）
docker compose -f deploy/mysql/docker-compose.yml up -d
mysql -h 127.0.0.1 -P 3316 -u root -p123456 < apps/studio-api/sql/init.sql

# 复制并编辑环境变量
cp apps/studio-api/.env.example apps/studio-api/.env
cp apps/studio-bridge/.env.example apps/studio-bridge/.env

npm run dev:api      # 终端 1
npm run dev:web      # 终端 2
npm run dev:bridge   # 终端 3（Dify 执行需要）
```

- MySQL：`127.0.0.1:3316`（容器 `agent-studio-mysql`）
- API：http://127.0.0.1:8790/api/health  
- 管理台：http://127.0.0.1:5173 （登录 → 选团队）  
- Bridge：http://127.0.0.1:8787/health  

更完整的本地搭建与环境变量说明：

- [docs/环境配置指南.md](docs/环境配置指南.md)
- [docs/本地Dify与GitLab搭建指南.md](docs/本地Dify与GitLab搭建指南.md)
- [docs/架构与时序图.md](docs/架构与时序图.md)
- 项目 Skill：[skills/local-stack-setup/](skills/local-stack-setup/)（含 [mysql.md](skills/local-stack-setup/mysql.md)）
- Docker Compose：[`deploy/`](deploy/)（MySQL / GitLab / Dify）

## Agent 驱动切换

Bridge **不内嵌模型调用**；阶段执行委托给 `@agent-studio/agent-runtime`：

| `AGENT_DRIVER` | 行为 |
|----------------|------|
| `auto`（默认） | 本机第一个可用：cursor → trae → qoder |
| `cursor` | Cursor Agent SDK（本机改仓） |
| `trae` | TraeCode CLI |
| `qoder` | Qoder Agent SDK |
| `openai` | 占位，待实现 |

自定义驱动：见 `packages/agent-runtime/README.md`。

## API（节选）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 健康检查 |
| GET/POST/PUT/PATCH/DELETE | `/api/digital-humans...` | 数字人 CRUD |
| GET/POST/PUT/PATCH/DELETE | `/api/pipelines...` | 流水线 CRUD |
| GET/POST/PUT/DELETE | `/api/projects...` | 项目 / 多仓 / clone |
| GET | `/api/run-logs` | 运行日志列表（按 run_id） |
| GET | `/api/run-logs/:runId` | 某次运行的全部日志 |
| GET/POST/DELETE | `/api/bridges...` | 执行器注册 / 心跳 / 列表 |
| GET/PUT/POST | `/api/work-orders...` | 工单 / 启动 / 重启 / 同步 Dify |
| GET/PUT | `/api/dify/config` | Dify 连接配置 |
| POST | `/api/dify/console/login` | Console 邮箱密码登录 |

Bridge（Dify HTTP 节点调用）：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 含 `driver` / `dryRun` |
| POST | `/routing/select` | 总管选仓 |
| POST | `/runs` | 创建 run + manager（`routing_mode=explicit` 时不自动改道） |
| POST | `/runs/:id/:stage` | 执行阶段 |
| POST | `/runs/:id/decision` | approve / reject |

## 项目管理与克隆

1. 在 **项目** 页配置 `clone_root`（可选）与多个 git remote。  
2. 点击「克隆/同步」或启动绑定该项目的工单时：路径已存在且含 `.git` → 跳过；否则 `git clone`。  
3. 工单绑定 `project_id` 后，启动时由 **总管 Agent**（Bridge `/routing/select`）决定改哪个仓，再把 `agents_md_path` + `routing_mode=explicit` 交给 Bridge。  

默认克隆根目录（可用 `STUDIO_REPOS_DIR` 覆盖）：

- macOS / Linux：`~/AgentStudio/{project.id}`（Finder：用户 → 你的账号 → AgentStudio）
- Windows：`C:\.agent-studio\{project.id}`

## 执行器 Bridge（CLI）

控制面（Studio）与执行面分离。在执行机上：

```bash
npx @agent-studio/bridge start --driver cursor \
  --studio-url http://<studio>:8790 \
  --token <STUDIO_BRIDGE_TOKEN> \
  --public-url http://<executor-ip>:8787
```

不传 `--driver` 时会交互选择 `auto | cursor | trae | qoder | openai`。  
本地调试仍可用 `npm run dev:bridge`（薄封装同一包）。

侧栏 **执行器** 页可查看已注册 Bridge 及其 Agent 类型。

## Dify 接入

1. 设置页配置 `api_base` + App Key，启用 Dify；`bridge_base_url` 默认 `http://host.docker.internal:8787`。  
2. 工单以 **Dify Workflow** 启动；Human Input 可在 Studio 确认。  
3. 流水线页可生成/导入 DSL；详情页有运行日志。  

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `STUDIO_API_PORT` | `8790` | API 端口 |
| `STUDIO_LANGUAGE` | `zh` | Agent 产出语言 |
| `STUDIO_PROJECT_DIR` | `data/projects` | 项目 YAML |
| `STUDIO_REPOS_DIR` | macOS/Linux `~/AgentStudio`；Windows `C:\.agent-studio` | 默认 git 克隆根目录（不在本仓库内） |
| `STUDIO_RUN_LOG_DIR` | `data/run-logs` | 按 run_id 的运行日志 |
| `STUDIO_BRIDGE_TOKEN` / `BRIDGE_HTTP_TOKEN` | — | Bridge 注册 + HTTP 鉴权（Dify/Studio → Bridge Bearer） |
| `DIFY_*` | — | 见设置页 / `.env.example`；密钥优先 env 或 `data/dify-secrets.yaml` |
| `AGENT_DRIVER` | `auto` | Bridge 使用的 agent 驱动 |
| `CURSOR_API_KEY` | — | cursor 驱动 |
| `BRIDGE_PORT` | `8787` | Bridge 端口 |
| `BRIDGE_WORKSPACE_ROOTS` | `examples/` | 无项目绑定时扫描 AGENTS.md |
| `BRIDGE_GIT_AUTHOR_NAME` / `EMAIL` | bot@… | 提交作者（覆盖本机 `user.name`） |
| `BRIDGE_GIT_SSH_KEY` | — | Bot SSH 私钥；存在则自动 prefer SSH |
| `BRIDGE_GIT_SSH_PORT` | — | 非 22 时写成 `ssh://git@host:PORT/…`（本地 GitLab 常为 `2224`） |
| `BRIDGE_GIT_PREFER_SSH` | — | 强制 HTTP remote → SSH |
| `GITLAB_TOKEN` | — | 开 MR 用的 bot PAT（建议非 root） |
| `STUDIO_GIT_SSH_*` | — | 可选：Studio UI `ensureCloned` 调试克隆；工单工作区由 Bridge `BRIDGE_GIT_*` / `BRIDGE_REPOS_DIR` 负责 |
