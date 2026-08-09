import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Mail,
  UserPlus,
  Calendar,
  Users,
  BarChart3,
  Ticket,
  Settings,
} from 'lucide-react';
import { NavTab, StylePreset } from '../types';

interface WorkbenchSidebarNavProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  totalUnreadCount: number;
  currentPreset: StylePreset;
}

export const WorkbenchSidebarNav: React.FC<WorkbenchSidebarNavProps> = ({
  activeTab,
  setActiveTab,
  totalUnreadCount,
  currentPreset,
}) => {
  const [hoveredTab, setHoveredTab] = useState<NavTab | null>(null);
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  const mainNavItems: {
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    {
      id: 'email',
      label: '邮箱管理',
      icon: <Mail className="w-5 h-5" />,
      badge: totalUnreadCount,
    },
    {
      id: 'register',
      label: '注册',
      icon: <UserPlus className="w-5 h-5" />,
    },
    {
      id: 'calendar',
      label: '日历日程',
      icon: <Calendar className="w-5 h-5" />,
    },
    {
      id: 'contacts',
      label: '联系人',
      icon: <Users className="w-5 h-5" />,
    },
    {
      id: 'analytics',
      label: '数据统计',
      icon: <BarChart3 className="w-5 h-5" />,
    },
    {
      id: 'tickets',
      label: '工单协同',
      icon: <Ticket className="w-5 h-5" />,
    },
    {
      id: 'settings',
      label: '系统设置',
      icon: <Settings className="w-5 h-5" />,
    },
  ];

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
      <nav className="flex-1 p-2 space-y-1.5 overflow-y-auto">
        <div className="hidden sm:block text-[10px] font-bold text-slate-400 px-2.5 py-1 uppercase tracking-wider">
          核心工作台模块
        </div>

        {mainNavItems.map((item) => {
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
              title={item.label}
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
    </aside>
  );
};
