import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Descriptions,
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
import {
  ArrowLeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { TeamDetail, TeamListItem, TeamMemberRole } from "@agent-studio/agent-schema";
import { useNavigate } from "react-router-dom";
import { teamsApi } from "../api/auth";
import { EmptyRich, EmptyRichActionButton } from "../components/EmptyRich";
import { getSelectedTeam, getStoredUser } from "../auth/session";

const ROLE_LABEL: Record<
  TeamMemberRole,
  { text: string; color: string }
> = {
  owner: { text: "负责人", color: "gold" },
  member: { text: "成员", color: "blue" },
  viewer: { text: "只读", color: "default" },
};

const ROLE_OPTIONS = [
  { value: "owner", label: "负责人 (owner)" },
  { value: "member", label: "成员 (member)" },
  { value: "viewer", label: "只读 (viewer)" },
];

function roleTag(role?: string) {
  const meta = ROLE_LABEL[(role as TeamMemberRole) || "member"] || {
    text: role || "-",
    color: "default",
  };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function memberInitial(name?: string, username?: string) {
  return (name || username || "?").trim().slice(0, 1).toUpperCase();
}

export function TeamsPage({ standalone = false }: { standalone?: boolean }) {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [items, setItems] = useState<TeamListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [q, setQ] = useState("");
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle),
    );
  }, [items, q]);

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
        setDetailLoading(true);
        try {
          setDetail(await teamsApi.get(nextId));
        } finally {
          setDetailLoading(false);
        }
      } else if (res.items[0]) {
        setSelectedId(res.items[0].id);
        setDetailLoading(true);
        try {
          setDetail(await teamsApi.get(res.items[0].id));
        } finally {
          setDetailLoading(false);
        }
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
    setDetailLoading(true);
    try {
      setDetail(await teamsApi.get(id));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeRole(userId: string, role: TeamMemberRole) {
    if (!detail) return;
    try {
      const next = await teamsApi.updateMember(detail.id, userId, { role });
      setDetail(next);
      message.success("角色已更新");
      await reload(detail.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (!user?.is_admin) {
    return (
      <div className="page-shell">
        <EmptyRich
          icon={<TeamOutlined />}
          title="无权访问"
          description="仅系统管理员可配置团队与成员。"
        />
      </div>
    );
  }

  return (
    <div className={`page-shell${standalone ? " teams-page--standalone" : ""}`}>
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          {standalone ? (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() =>
                navigate(getSelectedTeam() ? "/work-orders" : "/select-team")
              }
            >
              {getSelectedTeam() ? "返回工作台" : "返回选团队"}
            </Button>
          ) : null}
          <Input.Search
            allowClear
            placeholder="搜索团队名称 / slug"
            style={{ width: 240 }}
            onSearch={setQ}
            onChange={(e) => {
              if (!e.target.value) setQ("");
            }}
          />
          <span className="page-meta">{items.length} 个团队</span>
        </div>
        <div className="page-toolbar-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              createForm.resetFields();
              setCreateOpen(true);
            }}
          >
            新建团队
          </Button>
        </div>
      </div>

      <div className="page-split page-split--narrow">
        <aside className="pane">
          <Card size="small" title="团队列表" loading={loading} className="pane-card">
            {!filtered.length ? (
              <EmptyRich
                icon={<TeamOutlined />}
                title={items.length ? "无匹配团队" : "还没有团队"}
                description={
                  items.length
                    ? "换个关键词试试"
                    : "创建第一个团队，再邀请成员加入。"
                }
                action={
                  !items.length ? (
                    <EmptyRichActionButton
                      icon={<PlusOutlined />}
                      onClick={() => setCreateOpen(true)}
                    >
                      新建团队
                    </EmptyRichActionButton>
                  ) : undefined
                }
              />
            ) : (
              <List
                dataSource={filtered}
                renderItem={(t) => (
                  <List.Item
                    className={`list-item-clickable${t.id === selectedId ? " list-item-active" : ""}`}
                    onClick={() => void selectTeam(t.id)}
                  >
                    <List.Item.Meta
                      avatar={
                        <Avatar
                          style={{
                            background:
                              t.id === selectedId ? "#1677ff" : "#f0f5ff",
                            color: t.id === selectedId ? "#fff" : "#1677ff",
                          }}
                        >
                          {(t.name || "?").slice(0, 1)}
                        </Avatar>
                      }
                      title={t.name}
                      description={
                        <Space size={6} wrap>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {t.slug}
                          </Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            · {t.member_count ?? 0} 人
                          </Typography.Text>
                          {t.my_role ? roleTag(t.my_role) : null}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </aside>

        <section className="pane">
          <Card
            size="small"
            className="pane-card"
            loading={detailLoading}
            title={selected ? selected.name : "团队详情"}
            extra={
              detail ? (
                <Space wrap>
                  <Button
                    icon={<UserOutlined />}
                    onClick={() => {
                      userForm.resetFields();
                      setUserOpen(true);
                    }}
                  >
                    创建用户
                  </Button>
                  <Button
                    type="primary"
                    icon={<UserAddOutlined />}
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
              <EmptyRich
                icon={<TeamOutlined />}
                title="选择左侧团队"
                description="查看成员、调整角色，或创建新账号并加入团队。"
              />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Descriptions
                  size="small"
                  column={{ xs: 1, sm: 2 }}
                  className="teams-detail-meta"
                >
                  <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
                  <Descriptions.Item label="Slug">
                    <Typography.Text code copyable>
                      {detail.slug}
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="成员数">
                    {detail.members.length}
                  </Descriptions.Item>
                  <Descriptions.Item label="我的角色">
                    {roleTag(detail.my_role)}
                  </Descriptions.Item>
                </Descriptions>

                <div className="teams-members-head">
                  <Typography.Text strong>成员</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    可直接改角色；负责人拥有团队完整管理权
                  </Typography.Text>
                </div>

                <Table
                  size="small"
                  rowKey={(r) => r.user_id}
                  pagination={false}
                  locale={{ emptyText: "暂无成员" }}
                  dataSource={detail.members}
                  columns={[
                    {
                      title: "成员",
                      key: "user",
                      render: (_, row) => (
                        <Space>
                          <Avatar size={28}>
                            {memberInitial(row.display_name, row.username)}
                          </Avatar>
                          <Space direction="vertical" size={0}>
                            <Typography.Text>
                              {row.display_name || row.username || "—"}
                            </Typography.Text>
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: 12 }}
                            >
                              @{row.username}
                            </Typography.Text>
                          </Space>
                        </Space>
                      ),
                    },
                    {
                      title: "角色",
                      dataIndex: "role",
                      width: 160,
                      render: (role: TeamMemberRole, row) => (
                        <Select
                          size="small"
                          value={role}
                          style={{ width: 140 }}
                          options={ROLE_OPTIONS}
                          onChange={(next) => void changeRole(row.user_id, next)}
                        />
                      ),
                    },
                    {
                      title: "",
                      key: "actions",
                      width: 88,
                      render: (_, row) => (
                        <Button
                          danger
                          type="link"
                          size="small"
                          onClick={() => {
                            Modal.confirm({
                              title: `移除成员「${row.display_name || row.username}」？`,
                              content: "移除后将无法访问该团队资源。",
                              okType: "danger",
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
        </section>
      </div>

      <Modal
        title="新建团队"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        destroyOnHidden
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
            label="Slug"
            name="slug"
            rules={[
              { required: true, message: "必填，如 acme" },
              {
                pattern: /^[a-z][a-z0-9_-]*$/,
                message: "小写字母开头，可用 a-z 0-9 _ -",
              },
            ]}
            extra="用于 URL / 标识，创建后一般不再改"
          >
            <Input placeholder="acme" />
          </Form.Item>
          <Form.Item label="显示名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="Acme 团队" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={detail ? `添加成员 · ${detail.name}` : "添加成员"}
        open={memberOpen}
        onCancel={() => setMemberOpen(false)}
        destroyOnHidden
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
            <Input placeholder="alice" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建用户账号"
        open={userOpen}
        onCancel={() => setUserOpen(false)}
        destroyOnHidden
        okText="创建并添加为成员"
        onOk={() => {
          return userForm.validateFields().then(async (v) => {
            try {
              await teamsApi.createUser(v);
              setUserOpen(false);
              message.success(`已创建用户 ${v.username}`);
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
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true },
              {
                pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
                message: "字母开头，可用字母数字 _ -",
              },
            ]}
          >
            <Input placeholder="alice" />
          </Form.Item>
          <Form.Item label="显示名" name="display_name">
            <Input placeholder="Alice" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[{ required: true, min: 6, message: "至少 6 位" }]}
          >
            <Input.Password placeholder="至少 6 位" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
