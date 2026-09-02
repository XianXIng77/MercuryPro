import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StylePreset } from '../types';
import { StyledSelect } from './StyledSelect';

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  loading?: boolean;
  currentPreset: StylePreset;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading = false,
  currentPreset,
  className = '',
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [jumpPageInput, setJumpPageInput] = useState(String(page));

  useEffect(() => {
    setJumpPageInput(String(page));
  }, [page]);

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    return Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  }, [page, totalPages]);

  const handleJumpPage = (event: React.FormEvent) => {
    event.preventDefault();
    const nextPage = Number.parseInt(jumpPageInput, 10);
    if (nextPage >= 1 && nextPage <= totalPages) onPageChange(nextPage);
    else setJumpPageInput(String(page));
  };

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className={`flex items-center gap-4 ${theme.textSecondary}`}>
        <span>共 {total} 条</span>
        <div className="w-28">
          <StyledSelect
            ariaLabel="每页显示数量"
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
            options={[10, 20, 50, 100].map((size) => ({ value: String(size), label: `${size}条/页` }))}
            isDark={isDark}
            className="py-1.5"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} className={`p-1.5 border rounded-lg disabled:opacity-40 ${theme.cardBg} ${theme.border}`} aria-label="上一页">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {pageNumbers.map((pageNumber) => (
          <button key={pageNumber} type="button" disabled={loading} onClick={() => onPageChange(pageNumber)} className={`min-w-9 px-2.5 py-1.5 rounded-lg border font-semibold ${pageNumber === page ? 'bg-blue-600 border-blue-600 text-white' : `${theme.cardBg} ${theme.border} ${theme.textPrimary}`}`}>
            {pageNumber}
          </button>
        ))}
        <button type="button" disabled={loading || page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))} className={`p-1.5 border rounded-lg disabled:opacity-40 ${theme.cardBg} ${theme.border}`} aria-label="下一页">
          <ChevronRight className="w-4 h-4" />
        </button>
        <form onSubmit={handleJumpPage} className={`ml-2 flex items-center gap-1 ${theme.textSecondary}`}>
          <span>前往</span>
          <input value={jumpPageInput} onChange={(event) => setJumpPageInput(event.target.value)} className={`w-12 px-2 py-1.5 text-center border rounded-lg ${theme.cardBg} ${theme.border} ${theme.textPrimary}`} aria-label="前往页码" />
          <span>页</span>
        </form>
      </div>
    </div>
  );
};
