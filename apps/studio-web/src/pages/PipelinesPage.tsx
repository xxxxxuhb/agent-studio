import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Collapse,
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
  ApartmentOutlined,
  NodeIndexOutlined,
} from "@ant-design/icons";
import type {
  DigitalHuman,
  PipelineCiStep,
  PipelineCreate,
  PipelineDelayStep,
  PipelineHttpStep,
  PipelinePublic,
  PipelineStep,
  PipelineStepBranch,
  PipelineStepKind,
  PipelineStepParallel,
  PipelineTrigger,
  PipelineWaitEventStep,
} from "@agent-studio/agent-schema";
import {
  PipelineTriggerSchema,
  PIPELINE_GRAPH_END,
  PIPELINE_GRAPH_START,
  synthesizePipelineEdges,
} from "@agent-studio/agent-schema";
import { digitalHumansApi } from "../api/digital-humans";
import { pipelinesApi } from "../api/pipelines";
import { getSelectedTeam } from "../auth/session";
import { EmptyRich, EmptyRichActionButton } from "../components/EmptyRich";
import { PipelineFlowEditor } from "../pipeline-flow/PipelineFlowEditor";
import { PipelineFlowModal } from "../pipeline-flow/PipelineFlowModal";
import { PipelineFlowView } from "../pipeline-flow/PipelineFlowView";
import { toFlowStepsFromPipeline } from "../pipeline-flow/buildPipelineFlow";

type EditorValues = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tags?: string;
  /** 开始节点连到的入口步骤 id */
  entry?: string;
  steps: Array<{
    id: string;
    agent: string;
    label?: string;
    kind?: PipelineStepKind;
    human_approval: boolean;
    on_reject: "end" | "retry_step" | "goto";
    reject_goto?: string;
    next?: string | null;
    branches?: PipelineStepBranch[];
    parallel?: PipelineStepParallel | null;
    http?: PipelineHttpStep | null;
    wait_event?: PipelineWaitEventStep | null;
    ci?: PipelineCiStep | null;
    delay?: PipelineDelayStep | null;
  }>;
  /** JSON array of PipelineTrigger (cron / forge_webhook). */
  triggers_json?: string;
};

/** Hydrate explicit next/entry from stored edges / step.next. Never invent linear chains. */
function hydrateFlowLinks(pipeline: {
  entry?: string;
  edges?: Array<{ id?: string; from: string; to: string; kind: string }>;
  steps: Array<{ id: string; next?: string | null }>;
}): { entry: string; nextById: Map<string, string | null> } {
  const nextById = new Map<string, string | null>();
  const edges = pipeline.edges || [];
  let entry = (pipeline.entry || "").trim();

  // Seed from step.next first (explicit null stays disconnected).
  for (const s of pipeline.steps) {
    if (s.next !== undefined) {
      nextById.set(s.id, s.next);
    } else {
      nextById.set(s.id, null);
    }
  }

  // Overlay seq `next` edges from graph (skip parallel join edges).
  for (const e of edges) {
    if (e.kind !== "next") continue;
    if (e.from === PIPELINE_GRAPH_START || e.from === "__flow_start__") {
      if (!entry) entry = e.to;
      continue;
    }
    // Join edges: id like `e_next_branch_to_then_join`
    const id = e.id || "";
    if (id.endsWith("_join") || id.includes("_join") || id.startsWith("join-")) {
      continue;
    }
    nextById.set(e.from, e.to);
  }

  if (!entry && edges.length) {
    entry = pipeline.steps[0]?.id || "";
  }

  return { entry, nextById };
}

