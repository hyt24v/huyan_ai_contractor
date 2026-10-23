/**
 * 应用内在线更新封装（tauri-plugin-updater + tauri-plugin-process）。
 * 更新源:GitHub 固定 tag `updater` 的 latest.json,由 release workflow 在每次发布后刷新,
 * beta(Pre-release)与正式版共用同一条更新通道,谁新更谁。
 */
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export interface DownloadProgress {
  /** 已下载字节数 */
  downloaded: number;
  /** 总字节数;未知时为 null */
  total: number | null;
}

/** 当前应用版本(读 tauri.conf.json 的 version) */
export async function currentVersion(): Promise<string> {
  return getVersion();
}

/** 检查更新;无更新返回 null,失败抛错(调用方决定静默还是提示) */
export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

/** 下载并安装更新;onProgress 回调下载进度 */
export async function downloadAndInstall(
  update: Update,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
    } else if (event.event === 'Finished') {
      // 下载完成,进入安装阶段
    }
    onProgress({ downloaded, total });
  });
}

/** 重启应用完成更新 */
export async function relaunchApp(): Promise<void> {
  return relaunch();
}
