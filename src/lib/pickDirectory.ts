import { open } from '@tauri-apps/plugin-dialog';

/**
 * 弹出系统目录选择器，返回用户选择的目录绝对路径；取消返回 null。
 * 统一入口，避免各页面重复引插件。
 */
export async function pickDirectory(title?: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: title ?? '选择目录',
  });
  return typeof selected === 'string' ? selected : null;
}
