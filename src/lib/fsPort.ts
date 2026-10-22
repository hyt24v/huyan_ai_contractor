/**
 * 文件系统抽象层：纯逻辑不直接依赖 Tauri，测试可用内存 mock。
 * 真实实现基于 @tauri-apps/plugin-fs + 自定义 Rust 命令。
 */
import { invoke } from '@tauri-apps/api/core';
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';

export interface DirItem {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface FsPort {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** 返回目录项（不含 . 开头）；目录不存在返回 [] */
  readDir(path: string): Promise<DirItem[]>;
  mkdir(path: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyDir(src: string, dst: string): Promise<void>;
  readLink(path: string): Promise<string>;
  symlink(target: string, link: string): Promise<void>;
  gitClone(url: string, dest: string): Promise<void>;
}

let cachedHome = '';

export async function home(): Promise<string> {
  if (!cachedHome) cachedHome = (await homeDir()).replace(/\/$/, '');
  return cachedHome;
}

/** 把相对 home 的路径（'ai-skills/x'）转成绝对路径 */
export async function absPath(rel: string): Promise<string> {
  return `${await home()}/${rel}`;
}

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  // 走 Rust 自定义命令：plugin-fs 会解析软链真实路径并按 scope 校验，
  // 导致收编 ~/.claude/skills 里指向其它目录的软链 skill 时被判定为 forbidden。
  await invoke<void>('copy_dir', { src, dest: dst });
}

export const tauriFs: FsPort = {
  readText: (p) => readTextFile(p),
  writeText: (p, t) => writeTextFile(p, t),
  exists: (p) => exists(p),
  readDir: async (p) => {
    if (!(await exists(p))) return [];
    const entries = await readDir(p);
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory,
        isSymlink: e.isSymlink,
      }));
  },
  mkdir: (p) => mkdir(p, { recursive: true }),
  // 同上：软链本身可能指向 scope 外的真实目录，删除时用 Rust 命令只删链接。
  remove: (p, recursive) =>
    invoke<void>('remove_path', { path: p, recursive: recursive ?? false }),
  rename: (from, to) => rename(from, to),
  copyDir: (src, dst) => copyDirRecursive(src, dst),
  readLink: (p) => invoke<string>('read_symlink', { path: p }),
  symlink: (target, link) =>
    invoke<void>('create_symlink', { target, link }),
  gitClone: (url, dest) => invoke<void>('git_clone', { url, dest }),
};
