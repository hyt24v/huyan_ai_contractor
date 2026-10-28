use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

/// 自定义 fs 命令的安全兜底（前端业务层约定之外的最后一道防线）：
/// 拒绝操作关键系统路径 / $HOME 根；递归删除时额外拒绝 $HOME 的直接子目录（如 ~/.claude）。
fn fs_guard(path: &str, recursive_delete: bool) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let normalized = path.trim_end_matches('/');
    const CRITICAL: [&str; 11] = [
        "/",
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/Library",
        "/Applications",
        "/Users",
        "/private",
    ];
    if CRITICAL.contains(&normalized) || (!home.is_empty() && normalized == home) {
        return Err(format!("拒绝操作系统关键路径: {path}"));
    }
    if recursive_delete
        && !home.is_empty()
        && let Some(rest) = normalized.strip_prefix(&format!("{home}/"))
        && !rest.contains('/')
    {
        return Err(format!("拒绝递归删除用户根目录的直接子目录: {path}"));
    }
    Ok(())
}

#[tauri::command]
fn create_symlink(target: String, link: String) -> Result<(), String> {
    fs_guard(&link, false)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, &link).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        // 目录软链（skills 都是目录）；需要开启开发者模式或管理员权限
        std::os::windows::fs::symlink_dir(&target, &link)
            .map_err(|e| format!("创建软链失败：{e}（Windows 需开启开发者模式或以管理员运行）"))
    }
}

#[tauri::command]
fn read_symlink(path: String) -> Result<String, String> {
    std::fs::read_link(&path)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// 同步原生窗口外观(macOS 标题栏)为应用内主题;"system" 恢复跟随系统
#[tauri::command]
fn set_window_theme(window: tauri::WebviewWindow, theme: String) {
    let t = match theme.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    let _ = window.set_theme(t);
}

#[tauri::command]
fn is_symlink(path: String) -> bool {
    std::fs::symlink_metadata(&path)
        .map(|md| md.file_type().is_symlink())
        .unwrap_or(false)
}

#[tauri::command]
fn git_clone(url: String, dest: String) -> Result<(), String> {
    let status = std::process::Command::new("git")
        // `--` 分隔：防止以 `-` 开头的 url/dest 被当作 git 参数
        .args(["clone", "--depth", "1", "--", &url, &dest])
        .status()
        .map_err(|e| format!("无法执行 git（请确认已安装并在 PATH 中）：{e}"))?;
    if status.success() {
        Ok(())
    } else {
        // 清理失败克隆的残留目录，否则再次安装会报「中央库已存在」
        let _ = std::fs::remove_dir_all(&dest);
        Err(format!("git clone 失败，退出码 {:?}", status.code()))
    }
}

/// 递归复制目录（跟随软链），供「收编」使用。
/// plugin-fs 会解析软链真实路径再做 scope 校验，收编指向 scope 外的本地 skill 会失败。
fn copy_dir_inner(src: &Path, dest: &Path, depth: usize) -> std::io::Result<()> {
    if depth > 32 {
        return Err(std::io::Error::other("目录层级过深（可能存在软链环）"));
    }
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_inner(&from, &to, depth + 1)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_dir(src: String, dest: String) -> Result<(), String> {
    fs_guard(&dest, false)?;
    copy_dir_inner(Path::new(&src), Path::new(&dest), 0).map_err(|e| e.to_string())
}

/// 删除路径；软链只删链接本身，不跟随到目标目录。
#[tauri::command]
fn remove_path(path: String, recursive: bool) -> Result<(), String> {
    fs_guard(&path, recursive)?;
    let p = Path::new(&path);
    let meta = std::fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    let ft = meta.file_type();
    if ft.is_symlink() || ft.is_file() {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    } else if recursive {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_dir(p).map_err(|e| e.to_string())
    }
}

/// 运行 git 子命令并合并 stdout/stderr；失败时把输出作为错误返回。
fn run_git(args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);
    let trimmed = combined.trim();
    if output.status.success() {
        Ok(trimmed.to_string())
    } else if trimmed.is_empty() {
        Err(format!("git 失败，退出码 {:?}", output.status.code()))
    } else {
        Err(trimmed.to_string())
    }
}

/// 快进更新库内 skill 仓库。
#[tauri::command]
fn git_pull(path: String) -> Result<String, String> {
    run_git(&["-C", path.as_str(), "pull", "--ff-only"])
}

/// 读取 origin 地址。
#[tauri::command]
fn git_remote(path: String) -> Result<String, String> {
    run_git(&["-C", path.as_str(), "remote", "get-url", "origin"])
}

/// 读取当前 commit 短 hash。
#[tauri::command]
fn git_head(path: String) -> Result<String, String> {
    run_git(&["-C", path.as_str(), "rev-parse", "--short", "HEAD"])
}

/// 批量读取路径的最后修改时间（Unix 毫秒）。
/// 目录优先取其 SKILL.md / skill.md 的 mtime（skill 内容更新时间），其次目录本身；
/// 跟随软链（linked skill 指向中央库同一份内容）。读不到的路径不出现在结果里。
/// 只读操作，与 read_dir 等先例一样不走 fs_guard。
#[tauri::command]
fn path_mtimes(paths: Vec<String>) -> HashMap<String, u64> {
    let mut out = HashMap::new();
    for p in paths {
        let dir = PathBuf::from(&p);
        let candidates = [dir.join("SKILL.md"), dir.join("skill.md"), dir.clone()];
        for cand in &candidates {
            let Ok(meta) = std::fs::metadata(cand) else {
                continue;
            };
            let Ok(mtime) = meta.modified() else { continue };
            let Ok(d) = mtime.duration_since(std::time::UNIX_EPOCH) else {
                continue;
            };
            out.insert(p.clone(), d.as_millis() as u64);
            break;
        }
    }
    out
}

// ---------- 项目工作区专用：绕过 plugin-fs scope 的自定义命令 ----------
// 项目目录由用户显式关联，可能在 $HOME 的 agent 目录授权之外，
// 与 copy_dir / remove_path / create_symlink 一样走自定义命令（现状先例）。

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    is_directory: bool,
    is_symlink: bool,
}

