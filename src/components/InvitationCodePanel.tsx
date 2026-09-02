import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, Download, KeyRound, Loader2, Pencil, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import type { StylePreset } from '../types';
import { InviteCodeRecord, grokRegistrationApi } from '../api/grokRegistration';
import { useToast } from './Toast';
import { Pagination } from './Pagination';

interface InvitationCodePanelProps { currentPreset: StylePreset; }
type InviteStatus = 'valid' | 'used' | 'invalid';
const statusMeta: Record<InviteStatus, { label: string; className: string }> = {
  valid: { label: '有效', className: 'border-teal-200 bg-teal-50 text-teal-700' },
  used: { label: '已用', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  invalid: { label: '无效', className: 'border-slate-300 bg-slate-100 text-slate-600' },
};

export const InvitationCodePanel: React.FC<InvitationCodePanelProps> = ({ currentPreset }) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const toast = useToast();
  const [codes, setCodes] = useState<InviteCodeRecord[]>([]);
  const [count, setCount] = useState(1);
  const [maxUses, setMaxUses] = useState(1);
  const [generatedCodes, setGeneratedCodes] = useState<InviteCodeRecord[] | null>(null);
  const [editTarget, setEditTarget] = useState<InviteCodeRecord | null>(null);
  const [editUses, setEditUses] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    toast.showToast({ message: notice.text, tone: notice.tone === 'ok' ? 'success' : 'error' });
    setNotice(null);
  }, [notice, toast]);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InviteStatus>('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const loadCodes = useCallback(async () => {
    setLoading(true);
    try {
      const result = await grokRegistrationApi.inviteCodes({ page, pageSize, keyword, status: statusFilter });
      setCodes(result.codes || []); setTotal(result.total || 0); setPages(Math.max(1, result.pages || 1));
      if (result.page && result.page !== page) setPage(result.page);
      setSelectedCodes([]);
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '邀请码列表加载失败' }); }
    finally { setLoading(false); }
  }, [keyword, page, pageSize, statusFilter]);

  useEffect(() => { void loadCodes(); }, [loadCodes]);

  const generateCodes = async () => {
    setBusy('generate');
    try { const result = await grokRegistrationApi.generateInviteCodes(count, maxUses); setGeneratedCodes(result.codes || []); setNotice({ tone: 'ok', text: `已生成 ${result.codes?.length || 0} 个邀请码，每个可使用 ${maxUses} 次，生成后可直接复制。` }); setPage(1); await loadCodes(); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '邀请码生成失败' }); }
    finally { setBusy(''); }
  };

  const saveUses = async () => { if (!editTarget) return; setBusy('edit-' + editTarget.code); try { await grokRegistrationApi.updateInviteCode(editTarget.code, editUses); setNotice({ tone: 'ok', text: '使用次数已更新。' }); setEditTarget(null); await loadCodes(); } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '使用次数更新失败' }); } finally { setBusy(''); } };

  const revokeCode = async (code: string) => {
    setBusy(`revoke-${code}`);
    try { await grokRegistrationApi.revokeInviteCode(code); setNotice({ tone: 'ok', text: `邀请码 ${code} 已撤销。` }); await loadCodes(); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : '邀请码撤销失败' }); }
    finally { setBusy(''); }
  };

  const confirmRevoke = async () => { if (!revokeTarget) return; const code = revokeTarget; setRevokeTarget(null); await revokeCode(code); };
