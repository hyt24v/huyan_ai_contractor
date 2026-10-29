/** 设置-数据与备份:自动备份开关、备份目录/中央库路径与打开 */
import { useEffect, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { FolderOpen } from 'lucide-react';
import { BACKUP_DIR } from '../../lib/backups';
import { SKILL_LIBRARY_DIR } from '../../lib/agents';
import { absPath, tauriFs } from '../../lib/fsPort';
import {
  getAutoBackupEnabled,
  onSettingsChanged,
  setAutoBackupEnabled,
} from '../../lib/settings';
import { useToast } from '../../hooks/useToast';
import { LinkButton, SettingGroup, SettingRow, Toggle } from './ui';
import { FloatingToast } from '../Toast';

export default function DataSection() {
  const [autoBackup, setAutoBackup] = useState(getAutoBackupEnabled);
  const { toast, showToast } = useToast();
  useEffect(() => onSettingsChanged(() => setAutoBackup(getAutoBackupEnabled())), []);

  const openDir = async (rel: string, name: string) => {
    try {
      const abs = await absPath(rel);
      await tauriFs.mkdir(abs);
      await openPath(abs);
    } catch (e) {
      showToast(`打开${name}失败:${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  };

  return (
    <div className="space-y-4">
      <SettingGroup>
        <SettingRow
          label="自动备份 MCP 配置"
          description="应用打开期间每 6 小时自动快照一次各 agent 的 MCP 配置,可在 MCP 管理页回滚"
        >
          <Toggle checked={autoBackup} onChange={setAutoBackupEnabled} label="自动备份 MCP 配置" />
        </SettingRow>
        <SettingRow label="备份目录" description={`~/${BACKUP_DIR}`}>
          <LinkButton onClick={() => openDir(BACKUP_DIR, '备份目录')}>
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" />
              打开
            </span>
          </LinkButton>
        </SettingRow>
        <SettingRow
          label="Skills 中央库"
          description={`~/${SKILL_LIBRARY_DIR} — 所有 skill 的单一存储位置,可 git 管理`}
        >
          <LinkButton onClick={() => openDir(SKILL_LIBRARY_DIR, '中央库')}>
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" />
              打开
            </span>
          </LinkButton>
        </SettingRow>
      </SettingGroup>

      {toast && <FloatingToast toast={toast} />}
    </div>
  );
}
