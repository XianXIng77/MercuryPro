import React, { useId, useState } from 'react';

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  /** The content shown while the trigger is hovered or focused. */
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: TooltipPlacement;
  isDark?: boolean;
  className?: string;
}

/** Shared, non-blocking contextual hint for buttons and compact controls. */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = 'top',
  isDark = false,
  className = '',
}) => {
  const id = useId();
  const [position, setPosition] = useState({ top: 0, left: 0, transform: 'translate(-50%, -100%)' });

  if (content === null || content === undefined || content === '') return children;

  const updatePosition = (event: React.SyntheticEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    let nextPlacement = placement;
    if (nextPlacement === 'top' && rect.top < 120) nextPlacement = 'bottom';
    if (nextPlacement === 'bottom' && window.innerHeight - rect.bottom < 120) nextPlacement = 'top';
    if (nextPlacement === 'left' && rect.left < 280) nextPlacement = 'right';
    if (nextPlacement === 'right' && window.innerWidth - rect.right < 280) nextPlacement = 'left';

    if (nextPlacement === 'bottom') {
      setPosition({ top: rect.bottom + 8, left: rect.left + rect.width / 2, transform: 'translate(-50%, 0)' });
    } else if (nextPlacement === 'left') {
      setPosition({ top: rect.top + rect.height / 2, left: rect.left - 8, transform: 'translate(-100%, -50%)' });
    } else if (nextPlacement === 'right') {
      setPosition({ top: rect.top + rect.height / 2, left: rect.right + 8, transform: 'translate(0, -50%)' });
    } else {
      setPosition({ top: rect.top - 8, left: rect.left + rect.width / 2, transform: 'translate(-50%, -100%)' });
    }
  };

  return (
    <span
      className={`group/tooltip relative inline-flex ${className}`}
      onMouseEnter={updatePosition}
      onFocusCapture={updatePosition}
    >
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        style={{ top: position.top, left: position.left, transform: position.transform }}
        className={`pointer-events-none fixed z-[60] w-max max-w-64 break-all rounded-lg px-2.5 py-1.5 text-[11px] font-semibold leading-4 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${
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

