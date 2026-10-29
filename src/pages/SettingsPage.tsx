/** 设置页:左侧分组导航 + 右侧内容(skills-manager / VSCode 风格);Esc 返回上一页(cc-switch 风格) */
import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  ArrowUpCircle,
  BookOpen,
  Bot,
  Database,
  Info,
  ListOrdered,
  Palette,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import AppearanceSection from '../components/settings/AppearanceSection';
import UpdatesSection from '../components/settings/UpdatesSection';
import AgentsSection from '../components/settings/AgentsSection';
import AiSection from '../components/settings/AiSection';
import NavSection from '../components/settings/NavSection';
import DataSection from '../components/settings/DataSection';
import WikiSection from '../components/settings/WikiSection';
import AboutSection from '../components/settings/AboutSection';

interface SectionDef {
  id: string;
  name: string;
  icon: LucideIcon;
  element: () => JSX.Element;
}

const SECTIONS: SectionDef[] = [
  { id: 'appearance', name: '外观', icon: Palette, element: AppearanceSection },
  { id: 'nav', name: '导航管理', icon: ListOrdered, element: NavSection },
  { id: 'updates', name: '软件更新', icon: ArrowUpCircle, element: UpdatesSection },
  { id: 'agents', name: 'Agent 管理', icon: Bot, element: AgentsSection },
  { id: 'ai', name: 'AI 助手', icon: Sparkles, element: AiSection },
  { id: 'wiki', name: '知识库', icon: BookOpen, element: WikiSection },
  { id: 'data', name: '数据与备份', icon: Database, element: DataSection },
  { id: 'about', name: '关于', icon: Info, element: AboutSection },
];

export default function SettingsPage() {
  const navigate = useNavigate();

  // Esc 返回上一页;有弹窗(role=dialog,如命令面板/确认弹窗)打开时让给弹窗自己处理
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      navigate(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full min-h-0">
      {/* 分组导航 */}
      <nav className="w-36 shrink-0 space-y-0.5 border-r border-border/40 p-2">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.id}
            to={`/settings/${s.id}`}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                isActive
                  ? 'bg-card font-medium text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              }`
            }
          >
            <s.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{s.name}</span>
          </NavLink>
        ))}
      </nav>

      {/* 内容区 */}
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
        <Routes>
          <Route index element={<Navigate to="appearance" replace />} />
          {SECTIONS.map((s) => (
            <Route key={s.id} path={s.id} element={<s.element />} />
          ))}
          <Route path="*" element={<Navigate to="appearance" replace />} />
        </Routes>
      </div>
    </div>
  );
}
