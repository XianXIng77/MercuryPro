import React, { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Info, LoaderCircle, Trash2, X } from 'lucide-react';
import type { StylePreset } from '../types';

export type ConfirmDialogTone = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  detail?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  loading?: boolean;
  currentPreset: StylePreset;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_STYLES: Record<ConfirmDialogTone, {
  label: string;
  icon: React.ReactNode;
  iconBox: string;
  confirm: string;
}> = {
  danger: {
    label: '危险操作',
    icon: <Trash2 className="w-5 h-5" />,
    iconBox: 'bg-rose-500/10 text-rose-500 ring-rose-500/20',
    confirm: 'bg-rose-600 hover:bg-rose-500 focus:ring-rose-500/30 shadow-rose-950/20',
  },
  warning: {
    label: '操作确认',
    icon: <AlertTriangle className="w-5 h-5" />,
    iconBox: 'bg-amber-500/10 text-amber-500 ring-amber-500/20',
    confirm: 'bg-amber-500 hover:bg-amber-400 focus:ring-amber-500/30 shadow-amber-950/20',
  },
  info: {
    label: '请确认',
    icon: <Info className="w-5 h-5" />,
    iconBox: 'bg-blue-500/10 text-blue-500 ring-blue-500/20',
    confirm: 'bg-blue-600 hover:bg-blue-500 focus:ring-blue-500/30 shadow-blue-950/20',
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  detail,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'danger',
  loading = false,
  currentPreset,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const isDark = currentPreset.mode === 'dark';
  const style = TONE_STYLES[tone];

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => cancelButtonRef.current?.focus(), 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [loading, onCancel, open]);

  return <AnimatePresence>
    {open && <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[3px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onCancel();
      }}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        initial={{ opacity: 0, y: 18, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        className={`relative w-full max-w-md overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.35)] ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${style.iconBox}`}>{style.icon}</div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{style.label}</p>
              <h2 id={titleId} className={`mt-1 text-base font-bold tracking-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{title}</h2>
              <div id={descriptionId} className={`mt-2 text-xs leading-5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{description}</div>
            </div>
            <button type="button" aria-label="关闭弹框" disabled={loading} onClick={onCancel} className={`-mr-1 -mt-1 rounded-lg p-1.5 transition disabled:opacity-40 ${isDark ? 'text-slate-500 hover:bg-white/5 hover:text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}><X className="h-4 w-4" /></button>
          </div>

          {detail && <div className={`mt-4 rounded-xl border px-3.5 py-3 text-[11px] leading-5 ${isDark ? 'border-slate-700/80 bg-slate-950/55 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{detail}</div>}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <motion.button ref={cancelButtonRef} autoFocus type="button" disabled={loading} onClick={onCancel} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} className={`rounded-xl border px-4 py-2.5 text-xs font-bold outline-none transition focus:ring-2 disabled:opacity-50 ${isDark ? 'border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-800 focus:ring-slate-600/40' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-300/50'}`}>{cancelLabel}</motion.button>
            <motion.button type="button" disabled={loading} onClick={onConfirm} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-lg outline-none transition focus:ring-2 disabled:cursor-wait disabled:opacity-60 ${style.confirm}`}>{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}{loading ? '处理中...' : confirmLabel}</motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>}
  </AnimatePresence>;
};
