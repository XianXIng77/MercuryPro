/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MailAccount, NavTab, StylePresetId } from './types';
import { STYLE_PRESETS } from './data/stylePresets';
import { ExtensionModules } from './components/ExtensionModules';
import { LoginView } from './components/LoginView';
import { MailAccountList } from './components/MailAccountList';
import { MailboxInboxView } from './components/MailboxInboxView';
import { Navbar } from './components/Navbar';
import { WorkbenchSidebarNav } from './components/WorkbenchSidebarNav';
import { authApi } from './api/auth';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('email');
  const [activeAccount, setActiveAccount] = useState<MailAccount | null>(null);
  const [sessionUser, setSessionUser] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentPresetId, setCurrentPresetId] = useState<StylePresetId>(() => {
    const saved = typeof window === 'undefined' ? '' : window.localStorage.getItem('mercurypro-style-preset');
    return STYLE_PRESETS.some((preset) => preset.id === saved) ? String(saved) : 'mist-blue-gray';
  });

  // 启动时向后端查询当前会话(HttpOnly Cookie 携带,自动恢复登录态)
  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(({ user }) => {
        if (!cancelled && user?.email) setSessionUser(user.email);
      })
      .catch(() => {
        /* 未登录,停留登录页 */
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSuccess = (email: string) => {
    setSessionUser(email);
  };

  const handleLogout = () => {
    authApi
      .logout()
      .catch(() => {
        /* 后端不可达时也直接本地退出 */
      })
      .finally(() => {
        setSessionUser(null);
        setActiveAccount(null);
      });
  };

  const currentPreset = useMemo(
    () => STYLE_PRESETS.find((preset) => preset.id === currentPresetId) || STYLE_PRESETS[0],
    [currentPresetId],
  );

  useEffect(() => {
    window.localStorage.setItem('mercurypro-style-preset', currentPreset.id);
  }, [currentPreset.id]);

  const handleRunAiAutoTag = () => {
    alert('请先进入具体邮箱并获取邮件后，再执行 AI 智能分类。');
  };

  // 会话检查中:先不渲染,避免已登录用户刷新时闪现登录页
  if (!authChecked) {
    return null;
  }

  // 未登录:渲染登录页(会话由后端 /api/auth 的 HttpOnly Cookie 维护)
  if (!sessionUser) {
    return <LoginView currentPreset={currentPreset} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div data-theme={currentPreset.id} style={{ colorScheme: currentPreset.mode }} className={`h-screen flex flex-col font-sans transition-colors duration-200 overflow-hidden ${currentPreset.themeClasses.appBg}`}>
      <Navbar
        activeTab={activeTab}
        currentPreset={currentPreset}
        onSelectPreset={setCurrentPresetId}
        onRunAiAutoTag={handleRunAiAutoTag}
        sessionUser={sessionUser}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex overflow-hidden">
        <WorkbenchSidebarNav
          activeTab={activeTab}
          setActiveTab={(tab) => {
            setActiveTab(tab);
            if (tab !== 'email') setActiveAccount(null);
          }}
          totalUnreadCount={0}
          currentPreset={currentPreset}
        />

        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          <AnimatePresence mode="wait">
            <motion.main
              key={activeTab === 'email' ? (activeAccount ? `inbox-${activeAccount.id}` : 'email-account-list') : activeTab}
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.995 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col h-full overflow-hidden"
            >
              {activeTab === 'email' ? (
                activeAccount ? (
                  <MailboxInboxView
                    account={activeAccount}
                    onBackToAccountList={() => setActiveAccount(null)}
                    currentPreset={currentPreset}
                  />
                ) : (
                  <MailAccountList
                    onOpenAccountInbox={setActiveAccount}
                    currentPreset={currentPreset}
                  />
                )
              ) : (
                <ExtensionModules
                  activeTab={activeTab}
                  currentPreset={currentPreset}
                  onSwitchToEmailList={() => setActiveTab('email')}
                />
              )}
            </motion.main>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
