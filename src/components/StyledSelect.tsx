import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';

export interface StyledSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface StyledSelectProps {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  isDark: boolean;
  className?: string;
  disabled?: boolean;
}

export function StyledSelect({
  value,
  options,
  onChange,
  ariaLabel,
  isDark,
  className = '',
  disabled = false,
}: StyledSelectProps) {
  const [open, setOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  useLayoutEffect(() => {
    if (!open) return;
    const updateDirection = () => {
      const root = rootRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!root || !menu) return;
      const menuHeight = Math.min(menu.scrollHeight, 288);
      const spaceBelow = window.innerHeight - root.bottom - 12;
      const spaceAbove = root.top - 12;
      setOpenUpwards(spaceBelow < menuHeight && spaceAbove > spaceBelow);
    };
    updateDirection();
    window.addEventListener('resize', updateDirection);
    window.addEventListener('scroll', updateDirection, true);
    return () => {
      window.removeEventListener('resize', updateDirection);
      window.removeEventListener('scroll', updateDirection, true);
    };
  }, [open, options]);

  const choose = (option: StyledSelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      if (!open) {
        setOpen(true);
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + direction + options.length) % options.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !open) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const activeOption = options[activeIndex];
      if (activeOption) choose(activeOption);
    }
  };

  return <div ref={rootRef} className="relative w-full">
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleKeyDown}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.975 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      className={`w-full px-3 py-2 text-xs rounded-lg border outline-none transition focus:ring-2 focus:ring-blue-500/40 ${isDark ? 'bg-white/[0.035] border-white/10 text-slate-100' : 'bg-black/[0.025] border-black/10 text-slate-800'} ${className} flex items-center justify-between gap-3 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'ring-2 ring-blue-500/35 border-blue-400' : ''}`}
    >
      <motion.span key={value} initial={{ opacity: 0, y: 5, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 460, damping: 22 }} className="min-w-0 truncate">{selected?.label || value}</motion.span>
      <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-blue-500' : ''}`} />
    </motion.button>
    <AnimatePresence>
    {open && <motion.div ref={menuRef} role="listbox" aria-label={ariaLabel} initial={{ opacity: 0, y: openUpwards ? 8 : -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: openUpwards ? 5 : -5, scale: 0.985, transition: { duration: 0.12, ease: 'easeOut' } }} transition={{ type: 'spring', stiffness: 420, damping: 27 }} className={`absolute z-50 left-0 min-w-full w-max max-w-[min(24rem,calc(100vw-2rem))] max-h-72 overflow-y-auto rounded-xl border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)] ${openUpwards ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top'} ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
      {options.map((option, index) => {
        const selectedOption = option.value === value;
        const activeOption = index === activeIndex;
        return <motion.button
          key={option.value}
          type="button"
          role="option"
          aria-selected={selectedOption}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}
          whileHover={{ x: 4 }}
          whileTap={{ scale: 0.985 }}
          transition={{ type: 'spring', stiffness: 430, damping: 24 }}
          className={`relative overflow-hidden w-full min-h-10 px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-left text-xs transition-colors ${selectedOption ? 'text-white' : activeOption ? isDark ? 'bg-slate-800 text-slate-100' : 'bg-blue-50 text-blue-700' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`}
        >
          {selectedOption && <motion.span layoutId={`styled-select-highlight-${ariaLabel}`} className="absolute inset-0 rounded-lg bg-blue-600" transition={{ type: 'spring', stiffness: 420, damping: 28 }} />}
          <span className="relative z-10 min-w-0"><strong className="block font-semibold">{option.label}</strong>{option.description && <small className={`block mt-0.5 ${selectedOption ? 'text-blue-100' : 'text-slate-400'}`}>{option.description}</small>}</span>
          <span className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${selectedOption ? 'bg-white/20' : 'opacity-0'}`}><Check className="w-3.5 h-3.5" /></span>
        </motion.button>;
      })}
    </motion.div>}
    </AnimatePresence>
  </div>;
}
