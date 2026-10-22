/** skill 卡片网格 / 列表容器 + 空状态 */
import type { ReactNode } from 'react';

export default function SkillGrid({
  layout,
  isEmpty,
  empty,
  children,
}: {
  layout: 'grid' | 'list';
  isEmpty: boolean;
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (isEmpty) {
    return <>{empty}</>;
  }
  return (
    <div
      className={
        layout === 'grid'
          ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'
          : 'flex flex-col gap-1.5'
      }
    >
      {children}
    </div>
  );
}