import { Server } from 'lucide-react';

export default function ProvidersPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Server className="h-8 w-8" />
      <div className="text-sm">模型服务管理正在开发中…</div>
    </div>
  );
}