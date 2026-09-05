import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  Project,
  WorkOrder,
  WorkOrderRepoTarget,
} from "@agent-studio/agent-schema";
import { bridgeAuthHeaders } from "../bridges/bridge-http";
import { BridgesService } from "../bridges/bridges.service";
import { ProjectsService } from "../projects/projects.service";
import { StudioConfigService } from "../studio-config/studio-config.service";
import { ensureWorkspaceViaBridge } from "../work-orders/work-order-routing";
import { resolveStudioBridgeBase } from "../work-orders/work-order-bridge-utils";
import { WorkOrdersService } from "../work-orders/work-orders.service";

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
  kind: "work-order" | "project";
  id: string;
  project_id: string;
  bridge: WorkspaceBridgeMeta | null;
  repos: WorkspaceRepoMeta[];
  default_repo_id: string;
  hint?: string;
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

export function sanitizeRelPath(raw?: string): string {
  const s = String(raw || "")
    .trim()
    .replace(/\\/g, "/");
  if (!s || s === ".") return "";
  if (s.includes("\0") || s.startsWith("/")) {
    throw new BadRequestException("非法路径");
  }
  const parts: string[] = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new BadRequestException("非法路径");
    parts.push(part);
  }
  return parts.join("/");
}

export function buildBridgeWorkspaceUrl(
  bridgeBase: string,
  kind: "tree" | "file",
  query: {
    project_id: string;
    repo_id: string;
    path?: string;
    local_path?: string;
  },
): string {
  const base = bridgeBase.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("project_id", query.project_id);
  params.set("repo_id", query.repo_id);
  if (query.path) params.set("path", query.path);
  if (query.local_path) params.set("local_path", query.local_path);
  return `${base}/workspace/${kind}?${params.toString()}`;
}

function repoRootFromTarget(t: WorkOrderRepoTarget): string {
  const local = (t.local_path || "").trim();
  if (local) return local;
  const md = (t.agents_md_path || "").trim();
  if (md) {
    const cut = Math.max(md.lastIndexOf("/"), md.lastIndexOf("\\"));
    return cut > 0 ? md.slice(0, cut) : "";
  }
  return "";
}

