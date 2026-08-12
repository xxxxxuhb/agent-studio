# Agent Studio — backlog

按优先级：P0 可远程交付 → P1 稳态运维 → P2 扩展能力。已完成项见文末。

## P0 — 可远程交付

### Cloud Bridge（remote executor host）

- [x] Bridge 跑在云 VM / 容器，`BRIDGE_PUBLIC_URL` 对 Studio + Dify 可达；Bridge WS 回连 Studio。
- [x] 仓库工作区归 Bridge 主机（`POST /workspace/ensure` + `BRIDGE_REPOS_DIR`；工单 routing 不再依赖 Studio 本机 `ensureCloned` 路径）。
- [x] Ops：云 `.env`（`CURSOR_API_KEY` / git SSH bot / `GITLAB_TOKEN` / `STUDIO_BRIDGE_TOKEN`）；文档写清局域网 vs 公网 URL + TLS 反代（见 `docs/环境配置指南.md` §3.4）。

Notes (2026-08-11): Cursor/Trae/Qoder 仍是机上 Agent；「云 Bridge」= 远程执行机，不是把 Cursor 嵌进云端 Dify Agent。

### 存储收尾（YAML → MySQL）

- [x] 流水线 / 数字人 / Bridge 登记迁 MySQL（一次性 YAML 导入，源文件保留）。
- [x] 多实例 / 备份策略与 YAML 双轨脱钩（服务去掉 `data/{pipelines,agents,bridges}` 运行时路径；`sql/README.md` 写清 mysqldump + 仍落盘目录）。

### 密钥与租户边界

- [x] Dify / Git 凭证按团队隔离（`data/team-secrets/{teamId}.yaml`；解析优先团队，回退安装级）。
- [x] 团队级密钥轮换与最小权限文档（[`docs/团队密钥与轮换.md`](docs/团队密钥与轮换.md)）。

## P1 — 稳态运维

### Studio 自管编排 + Bridge（减/去掉 Dify）

- [x] **独立包 `packages/orchestrator`（或同名）**：编排器**不进** `studio-api` 业务大服务；Studio 只做鉴权、工单持久化、WebSocket 推送，通过包 API / 薄适配层驱动。
- [x] 包职责：按流水线步骤顺序调 Bridge（ensure → select → stages）；管理 run 状态机（running / pending_approval / failed / completed）；Human Input 暂停与 approve/reject/feedback；失败 resume。
- [x] **Human Input**：阶段 `pendingHumanApproval` → 通知宿主暂停 → 宿主（Studio）给人审 → 回传 decision → 包继续下一 stage（去掉 Dify `form_token` / syncDify / Console DSL）。
- [x] **执行器**：`executor=studio`（默认自研包）；`executor=dify` 短期兼容后弃用。
- [x] **流水线**：Studio/MySQL 存步骤定义；包只消费契约（放 `agent-schema`）；不再强制导入 Dify。
- [ ] **减负**：本地可不启 Dify；Compose profile 只需 MySQL + Studio + Bridge（+ 可选包同进程或侧车）。
- [x] 进程形态二选一写清：先 **库内嵌**（API 进程 `import @agent-studio/orchestrator`），需要再拆独立 worker 进程。
- [ ] （后置）可视化拖拽改图。
- [ ] 阶段中断续跑（resume）仍待做。

Notes (2026-08-12): 首刀已落地：`@agent-studio/orchestrator` + Web 默认 `executor=studio`；Dify 仍可选。审批闸门走 Studio decide → Bridge `/decision` + 下一 stage。

### 工单可靠性

- [x] Dify Human Input / `form_token` 丢失与恢复路径加固（不误清 token、恢复失败可观测、过期重拉、decide 重试、sync 串行）。
- [x] Bridge 掉线 / `busy` / 阶段失败后的重试与可恢复状态机（预检、Dify URL 对齐、503 admit、重连保 busy、失败标 retryable +「重新执行」；阶段中断续跑仍靠重启）。
- [x] Studio run_id ↔ Dify ↔ Bridge stage 统一可检索（失败原因、日志串联）。
- [ ] **阶段中断续跑（resume）**：见上「自管编排」；长跑中断后从失败 stage 续跑。

### 测试与 CI

- [x] 鉴权 + 团队隔离 API 回归。
- [x] 工单启动路由（选仓 / Bridge 可达）测试。
- [x] commit-record / MR 解析 + Bridge HTTP 鉴权回归（在现有少量 Bridge 单测之上加厚）。
- [ ] **E2E 黄金路径**：登录 → 开工单 → 审批 → 见产物（CI 可用 mock Bridge）。

