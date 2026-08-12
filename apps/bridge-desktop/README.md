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

## 构建（本机）

```bash
npm run build:bridge-desktop
```

v1 不做公证 / 安装包分发流水线。
