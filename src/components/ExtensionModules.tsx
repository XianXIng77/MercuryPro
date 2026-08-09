import React, { useState } from 'react';
import { Calendar, Users, BarChart3, Settings, Plus, Clock, Shield, Bell, CheckCircle2, UserPlus, Sparkles, RefreshCw, Key, Check, Mail, Copy, Layers } from 'lucide-react';
import { NavTab, StylePreset, MailAccount } from '../types';

interface ExtensionModulesProps {
  activeTab: NavTab;
  currentPreset: StylePreset;
  onAddAccount?: (newAcc: Partial<MailAccount>) => void;
  onSwitchToEmailList?: () => void;
}

export const ExtensionModules: React.FC<ExtensionModulesProps> = ({
  activeTab,
  currentPreset,
  onAddAccount,
  onSwitchToEmailList,
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.id.includes('dark');

  // Register Tab State
  const [regMode, setRegMode] = useState<'single' | 'batch'>('single');
  const [emailPrefix, setEmailPrefix] = useState('');
  const [emailDomain, setEmailDomain] = useState('@outlook.com');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('9e5f94bc-e8a4-4e73-b8be-63364c29d753');
  const [department, setDepartment] = useState('研发部');
  const [regSuccessMsg, setRegSuccessMsg] = useState('');

  // Batch Reg State
  const [batchCount, setBatchCount] = useState<number>(5);
  const [batchDomain, setBatchDomain] = useState('@outlook.com');

  // Random generator helpers
  const handleGenerateRandomPassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let res = '';
    for (let i = 0; i < 14; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(res);
  };

  const handleGenerateRandomPrefix = () => {
    const names = ['alex', 'jordan', 'taylor', 'morgan', 'sam', 'chris', 'casey', 'riley', 'avery', 'logan'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setEmailPrefix(`${randomName}${randomNum}`);
  };

  const handleSingleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailPrefix.trim()) {
      alert('请填写邮箱前缀！');
      return;
    }
    const fullEmail = `${emailPrefix.trim()}${emailDomain}`;
    if (onAddAccount) {
      onAddAccount({
        emailAddress: fullEmail,
        accountName: fullEmail,
        clientId: clientId || '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
        department,
        usageStatus: '未用',
      });
    }
    setRegSuccessMsg(`账号 ${fullEmail} 注册成功，已同步添加到邮箱管理列表！`);
    setEmailPrefix('');
    setPassword('');
  };

  const handleBatchRegister = () => {
    const names = ['user', 'dev', 'test', 'admin', 'service', 'client', 'account', 'staff'];
    const newEmails: string[] = [];
    for (let i = 0; i < batchCount; i++) {
      const prefix = `${names[Math.floor(Math.random() * names.length)]}_${Math.floor(10000 + Math.random() * 90000)}`;
      const fullEmail = `${prefix}${batchDomain}`;
      newEmails.push(fullEmail);
      if (onAddAccount) {
        onAddAccount({
          emailAddress: fullEmail,
          accountName: fullEmail,
          clientId: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
          department: '批量导入',
          usageStatus: '未用',
        });
      }
    }
    setRegSuccessMsg(`批量注册完成！已成功生成并注册 ${batchCount} 个 ${batchDomain} 账号！`);
  };

  if (activeTab === 'register') {
    return (
      <div className={`flex-1 p-6 overflow-y-auto space-y-6 max-w-5xl mx-auto w-full ${theme.appBg}`}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800">
          <div>
            <h2 className={`text-xl font-extrabold flex items-center gap-2.5 ${theme.textPrimary}`}>
              <UserPlus className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              <span>注册</span>
            </h2>
            <p className={`text-xs mt-1 ${theme.textSecondary}`}>
              一键快速注册微软 Outlook/Hotmail/企业邮箱账户，自动生成密钥并挂载至工作台
            </p>
          </div>

          {/* Registration Mode Selector */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-200/60 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700/60 shrink-0">
            <button
              onClick={() => { setRegMode('single'); setRegSuccessMsg(''); }}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                regMode === 'single'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              单账号快速注册
            </button>
            <button
              onClick={() => { setRegMode('batch'); setRegSuccessMsg(''); }}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                regMode === 'batch'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              批量自动注册
            </button>
          </div>
        </div>

        {/* Toast Alert Notice */}
        {regSuccessMsg && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{regSuccessMsg}</span>
            </div>
            {onSwitchToEmailList && (
              <button
                onClick={onSwitchToEmailList}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shrink-0"
              >
                查看邮箱管理列表 &rarr;
              </button>
            )}
          </div>
        )}

        {regMode === 'single' ? (
          /* Single Registration Form */
          <div className={`p-6 rounded-2xl border shadow-xs space-y-5 ${theme.cardBg} ${theme.border}`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-bold ${theme.textPrimary} flex items-center gap-2`}>
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span>填写注册信息</span>
              </h3>
              <span className="text-[11px] text-slate-400">支持 @outlook.com, @hotmail.com, @live.com 等域名</span>
            </div>

            <form onSubmit={handleSingleRegister} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Email Prefix */}
                <div className="md:col-span-2 space-y-1.5">
                  <label className={`text-xs font-bold ${theme.textPrimary}`}>
                    邮箱地址前缀 <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      value={emailPrefix}
                      onChange={(e) => setEmailPrefix(e.target.value)}
                      placeholder="例如: alex998"
                      className={`flex-1 px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateRandomPrefix}
                      className="px-3 py-2 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors cursor-pointer shrink-0"
                    >
                      随机生成前缀
                    </button>
                  </div>
                </div>

                {/* Email Domain */}
                <div className="space-y-1.5">
                  <label className={`text-xs font-bold ${theme.textPrimary}`}>邮箱后缀</label>
                  <select
                    value={emailDomain}
                    onChange={(e) => setEmailDomain(e.target.value)}
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                    }`}
                  >
                    <option value="@outlook.com">@outlook.com</option>
                    <option value="@hotmail.com">@hotmail.com</option>
                    <option value="@live.com">@live.com</option>
                    <option value="@msn.com">@msn.com</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Password */}
                <div className="space-y-1.5">
                  <label className={`text-xs font-bold ${theme.textPrimary}`}>初始访问密码</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="随机密码或手动输入"
                      className={`flex-1 px-3.5 py-2 text-xs rounded-xl border font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleGenerateRandomPassword}
                      className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0"
                    >
                      生成安全密码
                    </button>
                  </div>
                </div>

                {/* Client ID */}
                <div className="space-y-1.5">
                  <label className={`text-xs font-bold ${theme.textPrimary}`}>OAuth Client ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className={`w-full px-3.5 py-2 text-xs rounded-xl border font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                    }`}
                  />
                </div>
              </div>

              {/* Department */}
              <div className="space-y-1.5">
                <label className={`text-xs font-bold ${theme.textPrimary}`}>归属部门 / 业务组</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value="研发部">研发部</option>
                  <option value="销售部">销售部</option>
                  <option value="客服部">客服部</option>
                  <option value="市场部">市场部</option>
                  <option value="行政部">行政部</option>
                </select>
              </div>

              {/* Submit Button */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>提交注册</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Batch Registration Form */
          <div className={`p-6 rounded-2xl border shadow-xs space-y-5 ${theme.cardBg} ${theme.border}`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-bold ${theme.textPrimary} flex items-center gap-2`}>
                <Layers className="w-4 h-4 text-purple-500" />
                <span>批量生成与自动注册</span>
              </h3>
              <span className="text-[11px] text-slate-400">自动化批量创建账号并自动配置 RefreshToken</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={`text-xs font-bold ${theme.textPrimary}`}>批量注册数量</label>
                <select
                  value={batchCount}
                  onChange={(e) => setBatchCount(Number(e.target.value))}
                  className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value={3}>3 个账号</option>
                  <option value={5}>5 个账号</option>
                  <option value={10}>10 个账号</option>
                  <option value={20}>20 个账号</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className={`text-xs font-bold ${theme.textPrimary}`}>域名</label>
                <select
                  value={batchDomain}
                  onChange={(e) => setBatchDomain(e.target.value)}
                  className={`w-full px-3.5 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'
                  }`}
                >
                  <option value="@outlook.com">@outlook.com</option>
                  <option value="@hotmail.com">@hotmail.com</option>
                  <option value="@live.com">@live.com</option>
                </select>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <p className="font-bold">提示：</p>
              <p className="text-slate-600 dark:text-slate-400">点击下方按钮将自动按照算法规则批量生成并注册对应数量的账号，系统会自动为其分配最新的 Client ID 与 RefreshToken 凭证。</p>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                type="button"
                onClick={handleBatchRegister}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>一键执行批量注册</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
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
