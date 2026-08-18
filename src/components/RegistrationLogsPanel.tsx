import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ChevronDown,
  CreditCard,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { StylePreset } from '../types';
import { StyledSelect, StyledSelectOption } from './StyledSelect';
import { registrationLogsApi, RegistrationLogItem } from '../api/registrationLogs';

interface RegistrationLogsPanelProps {
  currentPreset: StylePreset;
}

const STAGE_LABELS: Record<string, string> = {
  'plus-trial': 'Plus 试用检查',
  'checkout-kind': 'Checkout 类型检测',
  'registration-error': '注册错误',
};

const OUTCOME_LABELS: Record<string, string> = {
  eligible: '有试用资格',
  ineligible: '无试用资格',
  unknown: '未知',
  disabled: '未开启检查',
  oaics: 'oaics',
  cs_live: 'cs_live',
  cs_test: 'cs_test',
  error: '错误',
  exception: '异常',
  worker_exception: '工作线程异常',
  session_save_failed: '会话保存失败',
};

/** 阶段对应的结果选项(与后端写入的 stage/outcome 组合一致) */
const OUTCOMES_BY_STAGE: Record<string, string[]> = {
  'plus-trial': ['eligible', 'ineligible', 'unknown'],
  'checkout-kind': ['oaics', 'cs_live', 'cs_test', 'unknown', 'disabled'],
  'registration-error': ['error', 'exception', 'worker_exception', 'session_save_failed'],
};

const STAGE_ICONS: Record<string, LucideIcon> = {
  'plus-trial': Sparkles,
  'checkout-kind': CreditCard,
  'registration-error': AlertTriangle,
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage;
}

function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] || outcome;
}

/**
 * 结果胶囊配色,按阶段区分:
 * - Plus 试用检查:检查成功绿 / 未知黄 / 无试用红
 * - Checkout 类型:未开启检查灰底黑字 / 未知黄 / oaics 青 / cs_live 绿(同账号管理)
 * - 注册错误:一律红
 * isDark 分支沿用账号管理的深色配色。
 */
function outcomeTone(stage: string, outcome: string, isDark: boolean): string {
  if (stage === 'plus-trial') {
    if (outcome === 'eligible') {
      return isDark
        ? 'bg-emerald-400/20 text-emerald-200'
        : 'bg-emerald-500/15 text-emerald-700';
    }
    if (outcome === 'ineligible') {
      return isDark
        ? 'border border-rose-400/50 bg-rose-400/20 text-rose-200'
        : 'border border-rose-500/40 bg-rose-500/15 text-rose-700';
    }
    return isDark
      ? 'bg-amber-400/20 text-amber-200'
      : 'bg-amber-500/15 text-amber-700';
  }
  if (stage === 'checkout-kind') {
    if (outcome === 'oaics') {
      return isDark
        ? 'bg-cyan-400/20 text-cyan-200'
        : 'bg-cyan-500/15 text-cyan-700';
    }
    if (outcome === 'cs_live') {
      return isDark
        ? 'bg-emerald-400/20 text-emerald-200'
        : 'bg-emerald-500/15 text-emerald-700';
    }
    if (outcome === 'disabled') {
      return isDark
        ? 'bg-slate-400/20 text-slate-200'
        : 'bg-slate-500/15 text-slate-600';
    }
    return isDark
      ? 'bg-amber-400/20 text-amber-200'
      : 'bg-amber-500/15 text-amber-700';
  }
  return isDark
    ? 'bg-rose-400/20 text-rose-200'
    : 'bg-rose-500/15 text-rose-700';
}

/**
 * 注册诊断日志页(全高布局,同邮箱管理页):
 * - 顶部标题 + 筛选栏(邮箱/阶段/结果,结果筛选可独立使用)
 * - 撑满剩余高度的卡片内滚动展示事件列表,点击卡片展开日志内容(log.txt)
 * - 有截图的事件可查看 screenshot.png
 */
