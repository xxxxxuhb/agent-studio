import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Select,
  Space,
  Steps,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { LinkOutlined, ProfileOutlined, ReloadOutlined } from "@ant-design/icons";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { RunLogEntry, RunLogMeta, RunLogSource } from "@agent-studio/agent-schema";
import { runLogsApi, type RunLogTraceStep } from "../api/run-logs";
import { AgentOutputView } from "../components/AgentOutputView";
import { RunArtifactsPanel } from "../components/RunArtifactsPanel";
import { getSelectedTeam } from "../auth/session";
import { EmptyRich } from "../components/EmptyRich";

const SOURCE_COLOR: Record<RunLogSource, string> = {
  system: "default",
  pipeline: "blue",
  agent: "purple",
  bridge: "green",
  manager: "geekblue",
  human: "orange",
};

const SOURCE_LABEL: Record<RunLogSource, string> = {
  system: "系统",
  pipeline: "流水线",
  agent: "Agent",
  bridge: "Bridge",
  manager: "总管",
  human: "人工",
};

function levelColor(level: string) {
  if (level === "error") return "red";
  if (level === "warn") return "orange";
  return "default";
}

function truncateOneLine(text: string, max = 120) {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max)}…`;
}

function traceStepStatus(
  step: RunLogTraceStep,
  isLast: boolean,
): "wait" | "process" | "finish" | "error" {
  if (step.level === "error" || step.kind === "error") return "error";
  if (step.level === "warn" || step.kind === "warn") return "error";
  if (isLast && step.kind !== "run_finished") return "process";
  return "finish";
}

export function RunLogsPage() {
  const navigate = useNavigate();
  const { runId: routeRunId } = useParams<{ runId?: string }>();
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get("q") || "";

  const [items, setItems] = useState<RunLogMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(initialQ);
  const [selectedId, setSelectedId] = useState<string | null>(routeRunId || null);
  const [meta, setMeta] = useState<RunLogMeta | null>(null);
  const [entries, setEntries] = useState<RunLogEntry[]>([]);
  const [trace, setTrace] = useState<RunLogTraceStep[]>([]);
  const [source, setSource] = useState<string>("all");
  const [level, setLevel] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const selected = useMemo(
    () => items.find((i) => i.run_id === selectedId) || meta,
    [items, selectedId, meta],
  );

  const orderedEntries = useMemo(() => [...entries].reverse(), [entries]);

  async function reloadList(keepId?: string | null) {
    setLoading(true);
    try {
      const res = await runLogsApi.list({
        q,
        team_id: getSelectedTeam()?.id,
      });
      setItems(res.items);
      setTotal(res.total);
      const nextId = keepId === undefined ? selectedId : keepId;
      if (nextId && !res.items.some((i) => i.run_id === nextId)) {
        // keep selection even if filtered out of list
      } else if (nextId) {
        setSelectedId(nextId);
      } else if (res.items[0] && !selectedId) {
        setSelectedId(res.items[0].run_id);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function reloadDetail(runId: string) {
    setDetailLoading(true);
    try {
      const res = await runLogsApi.get(runId, { source, level });
      setMeta(res.meta);
      setEntries(res.entries);
      setTrace(res.trace || []);
      const reversed = [...res.entries].reverse();
      const withBody = reversed.find((e) => e.body?.trim());
      setOpenKeys([(withBody || reversed[0])?.id].filter(Boolean) as string[]);
    } catch (err) {
      setMeta(null);
      setEntries([]);
      setTrace([]);
      setOpenKeys([]);
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void reloadList(routeRunId || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (routeRunId) setSelectedId(routeRunId);
  }, [routeRunId]);

  useEffect(() => {
    if (!selectedId) {
      setMeta(null);
      setEntries([]);
      setTrace([]);
      setOpenKeys([]);
      return;
    }
    void reloadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, source, level]);

  function selectRun(id: string) {
    setSelectedId(id);
    navigate(`/logs/${id}`, { replace: true });
  }

  async function jumpLookup() {
    const needle = q.trim() || initialQ.trim();
    if (!needle) {
      message.info("先输入 Studio / Bridge / 工单 ID");
      return;
    }
    try {
      const hit = await runLogsApi.lookup({
        q: needle,
        team_id: getSelectedTeam()?.id,
      });
      selectRun(hit.meta.run_id);
      message.success(
        hit.match === "exact" ? "已定位到精确匹配运行" : "已定位到近似匹配运行",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <Input.Search
            placeholder="搜索 Studio/Bridge run、失败原因、工单…"
            allowClear
            defaultValue={initialQ}
            style={{ width: 320 }}
            onSearch={setQ}
          />
          <span className="page-meta">共 {total} 次</span>
        </div>
        <div className="page-toolbar-actions">
          <Button type="primary" onClick={() => void jumpLookup()}>
            定位运行
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void reloadList()}>
            刷新
          </Button>
        </div>
      </div>

      <div className="page-split page-split--wide-list">
        <aside className="pane">
          <Card size="small" title="按运行 ID" loading={loading} className="pane-card">
            {items.length ? (
              <List
                dataSource={items}
                renderItem={(item) => (
                  <List.Item
                    className={`list-item-clickable${item.run_id === selectedId ? " list-item-active" : ""}`}
                    onClick={() => selectRun(item.run_id)}
                  >
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <Typography.Text code>{item.run_id}</Typography.Text>
                          {item.work_order_status ? (
                            <Tag>{item.work_order_status}</Tag>
                          ) : null}
                          {item.last_error ? (
                            <Tag color="red">有错误</Tag>
                          ) : null}
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size={0}>
                          <span>
                            {item.title || item.work_order_id} ·{" "}
                            {item.pipeline_name || item.pipeline_id || "-"} ·{" "}
                            {item.entry_count} 条
                          </span>
                          {item.bridge_run_id ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {`Bridge ${item.bridge_run_id}`}
                              {item.bridge_stage ? ` / ${item.bridge_stage}` : ""}
                            </Typography.Text>
                          ) : null}
                          {item.last_error ? (
                            <Typography.Text type="danger" style={{ fontSize: 12 }}>
                              {truncateOneLine(item.last_error, 80)}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            ) : (
              <EmptyRich
                icon={<ProfileOutlined />}
                title="暂无运行日志"
                description="启动工单流水线后，这里会按 run 聚合轨迹。"
              />
            )}
          </Card>
        </aside>

        <section className="pane">
          <Card
            size="small"
            className="pane-card"
            loading={detailLoading}
            title={selected ? `运行 ${selected.run_id}` : "运行详情"}
            extra={
              selected ? (
                <Space wrap>
                  <Select
                    style={{ width: 120 }}
                    value={source}
                    onChange={setSource}
                    options={[
                      { value: "all", label: "全部来源" },
                      ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                  <Select
                    style={{ width: 110 }}
                    value={level}
                    onChange={setLevel}
                    options={[
                      { value: "all", label: "全部级别" },
                      { value: "info", label: "info" },
                      { value: "warn", label: "warn" },
                      { value: "error", label: "error" },
                      { value: "debug", label: "debug" },
                    ]}
                  />
                </Space>
              ) : null
            }
          >
            {!selected ? (
              <EmptyRich
                icon={<ProfileOutlined />}
                title="选择左侧一次运行"
                description="查看时间线、产物与错误摘要。"
              />
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  <Link to={`/work-orders?id=${encodeURIComponent(selected.work_order_id)}`}>
                    <Tag color="blue" icon={<LinkOutlined />} style={{ cursor: "pointer" }}>
                      工单 {selected.work_order_id}
                    </Tag>
                  </Link>
                  {selected.project_id ? (
                    <Tag color="cyan">项目 {selected.project_id}</Tag>
                  ) : null}
                  {selected.executor ? <Tag>{selected.executor}</Tag> : null}
                  {(selected.sources || []).map((s) => (
                    <Tag key={s} color={SOURCE_COLOR[s]}>
                      {SOURCE_LABEL[s]}
                    </Tag>
                  ))}
                </Space>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">关联 ID（可复制 / 点标签检索）</Typography.Text>
                  <Space wrap>
                    <Typography.Text>
                      Studio{" "}
                      <Typography.Text
                        code
                        copyable
                        onClick={() => setQ(selected.run_id)}
                        style={{ cursor: "pointer" }}
                      >
                        {selected.run_id}
                      </Typography.Text>
                    </Typography.Text>
                    {selected.bridge_run_id ? (
                      <Typography.Text>
                        Bridge{" "}
                        <Typography.Text
                          code
                          copyable
                          onClick={() => setQ(selected.bridge_run_id)}
                          style={{ cursor: "pointer" }}
                        >
                          {selected.bridge_run_id}
                        </Typography.Text>
                        {selected.bridge_stage ? ` / ${selected.bridge_stage}` : ""}
                      </Typography.Text>
                    ) : null}
                  </Space>
                  {selected.last_error ? (
                    <Typography.Text type="danger">
                      最近失败：{selected.last_error}
                    </Typography.Text>
                  ) : null}
                </Space>

                {trace.length ? (
                  <Card size="small" type="inner" title="运行轨迹（Studio → Bridge）">
                    <Steps
                      size="small"
                      direction="vertical"
                      items={trace.map((step, idx) => ({
                        title: step.label,
                        description: (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {step.kind}
                            {step.at ? ` · ${new Date(step.at).toLocaleString()}` : ""}
                          </Typography.Text>
                        ),
                        status: traceStepStatus(step, idx === trace.length - 1),
                      }))}
                    />
                  </Card>
                ) : null}

                <Tabs
                  items={[
                    {
                      key: "entries",
                      label: "控制面日志",
                      children: (
                        <Space direction="vertical" size={12} style={{ width: "100%" }}>
                          <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
                            <Typography.Text type="secondary">
                              开始 {selected.started_at} · 更新 {selected.updated_at} ·{" "}
                              {entries.length} 条（过滤后）
                            </Typography.Text>
                            {orderedEntries.length ? (
                              <Space size={8}>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => setOpenKeys(orderedEntries.map((e) => e.id))}
                                >
                                  全部展开
                                </Button>
                                <Button size="small" type="link" onClick={() => setOpenKeys([])}>
                                  全部折叠
                                </Button>
                              </Space>
                            ) : null}
                          </Space>

                          {orderedEntries.length ? (
                            <Collapse
                              className="run-log-collapse"
                              activeKey={openKeys}
                              onChange={(keys) =>
                                setOpenKeys(
                                  Array.isArray(keys) ? keys.map(String) : [String(keys)],
                                )
                              }
                              items={orderedEntries.map((e) => ({
                                key: e.id,
                                label: (
                                  <div className="run-log-collapse-label">
                                    <Space wrap size={[6, 4]}>
                                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        {new Date(e.at).toLocaleString()}
                                      </Typography.Text>
                                      <Tag color={SOURCE_COLOR[e.source]}>
                                        {SOURCE_LABEL[e.source]}
                                      </Tag>
                                      {e.level !== "info" ? (
                                        <Tag color={levelColor(e.level)}>{e.level}</Tag>
                                      ) : null}
                                      {e.step_id ? <Tag>step:{e.step_id}</Tag> : null}
                                      {e.agent ? <Tag>agent:{e.agent}</Tag> : null}
                                      {e.bridge_stage ? (
                                        <Tag>bridge:{e.bridge_stage}</Tag>
                                      ) : null}
                                      {e.body?.trim() ? <Tag color="purple">有详情</Tag> : null}
                                    </Space>
                                    <Typography.Text className="run-log-collapse-msg">
                                      {truncateOneLine(e.message)}
                                    </Typography.Text>
                                  </div>
                                ),
                                children: (
                                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                    <Typography.Paragraph
                                      style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                                    >
                                      {e.message}
                                    </Typography.Paragraph>
                                    {e.body?.trim() ? (
                                      <Card size="small" type="inner" title="详情 / Agent 产出">
                                        <AgentOutputView output={e.body} maxHeight={320} />
                                      </Card>
                                    ) : null}
                                  </Space>
                                ),
                              }))}
                            />
                          ) : (
                            <Empty description="该运行暂无匹配日志" />
                          )}
                        </Space>
                      ),
                    },
                    {
                      key: "artifacts",
                      label: "Bridge 产物",
                      children: (
                        <RunArtifactsPanel
                          runId={selected.run_id}
                          bridgeRunId={selected.bridge_run_id}
                        />
                      ),
                    },
                  ]}
                />
              </Space>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
