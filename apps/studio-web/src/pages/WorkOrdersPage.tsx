import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Collapse,
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
  PlayCircleOutlined,
  PlusOutlined,
  RedoOutlined,
  SyncOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { PipelinePublic, Project, WorkOrder, WorkOrderCreate } from "@agent-studio/agent-schema";
import { pipelinesApi } from "../api/pipelines";
import { projectsApi } from "../api/projects";
import { workOrdersApi } from "../api/work-orders";
import { getSelectedTeam } from "../auth/session";
import { ManagerChatPanel } from "../components/ManagerChatPanel";
import { WorkOrderRunPanel } from "../components/WorkOrderRunPanel";
import { STATUS_LABEL, CATEGORY_LABEL, CATEGORY_OPTIONS } from "../work-orders/workOrderLabels";
import { subscribeWorkOrder } from "../ws/work-orders";

function genId() {
  return `wo-${Date.now().toString(36)}`;
}

export function WorkOrdersPage() {
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [pipelines, setPipelines] = useState<PipelinePublic[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const teamId = getSelectedTeam()?.id;
      const [orders, pipes, projectList] = await Promise.all([
        workOrdersApi.list({ q, status, team_id: teamId }),
        pipelinesApi.list({ enabled: "true", team_id: teamId }),
        projectsApi.list({ enabled: "true", team_id: teamId }),
      ]);
      setItems(orders.items);
      setTotal(orders.total);
      setPipelines(pipes.items);
      setProjects(projectList.items);
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

  /** Auto-pull Dify pause / form_token while waiting for Human Input. */
  useEffect(() => {
    if (!selected) return;
    const dify = selected.run?.dify;
    const waiting =
      (selected.status === "pending_approval" || dify?.status === "paused") &&
      !dify?.form_token;
    if (!waiting) return;

    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;

    const schedule = (delayMs: number) => {
      timer = window.setTimeout(() => void tick(), delayMs);
    };

    const tick = async () => {
      attempt += 1;
      try {
        const updated = await workOrdersApi.syncDify(selected.id);
        if (cancelled) return;
        setItems((prev) => {
          const idx = prev.findIndex((w) => w.id === updated.id);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = updated;
          return next;
        });
        if (updated.run?.dify?.form_token) return;
      } catch {
        /* silent — manual sync button still available */
      }
      if (cancelled) return;
      // Back off so we don't hammer Dify alongside the 5s gateway poll.
      const delay = Math.min(15_000, 4_000 + attempt * 2_000);
      schedule(delay);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    selected?.id,
    selected?.status,
    selected?.run?.dify?.status,
    selected?.run?.dify?.form_token,
  ]);

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
        executor: "dify",
        auto_approve: autoApprove,
      });
      setStartOpen(false);
      message.success(
        autoApprove
          ? "已提交 Dify 执行（自动确认已开）"
          : "已提交 Dify 执行",
      );
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStartBusy(false);
    }
  }

  async function syncDify() {
    if (!selected) return;
    try {
      const updated = await workOrdersApi.syncDify(selected.id);
      if (
        updated.status === "running" &&
        updated.run?.dify?.status === "failed" &&
        updated.run.dify.error
      ) {
        message.warning("工作流已失败，请修好 Bridge 后点「重新执行」");
      } else if (updated.status === "running" && updated.run?.dify?.error) {
        message.warning("同步遇到异常，工单仍在运行中，可稍后重试或「重新执行」");
      } else {
        message.success("已同步 Dify 状态");
      }
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelRun() {
    if (!selected) return;
    Modal.confirm({
      title: "结束当前流水线？",
      content: "结束后可重新「开始流水线」。会同时请求停掉当前 Dify 工作流。",
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
    setRestartOpen(true);
  }

  async function confirmRestart() {
    if (!selected?.run || restartBusy) return;
    setRestartBusy(true);
    try {
      const updated = await workOrdersApi.restart(selected.id, {
        auto_approve: autoApprove,
      });
      setRestartOpen(false);
      message.success(
        autoApprove
          ? "已重新提交 Dify 执行（自动确认已开）"
          : "已重新提交 Dify 执行",
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
      message.success(`已提交 Dify 确认（${action || decision}）`);
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row justify="space-between" align="middle" gutter={[16, 16]}>
        <Col>
          <Typography.Title level={3} style={{ margin: 0 }}>
            工单
          </Typography.Title>
          <Typography.Text type="secondary">
            工单即需求；在这里选择流水线并开始执行（共 {total} 条）
          </Typography.Text>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建工单
          </Button>
        </Col>
      </Row>

      <Space wrap>
        <Input.Search
          allowClear
          placeholder="搜索标题 / 需求 / 标签"
          style={{ width: 280 }}
          onSearch={setQ}
          onChange={(e) => {
            if (!e.target.value) setQ("");
          }}
        />
        <Select
          value={status}
          style={{ width: 160 }}
          onChange={setStatus}
          options={[
            { value: "all", label: "全部状态" },
            ...Object.entries(STATUS_LABEL).map(([value, meta]) => ({
              value,
              label: meta.text,
            })),
          ]}
        />
      </Space>

      <div className={`wo-layout${selected?.run ? " wo-layout--running" : ""}`}>
        <aside className="wo-layout-list">
          <Card size="small" title="列表" loading={loading} className="wo-layout-card">
            {!items.length ? (
              <Empty description="暂无工单" />
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
            className="wo-layout-card"
            title={selected ? selected.title : "详情"}
            extra={
              selected ? (
                <Space wrap>
                  {selected.status === "draft" ||
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
                        setStartOpen(true);
                      }}
                    >
                      开始流水线
                    </Button>
                  ) : null}
                  {selected.run?.dify?.workflow_run_id ? (
                    <Button icon={<SyncOutlined />} onClick={() => void syncDify()}>
                      同步 Dify
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
                  selected.status === "pending_approval" ? (
                    <Button
                      danger
                      icon={<StopOutlined />}
                      onClick={() => void cancelRun()}
                    >
                      结束运行
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
              <Empty description="选择左侧工单，或新建一个需求" />
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
                  {selected.run?.dify?.binding_source ? (
                    <Tag color="blue">
                      Dify{" "}
                      {selected.run.dify.binding_source === "pipeline"
                        ? "流水线绑定"
                        : "全局默认"}
                    </Tag>
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
                  />
                ) : (
                  <Empty description="尚未启动流水线" />
                )}
              </Space>
            )}
          </Card>
        </section>

        <aside className="wo-layout-chat">
          {selected ? (
            <ManagerChatPanel
              workOrderId={selected.id}
              onWorkOrderChange={(order) => {
                setItems((prev) => prev.map((w) => (w.id === order.id ? order : w)));
              }}
            />
          ) : (
            <Card size="small" title="总管对话" className="wo-layout-card">
              <Empty description="选择工单后与总管对话" />
            </Card>
          )}
        </aside>
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
          将通过 Dify Workflow 执行（需在设置中配置 App Key）。
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
          {selected?.run?.pipeline_id || "-"}（Dify）。默认复用上次总管选仓（不再重新选仓）。
        </Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item
            label="自动确认"
            extra="流水线人工确认节点保留；开启后由 Studio 代为点「通过」，无需手动确认"
          >
            <Switch checked={autoApprove} onChange={setAutoApprove} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
