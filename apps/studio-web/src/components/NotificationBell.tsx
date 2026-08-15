import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Dropdown,
  Empty,
  List,
  Space,
  Typography,
  notification as antNotification,
} from "antd";
import { BellOutlined } from "@ant-design/icons";
import type { SystemNotification } from "@agent-studio/agent-schema";
import { useNavigate } from "react-router-dom";
import { notificationsApi } from "../api/notifications";
import { subscribeNotifications } from "../ws/notifications";

type Props = {
  teamId: string;
  userId: string;
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function NotificationBell({ teamId, userId }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!teamId || !userId) return;
    try {
      const res = await notificationsApi.list(teamId, { limit: 30 });
      setItems(res.items);
      setUnread(res.unread_count);
    } catch {
      /* ignore transient errors */
    }
  }, [teamId, userId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!teamId || !userId) return;
    return subscribeNotifications(teamId, userId, {
      onNotification: (n) => {
        setItems((prev) => [n, ...prev.filter((x) => x.id !== n.id)].slice(0, 30));
        setUnread((c) => c + 1);
        antNotification.info({
          message: n.title || "系统通知",
          description: (n.body || "").slice(0, 160) || undefined,
          placement: "topRight",
          duration: 5,
          onClick: () => {
            if (n.work_order_id) {
              navigate(`/work-orders?wo=${encodeURIComponent(n.work_order_id)}`);
            }
          },
        });
      },
    });
  }, [teamId, userId, navigate]);

  async function openItem(n: SystemNotification) {
    if (!n.read_at) {
      try {
        const res = await notificationsApi.markRead(teamId, { ids: [n.id] });
        setItems(res.items);
        setUnread(res.unread_count);
      } catch {
        setItems((prev) =>
          prev.map((x) =>
            x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x,
          ),
        );
        setUnread((c) => Math.max(0, c - 1));
      }
    }
    setOpen(false);
    if (n.work_order_id) {
      navigate(`/work-orders?wo=${encodeURIComponent(n.work_order_id)}`);
    }
  }

  async function markAll() {
    try {
      const res = await notificationsApi.markAllRead(teamId);
      setItems(res.items);
      setUnread(res.unread_count);
    } catch {
      /* ignore */
    }
  }

  const menu = (
    <div
      style={{
        width: 360,
        maxHeight: 420,
        overflow: "auto",
        background: "var(--ant-color-bg-elevated, #fff)",
        boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 8px 8px",
        }}
      >
        <Typography.Text strong>系统通知</Typography.Text>
        <Button type="link" size="small" disabled={!unread} onClick={() => void markAll()}>
          全部已读
        </Button>
      </div>
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无通知"
          style={{ padding: 24 }}
        />
      ) : (
        <List
          size="small"
          dataSource={items}
          renderItem={(n) => (
            <List.Item
              key={n.id}
              style={{
                cursor: "pointer",
                background: n.read_at ? undefined : "rgba(22, 119, 255, 0.06)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
              onClick={() => void openItem(n)}
            >
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                <Typography.Text strong={!n.read_at} style={{ fontSize: 13 }}>
                  {n.title}
                </Typography.Text>
                {n.body ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                    {n.body}
                  </Typography.Text>
                ) : null}
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {formatTime(n.created_at)}
                  {n.work_order_id ? ` · ${n.work_order_id}` : ""}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Dropdown
      dropdownRender={() => menu}
      trigger={["click"]}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
      placement="bottomRight"
    >
      <Badge count={unread} size="small" overflowCount={99}>
        <Button
          type="text"
          size="small"
          icon={<BellOutlined />}
          aria-label="系统通知"
          title="系统通知"
        />
      </Badge>
    </Dropdown>
  );
}
