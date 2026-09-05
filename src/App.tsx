/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MailAccount, NavTab, StylePresetId } from './types';
import { AccessProfile, AuthUser } from './api/auth';
import { STYLE_PRESETS } from './data/stylePresets';
import { ExtensionModules } from './components/ExtensionModules';
import { LoginView } from './components/LoginView';
import { MailAccountList } from './components/MailAccountList';
import { MailboxInboxView } from './components/MailboxInboxView';
import { PublicMailboxInboxPage } from './components/PublicMailboxInboxPage';
import { Navbar } from './components/Navbar';
import { WorkbenchSidebarNav } from './components/WorkbenchSidebarNav';
import { AccessControlPanel } from './components/AccessControlPanel';
import { PersonalCenter } from './components/PersonalCenter';
import { authApi } from './api/auth';
import menuRegistry from './data/menu-registry.json';
import { useToast } from './components/Toast';

// Menu URLs have one source; profile remains a fixed authenticated entrance.
const TAB_PATHS: Record<string, string> = {
  ...Object.fromEntries(menuRegistry.map(menu => [menu.key, menu.path])),
  profile: '/profile',
};

function tabForPath(pathname: string): NavTab {
  const match = (Object.entries(TAB_PATHS) as [NavTab, string][]).sort((a, b) => b[1].length - a[1].length).find(([, path]) =>
    pathname === path || pathname.startsWith(`${path}/`),
  );
  return match?.[0] || 'dashboard';
}

function PublicMailboxRoute({ currentPreset }: { currentPreset: ReturnType<typeof getPreset> }) {
  const { accessToken = '' } = useParams<{ accessToken: string }>();
  return <PublicMailboxInboxPage accessToken={accessToken} currentPreset={currentPreset} />;
}

function getPreset(presetId: StylePresetId) {
  return STYLE_PRESETS.find((preset) => preset.id === presetId) || STYLE_PRESETS[0];
}

