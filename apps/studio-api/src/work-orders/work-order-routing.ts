import { BadRequestException, Logger } from "@nestjs/common";
import type { WorkOrder, WorkOrderRepoTarget } from "@agent-studio/agent-schema";
import { bridgeAuthHeaders } from "../bridges/bridge-http";
import type { ProjectsService } from "../projects/projects.service";
import {
  type ProjectRouting,
  resolveStudioBridgeBase,
} from "./work-order-bridge-utils";

/** Minimal config surface used for Bridge URL / AGENTS.md defaults. */
export type StudioBridgeConfigLike = {
  getEffectiveForTeam(teamId: string): {
    agents_md_path?: string;
    bridge_base_url?: string;
  };
};

export type PrepareProjectRoutingDeps = {
  projects: ProjectsService;
  studioConfig: StudioBridgeConfigLike;
  logger: Logger;
  /** Registered online/busy Bridge public URL (preferred over settings). */
  registeredBridgeBaseUrl?: string;
};

type CatalogRepo = {
  id: string;
  name: string;
  role: string;
  remote_url: string;
  local_path: string;
  agents_md_path: string;
  clone_status?: string;
  default_branch?: string;
  note?: string;
};

type BridgeWorkspaceRepo = {
  id: string;
  name?: string;
  role?: string;
  remote_url?: string;
  local_path: string;
  agents_md_path: string;
  clone_status: "ready" | "error" | string;
  clone_error?: string;
  note?: string;
};

/**
 * Ask Bridge to own the workspace (clone under BRIDGE_REPOS_DIR) and return
 * Bridge-local paths. Studio disk clones are not used for routing/execution.
 */
