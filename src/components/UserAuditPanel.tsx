import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock3, Download,
  Filter, KeyRound, LogIn, MonitorSmartphone, RefreshCw, Search, ShieldCheck,
  UserRound, XCircle, MapPin,
} from 'lucide-react';
import { StylePreset } from '../types';
import { OperationAuditLog, OperationAuditSummary, operationLogsApi } from '../api/operationLogs';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';
import { Pagination } from './Pagination';

const ACTIONS = ['全部', '登录', '退出登录', '注册', '新增', '执行', '修改', '删除', '导出', '权限变更'];
const AUDIT_DEFAULT_PAGE_SIZE = 10;

const actionIcon = (action: string) => {
  if (action === '登录' || action === '退出登录') return <LogIn className="h-4 w-4" />;
  if (action === '权限变更') return <KeyRound className="h-4 w-4" />;
  return <ShieldCheck className="h-4 w-4" />;
};

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

const geoLabel = (geo: OperationAuditLog['geo']) => geo?.label || '位置未知';

const geoDetails = (geo: OperationAuditLog['geo']) => [
  geo?.label,
  geo?.country_code ? `国家代码：${geo.country_code}` : '',
  geo?.postal ? `邮编：${geo.postal}` : '',
  geo?.timezone ? `时区：${geo.timezone}` : '',
  geo?.isp ? `运营商：${geo.isp}` : '',
  geo?.org ? `组织：${geo.org}` : '',
  geo?.asn ? `ASN：${geo.asn}` : '',
  geo?.latitude != null && geo?.longitude != null ? `坐标：${geo.latitude}, ${geo.longitude}` : '',
].filter(Boolean).join(' · ') || '位置未知';

