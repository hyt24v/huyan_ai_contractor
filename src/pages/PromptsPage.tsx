import { FileText } from 'lucide-react';

export default function PromptsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <FileText className="h-8 w-8" />
      <div className="text-sm">提示词管理正在开发中…</div>
    </div>
  );
}