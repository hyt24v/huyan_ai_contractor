import { useSyncExternalStore } from 'react';
import {
  applyThemeToDocument,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getTheme,
  type ThemeAppearance,
  type ThemeDefinition,
} from '../lib/themes';

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ThemeSettings {
  mode: ThemeMode;
  lightThemeId: string;
  darkThemeId: string;
}

const STORAGE_KEY = 'huyan_tool:theme.v2';

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
      return {
        mode: parsed.mode === 'light' || parsed.mode === 'dark' ? parsed.mode : 'auto',
        lightThemeId: parsed.lightThemeId ?? DEFAULT_LIGHT_THEME,
        darkThemeId: parsed.darkThemeId ?? DEFAULT_DARK_THEME,
      };
    }
    // 迁移旧版单一明暗开关
    const legacy = localStorage.getItem('huyan_tool:theme');
    if (legacy === 'light') {
      return { mode: 'light', lightThemeId: DEFAULT_LIGHT_THEME, darkThemeId: DEFAULT_DARK_THEME };
    }
    if (legacy === 'dark') {
      return { mode: 'dark', lightThemeId: DEFAULT_LIGHT_THEME, darkThemeId: DEFAULT_DARK_THEME };
    }
  } catch {
    /* localStorage 不可用时走默认 */
  }
  return { mode: 'auto', lightThemeId: DEFAULT_LIGHT_THEME, darkThemeId: DEFAULT_DARK_THEME };
}

const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)');

function resolveTheme(settings: ThemeSettings): ThemeDefinition {
  const appearance: ThemeAppearance =
    settings.mode === 'auto'
      ? systemDark?.matches
        ? 'dark'
        : 'light'
      : settings.mode;
  return getTheme(appearance === 'dark' ? settings.darkThemeId : settings.lightThemeId);
}

let settings: ThemeSettings = loadSettings();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function apply(): void {
  applyThemeToDocument(resolveTheme(settings));
}

export function setThemeMode(mode: ThemeMode): void {
  settings = { ...settings, mode };
  persist();
  apply();
  emit();
}

export function setThemeForAppearance(appearance: ThemeAppearance, themeId: string): void {
  settings =
    appearance === 'dark'
      ? { ...settings, darkThemeId: themeId }
      : { ...settings, lightThemeId: themeId };
  persist();
  apply();
  emit();
}

/** 预览主题（不落盘），传 null 恢复正式主题 */
export function previewTheme(themeId: string | null): void {
  applyThemeToDocument(themeId ? getTheme(themeId) : resolveTheme(settings));
}

export function getThemeSettings(): ThemeSettings {
  return settings;
}

export function getActiveTheme(): ThemeDefinition {
  return resolveTheme(settings);
}

systemDark?.addEventListener?.('change', () => {
  if (settings.mode === 'auto') {
    apply();
    emit();
  }
});

export function useThemeSettings(): ThemeSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getThemeSettings,
  );
}

export function useActiveTheme(): ThemeDefinition {
  useThemeSettings();
  return resolveTheme(settings);
}

/** 应用启动时调用一次（渲染前），避免主题闪烁 */
export function bootstrapTheme(): void {
  apply();
}