const copyCode = async (code: string) => { try { await navigator.clipboard.writeText(code); setNotice({ tone: 'ok', text: `邀请码 ${code} 已复制。` }); } catch { setNotice({ tone: 'error', text: '复制失败，请手动选择邀请码。' }); } };
const copySelected = async () => { if (!selectedCodes.length) return; try { await navigator.clipboard.writeText(selectedCodes.join('\n')); setNotice({ tone: 'ok', text: `已复制 ${selectedCodes.length} 个邀请码，每行一个。` }); } catch { setNotice({ tone: 'error', text: '批量复制失败，请重试。' }); } };
  const exportSelected = () => { if (!selectedCodes.length) return; const blob = new Blob([`${selectedCodes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `invite-codes-${new Date().toISOString().slice(0, 10)}.txt`; link.click(); URL.revokeObjectURL(url); setNotice({ tone: 'ok', text: `已导出 ${selectedCodes.length} 个邀请码，每行一个。` }); };
  const toggleCode = (code: string) => setSelectedCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  const allSelected = codes.length > 0 && codes.every((item) => selectedCodes.includes(item.code));
  const toggleAll = () => setSelectedCodes((current) => allSelected ? current.filter((code) => !codes.some((item) => item.code === code)) : [...new Set([...current, ...codes.map((item) => item.code)])]);

  const getMaxUses = (item: InviteCodeRecord) => Math.max(1, Number(item.max_uses || 1));
  const getStatus = (item: InviteCodeRecord): InviteStatus => { if (item.status === 'valid' || item.status === 'used' || item.status === 'invalid') return item.status; if (!item.enabled) return 'invalid'; return item.uses >= getMaxUses(item) ? 'used' : 'valid'; };
  const summary = useMemo(() => ({ valid: codes.filter((item) => getStatus(item) === 'valid').length, used: codes.filter((item) => getStatus(item) === 'used').length, invalid: codes.filter((item) => getStatus(item) === 'invalid').length }), [codes]);
  const cardClass = `rounded-2xl border ${theme.cardBg} ${theme.border} ${theme.shadow}`;
  const fieldClass = `w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-blue-500/40 ${isDark ? 'border-white/10 bg-white/[0.035] text-slate-100 placeholder-slate-500' : 'border-slate-300 bg-white text-slate-800 placeholder-slate-400'}`;

  return (<>
    <div className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${theme.appBg}`}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="flex min-h-full w-full flex-col"><div className={`${cardClass} flex min-h-full flex-1 flex-col overflow-hidden`}>
        <div className={`border-b px-5 py-5 sm:px-7 ${theme.border}`}><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm"><KeyRound className="h-5 w-5" /></div><div className="min-w-0"><h1 className={`text-lg font-extrabold ${theme.textPrimary}`}>邀请码中心</h1><p className="mt-1 text-xs leading-5 text-slate-700">管理注册邀请码，开始 Grok / ChatGPT 注册任务前必须填写有效邀请码。</p></div></div><div className="grid grid-cols-3 gap-2 sm:min-w-[300px]">{(['valid', 'used', 'invalid'] as InviteStatus[]).map((status) => <motion.div key={status} whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300 }} className={`rounded-xl border px-3 py-2 ${statusMeta[status].className}`}><p className="text-[10px] font-semibold opacity-80">{statusMeta[status].label}</p><p className="mt-0.5 text-lg font-extrabold">{summary[status]}</p></motion.div>)}</div></div></div>
        <div className="flex flex-1 flex-col gap-5 p-5 sm:p-7"><div className={`rounded-2xl border p-5 ${theme.border} ${isDark ? 'bg-blue-500/[0.08]' : 'bg-blue-50/80'}`}><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-300" /><div><h2 className={`text-sm font-bold ${theme.textPrimary}`}>生成注册邀请码</h2><p className={`mt-1 text-xs leading-5 ${theme.textSecondary}`}>邀请码可重复使用；使用过的显示为“已用”，撤销后显示为“无效”。</p></div></div><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>生成数量</span><input type="number" min={1} max={50} value={count} onChange={(event) => setCount(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} className={`${fieldClass} sm:w-44`} /><span className={`block text-[10px] ${theme.textSecondary}`}>单次最多生成 50 个</span></label><label className="space-y-1.5"><span className="block text-xs font-bold">每个可使用次数</span><input type="number" min={1} max={1000} value={maxUses} onChange={(event) => setMaxUses(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" /><span className="block text-[10px] text-slate-500">生成后可单独修改</span></label><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => void generateCodes()} disabled={!!busy || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"><KeyRound className="h-4 w-4" />{busy === 'generate' ? '生成中…' : '生成邀请码'}</motion.button><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => void loadCodes()} disabled={!!busy || loading} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold ${theme.border} ${theme.textPrimary} disabled:opacity-50`}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新列表</motion.button></div></div>
        <div className={`${cardClass} flex min-h-0 flex-1 flex-col overflow-hidden`}><div className={`flex flex-col gap-3 border-b px-5 py-4 ${theme.border} lg:flex-row lg:items-center lg:justify-between`}><div><h2 className={`text-sm font-bold ${theme.textPrimary}`}>已生成的邀请码</h2><p className={`mt-1 text-[11px] ${theme.textSecondary}`}>支持模糊查询、状态筛选和多选导出。</p></div><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div className="flex min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1 sm:w-64"><Search className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${theme.textSecondary}`} /><input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setKeyword(keywordInput.trim()); setPage(1); } }} placeholder="模糊搜索邀请码" className={`${fieldClass} pl-9`} /></div><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => { setKeyword(keywordInput.trim()); setPage(1); }} className="rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-500">查询</motion.button></div><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as 'all' | InviteStatus); setPage(1); }} className={`${fieldClass} sm:w-28`}><option value="all">全部状态</option><option value="valid">有效</option><option value="used">已用</option><option value="invalid">无效</option></select></div></div>
          <div className={`flex flex-wrap items-center gap-2 border-b px-5 py-3 ${theme.border}`}><button type="button" onClick={toggleAll} disabled={!codes.length || loading} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${theme.border} ${theme.textPrimary} disabled:opacity-40`}>{allSelected ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded border border-current" />} {allSelected ? '取消全选' : '选择当前页'}</button><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => void copySelected()} disabled={!selectedCodes.length} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"><Copy className="h-3.5 w-3.5" />复制所选 ({selectedCodes.length})</motion.button><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={exportSelected} disabled={!selectedCodes.length} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300 disabled:opacity-40"><Download className="h-3.5 w-3.5" />导出所选</motion.button></div>
          <div className="min-h-0 flex-1 overflow-y-auto">{loading && !codes.length ? <div className={`flex items-center justify-center gap-2 p-16 text-xs ${theme.textSecondary}`}><Loader2 className="h-4 w-4 animate-spin" />正在读取邀请码…</div> : codes.length ? <div className="divide-y divide-slate-500/10">{codes.map((item, index) => { const status = getStatus(item); const selected = selectedCodes.includes(item.code); return <motion.div key={item.code} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(index * 0.035, 0.25) }} className={`flex flex-col justify-between gap-3 px-5 py-4 transition hover:bg-blue-500/[0.04] sm:flex-row sm:items-center ${selected ? 'bg-blue-500/[0.06]' : ''}`}><div className="flex min-w-0 items-center gap-3"><input type="checkbox" checked={selected} onChange={() => toggleCode(item.code)} className="h-4 w-4 accent-blue-600" /><div className="min-w-0"><code className={`text-sm font-bold tracking-wider ${status === 'invalid' ? 'text-slate-400 line-through' : theme.textPrimary}`}>{item.code}</code><p className={`mt-1 text-[11px] ${theme.textSecondary}`}>生成于 {item.created_at ? new Date(item.created_at).toLocaleString() : '--'} · 已使用 {item.uses} / {getMaxUses(item)} 次{item.last_used_at ? ` · 最近使用 ${new Date(item.last_used_at).toLocaleString()}` : ''}</p></div></div><div className="flex items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${statusMeta[status].className}`}>{statusMeta[status].label}</span><motion.button whileTap={{ scale: 0.94 }} type="button" onClick={() => void copyCode(item.code)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold ${theme.border} ${theme.textPrimary}`}><Copy className="h-3.5 w-3.5" />复制</motion.button><motion.button whileTap={{ scale: 0.94 }} type="button" onClick={() => { setEditTarget(item); setEditUses(getMaxUses(item)); }} disabled={!!busy || status === 'invalid'} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 px-3 py-1.5 text-[10px] font-bold text-blue-600 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" />次数</motion.button><motion.button whileTap={{ scale: 0.94 }} type="button" onClick={() => setRevokeTarget(item.code)} disabled={!!busy || status === 'invalid'} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />撤销</motion.button></div></motion.div>; })}</div> : <div className={`p-16 text-center text-xs ${theme.textSecondary}`}>{keyword || statusFilter !== 'all' ? '没有匹配的邀请码。' : '还没有邀请码，请先生成一个。'}</div>}</div>
          <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} loading={loading} currentPreset={currentPreset} className={`border-t px-5 py-3 ${theme.border}`} />
        </div></div></div></div></div>
    </div>    {revokeTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="revoke-dialog-title"><motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${theme.cardBg} ${theme.border}`}><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"><Trash2 className="h-5 w-5" /></div><div className="min-w-0"><h2 id="revoke-dialog-title" className={`text-base font-extrabold ${theme.textPrimary}`}>撤销邀请码</h2><p className={`mt-1 text-xs leading-5 ${theme.textSecondary}`}>确定要撤销 <code className={`font-bold ${theme.textPrimary}`}>{revokeTarget}</code> 吗？撤销后将不能继续注册。</p></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setRevokeTarget(null)} className={`rounded-xl border px-4 py-2 text-xs font-bold ${theme.border} ${theme.textPrimary}`}>取消</button><motion.button whileTap={{ scale: 0.96 }} type="button" onClick={() => void confirmRevoke()} className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-400">确认撤销</motion.button></div></motion.div></div>}
    {generatedCodes && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true"><motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg rounded-2xl border border-blue-200 bg-white p-5 shadow-2xl"><h2 className="flex items-center gap-2 text-base font-extrabold text-slate-800"><Sparkles className="h-5 w-5 text-blue-600" />新邀请码已生成</h2><p className="mt-1 text-xs text-slate-500">每个邀请码可使用 {maxUses} 次，复制后即可分享。</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{generatedCodes.map((item) => <div key={item.code} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5"><code className="font-bold tracking-wider text-slate-800">{item.code}</code><button type="button" onClick={() => void copyCode(item.code)} className="text-xs font-bold text-blue-600"><Copy className="mr-1 inline h-3.5 w-3.5" />复制</button></div>)}</div><button type="button" onClick={() => setGeneratedCodes(null)} className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">完成</button></motion.div></div>}
    {editTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true"><motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"><h2 className="text-base font-extrabold text-slate-800">修改使用次数</h2><p className="mt-1 text-xs text-slate-500">已使用 {editTarget.uses} 次，不能设置更小额度。</p><input type="number" min={Math.max(1, editTarget.uses)} max={1000} value={editUses} onChange={(event) => setEditUses(Math.max(editTarget.uses, Number(event.target.value) || editTarget.uses))} className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditTarget(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">取消</button><button type="button" onClick={() => void saveUses()} disabled={!!busy} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">保存</button></div></motion.div></div>}
  </>);
};
