import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CloudDownloadOutlined,
  FolderOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  Project,
  ProjectCreate,
  ProjectRepo,
  ProjectRepoRole,
  TeamListItem,
} from "@agent-studio/agent-schema";
import { teamsApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { getSelectedTeam } from "../auth/session";
import { EmptyRich, EmptyRichActionButton } from "../components/EmptyRich";

type EditorValues = {
  id: string;
  team_id: string;
  name: string;
  description?: string;
  clone_root?: string;
  enabled: boolean;
  tags?: string[];
  repos: Array<{
    id: string;
    name: string;
    remote_url: string;
    local_path?: string;
    role: ProjectRepoRole;
    agents_md?: string;
    default_branch?: string;
    note?: string;
  }>;
};

const ROLE_OPTIONS: { value: ProjectRepoRole; label: string }[] = [
  { value: "frontend", label: "frontend" },
  { value: "backend", label: "backend" },
  { value: "fullstack", label: "fullstack" },
  { value: "docs", label: "docs" },
  { value: "infra", label: "infra" },
  { value: "unknown", label: "unknown" },
];

function cloneStatusColor(status?: string) {
  if (status === "ready") return "success";
  if (status === "error") return "error";
  if (status === "missing") return "warning";
  return "default";
}

export function ProjectsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [defaultCloneRoot, setDefaultCloneRoot] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<EditorValues>();

  const selected = useMemo(
    () => items.find((p) => p.id === selectedId) || null,
    [items, selectedId],
  );

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const currentTeam = getSelectedTeam();
      const [res, teamRes] = await Promise.all([
        projectsApi.list({
          q,
          team_id: currentTeam?.id,
        }),
        teamsApi.list(),
      ]);
      setItems(res.items);
      setTotal(res.total);
      setTeams(teamRes.items);
      if (res.default_clone_root) setDefaultCloneRoot(res.default_clone_root);
      const nextId = keepId === undefined ? selectedId : keepId;
      if (nextId && !res.items.some((p) => p.id === nextId)) {
        setSelectedId(null);
      } else if (nextId) {
        setSelectedId(nextId);
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
  }, [q]);

  function openCreate() {
    setEditingId(null);
    const currentTeam = getSelectedTeam();
    form.setFieldsValue({
      id: "",
      team_id: currentTeam?.id || teams[0]?.id || "",
      name: "",
      description: "",
      clone_root: "",
      enabled: true,
      tags: [],
      repos: [
        {
          id: "",
          name: "",
          remote_url: "",
          local_path: "",
          role: "unknown",
          agents_md: "AGENTS.md",
          default_branch: "main",
          note: "",
        },
      ],
    });
    setEditorOpen(true);
  }

  function openEdit(project: Project) {
    setEditingId(project.id);
    form.setFieldsValue({
      id: project.id,
      team_id: project.team_id,
      name: project.name,
      description: project.description,
      clone_root: project.clone_root,
      enabled: project.enabled,
      tags: project.tags,
      repos: project.repos.map((r) => ({
        id: r.id,
        name: r.name,
        remote_url: r.remote_url,
        local_path: r.local_path,
        role: r.role,
        agents_md: r.agents_md,
        default_branch: r.default_branch,
        note: r.note,
      })),
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    try {
      const values = await form.validateFields();
      const repos = (values.repos || []).map((r) => ({
        id: r.id.trim(),
        name: r.name.trim(),
        remote_url: r.remote_url.trim(),
        local_path: (r.local_path || "").trim(),
        role: r.role || "unknown",
        agents_md: (r.agents_md || "AGENTS.md").trim() || "AGENTS.md",
        default_branch: (r.default_branch || "main").trim() || "main",
        note: (r.note || "").trim(),
      }));
      const payload: ProjectCreate = {
        id: values.id.trim(),
        team_id: values.team_id,
        name: values.name.trim(),
        description: (values.description || "").trim(),
        clone_root: (values.clone_root || "").trim(),
        enabled: values.enabled !== false,
        tags: values.tags || [],
        repos,
      };
      if (editingId) {
        const { team_id: _team, id: _id, ...rest } = payload;
        await projectsApi.update(editingId, rest);
        message.success("项目已更新");
        setSelectedId(editingId);
      } else {
        const created = await projectsApi.create(payload);
        message.success("项目已创建");
        setSelectedId(created.id);
      }
      setEditorOpen(false);
      await reload(editingId || payload.id);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function cloneSelected() {
    if (!selected) return;
    setCloning(true);
    try {
      const updated = await projectsApi.clone(selected.id);
      message.success("克隆完成（已存在则跳过）");
      await reload(updated.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    Modal.confirm({
      title: `确认删除项目「${selected.name}」？`,
      content: "仅删除 Studio 配置，不会删除已克隆的本地目录。",
      okType: "danger",
      onOk: async () => {
        await projectsApi.remove(selected.id);
        message.success("已删除");
        setSelectedId(null);
        await reload(null);
      },
    });
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <div className="page-toolbar-filters">
          <Input.Search
            placeholder="搜索项目"
            allowClear
            style={{ width: 240 }}
            onSearch={setQ}
          />
          <span className="page-meta">共 {total} 个</span>
        </div>
        <div className="page-toolbar-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建项目
          </Button>
        </div>
      </div>

      <div className="page-split">
        <aside className="pane">
          <Card size="small" title="项目列表" loading={loading} className="pane-card">
            {items.length ? (
              <List
                dataSource={items}
                renderItem={(p) => (
                  <List.Item
                    className={`list-item-clickable${p.id === selectedId ? " list-item-active" : ""}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          {p.name}
                          {!p.enabled ? <Tag>停用</Tag> : null}
                        </Space>
                      }
                      description={`${p.id} · ${p.repos.length} 仓 · ${p.clone_root}`}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <EmptyRich
                icon={<FolderOutlined />}
                title="还没有项目"
                description="把多仓工作区配成项目，工单可绑定项目做选仓。"
                action={
                  <EmptyRichActionButton icon={<PlusOutlined />} onClick={openCreate}>
                    新建项目
                  </EmptyRichActionButton>
                }
              />
            )}
          </Card>
        </aside>

        <section className="pane">
          <Card
            size="small"
            className="pane-card"
            title={selected ? selected.name : "详情"}
            extra={
              selected ? (
                <Space>
                  <Button
                    icon={<CloudDownloadOutlined />}
                    loading={cloning}
                    onClick={() => void cloneSelected()}
                  >
                    克隆/同步
                  </Button>
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => openEdit(selected)}
                  >
                    编辑
                  </Button>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => void removeSelected()}
                  >
                    删除
                  </Button>
                </Space>
              ) : null
            }
          >
            {!selected ? (
              <EmptyRich
                icon={<FolderOutlined />}
                title="选择左侧项目"
                description="查看仓库、克隆路径，或编辑项目配置。"
              />
            ) : (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {selected.description || "无描述"}
                </Typography.Paragraph>
                <Space wrap>
                  <Tag>id: {selected.id}</Tag>
                  <Tag color="blue">
                    团队{" "}
                    {teams.find((t) => t.id === selected.team_id)?.name ||
                      selected.team_id}
                  </Tag>
                  <Tag color={selected.enabled ? "green" : "default"}>
                    {selected.enabled ? "启用" : "停用"}
                  </Tag>
                  {(selected.tags || []).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
                <Typography.Text>
                  克隆根目录：
                  <Typography.Text code copyable>
                    {selected.clone_root}
                  </Typography.Text>
                </Typography.Text>
                <Typography.Text type="secondary">
                  空路径则使用{" "}
                  <Typography.Text code>
                    {defaultCloneRoot || "~/AgentStudio"}/{`{project.id}`}
                  </Typography.Text>
                  ；已存在且含 .git 的目录会跳过 clone。默认不在本仓库内：macOS/Linux 为
                  ~/AgentStudio（Finder：用户 → 账号 → AgentStudio），Windows 为 C:\.agent-studio。
                </Typography.Text>
                <Table<ProjectRepo>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={selected.repos}
                  columns={[
                    { title: "ID", dataIndex: "id", width: 120 },
                    { title: "名称", dataIndex: "name" },
                    { title: "角色", dataIndex: "role", width: 100 },
                    {
                      title: "状态",
                      dataIndex: "clone_status",
                      width: 90,
                      render: (v: string) => (
                        <Tag color={cloneStatusColor(v)}>{v || "pending"}</Tag>
                      ),
                    },
                    {
                      title: "remote",
                      dataIndex: "remote_url",
                      ellipsis: true,
                    },
                    {
                      title: "local",
                      dataIndex: "local_path",
                      ellipsis: true,
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (r) => (
                      <Space direction="vertical" size={4}>
                        {r.clone_error ? (
                          <Typography.Text type="danger">
                            {r.clone_error}
                          </Typography.Text>
                        ) : null}
                        <Typography.Text type="secondary">
                          agents: {r.agents_md || "AGENTS.md"} · branch:{" "}
                          {r.default_branch || "main"}
                          {r.note ? ` · ${r.note}` : ""}
                        </Typography.Text>
                      </Space>
                    ),
                  }}
                />
              </Space>
            )}
          </Card>
        </section>
      </div>

      <Modal
        title={editingId ? `编辑 ${editingId}` : "新建项目"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveEditor()}
        width={860}
        destroyOnHidden
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="team_id"
            label="所属团队"
            rules={[{ required: true, message: "请选择团队" }]}
            extra="当前工作台团队（不可跨团队创建）"
          >
            <Select
              disabled
              options={teams.map((t) => ({
                value: t.id,
                label: `${t.name} (${t.slug})`,
              }))}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="id"
                label="项目 ID"
                rules={[
                  { required: true },
                  {
                    pattern: /^[a-z][a-z0-9_-]*$/,
                    message: "小写字母开头的 snake_case",
                  },
                ]}
              >
                <Input disabled={Boolean(editingId)} placeholder="my_app" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input placeholder="我的应用" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="clone_root"
            label="克隆根目录"
            tooltip={
              defaultCloneRoot
                ? `留空则用系统默认：${defaultCloneRoot}/{project.id}`
                : "留空则用系统默认（macOS/Linux: ~/AgentStudio，Windows: C:\\.agent-studio）"
            }
          >
            <Input
              placeholder={
                defaultCloneRoot
                  ? `留空 → ${defaultCloneRoot}/{id}`
                  : "/abs/path/to/repos 或留空"
              }
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tags" label="标签">
                <Select mode="tags" placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>

          <Typography.Title level={5}>Git 仓库</Typography.Title>
          <Form.List name="repos">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {fields.map((field) => (
                  <Card
                    key={field.key}
                    size="small"
                    type="inner"
                    title={`仓库 #${field.name + 1}`}
                    extra={
                      fields.length > 1 ? (
                        <Button
                          type="link"
                          danger
                          onClick={() => remove(field.name)}
                        >
                          移除
                        </Button>
                      ) : null
                    }
                  >
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "id"]}
                          label="repo id"
                          rules={[
                            { required: true },
                            {
                              pattern: /^[a-z][a-z0-9_-]*$/,
                              message: "snake_case",
                            },
                          ]}
                        >
                          <Input placeholder="frontend" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "name"]}
                          label="名称"
                          rules={[{ required: true }]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...field}
                          name={[field.name, "role"]}
                          label="角色"
                          initialValue="unknown"
                        >
                          <Select options={ROLE_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item
                          {...field}
                          name={[field.name, "remote_url"]}
                          label="Git remote URL"
                          rules={[{ required: true }]}
                        >
                          <Input placeholder="git@github.com:org/repo.git" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          {...field}
                          name={[field.name, "local_path"]}
                          label="本地路径（可选）"
                          tooltip="留空 → {clone_root}/{repo.id}"
                        >
                          <Input placeholder="相对 clone_root 或绝对路径" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...field}
                          name={[field.name, "default_branch"]}
                          label="分支"
                          initialValue="main"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...field}
                          name={[field.name, "agents_md"]}
                          label="AGENTS.md"
                          initialValue="AGENTS.md"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      id: "",
                      name: "",
                      remote_url: "",
                      role: "unknown",
                      agents_md: "AGENTS.md",
                      default_branch: "main",
                    })
                  }
                >
                  添加仓库
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
