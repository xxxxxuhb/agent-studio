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
import { authApi } from "../api/auth";
import { settingsApi, type StudioSettingsUpdate } from "../api/settings";
import {
  getSelectedTeam,
  getStoredUser,
  getToken,
  setSession,
  type StoredUser,
} from "../auth/session";

type ProfileForm = {
  username: string;
  display_name: string;
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
};

export function SettingsPage() {
  const [form] = Form.useForm<StudioSettingsUpdate>();
  const [profileForm] = Form.useForm<ProfileForm>();
  const [config, setConfig] = useState<StudioConfigPublic | null>(null);
  const [user, setUser] = useState<StoredUser | null>(getStoredUser());
  const [loading, setLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  function requireTeamId() {
    const id = getSelectedTeam()?.id;
    if (!id) throw new Error("请先选择团队");
    return id;
  }

  function fillProfile(u: StoredUser | null) {
    profileForm.setFieldsValue({
      username: u?.username || "",
      display_name: u?.display_name || "",
      current_password: "",
      new_password: "",
      confirm_password: "",
    });
  }

  async function reloadTeam() {
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

  async function reloadProfile() {
    try {
      const me = await authApi.me();
      setUser(me);
      fillProfile(me);
      const token = getToken();
      if (token) setSession(token, me);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    fillProfile(getStoredUser());
    void reloadProfile();
    void reloadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveTeam() {
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
      setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    try {
      const values = await profileForm.validateFields();
      if (values.new_password || values.confirm_password) {
        if (values.new_password !== values.confirm_password) {
          message.error("两次输入的新密码不一致");
          return;
        }
      }
      setProfileSaving(true);
      const body: {
        display_name?: string;
        current_password?: string;
        new_password?: string;
      } = {
        display_name: values.display_name?.trim() ?? "",
      };
      if (values.new_password) {
        body.current_password = values.current_password;
        body.new_password = values.new_password;
      }
      const res = await authApi.updateProfile(body);
      const token = res.token || getToken();
      if (token) setSession(token, res.user);
      setUser(res.user);
      fillProfile(res.user);
      message.success(
        values.new_password ? "个人信息与密码已更新" : "个人信息已保存",
      );
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileSaving(false);
    }
  }

  function onSave() {
    if (activeTab === "profile") void saveProfile();
    else void saveTeam();
  }

  function onReload() {
    if (activeTab === "profile") void reloadProfile();
    else void reloadTeam();
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <span className="page-meta">
            {activeTab === "profile"
              ? "个人账号 · 显示名与密码"
              : "当前团队配置 · 空字段回退安装级默认"}
          </span>
          {activeTab !== "profile" && config ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              Bridge {config.bridge_base_url || "未设置"} ·{" "}
              {config.language === "zh" ? "中文" : "EN"} · AGENTS.md{" "}
              {config.agents_md_path || "auto"}
            </Typography.Text>
          ) : null}
          {activeTab === "profile" && user ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              @{user.username}
              {user.is_admin ? " · 系统管理员" : ""}
            </Typography.Text>
          ) : null}
        </div>
        <div className="page-toolbar-actions">
          <Button onClick={onReload} disabled={loading || profileSaving}>
            刷新
          </Button>
          <Button
            type="primary"
            onClick={onSave}
            loading={activeTab === "profile" ? profileSaving : loading}
          >
            保存
          </Button>
        </div>
      </div>

      <div className="page-scroll">
        <Card
          size="small"
          className="settings-card"
          loading={loading && !config && activeTab !== "profile"}
        >
          <Tabs
            size="small"
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "profile",
                label: "个人账号",
                children: (
                  <Form
                    form={profileForm}
                    layout="vertical"
                    disabled={profileSaving}
                    style={{ maxWidth: 480 }}
                  >
                    <Form.Item name="username" label="用户名">
                      <Input disabled />
                    </Form.Item>
                    <Form.Item
                      name="display_name"
                      label="显示名"
                      rules={[{ max: 128, message: "最多 128 字" }]}
                      extra="顶栏与团队成员列表中展示的名称"
                    >
                      <Input placeholder="你的名字" allowClear />
                    </Form.Item>
                    <Typography.Title level={5} style={{ marginTop: 8 }}>
                      修改密码
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
                      不改密码请留空。
                    </Typography.Paragraph>
                    <Form.Item name="current_password" label="当前密码">
                      <Input.Password
                        autoComplete="current-password"
                        placeholder="••••••••"
                      />
                    </Form.Item>
                    <Form.Item
                      name="new_password"
                      label="新密码"
                      rules={[{ min: 6, message: "至少 6 位" }]}
                    >
                      <Input.Password
                        autoComplete="new-password"
                        placeholder="至少 6 位"
                      />
                    </Form.Item>
                    <Form.Item name="confirm_password" label="确认新密码">
                      <Input.Password
                        autoComplete="new-password"
                        placeholder="再输入一次"
                      />
                    </Form.Item>
                  </Form>
                ),
              },
              {
                key: "general",
                label: "通用",
                children: (
                  <Form form={form} layout="vertical" disabled={loading} style={{ maxWidth: 640 }}>
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
                  </Form>
                ),
              },
              {
                key: "bridge",
                label: "Bridge",
                children: (
                  <Form form={form} layout="vertical" disabled={loading} style={{ maxWidth: 640 }}>
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
                  </Form>
                ),
              },
              {
                key: "git",
                label: "Git SSH",
                children: (
                  <Form form={form} layout="vertical" disabled={loading} style={{ maxWidth: 640 }}>
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
                        <InputNumber min={0} style={{ width: "100%" }} placeholder="22" />
                      </Form.Item>
                      <Form.Item
                        name="git_ssh_user"
                        label="SSH 用户"
                        style={{ marginBottom: 0, width: 160 }}
                      >
                        <Input placeholder="git" />
                      </Form.Item>
                    </Space>
                  </Form>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
