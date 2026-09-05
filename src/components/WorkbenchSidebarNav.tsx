import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  Mail,
  ScrollText,
  UserPlus,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  CircleUserRound,
  LogOut,
} from 'lucide-react';
import { NavTab, StylePreset } from '../types';
import menuRegistry from '../data/menu-registry.json';

interface WorkbenchSidebarNavProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  totalUnreadCount: number;
  currentPreset: StylePreset;
  /** Backend menu keys; omitted means show the existing full menu set. */
  menuKeys?: string[];
  onLogout: () => void;
}

export const WorkbenchSidebarNav: React.FC<WorkbenchSidebarNavProps> = ({
  activeTab,
  setActiveTab,
  totalUnreadCount,
  currentPreset,
  menuKeys,
  onLogout,
}) => {
  const [hoveredTab, setHoveredTab] = useState<NavTab | null>(null);
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  const iconForMenu = (key: string) => key === 'dashboard' ? <LayoutDashboard className="w-5 h-5" /> : key === 'email' ? <Mail className="w-5 h-5" /> : key === 'register' ? <UserPlus className="w-5 h-5" /> : key === 'invite' ? <KeyRound className="w-5 h-5" /> : key === 'logs' ? <ScrollText className="w-5 h-5" /> : key === 'audit' ? <ShieldCheck className="w-5 h-5" /> : key === 'access' ? <SlidersHorizontal className="w-5 h-5" /> : <CircleUserRound className="w-5 h-5" />;
  const mainNavItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: number }> = menuRegistry.filter((menu) => menu.key !== 'profile').map((menu) => ({ id: menu.key as NavTab, label: menu.label, icon: iconForMenu(menu.key), ...(menu.key === 'email' ? { badge: totalUnreadCount } : {}) }));
  const profileItem: { id: NavTab; label: string; icon: React.ReactNode; badge?: number } = { id: 'profile', label: '个人中心', icon: <CircleUserRound className="w-5 h-5" /> };

  return (
    <aside
      className={`w-16 sm:w-56 shrink-0 flex flex-col border-r transition-colors duration-200 ${theme.sidebarBg} ${theme.border} h-full select-none`}
    >
      {/* Brand Identity / Workspace Header */}
      <div className={`h-14 px-3 sm:px-4 flex items-center justify-between border-b shrink-0 ${
        isDark ? 'border-slate-800' : 'border-slate-200/80'
      }`}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold italic shadow-xs shrink-0">
            M
          </div>
          <div className="hidden sm:block truncate">
            <h1 className={`font-bold text-sm tracking-tight flex items-center gap-1.5 ${
              isDark ? 'text-slate-100' : 'text-slate-900'
            }`}>
              <span className="font-extrabold tracking-wide">MERCURY</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600 text-white font-mono font-bold shrink-0">
                PRO
              </span>
            </h1>
            <p className={`text-[10px] truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>个人工作台</p>
          </div>
        </div>
      </div>

      {/* Main Workbench Nav Items */}
      <nav className="flex-1 p-2 space-y-1.5 overflow-visible">
        <div className="hidden sm:block text-[10px] font-bold text-slate-400 px-2.5 py-1 uppercase tracking-wider">
          核心工作台模块
        </div>

        {[...mainNavItems, profileItem].filter((item) => item.id === 'profile' || !menuKeys || menuKeys.includes(item.id)).map((item) => {
          const isActive = activeTab === item.id;
          const isHovered = hoveredTab === item.id;
          const isHighlighted = isActive || isHovered;

          return (
            <motion.button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              onMouseEnter={() => setHoveredTab(item.id)}
              onMouseLeave={() => setHoveredTab(null)}
              whileHover={{ scale: 1.02, x: 3 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className={`relative w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-150 ${
                isHighlighted
                  ? 'bg-blue-600 text-white shadow-xs'
                  : isDark
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {/* Active Tab Sliding Pill Animation */}
              {isActive && (
                <motion.div
                  layoutId="activeNavHighlight"
                  className="absolute inset-0 bg-blue-600 rounded-lg shadow-sm shadow-blue-500/25 -z-10"
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                />
              )}

              <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                <span className={`transition-colors duration-150 ${isHighlighted ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                  {item.icon}
                </span>
                <span className="hidden sm:inline font-semibold truncate">{item.label}</span>
              </div>

              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`relative z-10 hidden sm:inline-block px-1.5 py-0.2 text-[10px] rounded-full font-bold transition-colors duration-150 ${
                    isHighlighted
                      ? 'bg-white/25 text-white'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Logout Action */}
      <div className={`shrink-0 p-2 border-t ${isDark ? 'border-slate-800' : 'border-slate-200/80'}`}>
        <motion.button
          type="button"
          onClick={onLogout}
          title="退出登录"
          whileHover={{ scale: 1.02, x: 3 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-150 ${
            isDark
              ? 'text-slate-400 hover:bg-rose-500/10 hover:text-rose-400'
              : 'text-slate-600 hover:bg-rose-50 hover:text-rose-600'
          }`}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          <span className="hidden sm:inline">退出登录</span>
        </motion.button>
      </div>
    </aside>
  );
};

