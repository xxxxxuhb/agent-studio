import { invoke } from "@tauri-apps/api/core";

type BridgeStatus = {
  processAlive: boolean;
  pid: number | null;
  health: string;
  driver: string | null;
  name: string | null;
  detail: string;
  healthUrl: string;
  bridgeCwd: string;
  nodeOk: boolean;
  binOk: boolean;
  cwdOk: boolean;
};

type PathProbe = {
  repoRoot: string | null;
  nodePath: string;
  nodeOk: boolean;
  bridgeBin: string;
  binOk: boolean;
  bridgeCwd: string;
  cwdOk: boolean;
  envOk: boolean;
  hints: string[];
};

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

function setError(msg: string | null) {
  const el = $("error");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function isReachableHealth(health: string) {
  return ["online", "busy", "starting"].includes(health);
}

function render(status: BridgeStatus) {
  const badge = $("status-badge");
  if (badge) {
    badge.textContent = status.health;
    badge.className = `badge ${status.health}`;
  }
  const processEl = $("meta-process");
  if (processEl) {
    if (status.processAlive) {
      processEl.textContent = `alive${status.pid != null ? ` (pid ${status.pid})` : ""}`;
    } else if (isReachableHealth(status.health)) {
      processEl.textContent = "external (CLI / other)";
    } else {
      processEl.textContent = "not managed / stopped";
    }
  }
  const driverEl = $("meta-driver");
  if (driverEl) driverEl.textContent = status.driver ?? "—";
  const nameEl = $("meta-name");
  if (nameEl) nameEl.textContent = status.name ?? "—";
  const pathsEl = $("meta-paths");
  if (pathsEl) {
    const flags = [
      status.nodeOk ? "node✓" : "node✗",
      status.binOk ? "bin✓" : "bin✗",
      status.cwdOk ? "cwd✓" : "cwd✗",
    ];
    pathsEl.textContent = flags.join(" · ");
  }
  const urlEl = $("meta-health-url");
  if (urlEl) urlEl.textContent = status.healthUrl;
  const cwdEl = $("meta-cwd");
  if (cwdEl) cwdEl.textContent = status.bridgeCwd;
  const detailEl = $("meta-detail");
  if (detailEl) detailEl.textContent = status.detail || "—";

  const startBtn = $("btn-start") as HTMLButtonElement | null;
  const stopBtn = $("btn-stop") as HTMLButtonElement | null;
  // Don't start a second Bridge when port already healthy.
  if (startBtn) {
    startBtn.disabled = status.processAlive || isReachableHealth(status.health);
  }
  if (stopBtn) stopBtn.disabled = !status.processAlive;
}

function renderHints(probe: PathProbe) {
  const el = $("path-hints");
  if (!el) return;
  if (!probe.hints.length) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = probe.hints.join(" · ");
}

async function refreshLogs() {
  const view = $("log-view");
  if (!view) return;
  try {
    const lines = await invoke<string[]>("bridge_logs");
    const text = lines.join("\n");
    const nearBottom =
      view.scrollHeight - view.scrollTop - view.clientHeight < 48;
    view.textContent = text || "（尚无日志）";
    if (nearBottom) view.scrollTop = view.scrollHeight;
  } catch {
    /* ignore poll errors */
  }
}

async function refresh(opts?: { clearError?: boolean }) {
  try {
    const [status, probe] = await Promise.all([
      invoke<BridgeStatus>("bridge_status"),
      invoke<PathProbe>("probe_paths"),
    ]);
    render(status);
    renderHints(probe);
    if (opts?.clearError) setError(null);
  } catch (e) {
    setError(String(e));
  }
  await refreshLogs();
}

async function start() {
  setError(null);
  try {
    const status = await invoke<BridgeStatus>("start_bridge");
    render(status);
  } catch (e) {
    setError(String(e));
    await refresh();
  }
  await refreshLogs();
}

async function stop() {
  setError(null);
  try {
    const status = await invoke<BridgeStatus>("stop_bridge");
    render(status);
  } catch (e) {
    setError(String(e));
    await refresh();
  }
  await refreshLogs();
}

async function openCwd() {
  setError(null);
  try {
    await invoke("open_bridge_cwd");
  } catch (e) {
    setError(String(e));
  }
}

async function resetPaths() {
  setError(null);
  try {
    await invoke("reset_config");
    await refresh({ clearError: true });
  } catch (e) {
    setError(String(e));
  }
}

async function clearLogs() {
  try {
    await invoke("clear_bridge_logs");
    await refreshLogs();
  } catch (e) {
    setError(String(e));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("btn-start")?.addEventListener("click", () => void start());
  $("btn-stop")?.addEventListener("click", () => void stop());
  $("btn-refresh")?.addEventListener("click", () => void refresh());
  $("btn-open-cwd")?.addEventListener("click", () => void openCwd());
  $("btn-reset-paths")?.addEventListener("click", () => void resetPaths());
  $("btn-clear-logs")?.addEventListener("click", () => void clearLogs());
  void refresh({ clearError: true });
  window.setInterval(() => void refresh(), 2000);
});
