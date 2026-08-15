import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Mentions,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { SendOutlined } from "@ant-design/icons";
import type {
  AgentChatMessage,
  AgentChatThread,
  DigitalHuman,
  WorkOrder,
} from "@agent-studio/agent-schema";
import { digitalHumansApi } from "../api/digital-humans";
import { workOrdersApi } from "../api/work-orders";
import { getSelectedTeam } from "../auth/session";
import { MarkdownBody } from "./MarkdownBody";

type Props = {
  order: WorkOrder;
  onOrderUpdate?: (order: WorkOrder) => void;
  /** Fill parent height (drawer / fullscreen). */
  fill?: boolean;
};

function bubbleClass(role: AgentChatMessage["role"]): string {
  if (role === "user") return "wo-agent-chat-bubble wo-agent-chat-bubble--user";
  if (role === "agent") return "wo-agent-chat-bubble wo-agent-chat-bubble--agent";
  return "wo-agent-chat-bubble wo-agent-chat-bubble--system";
}

export function WorkOrderAgentChat({ order, onOrderUpdate, fill }: Props) {
  const bridgeRunId = order.run?.studio?.bridge_run_id?.trim() || "";
  const [humans, setHumans] = useState<DigitalHuman[]>([]);
  const [thread, setThread] = useState<AgentChatThread | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await digitalHumansApi.list({
          enabled: "true",
          team_id: order.team_id || getSelectedTeam()?.id,
        });
        if (!cancelled) setHumans(data.items || []);
      } catch {
        if (!cancelled) setHumans([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.team_id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const next = await workOrdersApi.agentChat(order.id);
        if (!cancelled) setThread(next);
      } catch {
        if (!cancelled) setThread({ work_order_id: order.id, messages: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages?.length, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    if (!bridgeRunId) {
      message.warning("请先启动流水线后再 @ 数字人");
      return;
    }
    setSending(true);
    try {
      const res = await workOrdersApi.postAgentChat(order.id, text);
      setThread(res.thread);
      setDraft("");
      onOrderUpdate?.(res.order);
      const last = res.thread.messages[res.thread.messages.length - 1];
      if (last?.role === "system" || last?.error) {
        message.error(last.error || last.content || "Agent 调用失败");
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const options = humans.map((h) => ({
    value: h.id,
    label: (
      <span>
        {h.name} <Typography.Text type="secondary">@{h.id}</Typography.Text>
      </span>
    ),
  }));

  return (
    <div
      className={fill ? "wo-agent-chat wo-agent-chat--fill" : "wo-agent-chat"}
      aria-busy={loading}
    >
      <Space wrap size={6}>
        <Tag color={bridgeRunId ? "green" : "default"}>
          {bridgeRunId ? "可 @ 数字人" : "需先启动流水线"}
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          @ 后按角色真实调用 Bridge · 不推进主编排
        </Typography.Text>
      </Space>

      {!bridgeRunId ? (
        <Alert
          type="info"
          showIcon
          message="启动流水线后可用"
          description="需要已有 Bridge run，才能 @ 数字人跑一轮。"
        />
      ) : null}

      <div className="wo-agent-chat-list">
        {thread?.messages?.length ? (
          thread.messages.map((m) => (
            <div key={m.id} className={bubbleClass(m.role)}>
              <div className="wo-agent-chat-meta">
                <Tag>
                  {m.role === "user"
                    ? "你"
                    : m.role === "agent"
                      ? m.agent_name || m.agent_id || "Agent"
                      : "系统"}
                </Tag>
                {m.stage ? <Tag color="green">{m.stage}</Tag> : null}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(m.created_at).toLocaleTimeString()}
                </Typography.Text>
              </div>
              {m.role === "user" ? (
                <Typography.Paragraph
                  style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}
                >
                  {m.content}
                </Typography.Paragraph>
              ) : (
                <MarkdownBody
                  className="wo-agent-chat-md"
                  content={m.content}
                />
              )}
            </div>
          ))
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有消息。试试 @fullstack_dev 加个空状态"
          />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="wo-agent-chat-composer">
        <Mentions
          value={draft}
          onChange={setDraft}
          placeholder="@fullstack_dev 补充需求…"
          rows={fill ? 4 : 3}
          options={options}
          disabled={!bridgeRunId || sending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={sending}
          disabled={!bridgeRunId || !draft.trim()}
          onClick={() => void send()}
        >
          发送
        </Button>
      </div>
    </div>
  );
}
