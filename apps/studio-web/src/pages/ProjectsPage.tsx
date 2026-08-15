import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  List,
  Modal,
  Radio,
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
  BridgeExecutor,
  Project,
  ProjectCreate,
  ProjectRepo,
  ProjectRepoRole,
  TeamListItem,
} from "@agent-studio/agent-schema";
import { projectNeedsPreferredBridge } from "@agent-studio/agent-schema";
import { teamsApi } from "../api/auth";
import { bridgesApi } from "../api/bridges";
import { projectsApi } from "../api/projects";
import { getSelectedTeam } from "../auth/session";
import { EmptyRich, EmptyRichActionButton } from "../components/EmptyRich";

type EditorValues = {
  id: string;
  team_id: string;
  name: string;
  description?: string;
  clone_root?: string;
  preferred_bridge_id?: string;
  enabled: boolean;
  tags?: string[];
  repos: Array<{
    id: string;
    name: string;
    /** Form-only: clone from remote vs reuse local checkout. */
    source?: "remote" | "local";
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
  const [bridges, setBridges] = useState<BridgeExecutor[]>([]);
  const [form] = Form.useForm<EditorValues>();
  const reposWatch = Form.useWatch("repos", form);
  const needsBridge = useMemo(() => {
    const repos = reposWatch || [];
    return repos.some(
      (r) =>
        r?.source === "local" ||
        Boolean((r?.local_path || "").trim().match(/^([/\\]|[a-zA-Z]:[\\/])/)),
    );
  }, [reposWatch]);

  const bridgeOptions = useMemo(
    () =>
      bridges.map((b) => ({
        value: b.id,
        label: `${b.name || b.id} · ${b.status}${b.driver ? ` · ${b.driver}` : ""}`,
      })),
    [bridges],
  );

  const selected = useMemo(
    () => items.find((p) => p.id === selectedId) || null,
    [items, selectedId],
  );

  async function reload(keepId?: string | null) {
    setLoading(true);
    try {
      const currentTeam = getSelectedTeam();
      const [res, teamRes, bridgeRes] = await Promise.all([
        projectsApi.list({
          q,
          team_id: currentTeam?.id,
        }),
        teamsApi.list(),
        bridgesApi.list({ team_id: currentTeam?.id }).catch(() => ({ items: [] as BridgeExecutor[] })),
      ]);
      setItems(res.items);
      setTotal(res.total);
      setTeams(teamRes.items);
      setBridges(bridgeRes.items || []);
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
      preferred_bridge_id: "",
      enabled: true,
      tags: [],
      repos: [
        {
          id: "",
          name: "",
          source: "remote",
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
      preferred_bridge_id: project.preferred_bridge_id || "",
      enabled: project.enabled,
      tags: project.tags,
      repos: project.repos.map((r) => {
        const local = (r.local_path || "").trim();
        const remote = (r.remote_url || "").trim();
        return {
          id: r.id,
          name: r.name,
          source: (local ? "local" : "remote") as "local" | "remote",
          remote_url: remote,
          local_path: local,
          role: r.role,
          agents_md: r.agents_md,
          default_branch: r.default_branch,
          note: r.note,
        };
      }),
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    try {
      const values = await form.validateFields();
      const repos = (values.repos || []).map((r) => {
        const source = r.source === "local" ? "local" : "remote";
        const local_path = (r.local_path || "").trim();
        const remote_url = (r.remote_url || "").trim();
        if (source === "local" && !local_path) {
          throw new Error(
            `仓库 ${r.id || r.name || "?"}：本地模式必须填写本地路径`,
          );
        }
        if (source === "remote" && !remote_url) {
          throw new Error(
            `仓库 ${r.id || r.name || "?"}：克隆模式必须填写 Git remote URL`,
          );
        }
        return {
          id: r.id.trim(),
          name: r.name.trim(),
          remote_url,
          local_path: source === "local" ? local_path : local_path,
          role: r.role || "unknown",
          agents_md: (r.agents_md || "AGENTS.md").trim() || "AGENTS.md",
          default_branch: (r.default_branch || "main").trim() || "main",
          note: (r.note || "").trim(),
        };
      });
      const preferred_bridge_id = (values.preferred_bridge_id || "").trim();
      const hasLocalSource = (values.repos || []).some(
        (r) => r.source === "local",
      );
      if (
        (hasLocalSource || projectNeedsPreferredBridge({ repos })) &&
        !preferred_bridge_id
      ) {
        throw new Error("使用本地仓库路径时必须选择执行器");
      }
      const payload: ProjectCreate = {
        id: values.id.trim(),
        team_id: values.team_id,
        name: values.name.trim(),
        description: (values.description || "").trim(),
        clone_root: (values.clone_root || "").trim(),
        preferred_bridge_id,
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
                  {selected.preferred_bridge_id ? (
                    <Tag color="purple">
                      执行器 {selected.preferred_bridge_id}
                    </Tag>
                  ) : projectNeedsPreferredBridge(selected) ? (
                    <Tag color="error">本地仓库未指定执行器</Tag>
                  ) : null}
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
                  ；配置了「本地已有仓库」时直接复用该目录（须含 .git）。默认不在本仓库内：macOS/Linux 为
                  ~/AgentStudio，Windows 为 C:\.agent-studio。流水线在 Bridge
                  执行机上解析路径。
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
                      title: "来源",
                      width: 90,
                      render: (_: unknown, r: ProjectRepo) =>
                        (r.local_path || "").trim() ? (
                          <Tag color="purple">本地</Tag>
                        ) : (
                          <Tag>远程</Tag>
                        ),
                    },
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
                      render: (v: string) => v || "—",
                    },
                    {
                      title: "local",
                      dataIndex: "local_path",
                      ellipsis: true,
                      render: (v: string, r: ProjectRepo) =>
                        (v || "").trim() ||
                        `${selected.clone_root}/${r.id}`,
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
          <Form.Item
            name="preferred_bridge_id"
            label="执行器"
            required={needsBridge}
            rules={
              needsBridge
                ? [{ required: true, message: "使用本地仓库时必须选择执行器" }]
                : []
            }
            tooltip="本地目录在 Bridge 执行机上；选「使用已有本地目录」时必须指定对应执行器"
            extra={
              needsBridge
                ? "当前有仓库使用本地路径，必须指定执行器"
                : "可选；本地仓库模式下必填"
            }
          >
            <Select
              allowClear={!needsBridge}
              placeholder={
                needsBridge ? "请选择执行器" : "可选（本地仓库时必选）"
              }
              options={bridgeOptions}
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
                          name={[field.name, "source"]}
                          label="仓库来源"
                          initialValue="remote"
                          tooltip="本地模式：填写 Bridge 执行机上已 clone 的绝对路径，流水线跳过 git clone"
                        >
                          <Radio.Group
                            optionType="button"
                            buttonStyle="solid"
                            options={[
                              { value: "remote", label: "从 remote 克隆" },
                              { value: "local", label: "使用已有本地目录" },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item
                          noStyle
                          shouldUpdate={(prev, next) =>
                            prev?.repos?.[field.name]?.source !==
                            next?.repos?.[field.name]?.source
                          }
                        >
                          {() => {
                            const source =
                              form.getFieldValue([
                                "repos",
                                field.name,
                                "source",
                              ]) || "remote";
                            const isLocal = source === "local";
                            return (
                              <Row gutter={12}>
                                <Col span={24}>
                                  <Form.Item
                                    name={[field.name, "remote_url"]}
                                    label={
                                      isLocal
                                        ? "Git remote URL（可选）"
                                        : "Git remote URL"
                                    }
                                    rules={
                                      isLocal
                                        ? []
                                        : [
                                            {
                                              required: true,
                                              message: "请填写 remote URL",
                                            },
                                          ]
                                    }
                                    tooltip={
                                      isLocal
                                        ? "可选；留空则只复用本地目录，不主动 fetch"
                                        : undefined
                                    }
                                  >
                                    <Input placeholder="git@github.com:org/repo.git" />
                                  </Form.Item>
                                </Col>
                                <Col span={24}>
                                  <Form.Item
                                    name={[field.name, "local_path"]}
                                    label={
                                      isLocal
                                        ? "本地仓库路径"
                                        : "本地路径（可选）"
                                    }
                                    rules={
                                      isLocal
                                        ? [
                                            {
                                              required: true,
                                              message:
                                                "请填写已 clone 的本地绝对路径",
                                            },
                                          ]
                                        : []
                                    }
                                    tooltip={
                                      isLocal
                                        ? "须在 Bridge 执行机上存在且含 .git，例如 D:\\code\\my-app"
                                        : "留空 → {clone_root}/{repo.id}"
                                    }
                                  >
                                    <Input
                                      placeholder={
                                        isLocal
                                          ? "D:\\code\\my-app 或 /home/dev/my-app"
                                          : "相对 clone_root 或绝对路径"
                                      }
                                    />
                                  </Form.Item>
                                </Col>
                              </Row>
                            );
                          }}
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
                      source: "remote",
                      remote_url: "",
                      local_path: "",
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
