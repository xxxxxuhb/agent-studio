import { BadRequestException, Logger } from "@nestjs/common";
import type { WorkOrder, WorkOrderRepoTarget } from "@agent-studio/agent-schema";
import { bridgeAuthHeaders } from "../bridges/bridge-http";
import type { DifyConfigService } from "../dify/dify-config.service";
import type { ProjectsService } from "../projects/projects.service";
import {
  type ProjectRouting,
  studioReachableBridgeBase,
} from "./work-order-dify-utils";

export type PrepareProjectRoutingDeps = {
  projects: ProjectsService;
  difyConfig: DifyConfigService;
  logger: Logger;
};

/**
 * Clone project repos if missing, then ask Manager which repo(s) to change.
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
    const agents =
      override || deps.difyConfig.get().agents_md_path || "auto";
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

  const project = deps.projects.get(projectId);
  if (!project.enabled) {
    throw new BadRequestException(`项目已停用: ${projectId}`);
  }
  if (!project.repos.length) {
    throw new BadRequestException(`项目 ${projectId} 未配置任何 git 仓库`);
  }

  const cloned = await deps.projects.ensureCloned(projectId);
  const failed = cloned.repos.filter((r) => r.clone_status === "error");
  const ready = cloned.repos.filter((r) => r.clone_status === "ready");
  if (!ready.length) {
    throw new BadRequestException(
      `项目仓库克隆失败: ${failed.map((r) => `${r.id}(${r.clone_error})`).join("; ") || "无可用仓库"}`,
    );
  }

  const catalog = deps.projects.catalogForManager(projectId);
  const selectable = catalog.repos.filter((r) =>
    ready.some((x) => x.id === r.id),
  );

  const toTargets = (repoIds: string[], note: string): WorkOrderRepoTarget[] =>
    repoIds
      .map((id) => selectable.find((r) => r.id === id))
      .filter((r): r is (typeof selectable)[number] => Boolean(r))
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

  const configuredBridge =
    (opts.bridgeBaseUrl || "").trim() ||
    deps.difyConfig.get().bridge_base_url ||
    "http://127.0.0.1:8787";
  const bridgeBase = studioReachableBridgeBase(configuredBridge);

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
    const hint =
      bridgeBase !== configuredBridge.replace(/\/$/, "")
        ? `配置 ${configuredBridge} → Studio 实际请求 ${bridgeBase}`
        : `当前 ${bridgeBase}`;
    throw new BadRequestException(
      `必须由总管（Bridge /routing/select）决定改仓，不能使用关键词启发式。` +
        `请先启动执行器 Bridge（cursor/trae/qoder），并确认 Bridge 可达（${hint}）。详情：${msg}`,
    );
  }
}
