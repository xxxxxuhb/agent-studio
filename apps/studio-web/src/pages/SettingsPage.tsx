import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import type { DifyConfigPublic, StudioLanguage } from "@agent-studio/agent-schema";
import { difyApi, type DifyConfigUpdate } from "../api/dify";
import { settingsApi } from "../api/settings";

export function SettingsPage() {
  const [form] = Form.useForm<DifyConfigUpdate & { console_password?: string }>();
  const [config, setConfig] = useState<DifyConfigPublic | null>(null);
  const [language, setLanguage] = useState<StudioLanguage>("zh");
  const [loading, setLoading] = useState(false);
  const [savingLang, setSavingLang] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [cfg, studio] = await Promise.all([
        difyApi.getConfig(),
        settingsApi.get(),
      ]);
      setConfig(cfg);
      setLanguage(studio.language);
      form.setFieldsValue({
        enabled: cfg.enabled,
        api_base: cfg.api_base,
        bridge_base_url: cfg.bridge_base_url,
        agents_md_path: cfg.agents_md_path,
        response_mode: cfg.response_mode,
        console_base: cfg.console_base || "",
        console_email: cfg.console_email || "",
        api_key: "",
        console_token: "",
        console_password: "",
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveLanguage(next: StudioLanguage) {
    setSavingLang(true);
    try {
      const studio = await settingsApi.update({ language: next });
      setLanguage(studio.language);
      message.success(
        studio.language === "zh"
          ? "已切换为中文：Agent 产出将使用中文"
          : "Switched to English: agent output will be in English",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLang(false);
    }
  }

  async function save() {
    try {
      const values = await form.validateFields([
        "enabled",
        "api_base",
        "bridge_base_url",
        "agents_md_path",
        "response_mode",
        "console_base",
        "console_email",
        "api_key",
        "console_token",
      ]);
      const payload: DifyConfigUpdate = {
        enabled: values.enabled,
        api_base: values.api_base,
        bridge_base_url: values.bridge_base_url,
        agents_md_path: values.agents_md_path,
        response_mode: values.response_mode,
        console_base: values.console_base,
        console_email: values.console_email,
      };
      if (values.api_key?.trim()) {
        payload.api_key = values.api_key.trim();
      }
      if (values.console_token?.trim()) {
        payload.console_token = values.console_token.trim();
      }
      const next = await difyApi.updateConfig(payload);
      setConfig(next);
      form.setFieldValue("api_key", "");
      form.setFieldValue("console_token", "");
      message.success("Dify 配置已保存");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function loginConsole() {
    try {
      const values = await form.validateFields([
        "console_email",
        "console_password",
        "console_base",
        "api_base",
      ]);
      const email = values.console_email?.trim() || "";
      const password = values.console_password || "";
      if (!email || !password) {
        message.warning("请填写 Console 邮箱和密码");
        return;
      }
      setLoggingIn(true);
      const res = await difyApi.consoleLogin({
        email,
        password,
        console_base: values.console_base?.trim() || undefined,
      });
      setConfig(res.config);
      form.setFieldValue("console_password", "");
      form.setFieldValue("console_email", res.config.console_email || email);
      form.setFieldValue("console_base", res.config.console_base || "");
      message.success(
        res.source === "cookie"
          ? "已登录 Dify Console（从 Cookie 取得 token）"
          : "已登录 Dify Console（已保存 access_token）",
      );
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function checkHealth() {
    try {
      const res = await difyApi.health();
      setHealthOk(res.ok);
      setHealthMsg(
        res.ok
          ? "已连通 Dify（parameters 可用）"
          : res.error || "未配置或连通失败",
      );
    } catch (err) {
      setHealthOk(false);
      setHealthMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 720 }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          设置
        </Typography.Title>
        <Typography.Text type="secondary">
          配置 Agent 产出语言与 Dify App API；工单可选择以 Dify 作为执行器启动交付流水线。
        </Typography.Text>
      </div>

      <div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          语言
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          选择中文后，Dify/Bridge Agent 生成的报告、摘要等面向用户内容均使用中文
          （代码标识符与路径保持原样）。
        </Typography.Paragraph>
        <Select
          style={{ width: 280 }}
          value={language}
          disabled={loading || savingLang}
          options={[
            { value: "zh", label: "中文（Agent 产出中文）" },
            { value: "en", label: "English (agent output in English)" },
          ]}
          onChange={(v) => void saveLanguage(v)}
        />
      </div>

      {config ? (
        <Alert
          type={config.enabled && config.api_key_set ? "success" : "info"}
          showIcon
          message={
            config.enabled
              ? config.api_key_set
                ? `Dify 已启用 · ${config.api_base}`
                : "Dify 已启用，但尚未设置 API Key"
              : "Dify 未启用（工单执行需要先启用并配置 App Key）"
          }
          description={
            config.console_token_set
              ? `Console 会话已就绪${config.console_email ? `（${config.console_email}）` : ""}，可用于一键导入 DSL`
              : "Console 未登录：流水线「一键导入到 Dify」需要先登录 Console"
          }
        />
      ) : null}

      <Form form={form} layout="vertical" disabled={loading}>
        <Typography.Title level={5}>Dify</Typography.Title>
        <Form.Item name="enabled" label="启用 Dify" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="api_base"
          label="API Base"
          rules={[{ required: true, message: "例如 http://localhost/v1" }]}
          extra="指向 Dify 的 /v1，不要带末尾斜杠之外的路径"
        >
          <Input placeholder="http://localhost/v1" />
        </Form.Item>
        <Form.Item
          name="api_key"
          label="App API Key"
          extra={
            config?.api_key_set
              ? "已保存密钥；留空则保持不变"
              : "在 Dify 应用「访问 API」中复制 Workflow App Key"
          }
        >
          <Input.Password placeholder={config?.api_key_set ? "••••••••" : "app-..."} />
        </Form.Item>
        <Form.Item
          name="bridge_base_url"
          label="默认 Bridge Base URL"
          extra="传给 Dify workflow（容器内常用 host.docker.internal:8787）。Studio 本机调总管选仓时会自动改写为 127.0.0.1"
        >
          <Input placeholder="http://host.docker.internal:8787" />
        </Form.Item>
        <Form.Item
          name="agents_md_path"
          label="默认 AGENTS.md 路径"
          extra='通常填 "auto"，由 Bridge 解析'
        >
          <Input placeholder="auto" />
        </Form.Item>
        <Form.Item
          name="response_mode"
          label="启动响应模式（配置项）"
          extra="Studio 启动 Workflow 时固定使用 streaming，以便捕获 Human Input 的 form_token"
        >
          <Select
            options={[
              { value: "streaming", label: "streaming（推荐）" },
              { value: "blocking", label: "blocking" },
            ]}
          />
        </Form.Item>

        <Typography.Title level={5}>Dify Console（一键导入 DSL）</Typography.Title>
        <Form.Item
          name="console_base"
          label="Console API Base"
          extra="留空则按 api_base 推导为 {origin}/console/api"
        >
          <Input placeholder="http://localhost/console/api" />
        </Form.Item>
        <Form.Item
          name="console_email"
          label="Console 邮箱"
          extra="密码仅用于登录换 token，不会写入配置文件"
        >
          <Input placeholder="admin@example.com" autoComplete="username" />
        </Form.Item>
        <Form.Item name="console_password" label="Console 密码">
          <Input.Password
            placeholder="登录密码"
            autoComplete="current-password"
            onPressEnter={() => void loginConsole()}
          />
        </Form.Item>
        <Space wrap style={{ marginBottom: 16 }}>
          <Button type="primary" loading={loggingIn} onClick={() => void loginConsole()}>
            登录并获取 Token
          </Button>
          {config?.console_token_set ? (
            <Typography.Text type="success">已保存 Console 会话</Typography.Text>
          ) : null}
        </Space>

        <Collapse
          ghost
          items={[
            {
              key: "manual-token",
              label: "高级：手动粘贴 Console Token",
              children: (
                <Form.Item
                  name="console_token"
                  label="Console Access Token"
                  extra={
                    config?.console_token_set
                      ? "已保存；留空保持不变。一般无需手动填写，优先用上方登录"
                      : "可选：从浏览器 Network 复制 Authorization Bearer"
                  }
                >
                  <Input.Password
                    placeholder={
                      config?.console_token_set ? "••••••••" : "console access token"
                    }
                  />
                </Form.Item>
              ),
            },
          ]}
        />

        <Space wrap>
          <Button type="primary" onClick={() => void save()}>
            保存
          </Button>
          <Button onClick={() => void checkHealth()}>测试连通</Button>
          <Button onClick={() => void reload()}>刷新</Button>
        </Space>
      </Form>

      {healthMsg ? (
        <Alert
          type={healthOk ? "success" : "error"}
          showIcon
          message={healthMsg}
        />
      ) : null}
    </Space>
  );
}
