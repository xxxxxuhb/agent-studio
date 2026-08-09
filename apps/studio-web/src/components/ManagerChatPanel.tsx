import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Space, Typography, message } from "antd";
import { SendOutlined } from "@ant-design/icons";
import type { ManagerChatMessage, WorkOrder } from "@agent-studio/agent-schema";
import { workOrdersApi } from "../api/work-orders";

const QUICK = ["状态", "帮助", "通过", "驳回结束", "返工到 plan"];

export function ManagerChatPanel(props: {
  workOrderId: string;
  onWorkOrderChange?: (order: WorkOrder) => void;
}) {
  const { workOrderId, onWorkOrderChange } = props;
  const [messages, setMessages] = useState<ManagerChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const thread = await workOrdersApi.getChat(workOrderId);
      setMessages(thread.messages || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(content: string) {
    const msg = content.trim();
    if (!msg || sending) return;
    setSending(true);
    setText("");
    try {
      const res = await workOrdersApi.chat(workOrderId, msg);
      setMessages(res.thread.messages || []);
      if (res.work_order) onWorkOrderChange?.(res.work_order);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card
      size="small"
      title="总管对话"
      extra={<Typography.Text type="secondary">Manager</Typography.Text>}
      styles={{ body: { padding: 12 } }}
    >
      <div
        style={{
          height: 360,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 12,
          paddingRight: 4,
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              background: m.role === "user" ? "#1677ff" : "#f5f5f5",
              color: m.role === "user" ? "#fff" : "inherit",
              borderRadius: 12,
              padding: "8px 12px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            {m.role !== "user" ? (
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                总管
              </Typography.Text>
            ) : null}
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <Space wrap style={{ marginBottom: 8 }}>
        {QUICK.map((q) => (
          <Button key={q} size="small" onClick={() => void send(q)} disabled={sending}>
            {q}
          </Button>
        ))}
      </Space>

      <Space.Compact style={{ width: "100%" }}>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="和总管对话：查状态 / 澄清：… / 通过 / 返工到 dev"
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          disabled={sending}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={sending}
          onClick={() => void send(text)}
          style={{ height: "auto" }}
        >
          发送
        </Button>
      </Space.Compact>
    </Card>
  );
}
