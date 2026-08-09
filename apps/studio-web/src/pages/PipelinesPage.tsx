import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Steps,
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
  RobotOutlined,
} from "@ant-design/icons";
import type { DigitalHuman, PipelineCreate, PipelinePublic, PipelineStep } from "@agent-studio/agent-schema";
import { digitalHumansApi } from "../api/digital-humans";
import { pipelinesApi } from "../api/pipelines";

type EditorValues = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tags?: string;
  dify_enabled: boolean;
  dify_api_base?: string;
  dify_api_key?: string;
  dify_app_id?: string;
  dify_workflow_id?: string;
  dify_note?: string;
  steps: Array<{
    id: string;
    agent: string;
    label?: string;
    human_approval: boolean;
    on_reject: "end" | "retry_step" | "goto";
    reject_goto?: string;
  }>;
};

function toSteps(values: EditorValues["steps"]): PipelineStep[] {
  return values.map((s, index) => ({
    id: s.id.trim(),
    agent: s.agent,
    label: (s.label || "").trim(),
    human_approval: s.human_approval,
    on_reject: s.on_reject,
    reject_goto: s.reject_goto,
    inputs_from: index === 0 ? [] : [values[index - 1].id.trim()],
  }));
}

export function PipelinesPage() {
  const [items, setItems] = useState<PipelinePublic[]>([]);
  const [humans, setHumans] = useState<DigitalHuman[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [enabled, setEnabled] = useState("all");
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composePrompt, setComposePrompt] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [form] = Form.useForm<EditorValues>();

  const selected = useMemo(
    () => items.find((p) => p.id === selectedId) || null,
    [items, selectedId],
  );

  const agentOptions = useMemo(
    () =>
      humans
        .filter((h) => h.enabled)
        .map((h) => ({ value: h.id, label: `${h.name} (${h.id})` })),
    [humans],
  );

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const [pipelines, humanList] = await Promise.all([
        pipelinesApi.list({ q, enabled }),
        digitalHumansApi.list({ enabled: "all" }),
      ]);
      setItems(pipelines.items);
      setTotal(pipelines.total);
      setHumans(humanList.items);
      const nextId = keepId === undefined ? selectedId : keepId;
      if (nextId && !pipelines.items.some((p) => p.id === nextId)) {
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
  }, [q, enabled]);

  function openCreate(draft?: PipelineCreate) {
    setEditingId(null);
    form.setFieldsValue({
      id: draft?.id || "",
      name: draft?.name || "",
      description: draft?.description || "",
      enabled: draft?.enabled ?? true,
      tags: (draft?.tags || []).join(", "),
      steps: (draft?.steps || [
        {
          id: "step_1",
          agent: humans[0]?.id || "requirement",
          label: "步骤 1",
          human_approval: true,
          on_reject: "end" as const,
          reject_goto: undefined as string | undefined,
        },
      ]).map((s) => ({
        id: s.id,
        agent: s.agent,
        label: s.label || "",
        human_approval: s.human_approval ?? true,
        on_reject: (s.on_reject || "end") as "end" | "retry_step" | "goto",
        reject_goto: "reject_goto" in s ? s.reject_goto : undefined,
      })),
      dify_enabled: Boolean(draft?.dify?.enabled),
      dify_api_base: draft?.dify && "api_base" in draft.dify ? draft.dify.api_base || "" : "",
      dify_api_key: "",
      dify_app_id: draft?.dify && "app_id" in draft.dify ? draft.dify.app_id || "" : "",
      dify_workflow_id:
        draft?.dify && "workflow_id" in draft.dify ? draft.dify.workflow_id || "" : "",
      dify_note: draft?.dify && "note" in draft.dify ? draft.dify.note || "" : "",
    });
    setEditorOpen(true);
  }

  function openEdit(pipeline: PipelinePublic) {
    setEditingId(pipeline.id);
    form.setFieldsValue({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description || "",
      enabled: pipeline.enabled,
      tags: (pipeline.tags || []).join(", "),
      steps: pipeline.steps.map((s) => ({
        id: s.id,
        agent: s.agent,
        label: s.label || "",
        human_approval: s.human_approval,
        on_reject: s.on_reject,
        reject_goto: s.reject_goto,
      })),
      dify_enabled: Boolean(pipeline.dify?.enabled),
      dify_api_base: pipeline.dify?.api_base || "",
      dify_api_key: "",
      dify_app_id: pipeline.dify?.app_id || "",
      dify_workflow_id: pipeline.dify?.workflow_id || "",
      dify_note: pipeline.dify?.note || "",
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    try {
      const values = await form.validateFields();
      const payload: PipelineCreate = {
        id: values.id.trim(),
        name: values.name.trim(),
        description: (values.description || "").trim(),
        enabled: values.enabled,
        tags: (values.tags || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        source: { kind: editingId ? "handwritten" : "handwritten" },
        defaults: { human_approval: true, on_reject: "end" },
        steps: toSteps(values.steps),
        dify: {
          enabled: values.dify_enabled,
          api_base: (values.dify_api_base || "").trim(),
          api_key: (values.dify_api_key || "").trim(),
          app_id: (values.dify_app_id || "").trim(),
          workflow_id: (values.dify_workflow_id || "").trim(),
          note: (values.dify_note || "").trim(),
        },
      };
      if (editingId) {
        await pipelinesApi.update(editingId, payload);
        setSelectedId(editingId);
        message.success("流水线已更新");
      } else {
        const created = await pipelinesApi.create(payload);
        setSelectedId(created.id);
        message.success("流水线已创建");
      }
      setEditorOpen(false);
      await reload(editingId || payload.id);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function runCompose(save: boolean) {
    if (!composePrompt.trim()) {
      message.warning("请先填写自然语言描述");
      return;
    }
    setComposeLoading(true);
    try {
      const result = await pipelinesApi.compose({
        prompt: composePrompt.trim(),
        save,
      });
      setComposeOpen(false);
      const by =
        result.generated_by === "agent"
          ? `Agent${result.driver ? ` (${result.driver})` : ""}`
          : "规则回退";
      if (save) {
        message.success(`已生成并保存流水线（${by}）`);
        const id = (result.draft as PipelinePublic).id;
        setSelectedId(id);
        await reload(id);
      } else {
        message.success(`已生成草稿（${by}），可继续编辑后保存`);
        openCreate(result.draft as PipelineCreate);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setComposeLoading(false);
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row justify="space-between" align="middle" gutter={[16, 16]}>
        <Col>
          <Typography.Title level={3} style={{ margin: 0 }}>
            流水线
          </Typography.Title>
          <Typography.Text type="secondary">
            把数字人编排成交付流程；支持自然语言生成（共 {total} 条）
          </Typography.Text>
        </Col>
        <Col>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={async () => {
                await digitalHumansApi.seedDefaults();
                const r = await pipelinesApi.seedDefaults();
                message.success(
                  `导入 ${r.imported.length}，跳过 ${r.skipped.length}，共 ${r.total}`,
                );
                await reload();
              }}
            >
              导入默认
            </Button>
            <Button onClick={() => setComposeOpen(true)}>自然语言生成</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
              新建流水线
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
      </Space>

      <Row gutter={16}>
        <Col xs={24} md={8} lg={7}>
          <Card size="small" title="列表" loading={loading}>
            {!items.length ? (
              <Empty description="暂无流水线" />
            ) : (
              <List
                dataSource={items}
                renderItem={(p) => (
                  <List.Item
                    style={{
                      cursor: "pointer",
                      background: p.id === selectedId ? "#e6f4ff" : undefined,
                      borderRadius: 8,
                      paddingInline: 8,
                    }}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <List.Item.Meta
                      title={p.name}
                      description={`${p.id} · ${p.steps.length} 步`}
                    />
                    <Tag color={p.enabled ? "success" : "default"}>
                      {p.enabled ? "启用" : "停用"}
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
                      await pipelinesApi.setEnabled(selected.id, checked);
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
                          await pipelinesApi.remove(selected.id);
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
              <Empty description="选择左侧流水线，或新建 / 自然语言生成" />
            ) : (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {selected.description || "（无描述）"}
                </Typography.Paragraph>
                <Space wrap>
                  <Tag>{selected.source?.kind || "handwritten"}</Tag>
                  {(selected.tags || []).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  {selected.dify?.enabled ? (
                    <Tag color="processing">
                      Dify 绑定
                      {selected.dify.api_key_set ? " · Key 已配置" : " · 缺 Key"}
                    </Tag>
                  ) : (
                    <Tag>Dify 用全局默认 App</Tag>
                  )}
                </Space>
                <Card size="small" type="inner" title="Dify 流水线绑定">
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                      一条 Studio 流水线对应一个 Dify Workflow App。启用绑定后，工单选
                      Dify 执行将使用本流水线的 App Key；未启用则走设置页全局默认。
                    </Typography.Text>
                    <Typography.Text>
                      api_base：{selected.dify?.api_base || "（继承全局）"}
                    </Typography.Text>
                    <Typography.Text>
                      app_id：{selected.dify?.app_id || "—"}
                      {selected.dify?.workflow_id
                        ? ` · workflow：${selected.dify.workflow_id}`
                        : ""}
                    </Typography.Text>
                    {selected.dify?.note ? (
                      <Typography.Text type="secondary">{selected.dify.note}</Typography.Text>
                    ) : null}
                    <Space wrap>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          const res = await pipelinesApi.difyHealth(selected.id);
                          if (res.ok) {
                            message.success(
                              `连通成功 · binding=${res.binding_source} · ${res.api_base}`,
                            );
                          } else {
                            message.error(res.error || "连通失败");
                          }
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      测试本流水线 Dify
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      onClick={async () => {
                        try {
                          const res = await pipelinesApi.getDifyDsl(selected.id);
                          const blob = new Blob([res.yaml], {
                            type: "text/yaml;charset=utf-8",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = res.filename;
                          a.click();
                          URL.revokeObjectURL(url);
                          message.success(res.hint);
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      生成并下载 Dify DSL
                    </Button>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          const overwrite = Boolean(selected.dify?.app_id);
                          const res = await pipelinesApi.importDifyDsl(selected.id, {
                            overwrite,
                          });
                          message.success(
                            res.hint ||
                              (res.published
                                ? "已导入并发布到 Dify"
                                : "已导入到 Dify"),
                          );
                          await reload(selected.id);
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      一键导入并发布到 Dify
                    </Button>
                    </Space>
                  </Space>
                </Card>
                {selected.source?.nl_prompt ? (
                  <Card size="small" type="inner" title="自然语言原文">
                    {selected.source.nl_prompt}
                  </Card>
                ) : null}
                <Steps
                  direction="vertical"
                  size="small"
                  items=                {selected.steps.map((s) => ({
                    title: s.label || s.id,
                    description: (
                      <Space direction="vertical" size={0}>
                        <span>
                          <RobotOutlined /> {s.agent}
                          {(() => {
                            const h = humans.find((x) => x.id === s.agent);
                            const tip = h?.dify?.agent_id || h?.dify?.agent_name;
                            return tip ? (
                              <Typography.Text type="secondary">
                                {" "}
                                → Dify {tip}（元数据，未执行）
                              </Typography.Text>
                            ) : null;
                          })()}
                        </span>
                        <Typography.Text type="secondary">
                          人工确认：{s.human_approval ? "是" : "否"}；驳回：
                          {s.on_reject}
                          {s.on_reject === "goto" && s.reject_goto
                            ? ` → ${s.reject_goto}`
                            : ""}
                        </Typography.Text>
                      </Space>
                    ),
                    status: "wait" as const,
                  }))}
                />
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title={editingId ? `编辑 ${editingId}` : "新建流水线"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveEditor()}
        width={820}
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
                  { pattern: /^[a-z][a-z0-9_-]*$/, message: "小写字母开头" },
                ]}
              >
                <Input disabled={Boolean(editingId)} placeholder="full-delivery" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="描述">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tags" label="标签（逗号分隔）">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Typography.Title level={5}>Dify 绑定（一条流水线 ↔ 一个 App）</Typography.Title>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="dify_enabled"
                label="启用本流水线独立 Dify App"
                valuePropName="checked"
                extra="关闭则使用设置页的全局默认 Workflow App"
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dify_api_base" label="API Base（可选）">
                <Input placeholder="留空则用全局 api_base" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="dify_api_key"
                label="Workflow App API Key"
                extra={
                  editingId
                    ? "已保存的 Key 不会回显；留空表示保持不变"
                    : "在 Dify 对应应用「访问 API」中复制"
                }
              >
                <Input.Password placeholder="app-..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dify_app_id" label="App ID（可选）">
                <Input placeholder="Dify 应用 ID，便于对照" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dify_workflow_id" label="Workflow ID（可选）">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="dify_note" label="备注">
                <Input.TextArea rows={2} placeholder="例如：对应 Dify 里「交付流水线」应用" />
              </Form.Item>
            </Col>
          </Row>

          <Typography.Title level={5}>步骤</Typography.Title>
          <Form.List name="steps">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    size="small"
                    title={`步骤 ${index + 1}`}
                    extra={
                      fields.length > 1 ? (
                        <Button type="link" danger onClick={() => remove(field.name)}>
                          删除
                        </Button>
                      ) : null
                    }
                  >
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "id"]}
                          label="步骤 ID"
                          rules={[{ required: true }]}
                        >
                          <Input placeholder="dev" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "agent"]}
                          label="数字人"
                          rules={[{ required: true }]}
                        >
                          <Select options={agentOptions} showSearch optionFilterProp="label" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item {...field} name={[field.name, "label"]} label="显示名">
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "human_approval"]}
                          label="人工确认"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "on_reject"]}
                          label="驳回策略"
                          initialValue="end"
                        >
                          <Select
                            options={[
                              { value: "end", label: "结束" },
                              { value: "retry_step", label: "重试本步" },
                              { value: "goto", label: "跳转" },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "reject_goto"]}
                          label="跳转步骤 ID"
                        >
                          <Input placeholder="dev" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      id: `step_${fields.length + 1}`,
                      agent: humans[0]?.id,
                      label: "",
                      human_approval: true,
                      on_reject: "end",
                    })
                  }
                >
                  添加步骤
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title="自然语言生成流水线"
        open={composeOpen}
        onCancel={() => !composeLoading && setComposeOpen(false)}
        confirmLoading={composeLoading}
        footer={[
          <Button
            key="cancel"
            disabled={composeLoading}
            onClick={() => setComposeOpen(false)}
          >
            取消
          </Button>,
          <Button
            key="draft"
            loading={composeLoading}
            onClick={() => void runCompose(false)}
          >
            生成草稿
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={composeLoading}
            onClick={() => void runCompose(true)}
          >
            生成并保存
          </Button>,
        ]}
      >
        <Typography.Paragraph type="secondary">
          由 Bridge 上的 Agent 生成流水线步骤（失败则自动回退规则模板）。例如：先做需求澄清，开发完要代码评审，再测试，最后只发测试环境。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={composePrompt}
          disabled={composeLoading}
          onChange={(e) => setComposePrompt(e.target.value)}
          placeholder="描述你想要的流水线…"
        />
      </Modal>
    </Space>
  );
}
