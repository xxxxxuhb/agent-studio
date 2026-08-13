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
  const [contentLoading, setContentLoading] = useState(false);
  const [hint, setHint] = useState<string>("");

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
      if (!res.items?.length) {
        setHint(
          uniqueSnapshots.length
            ? "Bridge 上暂无可读文件（可能已 gc）；下方为工单快照路径。"
            : "Bridge 上该 run 暂无产物文件（或尚未写入 run 产物目录）。",
        );
      }
    } catch (err) {
      setItems([]);
      setHint(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function openArtifact(name: string) {
    setSelected(name);
    setContentLoading(true);
    try {
      const res = await runLogsApi.readArtifact(runId, name);
      setContent(res.content || "");
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
    void reloadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (!bridgeRunId && !uniqueSnapshots.length) {
    return (
      <Alert
        type="info"
        showIcon
        message="尚无 Bridge run"
        description="流水线执行到 Bridge 阶段并回写 bridge_run_id 后，可在此查看 run 产物目录。"
      />
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {bridgeRunId ? (
        <Space wrap>
          <Typography.Text type="secondary">
            Bridge{" "}
            <Typography.Text code copyable>
              {bridgeRunId}
            </Typography.Text>
          </Typography.Text>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void reloadList()}
            loading={loading}
          >
            刷新产物
          </Button>
        </Space>
      ) : null}

      {hint && !items.length ? (
        <Alert type="warning" showIcon message={hint} />
      ) : null}

      {uniqueSnapshots.length ? (
        <div>
          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
            工单快照路径（阶段回写，不依赖 Bridge 磁盘）
          </Typography.Text>
          <List
            size="small"
            bordered
            dataSource={uniqueSnapshots}
            renderItem={(path) => {
              const base = path.split(/[/\\]/).pop() || path;
              return (
                <List.Item>
                  <Space wrap>
                    <Typography.Text code copyable={{ text: path }}>
                      {path}
                    </Typography.Text>
                    {bridgeRunId ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => void openArtifact(base)}
                      >
                        尝试打开
                      </Button>
                    ) : null}
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
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            {selected}
          </Typography.Text>
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
