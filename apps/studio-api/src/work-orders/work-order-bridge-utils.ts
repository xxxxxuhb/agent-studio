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
 * Settings `bridge_base_url` may still use `http://host.docker.internal:8787` from
 * legacy Docker setups. When Studio itself runs on that host, rewrite only that
 * docker DNS name to loopback so Studio can reach the Bridge.
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

export type BridgeStageHint = {
  runId?: string;
  stage?: string;
  status?: string;
  summary?: string;
  dryRun?: boolean;
};
