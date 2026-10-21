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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            create_symlink,
            read_symlink,
            is_symlink,
            git_clone
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
