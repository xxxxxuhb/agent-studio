import type { WorkOrderRepoTarget } from "@agent-studio/agent-schema";

export type ProjectRouting = {
  agents_md_path: string;
  routing_mode: "auto" | "explicit";
  selected_repo_ids: string[];
  manager_routing_reason: string;
  repo_targets: WorkOrderRepoTarget[];
};

/**
 * URL Studio API uses to call Bridge directly (manager select, etc.).
 * Settings `bridge_base_url` is often `http://host.docker.internal:8787` for Dify-in-Docker;
 * Studio on the host must rewrite that host to loopback.
 */
export function studioReachableBridgeBase(url: string | undefined): string {
  const base =
    (url || "").trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
  return base.replace(/host\.docker\.internal/gi, "127.0.0.1");
}

/** 5xx / network / timeout — keep work order running and ask user to retry sync. */
export function isTransientDifyFailure(message: string): boolean {
  const m = (message || "").toLowerCase();
  if (!m) return false;
  if (/\b(502|503|504|429)\b/.test(m)) return true;
  if (
    m.includes("status code 502") ||
    m.includes("status code 503") ||
    m.includes("status code 504")
  ) {
    return true;
  }
  return (
    m.includes("service unavailable") ||
    m.includes("bad gateway") ||
    m.includes("gateway timeout") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("aborted") ||
    m.includes("timeout")
  );
}

export type BridgeStageHint = {
  runId?: string;
  stage?: string;
  status?: string;
  summary?: string;
  dryRun?: boolean;
};
