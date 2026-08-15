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
  FileTextOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RedoOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import type {
  BridgeExecutor,
  PipelinePublic,
  Project,
  WorkOrder,
  WorkOrderCreate,
} from "@agent-studio/agent-schema";
import { bridgesApi } from "../api/bridges";
import { pipelinesApi } from "../api/pipelines";
import { projectsApi } from "../api/projects";
import { workOrdersApi } from "../api/work-orders";
import { getSelectedTeam } from "../auth/session";
import { EmptyRich, EmptyRichActionButton } from "../components/EmptyRich";
import { WorkOrderRunPanel } from "../components/WorkOrderRunPanel";
import { STATUS_LABEL, CATEGORY_LABEL, CATEGORY_OPTIONS } from "../work-orders/workOrderLabels";
import { subscribeWorkOrder } from "../ws/work-orders";

function genId() {
  return `wo-${Date.now().toString(36)}`;
}

export function WorkOrdersPage() {
  const [searchParams] = useSearchParams();
  const deepLinkId = (searchParams.get("id") || "").trim();
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [pipelines, setPipelines] = useState<PipelinePublic[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bridges, setBridges] = useState<BridgeExecutor[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId || null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [pipelineId, setPipelineId] = useState<string>();
  const [startBridgeId, setStartBridgeId] = useState<string | undefined>();
  const [restartBridgeId, setRestartBridgeId] = useState<string | undefined>();
  const [autoApprove, setAutoApprove] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [liveStatus, setLiveStatus] = useState<
    "connecting" | "connected" | "disconnected" | "idle"
  >("idle");
  const [form] = Form.useForm<WorkOrderCreate>();

  const selected = useMemo(
    () => items.find((w) => w.id === selectedId) || null,
    [items, selectedId],
  );

  const bridgeOptions = useMemo(
    () =>
      bridges.map((b) => ({
        value: b.id,
        label: `${b.name || b.id} · ${b.driver || "?"} · ${b.status}`,
      })),
    [bridges],
  );

  const preferredBridgeLabel = useMemo(() => {
    const id = (selected?.preferred_bridge_id || "").trim();
    if (!id) return "";
    const hit = bridges.find((b) => b.id === id);
    return hit ? `${hit.name || hit.id}` : id;
  }, [bridges, selected?.preferred_bridge_id]);

  const runBridgeLabel = useMemo(() => {
    const studio = selected?.run?.studio;
    if (!studio) return "";
    const name = (studio.bridge_name || "").trim();
    const id = (studio.bridge_id || "").trim();
    const driver = (studio.bridge_driver || "").trim();
    const base = name || id;
    if (!base) return "";
    return driver ? `${base} · ${driver}` : base;
  }, [selected?.run?.studio]);

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const teamId = getSelectedTeam()?.id;
      const [orders, pipes, projectList, bridgeList] = await Promise.all([
        workOrdersApi.list({ q, status, team_id: teamId }),
        pipelinesApi.list({ enabled: "true", team_id: teamId }),
        projectsApi.list({ enabled: "true", team_id: teamId }),
        bridgesApi.list({ team_id: teamId }),
      ]);
      setItems(orders.items);
      setTotal(orders.total);
      setPipelines(pipes.items);
      setProjects(projectList.items);
      setBridges(bridgeList.items || []);
      const nextId = keepId === undefined ? selectedId : keepId;
      if (nextId && !orders.items.some((w) => w.id === nextId)) {
        setSelectedId(null);
      } else if (nextId) {
        setSelectedId(nextId);
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
  }, [q, status]);

  useEffect(() => {
    if (deepLinkId) setSelectedId(deepLinkId);
  }, [deepLinkId]);

  useEffect(() => {
    if (!selectedId) {
      setLiveStatus("idle");
      return;
    }
    setLiveStatus("connecting");
    return subscribeWorkOrder(selectedId, {
      onStatus: setLiveStatus,
      onWorkOrder: (order) => {
        setItems((prev) => {
          const idx = prev.findIndex((w) => w.id === order.id);
          if (idx < 0) return [order, ...prev];
          const next = [...prev];
          next[idx] = order;
          return next;
        });
      },
    });
  }, [selectedId]);

  function openCreate() {
    setEditingId(null);
    form.setFieldsValue({
      id: genId(),
      title: "",
      requirement: "",
      category: "requirement",
      priority: "medium",
      tags: [],
      pipeline_id: pipelines[0]?.id,
      project_id: projects[0]?.id || "",
      preferred_bridge_id: "",
      team_id: getSelectedTeam()?.id || "",
    });
    setEditorOpen(true);
  }

  function openEdit(order: WorkOrder) {
    setEditingId(order.id);
    form.setFieldsValue({
      id: order.id,
      title: order.title,
      requirement: order.requirement,
      category: order.category || "requirement",
      priority: order.priority,
      tags: order.tags,
      pipeline_id: order.pipeline_id,
      project_id: order.project_id || "",
      preferred_bridge_id: order.preferred_bridge_id || "",
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    try {
      const values = await form.validateFields();
      const tags = Array.isArray(values.tags)
        ? values.tags
        : String(values.tags || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      const payload: WorkOrderCreate = {
        ...values,
        tags,
        preferred_bridge_id: values.preferred_bridge_id || "",
        team_id: values.team_id || getSelectedTeam()?.id || "",
      };
      if (editingId) {
        await workOrdersApi.update(editingId, payload);
        setSelectedId(editingId);
        message.success("工单已更新");
      } else {
        const created = await workOrdersApi.create(payload);
        setSelectedId(created.id);
        message.success("工单已创建");
      }
      setEditorOpen(false);
      await reload(editingId || payload.id);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function startPipeline() {
    if (!selected || !pipelineId || startBusy) return;
    setStartBusy(true);
    try {
      const updated = await workOrdersApi.start(selected.id, {
        pipeline_id: pipelineId,
        executor: "studio",
        auto_approve: autoApprove,
        preferred_bridge_id: startBridgeId || "",
      });
      setStartOpen(false);
      const queued = updated.status === "queued";
      message.success(
        queued
          ? "执行器正忙，已加入排队"
          : autoApprove
            ? "已提交，准备与编排在后台进行（自动确认已开）"
            : "已提交，准备与编排在后台进行",
      );
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStartBusy(false);
    }
  }

  async function cancelRun() {
    if (!selected) return;
    Modal.confirm({
      title: "结束当前流水线？",
      content: "结束后可重新「开始流水线」。会同时请求停掉当前 Studio 编排。",
      okText: "结束运行",
      okType: "danger",
      onOk: async () => {
        const updated = await workOrdersApi.cancel(selected.id);
        message.success("已结束当前运行");
        await reload(updated.id);
      },
    });
  }

  async function restartRun() {
    if (!selected?.run) return;
    setAutoApprove(Boolean(selected.run.auto_approve));
    setRestartBridgeId(selected.preferred_bridge_id || undefined);
    setRestartOpen(true);
  }

  async function resumeRun() {
    if (!selected?.run || selected.status !== "failed") return;
    if (!selected.run.studio?.bridge_run_id) {
      message.warning("缺少 Bridge run，无法续跑；请改用「重新执行」");
      return;
    }
    try {
      const updated = await workOrdersApi.resume(selected.id, {
        feedback: feedback.trim() || undefined,
      });
      message.success("已从失败阶段续跑（后台执行）");
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmRestart() {
    if (!selected?.run || restartBusy) return;
    setRestartBusy(true);
    try {
      const updated = await workOrdersApi.restart(selected.id, {
        auto_approve: autoApprove,
        preferred_bridge_id: restartBridgeId || "",
      });
      setRestartOpen(false);
      const queued = updated.status === "queued";
      message.success(
        queued
          ? "执行器正忙，已加入排队"
          : autoApprove
            ? "已重新提交，准备与编排在后台进行（自动确认已开）"
            : "已重新提交，准备与编排在后台进行",
      );
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRestartBusy(false);
    }
  }

  async function decide(
    decision: "approve" | "reject",
    action?: string,
    feedbackOverride?: string,
  ) {
    if (!selected) return;
    try {
      const note = (feedbackOverride ?? feedback).trim();
      if (decision === "approve" && note.startsWith("澄清确认")) {
        try {
          await workOrdersApi.clarify(selected.id, note);
        } catch {
          /* non-blocking: still submit decision */
        }
      }
      const updated = await workOrdersApi.decide(
        selected.id,
        decision,
        note,
        action ? { action } : undefined,
      );
      setFeedback("");
      message.success(`已提交确认（${action || decision}）`);
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <Input.Search
            allowClear
            placeholder="搜索标题 / 需求 / 标签"
            style={{ width: 260 }}
            onSearch={setQ}
            onChange={(e) => {
              if (!e.target.value) setQ("");
            }}
          />
          <Select
            value={status}
            style={{ width: 140 }}
            onChange={setStatus}
            options={[
              { value: "all", label: "全部状态" },
              ...Object.entries(STATUS_LABEL).map(([value, meta]) => ({
                value,
                label: meta.text,
              })),
            ]}
          />
          <span className="page-meta">{total} 条</span>
        </div>
        <div className="page-toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建工单
          </Button>
        </div>
      </div>

      <div className={`wo-layout${selected?.run ? " wo-layout--running" : ""}`}>
        <aside className="wo-layout-list">
          <Card
            size="small"
            title="列表"
            loading={loading}
            className="wo-layout-card pane-card"
          >
            {!items.length ? (
              <EmptyRich
                icon={<FileTextOutlined />}
                title="还没有工单"
                description="把需求写成工单，再选流水线启动执行。"
                action={
                  <EmptyRichActionButton icon={<PlusOutlined />} onClick={openCreate}>
                    新建工单
                  </EmptyRichActionButton>
                }
              />
            ) : (
              <List
                className="wo-order-list"
                dataSource={items}
                renderItem={(w) => (
                  <List.Item
                    className={
                      w.id === selectedId ? "wo-order-list-item is-active" : "wo-order-list-item"
                    }
                    onClick={() => setSelectedId(w.id)}
                  >
                    <List.Item.Meta
                      title={
                        <Space size={6} wrap>
                          <span>{w.title}</span>
                          <Tag
                            color={
                              CATEGORY_LABEL[w.category || "requirement"]?.color
                            }
                            style={{ marginInlineEnd: 0 }}
                          >
                            {CATEGORY_LABEL[w.category || "requirement"]?.text ||
                              w.category ||
                              "需求"}
                          </Tag>
                        </Space>
                      }
                      description={`${w.id}${w.project_id ? ` · ${w.project_id}` : ""}`}
                    />
                    <Tag color={STATUS_LABEL[w.status]?.color}>
                      {STATUS_LABEL[w.status]?.text || w.status}
                    </Tag>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </aside>

        <section className="wo-layout-main">
          <Card
            size="small"
            className="wo-layout-card pane-card"
            title={selected ? selected.title : "详情"}
            extra={
              selected ? (
                <Space wrap>
                  {selected.status === "draft" ||
                  selected.status === "queued" ||
                  selected.status === "completed" ||
                  selected.status === "rejected" ||
                  selected.status === "failed" ||
                  selected.status === "cancelled" ? (
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => {
                        setPipelineId(selected.pipeline_id || pipelines[0]?.id);
                        setAutoApprove(Boolean(selected.run?.auto_approve));
                        setStartBridgeId(
                          selected.preferred_bridge_id || undefined,
                        );
                        setStartOpen(true);
                      }}
                    >
                      {selected.status === "queued" ? "调整排队 / 启动" : "开始流水线"}
                    </Button>
                  ) : null}
                  {selected.status === "failed" &&
                  selected.run?.studio?.bridge_run_id ? (
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => void resumeRun()}
                    >
                      从失败阶段续跑
                    </Button>
                  ) : null}
                  {selected.run ? (
                    <Button
                      icon={<RedoOutlined />}
                      onClick={() => void restartRun()}
                    >
                      重新执行
                    </Button>
                  ) : null}
                  {selected.status === "running" ||
                  selected.status === "pending_approval" ||
                  selected.status === "queued" ? (
                    <Button
                      danger
                      icon={<StopOutlined />}
                      onClick={() => void cancelRun()}
                    >
                      {selected.status === "queued" ? "取消排队" : "结束运行"}
                    </Button>
                  ) : null}
                  {selected.status === "draft" ||
                  selected.status === "completed" ||
                  selected.status === "rejected" ? (
                    <Button icon={<EditOutlined />} onClick={() => openEdit(selected)}>
                      编辑
                    </Button>
                  ) : null}
                  {selected.status !== "running" &&
                  selected.status !== "pending_approval" ? (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        Modal.confirm({
                          title: `确认删除「${selected.title}」？`,
                          okType: "danger",
                          onOk: async () => {
                            await workOrdersApi.remove(selected.id);
                            setSelectedId(null);
                            await reload(null);
                            message.success("已删除");
                          },
                        });
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                </Space>
              ) : null
            }
          >
            {!selected ? (
              <EmptyRich
                icon={<FileTextOutlined />}
                title="选择左侧工单"
                description="查看需求、启动流水线，或打开运行中的 Agent 聊天与产出。"
                action={
                  <EmptyRichActionButton icon={<PlusOutlined />} onClick={openCreate}>
                    新建工单
                  </EmptyRichActionButton>
                }
              />
            ) : (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Space wrap size={[8, 8]}>
                  <Tag color={STATUS_LABEL[selected.status]?.color}>
                    {STATUS_LABEL[selected.status]?.text}
                  </Tag>
                  <Tag
                    color={
                      CATEGORY_LABEL[selected.category || "requirement"]?.color
                    }
                  >
                    {CATEGORY_LABEL[selected.category || "requirement"]?.text ||
                      selected.category ||
                      "需求"}
                  </Tag>
                  <Tag>{selected.priority}</Tag>
                  {selected.project_id ? (
                    <Tag color="cyan">项目 {selected.project_id}</Tag>
                  ) : null}
                  {runBridgeLabel ? (
                    <Tag color="purple">本次执行器 {runBridgeLabel}</Tag>
                  ) : preferredBridgeLabel ? (
                    <Tag color="purple">指定执行器 {preferredBridgeLabel}</Tag>
                  ) : (
                    <Tag>执行器 自动分配</Tag>
                  )}
                  {selected.run?.selected_repo_ids?.length ? (
                    <Tag color="geekblue">
                      选仓 {selected.run.selected_repo_ids.join(",")}
                    </Tag>
                  ) : null}
                  {(selected.tags || []).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  {selected.run ? (
                    <Tag
                      color={
                        liveStatus === "connected"
                          ? "success"
                          : liveStatus === "connecting"
                            ? "processing"
                            : "default"
                      }
                    >
                      WS{" "}
                      {liveStatus === "connected"
                        ? "已连接·自动同步"
                        : liveStatus === "connecting"
                          ? "连接中"
                          : liveStatus === "disconnected"
                            ? "断开"
                            : "未订阅"}
                    </Tag>
                  ) : null}
                  {selected.run ? (
                    <Tag color={selected.run.auto_approve ? "success" : "default"}>
                      自动确认：{selected.run.auto_approve ? "开" : "关"}
                    </Tag>
                  ) : null}
                  {selected.run ? (
                    <Tag color="blue">Studio 编排</Tag>
                  ) : null}
                </Space>

                <Collapse
                  ghost
                  defaultActiveKey={selected.run ? [] : ["req"]}
                  items={[
                    {
                      key: "req",
                      label: "需求",
                      children: (
                        <Typography.Paragraph
                          style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
                        >
                          {selected.requirement}
                        </Typography.Paragraph>
                      ),
                    },
                  ]}
                />

                {selected.run ? (
                  <WorkOrderRunPanel
                    order={selected}
                    feedback={feedback}
                    onFeedbackChange={setFeedback}
                    onDecide={(decision, action, feedbackOverride) =>
                      void decide(decision, action, feedbackOverride)
                    }
                    onRestart={() => void restartRun()}
                    onResume={() => void resumeRun()}
                    onOrderUpdate={(updated) => {
                      setItems((prev) =>
                        prev.map((w) => (w.id === updated.id ? updated : w)),
                      );
                    }}
                  />
                ) : (
                  <EmptyRich
                    icon={<PlayCircleOutlined />}
                    title="尚未启动流水线"
                    description="选好流水线后点「开始」，运行状态与 Agent 产出会出现在这里。"
                  />
                )}
              </Space>
            )}
          </Card>
        </section>
      </div>

      <Modal
        title={editingId ? `编辑 ${editingId}` : "新建工单"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveEditor()}
        width={720}
        destroyOnHidden
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="id"
            label="ID"
            rules={[
              { required: true },
              { pattern: /^[a-z0-9][a-z0-9_-]*$/, message: "小写字母/数字开头" },
            ]}
          >
            <Input disabled={Boolean(editingId)} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input placeholder="例如：增加用户登录接口" />
          </Form.Item>
          <Form.Item name="requirement" label="需求描述" rules={[{ required: true }]}>
            <Input.TextArea rows={6} placeholder="把原始需求写在这里…" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="category"
                label="类别"
                initialValue="requirement"
                rules={[{ required: true, message: "请选择类别" }]}
              >
                <Select options={[...CATEGORY_OPTIONS]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" initialValue="medium">
                <Select
                  options={[
                    { value: "low", label: "low" },
                    { value: "medium", label: "medium" },
                    { value: "high", label: "high" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="pipeline_id" label="默认流水线">
                <Select
                  allowClear
                  options={pipelines.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${p.id})`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="preferred_bridge_id"
            label="执行器"
            tooltip="指定后由该 Bridge 执行；忙则排队等待其空闲。留空则自动选择空闲执行器"
          >
            <Select
              allowClear
              placeholder="自动选择空闲执行器"
              options={bridgeOptions}
            />
          </Form.Item>
          <Form.Item
            name="project_id"
            label="绑定项目"
            tooltip="启动时会按需克隆仓库，并由总管 Agent 决定改哪个仓"
          >
            <Select
              allowClear
              placeholder="选择项目（可多仓）"
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.name} (${p.id}) · ${p.repos.length} 仓`,
              }))}
            />
          </Form.Item>
          <Form.Item name="tags" label="标签" tooltip="可输入多个后回车，或后续用逗号">
            <Select mode="tags" placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="开始流水线"
        open={startOpen}
        onCancel={() => {
          if (startBusy) return;
          setStartOpen(false);
        }}
        onOk={() => void startPipeline()}
        okText="启动"
        confirmLoading={startBusy}
        maskClosable={!startBusy}
        closable={!startBusy}
        okButtonProps={{ disabled: !pipelineId || startBusy }}
        cancelButtonProps={{ disabled: startBusy }}
      >
        <Typography.Paragraph type="secondary">
          将通过 Studio 编排执行（经 Bridge）。绑定了项目时会在后台准备仓库并由总管选仓，启动后可在运行页查看实时进度。
          若工单绑定了项目，启动前会先确保仓库已克隆，再由总管决定改哪个仓。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="流水线" required>
            <Select
              style={{ width: "100%" }}
              placeholder="选择流水线"
              value={pipelineId}
              onChange={setPipelineId}
              options={pipelines.map((p) => ({
                value: p.id,
                label: `${p.name} · ${p.steps.length} 步`,
              }))}
            />
          </Form.Item>
          <Form.Item
            label="执行器"
            extra="指定后固定用该执行器；忙则排队。留空自动分配空闲执行器"
          >
            <Select
              allowClear
              style={{ width: "100%" }}
              placeholder="自动选择空闲执行器"
              value={startBridgeId}
              onChange={(v) => setStartBridgeId(v || undefined)}
              options={bridgeOptions}
            />
          </Form.Item>
          <Form.Item
            label="自动确认"
            extra="流水线人工确认节点保留；开启后由 Studio 代为点「通过」，无需手动确认"
          >
            <Switch checked={autoApprove} onChange={setAutoApprove} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重新执行本工单"
        open={restartOpen}
        onCancel={() => {
          if (restartBusy) return;
          setRestartOpen(false);
        }}
        onOk={() => void confirmRestart()}
        okText="重新执行"
        confirmLoading={restartBusy}
        maskClosable={!restartBusy}
        closable={!restartBusy}
        okButtonProps={{ disabled: restartBusy }}
        cancelButtonProps={{ disabled: restartBusy }}
      >
        <Typography.Paragraph type="secondary">
          将结束当前运行（如有），并用上次配置再启：流水线{" "}
          {selected?.run?.pipeline_id || "-"}（Studio 编排）。默认复用上次总管选仓（不再重新选仓）。确认后立即返回，阶段在后台执行。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item
            label="执行器"
            extra="可改选执行器；忙则排队等待该执行器空闲"
          >
            <Select
              allowClear
              style={{ width: "100%" }}
              placeholder="自动选择空闲执行器"
              value={restartBridgeId}
              onChange={(v) => setRestartBridgeId(v || undefined)}
              options={bridgeOptions}
            />
          </Form.Item>
          <Form.Item
            label="自动确认"
            extra="流水线人工确认节点保留；开启后由 Studio 代为点「通过」，无需手动确认"
          >
            <Switch checked={autoApprove} onChange={setAutoApprove} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
