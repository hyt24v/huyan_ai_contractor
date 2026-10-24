/** 设置-关于:图标、版本、项目链接 */
import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink } from 'lucide-react';
import { currentVersion } from '../../lib/updater';
import { GITHUB_LINKS, REPO_URL } from '../../lib/links';
import logo from '../../../src-tauri/icons/icon.png';

export default function AboutSection() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    currentVersion()
      .then(setVersion)
      .catch(() => setVersion(''));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-4">
        <img src={logo} alt="AI包工头" className="h-12 w-12 rounded-lg shadow-sm" />
        <div>
          <div className="text-sm font-semibold text-foreground">AI包工头</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            v{version} · 纯本地 AI 工具箱,数据不出本机
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            React + TypeScript + Tauri 2(Rust)
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {GITHUB_LINKS.map((l) => (
          <button
            key={l.url}
            type="button"
            onClick={() => openUrl(l.url).catch(() => undefined)}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent/60"
          >
            {l.name}
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        更新通道:{REPO_URL}/releases/download/updater/latest.json
      </p>
    </div>
  );
}
