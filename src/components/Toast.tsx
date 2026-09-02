import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** 提示文案 */
  message: string;
  /** 提示类型，默认 success */
  tone?: ToastTone;
  /** 自动关闭时长（毫秒），传 0 表示不自动关闭 */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'duration'>> {
  id: number;
  duration: number;
}

interface ToastContextValue {
  showToast: (options: ToastOptions | string) => number;
  dismissToast: (id: number) => void;
  success: (message: string, duration?: number) => number;
  error: (message: string, duration?: number) => number;
  warning: (message: string, duration?: number) => number;
  info: (message: string, duration?: number) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneMeta: Record<ToastTone, { icon: React.ReactNode; accent: string; iconClass: string }> = {
  success: { icon: <CheckCircle2 className="h-5 w-5" />, accent: 'border-emerald-400/35', iconClass: 'text-emerald-500' },
  error: { icon: <AlertCircle className="h-5 w-5" />, accent: 'border-rose-400/35', iconClass: 'text-rose-500' },
  warning: { icon: <TriangleAlert className="h-5 w-5" />, accent: 'border-amber-400/35', iconClass: 'text-amber-500' },
  info: { icon: <Info className="h-5 w-5" />, accent: 'border-blue-400/35', iconClass: 'text-blue-500' },
};

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions | string) => {
    const normalized: ToastOptions = typeof options === 'string' ? { message: options } : options;
    const id = ++nextId.current;
    const item: ToastItem = {
      id,
      message: normalized.message,
      tone: normalized.tone || 'success',
      duration: normalized.duration === undefined ? 2800 : Math.max(0, normalized.duration),
    };
    setToasts((current) => [...current.slice(-3), item]);
    if (item.duration > 0) {
      timers.current.set(id, window.setTimeout(() => dismissToast(id), item.duration));
    }
    return id;
  }, [dismissToast]);

  useEffect(() => {
    return () => timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    showToast,
    dismissToast,
    success: (message, duration) => showToast({ message, tone: 'success', duration }),
    error: (message, duration) => showToast({ message, tone: 'error', duration }),
    warning: (message, duration) => showToast({ message, tone: 'warning', duration }),
    info: (message, duration) => showToast({ message, tone: 'info', duration }),
  }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 top-4 z-[2147483647] flex flex-col items-center gap-2 px-4"
          aria-live="polite"
          aria-atomic="false"
        >
          <AnimatePresence initial={false}>
            {toasts.map((toast) => {
              const meta = toneMeta[toast.tone];
              return (
                <motion.div
                  key={toast.id}
                  initial={{ opacity: 0, y: -18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  role={toast.tone === 'error' ? 'alert' : 'status'}
                  className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border bg-white/95 px-4 py-3 text-sm text-slate-800 shadow-2xl shadow-slate-950/15 backdrop-blur-xl dark:bg-slate-900/95 dark:text-slate-100 ${meta.accent}`}
                >
                  <span className={`mt-0.5 shrink-0 ${meta.iconClass}`}>{meta.icon}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-semibold leading-5">{toast.message}</span>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    className="-mr-1 rounded-lg p-1 text-slate-400 transition hover:bg-slate-500/10 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label="关闭提示"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用');
  return context;
};
