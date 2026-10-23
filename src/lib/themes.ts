// 主题系统（Otty 范式：主题即数据）
// 每套主题给出完整调色板（hex），applyTheme 时统一转 HSL 注入 CSS 变量。

export type ThemeAppearance = 'light' | 'dark';

export interface ThemeDefinition {
  id: string;
  name: string;
  appearance: ThemeAppearance;
  /** 命令面板/切换器里展示的迷你色板（4 色：背景/卡片/主色/强调） */
  swatch: [string, string, string, string];
  tokens: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    primary: string;
    primaryForeground: string;
    destructive: string;
    destructiveForeground: string;
    warning: string;
    warningForeground: string;
    success: string;
    border: string;
    input: string;
    ring: string;
    /** 最左侧图标条 */
    activitybar: string;
    /** 导航面板 */
    sidebar: string;
  };
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    appearance: 'dark',
    swatch: ['#0a0a14', '#12121f', '#82aaff', '#c792ea'],
    tokens: {
      background: '#0a0a14',
      foreground: '#e0e0ff',
      card: '#12121f',
      cardForeground: '#e0e0ff',
      muted: '#171726',
      mutedForeground: '#8a8aa8',
      accent: '#1e1e32',
      accentForeground: '#e0e0ff',
      primary: '#82aaff',
      primaryForeground: '#0a0a14',
      destructive: '#ff4d6d',
      destructiveForeground: '#0a0a14',
      warning: '#ffd66b',
      warningForeground: '#0a0a14',
      success: '#7be0ad',
      border: '#262640',
      input: '#262640',
      ring: '#82aaff',
      activitybar: '#0d0d1a',
      sidebar: '#10101d',
    },
  },
  {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    appearance: 'dark',
    swatch: ['#282c34', '#21252b', '#61afef', '#c678dd'],
    tokens: {
      background: '#282c34',
      foreground: '#abb2bf',
      card: '#21252b',
      cardForeground: '#abb2bf',
      muted: '#2c313a',
      mutedForeground: '#7f848e',
      accent: '#2c313c',
      accentForeground: '#d7dae0',
      primary: '#61afef',
      primaryForeground: '#21252b',
      destructive: '#e06c75',
      destructiveForeground: '#21252b',
      warning: '#e5c07b',
      warningForeground: '#21252b',
      success: '#98c379',
      border: '#3e4451',
      input: '#3e4451',
      ring: '#61afef',
      activitybar: '#1f242b',
      sidebar: '#242930',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    appearance: 'dark',
    swatch: ['#1e1e2e', '#181825', '#89b4fa', '#cba6f7'],
    tokens: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      card: '#181825',
      cardForeground: '#cdd6f4',
      muted: '#313244',
      mutedForeground: '#a6adc8',
      accent: '#313244',
      accentForeground: '#cdd6f4',
      primary: '#89b4fa',
      primaryForeground: '#181825',
      destructive: '#f38ba8',
      destructiveForeground: '#181825',
      warning: '#f9e2af',
      warningForeground: '#181825',
      success: '#a6e3a1',
      border: '#45475a',
      input: '#45475a',
      ring: '#89b4fa',
      activitybar: '#11111b',
      sidebar: '#181825',
    },
  },
  {
    id: 'everforest',
    name: 'Everforest',
    appearance: 'dark',
    swatch: ['#2d353b', '#343f44', '#7fbbb3', '#a7c080'],
    tokens: {
      background: '#2d353b',
      foreground: '#d3c6aa',
      card: '#343f44',
      cardForeground: '#d3c6aa',
      muted: '#3d484d',
      mutedForeground: '#859289',
      accent: '#3d484d',
      accentForeground: '#d3c6aa',
      primary: '#7fbbb3',
      primaryForeground: '#2d353b',
      destructive: '#e67e80',
      destructiveForeground: '#2d353b',
      warning: '#dbbc7f',
      warningForeground: '#2d353b',
      success: '#a7c080',
      border: '#4a5653',
      input: '#4a5653',
      ring: '#7fbbb3',
      activitybar: '#272e33',
      sidebar: '#313b41',
    },
  },
  {
    id: 'sakura-macaron',
    name: 'Sakura Macaron',
    appearance: 'light',
    swatch: ['#fdf2f5', '#ffffff', '#e0719c', '#8f6fb8'],
    tokens: {
      background: '#fdf2f5',
      foreground: '#503a44',
      card: '#ffffff',
      cardForeground: '#503a44',
      muted: '#f7e4ea',
      mutedForeground: '#9a7b88',
      accent: '#fbe3ec',
      accentForeground: '#503a44',
      primary: '#e0719c',
      primaryForeground: '#ffffff',
      destructive: '#d1556b',
      destructiveForeground: '#ffffff',
      warning: '#c98a2e',
      warningForeground: '#ffffff',
      success: '#4c9a6c',
      border: '#f0d3de',
      input: '#f0d3de',
      ring: '#e0719c',
      activitybar: '#f9e3ec',
      sidebar: '#fceef3',
    },
  },
  {
    id: 'minimal-light',
    name: 'Minimal Light',
    appearance: 'light',
    swatch: ['#fafafa', '#ffffff', '#2563eb', '#71717a'],
    tokens: {
      background: '#fafafa',
      foreground: '#1c1c1e',
      card: '#ffffff',
      cardForeground: '#1c1c1e',
      muted: '#f0f0f2',
      mutedForeground: '#71717a',
      accent: '#f0f0f2',
      accentForeground: '#1c1c1e',
      primary: '#2563eb',
      primaryForeground: '#ffffff',
      destructive: '#dc2626',
      destructiveForeground: '#ffffff',
      warning: '#d97706',
      warningForeground: '#ffffff',
      success: '#059669',
      border: '#e4e4e7',
      input: '#e4e4e7',
      ring: '#2563eb',
      activitybar: '#f0f0f2',
      sidebar: '#fafafa',
    },
  },
];

export const DEFAULT_DARK_THEME = 'midnight';
export const DEFAULT_LIGHT_THEME = 'minimal-light';

export function getTheme(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** #rrggbb → "H S% L%"（Tailwind hsl(var(--x)) 需要的三段式） */
export function hexToHslTriple(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '0 0% 0%';
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const TOKEN_CSS_VAR: Record<keyof ThemeDefinition['tokens'], string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  warning: '--warning',
  warningForeground: '--warning-foreground',
  success: '--success',
  border: '--border',
  input: '--input',
  ring: '--ring',
  activitybar: '--activitybar',
  sidebar: '--sidebar',
};

/** 把主题注入到 <html>：CSS 变量 + data-theme + dark class（兼容既有 dark: 变体） */
export function applyThemeToDocument(theme: ThemeDefinition): void {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(TOKEN_CSS_VAR)) {
    const hex = theme.tokens[key as keyof ThemeDefinition['tokens']];
    root.style.setProperty(cssVar, hexToHslTriple(hex));
  }
  root.dataset.theme = theme.id;
  root.classList.toggle('dark', theme.appearance === 'dark');
  root.style.colorScheme = theme.appearance;
}