export const UserAuditPanel: React.FC<{ currentPreset: StylePreset }> = ({ currentPreset }) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('全部');
  const [status, setStatus] = useState('全部');
  const [logs, setLogs] = useState<OperationAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(AUDIT_DEFAULT_PAGE_SIZE);
  const [summary, setSummary] = useState<OperationAuditSummary>({ today: 0, activeUsers: 0, success: 0, risks: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    if (error) toast.error(error);
  }, [error, toast]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    operationLogsApi.list({ q: query.trim(), action, status, limit: pageSize, offset: (page - 1) * pageSize })
      .then((result) => {
        if (cancelled) return;
        setLogs(result.items || []);
        setTotal(Number(result.total || 0));
        setSummary(result.summary || { today: 0, activeUsers: 0, success: 0, risks: 0 });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '日志加载失败，请稍后重试');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [action, page, pageSize, query, refreshKey, status]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const exportCsv = () => {
    const header = ['编号', '用户', '邮箱', '操作', '模块', '详情', 'IP 地址', '国家/地区/城市', '设备', '时间', '状态', '风险'];
    const rows = logs.map((log) => [log.id, log.user, log.email, log.action, log.module, log.detail, log.ip, geoLabel(log.geo), log.device, log.time, log.status, log.risk]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mercurypro-operation-audit.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectClass = `h-9 rounded-lg border px-3 text-xs font-semibold outline-none transition focus:border-blue-500 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`;
  const cards = [
    { label: '今日操作', value: summary.today, note: '实时统计', icon: <Clock3 className="h-4 w-4" />, tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
    { label: '活跃用户', value: summary.activeUsers, note: '按日志去重', icon: <UserRound className="h-4 w-4" />, tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10' },
    { label: '成功操作', value: summary.success, note: '当前筛选范围', icon: <CheckCircle2 className="h-4 w-4" />, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
    { label: '高风险事件', value: summary.risks, note: '建议及时复核', icon: <AlertTriangle className="h-4 w-4" />, tone: 'text-rose-600 dark:text-rose-400 bg-rose-500/10' },
  ];
  const auditPalette = {
    realtime: isDark ? 'bg-emerald-950/70 text-emerald-100 border-emerald-700/80' : 'bg-emerald-100 text-emerald-800 border-emerald-300',
    actionSuccess: isDark ? 'bg-blue-950/70 text-blue-100 border-blue-700/80' : 'bg-blue-100 text-blue-800 border-blue-300',
    actionFailure: isDark ? 'bg-rose-950/70 text-rose-100 border-rose-700/80' : 'bg-rose-100 text-rose-800 border-rose-300',
    statusSuccess: isDark ? 'bg-emerald-950/70 text-emerald-100 border-emerald-700/80' : 'bg-emerald-100 text-emerald-800 border-emerald-300',
    statusFailure: isDark ? 'bg-rose-950/70 text-rose-100 border-rose-700/80' : 'bg-rose-100 text-rose-800 border-rose-300',
    riskHigh: isDark ? 'bg-rose-950/70 text-rose-100 border-rose-700/80' : 'bg-rose-100 text-rose-800 border-rose-300',
    riskAttention: isDark ? 'bg-orange-950/70 text-orange-100 border-orange-700/80' : 'bg-orange-100 text-orange-900 border-orange-300',
    riskNormal: isDark ? 'bg-slate-800 text-slate-100 border-slate-600' : 'bg-slate-200 text-slate-800 border-slate-400',
  };

  return (
    <div data-audit-panel={isDark ? 'dark' : 'light'} className={`flex h-full flex-1 flex-col overflow-hidden ${theme.appBg}`}>
      <style>{`
        [data-audit-panel="light"] section p,
        [data-audit-panel="light"] table tbody td,
        [data-audit-panel="light"] table tbody td p {
          color: #29465d !important;
        }
        [data-audit-panel="light"] section p.text-\[11px\] {
          color: #36556b !important;
        }
        [data-audit-panel="light"] thead {
          background: #d5e0e8 !important;
          color: #29465d !important;
        }
        [data-audit-panel="light"] thead th {
          color: #29465d !important;
        }
      `}</style>
      <section className={`shrink-0 border-b px-4 py-4 sm:px-6 ${theme.navBg} ${theme.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-100 text-blue-700'}`}><ShieldCheck className="h-5 w-5" /></span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-base font-extrabold ${theme.textPrimary}`}>操作审计</h2>
                <span className={`audit-live-badge rounded-full border px-2 py-0.5 text-[10px] font-bold ${auditPalette.realtime}`}>实时数据</span>
              </div>
              <p className={`mt-0.5 text-xs ${theme.textSecondary}`}>记录用户关键操作、登录行为与安全风险，便于追溯和审查</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition hover:border-blue-400 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新</button>
            <button type="button" onClick={exportCsv} disabled={!logs.length} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40 ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}><Download className="h-3.5 w-3.5" />导出当前结果</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((item) => <div key={item.label} className={`rounded-xl border p-3 ${theme.cardBg} ${theme.border}`}><div className="flex items-center justify-between gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.tone}`}>{item.icon}</span><span className={`text-[10px] ${theme.textSecondary}`}>{item.note}</span></div><p className={`mt-2 text-xl font-extrabold ${theme.textPrimary}`}>{item.value}</p><p className={`text-[11px] font-semibold ${theme.textSecondary}`}>{item.label}</p></div>)}
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
          <div className={`flex flex-wrap items-center gap-2 border-b p-3 ${theme.border}`}>
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm"><Search className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${theme.textSecondary}`} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索用户、操作详情或 IP 地址" className={`h-9 w-full rounded-lg border bg-transparent pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-blue-500 ${theme.border} ${theme.textPrimary}`} /></div>
            <div className={`hidden h-9 items-center gap-1.5 px-1 text-xs font-bold sm:flex ${theme.textSecondary}`}><Filter className="h-3.5 w-3.5" />筛选</div>
            <select aria-label="按操作类型筛选" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} className={selectClass}>{ACTIONS.map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="按操作状态筛选" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={selectClass}><option>全部</option><option>成功</option><option>失败</option></select>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1345px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[180px]" />
                <col className="w-[120px]" />
                <col className="w-[260px]" />
                <col className="w-[120px]" />
                <col className="w-[190px]" />
                <col className="w-[200px]" />
                <col className="w-[155px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead className={`sticky top-0 z-10 text-center text-[11px] font-bold ${isDark ? 'bg-slate-900 text-slate-400' : 'bg-slate-50 text-slate-500'}`}><tr>{['用户', '操作', '模块 / 详情', 'IP 地址', '位置', '设备', '操作时间', '状态'].map((label) => <th key={label} className={`border-b whitespace-nowrap px-4 py-3 text-center ${theme.border}`}>{label}</th>)}</tr></thead>
              <tbody className="text-center">
                {loading && <tr><td colSpan={8} className={`px-4 py-16 text-center text-xs ${theme.textSecondary}`}><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-500" />正在加载操作日志…</td></tr>}
                {!loading && logs.map((log) => <tr key={log.id} className={`group border-b text-xs transition ${theme.border} ${isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-blue-50/50'}`}>
                  <td className="whitespace-nowrap px-4 py-3.5 text-left"><div className="flex items-center justify-start gap-2.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-extrabold ${log.user === '管理员' ? (isDark ? 'bg-blue-500/25 text-blue-200 ring-1 ring-blue-400/50' : 'bg-blue-100 text-blue-700 ring-1 ring-blue-300') : (isDark ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50' : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300')}`}>{log.user.charAt(0)}</span><div><p className={`font-bold ${theme.textPrimary}`}>{log.user}</p><p className={`mt-0.5 text-[10px] ${theme.textSecondary}`}>{log.email}</p></div></div></td>
                  <td className="whitespace-nowrap px-4 py-3.5"><span className={`audit-action-badge inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-bold ${log.status === '失败' ? auditPalette.actionFailure : auditPalette.actionSuccess}`} data-kind={log.status === '失败' ? 'failure' : 'success'}>{actionIcon(log.action)}{log.action}</span></td>
                  <td className="w-[260px] max-w-[260px] overflow-hidden whitespace-nowrap px-4 py-3.5"><p className={`truncate font-bold ${theme.textPrimary}`}>{log.module}</p><Tooltip content={log.detail} isDark={isDark} placement="top" className="mt-1 block max-w-full"><p className={`block w-full max-w-full truncate text-[11px] ${theme.textSecondary}`} title={log.detail}>{log.detail}</p></Tooltip></td>
                  <td className="w-[120px] max-w-[120px] whitespace-nowrap px-4 py-3.5"><p className={`truncate font-mono font-semibold ${theme.textPrimary}`} title={log.ip}>{log.ip}</p></td>
                  <td className="w-[190px] max-w-[190px] overflow-hidden whitespace-nowrap px-4 py-3.5"><Tooltip content={geoDetails(log.geo)} isDark={isDark} placement="top" className="block max-w-full"><p className={`flex w-[160px] max-w-full min-w-0 items-center justify-center gap-1 truncate text-[10px] ${theme.textSecondary}`} title={geoDetails(log.geo)}><MapPin className="h-3 w-3 shrink-0" /><span className="min-w-0 truncate">{geoLabel(log.geo)}</span></p></Tooltip></td>
                  <td className="w-[200px] max-w-[200px] overflow-hidden whitespace-nowrap px-4 py-3.5"><Tooltip content={log.device} isDark={isDark} placement="top" className="block max-w-full"><p className={`flex w-[170px] max-w-full min-w-0 items-center justify-center gap-1 truncate text-[10px] ${theme.textSecondary}`} title={log.device}><MonitorSmartphone className="h-3 w-3 shrink-0" /><span className="min-w-0 truncate">{log.device}</span></p></Tooltip></td>
                  <td className={`whitespace-nowrap px-4 py-3.5 font-mono text-[11px] ${theme.textSecondary}`}>{log.time}</td>
                  <td className="w-[120px] whitespace-nowrap px-4 py-3.5">{log.status === '成功' ? <span className={`audit-status-badge inline-flex items-center gap-1 rounded-full border px-2 py-1 font-bold ${auditPalette.statusSuccess}`} data-kind="success"><CheckCircle2 className="h-3.5 w-3.5" />成功</span> : <span className={`audit-status-badge inline-flex items-center gap-1 rounded-full border px-2 py-1 font-bold ${auditPalette.statusFailure}`} data-kind="failure"><XCircle className="h-3.5 w-3.5" />失败</span>}</td>
                </tr>)}
              </tbody>
            </table>
            {!loading && !logs.length && <div className={`flex h-48 flex-col items-center justify-center text-center ${theme.textSecondary}`}><Search className="mb-2 h-8 w-8 opacity-40" /><p className="text-sm font-bold">{error ? '暂时无法读取日志' : '没有匹配的操作记录'}</p><p className="mt-1 text-xs">{error ? '请确认后端服务已启动' : '请尝试调整关键词或筛选条件'}</p></div>}
          </div>
          <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} loading={loading} currentPreset={currentPreset} className={`border-t px-4 py-3 ${theme.border}`} />
        </div>
      </div>
    </div>
  );
};


