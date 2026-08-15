import { useEffect, useState } from "react";
import { Button, Space, Typography, Upload, message } from "antd";
import { DeleteOutlined, PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import type { WorkOrderAttachment } from "@agent-studio/agent-schema";
import {
  WORK_ORDER_ATTACHMENT_MAX_BYTES,
} from "@agent-studio/agent-schema";
import { workOrderAttachmentsApi } from "../api/work-order-attachments";
import { getToken } from "../auth/session";

type Props = {
  workOrderId: string;
  /** When false, hide upload/delete (read-only). */
  editable?: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function WorkOrderAttachments({ workOrderId, editable = true }: Props) {
  const [items, setItems] = useState<WorkOrderAttachment[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function refresh() {
    if (!workOrderId) return;
    setLoading(true);
    try {
      const res = await workOrderAttachmentsApi.list(workOrderId);
      setItems(res.items);
      setTotalBytes(res.total_bytes);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [workOrderId]);

  async function onUpload(file: File) {
    if (file.size > WORK_ORDER_ATTACHMENT_MAX_BYTES) {
      message.error(
        `单文件不能超过 ${WORK_ORDER_ATTACHMENT_MAX_BYTES / 1024 / 1024}MB`,
      );
      return false;
    }
    setUploading(true);
    try {
      await workOrderAttachmentsApi.upload(workOrderId, file);
      message.success(`已上传 ${file.name}`);
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
    return false;
  }

  async function onRemove(id: string) {
    try {
      await workOrderAttachmentsApi.remove(workOrderId, id);
      message.success("已删除");
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function openDownload(att: WorkOrderAttachment) {
    const url = workOrderAttachmentsApi.downloadUrl(workOrderId, att.id);
    const token = getToken();
    void fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`下载失败 (${res.status})`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = att.filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) =>
        message.error(err instanceof Error ? err.message : String(err)),
      );
  }

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 12 }}>
        人 → Agent 输入附件（图 / PDF / 文本）；启动或审批时注入 Bridge{" "}
        <Typography.Text code>docs/runs/&lt;id&gt;/inbox/</Typography.Text>
        。合计 {formatBytes(totalBytes)}。
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        {items.map((att) => (
          <div
            key={att.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "space-between",
            }}
          >
            <Space size={6} wrap>
              <PaperClipOutlined />
              <Typography.Link onClick={() => openDownload(att)}>
                {att.filename}
              </Typography.Link>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatBytes(att.bytes)}
              </Typography.Text>
            </Space>
            {editable ? (
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => void onRemove(att.id)}
              />
            ) : null}
          </div>
        ))}
        {!items.length && !loading ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            暂无附件
          </Typography.Text>
        ) : null}
        {editable ? (
          <Upload
            beforeUpload={(file) => {
              void onUpload(file);
              return false;
            }}
            showUploadList={false}
            disabled={uploading}
          >
            <Button icon={<UploadOutlined />} loading={uploading} size="small">
              上传附件
            </Button>
          </Upload>
        ) : null}
      </Space>
    </div>
  );
}