### 执行器调度

- [x] 多 Bridge 池：按团队选机、`busy` 排队（优先 idle、禁止跨团队回落；全忙时 `queued`，Bridge 空闲后自动 admit）。

### 可观测与清理

- [x] run 级可观测补强（trace / 检索：ID 精确 lookup、双向深链、运行轨迹）。
- [x] 仓库工作副本与 run 产物磁盘清理策略（Bridge `gc` dry-run 默认；清 prompt / 终态 `docs/dify-runs` / 过期 `runs.json`）。

### Web 查看 run 产物

- [x] Bridge：`GET /runs/:id/artifacts` 列表 + `GET /runs/:id/artifacts/:name` 读正文；仅允许 `docs/dify-runs/{run_id}/`（或 run 登记路径）白名单，防路径穿越。
- [x] Studio API 代理（团队鉴权）+ Web 在 RunLogs / 工单详情加「产物」Tab（列表 + markdown 预览）。
- [ ] （可选）终态快照入库 / 落盘，Bridge 下线仍可回看。
- [ ] （可选）有 MR/sha 时外链 GitLab blob。

Notes (2026-08-11): 产物在 Bridge 机 `docs/dify-runs/{run_id}/*.md`；现 RunLogs 是控制面时间线，不直接读仓库文件。主路径走 Bridge 读 API，不做 Studio 本机扫盘。

### 一键 Compose profile（减负本地栈）

- [ ] 统一 `deploy/` Compose **profile**：如 `core`（仅 MySQL）/ `control`（+ 可容器化控制面）/ `full`（+ Dify + GitLab）；避免换机默认拉全套。
- [ ] `scripts/bootstrap-dev.sh`（或等价）：拷 `.env.example`、按 profile `up -d`、等 health、跑 `init.sql`、打印下一步（Bridge/Studio 本机进程）。
- [ ] 文档与 Skill 写清 L0–L3 / profile 对应关系；GitLab、Dify 标为 optional，完整本地闭环才用 `full`。
- [ ] **共享远程控制面作为默认开发方式**：文档推荐一台常开 Studio+Dify+GitLab，本机只跑 Bridge / `bridge-desktop`（换机成本优先砍这里）。

Notes (2026-08-11): 换机最重是 Dify/GitLab 镜像与初始化；profile + bootstrap 减「忘步骤 / 配错端口」，共享远程栈仍是更瘦的日常路径。

### bridge-desktop 打磨

- [ ] 打包安装（macOS/Windows）、仓库/`BRIDGE_REPOS_DIR` 路径探测、日志窗；降低「只会 npm run」门槛。
- [ ] 与 CLI / `.env` 行为对齐的冒烟说明（启动 → `/health` → Studio `online`）。

## P2 — 扩展（可后置）

### Bridge 桌面启停（Tauri）

- [x] 用 **Tauri** 做本机执行器托盘/小窗：启动、停止 Bridge；状态看 `/health`（及是否 `online`）。
- [x] **保留现有命令行启动**（`npm run dev:bridge` / `agent-studio-bridge start`）；App 只是在 CLI 之上的一层，spawn 同一套进程与 `.env`，不替代 CLI。
- [x] 停止走 SIGINT/SIGTERM（与 Ctrl+C 一致，便于 WS 报 offline）；可选「只退 UI、Bridge 继续跑」。
- [x] 密钥仍读本机 Bridge `.env`，不进 Tauri 云同步。

Notes (2026-08-11): 面向本地调试与桌面执行机；云 VM 仍用 systemd/Docker，不必强依赖 Tauri。实现见 `apps/bridge-desktop/`，根脚本 `npm run dev:bridge-desktop`。

### 移动端独立 App（控制面）

- [ ] 做**独立移动 App**（非仅响应式 Web）：登录 Studio、选团队、工单列表/详情、Human Input 通过/驳回、启动/重新执行、执行器状态、运行日志/产物只读。
- [ ] 只调现有 Studio API +（可选）Socket.IO；**不在手机上跑 Bridge / Cursor**；执行仍依赖已 online 的远程执行器。
- [ ] 技术选型待定（RN / Flutter / Tauri Mobile 等）；与桌面 Tauri 启停 App 职责分离（手机遥控控制面，桌面管本机 Bridge 进程）。
- [ ] 前提：Studio API 对公网/VPN 可达 + HTTPS；推送通知（审批待办）可选后置。

Notes (2026-08-11): 移动端 = 远程操作台，不是移动版执行器。

