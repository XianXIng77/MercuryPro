import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { StylePreset } from '../types';

interface PermissionEmptyStateProps {
  currentPreset: StylePreset;
  description?: string;
}

export const PermissionEmptyState: React.FC<PermissionEmptyStateProps> = ({ currentPreset, description = '暂无访问权限' }) => {
  const theme = currentPreset.themeClasses;
  return (
    <div className={`flex flex-1 items-center justify-center p-6 ${theme.appBg}`}>
      <div className={`flex w-full max-w-sm flex-col items-center rounded-2xl border p-8 text-center ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
        <ShieldAlert className="h-12 w-12 text-rose-500" aria-hidden="true" />
        <h2 className={`mt-4 text-lg font-black ${theme.textPrimary}`}>无权限</h2>
        <p className={`mt-2 text-sm ${theme.textSecondary}`}>{description}</p>
      </div>
    </div>
  );
};