/// 列目录（不含 . 开头项）；目录不存在返回空列表
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(p).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name,
            is_directory: ft.is_dir(),
            is_symlink: ft.is_symlink(),
        });
    }
    Ok(out)
}

/// 递归创建目录（mkdir -p）
#[tauri::command]
fn mkdir_p(path: String) -> Result<(), String> {
    fs_guard(&path, false)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// 读文本文件（项目工作区的 SKILL.md 等）
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ---------- HTTP 转发（测速 / 拉模型列表 / AI 聊天；webview fetch 有 CORS 限制） ----------

/// 为请求加 Bearer 鉴权头（泛型兼容 ureq 3 的 WithoutBody/WithBody 类型态）
fn apply_auth<B>(
    req: ureq::RequestBuilder<B>,
    authorization: &Option<String>,
    headers: &Option<std::collections::HashMap<String, String>>,
) -> ureq::RequestBuilder<B> {
    let mut req = match authorization {
        Some(auth) if !auth.is_empty() => req.header("Authorization", format!("Bearer {auth}")),
        _ => req,
    };
    // 自定义头（如 Anthropic 的 x-api-key / anthropic-version），优先级高于 Bearer
    if let Some(map) = headers {
        for (k, v) in map {
            req = req.header(k, v);
        }
    }
    req
}

/// 发起 HTTP 请求，返回状态码/耗时/响应体。
/// 默认 GET；method=POST/PUT 时以 application/json 发送 body；timeout_ms 默认 15s（AI 长生成可调大）。
/// 4xx/5xx 不视为错误（401 = Key 无效也是有效测试结果），网络层失败才返回 Err。
#[tauri::command]
fn http_request(
    url: String,
    authorization: Option<String>,
    method: Option<String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    let start = Instant::now();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_millis(timeout_ms.unwrap_or(15_000))))
        .http_status_as_error(false)
        .build()
        .into();
    let mut resp = match method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase()
        .as_str()
    {
        "POST" => {
            let req = apply_auth(agent.post(&url), &authorization, &headers);
            match body {
                Some(b) if !b.is_empty() => req.header("Content-Type", "application/json").send(b),
                _ => req.send(""),
            }
        }
        "PUT" => {
            let req = apply_auth(agent.put(&url), &authorization, &headers);
            match body {
                Some(b) if !b.is_empty() => req.header("Content-Type", "application/json").send(b),
                _ => req.send(""),
            }
        }
        "DELETE" => apply_auth(agent.delete(&url), &authorization, &headers).call(),
        _ => apply_auth(agent.get(&url), &authorization, &headers).call(),
    }
    .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp
        .body_mut()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "status": status,
        "elapsed_ms": start.elapsed().as_millis(),
        "body": body,
    }))
}

