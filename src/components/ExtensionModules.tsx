import React, { useState } from 'react';
import { Calendar, Users, BarChart3, Settings, Plus, Clock, Shield, Bell } from 'lucide-react';
import { NavTab, StylePreset } from '../types';
import { GrokRegistrationPanel } from './GrokRegistrationPanel';
import { RegistrationLogsPanel } from './RegistrationLogsPanel';

interface ExtensionModulesProps {
  activeTab: NavTab;
  currentPreset: StylePreset;
}

export const ExtensionModules: React.FC<ExtensionModulesProps> = ({
  activeTab,
  currentPreset,
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  if (activeTab === 'register') {
    return <GrokRegistrationPanel currentPreset={currentPreset} />;
  }

  if (activeTab === 'logs') {
    return <RegistrationLogsPanel currentPreset={currentPreset} />;
  }

  if (activeTab === 'calendar') {
    return (
      <div className={`flex-1 p-6 overflow-y-auto space-y-6 ${theme.appBg}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${theme.textPrimary}`}>日历日程与会议管理 (扩展模块)</h2>
            <p className={`text-xs ${theme.textSecondary}`}>智能同步邮件中的会议邀约与差旅行程事件</p>
          </div>
          <button className={`px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 ${theme.accentBg}`}>
            <Plus className="w-4 h-4" />
            <span>创建新日程</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-4 rounded-2xl border space-y-3 ${theme.cardBg} ${theme.border}`}>
            <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs">
              <Calendar className="w-4 h-4" />
              <span>今日焦点日程</span>
            </div>
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs">
                <div className="flex justify-between font-bold text-indigo-900 dark:text-indigo-200">
                  <span>16:00 - 17:00</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">智邮3.0评审</span>
                </div>
                <p className="text-slate-500 mt-1">智邮 3.0 版本上线前评审与架构复核会议</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                <div className="flex justify-between font-bold text-slate-800 dark:text-slate-200">
                  <span>18:30 - 20:00</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white">聚会</span>
                </div>
                <p className="text-slate-500 mt-1">老同学聚会 (静安寺餐厅)</p>
              </div>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border space-y-3 ${theme.cardBg} ${theme.border} md:col-span-2`}>
            <h3 className={`text-xs font-bold ${theme.textPrimary}`}>从邮件自动提取的待确认事件</h3>
            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 font-bold">
                    08/12
                  </div>
                  <div>
                    <p className="font-bold">MU5182 航班出票提醒 (上海虹桥 &rarr; 北京首都)</p>
                    <p className="text-slate-500 text-[11px]">发件人：携程商旅 &bull; 08:30 起飞</p>
                  </div>
                </div>
                <button className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 text-white">
                  添加至系统日历
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'contacts') {
    return (
      <div className={`flex-1 p-6 overflow-y-auto space-y-6 ${theme.appBg}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${theme.textPrimary}`}>智邮通讯录与联系人分组</h2>
            <p className={`text-xs ${theme.textSecondary}`}>自动收录邮件来往联系人并自动聚合历史通讯往来</p>
          </div>
          <button className={`px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 ${theme.accentBg}`}>
            <Plus className="w-4 h-4" />
            <span>新建联系人</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { name: '张伟 (产品总监)', email: 'zhangwei@techcorp.com', role: '研发部', count: 18, avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80' },
            { name: '李美华 (HRBP)', email: 'hr@techcorp.com', role: '人力资源', count: 12, avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&auto=format&fit=crop&q=80' },
            { name: '王小强', email: 'wangxq_private@163.com', role: '个人联系人', count: 5, avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80' },
          ].map((c, i) => (
            <div key={i} className={`p-4 rounded-2xl border space-y-3 ${theme.cardBg} ${theme.border}`}>
              <div className="flex items-center gap-3">
                <img src={c.avatar} alt={c.name} className="w-10 h-10 rounded-full object-cover border-2 border-indigo-500/20" />
                <div>
                  <h4 className={`font-bold text-sm ${theme.textPrimary}`}>{c.name}</h4>
                  <p className={`text-xs ${theme.textSecondary}`}>{c.email}</p>
                </div>
              </div>
              <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-200/50 dark:border-slate-800">
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-medium text-slate-600 dark:text-slate-300">{c.role}</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{c.count} 封邮件往来</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'analytics') {
    return (
      <div className={`flex-1 p-6 overflow-y-auto space-y-6 ${theme.appBg}`}>
        <div>
          <h2 className={`text-lg font-bold ${theme.textPrimary}`}>邮箱智能分类与统计分析</h2>
          <p className={`text-xs ${theme.textSecondary}`}>可视化分析接收邮件分类占比、响应时效与自动打标命中率</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: '本周总邮件数', val: '128 封', change: '+14% 环比' },
            { label: 'AI 智能分类正确率', val: '98.4%', change: '算法引擎在线' },
            { label: '规则命中处理数', val: '42 封', change: '节省约 1.5 小时' },
            { label: '垃圾邮件自动拦截', val: '18 封', change: '0 误判' },
          ].map((stat, i) => (
            <div key={i} className={`p-4 rounded-2xl border ${theme.cardBg} ${theme.border}`}>
              <p className={`text-xs ${theme.textSecondary}`}>{stat.label}</p>
              <h3 className={`text-xl font-extrabold mt-1 ${theme.textPrimary}`}>{stat.val}</h3>
              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium mt-1">{stat.change}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'settings') {
    return (
      <div className={`flex-1 p-6 overflow-y-auto space-y-6 max-w-4xl ${theme.appBg}`}>
        <div>
          <h2 className={`text-lg font-bold ${theme.textPrimary}`}>邮箱系统设置与自动化参数</h2>
          <p className={`text-xs ${theme.textSecondary}`}>管理 Gemini AI 引擎、自动回复规则与多端同步</p>
        </div>

        <div className={`p-5 rounded-2xl border space-y-4 ${theme.cardBg} ${theme.border}`}>
          <h3 className={`font-bold text-sm ${theme.textPrimary} flex items-center gap-2`}>
            <Shield className="w-4 h-4 text-indigo-500" />
            <span>智能 AI 引擎设置</span>
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800">
              <div>
                <p className="font-bold">Gemini 3.6 Flash 智能分类模型</p>
                <p className="text-slate-500">自动实时识别新到邮件并分配合适标签与归档文件夹</p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[10px]">
                运行良好
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800">
              <div>
                <p className="font-bold">邮件桌面与移动端通知推送</p>
                <p className="text-slate-500">高优先紧急邮件第一时间弹出即时通知</p>
              </div>
              <input type="checkbox" defaultChecked className="rounded text-indigo-600" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
