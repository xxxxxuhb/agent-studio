# Agent Studio Mobile（控制面）

独立 Expo App：登录 / 团队 / 工单审批 / 执行器状态 / 运行日志与产物（只读）。

**不跑 Bridge**，只调 Studio API（+ 可选 Socket.IO）。

## 前置

1. Studio API 可达（本机 / 局域网 / VPN / 公网 HTTPS）
2. 真机：在登录页或「更多」填写 `http://<电脑局域网IP>:8790/api`
3. iOS 模拟器默认 `http://127.0.0.1:8790/api`；Android 模拟器默认 `http://10.0.2.2:8790/api`
4. Expo Web 需 API CORS 放行（已含 `localhost:8081`；其它来源用 `STUDIO_CORS_ORIGINS`）

## 开发

```bash
# monorepo 根目录
npm run build:schema
npm run dev:mobile
```

或：

```bash
npm start -w @agent-studio/studio-mobile
```

然后用 Expo Go 扫码，或 `i` / `a` / `w`。

## 能力边界（MVP+）

| 有 | 无 |
|----|----|
| 登录、选团队 | 流水线编辑、项目管理 |
| 工单列表 / 详情 / **新建** | 附件上传 |
| **开始 / 重新执行**（pipeline + 执行器） | Bridge 启停 |
| 待确认：通过 / 驳回 | 推送通知 |
| 失败续跑、结束运行 | Socket 鉴权 / 商店包 |
| 执行器状态只读 | |
| 日志 + 产物内容只读 | |

## 环境变量（API 侧）

| 变量 | 说明 |
|------|------|
| `STUDIO_CORS_ORIGINS` | 逗号分隔额外 CORS 来源（Expo Web） |
| `STUDIO_WEB_ORIGIN` | 既有 Web 来源 |
| `STUDIO_API_HOST` | 默认 `0.0.0.0`，便于局域网访问 |
