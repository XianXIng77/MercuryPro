import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CalendarPlus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { authApi, UserDashboardStats, UserStatsPoint } from '../api/auth';
import { StylePreset } from '../types';

interface UserDashboardProps {
  currentPreset: StylePreset;
}

const integerFormatter = new Intl.NumberFormat('zh-CN');

const StatCard = ({
  label,
  value,
  note,
  icon,
  tone,
  theme,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tone: string;
  theme: StylePreset['themeClasses'];
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    className={`relative overflow-hidden rounded-xl border p-4 ${theme.cardBg} ${theme.border} ${theme.shadow}`}
  >
    <div className={`absolute -right-6 -top-7 h-24 w-24 rounded-full opacity-10 ${tone}`} />
    <div className="relative flex items-start justify-between gap-3">
      <div>
        <p className={`text-xs font-medium ${theme.textSecondary}`}>{label}</p>
        <p className={`mt-2 text-3xl font-black tracking-tight ${theme.textPrimary}`}>{value}</p>
        <p className={`mt-1.5 text-[11px] ${theme.textSecondary}`}>{note}</p>
      </div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${tone}`}>
        {icon}
      </span>
    </div>
  </motion.div>
);

const LineChart = ({ points, isDark }: { points: UserStatsPoint[]; isDark: boolean }) => {
  const width = 760;
  const height = 230;
  const padding = { left: 34, right: 16, top: 18, bottom: 32 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  const coordinates = points.map((point, index) => ({
    x: padding.left + (index / Math.max(1, points.length - 1)) * chartWidth,
    y: padding.top + chartHeight - (point.count / maxValue) * chartHeight,
    ...point,
  }));
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${padding.left},${padding.top + chartHeight} ${polyline} ${padding.left + chartWidth},${padding.top + chartHeight}`;
  const gridColor = isDark ? '#475569' : '#cbd5e1';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full" role="img" aria-label="近三十天每日新增用户折线图">
      <defs>
        <linearGradient id="registrationArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = padding.top + chartHeight * ratio;
        return (
          <g key={ratio}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={gridColor} strokeOpacity="0.35" strokeDasharray="4 5" />
            <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'}>
              {Math.round(maxValue * (1 - ratio))}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="url(#registrationArea)" />
      <polyline points={polyline} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {coordinates.map((point, index) => (
        <g key={point.date || point.label}>
          <circle cx={point.x} cy={point.y} r="7" fill="transparent">
            <title>{`${point.label}：${point.count} 位新增用户`}</title>
          </circle>
          <circle cx={point.x} cy={point.y} r={point.count ? 3.5 : 2} fill={point.count ? '#2563eb' : gridColor} />
          {(index === 0 || index === points.length - 1 || index % 5 === 0) && (
            <text x={point.x} y={height - 9} textAnchor="middle" fontSize="9" fill={isDark ? '#94a3b8' : '#64748b'}>
              {point.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

const BarChart = ({ points, isDark }: { points: UserStatsPoint[]; isDark: boolean }) => {
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  return (
    <div className="flex h-[210px] items-end gap-2 pt-7" role="img" aria-label="最近八周用户注册柱状图">
      {points.map((point, index) => (
        <div key={`${point.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
          <span className={`text-[10px] font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{point.count}</span>
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(point.count ? 10 : 3, (point.count / maxValue) * 138)}px` }}
            transition={{ duration: 0.55, delay: index * 0.04 }}
            className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-blue-700 to-cyan-400 shadow-sm"
            title={`${point.label}：${point.count} 位新增用户`}
          />
          <span className={`w-full truncate text-center text-[9px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`} title={point.label}>
            {point.label.split('-')[0]}
          </span>
        </div>
      ))}
    </div>
  );
};

export const UserDashboard: React.FC<UserDashboardProps> = ({ currentPreset }) => {
  const [stats, setStats] = useState<UserDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStats(await authApi.stats());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '用户统计加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const roleTotal = useMemo(
    () => stats?.roleDistribution.reduce((sum, item) => sum + item.count, 0) || 0,
    [stats],
  );
  const adminCount = stats?.roleDistribution.find((item) => item.label === '管理员')?.count || 0;
  const adminPercent = roleTotal ? Math.round((adminCount / roleTotal) * 100) : 0;
  const growth = stats?.summary.growthRate || 0;

  if (loading && !stats) {
    return (
      <div className={`flex-1 overflow-y-auto p-5 sm:p-6 ${theme.appBg}`}>
        <div className="animate-pulse space-y-5">
          <div className={`h-16 w-72 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className={`h-32 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />)}
          </div>
          <div className={`h-80 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className={`flex flex-1 items-center justify-center p-6 ${theme.appBg}`}>
        <div className={`max-w-sm rounded-xl border p-6 text-center ${theme.cardBg} ${theme.border}`}>
          <p className={`text-sm font-bold ${theme.textPrimary}`}>暂时无法加载用户数据</p>
          <p className={`mt-2 text-xs ${theme.textSecondary}`}>{error}</p>
          <button type="button" onClick={() => void loadStats()} className={`mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold ${theme.accentBg}`}>
            <RefreshCw className="h-3.5 w-3.5" />重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${theme.appBg}`}>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
              <p className={`text-[11px] font-bold uppercase tracking-[0.18em] ${theme.textSecondary}`}>User insights</p>
            </div>
            <h2 className={`mt-2 text-2xl font-black tracking-tight ${theme.textPrimary}`}>用户数据仪表盘</h2>
            <p className={`mt-1 text-xs ${theme.textSecondary}`}>实时了解用户规模、近 30 天注册趋势与用户构成</p>
          </div>
          <button type="button" onClick={() => void loadStats()} disabled={loading} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-opacity disabled:opacity-50 ${theme.cardBg} ${theme.border} ${theme.textSecondary}`}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新数据
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="用户总数" value={integerFormatter.format(stats.summary.totalUsers)} note="当前已注册账户" icon={<Users className="h-5 w-5" />} tone="bg-blue-600" theme={theme} />
          <StatCard label="近 30 天新增" value={integerFormatter.format(stats.summary.newUsersLast30Days)} note="最近一个月注册用户" icon={<UserPlus className="h-5 w-5" />} tone="bg-violet-600" theme={theme} />
          <StatCard label="今日新增" value={integerFormatter.format(stats.summary.newUsersToday)} note="从今日 00:00 起" icon={<CalendarPlus className="h-5 w-5" />} tone="bg-emerald-600" theme={theme} />
          <StatCard label="新增用户环比" value={`${growth > 0 ? '+' : ''}${growth}%`} note="对比前一个 30 天" icon={growth >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />} tone={growth >= 0 ? 'bg-amber-500' : 'bg-rose-600'} theme={theme} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className={`rounded-xl border p-4 sm:p-5 xl:col-span-2 ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
            <div className="flex items-center justify-between gap-3">
              <div><h3 className={`text-sm font-bold ${theme.textPrimary}`}>新增用户趋势</h3><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>近 30 天每日注册量</p></div>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold text-blue-500">折线图</span>
            </div>
            <div className="mt-3 overflow-hidden"><LineChart points={stats.dailyRegistrations} isDark={isDark} /></div>
          </section>

          <section className={`rounded-xl border p-4 sm:p-5 ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
            <div className="flex items-center justify-between"><div><h3 className={`text-sm font-bold ${theme.textPrimary}`}>用户角色构成</h3><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>全部注册用户</p></div><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-500">扇形图</span></div>
            <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-center xl:flex-col">
              <div className="relative h-44 w-44 shrink-0 rounded-full shadow-inner" style={{ background: `conic-gradient(#8b5cf6 0 ${adminPercent}%, #3b82f6 ${adminPercent}% 100%)` }} role="img" aria-label={`管理员占 ${adminPercent}%，普通用户占 ${100 - adminPercent}%`}>
                <div className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/55 px-3 py-1.5 text-xs font-black text-white backdrop-blur-sm">{integerFormatter.format(roleTotal)} 人</span></div>
              </div>
              <div className="w-full space-y-3">
                {stats.roleDistribution.map((item, index) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-xs"><span className={`flex items-center gap-2 ${theme.textSecondary}`}><i className={`h-2.5 w-2.5 rounded-sm ${index === 0 ? 'bg-violet-500' : 'bg-blue-500'}`} />{item.label}</span><span className={`font-bold ${theme.textPrimary}`}>{item.count} <small className={`font-normal ${theme.textSecondary}`}>({roleTotal ? Math.round(item.count / roleTotal * 100) : 0}%)</small></span></div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className={`rounded-xl border p-4 sm:p-5 ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
          <div className="flex items-center justify-between"><div><h3 className={`text-sm font-bold ${theme.textPrimary}`}>每周注册表现</h3><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>最近 8 周新增用户对比</p></div><span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-500">柱状图</span></div>
          <BarChart points={stats.weeklyRegistrations} isDark={isDark} />
        </section>
      </div>
    </div>
  );
};