// ---------- AI SSE 流式转发（原始 data: 载荷逐行推给前端，协议解析在前端做） ----------

const AI_SSE_EVENT: &str = "ai-sse";

/// 进行中的 SSE 流：stream_id -> 中止标志（前端「停止」按钮用）
static SSE_ABORTS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn sse_aborts() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    SSE_ABORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
fn ai_sse_abort(stream_id: String) {
    if let Some(flag) = sse_aborts().lock().unwrap().get(&stream_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// 发起 SSE 流式请求（仅 POST）。事件负载：
/// {id, kind: "data", data} 每收到一行 data: 载荷
/// {id, kind: "body", status, body} 响应不是 SSE（供应商不支持流式/报错）时整包回传，前端走非流式解析
/// {id, kind: "done", status} / {id, kind: "aborted"} / {id, kind: "error", message}
#[tauri::command]
async fn ai_sse_request(
    window: tauri::Window,
    stream_id: String,
    url: String,
    authorization: Option<String>,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let abort = Arc::new(AtomicBool::new(false));
    sse_aborts()
        .lock()
        .unwrap()
        .insert(stream_id.clone(), abort.clone());
    let sid = stream_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run_sse(
            &window,
            &stream_id,
            &url,
            &authorization,
            body,
            &headers,
            &abort,
        ) {
            let _ = window.emit(
                AI_SSE_EVENT,
                serde_json::json!({"id": stream_id, "kind": "error", "message": e}),
            );
        }
        sse_aborts().lock().unwrap().remove(&sid);
    });
    Ok(())
}

