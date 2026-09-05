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
import { PermissionEmptyState } from './PermissionEmptyState';
import { StylePreset } from '../types';

interface UserDashboardProps {
  currentPreset: StylePreset;
  permissionCodes?: string[];
}

const integerFormatter = new Intl.NumberFormat('zh-CN');

const StatCard = ({
  label,
  value,
  note,
  icon,
  tone,
  theme,
  delay = 0,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tone: string;
  theme: StylePreset['themeClasses'];
  delay?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -4, scale: 1.015 }}
    transition={{ type: 'spring', stiffness: 360, damping: 24, delay }}
    className={`group relative overflow-hidden rounded-xl border p-4 transition-shadow hover:shadow-lg ${theme.cardBg} ${theme.border} ${theme.shadow}`}
  >
    <div className={`absolute -right-6 -top-7 h-24 w-24 rounded-full opacity-10 ${tone}`} />
    <div className="pointer-events-none absolute inset-x-0 -top-20 h-20 rotate-6 bg-white/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:top-[120%] group-hover:opacity-100" />
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
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
      <motion.polygon points={area} fill="url(#registrationArea)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.35 }} />
      <motion.polyline points={polyline} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0, opacity: 0.2 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.25, ease: [0.22, 1, 0.36, 1] }} />
      {hoveredIndex !== null && <motion.line x1={coordinates[hoveredIndex].x} x2={coordinates[hoveredIndex].x} y1={padding.top} y2={padding.top + chartHeight} stroke="#3b82f6" strokeOpacity="0.35" strokeDasharray="3 4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}
      {coordinates.map((point, index) => (
        <g key={point.date || point.label} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} className="cursor-crosshair">
          <circle cx={point.x} cy={point.y} r="12" fill="transparent">
            <title>{`${point.label}：${point.count} 位新增用户`}</title>
          </circle>
          <motion.circle cx={point.x} cy={point.y} r={point.count ? 3.5 : 2} fill={point.count ? '#2563eb' : gridColor} animate={{ r: hoveredIndex === index ? 6 : point.count ? 3.5 : 2 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }} />
          {hoveredIndex === index && <motion.g initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <rect x={Math.min(width - 122, Math.max(6, point.x - 58))} y={Math.max(4, point.y - 48)} width="116" height="34" rx="8" fill={isDark ? '#0f172a' : '#ffffff'} stroke="#60a5fa" strokeOpacity="0.7" />
            <text x={Math.min(width - 122, Math.max(6, point.x - 58)) + 58} y={Math.max(4, point.y - 48) + 14} textAnchor="middle" fontSize="10" fontWeight="600" fill={isDark ? '#e2e8f0' : '#334155'}>{point.label}</text>
            <text x={Math.min(width - 122, Math.max(6, point.x - 58)) + 58} y={Math.max(4, point.y - 48) + 27} textAnchor="middle" fontSize="11" fontWeight="800" fill="#2563eb">{point.count} 位新增用户</text>
          </motion.g>}
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  return (
    <div className="flex h-[210px] items-end gap-2 pt-7" role="img" aria-label="最近八周用户注册柱状图">
      {points.map((point, index) => (
        <div key={`${point.label}-${index}`} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2" onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
          {hoveredIndex === index && <motion.div initial={{ opacity: 0, y: 5, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[10px] shadow-lg ${isDark ? 'border-slate-600 bg-slate-900 text-slate-100' : 'border-blue-100 bg-white text-slate-700'}`} style={{ bottom: `${Math.max(point.count ? 10 : 3, (point.count / maxValue) * 138) + 36}px` }}><span className="font-bold text-blue-600">{point.count}</span> 位新增用户</motion.div>}
          <span className={`text-[10px] font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{point.count}</span>
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(point.count ? 10 : 3, (point.count / maxValue) * 138)}px` }}
            transition={{ duration: 0.55, delay: index * 0.04 }}
            whileHover={{ scaleX: 1.12, filter: 'brightness(1.15)' }}
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


const DonutChart = ({ points, isDark }: { points: UserStatsPoint[]; isDark: boolean }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const colors = ['#8b5cf6', '#3b82f6', '#14b8a6', '#f59e0b'];
  let offset = 0;
  return (
    <div className="relative h-44 w-44 shrink-0" role="img" aria-label="用户角色构成环形图">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90 overflow-visible">
        <circle cx="80" cy="80" r={radius} fill="none" stroke={isDark ? '#1e293b' : '#e2e8f0'} strokeWidth="22" />
        {points.map((point, index) => {
          const percent = total ? point.count / total : 0;
          const dash = percent * circumference;
          const currentOffset = offset;
          offset += dash;
          return (
            <motion.circle key={point.label} cx="80" cy="80" r={radius} fill="none" stroke={colors[index % colors.length]} strokeWidth={hoveredIndex === index ? 26 : 22} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-currentOffset} strokeLinecap="butt" initial={{ strokeDasharray: `0 ${circumference}` }} animate={{ strokeDasharray: `${dash} ${circumference - dash}` }} transition={{ duration: 0.9, delay: 0.15 + index * 0.12, ease: 'easeOut' }} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)} className="cursor-pointer transition-[stroke-width]" />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/55 px-3 py-1.5 text-xs font-black text-white backdrop-blur-sm">{integerFormatter.format(total)} 人</span></div>
      {hoveredIndex !== null && <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`pointer-events-none absolute -right-20 top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[10px] shadow-lg ${isDark ? 'border-slate-600 bg-slate-900 text-slate-100' : 'border-violet-100 bg-white text-slate-700'}`}><span className="font-bold" style={{ color: colors[hoveredIndex % colors.length] }}>{points[hoveredIndex].label}</span>：{points[hoveredIndex].count} 人（{total ? Math.round(points[hoveredIndex].count / total * 100) : 0}%）</motion.div>}
    </div>
  );
};

export const UserDashboard: React.FC<UserDashboardProps> = ({ currentPreset, permissionCodes = [] }) => {
  const [stats, setStats] = useState<UserDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chartRevision, setChartRevision] = useState(0);
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const canViewDashboard = permissionCodes.includes('dashboard:view');

  const loadStats = useCallback(async (minimumSpinMs = 0) => {
    const startedAt = Date.now();
    const waitForVisibleSpin = async () => {
      const remaining = minimumSpinMs - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      }
    };
    setLoading(true);
    setError('');
    try {
      const nextStats = await authApi.stats();
      await waitForVisibleSpin();
      setStats(nextStats);
      setChartRevision((revision) => revision + 1);
    } catch (reason) {
      await waitForVisibleSpin();
      setError(reason instanceof Error ? reason.message : '用户统计加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canViewDashboard) void loadStats();
  }, [canViewDashboard, loadStats]);

  const roleTotal = useMemo(
    () => stats?.roleDistribution.reduce((sum, item) => sum + item.count, 0) || 0,
    [stats],
  );
  const growth = stats?.summary.growthRate || 0;

  if (!canViewDashboard) {
    return <PermissionEmptyState currentPreset={currentPreset} description="暂无访问数据仪表盘的权限" />;
  }

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
          <button type="button" onClick={() => void loadStats(720)} disabled={loading} className={`rounded-lg border p-2 transition hover:border-blue-400 disabled:opacity-50 ${theme.cardBg} ${theme.border} ${theme.textSecondary}`} title="刷新数据" aria-label="刷新数据">
            <motion.span className="inline-flex" animate={{ rotate: loading ? 360 : 0 }} transition={loading ? { duration: 0.65, ease: 'linear', repeat: Infinity } : { duration: 0.15 }}>
              <RefreshCw className="h-4 w-4" />
            </motion.span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="用户总数" value={integerFormatter.format(stats.summary.totalUsers)} note="当前已注册账户" icon={<Users className="h-5 w-5" />} tone="bg-blue-600" theme={theme} delay={0.05} />
          <StatCard label="近 30 天新增" value={integerFormatter.format(stats.summary.newUsersLast30Days)} note="最近一个月注册用户" icon={<UserPlus className="h-5 w-5" />} tone="bg-violet-600" theme={theme} delay={0.1} />
          <StatCard label="今日新增" value={integerFormatter.format(stats.summary.newUsersToday)} note="从今日 00:00 起" icon={<CalendarPlus className="h-5 w-5" />} tone="bg-emerald-600" theme={theme} delay={0.15} />
          <StatCard label="新增用户环比" value={`${growth > 0 ? '+' : ''}${growth}%`} note="对比前一个 30 天" icon={growth >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />} tone={growth >= 0 ? 'bg-amber-500' : 'bg-rose-600'} theme={theme} delay={0.2} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.25 }} className={`rounded-xl border p-4 sm:p-5 xl:col-span-2 ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
            <div className="flex items-center justify-between gap-3">
              <div><h3 className={`text-sm font-bold ${theme.textPrimary}`}>新增用户趋势</h3><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>近 30 天每日注册量</p></div>
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold text-blue-500">折线图</span>
            </div>
            <div className="mt-3 overflow-hidden"><React.Fragment key={`line-${chartRevision}`}><LineChart points={stats.dailyRegistrations} isDark={isDark} /></React.Fragment></div>
          </motion.section>

          <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.4 }} className={`rounded-xl border p-4 sm:p-5 ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
            <div className="flex items-center justify-between"><div><h3 className={`text-sm font-bold ${theme.textPrimary}`}>用户角色构成</h3><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>全部注册用户</p></div><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold text-violet-500">扇形图</span></div>
            <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-center xl:flex-col">
              <React.Fragment key={`donut-${chartRevision}`}><DonutChart points={stats.roleDistribution} isDark={isDark} /></React.Fragment>
              <div className="w-full space-y-3">
                {stats.roleDistribution.map((item, index) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-xs"><span className={`flex items-center gap-2 ${theme.textSecondary}`}><i className={`h-2.5 w-2.5 rounded-sm ${index === 0 ? 'bg-violet-500' : 'bg-blue-500'}`} />{item.label}</span><span className={`font-bold ${theme.textPrimary}`}>{item.count} <small className={`font-normal ${theme.textSecondary}`}>({roleTotal ? Math.round(item.count / roleTotal * 100) : 0}%)</small></span></div>
                ))}
              </div>
            </div>
          </motion.section>
        </div>

        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.55 }} className={`rounded-xl border p-4 sm:p-5 ${theme.cardBg} ${theme.border} ${theme.shadow}`}>
          <div className="flex items-center justify-between"><div><h3 className={`text-sm font-bold ${theme.textPrimary}`}>每周注册表现</h3><p className={`mt-0.5 text-[11px] ${theme.textSecondary}`}>最近 8 周新增用户对比</p></div><span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold text-cyan-500">柱状图</span></div>
          <React.Fragment key={`bar-${chartRevision}`}><BarChart points={stats.weeklyRegistrations} isDark={isDark} /></React.Fragment>
        </motion.section>
      </div>
    </div>
  );
};
