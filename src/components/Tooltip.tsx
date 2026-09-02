import React, { useId } from 'react';

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  /** The content shown while the trigger is hovered or focused. */
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: TooltipPlacement;
  isDark?: boolean;
  className?: string;
}

const placementClasses: Record<TooltipPlacement, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  bottom: 'left-1/2 top-full mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
};

/** Shared, non-blocking contextual hint for buttons and compact controls. */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = 'top',
  isDark = false,
  className = '',
}) => {
  const id = useId();

  if (content === null || content === undefined || content === '') return children;

  return (
    <span className={`group relative inline-flex ${className}`}>
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-[60] w-max max-w-64 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold leading-4 opacity-0 shadow-lg transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${placementClasses[placement]} ${
          isDark
            ? 'border border-slate-700 bg-slate-900 text-slate-100 shadow-black/30'
            : 'border border-slate-200 bg-slate-900 text-white shadow-slate-900/20'
        }`}
      >
        {content}
      </span>
    </span>
  );
};
