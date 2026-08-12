use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, WindowEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Working directory for Bridge (contains `.env`).
    pub bridge_cwd: String,
    /// Absolute path to `node` binary.
    pub node_path: String,
    /// Absolute path to `packages/bridge/dist/bin.js`.
    pub bridge_bin: String,
    /// Health URL override; empty = derive from `.env` BRIDGE_PORT.
    pub health_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub process_alive: bool,
    pub pid: Option<u32>,
    pub health: String,
    pub driver: Option<String>,
    pub name: Option<String>,
    pub detail: String,
    pub health_url: String,
    pub bridge_cwd: String,
}

struct ManagedBridge {
    child: Option<Child>,
    config: AppConfig,
}

pub struct AppState(Mutex<ManagedBridge>);

fn repo_root_guess() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // apps/bridge-desktop/src-tauri → repo root
    manifest
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| manifest.join("../../.."))
}

fn default_config() -> AppConfig {
    let root = repo_root_guess();
    AppConfig {
        bridge_cwd: root.join("apps/studio-bridge").to_string_lossy().into(),
        node_path: which_node(),
        bridge_bin: root
            .join("packages/bridge/dist/bin.js")
            .to_string_lossy()
            .into(),
        health_url: String::new(),
    }
}

fn which_node() -> String {
    if let Ok(p) = std::env::var("BRIDGE_DESKTOP_NODE") {
        if !p.trim().is_empty() {
            return p;
        }
    }
    #[cfg(unix)]
    {
        if let Ok(out) = Command::new("sh").args(["-lc", "command -v node"]).output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() {
                    return s;
                }
            }
        }
    }
    "node".into()
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("agent-studio")
        .join("bridge-desktop.json")
}

fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&raw) {
                return cfg;
            }
        }
    }
    default_config()
}

fn save_config(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn parse_env_port(bridge_cwd: &Path) -> u16 {
    let env_file = bridge_cwd.join(".env");
    if let Ok(file) = fs::File::open(env_file) {
        for line in BufReader::new(file).lines().flatten() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(rest) = line.strip_prefix("BRIDGE_PORT=") {
                let v = rest.trim().trim_matches('"').trim_matches('\'');
                if let Ok(n) = v.parse::<u16>() {
                    return n;
                }
            }
        }
    }
    8787
}

fn resolve_health_url(cfg: &AppConfig) -> String {
    let override_url = cfg.health_url.trim();
    if !override_url.is_empty() {
        return override_url.trim_end_matches('/').to_string();
    }
    let port = parse_env_port(Path::new(&cfg.bridge_cwd));
    format!("http://127.0.0.1:{port}/health")
}

fn child_alive(child: &mut Option<Child>) -> (bool, Option<u32>) {
    match child {
        Some(c) => match c.try_wait() {
            Ok(None) => (true, Some(c.id())),
            Ok(Some(_)) => {
                *child = None;
                (false, None)
            }
            Err(_) => {
                *child = None;
                (false, None)
            }
        },
        None => (false, None),
    }
}

fn fetch_health(url: &str) -> (String, Option<String>, Option<String>, String) {
    match ureq::get(url).timeout(Duration::from_secs(2)).call() {
        Ok(res) => {
            if !(200..300).contains(&res.status()) {
                return (
                    "unreachable".into(),
                    None,
                    None,
                    format!("HTTP {}", res.status()),
                );
            }
            match res.into_json::<serde_json::Value>() {
                Ok(body) => {
                    let status = body
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("online")
                        .to_string();
                    let driver = body
                        .get("driver")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let name = body
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    (status, driver, name, "ok".into())
                }
                Err(e) => ("unreachable".into(), None, None, e.to_string()),
            }
        }
        Err(e) => ("unreachable".into(), None, None, e.to_string()),
    }
}

#[cfg(not(unix))]
fn signal_child(pid: u32, _sig: i32) -> Result<(), String> {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn stop_child(child: &mut Option<Child>) -> Result<(), String> {
    let Some(c) = child.as_mut() else {
        return Ok(());
    };
    let pid = c.id();
    #[cfg(unix)]
    {
        // Negative pid = process group (we spawned with process_group(0)).
        let _ = unsafe { libc::kill(-(pid as i32), libc::SIGINT) };
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match c.try_wait() {
                Ok(Some(_)) => {
                    *child = None;
                    return Ok(());
                }
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(e.to_string()),
            }
        }
        let _ = unsafe { libc::kill(-(pid as i32), libc::SIGTERM) };
        let _ = c.wait();
    }
    #[cfg(not(unix))]
    {
        let _ = signal_child(pid, 0);
        let _ = c.wait();
    }
    *child = None;
    Ok(())
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.0.lock().unwrap().config.clone()
}

#[tauri::command]
fn set_config(state: State<'_, AppState>, config: AppConfig) -> Result<AppConfig, String> {
    save_config(&config)?;
    let mut guard = state.0.lock().unwrap();
    guard.config = config.clone();
    Ok(config)
}

#[tauri::command]
fn reset_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let cfg = default_config();
    save_config(&cfg)?;
    let mut guard = state.0.lock().unwrap();
    guard.config = cfg.clone();
    Ok(cfg)
}

