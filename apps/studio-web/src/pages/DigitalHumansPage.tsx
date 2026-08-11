import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { DigitalHuman, DigitalHumanCreate, Role } from "@agent-studio/agent-schema";
import { digitalHumansApi } from "../api/digital-humans";
import { getSelectedTeam } from "../auth/session";

const ROLES: Role[] = [
  "intake",
  "clarify",
  "spec",
  "plan",
  "implement",
  "review",
  "verify",
  "ops",
  "orchestrate",
];

function lines(text: string) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function avatarOf(agent: DigitalHuman) {
  return (agent.avatar_label || agent.name || "?").slice(0, 1);
}

type FormValues = {
  id: string;
  name: string;
  role: Role;
  avatar_label?: string;
  description?: string;
  responsibilities: string;
  prompt_hints?: string;
  tags?: string;
  output_key: string;
  output_path: string;
  may_modify_code: boolean;
  may_run_commands: boolean;
  may_commit: boolean;
  may_deploy: "none" | "staging" | "production";
  dify_agent_id?: string;
  dify_agent_name?: string;
  dify_note?: string;
  human_gate_default: boolean;
  enabled: boolean;
};

export function DigitalHumansPage() {
  const [items, setItems] = useState<DigitalHuman[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<string | undefined>();
  const [enabled, setEnabled] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();

  const selected = useMemo(
    () => items.find((a) => a.id === selectedId) || null,
    [items, selectedId],
  );

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const data = await digitalHumansApi.list({
        q,
        role,
        enabled,
        team_id: getSelectedTeam()?.id,
      });
      setItems(data.items);
      setTotal(data.total);
      const nextId = keepId === undefined ? selectedId : keepId;
      if (nextId && !data.items.some((a) => a.id === nextId)) {
        setSelectedId(null);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, role, enabled]);

  function openCreate() {
    setEditingId(null);
    form.setFieldsValue({
      id: "",
      name: "",
      role: "intake",
      avatar_label: "",
      description: "",
      responsibilities: "",
      prompt_hints: "",
      tags: "",
      output_key: "",
      output_path: "",
      may_modify_code: false,
      may_run_commands: false,
      may_commit: false,
      may_deploy: "none",
      dify_agent_id: "",
      dify_agent_name: "",
      dify_note: "",
      human_gate_default: true,
      enabled: true,
    });
    setEditorOpen(true);
  }

  function openEdit(agent: DigitalHuman) {
    setEditingId(agent.id);
    form.setFieldsValue({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      avatar_label: agent.avatar_label || "",
      description: agent.description || "",
      responsibilities: (agent.responsibilities || []).join("\n"),
      prompt_hints: (agent.prompt_hints || []).join("\n"),
      tags: (agent.tags || []).join(", "),
      output_key: agent.outputs?.[0]?.key || "",
      output_path: agent.outputs?.[0]?.path || "",
      may_modify_code: agent.permissions.may_modify_code,
      may_run_commands: agent.permissions.may_run_commands,
      may_commit: Boolean(agent.permissions.may_commit),
      may_deploy: agent.permissions.may_deploy,
      dify_agent_id: agent.dify?.agent_id || "",
      dify_agent_name: agent.dify?.agent_name || "",
      dify_note: agent.dify?.note || "",
      human_gate_default: agent.human_gate_default,
      enabled: agent.enabled,
    });
    setEditorOpen(true);
  }

  function toPayload(values: FormValues): DigitalHumanCreate {
    return {
      id: values.id.trim(),
      team_id: getSelectedTeam()?.id || "",
      name: values.name.trim(),
      role: values.role,
      avatar_label: (values.avatar_label || "").trim() || values.name.trim().slice(0, 1),
      description: (values.description || "").trim(),
      responsibilities: lines(values.responsibilities),
      prompt_hints: lines(values.prompt_hints || ""),
      tags: (values.tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      permissions: {
        may_modify_code: values.may_modify_code,
        may_run_commands: values.may_run_commands,
        may_commit: values.may_commit,
        may_deploy: values.may_deploy,
        forbidden_paths_extra: [],
      },
      dify: {
        agent_id: (values.dify_agent_id || "").trim(),
        agent_name: (values.dify_agent_name || "").trim(),
        note: (values.dify_note || "").trim(),
      },
      inputs: [],
      outputs: [
        {
          key: values.output_key.trim(),
          path: values.output_path.trim(),
          required: true,
        },
      ],
      commands: [],
      human_gate_default: values.human_gate_default,
      enabled: values.enabled,
    };
  }

  async function saveForm() {
    try {
      const values = await form.validateFields();
      const payload = toPayload(values);
      if (editingId) {
        await digitalHumansApi.update(editingId, payload);
        setSelectedId(editingId);
        message.success("已更新");
      } else {
        const created = await digitalHumansApi.create(payload);
        setSelectedId(created.id);
        message.success("已创建");
      }
      setEditorOpen(false);
      await reload(editingId || values.id.trim());
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row justify="space-between" align="middle" gutter={[16, 16]}>
        <Col>
          <Typography.Title level={3} style={{ margin: 0 }}>
            数字人
          </Typography.Title>
          <Typography.Text type="secondary">
            管理 Agent 档案：职责、权限、产物与启停（共 {total} 个）
          </Typography.Text>
        </Col>
        <Col>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={async () => {
                const r = await digitalHumansApi.seedDefaults(getSelectedTeam()?.id);
                message.success(
                  `导入 ${r.imported.length}，跳过 ${r.skipped.length}，共 ${r.total}`,
                );
                await reload();
              }}
            >
              导入默认
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建数字人
            </Button>
          </Space>
        </Col>
      </Row>

      <Space wrap>
        <Input.Search
          allowClear
          placeholder="搜索 id / 名称 / 标签"
          style={{ width: 260 }}
          onSearch={setQ}
          onChange={(e) => {
            if (!e.target.value) setQ("");
          }}
        />
        <Select
          value={enabled}
          style={{ width: 140 }}
          onChange={setEnabled}
          options={[
            { value: "all", label: "全部状态" },
            { value: "true", label: "仅启用" },
            { value: "false", label: "仅停用" },
          ]}
        />
        <Select
          allowClear
          placeholder="全部角色"
          style={{ width: 160 }}
          value={role}
          onChange={(v) => setRole(v)}
          options={ROLES.map((r) => ({ value: r, label: r }))}
        />
      </Space>

      <Row gutter={16}>
        <Col xs={24} md={8} lg={7}>
          <Card size="small" title="列表" loading={loading}>
            {!items.length ? (
              <Empty description="暂无数字人" />
            ) : (
              <List
                dataSource={items}
                renderItem={(a) => (
                  <List.Item
                    style={{
                      cursor: "pointer",
                      background: a.id === selectedId ? "#e6f4ff" : undefined,
                      borderRadius: 8,
                      paddingInline: 8,
                    }}
                    onClick={() => setSelectedId(a.id)}
                  >
                    <List.Item.Meta
                      avatar={<Avatar>{avatarOf(a)}</Avatar>}
                      title={a.name}
                      description={`${a.id} · ${a.role}`}
                    />
                    <Tag color={a.enabled ? "success" : "default"}>
                      {a.enabled ? "启用" : "停用"}
                    </Tag>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} md={16} lg={17}>
          <Card
            size="small"
            title={selected ? selected.name : "详情"}
            extra={
              selected ? (
                <Space>
                  <Switch
                    checkedChildren="启用"
                    unCheckedChildren="停用"
                    checked={selected.enabled}
                    onChange={async (checked) => {
                      await digitalHumansApi.setEnabled(selected.id, checked);
                      await reload(selected.id);
                    }}
                  />
                  <Button icon={<EditOutlined />} onClick={() => openEdit(selected)}>
                    编辑
                  </Button>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      Modal.confirm({
                        title: `确认删除「${selected.name}」？`,
                        okType: "danger",
                        onOk: async () => {
                          await digitalHumansApi.remove(selected.id);
                          setSelectedId(null);
                          await reload(null);
                          message.success("已删除");
                        },
                      });
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ) : null
            }
          >
            {!selected ? (
              <Empty description="选择左侧数字人，或新建一个" />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  {selected.id} · {selected.role}
                </Typography.Text>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="描述">
                    {selected.description || "（无）"}
                  </Descriptions.Item>
                  <Descriptions.Item label="职责">
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selected.responsibilities.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </Descriptions.Item>
                  <Descriptions.Item label="权限">
                    改代码：{selected.permissions.may_modify_code ? "是" : "否"}；跑命令：
                    {selected.permissions.may_run_commands ? "是" : "否"}；提交：
                    {selected.permissions.may_commit ? "是（评审通过后）" : "否"}；部署：
                    {selected.permissions.may_deploy}；人工门禁：
                    {selected.human_gate_default ? "开" : "关"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Dify Agent（元数据）">
                    <Typography.Text type="secondary">
                      仅备注，尚未作为执行器调用（步骤仍走流水线 Workflow → Bridge）
                    </Typography.Text>
                    {selected.dify?.agent_id || selected.dify?.agent_name ? (
                      <div>
                        {selected.dify.agent_name || "—"} (
                        {selected.dify.agent_id || "—"})
                      </div>
                    ) : (
                      <div>未填写</div>
                    )}
                    {selected.dify?.note ? (
                      <div>
                        <Typography.Text type="secondary">{selected.dify.note}</Typography.Text>
                      </div>
                    ) : null}
                  </Descriptions.Item>
                  <Descriptions.Item label="产物">
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selected.outputs.map((o) => (
                        <li key={o.key}>
                          <Typography.Text code>{o.key}</Typography.Text> → {o.path}
                        </li>
                      ))}
                    </ul>
                  </Descriptions.Item>
                  <Descriptions.Item label="Prompt 提示">
                    {(selected.prompt_hints || []).length ? (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {selected.prompt_hints.map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    ) : (
                      "（无）"
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="标签">
                    {(selected.tags || []).map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </Descriptions.Item>
                  <Descriptions.Item label="更新时间">
                    {selected.updated_at || "-"}
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title={editingId ? `编辑 ${editingId}` : "新建数字人"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveForm()}
        width={720}
        destroyOnHidden
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="id"
                label="ID"
                rules={[
                  { required: true },
                  { pattern: /^[a-z][a-z0-9_]*$/, message: "须为 snake_case" },
                ]}
              >
                <Input disabled={Boolean(editingId)} placeholder="requirement_intake" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="role" label="角色" rules={[{ required: true }]}>
                <Select options={ROLES.map((r) => ({ value: r, label: r }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="avatar_label" label="头像字">
                <Input maxLength={2} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="描述">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="responsibilities"
                label="职责（每行一条）"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={4} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="prompt_hints" label="Prompt 提示（每行一条）">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="output_key" label="产出 key" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="output_path" label="产出 path" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="may_deploy" label="部署权限" initialValue="none">
                <Select
                  options={[
                    { value: "none", label: "none" },
                    { value: "staging", label: "staging" },
                    { value: "production", label: "production" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="Dify Agent 绑定尚未实现"
                description="下列字段只做展示/备注。真正执行仍是：流水线绑定 Workflow App → HTTP 调用本机 Bridge。云端 Dify Agent 作步骤执行器见 TODO。"
              />
            </Col>
            <Col span={12}>
              <Form.Item
                name="dify_agent_id"
                label="Dify Agent ID（未实现）"
                extra="可选元数据，不参与当前执行"
              >
                <Input placeholder="对应 Dify Agent / 节点 id" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="dify_agent_name"
                label="Dify Agent 名称（未实现）"
                extra="可选显示名"
              >
                <Input placeholder="可选显示名" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="dify_note" label="Dify 映射备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tags" label="标签（逗号分隔）">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Space size="large" wrap>
                <Form.Item name="may_modify_code" valuePropName="checked" noStyle>
                  <Checkbox>可改代码</Checkbox>
                </Form.Item>
                <Form.Item name="may_run_commands" valuePropName="checked" noStyle>
                  <Checkbox>可跑命令</Checkbox>
                </Form.Item>
                <Form.Item name="may_commit" valuePropName="checked" noStyle>
                  <Checkbox>可提交（评审通过后 commit）</Checkbox>
                </Form.Item>
                <Form.Item
                  name="human_gate_default"
                  valuePropName="checked"
                  noStyle
                  initialValue={true}
                >
                  <Checkbox>默认人工确认</Checkbox>
                </Form.Item>
                <Form.Item name="enabled" valuePropName="checked" noStyle initialValue={true}>
                  <Checkbox>启用</Checkbox>
                </Form.Item>
              </Space>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}