### 身份

- [ ] OAuth / SSO

### Agent 驱动

- [ ] `openai` driver（今日占位）；按「无 Cursor 许可」需求决定是否做。
- [x] Trae / Qoder 安装与鉴权文档压实（`docs/环境配置指南.md` §3.1a + `.env.example` / Bridge·runtime README）。

### Cloud Dify Agent as step executor

- [ ] 数字人步骤绑定云端 Dify Agent（不只 pipeline 级 Workflow）。
- [ ] `dify` 绑定扩展 Agent App Key / `api_base`；步骤执行时调 Dify Agent API。
- [ ] 云 Agent 的 repo clone / sandbox 策略（与云 Bridge 工作区方案对齐后再做）。

Notes (2026-08-10): UI `dify.agent_id` / `agent_name` 仍是元数据；工单仍走 Dify Workflow → HTTP Bridge。云 Bridge 未通前投入产出偏低。

### 工程债 / 中期优化

- [x] 抽出 work-order routing / dify utils / bridge-git 解析。
- [ ] 继续拆 `work-orders.service`（sync / decide / start 分模块；服务仍 ~2500 行）。
- [ ] `team-secrets` 从 YAML 再收一档（MySQL 或 Vault/SOPS），便于多实例与备份。
- [ ] Bridge Forge HTTP 用 `@gitbeaker` / Octokit 替裸 `fetch` 开 MR（本地 git commit/push 仍自管）。

---

## Done

### Pipelines / humans / bridges → MySQL (2026-08-11)

- [x] 表 `digital_humans` / `pipelines` / `bridges`；服务改 TypeORM；bootstrap 一次性 YAML 导入。
- [x] Studio 运行时不再读写这三类 YAML（源文件保留供回滚）。
- [x] 去掉服务侧 `getDataDir` / 死 YAML 路径；备份与多实例说明见 `apps/studio-api/sql/README.md`。

### Cloud Bridge workspace ownership (2026-08-11)

- [x] Bridge `POST /workspace/ensure` + `BRIDGE_REPOS_DIR`；工单 routing / restart reuse 用 Bridge 路径。
- [x] Studio 优先注册执行器 `base_url`；`host.docker.internal` 仅本机共址改写。
- [x] 文档：`docs/环境配置指南.md` §3.4 + skill Remote Bridge。

### Auth / teams / multi-tenancy

- [x] **登录与系统权限**：JWT 登录；全局 AuthGuard（health / login / register / Bridge WS 除外）。
- [x] **团队管理**：团队 → 项目；团队间隔离；角色 owner / member / viewer。
- [x] **MySQL**：users / teams / team_members / projects；空库 bootstrap admin + 默认团队；YAML 项目一次性迁入。
- [x] 流水线 / 数字人 / Bridge / 设置按团队隔离；viewer 只读；Dify/Console/Git 可按团队 overlay（见 `team-secrets`）。
- [x] 工单本体迁 MySQL；viewer 只读。

### Bridge MR / commit-record parsing

- [x] `parseCommitRecord` 支持 markdown **table**（`| field | value |`），不只 `- field: value`。  
  Fixed 2026-08-10. Backfilled backend MR: http://localhost:8929/root/dify-pipeline-backend/-/merge_requests/1 (run `64c74bb8`).

### Git bot identity + SSH remotes

- [x] Bridge: `BRIDGE_GIT_AUTHOR_*` + `BRIDGE_GIT_SSH_KEY` → force commit author；origin 改写 SSH；MR 仍用 bot `GITLAB_TOKEN`。
- [x] Studio `ensureCloned` prefers SSH when key / `STUDIO_GIT_PREFER_SSH` is set.
- [x] Ops: dedicated GitLab user `agent-studio-bot` + bot PAT；SSH key 离 root；demo 仓 Maintainer。

### Hardening (2026-08-10)

- [x] Bridge HTTP auth（`BRIDGE_HTTP_TOKEN` / `STUDIO_BRIDGE_TOKEN`）；`/health` 公开。
- [x] Minimal CI（typecheck + bridge tests）。
- [x] Dify secrets 拆到 `data/dify-secrets.yaml`（0600）；优先 `DIFY_*` env。

### UX polish (2026-08-10)

- [x] 数字人 Dify Agent 字段标明 metadata / 未执行。
- [x] 工单 Human Input 自动 sync `form_token`。
- [x] README 链到 `docs/` + `skills/local-stack-setup`。
- [x] 抽出 work-order routing + dify utils（进一步拆分见 P2）。
