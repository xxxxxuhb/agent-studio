import type { WorkOrderRepoTarget } from "@agent-studio/agent-schema";

export type ProjectRouting = {
  agents_md_path: string;
  routing_mode: "auto" | "explicit";
  selected_repo_ids: string[];
  manager_routing_reason: string;
  repo_targets: WorkOrderRepoTarget[];
};

/**
 * URL Studio API uses to call Bridge directly (manager select, workspace ensure, etc.).
 *
 * Settings `bridge_base_url` is often `http://host.docker.internal:8787` for Dify-in-Docker
 * talking to a Bridge on the same Docker host. When Studio itself runs on that host,
 * rewrite only that docker DNS name to loopback so Studio can reach the Bridge.
 *
 * LAN / public `BRIDGE_PUBLIC_URL` hostnames and IPs are left unchanged (remote executor).
 */
export function studioReachableBridgeBase(url: string | undefined): string {
  const base =
    (url || "").trim().replace(/\/$/, "") || "http://127.0.0.1:8787";
  try {
    const parsed = new URL(base);
    if (/^host\.docker\.internal$/i.test(parsed.hostname)) {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return base.replace(/host\.docker\.internal/gi, "127.0.0.1");
  }
  return base;
}

/**
 * Prefer an explicit override, then a registered online/busy executor, then settings.
 */
export function resolveStudioBridgeBase(opts: {
  override?: string;
  registeredBaseUrl?: string;
  configured?: string;
}): string {
  const raw =
    (opts.override || "").trim() ||
    (opts.registeredBaseUrl || "").trim() ||
    (opts.configured || "").trim() ||
    "http://127.0.0.1:8787";
  return studioReachableBridgeBase(raw);
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
