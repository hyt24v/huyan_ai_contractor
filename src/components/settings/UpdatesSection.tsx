/** 设置-软件更新:版本、检查/下载/重启更新、自动检查开关、GitHub 链接 */
import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ArrowUpCircle, Check, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useUpdater } from '../../hooks/useUpdater';
import {
  getAutoCheckUpdate,
  onSettingsChanged,
  setAutoCheckUpdate,
} from '../../lib/settings';
import { GITHUB_LINKS } from '../../lib/links';
import { LinkButton, SettingGroup, SettingRow, Toggle } from './ui';
import UpdateDialog from '../UpdateDialog';
import { useEffect } from 'react';

export default function UpdatesSection() {
  const { version, status, toast, check, relaunch } = useUpdater();
  const [autoCheck, setAutoCheck] = useState(getAutoCheckUpdate);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => onSettingsChanged(() => setAutoCheck(getAutoCheckUpdate())), []);

  const busy = status.kind === 'checking' || status.kind === 'downloading';

  const primaryAction = () => {
    if (status.kind === 'idle' || status.kind === 'latest') {
      check(false).catch(() => undefined);
    } else if (status.kind === 'available') {
      setDialogOpen(true);
    } else if (status.kind === 'ready') {
      relaunch();
    }
  };

  const primaryLabel = () => {
    switch (status.kind) {
      case 'checking':
        return '检查更新中…';
      case 'downloading':
        return status.percent !== null ? `下载中 ${status.percent}%` : '下载中…';
      case 'available':
        return `查看 v${status.update.version}`;
      case 'ready':
        return '重启完成更新';
      case 'latest':
        return '再次检查';
      default:
        return '检查更新';
    }
  };

  return (
    <div className="space-y-4">
      <SettingGroup>
        <SettingRow
          label={version ? `当前版本 v${version}` : '当前版本 未知'}
          description={
            status.kind === 'available'
              ? `发现新版本 v${status.update.version},点击查看更新内容`
              : status.kind === 'latest'
                ? '已是最新版本'
                : 'beta 与正式版共用同一更新通道,谁新更谁'
          }
        >
          <LinkButton primary onClick={primaryAction}>
            <span className="inline-flex items-center gap-1.5">
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : status.kind === 'available' || status.kind === 'ready' ? (
                <ArrowUpCircle className="h-3.5 w-3.5" />
              ) : status.kind === 'latest' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {primaryLabel()}
            </span>
          </LinkButton>
        </SettingRow>
        <SettingRow label="启动时自动检查更新" description="打开应用后静默检查一次,发现新版本会在设置图标上显示红点">
          <Toggle checked={autoCheck} onChange={setAutoCheckUpdate} label="启动时自动检查更新" />
        </SettingRow>
      </SettingGroup>

      <div>
        <h3 className="mb-2 text-[13px] font-medium text-foreground">GitHub</h3>
        <SettingGroup>
          {GITHUB_LINKS.map((l) => (
            <SettingRow key={l.url} label={l.name} description={l.url}>
              <button
                type="button"
                onClick={() => openUrl(l.url).catch(() => undefined)}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                打开
                <ExternalLink className="h-3 w-3" />
              </button>
            </SettingRow>
          ))}
        </SettingGroup>
      </div>

      {dialogOpen && status.kind === 'available' && (
        <UpdateDialog
          update={status.update}
          currentVersion={version}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {toast && (
        <div
          className={`w-fit rounded-md border px-3 py-1.5 text-xs shadow-lg ${
            toast.tone === 'err'
              ? 'border-destructive/40 bg-destructive text-destructive-foreground'
              : 'bg-card text-foreground'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
