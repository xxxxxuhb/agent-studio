# Bridge Desktop（Tauri）

本机小窗 + 系统托盘：启动 / 停止现有 Bridge CLI 进程，并轮询 `/health`。

**不替代命令行**：仍可用 `npm run dev:bridge` / `agent-studio-bridge start`。密钥只读 `apps/studio-bridge/.env`，不进云同步。

## 依赖

- Node.js ≥ 20
- [Rustup](https://rustup.rs) stable（`rustc` / `cargo`）
- macOS：Xcode Command Line Tools（`xcode-select --install`）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc -V
```

## 开发

在仓库根目录：

```bash
# 先编好 Bridge 入口（桌面 App 会 spawn packages/bridge/dist/bin.js）
npm run build -w @agent-studio/bridge

# 启动 Tauri 开发窗
npm run dev:bridge-desktop
```

或：

```bash
cd apps/bridge-desktop
npm run tauri:dev
```

## 行为约定

| 项 | 默认 |
|----|------|
| 工作目录 / `.env` | `apps/studio-bridge/` |
| 启动 | `node <repo>/packages/bridge/dist/bin.js start` |
| Health | `http://127.0.0.1:{BRIDGE_PORT}/health`（默认 `8787`） |
| 停止 | 进程组 SIGINT → 超时 SIGTERM |
| 关窗口 | 藏到托盘，不杀 Bridge |
| 托盘「退出界面」 | 退出 App，Bridge 继续跑 |
| 托盘「退出并停止」 | stop + exit |

本机配置持久化（非云）：`~/Library/Application Support/agent-studio/bridge-desktop.json`（Linux/Windows 为对应 config 目录）。可覆盖 `bridgeCwd`、`nodePath`、`bridgeBin`、`healthUrl`。

**不要**同时用 CLI 与桌面 App 对同一 `BRIDGE_PORT` 双开。

## 冒烟（与 CLI 对齐）

1. 先保证 `apps/studio-bridge/.env` 存在，且 `STUDIO_URL` / `STUDIO_BRIDGE_TOKEN` 与 API 一致。
2. 启动桌面 App（`npm run dev:bridge-desktop`）→ 点「启动 Bridge」。
3. 本机检查：

```bash
curl -sS http://127.0.0.1:8787/health
```

应返回 JSON（含 status / name 等）。

4. 打开 Studio Web → **执行器**：对应 Bridge 应显示 **online**（需 API 已起、token 一致、Bridge 已 WS 注册）。
5. （可选）开一张测试工单「开始流水线」，确认 live 事件能刷出。

等价 CLI：`npm run dev:bridge` 后重复步骤 3–4。

路径探测：窗口会显示 `node✓ / bin✓ / cwd✓`；异常时点「重置路径」或看黄色提示。日志区捕获本 App 拉起的 Bridge stdout/stderr。

## 构建 / 本机安装包

开发前先编 Bridge：

```bash
npm run build -w @agent-studio/bridge
npm run build:bridge-desktop
# 或：cd apps/bridge-desktop && npm run tauri:build
```

产物（未公证，仅本机试装）：

| 平台 | 典型输出 |
|------|----------|
| macOS | `apps/bridge-desktop/src-tauri/target/release/bundle/dmg/` · `macos/*.app` |
| Windows | `…/bundle/msi/` · `nsis/` |
| Linux | `…/bundle/deb/` · `appimage/` |

可选环境变量：`BRIDGE_DESKTOP_NODE=/绝对路径/node`（nvm/fnm 探测失败时）。

v1 **不做** Apple 公证 / Windows 代码签名 / 自动更新流水线；分发给同事时自行信任本机构建。
