# Agent Studio — backlog

按优先级：P0 可远程交付 → P1 稳态运维 → P2 扩展能力。已完成项见文末。

分支：`v2`（Studio orchestrator 直连 Bridge；控制面已去掉 Dify 执行路径）。

## P0 — 可远程交付

### Cloud Bridge（remote executor host）

- [x] Bridge 跑在云 VM / 容器，`BRIDGE_PUBLIC_URL` 对 Studio 可达；Bridge WS 回连 Studio。
- [x] 仓库工作区归 Bridge 主机（`POST /workspace/ensure` + `BRIDGE_REPOS_DIR`）。
- [x] Ops：云 `.env` + 文档（`docs/环境配置指南.md` §3.4）。

### 存储收尾（YAML → MySQL）

- [x] 流水线 / 数字人 / Bridge / 项目 / 工单迁 MySQL。
- [x] 运行时与 YAML 双轨脱钩（备份说明见 `apps/studio-api/sql/README.md`）。

### 密钥与租户边界

- [x] 团队隔离（成员角色 + 团队资源）；设置 / Git overlay（`StudioConfig` / 原 team-secrets 路径按现实现为准）。
- [x] 团队密钥轮换文档（[`docs/团队密钥与轮换.md`](docs/团队密钥与轮换.md)；已按 v2 去掉 Dify 主路径）。

## P1 — 稳态运维

### Studio 自管编排 + Bridge

- [x] 独立包 `packages/orchestrator`；Studio 薄适配（`studio-orchestrator.adapter.ts`）。
- [x] start / decide / Human Input 暂停；仅 `executor=studio`；Nest `src/dify` 与 Web Dify 面板已删。
- [x] 流水线步骤存 MySQL；包消费 `agent-schema` 契约。
- [x] 库内嵌进程形态（API `import @agent-studio/orchestrator`）。
- [x] 流水线可视化编辑（`apps/studio-web/src/pipeline-flow/`）。
- [x] 包内 `resumeStudioRun` + adapter `runStudioResume` + 单测。
- [x] **产品续跑**：`POST /work-orders/:id/resume` + Web「从失败阶段续跑」（复用 `bridge_run_id`；失效则回退「重新执行」）。
- [x] **减负 Compose**：仅 MySQL（`deploy/docker-compose.yml` + `scripts/bootstrap-dev.sh`）；**不内置 GitLab**；文档 L0–L2。
- [x] 清理本机残留：`deploy/dify/`、`deploy/gitlab/` 已不在仓库；`.gitignore` 忽略若本地再生成。
- [x] 文档扫尾：去掉过时 Dify / 内置 GitLab 主路径；产物目录名 `docs/dify-runs` 暂保留（可选改名）。

Notes (2026-08-13): 编排主路径已通；本地栈只起 MySQL；Forge 用外部 GitLab/GitHub。

### 工单可靠性

- [x] Bridge busy/offline、排队 admit、失败可「重新执行」。
- [x] run 日志关联 / trace / 深链。
- [x] 阶段中断续跑产品化（`resume` API + UI）。

### 测试与 CI

- [x] 鉴权 / 团队隔离 / routing / Bridge 单测加厚。
- [x] **E2E 黄金路径**：`packages/orchestrator` `golden-path.test.ts`（mock Bridge HTTP：start → 审批 → completed + artifacts）。

### 执行器调度 / 可观测

- [x] 多 Bridge 池选机与 busy 排队。
- [x] Bridge `gc`；run artifacts API + Web「产物」Tab。
- [x] 终态产物**路径**快照入库（`step.artifact_paths`）；MR/sha 外链（`commit_url` / `forgeCommitUrl`）。内容级 blob 入库仍可选后置。

### 一键 Compose（减负本地栈）

- [x] `deploy/`：**仅 MySQL**（已去掉内置 GitLab）。
- [x] `scripts/bootstrap-dev.sh`：拷 env、up、health、`init.sql`、提示起 API/Web/Bridge。
- [x] Skill / 环境指南：默认「共享远程控制面 + 本机 Bridge」；Push/MR 对接外部 Forge。

