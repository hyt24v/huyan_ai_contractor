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
  /** 不跟随软链判断路径是否为软链（坏软链也返回 true）。可选：mock 可不实现 */
  isSymlink?(path: string): Promise<boolean>;
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
  isSymlink: (p) => invoke<boolean>('is_symlink', { path: p }),
  readLink: (p) => invoke<string>('read_symlink', { path: p }),
  symlink: (target, link) =>
    invoke<void>('create_symlink', { target, link }),
  gitClone: (url, dest) => invoke<void>('git_clone', { url, dest }),
};

/**
 * 全走自定义 Rust 命令的 FsPort：用于「项目工作区」等用户显式关联、
 * 位于 plugin-fs scope 之外的目录（项目可以在磁盘任意位置）。
 * 与 copy_dir/remove_path 等既有先例一致，不引入 $HOME/** 泛授权。
 */
export const rawFs: FsPort = {
  readText: (p) => invoke<string>('read_text', { path: p }),
  writeText: () =>
    Promise.reject(new Error('rawFs 不支持写文本（项目工作区只部署软链/复制）')),
  exists: (p) => invoke<boolean>('path_exists', { path: p }),
  readDir: async (p) => {
    const entries = await invoke<
      { name: string; is_directory: boolean; is_symlink: boolean }[]
    >('read_dir', { path: p });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.is_directory,
      isSymlink: e.is_symlink,
    }));
  },
  mkdir: (p) => invoke<void>('mkdir_p', { path: p }),
  remove: (p, recursive) =>
    invoke<void>('remove_path', { path: p, recursive: recursive ?? false }),
  rename: () => Promise.reject(new Error('rawFs 不支持 rename')),
  copyDir: (src, dst) => copyDirRecursive(src, dst),
  isSymlink: (p) => invoke<boolean>('is_symlink', { path: p }),
  readLink: (p) => invoke<string>('read_symlink', { path: p }),
  symlink: (target, link) =>
    invoke<void>('create_symlink', { target, link }),
  gitClone: (url, dest) => invoke<void>('git_clone', { url, dest }),
};