function parseTriggersJson(raw: string | undefined): PipelineTrigger[] {
  const text = (raw || "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("triggers 须为 JSON 数组");
  return parsed.map((item, i) => {
    const r = PipelineTriggerSchema.safeParse(item);
    if (!r.success) {
      throw new Error(
        `triggers[${i}]: ${r.error.issues[0]?.message || "invalid"}`,
      );
    }
    return r.data;
  });
}

function toSteps(values: EditorValues["steps"]): PipelineStep[] {
  return values.map((s) => {
    const next = (s.next || "").trim() || null;
    const inputs_from = values
      .filter((x) => (x.next || "").trim() === s.id.trim())
      .map((x) => x.id.trim());
    return {
      id: s.id.trim(),
      agent: s.agent || "",
      label: (s.label || "").trim(),
      kind: s.kind || "agent",
      human_approval: s.human_approval,
      on_reject: s.on_reject,
      reject_goto: s.reject_goto,
      next,
      inputs_from,
      branches: (s.branches || [])
        .filter((b) => (b.to || "").trim())
        .map((b) => ({
          to: b.to.trim(),
          label: (b.label || "").trim(),
          when: b.when,
        })),
      parallel:
        s.parallel?.branches && s.parallel.branches.length >= 2
          ? {
              branches: s.parallel.branches,
              join: s.parallel.join || "all",
              then: s.parallel.then || "",
            }
          : null,
      http: (s.kind || "agent") === "http" ? s.http || null : null,
      wait_event:
        (s.kind || "agent") === "wait_event" ? s.wait_event || null : null,
      ci: (s.kind || "agent") === "ci" ? s.ci || null : null,
      delay: (s.kind || "agent") === "delay" ? s.delay || null : null,
    };
  });
}

function toPipelineGraph(steps: PipelineStep[], entry: string) {
  const entryId = (entry || "").trim() || steps[0]?.id || "";
  return {
    entry: entryId,
    edges: synthesizePipelineEdges({ steps, entry: entryId }),
  };
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
  const [flowOpen, setFlowOpen] = useState(false);
  const [triggersCollapseKeys, setTriggersCollapseKeys] = useState<string[]>([]);
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
      const teamId = getSelectedTeam()?.id;
      const [pipelines, humanList] = await Promise.all([
        pipelinesApi.list({ q, enabled, team_id: teamId }),
        digitalHumansApi.list({ enabled: "all", team_id: teamId }),
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
    setTriggersCollapseKeys([]);
    // Blank canvas: only 开始 / 结束 until user drops steps.
    const draftSteps = draft?.steps || [];
    const { entry, nextById } = hydrateFlowLinks({
      entry: draft?.entry,
      edges: draft?.edges,
      steps: draftSteps,
    });
    // New handwritten draft: do not auto-wire unless draft already has edges/next.
    const isBlank =
      !draft?.steps?.length ||
      (!draft?.edges?.length && !draft?.steps?.some((s) => s.next));
    form.setFieldsValue({
      id: draft?.id || "",
      name: draft?.name || "",
      description: draft?.description || "",
      enabled: draft?.enabled ?? true,
      tags: (draft?.tags || []).join(", "),
      entry: isBlank ? "" : entry,
      steps: draftSteps.map((s) => ({
        id: s.id,
        agent: s.agent,
        label: s.label || "",
        kind: ("kind" in s ? s.kind : undefined) || "agent",
        human_approval: s.human_approval ?? true,
        on_reject: (s.on_reject || "end") as "end" | "retry_step" | "goto",
        reject_goto: "reject_goto" in s ? s.reject_goto : undefined,
        next: isBlank ? null : (nextById.get(s.id) ?? null),
        branches: "branches" in s ? s.branches || [] : [],
        parallel: "parallel" in s ? s.parallel ?? null : null,
        http: "http" in s ? s.http ?? null : null,
        wait_event: "wait_event" in s ? s.wait_event ?? null : null,
        ci: "ci" in s ? s.ci ?? null : null,
        delay: "delay" in s ? s.delay ?? null : null,
      })),
      triggers_json: JSON.stringify(draft?.triggers || [], null, 2),
    });
    setEditorOpen(true);
  }

  function openEdit(pipeline: PipelinePublic) {
    setEditingId(pipeline.id);
    setTriggersCollapseKeys([]);
    const { entry, nextById } = hydrateFlowLinks(pipeline);
    form.setFieldsValue({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description || "",
      enabled: pipeline.enabled,
      tags: (pipeline.tags || []).join(", "),
      entry,
      steps: pipeline.steps.map((s) => ({
        id: s.id,
        agent: s.agent,
        label: s.label || "",
        kind: s.kind || "agent",
        human_approval: s.human_approval,
        on_reject: s.on_reject,
        reject_goto: s.reject_goto,
        next: nextById.get(s.id) ?? s.next ?? null,
        branches: s.branches || [],
        parallel: s.parallel ?? null,
        http: s.http ?? null,
        wait_event: s.wait_event ?? null,
        ci: s.ci ?? null,
        delay: s.delay ?? null,
      })),
      triggers_json: JSON.stringify(pipeline.triggers || [], null, 2),
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    try {
      const values = await form.validateFields();
      const steps = toSteps(values.steps);
      let triggers: PipelineTrigger[] = [];
      try {
        triggers = parseTriggersJson(values.triggers_json);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
        return;
      }
      const payload: PipelineCreate = {
        id: values.id.trim(),
        team_id: getSelectedTeam()?.id || "",
        name: values.name.trim(),
        description: (values.description || "").trim(),
        enabled: values.enabled,
        tags: (values.tags || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        source: { kind: "handwritten" },
        defaults: { human_approval: true, on_reject: "end" },
        steps,
        triggers,
        ...toPipelineGraph(steps, values.entry || ""),
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
        team_id: getSelectedTeam()?.id,
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
    <div className="page-shell">
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <Input.Search
            allowClear
            placeholder="搜索 id / 名称 / 标签"
            style={{ width: 240 }}
            onSearch={setQ}
            onChange={(e) => {
              if (!e.target.value) setQ("");
            }}
          />
          <Select
            value={enabled}
            style={{ width: 120 }}
            onChange={setEnabled}
            options={[
              { value: "all", label: "全部状态" },
              { value: "true", label: "仅启用" },
              { value: "false", label: "仅停用" },
            ]}
          />
          <span className="page-meta">{total} 条</span>
        </div>
        <div className="page-toolbar-actions">
          <Button
            icon={<ReloadOutlined />}
            onClick={async () => {
              const teamId = getSelectedTeam()?.id;
              await digitalHumansApi.seedDefaults(teamId);
              const r = await pipelinesApi.seedDefaults(teamId);
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
        </div>
      </div>

      <div className="page-split page-split--narrow">
        <aside className="pane">
          <Card size="small" title="列表" loading={loading} className="pane-card">
            {!items.length ? (
              <EmptyRich
                icon={<ApartmentOutlined />}
                title="还没有流水线"
                description="导入默认流程，或用自然语言生成步骤编排。"
                action={
                  <EmptyRichActionButton icon={<PlusOutlined />} onClick={() => openCreate()}>
                    新建流水线
                  </EmptyRichActionButton>
                }
              />
            ) : (
              <List
                dataSource={items}
                renderItem={(p) => (
                  <List.Item
                    className={`list-item-clickable${p.id === selectedId ? " list-item-active" : ""}`}
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
        </aside>

        <section className="pane">
          <Card
            size="small"
            className="pane-card"
            title={selected ? selected.name : "详情"}
            extra={
              selected ? (
                <Space>
                  <Button
                    icon={<NodeIndexOutlined />}
                    onClick={() => setFlowOpen(true)}
                  >
                    可视化
                  </Button>
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
                    可视化编排
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
              <EmptyRich
                icon={<ApartmentOutlined />}
                title="选择左侧流水线"
                description="查看步骤编排，或用自然语言生成新流程。"
              />
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
                </Space>
                {selected.source?.nl_prompt ? (
                  <Card size="small" type="inner" title="自然语言原文">
                    {selected.source.nl_prompt}
                  </Card>
                ) : null}
                <div className="pipeline-flow-preview">
                  <div className="pipeline-flow-preview__head">
                    <Typography.Text strong>流程预览</Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      icon={<NodeIndexOutlined />}
                      onClick={() => setFlowOpen(true)}
                    >
                      打开可视化
                    </Button>
                  </div>
                  <PipelineFlowView
                    steps={toFlowStepsFromPipeline(selected.steps)}
                    height={320}
                    showMiniMap={false}
                  />
                </div>
              </Space>
            )}
          </Card>
        </section>
      </div>

      <Modal
        title={editingId ? `可视化编排 · ${editingId}` : "可视化编排 · 新建流水线"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveEditor()}
        width="min(1280px, 96vw)"
        style={{ top: 8 }}
        destroyOnHidden
        okText="保存"
        className="pipeline-flow-editor-modal"
        styles={{
          body: {
            height: "calc(100vh - 108px)",
            maxHeight: "calc(100vh - 108px)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            paddingTop: 4,
            paddingBottom: 0,
          },
        }}
      >
        <Form
          form={form}
          layout="vertical"
          size="small"
          className="pipeline-flow-editor-modal__form"
        >
          <div className="pipeline-flow-editor-modal__meta">
            <Row gutter={[12, 0]}>
              <Col span={6}>
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
              <Col span={6}>
                <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="tags" label="标签">
                  <Input placeholder="逗号分隔" />
                </Form.Item>
              </Col>
              <Col span={3}>
                <Form.Item name="enabled" label="启用" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={3}>
                <Form.Item name="description" label="描述">
                  <Input placeholder="可选" />
                </Form.Item>
              </Col>
            </Row>
          </div>

          <Form.Item name="entry" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="steps"
            className="pipeline-flow-editor-modal__flow"
            rules={[
              { required: true, message: "至少添加一个步骤" },
              {
                validator: async (_, steps: EditorValues["steps"]) => {
                  if (!steps?.length) throw new Error("至少添加一个步骤");
                  const ids = steps.map((s) => s.id?.trim()).filter(Boolean);
                  if (ids.length !== steps.length) {
                    throw new Error("步骤 ID 不能为空");
                  }
                  if (new Set(ids).size !== ids.length) {
                    throw new Error("步骤 ID 不能重复");
                  }
                  const entry = String(form.getFieldValue("entry") || "").trim();
                  if (!entry) {
                    throw new Error("请从「开始」连线到入口步骤");
                  }
                  if (!ids.includes(entry)) {
                    throw new Error("入口步骤不存在，请重新连接「开始」");
                  }
                  for (const s of steps) {
                    const kind = s.kind || "agent";
                    if (kind === "agent" && !s.agent) {
                      throw new Error(`步骤 ${s.id} 未选择数字人`);
                    }
                    if (kind === "http" && !(s.http?.url || "").trim()) {
                      throw new Error(`步骤 ${s.id} 缺少 HTTP URL`);
                    }
                    if (kind === "wait_event" && !s.wait_event?.event) {
                      throw new Error(`步骤 ${s.id} 缺少等待事件`);
                    }
                    if (kind === "ci" && !(s.ci?.trigger_url || "").trim()) {
                      throw new Error(`步骤 ${s.id} 缺少 CI trigger_url`);
                    }
                    if (
                      kind === "delay" &&
                      !(s.delay?.seconds && s.delay.seconds > 0)
                    ) {
                      throw new Error(`步骤 ${s.id} 延时秒数须 > 0`);
                    }
                    if (s.on_reject === "goto" && !s.reject_goto) {
                      throw new Error(`步骤 ${s.id} 的驳回跳转目标未设置`);
                    }
                    const next = (s.next || "").trim();
                    if (
                      next &&
                      next !== PIPELINE_GRAPH_END &&
                      !ids.includes(next)
                    ) {
                      throw new Error(`步骤 ${s.id} 的下一步「${next}」不存在`);
                    }
                    for (const [i, b] of (s.branches || []).entries()) {
                      if (!b.to?.trim()) {
                        throw new Error(
                          `步骤 ${s.id} 条件分支 #${i + 1} 未选择目标`,
                        );
                      }
                      if (
                        b.when &&
                        b.when.op !== "default" &&
                        b.when.op !== "and" &&
                        b.when.op !== "or" &&
                        !("value" in b.when && String(b.when.value || "").trim())
                      ) {
                        throw new Error(
                          `步骤 ${s.id} 条件分支 #${i + 1} 缺少匹配值`,
                        );
                      }
                    }
                  }
                },
              },
            ]}
          >
            <PipelineFlowEditor
              agentOptions={agentOptions}
              height="100%"
              onAddCronTrigger={() => {
                const raw = form.getFieldValue("triggers_json") as string;
                let list: unknown[] = [];
                try {
                  const parsed = JSON.parse(raw || "[]");
                  list = Array.isArray(parsed) ? parsed : [];
                } catch {
                  list = [];
                }
                const id = `cron_${Date.now().toString(36)}`;
                list.push({
                  id,
                  kind: "cron",
                  enabled: true,
                  cron: "0 9 * * 1-5",
                });
                form.setFieldsValue({
                  triggers_json: JSON.stringify(list, null, 2),
                });
                setTriggersCollapseKeys(["triggers"]);
                message.success("已添加工作日 09:00 cron，可在下方编辑");
              }}
            />
          </Form.Item>

          <Collapse
            ghost
            size="small"
            className="pipeline-flow-editor-modal__triggers"
            activeKey={triggersCollapseKeys}
            onChange={(keys) =>
              setTriggersCollapseKeys(
                Array.isArray(keys) ? keys.map(String) : [String(keys)],
              )
            }
            items={[
              {
                key: "triggers",
                label: "自动触发（JSON）",
                children: (
                  <Form.Item
                    name="triggers_json"
                    style={{ marginBottom: 0 }}
                    extra={
                      editingId
                        ? `Webhook: POST /api/webhooks/pipelines/${editingId}/forge`
                        : "Forge webhook / cron，见 docs/对接外部Git.md §5"
                    }
                  >
                    <Input.TextArea
                      rows={5}
                      placeholder='[{"id":"weekday","kind":"cron","enabled":true,"cron":"0 9 * * 1-5"}]'
                      style={{
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}
                    />
                  </Form.Item>
                ),
              },
            ]}
          />
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

      <PipelineFlowModal
        open={flowOpen}
        onClose={() => setFlowOpen(false)}
        title={selected ? `流程可视化 · ${selected.name}` : "流程可视化"}
        steps={selected ? toFlowStepsFromPipeline(selected.steps) : []}
      />
    </div>
  );
}
