import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { PlusOutlined, ReloadOutlined, UserAddOutlined } from "@ant-design/icons";
import type { TeamDetail, TeamListItem, TeamMemberRole } from "@agent-studio/agent-schema";
import { useNavigate } from "react-router-dom";
import { teamsApi } from "../api/auth";
import { getSelectedTeam, getStoredUser } from "../auth/session";

export function TeamsPage({ standalone = false }: { standalone?: boolean }) {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [items, setItems] = useState<TeamListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [createForm] = Form.useForm<{ slug: string; name: string }>();
  const [memberForm] = Form.useForm<{ username: string; role: TeamMemberRole }>();
  const [userForm] = Form.useForm<{
    username: string;
    password: string;
    display_name?: string;
  }>();

  const selected = useMemo(
    () => items.find((t) => t.id === selectedId) || null,
    [items, selectedId],
  );

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const res = await teamsApi.list({ scope: "all" });
      setItems(res.items);
      const nextId = keepId === undefined ? selectedId : keepId;
      if (nextId && res.items.some((t) => t.id === nextId)) {
        setSelectedId(nextId);
        setDetail(await teamsApi.get(nextId));
      } else if (res.items[0]) {
        setSelectedId(res.items[0].id);
        setDetail(await teamsApi.get(res.items[0].id));
      } else {
        setSelectedId(null);
        setDetail(null);
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
  }, []);

  async function selectTeam(id: string) {
    setSelectedId(id);
    try {
      setDetail(await teamsApi.get(id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {standalone ? (
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">系统管理员 · 团队配置</Typography.Text>
          <Button
            onClick={() =>
              navigate(getSelectedTeam() ? "/work-orders" : "/select-team")
            }
          >
            {getSelectedTeam() ? "返回工作台" : "返回选团队"}
          </Button>
        </Space>
      ) : null}
      {!user?.is_admin ? (
        <Typography.Text type="danger">仅系统管理员可配置团队</Typography.Text>
      ) : null}
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            团队管理
          </Typography.Title>
          <Typography.Text type="secondary">
            创建团队、添加成员（共 {items.length} 个）
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建团队
          </Button>
        </Space>
      </Space>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        <Card size="small" loading={loading}>
          <List
            dataSource={items}
            locale={{ emptyText: "暂无团队" }}
            renderItem={(t) => (
              <List.Item
                style={{
                  cursor: "pointer",
                  background: t.id === selectedId ? "#f5f5f5" : undefined,
                  padding: "8px 12px",
                  borderRadius: 6,
                }}
                onClick={() => void selectTeam(t.id)}
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{t.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t.slug} · {t.member_count} 人 · {t.my_role || "-"}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>

        <Card
          size="small"
          title={selected ? selected.name : "详情"}
          extra={
            detail ? (
              <Space>
                <Button
                  icon={<UserAddOutlined />}
                  onClick={() => {
                    userForm.resetFields();
                    setUserOpen(true);
                  }}
                >
                  创建用户
                </Button>
                <Button
                  type="primary"
                  onClick={() => {
                    memberForm.setFieldsValue({ role: "member" });
                    setMemberOpen(true);
                  }}
                >
                  添加成员
                </Button>
              </Space>
            ) : null
          }
        >
          {!detail ? (
            <Typography.Text type="secondary">选择左侧团队</Typography.Text>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                slug: {detail.slug} · 我的角色: {detail.my_role || "-"}
              </Typography.Paragraph>
              <Table
                size="small"
                rowKey={(r) => r.user_id}
                pagination={false}
                dataSource={detail.members}
                columns={[
                  { title: "用户名", dataIndex: "username" },
                  { title: "显示名", dataIndex: "display_name" },
                  {
                    title: "角色",
                    dataIndex: "role",
                    render: (role: string) => (
                      <Tag color={role === "owner" ? "gold" : "default"}>{role}</Tag>
                    ),
                  },
                  {
                    title: "操作",
                    render: (_, row) => (
                        <Button
                          danger
                          size="small"
                          onClick={() => {
                            Modal.confirm({
                              title: `移除成员 ${row.username}？`,
                              onOk: async () => {
                                const next = await teamsApi.removeMember(
                                  detail.id,
                                  row.user_id,
                                );
                                setDetail(next);
                                await reload(detail.id);
                                message.success("已移除");
                              },
                            });
                          }}
                        >
                          移除
                        </Button>
                      ),
                  },
                ]}
              />
            </Space>
          )}
        </Card>
      </div>

      <Modal
        title="新建团队"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          return createForm.validateFields().then(async (v) => {
            try {
              const created = await teamsApi.create(v);
              setCreateOpen(false);
              message.success("团队已创建");
              await reload(created.id);
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              throw err;
            }
          });
        }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label="slug"
            name="slug"
            rules={[{ required: true, message: "必填，如 acme" }]}
            extra="小写字母开头，可用 a-z 0-9 _ -"
          >
            <Input placeholder="acme" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="Acme 团队" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="添加成员"
        open={memberOpen}
        onCancel={() => setMemberOpen(false)}
        onOk={() => {
          if (!detail) return;
          return memberForm.validateFields().then(async (v) => {
            try {
              const next = await teamsApi.addMember(detail.id, v);
              setMemberOpen(false);
              setDetail(next);
              message.success("已添加");
              await reload(detail.id);
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              throw err;
            }
          });
        }}
      >
        <Form form={memberForm} layout="vertical" initialValues={{ role: "member" }}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true }]}
            extra="用户须已存在；没有账号时请先「创建用户」"
          >
            <Input />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "member", label: "member" },
                { value: "owner", label: "owner" },
                { value: "viewer", label: "viewer（只读）" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建用户账号"
        open={userOpen}
        onCancel={() => setUserOpen(false)}
        onOk={() => {
          return userForm.validateFields().then(async (v) => {
            try {
              await teamsApi.createUser(v);
              setUserOpen(false);
              message.success(`已创建用户 ${v.username}，可添加为成员`);
              memberForm.setFieldsValue({ username: v.username, role: "member" });
              setMemberOpen(true);
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              throw err;
            }
          });
        }}
      >
        <Form form={userForm} layout="vertical">
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="显示名" name="display_name">
            <Input />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[{ required: true, min: 6 }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