export const RegistrationLogsPanel: React.FC<RegistrationLogsPanelProps> = ({ currentPreset }) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  const [items, setItems] = useState<RegistrationLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [emailFilter, setEmailFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logText, setLogText] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [screenshotId, setScreenshotId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await registrationLogsApi.list({
        email: emailFilter.trim() || undefined,
        stage: stageFilter || undefined,
        outcome: outcomeFilter || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败,请稍后重试');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [emailFilter, stageFilter, outcomeFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 阶段切换时,清掉不再适用的结果筛选
  useEffect(() => {
    const allowed = OUTCOMES_BY_STAGE[stageFilter];
    if (allowed && outcomeFilter && !allowed.includes(outcomeFilter)) {
      setOutcomeFilter('');
    }
  }, [stageFilter, outcomeFilter]);

  // 结果选项:选定阶段时只列该阶段的结果;未选阶段时列出全部(附所属阶段说明)
  const outcomeOptions = useMemo<StyledSelectOption[]>(() => {
    if (stageFilter) {
      return (OUTCOMES_BY_STAGE[stageFilter] || []).map((value) => ({
        value,
        label: outcomeLabel(value),
      }));
    }
    const stagesByOutcome = new Map<string, string[]>();
    for (const [stage, outcomes] of Object.entries(OUTCOMES_BY_STAGE)) {
      for (const value of outcomes) {
        stagesByOutcome.set(value, [...(stagesByOutcome.get(value) || []), stageLabel(stage)]);
      }
    }
    return [...stagesByOutcome.entries()].map(([value, stages]) => ({
      value,
      label: outcomeLabel(value),
      description: stages.join(' / '),
    }));
  }, [stageFilter]);

  const stageOptions = useMemo<StyledSelectOption[]>(
    () => [{ value: '', label: '全部阶段' }, ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))],
    [],
  );

  const openLog = async (item: RegistrationLogItem) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    setLogText('');
    setLogLoading(true);
    try {
      setLogText(await registrationLogsApi.logText(item.id));
    } catch (err) {
      setLogText(err instanceof Error ? err.message : '日志加载失败');
    } finally {
      setLogLoading(false);
    }
  };

  const inputClass = `rounded-xl border px-3 py-2 text-xs outline-none transition-colors ${
    isDark
      ? 'border-slate-600/80 bg-slate-800/60 text-slate-200 placeholder:text-slate-500 focus:border-blue-500/80'
      : 'border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:border-blue-500'
  }`;

  // 事件卡片:叠在主题卡片底色上的浅色表面
  const chipSurface = isDark
    ? 'border-white/[0.09] bg-white/[0.05]'
    : 'border-black/[0.06] bg-black/[0.03]';

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden ${theme.appBg} text-xs`}>
      {/* 顶部:标题 + 筛选栏 */}
      <div className={`p-3 border-b flex flex-wrap items-center gap-3 ${theme.navBg} ${theme.border} shrink-0`}>
        <div className="flex items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${chipSurface}`}>
            <ScrollText className="h-4.5 w-4.5 text-blue-500" />
          </span>
          <div className="hidden lg:block">
            <h2 className={`font-bold leading-tight ${theme.textPrimary}`}>注册诊断日志</h2>
            <p className={`text-[10px] ${theme.textSecondary}`}>Plus 检查 / Checkout 检测 / 注册错误事件</p>
          </div>
        </div>
        <div className="relative min-w-[180px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={emailFilter}
            onChange={(event) => setEmailFilter(event.target.value)}
            placeholder="按邮箱搜索…"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <div className="w-36">
          <StyledSelect
            ariaLabel="筛选阶段"
            value={stageFilter}
            onChange={setStageFilter}
            options={stageOptions}
            isDark={isDark}
          />
        </div>
        <div className="w-44">
          <StyledSelect
            ariaLabel="筛选结果"
            value={outcomeFilter}
            onChange={setOutcomeFilter}
            options={[{ value: '', label: '全部结果' }, ...outcomeOptions]}
            isDark={isDark}
          />
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className={`ml-auto px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50 ${theme.accentBg} ${theme.accentText}`}
          title="刷新列表"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 数据列表大卡片:撑满剩余高度,内部滚动 */}
      <div className={`m-3 flex-1 min-h-0 flex flex-col overflow-hidden rounded-2xl ${theme.cardBg} ${theme.shadow}`}>
        <header className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3 ${theme.border} ${isDark ? 'bg-white/[0.025]' : 'bg-white/30'}`}>
          <p className={`flex items-center gap-2 font-bold ${theme.textPrimary}`}>
            <FileText className="h-3.5 w-3.5 text-blue-500" />
            事件记录
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400">
              共 {total} 条
            </span>
            {total > items.length && items.length > 0 && (
              <span className={`font-normal ${theme.textSecondary}`}>已显示前 {items.length} 条</span>
            )}
          </p>
          <p className={`hidden sm:block ${theme.textSecondary}`}>点击卡片展开日志详情</p>
        </header>

        <div className={`flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 ${isDark ? 'bg-black/5' : 'bg-white/15'}`}>
          {loading && items.length === 0 ? (
            <div className={`flex flex-col items-center justify-center gap-2 py-20 ${theme.textSecondary}`}>
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              正在加载日志列表…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <p className="font-semibold text-rose-500">{error}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="px-4 py-1.5 rounded-lg bg-rose-600 text-white font-semibold"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className={`flex flex-col items-center justify-center gap-2 py-20 ${theme.textSecondary}`}>
              <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${chipSurface}`}>
                <ScrollText className="h-5 w-5" />
              </span>
              <p className="font-semibold">暂无符合条件的日志</p>
              <p>注册流程遇到 Plus 检查失败 / Checkout 检测 / 报错时会自动记录</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((item) => {
                const isExpanded = expandedId === item.id;
                const StageIcon = STAGE_ICONS[item.stage] || FileText;
                const [datePart = '', clockPart = ''] = item.time.split(' ');
                const cardState = isExpanded
                  ? isDark
                    ? 'border-blue-500/50 bg-white/[0.07] shadow-md shadow-blue-500/10'
                    : 'border-blue-500/50 bg-white shadow-md shadow-slate-500/10'
                  : isDark
                    ? 'border-white/[0.08] bg-white/[0.045] hover:border-blue-500/30 hover:bg-white/[0.07] hover:shadow-sm hover:shadow-black/10'
                    : 'border-black/[0.06] bg-white/75 hover:border-blue-500/30 hover:bg-white hover:shadow-sm hover:shadow-slate-500/10';
                return (
                  <div
                    key={item.id}
                    className={`overflow-hidden rounded-xl border transition-all duration-150 ${cardState}`}
                  >
                    <button
                      type="button"
                      onClick={() => void openLog(item)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left sm:px-3.5"
                    >
                      {/* 时间块 */}
                      <div className={`hidden shrink-0 flex-col items-center gap-1 rounded-lg border px-2.5 py-1.5 sm:flex ${chipSurface}`}>
                        <span className={`font-mono text-[11px] font-bold tabular-nums leading-none ${theme.textPrimary}`}>
                          {datePart}
                        </span>
                        <span className={`font-mono text-[10px] tabular-nums leading-none ${theme.textSecondary}`}>
                          {clockPart}
                        </span>
                      </div>

                      {/* 阶段徽标 + Checkout 类型 + 邮箱 */}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${chipSurface} ${
                              isDark ? 'text-slate-200' : 'text-slate-600'
                            }`}
                          >
                            <StageIcon className="h-3 w-3" />
                            {stageLabel(item.stage)}
                          </span>
                          {item.stage === 'checkout-kind' && (
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${outcomeTone(item.stage, item.outcome, isDark)}`}
                            >
                              Checkout 类型:{OUTCOME_LABELS[item.outcome] || item.outcome}
                            </span>
                          )}
                          <span className={`font-mono text-[10px] tabular-nums sm:hidden ${theme.textSecondary}`}>
                            {item.time}
                          </span>
                          {item.hasScreenshot && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                              <ImageIcon className="h-3 w-3" />
                              截图
                            </span>
                          )}
                        </div>
                        <span className={`truncate font-mono font-semibold ${theme.textPrimary}`} title={item.email}>
                          {item.email}
                        </span>
                      </div>

                      {/* 结果 + 展开指示 */}
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${outcomeTone(item.stage, item.outcome, isDark)}`}>
                          {outcomeLabel(item.outcome)}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${theme.textSecondary} ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </button>

                    {/* 展开区:日志内容 + 查看截图入口 */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key="log-detail"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className={`border-t px-3 py-3 sm:px-3.5 ${isDark ? 'border-white/[0.07]' : 'border-black/[0.06]'}`}>
                            {logLoading ? (
                              <div className={`flex items-center justify-center gap-2 py-6 ${theme.textSecondary}`}>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                正在加载日志内容…
                              </div>
                            ) : (
                              <>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <span className={`font-mono text-[10px] font-semibold tracking-wide ${theme.textSecondary}`}>
                                    log.txt
                                  </span>
                                  {item.hasScreenshot && (
                                    <button
                                      type="button"
                                      onClick={() => setScreenshotId(item.id)}
                                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold ${theme.accentBg} ${theme.accentText}`}
                                    >
                                      <ImageIcon className="h-3.5 w-3.5" />
                                      查看截图
                                    </button>
                                  )}
                                </div>
                                <pre
                                  className={`max-h-[420px] overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${
                                    isDark ? 'bg-slate-950/70 text-slate-300' : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {logText || '（日志内容为空）'}
                                </pre>
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              {loading && (
                <div className={`flex items-center justify-center gap-2 py-2 text-[11px] ${theme.textSecondary}`}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在刷新…
                </div>
              )}
            </div>
          )}
        </div>

        <footer className={`px-4 py-2.5 border-t flex items-center justify-between gap-2 ${theme.navBg} ${theme.border}`}>
          <span className={theme.textSecondary}>日志与截图来自本地 log/ 事件目录,注册流程自动写入</span>
          <span className={`hidden sm:inline ${theme.textSecondary}`}>最多展示前 200 条</span>
        </footer>
      </div>

      {/* 截图弹层 */}
      <AnimatePresence>
        {screenshotId && (
          <motion.div
            key="screenshot-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm"
            onClick={() => setScreenshotId(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="relative max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <p className="flex items-center gap-2 font-bold text-slate-200">
                  <ImageIcon className="h-4 w-4 text-blue-400" />
                  事件截图 · {screenshotId}
                </p>
                <button
                  type="button"
                  onClick={() => setScreenshotId(null)}
                  className="rounded-md p-1 text-slate-400 transition-colors hover:text-white"
                  aria-label="关闭截图"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="max-h-[78vh] overflow-auto bg-slate-950/60 p-2">
                <img
                  src={registrationLogsApi.screenshotUrl(screenshotId)}
                  alt={`事件 ${screenshotId} 的浏览器截图`}
                  className="mx-auto block max-w-full rounded-lg"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
