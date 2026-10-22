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
            remove_path
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