#[tauri::command]
fn bridge_status(state: State<'_, AppState>) -> BridgeStatus {
    let mut guard = state.0.lock().unwrap();
    let (alive, pid) = child_alive(&mut guard.child);
    let health_url = resolve_health_url(&guard.config);
    let (health, driver, name, mut detail) = fetch_health(&health_url);
    let health = if !alive && health == "unreachable" {
        "stopped".into()
    } else if alive && health == "unreachable" {
        "starting".into()
    } else {
        if !alive && detail == "ok" {
            detail = "external: 端口上已有 Bridge（多为 npm run dev:bridge），非本 App 启动"
                .into();
        }
        health
    };
    BridgeStatus {
        process_alive: alive,
        pid,
        health,
        driver,
        name,
        detail,
        health_url,
        bridge_cwd: guard.config.bridge_cwd.clone(),
    }
}

#[tauri::command]
fn start_bridge(state: State<'_, AppState>) -> Result<BridgeStatus, String> {
    {
        let mut guard = state.0.lock().unwrap();
        let (alive, _) = child_alive(&mut guard.child);
        if alive {
            return Err("Bridge process already running from this app".into());
        }
        let cfg = guard.config.clone();
        let health_url = resolve_health_url(&cfg);
        let (health, _, _, _) = fetch_health(&health_url);
        if matches!(health.as_str(), "online" | "busy" | "starting") {
            return Err(format!(
                "端口已被占用：{health_url} 已有 Bridge（{health}）。请先停掉 CLI（Ctrl+C / 结束 node 进程）后再用本 App 启动，或直接使用当前已 online 的实例。"
            ));
        }
        let cwd = PathBuf::from(&cfg.bridge_cwd);
        if !cwd.is_dir() {
            return Err(format!("bridge_cwd does not exist: {}", cfg.bridge_cwd));
        }
        let bin = PathBuf::from(&cfg.bridge_bin);
        if !bin.is_file() {
            return Err(format!(
                "bridge_bin missing: {} — run: npm run build -w @agent-studio/bridge",
                cfg.bridge_bin
            ));
        }
        let mut cmd = Command::new(&cfg.node_path);
        cmd.arg(&cfg.bridge_bin)
            .arg("start")
            .current_dir(&cwd)
            .stdin(Stdio::null())
            // Avoid pipe-buffer deadlock; keep stderr for immediate-exit diagnosis.
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        // Own process group so "quit UI only" can leave Bridge running after app exit.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let child = cmd.spawn().map_err(|e| {
            format!(
                "failed to spawn {} {} start (cwd={}): {e}",
                cfg.node_path, cfg.bridge_bin, cfg.bridge_cwd
            )
        })?;
        guard.child = Some(child);
    }
    // Brief wait so health can flip / crash surfaces.
    thread::sleep(Duration::from_millis(600));
    {
        use std::io::Read;
        let mut guard = state.0.lock().unwrap();
        if let Some(child) = guard.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let mut err = String::new();
                    if let Some(mut stderr) = child.stderr.take() {
                        let _ = stderr.read_to_string(&mut err);
                    }
                    guard.child = None;
                    let err = err.trim();
                    return Err(if err.is_empty() {
                        format!("Bridge exited immediately ({status})")
                    } else {
                        format!("Bridge exited immediately ({status}): {err}")
                    });
                }
                Ok(None) => {}
                Err(e) => {
                    guard.child = None;
                    return Err(e.to_string());
                }
            }
        }
    }
    Ok(bridge_status(state))
}

#[tauri::command]
fn stop_bridge(state: State<'_, AppState>) -> Result<BridgeStatus, String> {
    {
        let mut guard = state.0.lock().unwrap();
        stop_child(&mut guard.child)?;
    }
    thread::sleep(Duration::from_millis(200));
    Ok(bridge_status(state))
}

#[tauri::command]
fn open_bridge_cwd(state: State<'_, AppState>) -> Result<(), String> {
    let cwd = state.0.lock().unwrap().config.bridge_cwd.clone();
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&cwd)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&cwd)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&cwd)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("open directory not supported on this OS".into())
}

fn do_start(app: &AppHandle) {
    let state = app.state::<AppState>();
    let _ = start_bridge(state);
}

fn do_stop(app: &AppHandle) {
    let state = app.state::<AppState>();
    let _ = stop_bridge(state);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = load_config();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState(Mutex::new(ManagedBridge {
            child: None,
            config,
        })))
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            reset_config,
            bridge_status,
            start_bridge,
            stop_bridge,
            open_bridge_cwd
        ])
        .setup(|app| {
            let start_i = MenuItem::with_id(app, "start", "启动 Bridge", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "停止 Bridge", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_ui =
                MenuItem::with_id(app, "quit_ui", "退出界面（Bridge 继续跑）", true, None::<&str>)?;
            let quit_all =
                MenuItem::with_id(app, "quit_all", "退出并停止 Bridge", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&start_i, &stop_i, &show_i, &quit_ui, &quit_all],
            )?;

            let _tray = TrayIconBuilder::with_id("bridge-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Agent Studio Bridge")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "start" => do_start(app),
                    "stop" => do_stop(app),
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit_ui" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                        // Detach child so Drop won't kill it; then exit app process.
                        {
                            let state = app.state::<AppState>();
                            let mut guard = state.0.lock().unwrap();
                            if let Some(child) = guard.child.take() {
                                // leak intentional: Bridge keeps running after UI exits
                                std::mem::forget(child);
                            }
                        }
                        app.exit(0);
                    }
                    "quit_all" => {
                        do_stop(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_ = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Hide to tray instead of quitting.
                        api.prevent_close();
                        let _ = window_.hide();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
