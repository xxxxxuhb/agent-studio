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

### 工单可靠性

- [x] Dify Human Input / `form_token` 丢失与恢复路径加固（不误清 token、恢复失败可观测、过期重拉、decide 重试、sync 串行）。
- [x] Bridge 掉线 / `busy` / 阶段失败后的重试与可恢复状态机（预检、Dify URL 对齐、503 admit、重连保 busy、失败标 retryable +「重新执行」；阶段中断续跑仍靠重启）。
- [ ] Studio run_id ↔ Dify ↔ Bridge stage 统一可检索（失败原因、日志串联）。

### 测试与 CI

- [ ] 鉴权 + 团队隔离 API 回归。
- [ ] 工单启动路由（选仓 / Bridge 可达）测试。
- [ ] commit-record / MR 解析 + Bridge HTTP 鉴权回归（在现有少量 Bridge 单测之上加厚）。

### 执行器调度

- [ ] 多 Bridge 池：按团队选机、`busy` 排队（单远程主机跑通后再做）。

### 可观测与清理

- [ ] run 级可观测补强（trace / 检索）。
- [ ] 仓库工作副本与 run 产物磁盘清理策略。

## P2 — 扩展（可后置）

### 身份

- [ ] OAuth / SSO

### Agent 驱动

- [ ] `openai` driver（今日占位）；按「无 Cursor 许可」需求决定是否做。
- [ ] Trae / Qoder 安装与鉴权文档压实。

### Cloud Dify Agent as step executor

- [ ] 数字人步骤绑定云端 Dify Agent（不只 pipeline 级 Workflow）。
- [ ] `dify` 绑定扩展 Agent App Key / `api_base`；步骤执行时调 Dify Agent API。
- [ ] 云 Agent 的 repo clone / sandbox 策略（与云 Bridge 工作区方案对齐后再做）。

Notes (2026-08-10): UI `dify.agent_id` / `agent_name` 仍是元数据；工单仍走 Dify Workflow → HTTP Bridge。云 Bridge 未通前投入产出偏低。

### 工程债（顺手）

- [ ] 继续拆 `work-orders` god service（routing / dify utils 已抽一部分）。

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