fn run_sse(
    window: &tauri::Window,
    stream_id: &str,
    url: &str,
    authorization: &Option<String>,
    body: Option<String>,
    headers: &Option<HashMap<String, String>>,
    abort: &Arc<AtomicBool>,
) -> Result<(), String> {
    // 流式长生成不设整体超时；timeout_per_read 让停滞的流能被中止/看门狗发现
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(None)
        .timeout_per_read(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .build()
        .into();
    let req = apply_auth(agent.post(url), authorization, headers)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    let mut resp = req
        .send(body.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let is_sse = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/event-stream"))
        .unwrap_or(false);
    if !is_sse {
        let text = resp
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())?;
        window
            .emit(
                AI_SSE_EVENT,
                serde_json::json!({"id": stream_id, "kind": "body", "status": status, "body": text}),
            )
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut reader = std::io::BufReader::new(resp.body_mut().as_reader());
    let mut line = String::new();
    // 同一 SSE 事件的多行 data: 按规范拼接，遇空行才派发
    let mut data_buf = String::new();
    // 连续读超时计数：超过阈值视为停滞流，主动结束
    let mut stalled = 0u32;
    loop {
        if abort.load(Ordering::Relaxed) {
            let _ = window.emit(
                AI_SSE_EVENT,
                serde_json::json!({"id": stream_id, "kind": "aborted"}),
            );
            return Ok(());
        }
        line.clear();
        let n = match reader.read_line(&mut line) {
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                stalled += 1;
                if stalled >= 4 {
                    let _ = window.emit(
                        AI_SSE_EVENT,
                        serde_json::json!({"id": stream_id, "kind": "error", "message": "响应停滞超时（60 秒无数据）"}),
                    );
                    return Ok(());
                }
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        if n == 0 {
            break; // EOF
        }
        stalled = 0;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if !data_buf.is_empty() {
                let _ = window.emit(
                    AI_SSE_EVENT,
                    serde_json::json!({"id": stream_id, "kind": "data", "data": data_buf.clone()}),
                );
                data_buf.clear();
            }
            continue;
        }
        // 只透传 data: 载荷（只剥分隔用的单个空格）；event:/注释行由前端按载荷里的 type 自行分流
        if let Some(data) = trimmed.strip_prefix("data:") {
            let payload = data.strip_prefix(' ').unwrap_or(data);
            if !data_buf.is_empty() {
                data_buf.push('\n');
            }
            data_buf.push_str(payload);
        }
    }
    // EOF 时冲掉未以空行结尾的残余 data
    if !data_buf.is_empty() {
        let _ = window.emit(
            AI_SSE_EVENT,
            serde_json::json!({"id": stream_id, "kind": "data", "data": data_buf}),
        );
    }
    window
        .emit(
            AI_SSE_EVENT,
            serde_json::json!({"id": stream_id, "kind": "done", "status": status}),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 文件监听（借鉴 ColaMD：监听父目录以兼容原子写入 rename） ----------

const FS_EVENT: &str = "fs-changed";
/// 前沿去抖：同一目标 300ms 内只发一次事件（处理器会重读文件，后续变化还会再触发）
const FS_DEBOUNCE: Duration = Duration::from_millis(300);

struct WatchState {
    watcher: Option<RecommendedWatcher>,
    /// 目标文件 -> 实际监听的目录（父目录）
    targets: HashMap<PathBuf, PathBuf>,
    /// 已监听目录 -> 目标引用计数
    dir_refs: HashMap<PathBuf, usize>,
    /// 目标 -> 上次发事件时间
    last_emit: HashMap<PathBuf, Instant>,
}

static WATCH: OnceLock<Mutex<WatchState>> = OnceLock::new();
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn watch_state() -> &'static Mutex<WatchState> {
    WATCH.get_or_init(|| {
        Mutex::new(WatchState {
            watcher: None,
            targets: HashMap::new(),
            dir_refs: HashMap::new(),
            last_emit: HashMap::new(),
        })
    })
}

fn handle_fs_event(event: Event) {
    let Some(app) = APP.get() else { return };
    let Ok(mut st) = watch_state().lock() else {
        return;
    };
    let now = Instant::now();
    for p in &event.paths {
        // 监听的是父目录，同目录其它文件的事件直接丢弃；原子写入(rename)的 to 路径恰好是目标
        if !st.targets.contains_key(p) {
            continue;
        }
        if let Some(t) = st.last_emit.get(p)
            && now.duration_since(*t) < FS_DEBOUNCE
        {
            continue;
        }
        st.last_emit.insert(p.clone(), now);
        let kind = if p.exists() { "modified" } else { "removed" };
        let _ = app.emit(
            FS_EVENT,
            serde_json::json!({ "path": p.to_string_lossy(), "kind": kind }),
        );
    }
}

/// 监听单个文件的外部变更（含原子写入覆盖、删除、重建）。
/// 父目录不存在时静默不监听（agent 未安装等场景），返回 Ok。
#[tauri::command]
fn watch_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let Some(parent) = target.parent() else {
        return Ok(());
    };
    if !parent.is_dir() {
        return Ok(());
    }
    let parent = parent.to_path_buf();
    let mut st = watch_state().lock().map_err(|e| e.to_string())?;
    if st.targets.contains_key(&target) {
        return Ok(());
    }
    if st.watcher.is_none() {
        st.watcher = Some(
            RecommendedWatcher::new(
                |res: Result<Event, notify::Error>| {
                    if let Ok(ev) = res {
                        handle_fs_event(ev);
                    }
                },
                notify::Config::default(),
            )
            .map_err(|e| e.to_string())?,
        );
    }
    let need_watch = !st.dir_refs.contains_key(&parent);
    if need_watch {
        st.watcher
            .as_mut()
            .expect("watcher 已初始化")
            .watch(&parent, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
    }
    *st.dir_refs.entry(parent.clone()).or_insert(0) += 1;
    st.targets.insert(target, parent);
    Ok(())
}

#[tauri::command]
fn unwatch_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let mut st = watch_state().lock().map_err(|e| e.to_string())?;
    if let Some(dir) = st.targets.remove(&target) {
        if let Some(refs) = st.dir_refs.get_mut(&dir) {
            *refs -= 1;
            if *refs == 0 {
                st.dir_refs.remove(&dir);
                if let Some(w) = st.watcher.as_mut() {
                    let _ = w.unwatch(&dir);
                }
            }
        }
        st.last_emit.remove(&target);
    }
    Ok(())
}

// ---------- 系统托盘（借鉴 magpie 菜单栏形态 + cc-switch 托盘弹层） ----------

/// 显示并聚焦主窗口（最小化时先还原）
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 原生菜单托盘：版本号（禁用展示）、打开主窗口、退出
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let version_item = MenuItemBuilder::with_id(
        "tray-version",
        format!("AI 包工头 v{}", env!("CARGO_PKG_VERSION")),
    )
    .enabled(false)
    .build(app)?;
    let show_item = MenuItemBuilder::with_id("tray-show", "打开主窗口").build(app)?;
    // 快速打开各工具页：点击后唤醒窗口并导航到对应路由
    let nav_targets: [(&str, &str); 7] = [
        ("tray-nav:/json", "JSON 编辑器"),
        ("tray-nav:/markdown", "Markdown 编辑器"),
        ("tray-nav:/skills", "Skills 管理"),
        ("tray-nav:/mcp", "MCP 管理"),
        ("tray-nav:/prompts", "提示词"),
        ("tray-nav:/providers", "模型服务"),
        ("tray-nav:/profiles", "配置套餐"),
    ];
    let nav_items: Vec<tauri::menu::MenuItem<tauri::Wry>> = nav_targets
        .iter()
        .map(|(id, label)| MenuItemBuilder::with_id(*id, *label).build(app))
        .collect::<tauri::Result<_>>()?;
    let nav_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = nav_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let quick_menu = SubmenuBuilder::new(app, "快速打开")
        .items(&nav_refs)
        .build()?;
    let update_item =
        MenuItemBuilder::with_id("tray-nav:/settings/updates", "检查更新…").build(app)?;
    let settings_item = MenuItemBuilder::with_id("tray-nav:/settings", "设置…").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray-quit", "退出 AI 包工头").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[
            &version_item,
            &show_item,
            &sep1,
            &quick_menu,
            &sep2,
            &update_item,
            &settings_item,
            &sep3,
            &quit_item,
        ])
        .build()?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("AI 包工头")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(path) = id.strip_prefix("tray-nav:") {
                show_main_window(app);
                // 前端 Layout 监听该事件并导航
                let _ = app.emit("tray:navigate", path.to_string());
            } else {
                match id {
                    "tray-show" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                }
            }
        });
    // macOS 菜单栏专用模板图标：安全帽剪影，适配深浅色菜单栏
    #[cfg(target_os = "macos")]
    {
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
        tray = tray.icon(icon).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_symlink,
            read_symlink,
            is_symlink,
            path_exists,
            set_window_theme,
            git_clone,
            copy_dir,
            remove_path,
            git_pull,
            git_remote,
            git_head,
            read_dir,
            mkdir_p,
            read_text,
            http_request,
            ai_sse_request,
            ai_sse_abort,
            watch_path,
            unwatch_path,
            path_mtimes
        ])
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            setup_tray(app)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
