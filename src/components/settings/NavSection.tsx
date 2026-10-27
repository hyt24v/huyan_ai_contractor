/**
 * 设置-导航管理：侧栏工具的显示/隐藏 + 组内拖拽排序。
 * 数据走 lib/navConfig.ts（localStorage + SETTINGS_CHANGED_EVENT），侧栏即时生效。
 */
import { useEffect, useReducer, useState } from 'react';
import { GripVertical, RotateCcw } from 'lucide-react';
import { onSettingsChanged } from '../../lib/settings';
import { TOOL_GROUPS, type ToolDef } from '../../lib/tools';
import {
  isNavCustomized,
  moveWithinGroup,
  navHidden,
  orderedTools,
  resetNavConfig,
  setNavOrder,
  setToolHidden,
} from '../../lib/navConfig';
import { SettingGroup, Toggle } from './ui';

export default function NavSection() {
  // navConfig 变更（含本组件外的重置）时重渲染
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onSettingsChanged(bump), []);

  const [dragPath, setDragPath] = useState<string | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);

  const hidden = new Set(navHidden());
  const ordered = orderedTools();

  const onDrop = (group: ToolDef['group'], targetPath: string) => {
    if (!dragPath || dragPath === targetPath) return;
    const groupItems = ordered.filter((t) => t.group === group);
    const from = groupItems.findIndex((t) => t.path === dragPath);
    const to = groupItems.findIndex((t) => t.path === targetPath);
    setDragPath(null);
    setOverPath(null);
    if (from < 0 || to < 0) return;
    setNavOrder(moveWithinGroup(group, from, to));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          拖拽调整顺序（限组内），开关控制是否在侧栏显示；隐藏后仍可通过链接直达。
        </p>
        {isNavCustomized() && (
          <button
            type="button"
            onClick={resetNavConfig}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            恢复默认
          </button>
        )}
      </div>
      {TOOL_GROUPS.map((group) => {
        const items = ordered.filter((t) => t.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group}
            </div>
            <SettingGroup>
              {items.map((t) => (
                <div
                  key={t.path}
                  draggable
                  onDragStart={() => setDragPath(t.path)}
                  onDragEnd={() => {
                    setDragPath(null);
                    setOverPath(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragPath && dragPath !== t.path) setOverPath(t.path);
                  }}
                  onDragLeave={() => setOverPath((p) => (p === t.path ? null : p))}
                  onDrop={() => onDrop(group, t.path)}
                  className={`flex items-center gap-2 px-3 py-2.5 transition-colors ${
                    dragPath === t.path ? 'opacity-40' : ''
                  } ${overPath === t.path ? 'bg-accent/50' : ''} ${
                    hidden.has(t.path) ? 'opacity-60' : ''
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/50" />
                  <t.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-[13px] text-foreground">{t.name}</span>
                  <Toggle
                    checked={!hidden.has(t.path)}
                    onChange={(on) => setToolHidden(t.path, !on)}
                    label={`显示 ${t.name}`}
                  />
                </div>
              ))}
            </SettingGroup>
          </div>
        );
      })}
    </div>
  );
}
