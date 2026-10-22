import { HeartPulse } from 'lucide-react';

export default function HealthPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <HeartPulse className="h-8 w-8" />
      <div className="text-sm">健康检查功能正在开发中…</div>
    </div>
  );
}