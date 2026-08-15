import { useEffect, useMemo, useState } from "react";
import { Button, Empty, List, Mentions, Space, Typography, message } from "antd";
import { SendOutlined } from "@ant-design/icons";
import type {
  TeamMember,
  WorkOrder,
  WorkOrderCommentThread,
} from "@agent-studio/agent-schema";
import { teamsApi } from "../api/auth";
import { workOrderCommentsApi } from "../api/work-order-comments";

type Props = {
  order: WorkOrder;
  onOrderUpdate?: (order: WorkOrder) => void;
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function memberLabel(m: TeamMember): string {
  return (m.display_name || "").trim() || (m.username || "").trim() || m.user_id;
}

function memberToken(m: TeamMember): string {
  return (m.username || "").trim() || (m.display_name || "").trim() || m.user_id;
}

export function WorkOrderComments({ order, onOrderUpdate }: Props) {
  const [thread, setThread] = useState<WorkOrderCommentThread | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const next = await workOrderCommentsApi.list(order.id);
        if (!cancelled) setThread(next);
      } catch {
        if (!cancelled) {
          setThread({ work_order_id: order.id, comments: [] });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  useEffect(() => {
    const teamId = (order.team_id || "").trim();
    if (!teamId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await teamsApi.get(teamId);
        if (!cancelled) setMembers(detail.members || []);
      } catch {
        if (!cancelled) setMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.team_id]);

  const mentionOptions = useMemo(
    () =>
      members.map((m) => ({
        value: memberToken(m),
        label: `${memberLabel(m)}${
          m.username && m.display_name ? ` (@${m.username})` : ""
        }`,
      })),
    [members],
  );

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await workOrderCommentsApi.post(order.id, text);
      setThread(res.thread);
      setDraft("");
      onOrderUpdate?.(res.order);
      message.success("评论已发送");
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const comments = thread?.comments || [];

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 12 }}>
        可 @ 本团队系统用户；被提及的成员会收到站内通知（团队隔离）。
      </Typography.Paragraph>

      {comments.length === 0 && !loading ? (
        <Empty description="暂无评论" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          loading={loading}
          size="small"
          dataSource={comments}
          renderItem={(c) => (
            <List.Item key={c.id} style={{ alignItems: "flex-start" }}>
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                <Space size={8} wrap>
                  <Typography.Text strong>{c.author_name || "匿名"}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatTime(c.created_at)}
                  </Typography.Text>
                </Space>
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                  {c.body}
                </Typography.Paragraph>
              </Space>
            </List.Item>
          )}
        />
      )}

      <div style={{ marginTop: 12 }}>
        <Mentions
          value={draft}
          onChange={setDraft}
          placeholder="写一条评论，输入 @ 选择团队成员…"
          autoSize={{ minRows: 2, maxRows: 6 }}
          disabled={sending}
          options={mentionOptions}
          onPressEnter={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={sending}
            onClick={() => void send()}
            disabled={!draft.trim()}
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
