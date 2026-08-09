/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { NavTab, MailAccount, Tag, AutoTagRule, StylePresetId } from './types';
import { INITIAL_TAGS, INITIAL_RULES } from './data/mockEmails';
import { INITIAL_MAIL_ACCOUNTS } from './data/mockAccounts';
import { STYLE_PRESETS } from './data/stylePresets';
import { Navbar } from './components/Navbar';
import { WorkbenchSidebarNav } from './components/WorkbenchSidebarNav';
import { MailAccountList } from './components/MailAccountList';
import { MailboxInboxView } from './components/MailboxInboxView';
import { AutoTagRuleModal } from './components/AutoTagRuleModal';
import { ExtensionModules } from './components/ExtensionModules';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('email');
  const [accounts, setAccounts] = useState<MailAccount[]>(INITIAL_MAIL_ACCOUNTS);
  const [tags, setTags] = useState<Tag[]>(INITIAL_TAGS);
  const [rules, setRules] = useState<AutoTagRule[]>(INITIAL_RULES);
  const [currentPresetId, setCurrentPresetId] = useState<StylePresetId>('soft-warm-slate');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  const [isRuleManagerOpen, setIsRuleManagerOpen] = useState(false);

  // Active Style Preset Configuration
  const currentPreset = useMemo(() => {
    return STYLE_PRESETS.find((p) => p.id === currentPresetId) || STYLE_PRESETS[0];
  }, [currentPresetId]);

  // Active Selected Account
  const activeAccount = useMemo(() => {
    return accounts.find((acc) => acc.id === activeAccountId) || null;
  }, [accounts, activeAccountId]);

  // Total Unread Mails across all accounts
  const totalUnreadCount = useMemo(() => {
    return accounts.reduce((acc, current) => acc + (current.unreadCount || 0), 0);
  }, [accounts]);

  // Toggle Account Select
  const handleToggleSelectAccount = (id: string) => {
    if (selectedAccountIds.includes(id)) {
      setSelectedAccountIds(selectedAccountIds.filter((accId) => accId !== id));
    } else {
      setSelectedAccountIds([...selectedAccountIds, id]);
    }
  };

  const handleSelectAllAccounts = (select: boolean) => {
    if (select) {
      setSelectedAccountIds(accounts.map((acc) => acc.id));
    } else {
      setSelectedAccountIds([]);
    }
  };

  // Open Inbox for specific Mailbox Account
  const handleOpenAccountInbox = (account: MailAccount) => {
    setActiveAccountId(account.id);
  };

  // Sync single account
  const handleSyncSingleAccount = (id: string) => {
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id === id) {
          return {
            ...acc,
            lastSyncTime: new Date().toLocaleTimeString(),
            refreshResult: '刷新成功',
            status: 'active',
          };
        }
        return acc;
      })
    );
  };

  // Add new account
  const handleAddAccount = (newAcc: Partial<MailAccount>) => {
    const accItem: MailAccount = {
      id: `acc-${Date.now()}`,
      accountName: newAcc.emailAddress || 'new@outlook.com',
      emailAddress: newAcc.emailAddress || 'new@outlook.com',
      clientId: newAcc.clientId || `cli_${Math.random().toString(16).slice(2, 10)}`,
      usageStatus: newAcc.usageStatus || '未用',
      createdTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      refreshResult: '未刷新',
      protocol: 'IMAP',
      serverHost: 'outlook.office365.com',
      status: 'active',
      unreadCount: 0,
      totalMails: 0,
      lastSyncTime: '刚刚',
      tags: ['新导入'],
      messages: [],
    };
    setAccounts((prev) => [accItem, ...prev]);
  };

  // Delete account
  const handleDeleteAccount = (id: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
    setSelectedAccountIds((prev) => prev.filter((accId) => accId !== id));
  };

  // Toggle usage status (已用 / 未用)
  const handleToggleUsageStatus = (id: string) => {
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id === id) {
          const nextStatus = acc.usageStatus === '已用' ? '未用' : '已用';
          return { ...acc, usageStatus: nextStatus };
        }
        return acc;
      })
    );
  };

  // Run AI Auto-Tagging on Accounts
  const handleRunAiAutoTag = () => {
    alert('已成功使用 AI 引擎对全部 100 个邮箱账号进行业务智能离线归类与规则校验！');
  };

  // Rules CRUD
  const handleAddRule = (rule: Omit<AutoTagRule, 'id'>) => {
    const newRule: AutoTagRule = {
      ...rule,
      id: `rule-${Date.now()}`,
    };
    setRules((prev) => [...prev, newRule]);
  };

  const handleToggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleDeleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className={`h-screen flex flex-col font-sans transition-colors duration-200 overflow-hidden ${currentPreset.themeClasses.appBg}`}>
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        currentPreset={currentPreset}
        onSelectPreset={setCurrentPresetId}
        onRunAiAutoTag={handleRunAiAutoTag}
        onOpenRuleManager={() => setIsRuleManagerOpen(false)}
        totalUnreadCount={totalUnreadCount}
      />

      {/* Main Container Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Workbench Sidebar Nav */}
        <WorkbenchSidebarNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          totalUnreadCount={totalUnreadCount}
          currentPreset={currentPreset}
        />

        {/* Content Body with Interactive Page Switch Transition */}
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
                  /* 点击【收信】后跳转进入对应邮箱账户的收件页面 */
                  <MailboxInboxView
                    account={activeAccount}
                    onBackToAccountList={() => setActiveAccountId(null)}
                    currentPreset={currentPreset}
                  />
                ) : (
                  /* 邮箱账号数据列表 (包含 126 个邮箱账号，操作列【收信】) */
                  <MailAccountList
                    accounts={accounts}
                    selectedAccountIds={selectedAccountIds}
                    onToggleSelectAccount={handleToggleSelectAccount}
                    onSelectAllAccounts={handleSelectAllAccounts}
                    onOpenAccountInbox={handleOpenAccountInbox}
                    onSyncSingleAccount={handleSyncSingleAccount}
                    onAddAccount={handleAddAccount}
                    onDeleteAccount={handleDeleteAccount}
                    onToggleUsageStatus={handleToggleUsageStatus}
                    searchQuery={searchQuery}
                    currentPreset={currentPreset}
                  />
                )
              ) : (
                <ExtensionModules
                  activeTab={activeTab}
                  currentPreset={currentPreset}
                  onAddAccount={handleAddAccount}
                  onSwitchToEmailList={() => setActiveTab('email')}
                />
              )}
            </motion.main>
          </AnimatePresence>
        </div>
      </div>

      {/* Modals */}
      <AutoTagRuleModal
        isOpen={isRuleManagerOpen}
        onClose={() => setIsRuleManagerOpen(false)}
        rules={rules}
        onAddRule={handleAddRule}
        onToggleRule={handleToggleRule}
        onDeleteRule={handleDeleteRule}
        onExecuteAllRules={() => {}}
        onRunAiAutoTag={handleRunAiAutoTag}
        folders={[]}
        tags={tags}
        currentPreset={currentPreset}
      />
    </div>
  );
}
