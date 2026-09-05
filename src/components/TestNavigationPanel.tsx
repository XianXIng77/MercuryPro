import React, { useState } from 'react';
import { CheckCircle2, Clipboard, RotateCcw, TestTube2 } from 'lucide-react';
import type { StylePreset } from '../types';

/** 临时验证页面，菜单权限由 menu-registry.json 管理。 */
export const TestNavigationPanel: React.FC<{ currentPreset: StylePreset }> = ({ currentPreset }) => {
  const theme = currentPreset.themeClasses;
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState('等待测试');
  const runTest = (name: string) => { setCount(value => value + 1); setMessage(`${name} 测试通过`); };
  return <div className={`flex-1 overflow-y-auto p-6 ${theme.appBg}`}><div className={`mx-auto max-w-3xl rounded-2xl border p-6 ${theme.cardBg} ${theme.border}`}>
    <div className="mb-6 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600"><TestTube2 className="h-5 w-5" /></span><div><h2 className={`text-lg font-black ${theme.textPrimary}`}>测试导航条</h2><p className={`text-xs ${theme.textSecondary}`}>用于验证菜单注册和权限分配。</p></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><button type="button" onClick={() => runTest('按钮')} className="rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white">按钮点击</button><button type="button" onClick={() => runTest('复制')} className={`rounded-xl border px-4 py-3 text-xs font-bold ${theme.border} ${theme.textPrimary}`}><Clipboard className="mr-1 inline h-4 w-4" />复制测试</button><button type="button" onClick={() => { setCount(0); setMessage('已重置'); }} className={`rounded-xl border px-4 py-3 text-xs font-bold ${theme.border} ${theme.textPrimary}`}><RotateCcw className="mr-1 inline h-4 w-4" />重置</button></div>
    <div className={`mt-5 flex items-center justify-between rounded-xl p-4 ${currentPreset.mode === 'dark' ? 'bg-emerald-400/10' : 'bg-emerald-50'}`}><span className={`flex items-center gap-2 text-xs font-bold ${theme.textPrimary}`}><CheckCircle2 className="h-4 w-4 text-emerald-500" />{message}</span><span className={`text-xs ${theme.textSecondary}`}>已执行 {count} 次</span></div>
  </div></div>;
};
