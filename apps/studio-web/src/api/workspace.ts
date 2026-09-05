import { get, post } from "../http";

export type WorkspaceKind = "work-order" | "project";

export type WorkspaceRepoMeta = {
  repo_id: string;
  name: string;
  role: string;
};

export type WorkspaceBridgeMeta = {
  id: string;
  name: string;
  status: string;
  driver: string;
  online: boolean;
};

export type WorkspaceDescribe = {
  kind: WorkspaceKind;
  id: string;
  project_id: string;
  bridge: WorkspaceBridgeMeta | null;
  repos: WorkspaceRepoMeta[];
  default_repo_id: string;
  hint?: string;
};

export type WorkspaceTreeEntry = {
  name: string;
  type: "dir" | "file";
  bytes?: number;
  updated_at?: string;
};

export type WorkspaceTreeResult = {
  project_id: string;
  repo_id: string;
  path: string;
  entries: WorkspaceTreeEntry[];
};

export type WorkspaceFileResult = {
  project_id: string;
  repo_id: string;
  path: string;
  name: string;
  bytes: number;
  updated_at: string;
  content_type: string;
  content?: string;
  binary?: boolean;
  truncated?: boolean;
};

export type WorkspacePrepareResult = {
  project_id: string;
  bridge: WorkspaceBridgeMeta | null;
  repos: Array<{
    repo_id: string;
    clone_status: string;
    clone_error: string;
  }>;
};

function prefix(kind: WorkspaceKind, id: string) {
  const enc = encodeURIComponent(id);
  return kind === "work-order"
    ? `/work-orders/${enc}/workspace`
    : `/projects/${enc}/workspace`;
}

function params(q: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v) out[k] = v;
  }
  return out;
}

export const workspaceApi = {
  describe(kind: WorkspaceKind, id: string, bridgeId?: string) {
    return get<WorkspaceDescribe>(prefix(kind, id), {
      params: params({ bridge_id: bridgeId }),
    });
  },
  tree(
    kind: WorkspaceKind,
    id: string,
    query: { repoId?: string; path?: string; bridgeId?: string },
  ) {
    return get<WorkspaceTreeResult>(`${prefix(kind, id)}/tree`, {
      params: params({
        repo_id: query.repoId,
        path: query.path,
        bridge_id: query.bridgeId,
      }),
    });
  },
  file(
    kind: WorkspaceKind,
    id: string,
    query: { repoId?: string; path?: string; bridgeId?: string },
  ) {
    return get<WorkspaceFileResult>(`${prefix(kind, id)}/file`, {
      params: params({
        repo_id: query.repoId,
        path: query.path,
        bridge_id: query.bridgeId,
      }),
    });
  },
  prepare(kind: WorkspaceKind, id: string, bridgeId?: string) {
    return post<WorkspacePrepareResult>(
      `${prefix(kind, id)}/prepare`,
      { bridge_id: bridgeId },
      { timeout: 180_000 },
    );
  },
};