### bridge-desktop 打磨

- [x] 路径探测强化（monorepo walk-up / node 常见路径 / 重置路径）、日志窗（stdout/stderr ring）、本机构建说明（未公证）。
- [x] 冒烟说明：启动 → `/health` → Studio `online`（与 CLI 对齐）。
- [ ] （后置）Apple 公证 / Windows 签名 / 自动更新。

## P2 — 扩展（可后置）

### Bridge 桌面启停（Tauri）

- [x] `apps/bridge-desktop/`：启停 Bridge、health、保留 CLI；密钥读本机 `.env`。

### 移动端独立 App（控制面）

- [ ] 独立 App：登录 / 团队 / 工单 / 审批 / 执行器状态 / 日志产物只读。
- [ ] 只调 Studio API（+ 可选 Socket）；不跑 Bridge；API 需公网/VPN + HTTPS。

### 身份 / 驱动

- [ ] OAuth / SSO
- [ ] `openai` driver（占位）；按需再做。

### 工程债 / 中期优化

- [x] 继续拆 `work-orders.service`：抽出 `WorkOrderStudioRunner`（start/decide/resume/progress/outcome）；主服务 ~1.5k 行。
- [x] 设置/密钥叙事清理：SQL README / Skill env 去掉 Dify secrets 主路径；team-secrets 仍 YAML `0600`（MySQL/Vault 后置）。
- [x] Bridge Forge HTTP：`@gitbeaker/rest` + `@octokit/rest`（`packages/bridge/src/forgeHttp.ts`）。
- [ ] （可选后置）orchestrator 拆独立 worker 进程。
- [x] （取消）云端 Dify Agent / Workflow 回嵌——主路径已移除；若再做应为独立插件，不回旧模块。

---

## Done

### Local stack profiles + docs scrub (2026-08-13)

- [x] `deploy/docker-compose.yml`（MySQL）+ `scripts/bootstrap-dev.sh`；**移除内置 GitLab**。
- [x] 环境指南 L0–L2；`docs/对接外部Git.md`；Skill / 问题记录去掉 Dify/内置 GitLab。
- [x] orchestrator golden-path（mock Bridge HTTP）；bridge-desktop 冒烟说明。

### bridge-desktop + observability (2026-08-13)

- [x] 路径探测 / 日志窗 / 本机构建说明。
- [x] `artifact_paths` 快照 + GitLab/GitHub `commit_url` 外链。

### Engineering debt pass (2026-08-13)

- [x] `WorkOrderStudioRunner` 抽出 studio start/decide/resume。
- [x] Bridge MR/PR 走 Octokit + Gitbeaker；密钥文档去 Dify 主路径。

### Studio orchestrator（2026-08-12 → v2）

- [x] `packages/orchestrator`：start / decide / resume（包层）+ Bridge client + stage-map。
- [x] 工单默认 `executor=studio`；去掉控制面 Dify 模块与导入 DSL。
- [x] `StudioConfig` 承接 bridge / agents_md / Git；部署文档去掉 Dify Compose。
- [x] 流水线可视化 `pipeline-flow`。

### Pipelines / humans / bridges → MySQL (2026-08-11)

- [x] TypeORM + bootstrap YAML 一次性导入；运行时不读写这三类 YAML。

### Cloud Bridge workspace ownership (2026-08-11)

- [x] `POST /workspace/ensure`；工单 routing 用 Bridge 路径；文档 §3.4。

### Auth / teams / multi-tenancy

- [x] JWT、团队、角色、工单/项目 MySQL、团队隔离。

### Bridge MR / git bot / hardening / UX (2026-08-10)

- [x] commit-record table 解析；SSH bot + PAT 开 MR；Bridge HTTP auth；最小 CI；Human Input 自动 sync（历史 Dify 路径）；README / skill 链接。