export async function ensureWorkspaceViaBridge(
  deps: { logger: Logger },
  opts: {
    bridgeBase: string;
    projectId: string;
    projectName?: string;
    repos: Array<{
      id: string;
      remote_url: string;
      name?: string;
      role?: string;
      default_branch?: string;
      note?: string;
    }>;
  },
): Promise<BridgeWorkspaceRepo[]> {
  const { bridgeBase, projectId, projectName, repos } = opts;
  try {
    const res = await fetch(`${bridgeBase}/workspace/ensure`, {
      method: "POST",
      headers: bridgeAuthHeaders(),
      body: JSON.stringify({
        project_id: projectId,
        project_name: projectName,
        repos: repos.map((r) => ({
          id: r.id,
          remote_url: r.remote_url,
          name: r.name,
          role: r.role,
          default_branch: r.default_branch,
          note: r.note,
        })),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Bridge /workspace/ensure ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as { repos?: BridgeWorkspaceRepo[] };
    return data.repos || [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`workspace ensure failed: ${msg}`);
    throw new BadRequestException(
      `无法在 Bridge 上准备仓库工作区（${bridgeBase}/workspace/ensure）。` +
        `请确认执行器在线、BRIDGE_PUBLIC_URL 对 Studio 可达，且 Bridge 能 git clone。详情：${msg}`,
    );
  }
}

export function mergeCatalogWithBridgePaths(
  catalogRepos: CatalogRepo[],
  bridgeRepos: BridgeWorkspaceRepo[],
): CatalogRepo[] {
  const out: CatalogRepo[] = [];
  for (const r of catalogRepos) {
    const ensured = bridgeRepos.find((x) => x.id === r.id);
    if (!ensured || ensured.clone_status !== "ready") continue;
    out.push({
      ...r,
      local_path: ensured.local_path,
      agents_md_path: ensured.agents_md_path,
      clone_status: "ready",
      note: ensured.note || r.note,
    });
  }
  return out;
}

/**
 * Clone project repos on the Bridge host, then ask Manager which repo(s) to change.
 * May return multiple targets; Studio executes them sequentially.
 */
export async function prepareProjectRouting(
  deps: PrepareProjectRoutingDeps,
  order: WorkOrder,
  opts: { agentsMdPath?: string; bridgeBaseUrl?: string },
): Promise<ProjectRouting> {
  const override = (opts.agentsMdPath || "").trim();
  const projectId = (order.project_id || "").trim();

  if (!projectId) {
    const tid = (order.team_id || "").trim();
    const fallbackAgents =
      deps.studioConfig.getEffectiveForTeam(tid).agents_md_path;
    const agents = override || fallbackAgents || "auto";
    return {
      agents_md_path: agents,
      routing_mode: agents !== "auto" ? "explicit" : "auto",
      selected_repo_ids: [],
      manager_routing_reason: override
        ? "manual agents_md_path override"
        : "no project bound — Bridge may auto-route",
      repo_targets: [],
    };
  }

  const project = await deps.projects.getById(projectId);
  if (!project.enabled) {
    throw new BadRequestException(`项目已停用: ${projectId}`);
  }
  if (!project.repos.length) {
    throw new BadRequestException(`项目 ${projectId} 未配置任何 git 仓库`);
  }

  const bridgeBase = resolveStudioBridgeBase({
    override: opts.bridgeBaseUrl,
    registeredBaseUrl: deps.registeredBridgeBaseUrl,
    configured: deps.studioConfig.getEffectiveForTeam(
      (order.team_id || "").trim(),
    ).bridge_base_url,
  });

  const catalog = await deps.projects.catalogForManager(null, projectId);
  const ensured = await ensureWorkspaceViaBridge(deps, {
    bridgeBase,
    projectId,
    projectName: catalog.project_name,
    repos: catalog.repos.map((r) => ({
      id: r.id,
      remote_url: r.remote_url,
      name: r.name,
      role: r.role,
      default_branch: r.default_branch,
      note: r.note,
    })),
  });

  const failed = ensured.filter((r) => r.clone_status !== "ready");
  const selectable = mergeCatalogWithBridgePaths(catalog.repos, ensured);
  if (!selectable.length) {
    throw new BadRequestException(
      `项目仓库在 Bridge 上克隆失败: ${
        failed.map((r) => `${r.id}(${r.clone_error || "error"})`).join("; ") ||
        "无可用仓库"
      }`,
    );
  }

  const toTargets = (repoIds: string[], note: string): WorkOrderRepoTarget[] =>
    repoIds
      .map((id) => selectable.find((r) => r.id === id))
      .filter((r): r is CatalogRepo => Boolean(r))
      .map((r, i) => ({
        repo_id: r.id,
        name: r.name,
        role: r.role,
        agents_md_path: r.agents_md_path,
        local_path: r.local_path,
        status: i === 0 ? ("running" as const) : ("pending" as const),
        note,
        bridge_run_id: "",
        dify_workflow_run_id: "",
      }));

  if (override && override.toLowerCase() !== "auto") {
    const matched = selectable.find(
      (r) =>
        r.agents_md_path === override ||
        r.local_path === override ||
        r.id === override,
    );
    const ids = matched ? [matched.id] : [];
    const targets = matched
      ? toTargets(ids, "manual override")
      : [
          {
            repo_id: "manual",
            name: "manual",
            role: "",
            agents_md_path: override,
            local_path: "",
            status: "running" as const,
            note: "manual agents_md_path",
            bridge_run_id: "",
            dify_workflow_run_id: "",
          },
        ];
    return {
      agents_md_path: matched?.agents_md_path || override,
      routing_mode: "explicit",
      selected_repo_ids: ids,
      manager_routing_reason: matched
        ? `manual override → repo ${matched.id}`
        : "manual agents_md_path override",
      repo_targets: targets,
    };
  }

  try {
    const res = await fetch(`${bridgeBase}/routing/select`, {
      method: "POST",
      headers: bridgeAuthHeaders(),
      body: JSON.stringify({
        requirement: order.requirement,
        project_name: catalog.project_name,
        repos: selectable.map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          local_path: r.local_path,
          agents_md_path: r.agents_md_path,
          remote_url: r.remote_url,
          note: r.note,
        })),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bridge /routing/select ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      repo_ids?: string[];
      agents_md_path?: string;
      agents_md_paths?: string[];
      reason?: string;
    };
    const repoIds = (data.repo_ids || []).filter((id) =>
      selectable.some((r) => r.id === id),
    );
    if (!repoIds.length) {
      throw new BadRequestException(
        `总管未选出有效仓库（reason=${data.reason || "-"}）。可选：${selectable.map((r) => r.id).join(", ")}`,
      );
    }
    const targets = toTargets(
      repoIds,
      data.reason || "manager select via Bridge",
    );
    return {
      agents_md_path: targets[0]!.agents_md_path,
      routing_mode: "explicit",
      selected_repo_ids: targets.map((t) => t.repo_id),
      manager_routing_reason: data.reason || "manager select via Bridge",
      repo_targets: targets,
    };
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`manager select failed (no heuristic): ${msg}`);
    throw new BadRequestException(
      `必须由总管（Bridge /routing/select）决定改仓，不能使用关键词启发式。` +
        `请先启动执行器 Bridge（cursor/trae/qoder），并确认 Bridge 可达（${bridgeBase}）。详情：${msg}`,
    );
  }
}
