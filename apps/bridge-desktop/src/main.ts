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

async function refresh(opts?: { clearError?: boolean }) {
  try {
    const status = await invoke<BridgeStatus>("bridge_status");
    render(status);
    if (opts?.clearError) setError(null);
  } catch (e) {
    setError(String(e));
  }
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
}

async function openCwd() {
  setError(null);
  try {
    await invoke("open_bridge_cwd");
  } catch (e) {
    setError(String(e));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("btn-start")?.addEventListener("click", () => void start());
  $("btn-stop")?.addEventListener("click", () => void stop());
  $("btn-refresh")?.addEventListener("click", () => void refresh());
  $("btn-open-cwd")?.addEventListener("click", () => void openCwd());
  void refresh({ clearError: true });
  window.setInterval(() => void refresh(), 2000);
});
