import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { RunLogEntry, RunLogMeta, RunLogSource } from "@agent-studio/agent-schema";
import { runLogsApi } from "../api/run-logs";
import { AgentOutputView } from "../components/AgentOutputView";

const SOURCE_COLOR: Record<RunLogSource, string> = {
  system: "default",
  pipeline: "blue",
  agent: "purple",
  bridge: "green",
  dify: "cyan",
  manager: "geekblue",
  human: "orange",
};

const SOURCE_LABEL: Record<RunLogSource, string> = {
  system: "系统",
  pipeline: "流水线",
  agent: "Agent",
  bridge: "Bridge",
  dify: "Dify",
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
      const res = await runLogsApi.list({ q });
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
      const reversed = [...res.entries].reverse();
      // 默认展开最近一条带 body 的，否则最近一条
      const withBody = reversed.find((e) => e.body?.trim());
      setOpenKeys([(withBody || reversed[0])?.id].filter(Boolean) as string[]);
    } catch (err) {
      setMeta(null);
      setEntries([]);
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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space wrap>
        <Input.Search
          placeholder="搜索 run_id / 工单 / 流水线"
          allowClear
          defaultValue={initialQ}
          style={{ width: 280 }}
          onSearch={setQ}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void reloadList()}>
          刷新
        </Button>
        <Typography.Text type="secondary">共 {total} 次运行</Typography.Text>
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card size="small" title="按运行 ID" loading={loading}>
            {items.length ? (
              <List
                dataSource={items}
                renderItem={(item) => (
                  <List.Item
                    style={{
                      cursor: "pointer",
                      background:
                        item.run_id === selectedId ? "#f5f5f5" : undefined,
                      padding: "8px 12px",
                      borderRadius: 6,
                    }}
                    onClick={() => selectRun(item.run_id)}
                  >
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <Typography.Text code>{item.run_id}</Typography.Text>
                          {item.work_order_status ? (
                            <Tag>{item.work_order_status}</Tag>
                          ) : null}
                        </Space>
                      }
                      description={`${item.title || item.work_order_id} · ${item.pipeline_name || item.pipeline_id || "-"} · ${item.entry_count} 条`}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无运行日志（启动工单后写入）" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card
            size="small"
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
              <Empty description="选择左侧一次运行" />
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  <Tag>工单 {selected.work_order_id}</Tag>
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
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
