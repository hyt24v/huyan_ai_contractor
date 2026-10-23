import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { THEMES, type ThemeAppearance } from '../lib/themes';
import {
  getActiveTheme,
  previewTheme,
  setThemeForAppearance,
  setThemeMode,
  useThemeSettings,
  type ThemeMode,
} from '../hooks/useThemeSettings';

const MODES: { id: ThemeMode; name: string; icon: typeof Monitor }[] = [
  { id: 'auto', name: '跟随系统', icon: Monitor },
  { id: 'light', name: '浅色', icon: Sun },
  { id: 'dark', name: '深色', icon: Moon },
];

const APPEARANCE_GROUPS: { id: ThemeAppearance; name: string }[] = [
  { id: 'light', name: '浅色主题' },
  { id: 'dark', name: '深色主题' },
];

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const settings = useThemeSettings();
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭并结束预览
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        previewTheme(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        previewTheme(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeTheme = getActiveTheme();
  const selectedId = (appearance: ThemeAppearance) =>
    appearance === 'dark' ? settings.darkThemeId : settings.lightThemeId;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
          open
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
        }`}
        title={`主题：${activeTheme.name}`}
        aria-label="切换主题"
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute bottom-1 left-11 z-50 w-72 rounded-md border bg-card p-3 shadow-lg">
          {/* 模式 */}
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setThemeMode(m.id)}
                className={`flex items-center justify-center gap-1 rounded-sm px-2 py-1 text-xs transition-colors ${
                  settings.mode === m.id
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.name}
              </button>
            ))}
          </div>

          {/* 主题卡片：浅色/深色分组平铺 */}
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {APPEARANCE_GROUPS.map((g) => (
              <div key={g.id}>
                <div className="mb-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">
                  {g.name}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.filter((t) => t.appearance === g.id).map((t) => {
                    const selected = selectedId(g.id) === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setThemeForAppearance(t.appearance, t.id)}
                        onMouseEnter={() => previewTheme(t.id)}
                        onMouseLeave={() => previewTheme(null)}
                        className={`group rounded-md border p-2 text-left transition-colors ${
                          selected
                            ? 'border-primary'
                            : 'border-border/60 hover:border-foreground/30'
                        }`}
                      >
                        <div className="mb-1.5 flex h-8 overflow-hidden rounded-sm">
                          {t.swatch.map((c, i) => (
                            <span
                              key={i}
                              className={i === 0 ? 'flex-[1.4]' : 'flex-1'}
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs text-foreground">
                            {t.name}
                          </span>
                          {selected && (
                            <Check className="h-3 w-3 shrink-0 text-primary" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
