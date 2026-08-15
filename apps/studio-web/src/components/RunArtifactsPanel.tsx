import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { runLogsApi, type RunArtifactListItem } from "../api/run-logs";
import { AgentOutputView } from "./AgentOutputView";

type Props = {
  /** Studio run_id (not Bridge run id). */
  runId: string;
  bridgeRunId?: string;
  /** Paths snapshotted onto the work order (survive Bridge gc). */
  snapshotPaths?: string[];
};

export function RunArtifactsPanel({
  runId,
  bridgeRunId,
  snapshotPaths = [],
}: Props) {
  const [items, setItems] = useState<RunArtifactListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [contentSource, setContentSource] = useState<string>("");
  const [contentLoading, setContentLoading] = useState(false);
  const [hint, setHint] = useState<string>("");
  const [storedCount, setStoredCount] = useState(0);

  const uniqueSnapshots = [
    ...new Set(snapshotPaths.map((p) => p.trim()).filter(Boolean)),
  ];

  async function reloadList() {
    if (!runId) return;
    setLoading(true);
    setHint("");
    try {
      const res = await runLogsApi.listArtifacts(runId);
      setItems(res.items || []);
      setStoredCount(res.stored_count || 0);
      if (res.hint) {
        setHint(res.hint);
      } else if (!res.items?.length) {
        setHint(
          uniqueSnapshots.length
            ? "暂无可读文件；下方为工单快照路径。阶段完成时会自动入库内容。"
            : "该 run 暂无产物文件（或尚未写入 / 入库）。",
        );
      }
    } catch (err) {
      setItems([]);
      setStoredCount(0);
      setHint(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function openArtifact(name: string) {
    setSelected(name);
    setContentLoading(true);
    setContentSource("");
    try {
      const res = await runLogsApi.readArtifact(runId, name);
      setContent(res.content || "");
      setContentSource(res.source || "");
    } catch (err) {
      setContent("");
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setContentLoading(false);
    }
  }

  useEffect(() => {
    setSelected(null);
    setContent("");
    setContentSource("");
    void reloadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (!bridgeRunId && !uniqueSnapshots.length && !items.length && !hint) {
    return (
      <Alert
        type="info"
        showIcon
        message="尚无 Bridge run"
        description="流水线执行到 Bridge 阶段并回写 bridge_run_id 后，可在此查看 run 产物；阶段完成时内容会入库，Bridge gc 后仍可打开。"
      />
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        {bridgeRunId ? (
          <Typography.Text type="secondary">
            Bridge{" "}
            <Typography.Text code copyable>
              {bridgeRunId}
            </Typography.Text>
          </Typography.Text>
        ) : null}
        {storedCount > 0 ? (
          <Tag color="blue">已入库 {storedCount}</Tag>
        ) : null}
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => void reloadList()}
          loading={loading}
          disabled={!runId}
        >
          刷新产物
        </Button>
      </Space>

      {hint ? <Alert type="warning" showIcon message={hint} /> : null}

      {uniqueSnapshots.length ? (
        <div>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginBottom: 6 }}
          >
            工单快照路径（阶段回写）
          </Typography.Text>
          <List
            size="small"
            bordered
            dataSource={uniqueSnapshots.filter((p) => {
              const base = p.split(/[/\\]/).pop() || p;
              // Skip bare run dirs (no extension) — not openable files.
              return /\.[a-z0-9]+$/i.test(base);
            })}
            renderItem={(path) => {
              const base = path.split(/[/\\]/).pop() || path;
              const available = items.some((it) => it.name === base);
              return (
                <List.Item>
                  <Space wrap>
                    <Typography.Text code copyable={{ text: path }}>
                      {path}
                    </Typography.Text>
                    {available ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => void openArtifact(base)}
                      >
                        打开
                      </Button>
                    ) : (
                      <Tag>未落盘</Tag>
                    )}
                  </Space>
                </List.Item>
              );
            }}
          />
        </div>
      ) : null}

      <Spin spinning={loading}>
        {items.length ? (
          <List
            size="small"
            bordered
            dataSource={items}
            renderItem={(item) => (
              <List.Item
                style={{
                  cursor: "pointer",
                  background: item.name === selected ? "#f5f5f5" : undefined,
                }}
                onClick={() => void openArtifact(item.name)}
              >
                <Space wrap>
                  <Typography.Text code>{item.name}</Typography.Text>
                  {item.source === "stored" ? (
                    <Tag color="blue">入库</Tag>
                  ) : item.source === "bridge" ? (
                    <Tag>Bridge</Tag>
                  ) : null}
                  {item.role ? <Tag>{item.role}</Tag> : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.bytes} B · {new Date(item.updated_at).toLocaleString()}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        ) : !loading && !uniqueSnapshots.length ? (
          <Empty description="无产物文件" />
        ) : null}
      </Spin>

      {selected ? (
        <Spin spinning={contentLoading}>
          <Space style={{ marginBottom: 8 }}>
            <Typography.Text strong>{selected}</Typography.Text>
            {contentSource === "stored" ? (
              <Tag color="blue">来自入库</Tag>
            ) : contentSource === "bridge" ? (
              <Tag>来自 Bridge</Tag>
            ) : null}
          </Space>
          {content ? (
            <AgentOutputView output={content} maxHeight={420} />
          ) : !contentLoading ? (
            <Empty description="空文件" />
          ) : null}
        </Spin>
      ) : null}
    </Space>
  );
}
