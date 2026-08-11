import { useState } from "react";
import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/auth";
import { setSelectedTeam, setSession } from "../auth/session";

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);

  async function onFinish(values: {
    username: string;
    password: string;
    display_name?: string;
  }) {
    setBusy(true);
    try {
      const res =
        mode === "login"
          ? await authApi.login(values)
          : await authApi.register(values);
      setSession(res.token, res.user);
      setSelectedTeam(null);
      message.success(`欢迎，${res.user.display_name || res.user.username}`);
      navigate("/select-team", { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(160deg, #f7f4ef 0%, #e8eef5 100%)",
        padding: 24,
      }}
    >
      <Card style={{ width: 400, maxWidth: "100%" }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Agent Studio
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {mode === "login"
            ? "登录后先选择团队，再进入工作台"
            : "仅在系统尚无用户时可注册（首次 bootstrap）"}
        </Typography.Paragraph>
        {mode === "login" ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="默认管理员"
            description="空库启动时可用 STUDIO_ADMIN_USER / STUDIO_ADMIN_PASSWORD（默认 admin / admin123）"
          />
        ) : null}
        <Form layout="vertical" onFinish={(v) => void onFinish(v)}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          {mode === "register" ? (
            <Form.Item label="显示名" name="display_name">
              <Input autoComplete="nickname" />
            </Form.Item>
          ) : null}
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </Form.Item>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Button type="primary" htmlType="submit" block loading={busy}>
              {mode === "login" ? "登录" : "注册并登录"}
            </Button>
            <Button
              type="link"
              block
              disabled={busy}
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "首次使用？尝试注册" : "已有账号？去登录"}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
