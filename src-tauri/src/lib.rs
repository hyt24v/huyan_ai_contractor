use std::path::Path;

#[tauri::command]
fn create_symlink(target: String, link: String) -> Result<(), String> {
    std::os::unix::fs::symlink(&target, &link).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_symlink(path: String) -> Result<String, String> {
    std::fs::read_link(&path)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
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
        .args(["clone", "--depth", "1", &url, &dest])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
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
    copy_dir_inner(Path::new(&src), Path::new(&dest), 0).map_err(|e| e.to_string())
}

/// 删除路径；软链只删链接本身，不跟随到目标目录。
#[tauri::command]
fn remove_path(path: String, recursive: bool) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            create_symlink,
            read_symlink,
            is_symlink,
            git_clone,
            copy_dir,
            remove_path,
            git_pull,
            git_remote,
            git_head
        ])
        .setup(|app| {
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
