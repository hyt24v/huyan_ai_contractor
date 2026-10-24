/** 设置-外观:主题模式 + 浅色/深色主题选择(内容同原 ThemeSwitcher,改为内嵌面板) */
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { THEMES, type ThemeAppearance } from '../../lib/themes';
import {
  getActiveTheme,
  previewTheme,
  setThemeForAppearance,
  setThemeMode,
  useThemeSettings,
  type ThemeMode,
} from '../../hooks/useThemeSettings';

const MODES: { id: ThemeMode; name: string; icon: typeof Monitor }[] = [
  { id: 'auto', name: '跟随系统', icon: Monitor },
  { id: 'light', name: '浅色', icon: Sun },
  { id: 'dark', name: '深色', icon: Moon },
];

const APPEARANCE_GROUPS: { id: ThemeAppearance; name: string }[] = [
  { id: 'light', name: '浅色主题' },
  { id: 'dark', name: '深色主题' },
];

export default function AppearanceSection() {
  const settings = useThemeSettings();
  const activeTheme = getActiveTheme();
  const selectedId = (appearance: ThemeAppearance) =>
    appearance === 'dark' ? settings.darkThemeId : settings.lightThemeId;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-[13px] font-medium text-foreground">主题模式</h3>
        <div className="grid w-72 grid-cols-3 gap-1 rounded-md bg-muted p-1">
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
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          当前主题:{activeTheme.name}
        </p>
      </div>

      {APPEARANCE_GROUPS.map((g) => (
        <div key={g.id}>
          <h3 className="mb-2 text-[13px] font-medium text-foreground">{g.name}</h3>
          <div className="grid max-w-lg grid-cols-2 gap-2">
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
                    <span className="truncate text-xs text-foreground">{t.name}</span>
                    {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
