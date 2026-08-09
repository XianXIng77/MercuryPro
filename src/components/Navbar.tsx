import React, { useState } from 'react';
import {
  Sparkles,
  Palette,
  Check,
  ChevronDown,
} from 'lucide-react';
import { NavTab, StylePreset, StylePresetId } from '../types';
import { STYLE_PRESETS } from '../data/stylePresets';

interface NavbarProps {
  activeTab: NavTab;
  currentPreset: StylePreset;
  onSelectPreset: (presetId: StylePresetId) => void;
  onRunAiAutoTag: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  currentPreset,
  onSelectPreset,
  onRunAiAutoTag,
}) => {
  const [showStyleMenu, setShowStyleMenu] = useState(false);

  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  return (
    <header className={`sticky top-0 z-30 transition-colors duration-200 border-b ${theme.navBg} ${theme.border}`}>
      <div className="w-full px-4 h-14 flex items-center justify-between gap-3">
        {/* Left Workbench Breadcrumb */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={theme.textSecondary}>工作台</span>
            <span className={theme.textSecondary}>/</span>
            <span className={`px-2 py-0.5 rounded font-bold border ${
              isDark 
                ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' 
                : 'bg-blue-100/90 text-blue-700 border-blue-300/80'
            }`}>
              {activeTab === 'email' && '邮箱管理'}
              {activeTab === 'register' && '注册'}
              {activeTab === 'calendar' && '日历日程'}
              {activeTab === 'contacts' && '通讯录'}
              {activeTab === 'analytics' && '数据统计'}
              {activeTab === 'tickets' && '工单协同'}
              {activeTab === 'settings' && '系统设置'}
            </span>
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

          {/* Style Version Preset Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowStyleMenu(!showStyleMenu)}
              title="外观风格选择"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${theme.cardBg} ${theme.textPrimary}`}
            >
              <Palette className={`w-3.5 h-3.5 ${theme.accentText}`} />
              <span className="hidden sm:inline">风格:</span>
              <span className={`font-bold ${theme.accentText}`}>
                {currentPreset.name}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Dropdown */}
            {showStyleMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStyleMenu(false)} />
                <div className={`absolute right-0 mt-2 w-72 rounded-lg p-2 z-50 border ${theme.cardBg} ${theme.shadow} ${theme.textPrimary}`}>
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
                        className={`w-full text-left p-2 rounded-md text-xs transition-all flex items-center justify-between gap-2 ${
                          preset.id === currentPreset.id
                            ? `${theme.activeItemBg} font-bold`
                            : isDark
                              ? 'hover:bg-white/5 text-slate-300'
                              : 'hover:bg-black/5 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex shrink-0 -space-x-1">
                            {preset.preview.map((color) => <span key={color} className="w-4 h-4 rounded-full border border-black/10" style={{ backgroundColor: color }} />)}
                          </span>
                          <div className="min-w-0">
                          <p className="font-semibold">{preset.name}</p>
                          <p className={`text-[10px] leading-4 font-normal ${preset.id === currentPreset.id ? 'opacity-75' : isDark ? 'text-slate-400' : 'text-slate-500'}`}>{preset.description}</p>
                          </div>
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
          <div className={`flex items-center gap-2 pl-2 border-l ${isDark ? 'border-slate-700' : 'border-slate-300'}`}>
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold italic text-sm shadow-xs">
              M
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
