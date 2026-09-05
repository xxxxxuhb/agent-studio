import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Select,
  Space,
  Spin,
  Tree,
  Typography,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { FileOutlined, FolderOutlined, ReloadOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import type { BridgeExecutor } from "@agent-studio/agent-schema";
import {
  workspaceApi,
  type WorkspaceDescribe,
  type WorkspaceFileResult,
  type WorkspaceKind,
  type WorkspaceTreeEntry,
} from "../api/workspace";

export function monacoLanguageFromPath(filePath: string): string {
  const base = filePath.split("/").pop() || "";
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  const ext = (base.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    yml: "yaml",
    yaml: "yaml",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    xml: "xml",
    toml: "ini",
    env: "ini",
    svg: "xml",
  };
  return map[ext] || "plaintext";
}

function toNodes(entries: WorkspaceTreeEntry[], parent: string): DataNode[] {
  return entries.map((e) => ({
    title: e.name,
    key: parent ? `${parent}/${e.name}` : e.name,
    isLeaf: e.type === "file",
    icon: e.type === "dir" ? <FolderOutlined /> : <FileOutlined />,
  }));
}

function attachChildren(
  nodes: DataNode[],
  key: string,
  children: DataNode[],
): DataNode[] {
  return nodes.map((n) => {
    if (String(n.key) === key) return { ...n, children };
    if (n.children) {
      return { ...n, children: attachChildren(n.children, key, children) };
    }
    return n;
  });
}

type Props = {
  kind: WorkspaceKind;
  id: string;
  defaultRepoId?: string;
  defaultBridgeId?: string;
  bridges?: BridgeExecutor[];
};

/** Read-only file tree + Monaco for a Bridge-hosted workspace. */
export function WorkspaceCodePanel({
  kind,
  id,
  defaultRepoId,
  defaultBridgeId,
  bridges = [],
}: Props) {
  const [meta, setMeta] = useState<WorkspaceDescribe | null>(null);
  const [bridgeId, setBridgeId] = useState(defaultBridgeId || "");
  const [repoId, setRepoId] = useState(defaultRepoId || "");
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [file, setFile] = useState<WorkspaceFileResult | null>(null);
  const [activePath, setActivePath] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [missingWorkspace, setMissingWorkspace] = useState(false);
  const [error, setError] = useState("");

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError("");
    try {
      const desc = await workspaceApi.describe(kind, id, bridgeId || undefined);
      setMeta(desc);
      setRepoId((prev) => prev || desc.default_repo_id || desc.repos[0]?.repo_id || "");
      if (!bridgeId && desc.bridge?.id) setBridgeId(desc.bridge.id);
    } catch (err) {
      setMeta(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMeta(false);
    }
  }, [kind, id, bridgeId]);

  const loadTree = useCallback(
    async (nextRepo: string) => {
      if (!nextRepo) {
        setTreeData([]);
        return;
      }
      setLoadingTree(true);
      setMissingWorkspace(false);
      setError("");
      setFile(null);
      setActivePath("");
      try {
        const res = await workspaceApi.tree(kind, id, {
          repoId: nextRepo,
          bridgeId: bridgeId || undefined,
        });
        setTreeData(toNodes(res.entries || [], ""));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTreeData([]);
        if (/尚未在该执行器上准备|workspace not found/i.test(msg)) {
          setMissingWorkspace(true);
        } else {
          setError(msg);
        }
      } finally {
        setLoadingTree(false);
      }
    },
    [kind, id, bridgeId],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!repoId || loadingMeta) return;
    void loadTree(repoId);
  }, [repoId, loadTree, loadingMeta]);

  async function onLoadData(node: DataNode) {
    const key = String(node.key);
    const res = await workspaceApi.tree(kind, id, {
      repoId,
      path: key,
      bridgeId: bridgeId || undefined,
    });
    setTreeData((prev) => attachChildren(prev, key, toNodes(res.entries || [], key)));
  }

  async function openFile(path: string) {
    setLoadingFile(true);
    setError("");
    setActivePath(path);
    try {
      const res = await workspaceApi.file(kind, id, {
        repoId,
        path,
        bridgeId: bridgeId || undefined,
      });
      setFile(res);
    } catch (err) {
      setFile(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFile(false);
    }
  }

  async function prepare() {
    setPreparing(true);
    setError("");
    try {
      await workspaceApi.prepare(kind, id, bridgeId || undefined);
      setMissingWorkspace(false);
      await loadMeta();
      if (repoId) await loadTree(repoId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparing(false);
    }
  }

  const bridgeLabel = meta?.bridge
    ? `${meta.bridge.name || meta.bridge.id}${
        meta.bridge.driver ? ` · ${meta.bridge.driver}` : ""
      }`
    : "未指定执行器";

  const bridgeOptions = useMemo(
    () =>
      bridges.map((b) => ({
        value: b.id,
        label: `${b.name || b.id} · ${b.driver || "?"} · ${b.status}`,
      })),
    [bridges],
  );

  const repoOptions = (meta?.repos || []).map((r) => ({
    value: r.repo_id,
    label: r.name ? `${r.name} (${r.repo_id})` : r.repo_id,
  }));

  return (
    <div className="workspace-code-shell">
      <div className="workspace-code-toolbar">
        <Space wrap size={[8, 8]}>
          {bridgeOptions.length ? (
            <Select
              size="small"
              style={{ minWidth: 220 }}
              placeholder="执行器"
              value={bridgeId || undefined}
              options={bridgeOptions}
              onChange={(v) => {
                setBridgeId(v);
                setRepoId("");
              }}
              allowClear
            />
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {bridgeLabel}
            </Typography.Text>
          )}
          <Select
            size="small"
            style={{ minWidth: 180 }}
            placeholder="仓库"
            value={repoId || undefined}
            options={repoOptions}
            onChange={setRepoId}
            disabled={!repoOptions.length}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              void loadMeta();
              if (repoId) void loadTree(repoId);
            }}
          >
            刷新
          </Button>
        </Space>
        {activePath ? (
          <Typography.Text code style={{ fontSize: 12 }} ellipsis>
            {activePath}
          </Typography.Text>
        ) : null}
      </div>

      {meta?.hint ? (
        <Alert type="info" showIcon title={meta.hint} style={{ marginBottom: 8 }} />
      ) : null}
      {error ? (
        <Alert type="error" showIcon title={error} style={{ marginBottom: 8 }} />
      ) : null}

      {loadingMeta ? (
        <div className="workspace-code-empty">
          <Spin />
        </div>
      ) : !meta?.repos.length ? (
        <Empty description={meta?.hint || "没有可浏览的仓库"} />
      ) : missingWorkspace ? (
        <div className="workspace-code-empty">
          <Empty description="工作区尚未在该执行器上准备" />
          <Button type="primary" loading={preparing} onClick={() => void prepare()}>
            在执行器上准备
          </Button>
        </div>
      ) : (
        <div className="workspace-code-panel">
          <div className="workspace-code-tree">
            {loadingTree ? (
              <Spin />
            ) : (
              <Tree
                showIcon
                blockNode
                virtual={false}
                treeData={treeData}
                loadData={(node) => onLoadData(node)}
                onSelect={(keys, info) => {
                  if (info.node.isLeaf && keys[0]) {
                    void openFile(String(keys[0]));
                  }
                }}
              />
            )}
          </div>
          <div className="workspace-code-main">
            {loadingFile ? (
              <div className="workspace-code-empty">
                <Spin />
              </div>
            ) : file?.binary ? (
              <Empty description={`二进制文件，无法预览（${file.bytes} 字节）`} />
            ) : file?.truncated ? (
              <Empty description={`文件过大，无法预览（${file.bytes} 字节）`} />
            ) : file?.content != null ? (
              <div className="workspace-code-main__editor">
                <Editor
                  height="100%"
                  language={monacoLanguageFromPath(file.path)}
                  value={file.content}
                  theme="vs"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    fontSize: 13,
                    automaticLayout: true,
                  }}
                />
              </div>
            ) : (
              <Empty description="选择左侧文件查看代码" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
