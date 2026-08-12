import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { BridgeExecutor } from "@agent-studio/agent-schema";
import { bridgesApi, type BridgePrepareResult } from "../api/bridges";
import { getSelectedTeam } from "../auth/session";
import { subscribeBridges } from "../ws/bridges";
import {
  AGENT_DRIVER_AUTH,
  DRIVER_SELECT_OPTIONS,
  type AgentAuthMode,
  decorateBridgeCommand,
} from "./bridgeDriverAuth";

function statusTag(status: string) {
  if (status === "online") return <Tag color="success">在线</Tag>;
  if (status === "busy") return <Tag color="processing">执行中</Tag>;
  return <Tag>离线</Tag>;
}

function defaultStudioUrl() {
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://127.0.0.1:8790";
  }
  return `${protocol}//${hostname}:8790`;
}

function defaultPublicUrl(port = 8787) {
  return `http://127.0.0.1:${port}`;
}

type PrepareForm = {
  name: string;
  driver: string;
  studio_url: string;
  base_url: string;
  auth_mode: AgentAuthMode;
  api_key?: string;
};

type PreparedView = BridgePrepareResult & {
  install_command_display: string;
  local_command_display: string;
};

export function BridgesPage() {
  const [items, setItems] = useState<BridgeExecutor[]>([]);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prepared, setPrepared] = useState<PreparedView | null>(null);
  const [form] = Form.useForm<PrepareForm>();
  const driverWatch = Form.useWatch("driver", form) || "cursor";
  const authModeWatch = Form.useWatch("auth_mode", form) || "key";
  const driverMeta = AGENT_DRIVER_AUTH[driverWatch] || AGENT_DRIVER_AUTH.cursor;

  const initialValues = useMemo<PrepareForm>(
    () => ({
      name: "",
      driver: "cursor",
      studio_url: defaultStudioUrl(),
      base_url: defaultPublicUrl(),
      auth_mode: "key",
      api_key: "",
    }),
    [],
  );

  async function reload() {
    setLoading(true);
    try {
      const res = await bridgesApi.list({ team_id: getSelectedTeam()?.id });
      setItems(res.items);
      setTokenConfigured(res.token_configured);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    return subscribeBridges({
      onStatus: setWsStatus,
      onBridges: setItems,
      onBridge: (bridge) => {
        setItems((prev) => {
          const idx = prev.findIndex((b) => b.id === bridge.id);
          if (idx < 0) return [bridge, ...prev];
          const next = [...prev];
          next[idx] = bridge;
          return next;
        });
      },
    });
  }, []);

  function openAdd() {
    setPrepared(null);
    form.setFieldsValue(initialValues);
    setAddOpen(true);
  }

  function onDriverChange(driver: string) {
    const meta = AGENT_DRIVER_AUTH[driver] || AGENT_DRIVER_AUTH.cursor;
    form.setFieldsValue({
      driver,
      auth_mode: meta.defaultAuthMode,
      api_key: "",
    });
  }

  async function submitPrepare() {
    try {
      const values = await form.validateFields();
      const meta = AGENT_DRIVER_AUTH[values.driver];
      if (meta?.unsupportedTip && values.driver === "openai") {
        message.warning(meta.unsupportedTip);
        return;
      }
      if (values.auth_mode === "key" && meta?.envKey && !values.api_key?.trim()) {
        message.error(`请填写 ${meta.envKey}，或改选「浏览器登录」`);
        return;
      }

      setSubmitting(true);
      const teamId = getSelectedTeam()?.id;
      if (!teamId) {
        message.error("请先选择团队");
        return;
      }
      const res = await bridgesApi.prepare({
        name: values.name.trim(),
        team_id: teamId,
        driver: values.driver,
        studio_url: values.studio_url.trim().replace(/\/$/, ""),
        base_url: values.base_url.trim().replace(/\/$/, ""),
        auth_mode: values.auth_mode,
      });

      const key =
        values.auth_mode === "key" ? values.api_key?.trim() : undefined;
      const metaAfter = AGENT_DRIVER_AUTH[values.driver];
      setPrepared({
        ...res,
        install_command_display: decorateBridgeCommand(res.install_command, {
          authMode: values.auth_mode,
          meta: metaAfter,
          apiKey: key,
        }),
        local_command_display: decorateBridgeCommand(res.local_command, {
          authMode: values.auth_mode,
          meta: metaAfter,
          apiKey: key,
        }),
      });
      setTokenConfigured(res.token_configured);
      message.success("已添加，请复制命令到执行器机器运行");
      await reload();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const authModeOptions = driverMeta.authModes.map((mode) => {
    if (mode === "key") return { value: "key", label: "填写 API Key" };
    if (mode === "login") return { value: "login", label: "浏览器登录" };
    return { value: "none", label: "无需凭证" };
  });

  return (
    <div className="page-shell">
      {!tokenConfigured ? (
        <Alert
          type="warning"
          showIcon
          style={{ flex: "0 0 auto" }}
          message="未配置 STUDIO_BRIDGE_TOKEN"
          description="在 Studio API 环境变量中设置 STUDIO_BRIDGE_TOKEN，执行器才能通过 WS 注册。"
        />
      ) : null}

      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <Tag
            color={
              wsStatus === "connected"
                ? "success"
                : wsStatus === "connecting"
                  ? "processing"
                  : "default"
            }
          >
            WS {wsStatus}
          </Tag>
          <span className="page-meta">{items.length} 台执行器</span>
        </div>
        <div className="page-toolbar-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            添加执行器
          </Button>
        </div>
      </div>

      <div className="pane" style={{ flex: 1 }}>
        <Card size="small" className="pane-card" styles={{ body: { padding: 0 } }}>
          <Table<BridgeExecutor>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={false}
            scroll={{ y: "calc(100vh - 220px)" }}
            locale={{ emptyText: "暂无执行器，点右上角添加并复制启动命令" }}
            columns={[
            {
              title: "名称",
              dataIndex: "name",
              render: (v, r) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{v}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.id}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (s: string, r) => (
                <Space direction="vertical" size={0}>
                  {statusTag(s)}
                  {s === "busy" && r.current_run_id ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      run {r.current_run_id}
                    </Typography.Text>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "Agent 类型",
              key: "driver",
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <Tag color="blue">{r.driver}</Tag>
                  {r.driver_label ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.driver_label}
                    </Typography.Text>
                  ) : null}
                </Space>
              ),
            },
            {
              title: "base_url",
              dataIndex: "base_url",
              ellipsis: true,
              render: (v: string) => (
                <Typography.Text code copyable>
                  {v}
                </Typography.Text>
              ),
            },
            {
              title: "平台",
              dataIndex: "platform",
              width: 90,
            },
            {
              title: "最近心跳",
              dataIndex: "last_seen_at",
              width: 180,
              render: (v?: string) =>
                v ? new Date(v).toLocaleString() : "-",
            },
            {
              title: "",
              key: "actions",
              width: 80,
              render: (_, r) => (
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    Modal.confirm({
                      title: `删除执行器「${r.name}」？`,
                      onOk: async () => {
                        await bridgesApi.remove(r.id);
                        message.success("已删除");
                        await reload();
                      },
                    });
                  }}
                />
              ),
            },
          ]}
        />
        </Card>
      </div>

      <Modal
        title="添加执行器"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        width={760}
        destroyOnClose
        footer={
          prepared
            ? [
                <Button key="again" onClick={() => setPrepared(null)}>
                  再生成一条
                </Button>,
                <Button
                  key="close"
                  type="primary"
                  onClick={() => setAddOpen(false)}
                >
                  完成
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setAddOpen(false)}>
                  取消
                </Button>,
                <Button
                  key="ok"
                  type="primary"
                  loading={submitting}
                  disabled={Boolean(driverMeta.unsupportedTip) && driverWatch === "openai"}
                  onClick={() => void submitPrepare()}
                >
                  生成命令
                </Button>,
              ]
        }
      >
        {!prepared ? (
          <Form form={form} layout="vertical" initialValues={initialValues}>
            <Form.Item
              name="name"
              label="显示名称"
              rules={[{ required: true, message: "请输入名称" }]}
            >
              <Input placeholder="例如 my-mac" />
            </Form.Item>
            <Form.Item
              name="driver"
              label="Agent 类型"
              rules={[{ required: true }]}
            >
              <Select
                options={DRIVER_SELECT_OPTIONS}
                onChange={onDriverChange}
              />
            </Form.Item>

            {driverMeta.unsupportedTip ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={driverMeta.unsupportedTip}
              />
            ) : null}

            {driverMeta.authModes.length > 0 &&
            !(driverMeta.authModes.length === 1 && driverMeta.authModes[0] === "none") ? (
              <Form.Item
                name="auth_mode"
                label="Agent 鉴权"
                rules={[{ required: true }]}
              >
                <Radio.Group options={authModeOptions} optionType="button" />
              </Form.Item>
            ) : (
              <Form.Item name="auth_mode" hidden>
                <Input />
              </Form.Item>
            )}

            {authModeWatch === "key" && driverMeta.keyGuide ? (
              <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 16 }}>
                <Alert
                  type="info"
                  showIcon
                  message={driverMeta.keyGuide.title}
                  description={
                    <div>
                      <ol style={{ margin: "8px 0", paddingLeft: 18 }}>
                        {driverMeta.keyGuide.steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                      <Typography.Link
                        href={driverMeta.keyGuide.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {driverMeta.keyGuide.url}
                      </Typography.Link>
                    </div>
                  }
                />
                <Form.Item
                  name="api_key"
                  label={driverMeta.envKey || "API Key"}
                  rules={
                    driverMeta.authModes.includes("key")
                      ? [{ required: true, message: "请粘贴 API Key" }]
                      : undefined
                  }
                  extra="Key 只用于生成启动命令前缀，不会上传到 Studio"
                >
                  <Input.Password placeholder={`粘贴 ${driverMeta.envKey}`} />
                </Form.Item>
              </Space>
            ) : null}

            {authModeWatch === "login" && driverMeta.loginTip ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="浏览器登录"
                description={driverMeta.loginTip}
              />
            ) : null}

            <Form.Item
              name="studio_url"
              label="Studio API 地址"
              rules={[{ required: true, message: "请输入 Studio URL" }]}
              extra="执行器机器要能访问到的地址"
            >
              <Input placeholder="http://127.0.0.1:8790" />
            </Form.Item>
            <Form.Item
              name="base_url"
              label="执行器公网/局域网 URL"
              rules={[{ required: true, message: "请输入 public-url" }]}
              extra="Studio / Bridge 回调执行器的地址，对应 --public-url"
            >
              <Input placeholder="http://192.168.1.8:8787" />
            </Form.Item>
          </Form>
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="success"
              showIcon
              message={`已预登记「${prepared.bridge.name}」· ${prepared.bridge.driver} · auth=${prepared.auth_mode} · 离线待连接`}
            />
            {!prepared.token_configured ? (
              <Alert
                type="warning"
                showIcon
                message="命令中的 token 仍是占位符，请先配置 STUDIO_BRIDGE_TOKEN 后再重新生成"
              />
            ) : null}
            {prepared.auth_mode === "key" ? (
              <Alert
                type="warning"
                showIcon
                message="命令含 Agent API Key，请勿发到公开聊天或截图外传"
              />
            ) : null}
            <div>
              <Typography.Text strong>复制到执行器机器运行</Typography.Text>
              <Typography.Paragraph
                code
                copyable
                style={{ marginTop: 8, marginBottom: 0, whiteSpace: "pre-wrap" }}
              >
                {prepared.install_command_display}
              </Typography.Paragraph>
            </div>
            <div>
              <Typography.Text type="secondary">
                本仓库本地开发（包尚未发布到 npm 时）
              </Typography.Text>
              <Typography.Paragraph
                code
                copyable
                style={{ marginTop: 8, marginBottom: 0, whiteSpace: "pre-wrap" }}
              >
                {prepared.local_command_display}
              </Typography.Paragraph>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}