@Injectable()
export class WorkspaceBrowseService {
  private readonly logger = new Logger(WorkspaceBrowseService.name);

  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly projects: ProjectsService,
    private readonly bridges: BridgesService,
    private readonly studioConfig: StudioConfigService,
  ) {}

  async describeWorkOrder(
    userId: string,
    workOrderId: string,
    bridgeId?: string,
  ): Promise<WorkspaceDescribe> {
    const order = await this.workOrders.getForUser(userId, workOrderId);
    const project = await this.optionalProject(userId, order.project_id);
    const repos = this.reposForWorkOrder(order, project);
    const resolved = await this.resolveBridge({
      userId,
      teamId: order.team_id,
      preferredId:
        (bridgeId || "").trim() ||
        (order.run?.studio?.bridge_id || "").trim() ||
        (order.preferred_bridge_id || "").trim() ||
        (project?.preferred_bridge_id || "").trim(),
    });
    const defaultRepo =
      repos[
        Math.min(
          order.run?.current_repo_index ?? 0,
          Math.max(repos.length - 1, 0),
        )
      ]?.repo_id ||
      repos[0]?.repo_id ||
      "";
    return {
      kind: "work-order",
      id: order.id,
      project_id: (order.project_id || "").trim(),
      bridge: resolved.meta,
      repos,
      default_repo_id: defaultRepo,
      hint: this.describeHint(resolved.meta, repos, project),
    };
  }

  async describeProject(
    userId: string,
    projectId: string,
    bridgeId?: string,
  ): Promise<WorkspaceDescribe> {
    const project = await this.projects.getForUser(userId, projectId);
    const repos = this.reposForProject(project);
    const resolved = await this.resolveBridge({
      userId,
      teamId: project.team_id,
      preferredId:
        (bridgeId || "").trim() || (project.preferred_bridge_id || "").trim(),
    });
    return {
      kind: "project",
      id: project.id,
      project_id: project.id,
      bridge: resolved.meta,
      repos,
      default_repo_id: repos[0]?.repo_id || "",
      hint: this.describeHint(resolved.meta, repos, project),
    };
  }

  async treeWorkOrder(
    userId: string,
    workOrderId: string,
    query: { repo_id?: string; path?: string; bridge_id?: string },
  ) {
    const ctx = await this.workOrderContext(userId, workOrderId, query);
    return this.proxy(ctx, "tree", query.path);
  }

  async fileWorkOrder(
    userId: string,
    workOrderId: string,
    query: { repo_id?: string; path?: string; bridge_id?: string },
  ) {
    const ctx = await this.workOrderContext(userId, workOrderId, query);
    return this.proxy(ctx, "file", query.path);
  }

  async treeProject(
    userId: string,
    projectId: string,
    query: { repo_id?: string; path?: string; bridge_id?: string },
  ) {
    const ctx = await this.projectContext(userId, projectId, query);
    return this.proxy(ctx, "tree", query.path);
  }

  async fileProject(
    userId: string,
    projectId: string,
    query: { repo_id?: string; path?: string; bridge_id?: string },
  ) {
    const ctx = await this.projectContext(userId, projectId, query);
    return this.proxy(ctx, "file", query.path);
  }

  async prepareWorkOrder(
    userId: string,
    workOrderId: string,
    bridgeId?: string,
  ): Promise<WorkspacePrepareResult> {
    const order = await this.workOrders.getForUser(userId, workOrderId);
    const projectId = (order.project_id || "").trim();
    if (!projectId) {
      throw new BadRequestException("工单未绑定项目，无法在执行器上准备工作区");
    }
    return this.prepareProject(userId, projectId, {
      bridgeId:
        (bridgeId || "").trim() ||
        (order.run?.studio?.bridge_id || "").trim() ||
        (order.preferred_bridge_id || "").trim(),
    });
  }

  async prepareProject(
    userId: string,
    projectId: string,
    opts: { bridgeId?: string } = {},
  ): Promise<WorkspacePrepareResult> {
    const project = await this.projects.getForUser(userId, projectId);
    const resolved = await this.requireBridge({
      userId,
      teamId: project.team_id,
      preferredId:
        (opts.bridgeId || "").trim() ||
        (project.preferred_bridge_id || "").trim(),
    });
    const catalog = await this.projects.catalogForManager(userId, projectId);
    const ensured = await ensureWorkspaceViaBridge(
      { logger: this.logger },
      {
        bridgeBase: resolved.baseUrl,
        projectId: project.id,
        projectName: project.name,
        repos: catalog.repos.map((r) => ({
          id: r.id,
          remote_url: r.remote_url,
          local_path: r.configured_local_path || undefined,
          name: r.name,
          role: r.role,
          default_branch: r.default_branch,
          note: r.note,
          agents_md: r.agents_md,
        })),
      },
    );
    return {
      project_id: project.id,
      bridge: resolved.meta,
      repos: ensured.map((r) => ({
        repo_id: r.id,
        clone_status: r.clone_status,
        clone_error: r.clone_error || "",
      })),
    };
  }

  private async workOrderContext(
    userId: string,
    workOrderId: string,
    query: { repo_id?: string; bridge_id?: string },
  ) {
    const order = await this.workOrders.getForUser(userId, workOrderId);
    const project = await this.optionalProject(userId, order.project_id);
    const projectId = (order.project_id || project?.id || "").trim();
    if (!projectId) {
      throw new BadRequestException("工单未绑定项目，无法浏览工作区");
    }
    const resolved = await this.requireBridge({
      userId,
      teamId: order.team_id,
      preferredId:
        (query.bridge_id || "").trim() ||
        (order.run?.studio?.bridge_id || "").trim() ||
        (order.preferred_bridge_id || "").trim() ||
        (project?.preferred_bridge_id || "").trim(),
    });
    const repoId = this.pickRepoId(
      query.repo_id,
      this.reposForWorkOrder(order, project),
    );
    const localPath = this.localPathForWorkOrder(order, project, repoId);
    return {
      bridgeBase: resolved.baseUrl,
      projectId,
      repoId,
      localPath,
    };
  }

  private async projectContext(
    userId: string,
    projectId: string,
    query: { repo_id?: string; bridge_id?: string },
  ) {
    const project = await this.projects.getForUser(userId, projectId);
    const resolved = await this.requireBridge({
      userId,
      teamId: project.team_id,
      preferredId:
        (query.bridge_id || "").trim() ||
        (project.preferred_bridge_id || "").trim(),
    });
    const repos = this.reposForProject(project);
    const repoId = this.pickRepoId(query.repo_id, repos);
    const localPath = this.configuredLocalPath(project, repoId);
    return {
      bridgeBase: resolved.baseUrl,
      projectId: project.id,
      repoId,
      localPath,
    };
  }

  private async proxy(
    ctx: {
      bridgeBase: string;
      projectId: string;
      repoId: string;
      localPath: string;
    },
    kind: "tree" | "file",
    rawPath?: string,
  ) {
    const rel = sanitizeRelPath(rawPath);
    if (kind === "file" && !rel) {
      throw new BadRequestException("缺少文件路径");
    }
    const url = buildBridgeWorkspaceUrl(ctx.bridgeBase, kind, {
      project_id: ctx.projectId,
      repo_id: ctx.repoId,
      path: rel || undefined,
      local_path: ctx.localPath || undefined,
    });
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: bridgeAuthHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new NotFoundException(
          "工作区尚未在该执行器上准备。可点击「在执行器上准备」。",
        );
      }
      if (!res.ok) {
        let message = text.slice(0, 300) || `Bridge HTTP ${res.status}`;
        try {
          const body = JSON.parse(text) as { message?: string };
          if (body.message) message = body.message;
        } catch {
          /* keep */
        }
        throw new BadRequestException(`无法读取工作区：${message}`);
      }
      return JSON.parse(text) as unknown;
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`workspace ${kind} failed: ${msg}`);
      throw new BadRequestException(
        `无法连接执行器工作区（${ctx.bridgeBase}）。请确认 Bridge 在线且对 Studio 可达。详情：${msg}`,
      );
    }
  }

  private reposForWorkOrder(
    order: WorkOrder,
    project: Project | null,
  ): WorkspaceRepoMeta[] {
    const targets = order.run?.repo_targets || [];
    if (targets.length) {
      return targets.map((t) => ({
        repo_id: t.repo_id,
        name: t.name || t.repo_id,
        role: t.role || "",
      }));
    }
    return project ? this.reposForProject(project) : [];
  }

  private reposForProject(project: Project): WorkspaceRepoMeta[] {
    return (project.repos || []).map((r) => ({
      repo_id: r.id,
      name: r.name || r.id,
      role: r.role || "",
    }));
  }

  private pickRepoId(requested: string | undefined, repos: WorkspaceRepoMeta[]) {
    const id = (requested || "").trim();
    if (id) {
      if (!repos.some((r) => r.repo_id === id)) {
        throw new BadRequestException(`未知仓库: ${id}`);
      }
      return id;
    }
    if (!repos.length) throw new BadRequestException("没有可浏览的仓库");
    return repos[0]!.repo_id;
  }

  private localPathForWorkOrder(
    order: WorkOrder,
    project: Project | null,
    repoId: string,
  ): string {
    const target = (order.run?.repo_targets || []).find(
      (t) => t.repo_id === repoId,
    );
    if (target) {
      const fromTarget = repoRootFromTarget(target);
      if (fromTarget) return fromTarget;
    }
    return project ? this.configuredLocalPath(project, repoId) : "";
  }

  private configuredLocalPath(project: Project, repoId: string): string {
    const repo = (project.repos || []).find((r) => r.id === repoId);
    return (repo?.local_path || "").trim();
  }

  private async optionalProject(
    userId: string,
    projectId: string | undefined,
  ): Promise<Project | null> {
    const id = (projectId || "").trim();
    if (!id) return null;
    try {
      return await this.projects.getForUser(userId, id);
    } catch {
      return null;
    }
  }

  private describeHint(
    bridge: WorkspaceBridgeMeta | null,
    repos: WorkspaceRepoMeta[],
    project: Project | null,
  ): string | undefined {
    if (!repos.length) {
      return project
        ? "项目未配置仓库"
        : "工单未绑定项目且无选仓，无法浏览代码";
    }
    if (!bridge) {
      return "没有在线执行器。请先启动 Bridge，或在项目上指定执行器。";
    }
    if (!bridge.online) {
      return `执行器 ${bridge.name || bridge.id} 当前 ${bridge.status}，可能无法读取工作区。`;
    }
    return undefined;
  }

  private async requireBridge(opts: {
    userId: string;
    teamId?: string;
    preferredId?: string;
  }): Promise<{ baseUrl: string; meta: WorkspaceBridgeMeta }> {
    const resolved = await this.resolveBridge(opts);
    if (!resolved.baseUrl) {
      throw new BadRequestException(
        "没有在线执行器。请启动 Bridge 并完成注册，或在项目/工单上指定执行器。",
      );
    }
    if (resolved.meta && !resolved.meta.online) {
      throw new BadRequestException(
        `执行器 ${resolved.meta.name || resolved.meta.id} 当前离线，无法读取云上代码。`,
      );
    }
    return {
      baseUrl: resolved.baseUrl,
      meta:
        resolved.meta || {
          id: "",
          name: resolved.baseUrl,
          status: "unknown",
          driver: "",
          online: true,
        },
    };
  }

  private async resolveBridge(opts: {
    userId: string;
    teamId?: string;
    preferredId?: string;
  }): Promise<{ baseUrl: string; meta: WorkspaceBridgeMeta | null }> {
    const preferredId = (opts.preferredId || "").trim();
    const teamId = (opts.teamId || "").trim();
    const configured = this.studioConfig.getEffectiveForTeam(teamId)
      .bridge_base_url;

    if (preferredId) {
      try {
        const bridge = await this.bridges.getForUser(opts.userId, preferredId);
        const online =
          bridge.status === "online" || bridge.status === "busy";
        const baseUrl = resolveStudioBridgeBase({
          registeredBaseUrl: bridge.base_url,
          configured,
        });
        return {
          baseUrl,
          meta: {
            id: bridge.id,
            name: bridge.name || bridge.id,
            status: bridge.status || "",
            driver: bridge.driver || "",
            online,
          },
        };
      } catch {
        /* fall through to pool */
      }
    }

    const picked = await this.bridges.pickRegisteredExecutor({ teamId });
    if (picked) {
      return {
        baseUrl: resolveStudioBridgeBase({
          registeredBaseUrl: picked.base_url,
          configured,
        }),
        meta: {
          id: picked.id,
          name: picked.name || picked.id,
          status: picked.status || "",
          driver: picked.driver || "",
          online:
            picked.status === "online" || picked.status === "busy",
        },
      };
    }

    const fallback = resolveStudioBridgeBase({ configured });
    return { baseUrl: fallback, meta: null };
  }
}
