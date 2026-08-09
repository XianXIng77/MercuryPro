import React, { useState, useMemo } from 'react';
import {
  MailAccount,
  StylePreset,
} from '../types';
import {
  Plus,
  RefreshCw,
  FileText,
  Mail,
  Copy,
  Trash2,
  Search,
  RotateCcw,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Filter,
  X,
  Check,
  Info,
  Upload,
} from 'lucide-react';

interface MailAccountListProps {
  accounts: MailAccount[];
  selectedAccountIds: string[];
  onToggleSelectAccount: (id: string) => void;
  onSelectAllAccounts: (select: boolean) => void;
  onOpenAccountInbox: (account: MailAccount) => void;
  onSyncSingleAccount: (id: string) => void;
  onAddAccount?: (account: Partial<MailAccount>) => void;
  onDeleteAccount?: (id: string) => void;
  onToggleUsageStatus?: (id: string) => void;
  searchQuery: string;
  currentPreset: StylePreset;
}

export const MailAccountList: React.FC<MailAccountListProps> = ({
  accounts,
  selectedAccountIds,
  onToggleSelectAccount,
  onSelectAllAccounts,
  onOpenAccountInbox,
  onSyncSingleAccount,
  onAddAccount,
  onDeleteAccount,
  onToggleUsageStatus,
  searchQuery,
  currentPreset,
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.id.includes('dark');

  // Filter Bar States
  const [filterEmail, setFilterEmail] = useState<string>('');
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [filterUsageStatus, setFilterUsageStatus] = useState<string>('all'); // 'all' | '未用' | '已用'

  // Pagination States
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [jumpPageInput, setJumpPageInput] = useState<string>('1');

  // Interactive Feedback States
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({});
  const [isBulkRefreshing, setIsBulkRefreshing] = useState<boolean>(false);
  const [localUsageStatuses, setLocalUsageStatuses] = useState<Record<string, '未用' | '已用'>>({});

  const handleToggleUsage = (accId: string, currentStatus?: string) => {
    const current = localUsageStatuses[accId] || currentStatus || '未用';
    const nextStatus = current === '已用' ? '未用' : '已用';
    setLocalUsageStatuses((prev) => ({ ...prev, [accId]: nextStatus }));
    if (onToggleUsageStatus) {
      onToggleUsageStatus(accId);
    }
    showToast(`已将账号状态切换为：${nextStatus}`);
  };

  // Modals
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addMode, setAddMode] = useState<'text' | 'file'>('text');
  const [batchText, setBatchText] = useState<string>('');

  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [detailAccount, setDetailAccount] = useState<MailAccount | null>(null);

  // Account Data Modal State
  const [showAccountDataModal, setShowAccountDataModal] = useState<boolean>(false);
  const [accountDataText, setAccountDataText] = useState<string>('');

  // Toast Helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Filter Logic
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = acc.accountName.toLowerCase().includes(q);
        const matchEmail = acc.emailAddress.toLowerCase().includes(q);
        const matchClient = acc.clientId?.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchClient) return false;
      }

      if (filterEmail.trim()) {
        if (!acc.emailAddress.toLowerCase().includes(filterEmail.trim().toLowerCase())) {
          return false;
        }
      }

      if (filterClientId.trim()) {
        if (!acc.clientId?.toLowerCase().includes(filterClientId.trim().toLowerCase())) {
          return false;
        }
      }

      if (filterUsageStatus !== 'all') {
        if (acc.usageStatus !== filterUsageStatus) {
          return false;
        }
      }

      return true;
    });
  }, [accounts, searchQuery, filterEmail, filterClientId, filterUsageStatus]);

  // Reset Filters
  const handleResetFilters = () => {
    setFilterEmail('');
    setFilterClientId('');
    setFilterUsageStatus('all');
    setCurrentPage(1);
    setJumpPageInput('1');
  };

  // Pagination Logic
  const totalItems = filteredAccounts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const currentPageAccounts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAccounts.slice(start, start + pageSize);
  }, [filteredAccounts, currentPage, pageSize]);

  // Selection Logic
  const isAllSelected =
    currentPageAccounts.length > 0 &&
    currentPageAccounts.every((acc) => selectedAccountIds.includes(acc.id));

  const handleSelectAll = () => {
    onSelectAllAccounts(!isAllSelected);
  };

  // Action: Single Token Refresh
  const handleRefreshSingle = (acc: MailAccount) => {
    setRefreshingIds((prev) => ({ ...prev, [acc.id]: true }));
    onSyncSingleAccount(acc.id);
    setTimeout(() => {
      setRefreshingIds((prev) => ({ ...prev, [acc.id]: false }));
      showToast(`邮箱 ${acc.emailAddress} Token 刷新成功！`);
    }, 800);
  };

  // Action: Bulk Token Refresh
  const handleBulkRefresh = () => {
    if (selectedAccountIds.length === 0) {
      showToast('请先勾选需要批量刷新的邮箱账号！');
      return;
    }
    setIsBulkRefreshing(true);
    setTimeout(() => {
      selectedAccountIds.forEach((id) => {
        if (onSyncSingleAccount) {
          onSyncSingleAccount(id);
        }
      });
      setIsBulkRefreshing(false);
      showToast(`已成功批量刷新 ${selectedAccountIds.length} 个邮箱账号 Token！`);
    }, 1200);
  };

  // Action: Copy JSON
  const handleCopyJson = (acc: MailAccount) => {
    const jsonStr = JSON.stringify(
      {
        email: acc.emailAddress,
        clientId: acc.clientId || 'N/A',
        usageStatus: acc.usageStatus,
        createdTime: acc.createdTime,
        refreshResult: acc.refreshResult,
      },
      null,
      2
    );
    navigator.clipboard.writeText(jsonStr);
    showToast(`已成功复制 ${acc.emailAddress} 的 JSON 账号配置数据！`);
  };

  // Helper: Format single account line
  const formatAccountLine = (acc: MailAccount) => {
    const token =
      acc.refreshToken ||
      `M.C556_BL2.0.U.MsaArtifacts.-CvmsCcZAE05WlCNdx1KW*wI1JDE4Adk8*ToGd0PL9Svmmtrrml8AkihU8CcZBNARhhFkq2pDRyIZfzcTWm76WnZ64A1zg3fMeGkg9tjw4!GGT8!GD1U7OGOUxo4Ne6fbux!drjl31zHAjbBCrirwSpbpn*FmX5bOZ7cdQ7GkNy*dial9cMf1R9G7isMQhf0yKIVef56xU7bwLooD11JUojebZ7Wvgrsy3fArBhQXCJ05ootjO6VcxHaW!2zGid88JmTVpvcObLp1D5B0XCJC89qgAz0M!Ga!Yqbi*dKOVfjvJQYfX2w5sxuyHrdPYp5jD1y6KHbFeeeSNQtszNgpx83eFgHmfCeD6TOhxYd7b*Yz4q51WCKdiEAysBRdcBxEBxSk8T*9T3c!oODvxhvEyKv*FMKdwzhgQL6cL6OhOnQ*tbMc!MwG2NfMlrEEId6*cz0TULrvikDFG5Cf5evs*SU$`;
    const cid = acc.clientId || '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
    return `${acc.emailAddress}----x----${token}----${cid}`;
  };

  // Action: Get Selected Accounts Data
  const handleGetSelectedAccounts = () => {
    if (selectedAccountIds.length === 0) {
      showToast('请先勾选需要获取的邮箱账号！');
      return;
    }
    const selectedAccs = accounts.filter((a) => selectedAccountIds.includes(a.id));
    const lines = selectedAccs.map((acc) => formatAccountLine(acc)).join('\n');
    setAccountDataText(lines);
    setShowAccountDataModal(true);
  };

  // Action: Get Single Account Data
  const handleGetSingleAccount = (acc: MailAccount) => {
    setAccountDataText(formatAccountLine(acc));
    setShowAccountDataModal(true);
  };

  // Action: Add Account Submit
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchText.trim()) {
      showToast('请先输入或粘贴 TXT 内容！');
      return;
    }

    const lines = batchText.split('\n').map((l) => l.trim()).filter(Boolean);
    let addedCount = 0;
    const existingEmails = new Set(accounts.map((a) => a.emailAddress.toLowerCase()));

    lines.forEach((line) => {
      // 格式支持：邮箱----x----refresh_token----client_id 或普通邮箱格式
      const parts = line.split('----');
      const emailCandidate = parts[0]?.trim();

      if (emailCandidate && emailCandidate.includes('@')) {
        if (existingEmails.has(emailCandidate.toLowerCase())) {
          return; // 重复邮箱自动跳过
        }
        existingEmails.add(emailCandidate.toLowerCase());

        const clientId =
          parts[3]?.trim() ||
          parts[1]?.trim() ||
          `cli_${Math.random().toString(16).slice(2, 10)}`;

        if (onAddAccount) {
          onAddAccount({
            emailAddress: emailCandidate,
            accountName: emailCandidate,
            clientId: clientId,
            usageStatus: '未用',
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
          });
          addedCount++;
        }
      }
    });

    if (addedCount > 0) {
      showToast(`已成功导入 ${addedCount} 个邮箱账号！`);
    } else if (lines.length > 0) {
      showToast('解析完成，所有包含的邮箱地址均已存在或格式无效。');
    }

    setBatchText('');
    setShowAddModal(false);
  };

  // Page Jump Submit
  const handleJumpPage = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpPageInput, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    } else {
      setJumpPageInput(currentPage.toString());
    }
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${theme.appBg} text-xs`}>
      {/* Toast Floating Notification */}
      {toastMessage && (
        <div className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border font-medium text-xs rounded-lg shadow-xl backdrop-blur-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ${
          isDark ? 'bg-slate-950/90 border-slate-700 text-white' : 'bg-slate-900/95 border-slate-700 text-white'
        }`}>
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Row 1: Top Search / Filter Header Bar */}
      <div className={`p-3 border-b flex flex-wrap items-center gap-4 ${theme.navBg} ${theme.border} shrink-0`}>
        {/* Input: 邮箱 */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold shrink-0 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>邮箱</span>
          <input
            type="text"
            value={filterEmail}
            onChange={(e) => {
              setFilterEmail(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="请输入邮箱"
            className={`w-44 px-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
              isDark 
                ? 'bg-slate-800/90 border-slate-700/80 text-slate-100 placeholder-slate-400' 
                : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
            }`}
          />
        </div>

        {/* Segmented Switcher: 使用状态 */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold shrink-0 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>使用状态</span>
          <div className={`inline-flex items-center p-0.5 rounded-lg border text-xs font-medium ${
            isDark ? 'bg-slate-900/90 border-slate-700/80' : 'bg-slate-100 border-slate-200'
          }`}>
            <button
              type="button"
              onClick={() => {
                setFilterUsageStatus('all');
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                filterUsageStatus === 'all'
                  ? isDark ? 'bg-slate-800 text-white shadow-xs font-bold' : 'bg-white text-slate-900 shadow-xs font-bold'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterUsageStatus('未用');
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                filterUsageStatus === '未用'
                  ? isDark ? 'bg-slate-800 text-slate-100 shadow-xs font-bold border border-slate-700' : 'bg-white text-slate-800 shadow-xs font-bold border border-slate-200'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0"></span>
              <span>未用</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterUsageStatus('已用');
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                filterUsageStatus === '已用'
                  ? 'bg-emerald-600 text-white shadow-xs font-bold'
                  : isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${filterUsageStatus === '已用' ? 'bg-white' : 'bg-emerald-500'}`}></span>
              <span>已用</span>
            </button>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex items-center gap-2 ml-auto sm:ml-0">
          <button
            onClick={() => setCurrentPage(1)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded flex items-center gap-1.5 transition-colors shadow-2xs"
          >
            <Search className="w-3.5 h-3.5" />
            <span>搜索</span>
          </button>
          <button
            onClick={handleResetFilters}
            className={`px-4 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors border ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>重置</span>
          </button>
        </div>
      </div>

      {/* Row 2: Action Toolbar Row */}
      <div className={`px-3 py-2 border-b flex flex-wrap items-center justify-between gap-3 ${
        isDark ? 'bg-slate-900/60' : 'bg-slate-100/90'
      } ${theme.border} shrink-0`}>
        {/* Left Toolbar Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* + 新增 */}
          <button
            onClick={() => setShowAddModal(true)}
            className={`px-3 py-1 font-medium rounded flex items-center gap-1 transition-colors border ${
              isDark 
                ? 'bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 border-blue-700/60' 
                : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>新增</span>
          </button>

          {/* 批量刷新Token */}
          <button
            onClick={handleBulkRefresh}
            disabled={isBulkRefreshing}
            className={`px-3 py-1 font-medium rounded flex items-center gap-1 transition-colors border disabled:opacity-60 ${
              isDark 
                ? 'bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border-amber-700/60' 
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-600 ${isBulkRefreshing ? 'animate-spin' : ''}`} />
            <span>批量刷新Token</span>
          </button>

          {/* 获取选中账号 */}
          <button
            onClick={handleGetSelectedAccounts}
            className={`px-3 py-1 font-medium rounded flex items-center gap-1 transition-colors border ${
              isDark 
                ? 'bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/60' 
                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-emerald-600" />
            <span>获取选中账号</span>
          </button>
        </div>

        {/* Right Icon Actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => setCurrentPage(1)}
            className={`p-1.5 border rounded transition-colors ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
            }`}
            title="检索筛选"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              showToast('数据已更新为最新状态！');
            }}
            className={`p-1.5 border rounded transition-colors ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
            }`}
            title="刷新表格"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Row 3: Account Data Table */}
      <div className={`flex-1 overflow-auto ${isDark ? 'bg-slate-900/30' : 'bg-slate-100/40'}`}>
        <table className="w-full border-collapse text-left text-xs">
          <thead className={`sticky top-0 z-10 border-b backdrop-blur-xs font-semibold ${
            isDark 
              ? 'bg-slate-800/90 text-slate-300 border-slate-700' 
              : 'bg-slate-200/80 text-slate-700 border-slate-300/80'
          }`}>
            <tr>
              <th className="py-2.5 px-3 w-10 text-center">
                <button
                  onClick={handleSelectAll}
                  className={`hover:text-blue-600 focus:outline-none ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
                  title="全选/取消全选"
                >
                  {isAllSelected ? (
                    <CheckSquare className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              </th>
              <th className="py-2.5 px-3 w-16 text-center">序号</th>
              <th className="py-2.5 px-3 min-w-[220px] text-center">邮箱</th>
              <th className="py-2.5 px-3 w-24 text-center">已用</th>
              <th className="py-2.5 px-3 w-40 text-center">创建时间</th>
              <th className="py-2.5 px-3 w-28 text-center">刷新结果</th>
              <th className={`py-2.5 px-3 min-w-[280px] text-center sticky right-0 shadow-2xs ${
                isDark ? 'bg-slate-800/90' : 'bg-slate-200/90'
              }`}>
                操作
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isDark ? 'divide-slate-800/80' : 'divide-slate-200/80'}`}>
            {currentPageAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} className={`py-16 text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Info className="w-8 h-8 text-slate-400" />
                    <p className="font-medium">暂无匹配的邮箱账号记录</p>
                  </div>
                </td>
              </tr>
            ) : (
              currentPageAccounts.map((acc, index) => {
                const isSelected = selectedAccountIds.includes(acc.id);
                const isSingleSyncing = refreshingIds[acc.id];
                const displayIndex = (currentPage - 1) * pageSize + index + 1;

                return (
                  <tr
                    key={acc.id}
                    className={`group transition-colors ${
                      isDark 
                        ? 'bg-slate-900/20 hover:bg-slate-800/60 text-slate-200' 
                        : 'bg-white/80 hover:bg-blue-50/70 text-slate-800'
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => onToggleSelectAccount(acc.id)}
                        className={`hover:text-blue-600 focus:outline-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>

                    {/* 序号 */}
                    <td className={`py-2.5 px-3 text-center font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {displayIndex}
                    </td>

                    {/* 邮箱 (Click to copy) */}
                    <td className="py-2.5 px-3 font-mono font-medium text-xs text-center">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(acc.emailAddress);
                          showToast(`已成功复制邮箱地址: ${acc.emailAddress}`);
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline inline-block font-semibold cursor-pointer"
                        title="点击复制该邮箱地址"
                      >
                        {acc.emailAddress}
                      </button>
                    </td>

                    {/* 已用 / 使用状态 */}
                    <td className="py-2.5 px-3 text-center">
                      {(() => {
                        const status = localUsageStatuses[acc.id] || acc.usageStatus || '未用';
                        const isUsed = status === '已用';
                        return (
                          <button
                            onClick={() => handleToggleUsage(acc.id, acc.usageStatus)}
                            className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full border font-bold text-[11px] cursor-pointer transition-all hover:scale-105 active:scale-95 ${
                              isUsed 
                                ? 'border-emerald-500/80 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-600/80 shadow-2xs' 
                                : isDark
                                  ? 'border-slate-700 bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200' 
                                  : 'border-slate-300 bg-slate-100/90 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                            }`}
                            title="点击切换【已用/未用】状态"
                          >
                            {isUsed ? (
                              <>
                                <Check className="w-3.5 h-3.5 mr-1 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                <span>已用</span>
                              </>
                            ) : (
                              <>
                                <Square className="w-2.5 h-2.5 mr-1 text-slate-400" />
                                <span>未用</span>
                              </>
                            )}
                          </button>
                        );
                      })()}
                    </td>

                    {/* 创建时间 */}
                    <td className={`py-2.5 px-3 text-center font-mono text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {acc.createdTime || '2026-08-01 13:32:22'}
                    </td>

                    {/* 刷新结果 */}
                    <td className="py-2.5 px-3 text-center">
                      {isSingleSyncing || (isBulkRefreshing && isSelected) ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium animate-pulse inline-flex items-center justify-center gap-1 text-xs">
                          <RefreshCw className="w-3 h-3 animate-spin text-amber-500" />
                          <span>刷新中...</span>
                        </span>
                      ) : acc.refreshResult === '刷新成功' || acc.refreshResult?.includes('成功') ? (
                        <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full border border-emerald-500/80 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-600/80 font-bold text-[11px] shadow-2xs">
                          <Check className="w-3.5 h-3.5 mr-0.5 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                          <span>{acc.refreshResult}</span>
                        </span>
                      ) : acc.refreshResult === '刷新失败' || acc.refreshResult?.includes('失败') ? (
                        <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full border border-rose-500/80 bg-rose-50 text-rose-700 dark:bg-rose-950/90 dark:text-rose-300 dark:border-rose-600/80 font-bold text-[11px] shadow-2xs">
                          <X className="w-3.5 h-3.5 mr-0.5 text-rose-600 dark:text-rose-400 stroke-[3]" />
                          <span>{acc.refreshResult}</span>
                        </span>
                      ) : (
                        <span className={`font-medium text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {acc.refreshResult || '未刷新'}
                        </span>
                      )}
                    </td>

                    {/* 操作 links */}
                    <td className={`py-2.5 px-3 text-center sticky right-0 transition-colors ${
                      isDark 
                        ? 'bg-slate-900 group-hover:bg-slate-800/80' 
                        : 'bg-white group-hover:bg-blue-50/70'
                    }`}>
                      <div className="flex items-center justify-center gap-3 text-xs">
                        {/* ✉ 收信 */}
                        <button
                          onClick={() => onOpenAccountInbox(acc)}
                          className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 transition-colors"
                          title="进入对应的收件箱查看收到信件"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span>收信</span>
                        </button>

                        {/* 📄 获取 */}
                        <button
                          onClick={() => handleGetSingleAccount(acc)}
                          className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 transition-colors"
                          title="查看并获取此账号数据"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>获取</span>
                        </button>

                        {/* 📋 复制JSON */}
                        <button
                          onClick={() => handleCopyJson(acc)}
                          className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 transition-colors"
                          title="复制该账号的JSON元数据"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>复制JSON</span>
                        </button>

                        {/* 🔄 刷新 */}
                        <button
                          onClick={() => handleRefreshSingle(acc)}
                          disabled={isSingleSyncing}
                          className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5 transition-colors disabled:opacity-50"
                          title="刷新此账号Token"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSingleSyncing ? 'animate-spin' : ''}`} />
                          <span>刷新</span>
                        </button>

                        {/* 🗑️ 删除 */}
                        <button
                          onClick={() => {
                            if (onDeleteAccount) {
                              onDeleteAccount(acc.id);
                              showToast(`已成功移除账号：${acc.emailAddress}`);
                            }
                          }}
                          className="text-blue-600 hover:text-red-600 font-medium flex items-center gap-0.5 transition-colors"
                          title="移除此邮箱账号"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>删除</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Row 4: Pagination Footer Bar */}
      <div className={`px-4 py-2.5 border-t flex flex-wrap items-center justify-between gap-3 ${theme.navBg} ${theme.border} shrink-0`}>
        {/* Total Count & Page Size Dropdown */}
        <div className={`flex items-center gap-4 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          <span>共 {totalItems} 条</span>

          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className={`px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              isDark 
                ? 'bg-slate-800 border-slate-700 text-slate-100' 
                : 'bg-white border-slate-300 text-slate-800'
            }`}
          >
            <option value={10}>10条/页</option>
            <option value={20}>20条/页</option>
            <option value={50}>50条/页</option>
            <option value={100}>100条/页</option>
          </select>
        </div>

        {/* Page Buttons & Jump Input */}
        <div className="flex items-center gap-3">
          {/* Previous Page */}
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className={`p-1 border rounded disabled:opacity-40 transition-colors ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Page Numbers */}
          <div className="flex items-center gap-1 font-mono">
            {Array.from({ length: Math.min(6, totalPages) }, (_, i) => {
              const pageNum = i + 1;
              const isActive = currentPage === pageNum;
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`px-2.5 py-0.5 rounded border text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : isDark
                        ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            {totalPages > 6 && (
              <>
                <span className="px-1 text-slate-400">...</span>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className={`px-2.5 py-0.5 rounded border text-xs font-semibold transition-colors ${
                    currentPage === totalPages
                      ? 'bg-blue-600 text-white border-blue-600'
                      : isDark
                        ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                        : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
                >
                  {totalPages}
                </button>
              </>
            )}
          </div>

          {/* Next Page */}
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className={`p-1 border rounded disabled:opacity-40 transition-colors ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' 
                : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
            }`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Page Jump */}
          <form onSubmit={handleJumpPage} className="flex items-center gap-1 ml-2">
            <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>前往</span>
            <input
              type="text"
              value={jumpPageInput}
              onChange={(e) => setJumpPageInput(e.target.value)}
              className={`w-10 px-1.5 py-0.5 border rounded text-center font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                isDark 
                  ? 'bg-slate-800 border-slate-700 text-slate-100' 
                  : 'bg-white border-slate-300 text-slate-800'
              }`}
            />
            <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>页</span>
          </form>
        </div>
      </div>

      {/* Modal 1: 新增邮箱账号 Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className={`border rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-in zoom-in-95 ${
            isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
          }`}>
            {/* Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between ${
              isDark ? 'bg-slate-800/80 border-slate-800' : 'bg-slate-50 border-slate-200/80'
            }`}>
              <h3 className={`font-bold text-base ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                新增邮箱账号
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isDark 
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' 
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-5">
              {/* Container Box */}
              <div className={`p-4.5 rounded-2xl border space-y-4 ${
                isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50/70 border-slate-200/80'
              }`}>
                {/* Mode Selector Header */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className={`font-bold text-sm ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      选择新增方式
                    </h4>
                    <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      默认推荐直接粘贴文本，也可以继续上传 TXT 文档。
                    </p>
                  </div>

                  <div className={`p-1 rounded-xl flex items-center gap-1 border ${
                    isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'
                  }`}>
                    <button
                      type="button"
                      onClick={() => setAddMode('text')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        addMode === 'text'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : isDark
                          ? 'text-slate-400 hover:text-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      粘贴文本
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddMode('file')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        addMode === 'file'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : isDark
                          ? 'text-slate-400 hover:text-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      上传文件
                    </button>
                  </div>
                </div>

                {/* Input Content Area */}
                <div className="h-48 w-full">
                  {addMode === 'text' ? (
                    <textarea
                      value={batchText}
                      onChange={(e) => setBatchText(e.target.value)}
                      placeholder="请粘贴TXT文本内容，每行格式：邮箱----x----refresh_token----client_id"
                      className={`w-full h-full p-3.5 border-2 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all resize-none box-border ${
                        isDark 
                          ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-500' 
                          : 'bg-white border-slate-200 text-slate-900 font-semibold placeholder-slate-400'
                      }`}
                    />
                  ) : (
                    <label className={`w-full h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all box-border ${
                      isDark 
                        ? 'bg-slate-900 border-slate-700 hover:border-blue-500 hover:bg-blue-950/20' 
                        : 'bg-white border-slate-200 hover:border-blue-500 hover:bg-blue-50/40'
                    }`}>
                      <Upload className="w-8 h-8 text-blue-500 mb-2" />
                      <span className={`text-xs font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        点击或拖拽 TXT 文档到此处上传
                      </span>
                      <span className={`text-[11px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        支持格式：.txt (每行格式同上)
                      </span>
                      <input
                        type="file"
                        accept=".txt"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const text = event.target?.result as string;
                            if (text) {
                              setBatchText(text);
                              setAddMode('text');
                              showToast(`已成功读取文件【${file.name}】内容！`);
                            }
                          };
                          reader.readAsText(file);
                        }}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {/* Info Notice Box */}
                <div className={`p-3 rounded-xl border flex items-center gap-2.5 text-xs ${
                  isDark 
                    ? 'bg-blue-950/40 border-blue-900/50 text-blue-300' 
                    : 'bg-blue-50 border-blue-200 text-blue-900 font-medium'
                }`}>
                  <Info className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>
                    <strong className="font-semibold">每行格式：</strong>
                    邮箱----x----refresh_token----client_id；重复邮箱会自动跳过。
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 active:scale-97 text-white font-bold text-xs rounded-lg shadow-xs transition-all cursor-pointer"
                >
                  确定
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={`px-6 py-2 border font-bold text-xs rounded-lg transition-all cursor-pointer ${
                    isDark 
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800' 
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: 账号详情与 JSON 获取 Modal */}
      {showDetailModal && detailAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className={`border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 ${
            isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'
          }`}>
            <div className={`p-4 border-b flex items-center justify-between ${
              isDark ? 'bg-slate-800/60 border-slate-800' : 'bg-slate-100/80 border-slate-200'
            }`}>
              <h3 className="font-bold text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <span>邮箱账号配置凭证 - {detailAccount.emailAddress}</span>
              </h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className={`p-3 rounded-lg border space-y-2 font-mono text-xs ${
                isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-slate-500">邮箱:</span>
                  <span className="font-bold text-blue-600">{detailAccount.emailAddress}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Client ID:</span>
                  <span className="font-medium">{detailAccount.clientId || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">使用状态:</span>
                  <span className="font-medium">{detailAccount.usageStatus}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">创建时间:</span>
                  <span className="font-medium">{detailAccount.createdTime}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  完整 JSON 配置凭证
                </label>
                <textarea
                  readOnly
                  rows={6}
                  value={JSON.stringify(detailAccount, null, 2)}
                  className={`w-full p-3 border rounded font-mono text-[11px] focus:outline-none ${
                    isDark ? 'bg-slate-950 text-slate-100 border-slate-800' : 'bg-slate-50 text-slate-800 border-slate-300'
                  }`}
                />
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={() => {
                    handleCopyJson(detailAccount);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded flex items-center gap-1.5 shadow-2xs"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制 JSON</span>
                </button>
                <button
                  onClick={() => setShowDetailModal(false)}
                  className={`px-4 py-2 border rounded font-medium ${
                    isDark ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700'
                  }`}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal 3: 账号数据 Modal */}
      {showAccountDataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className={`border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 ${
            isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'
          }`}>
            {/* Header */}
            <div className={`px-5 py-4 border-b flex items-center justify-between ${
              isDark ? 'bg-slate-800/60 border-slate-800' : 'bg-white border-slate-100'
            }`}>
              <h3 className={`font-bold text-base ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                账号数据
              </h3>
              <button
                onClick={() => setShowAccountDataModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-4">
              {/* Info Alert Box */}
              <div className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs ${
                isDark 
                  ? 'bg-blue-950/40 border-blue-900/50 text-blue-300' 
                  : 'bg-blue-50/80 border-blue-100 text-blue-900 font-medium'
              }`}>
                <Info className="w-4 h-4 text-blue-500 shrink-0" />
                <span>
                  每行格式：<span className="font-mono ml-1">email----x----refresh-token----client-id</span>
                </span>
              </div>

              {/* Formatted Textarea */}
              <textarea
                readOnly
                rows={10}
                value={accountDataText}
                className={`w-full p-4 border rounded-xl font-mono text-xs leading-relaxed focus:outline-none resize-none break-all ${
                  isDark 
                    ? 'bg-slate-950 border-slate-800 text-slate-100' 
                    : 'bg-slate-50/50 border-slate-200 text-slate-800 shadow-inner'
                }`}
              />

              {/* Footer Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    if (accountDataText.trim()) {
                      navigator.clipboard.writeText(accountDataText);
                      showToast('已成功复制账号数据到剪贴板！');
                    }
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-97 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  <span>复制全部</span>
                </button>
                <button
                  onClick={() => setShowAccountDataModal(false)}
                  className={`px-5 py-2.5 border font-bold text-xs rounded-xl transition-all cursor-pointer ${
                    isDark 
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800' 
                      : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