export default function App() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeAccount, setActiveAccount] = useState<MailAccount | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [accessProfile, setAccessProfile] = useState<AccessProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentPresetId, setCurrentPresetId] = useState<StylePresetId>(() => {
    const saved = typeof window === 'undefined' ? '' : window.localStorage.getItem('mercurypro-style-preset');
    return STYLE_PRESETS.some((preset) => preset.id === saved) ? String(saved) as StylePresetId : 'mist-blue-gray';
  });
  const currentPreset = useMemo(() => getPreset(currentPresetId), [currentPresetId]);
  const activeTab = tabForPath(location.pathname);
  const isRegisteredPath = Object.values(TAB_PATHS).some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const isPublicMailboxPath = location.pathname.startsWith('/mailbox/');

  // 启动时向后端查询当前会话(HttpOnly Cookie 携带,自动恢复登录态)
  useEffect(() => {
    if (isPublicMailboxPath) {
      setAuthChecked(true);
      return;
    }
    let cancelled = false;
    authApi
      .me()
      .then(({ user, menus, permissions }) => {
        if (!cancelled && user?.email) {
          setCurrentUser(user);
          setAccessProfile({ menus, permissions });
        }
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
  }, [isPublicMailboxPath]);

  useEffect(() => {
    window.localStorage.setItem('mercurypro-style-preset', currentPreset.id);
  }, [currentPreset.id]);

  useEffect(() => {
    if (!currentUser?.email || isPublicMailboxPath) return;
    let cancelled = false;
    const syncAccess = () => {
      void authApi.menus()
        .then((profile) => {
          if (cancelled) return;
          setAccessProfile(profile);
          if (profile.role) {
            setCurrentUser((current) => current && current.role !== profile.role ? { ...current, role: profile.role as AuthUser['role'] } : current);
          }
        })
        .catch(() => { /* API requests remain authoritatively protected by the backend. */ });
    };
    const handleFocus = () => syncAccess();
    window.addEventListener('focus', handleFocus);
    const timer = window.setInterval(syncAccess, 15000);
    syncAccess();
    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(timer);
    };
  }, [currentUser?.email, isPublicMailboxPath, location.pathname]);

  const handleLoginSuccess = (user: AuthUser, profile: AccessProfile, successMessage = `登录成功，欢迎回来：${user.email}`) => {
    setCurrentUser(user);
    setAccessProfile(profile);
    navigate(profile.menus[0]?.path || '/dashboard', { replace: true });
    window.setTimeout(() => toast.success(successMessage), 50);
  };

  const handleLogout = () => {
    authApi
      .logout()
      .then(() => toast.info('已安全退出登录'))
      .catch(() => {
        toast.warning('本地已退出登录，但服务器会话未确认');
      })
      .finally(() => {
        setCurrentUser(null);
        setAccessProfile(null);
        setActiveAccount(null);
        navigate('/dashboard', { replace: true });
      });
  };

  const refreshAccessProfile = () => {
    void authApi.menus().then((profile) => {
      setAccessProfile(profile);
      if (profile.role) setCurrentUser((current) => current ? { ...current, role: profile.role as AuthUser['role'] } : current);
    }).catch(() => { /* 保存后同步失败时由定时同步重试 */ });
  };

  const handleSelectTab = (tab: NavTab) => {
    setActiveAccount(null);
    const path = TAB_PATHS[tab];
    if (path) navigate(path);
  };

  const handleRunAiAutoTag = () => {
    toast.info('请先进入具体邮箱并获取邮件后，再执行 AI 智能分类。');
  };

  if (!authChecked) {
    return null;
  }

  if (isPublicMailboxPath) {
    return (
      <Routes>
        <Route path="/mailbox/:accessToken" element={<PublicMailboxRoute currentPreset={currentPreset} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    );
  }

  if (!currentUser) {
    return <LoginView currentPreset={currentPreset} onLoginSuccess={handleLoginSuccess} />;
  }

  // 菜单与 URL 使用同一份后端授权；权限变更同步后，当前失效页面会立刻退出。
  if (!accessProfile) return null;
  const canAccessCurrentMenu = isRegisteredPath && (activeTab === 'profile' || activeTab === 'dashboard' || accessProfile.menus.some((menu) => menu.key === activeTab));
  const fallbackPath = accessProfile.menus[0]?.path;
  if (!canAccessCurrentMenu && fallbackPath) {
    return <Navigate to={fallbackPath} replace />;
  }

  if (!fallbackPath) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 p-6 text-slate-900">
        <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-sm">
          <h1 className="text-base font-bold">当前账号暂无可访问模块</h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">请联系管理员分配页面入口，授权同步后重新登录。</p>
          <button type="button" onClick={handleLogout} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">退出登录</button>
        </div>
      </div>
    );
  }

  return (
    <div data-theme={currentPreset.id} style={{ colorScheme: currentPreset.mode }} className={`h-screen flex flex-col font-sans transition-colors duration-200 overflow-hidden ${currentPreset.themeClasses.appBg}`}>
      <Navbar
        activeTab={activeTab}
        currentPreset={currentPreset}
        onSelectPreset={setCurrentPresetId}
        onRunAiAutoTag={handleRunAiAutoTag}
        currentUser={currentUser}
      />

      <div className="flex-1 flex overflow-hidden">
        <WorkbenchSidebarNav
          activeTab={activeTab}
          setActiveTab={handleSelectTab}
          totalUnreadCount={0}
          currentPreset={currentPreset}
          menuKeys={accessProfile?.menus.map((menu) => menu.key)}
          onLogout={handleLogout}
        />

        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          <AnimatePresence mode="wait">
            <motion.main
              key={activeAccount ? `inbox-${activeAccount.id}` : activeTab}
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.995 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col h-full overflow-hidden"
            >
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path={TAB_PATHS.dashboard} element={<ExtensionModules activeTab="dashboard" currentPreset={currentPreset} permissionCodes={accessProfile.permissions} onSwitchToEmailList={() => handleSelectTab('email')} />} />
                <Route
                  path={TAB_PATHS.email}
                  element={activeAccount ? (
                    <MailboxInboxView account={activeAccount} onBackToAccountList={() => setActiveAccount(null)} currentPreset={currentPreset} />
                  ) : (
                    <MailAccountList onOpenAccountInbox={setActiveAccount} currentPreset={currentPreset} permissionCodes={accessProfile.permissions} />
                  )}
                />
                <Route path={TAB_PATHS.register} element={<ExtensionModules activeTab="register" currentPreset={currentPreset} permissionCodes={accessProfile.permissions} onSwitchToEmailList={() => handleSelectTab('email')} />} />
                <Route path={TAB_PATHS.invite} element={<ExtensionModules activeTab="invite" currentPreset={currentPreset} permissionCodes={accessProfile.permissions} onSwitchToEmailList={() => handleSelectTab('email')} />} />
                <Route path={TAB_PATHS.logs} element={<ExtensionModules activeTab="logs" currentPreset={currentPreset} permissionCodes={accessProfile.permissions} onSwitchToEmailList={() => handleSelectTab('email')} />} />
                <Route path={TAB_PATHS.audit} element={<ExtensionModules activeTab="audit" currentPreset={currentPreset} permissionCodes={accessProfile.permissions} onSwitchToEmailList={() => handleSelectTab('email')} />} />
                <Route path={TAB_PATHS.access} element={currentUser.role === 'admin' ? <AccessControlPanel currentPreset={currentPreset} onAccessChanged={refreshAccessProfile} /> : <Navigate to="/dashboard" replace />} />
                <Route path={TAB_PATHS.profile} element={<PersonalCenter currentUser={currentUser} currentPreset={currentPreset} permissionCodes={accessProfile.permissions} onUserUpdate={setCurrentUser} onSelectPreset={setCurrentPresetId} />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </motion.main>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
