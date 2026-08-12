import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
  message,
} from "antd";
import type { StudioConfigPublic, StudioLanguage } from "@agent-studio/agent-schema";
import { settingsApi, type StudioSettingsUpdate } from "../api/settings";
import { getSelectedTeam } from "../auth/session";

export function SettingsPage() {
  const [form] = Form.useForm<StudioSettingsUpdate>();
  const [config, setConfig] = useState<StudioConfigPublic | null>(null);
  const [loading, setLoading] = useState(false);

  function requireTeamId() {
    const id = getSelectedTeam()?.id;
    if (!id) throw new Error("请先选择团队");
    return id;
  }

  async function reload() {
    setLoading(true);
    try {
      const team_id = requireTeamId();
      const studio = await settingsApi.get({ team_id });
      setConfig(studio);
      form.setFieldsValue({
        language: studio.language,
        bridge_base_url: studio.bridge_base_url,
        agents_md_path: studio.agents_md_path,
        git_ssh_key_path: studio.git_ssh_key_path || "",
        git_prefer_ssh: studio.git_prefer_ssh,
        git_ssh_port: studio.git_ssh_port,
        git_ssh_user: studio.git_ssh_user || "",
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

  async function save() {
    try {
      const values = await form.validateFields([
        "language",
        "bridge_base_url",
        "agents_md_path",
        "git_ssh_key_path",
        "git_prefer_ssh",
        "git_ssh_port",
        "git_ssh_user",
      ]);
      const payload: StudioSettingsUpdate = {
        language: values.language as StudioLanguage | undefined,
        bridge_base_url: values.bridge_base_url,
        agents_md_path: values.agents_md_path,
        git_ssh_key_path: values.git_ssh_key_path,
        git_prefer_ssh: values.git_prefer_ssh,
        git_ssh_port: values.git_ssh_port,
        git_ssh_user: values.git_ssh_user,
      };
      const next = await settingsApi.update(payload, {
        team_id: requireTeamId(),
      });
      setConfig(next);
      message.success("团队 Bridge / Git 配置已保存");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <span className="page-meta">
            当前团队配置 · 空字段回退安装级默认
          </span>
          {config ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              Bridge {config.bridge_base_url || "未设置"} ·{" "}
              {config.language === "zh" ? "中文" : "EN"} · AGENTS.md{" "}
              {config.agents_md_path || "auto"}
            </Typography.Text>
          ) : null}
        </div>
        <div className="page-toolbar-actions">
          <Button onClick={() => void reload()} disabled={loading}>
            刷新
          </Button>
          <Button type="primary" onClick={() => void save()} loading={loading}>
            保存
          </Button>
        </div>
      </div>

      <div className="page-scroll">
        <Card size="small" className="settings-card" loading={loading && !config}>
          <Form form={form} layout="vertical" disabled={loading} style={{ maxWidth: 640 }}>
            <Tabs
              size="small"
              items={[
                {
                  key: "general",
                  label: "通用",
                  children: (
                    <Form.Item
                      name="language"
                      label="Agent 产出语言"
                      extra="报告 / 摘要等面向用户内容；代码标识符与路径保持原样"
                    >
                      <Select
                        options={[
                          { value: "zh", label: "中文" },
                          { value: "en", label: "English" },
                        ]}
                      />
                    </Form.Item>
                  ),
                },
                {
                  key: "bridge",
                  label: "Bridge",
                  children: (
                    <>
                      <Form.Item
                        name="bridge_base_url"
                        label="默认 Bridge Base URL"
                        extra="Studio 编排调用本机 Bridge（常用 127.0.0.1:8787）"
                      >
                        <Input placeholder="http://127.0.0.1:8787" />
                      </Form.Item>
                      <Form.Item
                        name="agents_md_path"
                        label="默认 AGENTS.md 路径"
                        extra='通常填 "auto"，由 Bridge 解析'
                      >
                        <Input placeholder="auto" />
                      </Form.Item>
                    </>
                  ),
                },
                {
                  key: "git",
                  label: "Git SSH",
                  children: (
                    <>
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="仅影响 Studio API 本机 ensureCloned"
                        description="Bridge 执行机仍用其自身 .env 的 BRIDGE_GIT_*。"
                      />
                      <Form.Item
                        name="git_ssh_key_path"
                        label="SSH 私钥路径"
                        extra={
                          config?.git_ssh_key_path_set
                            ? "已配置；留空保存不会清空"
                            : "例如 ~/.ssh/agent_studio_bot"
                        }
                      >
                        <Input placeholder="~/.ssh/agent_studio_bot" />
                      </Form.Item>
                      <Form.Item
                        name="git_prefer_ssh"
                        label="优先 SSH remote"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Space size="middle" style={{ width: "100%" }} wrap>
                        <Form.Item
                          name="git_ssh_port"
                          label="SSH 端口"
                          style={{ marginBottom: 0, width: 160 }}
                          extra="0/空 = 22"
                        >
                          <InputNumber min={0} style={{ width: "100%" }} placeholder="2224" />
                        </Form.Item>
                        <Form.Item
                          name="git_ssh_user"
                          label="SSH 用户"
                          style={{ marginBottom: 0, width: 160 }}
                        >
                          <Input placeholder="git" />
                        </Form.Item>
                      </Space>
                    </>
                  ),
                },
              ]}
            />
          </Form>
        </Card>
      </div>
    </div>
  );
}
