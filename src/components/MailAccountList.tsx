import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Info,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteMicrosoftMailAccounts,
  importMicrosoftMailAccounts,
  ImportRecord,
  listMicrosoftMailAccounts,
  refreshMicrosoftToken,
  updateMicrosoftMailAccount,
} from '../api/microsoftMail';
import { MailAccount, StylePreset } from '../types';
import { StyledSelect } from './StyledSelect';
import { ConfirmDialog } from './ConfirmDialog';

interface MailAccountListProps {
  onOpenAccountInbox: (account: MailAccount) => void;
  currentPreset: StylePreset;
}

type RefreshState = { status: 'loading' | 'success' | 'error'; message?: string };
type ImportSummary = { total: number; added: number; skipped: number; failed: number; records: ImportRecord[] };

export const MailAccountList: React.FC<MailAccountListProps> = ({
  onOpenAccountInbox,
  currentPreset,
}) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [jumpPageInput, setJumpPageInput] = useState('1');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [emailDraft, setEmailDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<'all' | '0' | '2' | '1'>('all');
  const [filters, setFilters] = useState<{ email: string; status: 'all' | '0' | '2' | '1' }>({ email: '', status: 'all' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [refreshStates, setRefreshStates] = useState<Record<string, RefreshState>>({});
  const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);

  const [toastMessage, setToastMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [importMode, setImportMode] = useState<'text' | 'file'>('text');
  const [batchText, setBatchText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [showAccountDataModal, setShowAccountDataModal] = useState(false);
  const [accountDataText, setAccountDataText] = useState('');
  const [pendingDeleteAccounts, setPendingDeleteAccounts] = useState<MailAccount[]>([]);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const isAllSelected = accounts.length > 0 && accounts.every((account) => selectedIds.includes(account.id));

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(''), 2800);
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await listMicrosoftMailAccounts({
        pageNum: currentPage,
        pageSize,
        email: filters.email || undefined,
        status: filters.status === 'all' ? undefined : filters.status,
      });
      setAccounts(result.rows);
      setTotalItems(result.total);
      setSelectedIds([]);
      if (currentPage > 1 && result.rows.length === 0 && result.total > 0) {
        setCurrentPage(Math.ceil(result.total / pageSize));
      }
    } catch (error: any) {
      setAccounts([]);
      setTotalItems(0);
      setLoadError(error.message || '邮箱账号加载失败');
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters, pageSize]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    setJumpPageInput(String(currentPage));
  }, [currentPage]);

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    return Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
  }, [currentPage, totalPages]);

  const runSearch = () => {
    setCurrentPage(1);
    setFilters({ email: emailDraft.trim(), status: statusDraft });
  };

  const handleStatusFilter = (status: 'all' | '0' | '2' | '1') => {
    setStatusDraft(status);
    setCurrentPage(1);
    setFilters({ email: emailDraft.trim(), status });
  };

  const resetSearch = () => {
    setEmailDraft('');
    setStatusDraft('all');
    setCurrentPage(1);
    setFilters({ email: '', status: 'all' });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(isAllSelected ? [] : accounts.map((account) => account.id));
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const formatAccountLine = (account: MailAccount) =>
    `${account.emailAddress}----x----${account.refreshToken || ''}----${account.clientId || ''}`;

  const openAccountData = (items: MailAccount[]) => {
    const valid = items.filter((item) => item.emailAddress && item.refreshToken && item.clientId);
    if (valid.length === 0) {
      showToast('所选账号缺少邮箱、Refresh Token 或 Client ID，无法获取');
      return;
    }
    setAccountDataText(valid.map(formatAccountLine).join('\n'));
    setShowAccountDataModal(true);
    if (valid.length !== items.length) showToast(`已跳过 ${items.length - valid.length} 个数据不完整的账号`);
  };

  const handleStatusChange = async (account: MailAccount) => {
    const nextStatus = account.backendStatus === '1' ? '0' : '1';
    const nextUseCount = nextStatus === '1' ? (account.registrationUseLimit || 3) : 0;
    setAccounts((previous) => previous.map((item) => item.id === account.id ? {
      ...item,
      backendStatus: nextStatus,
      usageStatus: nextStatus === '1' ? '已用' : '未用',
      registrationUseCount: nextUseCount,
    } : item));
    try {
      await updateMicrosoftMailAccount(account.accountId || account.id, nextStatus);
      showToast(`已标记为${nextStatus === '1' ? '已用' : '未用'}`);
    } catch (error: any) {
      setAccounts((previous) => previous.map((item) => item.id === account.id ? account : item));
      showToast(error.message || '状态修改失败');
    }
  };

  const refreshOne = async (account: MailAccount, quiet = false) => {
    setRefreshStates((previous) => ({ ...previous, [account.id]: { status: 'loading' } }));
    try {
      const result = await refreshMicrosoftToken(account.accountId || account.id);
      const error = typeof result.error === 'string' ? result.error : '';
      if (error) throw new Error(String(result.error_description || error));
      setRefreshStates((previous) => ({ ...previous, [account.id]: { status: 'success', message: '刷新成功' } }));
      if (!quiet) showToast(`${account.emailAddress} Token 刷新成功`);
      return true;
    } catch (error: any) {
      setRefreshStates((previous) => ({ ...previous, [account.id]: { status: 'error', message: error.message || '刷新失败' } }));
      if (!quiet) showToast(error.message || 'Token 刷新失败');
      return false;
    }
  };

  const handleBulkRefresh = async () => {
    const targets = selectedIds.length > 0 ? accounts.filter((item) => selectedIds.includes(item.id)) : accounts;
    if (targets.length === 0) return showToast('当前没有可刷新的账号');
    setIsBulkRefreshing(true);
    let success = 0;
    let failed = 0;
    for (const account of targets) {
      (await refreshOne(account, true)) ? success++ : failed++;
    }
    setIsBulkRefreshing(false);
    showToast(`批量刷新完成：成功 ${success} 个，失败 ${failed} 个`);
  };

  const handleDelete = async (items: MailAccount[]) => {
    if (!items.length) return;
    setIsDeletingAccount(true);
    try {
      const result = await deleteMicrosoftMailAccounts(items.map((account) => account.accountId || account.id));
      showToast(`已删除 ${Number(result.deleted || 0)} 个邮箱账号`);
      setPendingDeleteAccounts([]);
      await loadAccounts();
    } catch (error: any) {
      showToast(error.message || '删除失败');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    const file = importMode === 'file' ? importFile : batchText.trim()
      ? new File([batchText], 'outlook-import.txt', { type: 'text/plain' })
      : null;
    if (!file) return showToast(importMode === 'file' ? '请先选择 TXT 文件' : '请先粘贴账号文本');
    if (!file.name.toLowerCase().endsWith('.txt')) return showToast('仅支持 TXT 文件');
    if (file.size > 5 * 1024 * 1024) return showToast('TXT 文件不能超过 5MB');
    setIsImporting(true);
    try {
      const records = await importMicrosoftMailAccounts(file);
      const summary = records.reduce<ImportSummary>((result, record) => {
        result.total++;
        if (record.addStatus === 1) result.added++;
        else if (record.addStatus === 2) result.skipped++;
        else result.failed++;
        result.records.push(record);
        return result;
      }, { total: 0, added: 0, skipped: 0, failed: 0, records: [] });
      setImportSummary(summary);
      setShowAddModal(false);
      setBatchText('');
      setImportFile(null);
      showToast(`导入完成：新增 ${summary.added}，跳过 ${summary.skipped}，失败 ${summary.failed}`);
      setCurrentPage(1);
      await loadAccounts();
    } catch (error: any) {
      showToast(error.message || '导入失败');
    } finally {
      setIsImporting(false);
    }
  };

  const handleJumpPage = (event: React.FormEvent) => {
    event.preventDefault();
    const page = Number.parseInt(jumpPageInput, 10);
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
    else setJumpPageInput(String(currentPage));
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${theme.appBg} text-xs`}>
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-xl bg-slate-950/95 text-white shadow-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); runSearch(); }} className={`p-3 border-b flex flex-wrap items-center gap-4 ${theme.navBg} ${theme.border} shrink-0`}>
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${theme.textPrimary}`}>邮箱</span>
          <input
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            placeholder="请输入邮箱"
            className={`w-52 px-3 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/30 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${theme.textPrimary}`}>Grok 状态</span>
          <div className={`inline-flex p-1 rounded-xl border ${theme.border} ${isDark ? 'bg-white/[0.035]' : 'bg-black/[0.035]'}`}>
            {([['all', '全部'], ['0', '未用'], ['2', '使用中'], ['1', '已用']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handleStatusFilter(value)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${statusDraft === value
                  ? value === '1' ? 'bg-emerald-600 text-white shadow-xs' : value === '2' ? 'bg-amber-500 text-white shadow-xs' : `${isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-slate-800'} shadow-xs`
                  : theme.textSecondary}`}
              >
                {value !== 'all' && <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${value === '1' ? 'bg-emerald-500' : value === '2' ? 'bg-amber-400' : 'bg-slate-400'}`} />}
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 shadow-sm">
          <Search className="w-4 h-4" />搜索
        </button>
        <button type="button" onClick={resetSearch} className={`px-4 py-2 rounded-lg border font-semibold flex items-center gap-1.5 ${theme.cardBg} ${theme.border} ${theme.textSecondary}`}>
          <RotateCcw className="w-4 h-4" />重置
        </button>
      </form>

      <div className={`m-3 flex-1 min-h-0 flex flex-col overflow-hidden rounded-2xl ${theme.cardBg} ${theme.shadow}`}>
        <div className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${theme.border} ${isDark ? 'bg-white/[0.025]' : 'bg-white/30'}`}>
          <div className="flex items-center gap-2.5">
            <button onClick={() => { setShowAddModal(true); setImportSummary(null); }} className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold flex items-center gap-1">
              <Plus className="w-4 h-4" />新增
            </button>
            <a href="https://wmemail.com/products/outlookbm" target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 font-semibold flex items-center gap-1">
              <ShoppingCart className="w-4 h-4" />购买邮箱
            </a>
            <button disabled={isBulkRefreshing || accounts.length === 0} onClick={handleBulkRefresh} className="px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 font-semibold flex items-center gap-1">
              <RefreshCw className={`w-4 h-4 ${isBulkRefreshing ? 'animate-spin' : ''}`} />
              {selectedIds.length > 0 ? `刷新选中 (${selectedIds.length})` : '批量刷新Token'}
            </button>
            <button onClick={() => openAccountData(accounts.filter((item) => selectedIds.includes(item.id)))} disabled={selectedIds.length === 0} className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 font-semibold flex items-center gap-1">
              <FileText className="w-4 h-4" />获取选中账号
            </button>
            <button onClick={() => setPendingDeleteAccounts(accounts.filter((item) => selectedIds.includes(item.id)))} disabled={selectedIds.length === 0} className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 font-semibold flex items-center gap-1">
              <Trash2 className="w-4 h-4" />删除选中{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && <span className={theme.textSecondary}>已选 {selectedIds.length} 个</span>}
            <button onClick={() => void loadAccounts()} className={`p-2 rounded-lg border ${theme.cardBg} ${theme.border} ${theme.textSecondary}`} title="刷新数据">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loadError && (
          <div className="m-4 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2"><AlertCircle className="w-5 h-5" /><span>{loadError}</span></div>
            <button onClick={() => void loadAccounts()} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold">重试</button>
          </div>
        )}

        <div className={`flex-1 min-h-0 overflow-auto ${isDark ? 'bg-black/5' : 'bg-white/15'}`}>
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead className={`sticky top-0 z-10 border-b font-semibold backdrop-blur-md ${isDark ? 'bg-white/10 text-slate-300 border-white/10' : 'bg-black/5 text-slate-700 border-black/10'}`}>
              <tr>
                <th className="py-3 px-3 w-12 text-center"><button onClick={toggleSelectAll}>{isAllSelected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}</button></th>
                <th className="py-3 px-3 min-w-[260px] text-center">邮箱</th>
                <th className="py-3 px-3 w-36 text-center">Grok 状态</th>
                <th className="py-3 px-3 w-36 text-center">OpenAI 状态</th>
                <th className="py-3 px-3 w-44 text-center">创建时间</th>
                <th className="py-3 px-3 w-36 text-center">刷新结果</th>
                <th className={`py-3 px-3 min-w-[280px] text-center sticky right-0 backdrop-blur-md ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>操作</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
              {loading ? (
                <tr><td colSpan={7} className="py-20 text-center"><LoaderCircle className="w-7 h-7 animate-spin text-blue-600 mx-auto mb-2" /><span className={theme.textSecondary}>正在加载真实邮箱数据...</span></td></tr>
              ) : accounts.length === 0 && !loadError ? (
                <tr><td colSpan={7} className="py-20 text-center"><Info className="w-8 h-8 text-slate-400 mx-auto mb-2" /><span className={theme.textSecondary}>暂无符合条件的邮箱账号</span></td></tr>
              ) : accounts.map((account) => {
                const selected = selectedIds.includes(account.id);
                const refresh = refreshStates[account.id];
                return (
                  <tr key={account.id} className={`group ${isDark ? 'bg-white/[0.015] hover:bg-white/[0.045] text-slate-200' : 'bg-white/20 hover:bg-white/45 text-slate-800'}`}>
                    <td className="py-3 px-3 text-center"><button onClick={() => toggleSelection(account.id)}>{selected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-400" />}</button></td>
                    <td className="py-3 px-3 text-center font-mono font-semibold">
                      <button onClick={async () => { await copyText(account.emailAddress); showToast('邮箱地址已复制'); }} className="text-blue-600 hover:text-blue-800 hover:underline">{account.emailAddress}</button>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button onClick={() => void handleStatusChange(account)} className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold ${account.backendStatus === '1' ? (isDark ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-700') : account.backendStatus === '2' ? (isDark ? 'border-amber-400/40 bg-amber-400/15 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700') : (isDark ? 'border-slate-400/30 bg-slate-400/15 text-slate-300' : 'border-slate-300 bg-slate-100 text-slate-600')}`}>
                        {account.backendStatus === '1' ? <Check className="w-3.5 h-3.5 mr-1" /> : account.backendStatus === '2' ? <RotateCcw className="w-3.5 h-3.5 mr-1" /> : <Square className="w-3 h-3 mr-1" />}{account.usageStatus} · {account.grokRegistrationUseCount || 0}/{account.grokRegistrationUseLimit || 3}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        title={account.openaiRegistrationFailureReason || ''}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold ${account.openaiRegistrationUsed ? (isDark ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-700') : account.openaiRegistrationFailed ? (isDark ? 'border-rose-400/40 bg-rose-400/15 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700') : (isDark ? 'border-sky-400/40 bg-sky-400/15 text-sky-300' : 'border-sky-300 bg-sky-50 text-sky-700')}`}
                      >
                        {account.openaiRegistrationUsed ? <Check className="w-3.5 h-3.5 mr-1" /> : account.openaiRegistrationFailed ? <AlertCircle className="w-3.5 h-3.5 mr-1" /> : <Square className="w-3 h-3 mr-1" />}
                        {account.openaiRegistrationUsed ? '已用' : account.openaiRegistrationFailed ? '注册失败' : '未用'} · {account.openaiRegistrationUseCount || 0}/1
                      </span>
                    </td>
                    <td className={`py-3 px-3 text-center font-mono text-xs ${theme.textSecondary}`}>{account.createdTime || '-'}</td>
                    <td className="py-3 px-3 text-center">
                      {!refresh && <span className={theme.textSecondary}>未刷新</span>}
                      {refresh?.status === 'loading' && <span className={`inline-flex items-center gap-1 ${isDark ? 'text-amber-300' : 'text-amber-600'}`}><RefreshCw className="w-3.5 h-3.5 animate-spin" />刷新中</span>}
                      {refresh?.status === 'success' && <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${isDark ? 'text-emerald-300 bg-emerald-400/15 border-emerald-400/40' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>刷新成功</span>}
                      {refresh?.status === 'error' && <span title={refresh.message} className={`px-2.5 py-1 rounded-full text-xs font-bold border ${isDark ? 'text-rose-300 bg-rose-400/15 border-rose-400/40' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>刷新失败</span>}
                    </td>
                    <td className={`py-3 px-3 text-center sticky right-0 backdrop-blur-md ${isDark ? 'bg-black/10 group-hover:bg-white/5' : 'bg-white/40 group-hover:bg-white/65'}`}>
                      <div className="flex items-center justify-center gap-3 text-xs whitespace-nowrap">
                        <button onClick={() => onOpenAccountInbox(account)} className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"><Mail className="w-3.5 h-3.5" />收信</button>
                        <button onClick={() => openAccountData([account])} className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"><FileText className="w-3.5 h-3.5" />获取</button>
                        <button disabled={refresh?.status === 'loading'} onClick={() => void refreshOne(account)} className="text-blue-600 hover:text-blue-800 disabled:opacity-50 font-semibold flex items-center gap-1"><RefreshCw className={`w-3.5 h-3.5 ${refresh?.status === 'loading' ? 'animate-spin' : ''}`} />刷新</button>
                        <button onClick={() => setPendingDeleteAccounts([account])} className="text-blue-600 hover:text-rose-600 font-semibold flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={`px-4 py-3 border-t flex flex-wrap items-center justify-between gap-3 ${theme.navBg} ${theme.border}`}>
          <div className={`flex items-center gap-4 ${theme.textSecondary}`}>
            <span>共 {totalItems} 条</span>
            <div className="w-28"><StyledSelect ariaLabel="每页显示数量" value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setCurrentPage(1); }} options={[10, 20, 50, 100].map((size) => ({ value: String(size), label: `${size}条/页` }))} isDark={isDark} className="py-1.5" /></div>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)} className={`p-1.5 border rounded-lg disabled:opacity-40 ${theme.cardBg} ${theme.border}`}><ChevronLeft className="w-4 h-4" /></button>
            {pageNumbers.map((page) => <button key={page} onClick={() => setCurrentPage(page)} className={`min-w-9 px-2.5 py-1.5 rounded-lg border font-semibold ${page === currentPage ? 'bg-blue-600 border-blue-600 text-white' : `${theme.cardBg} ${theme.border} ${theme.textPrimary}`}`}>{page}</button>)}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => page + 1)} className={`p-1.5 border rounded-lg disabled:opacity-40 ${theme.cardBg} ${theme.border}`}><ChevronRight className="w-4 h-4" /></button>
            <form onSubmit={handleJumpPage} className={`ml-2 flex items-center gap-1 ${theme.textSecondary}`}>
              <span>前往</span><input value={jumpPageInput} onChange={(event) => setJumpPageInput(event.target.value)} className={`w-12 px-2 py-1.5 text-center border rounded-lg ${theme.cardBg} ${theme.border} ${theme.textPrimary}`} /><span>页</span>
            </form>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleImport} className={`w-full max-w-2xl rounded-3xl border shadow-2xl overflow-hidden ${theme.cardBg} ${theme.border}`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${theme.border}`}>
              <div><h3 className={`text-base font-bold ${theme.textPrimary}`}>新增 Outlook 邮箱账号</h3><p className={`mt-1 ${theme.textSecondary}`}>支持粘贴文本或上传 TXT 文件，数据将保存到本项目的独立数据仓库</p></div>
              <button type="button" onClick={() => setShowAddModal(false)} className={`p-2 rounded-lg ${theme.textSecondary}`}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className={`inline-flex p-1 rounded-xl border ${theme.border}`}>
                <button type="button" onClick={() => setImportMode('text')} className={`px-4 py-2 rounded-lg font-semibold ${importMode === 'text' ? 'bg-blue-600 text-white' : theme.textSecondary}`}>粘贴文本</button>
                <button type="button" onClick={() => setImportMode('file')} className={`px-4 py-2 rounded-lg font-semibold ${importMode === 'file' ? 'bg-blue-600 text-white' : theme.textSecondary}`}>上传文件</button>
              </div>
              {importMode === 'text' ? (
                <textarea value={batchText} onChange={(event) => setBatchText(event.target.value)} rows={11} placeholder="每行格式：邮箱----x----refresh_token----client_id" className={`w-full p-4 rounded-2xl border font-mono text-xs leading-relaxed resize-y outline-none focus:ring-2 focus:ring-blue-500/30 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`} />
              ) : (
                <button type="button" onClick={() => fileInputRef.current?.click()} className={`w-full min-h-52 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 ${theme.border} ${theme.textSecondary}`}>
                  <Upload className="w-10 h-10 text-blue-500" /><span className="font-semibold">{importFile?.name || '点击选择 TXT 文件'}</span><span>文件大小不超过 5MB</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 flex items-start gap-2"><Info className="w-4 h-4 mt-0.5 shrink-0" /><span>重复邮箱会由本项目后端自动跳过；每行格式：邮箱----x----refresh_token----client_id。</span></div>
            </div>
            <div className={`px-6 py-4 border-t flex justify-end gap-2 ${theme.border}`}>
              <button type="button" onClick={() => setShowAddModal(false)} className={`px-4 py-2 rounded-xl border ${theme.border} ${theme.textSecondary}`}>取消</button>
              <button disabled={isImporting} type="submit" className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold disabled:opacity-60 flex items-center gap-2">{isImporting && <LoaderCircle className="w-4 h-4 animate-spin" />}确认导入</button>
            </div>
          </form>
        </div>
      )}

      {importSummary && !showAddModal && (
        <div className="fixed right-5 bottom-5 z-40 max-w-sm p-4 rounded-2xl border border-slate-200 bg-white shadow-xl text-slate-700">
          <div className="flex items-center justify-between gap-4"><strong>最近导入结果</strong><button onClick={() => setImportSummary(null)}><X className="w-4 h-4" /></button></div>
          <div className="mt-3 flex gap-2 text-xs"><span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700">新增 {importSummary.added}</span><span className="px-2 py-1 rounded bg-amber-50 text-amber-700">跳过 {importSummary.skipped}</span><span className="px-2 py-1 rounded bg-rose-50 text-rose-700">失败 {importSummary.failed}</span></div>
        </div>
      )}

      {showAccountDataModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden ${theme.cardBg} ${theme.border}`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${theme.border}`}><div><h3 className={`text-base font-bold ${theme.textPrimary}`}>账号数据</h3><p className={`mt-1 ${theme.textSecondary}`}>email----x----refresh-token----client-id</p></div><button onClick={() => setShowAccountDataModal(false)}><X className={`w-5 h-5 ${theme.textSecondary}`} /></button></div>
            <div className="p-6"><textarea readOnly value={accountDataText} rows={12} className={`w-full p-4 rounded-2xl border font-mono text-xs leading-relaxed ${theme.cardBg} ${theme.border} ${theme.textPrimary}`} /></div>
            <div className={`px-6 py-4 border-t flex justify-end gap-2 ${theme.border}`}><button onClick={() => setShowAccountDataModal(false)} className={`px-4 py-2 rounded-xl border ${theme.border} ${theme.textSecondary}`}>关闭</button><button onClick={async () => { await copyText(accountDataText); showToast('账号数据已复制'); }} className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold flex items-center gap-1.5"><Copy className="w-4 h-4" />复制全部</button></div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteAccounts.length > 0}
        title={pendingDeleteAccounts.length > 1 ? `批量删除 ${pendingDeleteAccounts.length} 个邮箱账号？` : '删除邮箱账号？'}
        description={pendingDeleteAccounts.length > 1 ? <>确定删除当前选中的 <strong className={isDark ? 'text-slate-200' : 'text-slate-900'}>{pendingDeleteAccounts.length} 个邮箱账号</strong> 吗？</> : <>确定删除邮箱账号 <strong className={isDark ? 'text-slate-200' : 'text-slate-900'}>“{pendingDeleteAccounts[0]?.emailAddress}”</strong> 吗？</>}
        detail="删除后该邮箱将从 MercuryPro 邮箱列表中移除；如果仍需使用，请重新导入账号数据。"
        confirmLabel={pendingDeleteAccounts.length > 1 ? '确认批量删除' : '确认删除'}
        tone="danger"
        loading={isDeletingAccount}
        currentPreset={currentPreset}
        onCancel={() => setPendingDeleteAccounts([])}
        onConfirm={() => void handleDelete(pendingDeleteAccounts)}
      />
    </div>
  );
};
