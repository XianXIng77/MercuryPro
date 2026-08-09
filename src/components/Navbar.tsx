import React, { useState } from 'react';
import {
  Search,
  Sparkles,
  Palette,
  Plus,
  RefreshCw,
  Check,
  ChevronDown,
  ArrowDownToLine,
  Sliders,
  Bell,
} from 'lucide-react';
import { NavTab, StylePreset, StylePresetId } from '../types';
import { STYLE_PRESETS } from '../data/stylePresets';

interface NavbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  currentPreset: StylePreset;
  onSelectPreset: (presetId: StylePresetId) => void;
  onRunAiAutoTag: () => void;
  onOpenRuleManager: () => void;
  totalUnreadCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  searchQuery,
  setSearchQuery,
  currentPreset,
  onSelectPreset,
  onRunAiAutoTag,
  onOpenRuleManager,
  totalUnreadCount,
}) => {
  const [showStyleMenu, setShowStyleMenu] = useState(false);

  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.id.includes('dark');

  return (
    <header className={`sticky top-0 z-30 transition-colors duration-200 border-b ${theme.navBg} ${theme.border}`}>
      <div className="w-full px-4 h-14 flex items-center justify-between gap-3">
        {/* Left Workbench Breadcrumb & Search Context */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={theme.textSecondary}>工作台</span>
            <span className={theme.textSecondary}>/</span>
            <span className={`px-2 py-0.5 rounded font-bold border ${
              isDark 
                ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' 
                : 'bg-blue-100/90 text-blue-700 border-blue-300/80'
            }`}>
              {activeTab === 'email' && '邮件管理'}
              {activeTab === 'register' && '注册'}
              {activeTab === 'calendar' && '日历日程'}
              {activeTab === 'contacts' && '通讯录'}
              {activeTab === 'analytics' && '数据统计'}
              {activeTab === 'tickets' && '工单协同'}
              {activeTab === 'settings' && '系统设置'}
            </span>
          </div>
        </div>

        {/* Center High-Density Global Search */}
        <div className="flex-1 max-w-lg mx-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索邮箱地址、分组标签..."
              className={`w-full pl-8 pr-8 py-1.5 text-xs rounded-md border transition-all focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                isDark 
                  ? 'bg-slate-800/80 text-slate-100 placeholder-slate-400 border-slate-700' 
                  : 'bg-white/90 text-slate-800 placeholder-slate-400 border-slate-300'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs ${
                  isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Right Action Tools */}
        <div className="flex items-center gap-2 shrink-0">
          {/* AI Auto Tag */}
          <button
            onClick={onRunAiAutoTag}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-xs hover:opacity-95"
            title="人工智能自动对所有邮箱账户分析归类"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI智析</span>
          </button>

          {/* Rule Manager Shortcut */}
          <button
            onClick={onOpenRuleManager}
            className={`p-1.5 rounded-md border transition-all ${
              isDark 
                ? 'border-slate-700 text-slate-300 hover:bg-slate-800' 
                : 'border-slate-300 text-slate-700 hover:bg-slate-200/60'
            }`}
            title="规则中心与路由配置"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>

          {/* Style Version Preset Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowStyleMenu(!showStyleMenu)}
              title="外观风格选择"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
                isDark 
                  ? 'bg-slate-800/90 border-slate-700 text-slate-200 hover:bg-slate-700' 
                  : 'bg-white/90 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Palette className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline">风格:</span>
              <span className="font-bold text-blue-600">
                {currentPreset.name.split(' ')[0]}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Dropdown */}
            {showStyleMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStyleMenu(false)} />
                <div className={`absolute right-0 mt-2 w-64 rounded-lg p-2 z-50 border shadow-2xl ${
                  isDark 
                    ? 'bg-slate-900 border-slate-700 text-slate-200' 
                    : 'bg-white border-slate-300 text-slate-800 shadow-xl'
                }`}>
                  <p className={`px-2 py-1 text-xs font-bold border-b mb-1 ${
                    isDark ? 'text-slate-200 border-slate-800' : 'text-slate-800 border-slate-200'
                  }`}>
                    设计外观与布局预设
                  </p>
                  <div className="space-y-1">
                    {STYLE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          onSelectPreset(preset.id);
                          setShowStyleMenu(false);
                        }}
                        className={`w-full text-left p-2 rounded-md text-xs transition-all flex items-center justify-between ${
                          preset.id === currentPreset.id
                            ? isDark
                              ? 'bg-blue-600/20 font-bold text-blue-400 border border-blue-500/40'
                              : 'bg-blue-50 font-bold text-blue-700 border border-blue-200'
                            : isDark
                              ? 'hover:bg-slate-800 text-slate-300'
                              : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div>
                          <p className="font-semibold">{preset.name}</p>
                          <p className={`text-[10px] font-normal ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{preset.description}</p>
                        </div>
                        {preset.id === currentPreset.id && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Profile Avatar */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-300">
            <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
              智
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
