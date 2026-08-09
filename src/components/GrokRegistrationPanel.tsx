import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  Activity,
  ChevronDown,
  CircleDot,
  FileText,
  Globe2,
  ListChecks,
  Loader2,
  Mail,
  Pause,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { StylePreset } from '../types';
import {
  GrokConfig,
  GrokMonitor,
  RegistrationPerformanceProfile,
  RotationList,
  grokRegistrationApi,
} from '../api/grokRegistration';
import { ConfirmDialog } from './ConfirmDialog';

type ConfigTab = 'registration' | 'mail' | 'proxy' | 'import' | 'rotation';

const DEFAULT_CONFIG: GrokConfig = {
  registration_target: 'grok',
  registration_mode: 'browser',
  count: 1,
  concurrency: 1,
  stagger_ms: 1200,
  auto_tune_enabled: false,
  pre_import_probe_enabled: true,
  grok_headless: true,
  captcha_provider: 'local',
  local_solver_url: 'http://127.0.0.1:5072',
  yescaptcha_key: '',
  mail_provider: 'custom',
  mail_base_url: '',
  mail_api_key: '',
  mail_domain: '',
  mail_prefix: '',
  mail_expiry_ms: 86400000,
  hotmail_local_base_url: 'http://127.0.0.1:17373',
  proxy: '',
  proxy_strategy: 'round_robin',
  import_concurrency: 1,
  import_stagger_ms: 10000,
  auto_import_enabled: false,
  auto_import_target: 'sub2api',
  registration_json_format: 'sub2api',
  sub2api_base_url: '',
  sub2api_auth_mode: 'password',
  sub2api_admin_email: '',
  sub2api_admin_password: '',
  sub2api_api_key: '',
  sub2api_xai_group_id: 0,
  sub2api_xai_group_name: '',
  cpa_base_url: '',
  cpa_management_key: '',
};

const FINISHED = new Set(['done', 'success', 'completed', 'partial', 'error', 'failed', 'cancelled', 'stopped']);
const CONCURRENCY_WARNING_KEY = 'mercurypro_grok_concurrency_warning_ack';
const EMPTY_ROTATION: RotationList = {
  items: [], total: 0, page: 1, page_size: 20, pages: 1,
  summary: { total: 0, normal: 0, error: 0 }, poll: {},
};

function rotationDate(value?: number): string {
  return value ? new Date(value * 1000).toLocaleString() : '--';
}

function rotationDuration(start?: number, end?: number): string {
  if (!start) return '--';
  const seconds = Math.max(0, Math.floor((Number(end || Date.now() / 1000) - start)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function mergeConfig(value: Partial<GrokConfig>): GrokConfig {
  return {
    ...DEFAULT_CONFIG,
    ...value,
    registration_target: 'grok',
    registration_mode: 'browser',
    mail_provider: value.mail_provider === 'hotmail_local' ? 'hotmail_local' : 'custom',
  };
}

type FlowState = 'pending' | 'running' | 'done' | 'failed';
type LogTone = 'info' | 'success' | 'warning' | 'error';

const REGISTRATION_FLOW: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'open', label: '打开 xAI 注册页面', pattern: /visiting signup|navigate: ready|signup_method|打开.*注册页面|访问.*注册页面/i },
  { key: 'email', label: '准备注册邮箱', pattern: /queued; email=|email: (?:filling|filled|submitted)|sending email validation|注册邮箱/i },
  { key: 'password', label: '校验注册密码', pattern: /password: (?:filling|filled|submitted)|注册密码/i },
  { key: 'captcha', label: '完成本地人机验证', pattern: /turnstile|captcha|human_verification|人机验证|过盾/i },
  { key: 'verification', label: '获取邮箱验证码', pattern: /verification|code received|邮箱验证码|waiting for xai/i },
  { key: 'account', label: '创建 xAI 账号', pattern: /creating xai account|xai 浏览器注册成功|completion: done|创建.*账号/i },
  { key: 'oauth', label: '完成本地 OAuth 授权', pattern: /at\/rt|token_exchanged|local_oauth|oauth|pkce|授权回调/i },
  { key: 'json', label: '生成 xAI 账号 JSON', pattern: /转换.*json|本地账号已保存|写入本地账户池|认证文件/i },
  { key: 'probe', label: '导入前账号测活', pattern: /导入前测活|队列测活|probe_|测活上游|正在执行队列测活/i },
  { key: 'site', label: '导入站点并绑定分组', pattern: /队列导入|手动导入|auto_import|导入.*(?:cpa|sub2api)|绑定分组/i },
];

const FAILURE_STATUSES = new Set(['error', 'failed', 'protocol_error', 'protocol_blocked', 'account_error', 'cancelled']);
const SUCCESS_STATUSES = new Set(['imported', 'success', 'completed', 'done', 'probe_complete']);
const WARNING_STATUSES = new Set(['waiting_solver', 'solving_turnstile', 'waiting_email', 'queued', 'starting', 'paused', 'pausing', 'probe_queued', 'import_queued', 'probe_retry_pending', 'probe_uncertain']);

interface HotmailVerificationEntry {
  status?: string;
  code?: string;
  email?: string;
  error?: string;
}

interface HotmailAccount {
  id: string;
  email?: string;
  used?: boolean;
  use_count?: number;
  use_limit?: number;
  remaining_uses?: number;
  next_alias_email?: string;
  failed?: boolean;
  failure_reason?: string;
  reserved?: boolean;
  mail_healthy?: boolean | null;
  mail_health_error?: string;
  preferred_for_next_use?: boolean;
  client_id_masked?: string;
  refresh_token_masked?: string;
  verification_entries?: HotmailVerificationEntry[];
}

type PendingConfirmation =
  | { kind: 'reset-monitor' }
  | { kind: 'delete-hotmail'; account: HotmailAccount }
  | { kind: 'delete-rotation'; ids: string[] };

interface HotmailPool {
  accounts?: HotmailAccount[];
  total?: number;
  available?: number;
  available_accounts?: number;
  used?: number;
  failed?: number;
  healthy?: number;
  unhealthy?: number;
  unchecked?: number;
  alias_uses?: number;
}

interface RegistrationLog {
  key: string;
  at: number;
  status: string;
  message: string;
  source: string;
  step: number;
  tone: LogTone;
}

function translateStructuredXaiMessage(text: string): string {
  const match = text.match(/^\[xai\]\s+([^:]+):\s*([^ (]+)(.*)$/i);
  if (!match) return '';
  const names: Record<string, string> = {
    init: '初始化浏览器', navigate: '打开 xAI 官网', signup_method: '选择邮箱注册', email: '填写注册邮箱',
    password: '填写注册密码', profile: '填写账号资料', human_verification: '处理人机验证', verification: '处理邮箱验证码',
    completion: '完成注册', local_oauth: '本地 OAuth 授权', flow: '注册流程',
  };
  const states: Record<string, string> = {
    starting: '开始执行', launched_camoufox: '已启动 Camoufox 浏览器', launched_chromium: '已启动 Chromium 浏览器',
    reused_browser: '正在复用当前并发窗口', private_context_created: '已创建全新隐私上下文', loading: '正在加载', ready: '页面已就绪',
    selecting_email: '正在选择邮箱注册', selected: '已选择邮箱注册', generated: '已随机生成', filling: '正在填写', filled: '填写完成',
    waiting_before_submit: '填写完成，等待提交', submitted: '已提交', detected: '已检测到验证组件', waiting: '正在等待',
    manual: '等待人工处理', clicked: '已点击验证组件', passed: '已通过', passed_after_widget_success: '已通过', not_required: '无需验证',
    waiting_for_code: '正在等待验证码', code_received: '已收到验证码', code_filled: '验证码已填写', retrying: '验证码错误，正在重新获取',
    waiting_for_transition: '已点击提交，正在确认页面变化', retrying_submit: '页面未变化，正在重新提交', transition_detected: '已确认进入下一页面',
    waiting_for_landing: '已注册，等待进入登录页面', done: '已完成', opening_authorization: '正在打开本地 OAuth 授权页',
    approval_submitted: '允许操作已提交', code_captured: '已取得授权回调', oob_code_captured: '已取得页面授权码', debug_hold: '保留失败页面',
  };
  let detail = match[3] || '';
  if (match[1] === 'verification' && match[2] === 'code_received') {
    const code = detail.match(/\bcode=([A-Z0-9]{6})\b/i)?.[1];
    detail = code ? `：${code}` : '';
  }
  return `${names[match[1]] || match[1]}：${states[match[2]] || match[2]}${detail}`;
}

function translateLogMessage(value?: string): string {
  const text = String(value || '').split(/\r?\nCall log:/i, 1)[0].trim();
  if (!text) return '任务状态更新';
  const xai = translateStructuredXaiMessage(text);
  if (xai) return xai;
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^finished (\d+)\/(\d+) \(ok=(\d+) fail=(\d+), threads=(\d+)\)$/i))) {
    return `批次完成 ${match[1]}/${match[2]}：成功 ${match[3]}，失败 ${match[4]}，并发 ${match[5]}`;
  }
  if ((match = text.match(/^running (\d+)\/(\d+) done \(ok=(\d+) fail=(\d+), threads=(\d+), inflight=(\d+)\)$/i))) {
    return `批次处理中：完成 ${match[1]}/${match[2]}，成功 ${match[3]}，失败 ${match[4]}，当前处理 ${match[6]}`;
  }
  const replacements: Array<[RegExp, string]> = [
    [/^batch started count=(\d+) concurrency=(\d+)$/i, '批量注册已启动：共 $1 个账号，并发 $2'],
    [/^started; email=/i, '注册线程已启动，邮箱：'],
    [/^queued; email=/i, '已创建邮箱并进入注册队列：'],
    [/^visiting signup page$/i, '正在打开 Grok 注册页面'],
    [/^solving Turnstile via (.+?) \(before email code\)$/i, '正在使用 $1 完成人机验证'],
    [/^primary Turnstile failed/i, '首次人机验证失败，正在切换地址重试'],
    [/^sending email validation code$/i, '正在发送邮箱验证码'],
    [/^waiting for xAI verification code$/i, '正在等待 Grok 邮箱验证码'],
    [/^waiting for fresh xAI verification code$/i, '正在等待新的 Grok 邮箱验证码'],
    [/^code received: .*; verifying \+ creating immediately$/i, '已收到验证码，正在验证并创建账号'],
    [/^fresh code received: .*$/i, '已收到新的邮箱验证码'],
    [/^creating xAI account \(attempt (\d+)\/(\d+)\)$/i, '正在创建 Grok 账号，第 $1/$2 次尝试'],
    [/^failed:\s*/i, '注册失败：'],
    [/^cancelled by user$/i, '用户已取消注册'],
    [/^registration cancelled$/i, '注册已取消'],
    [/^missing password for registration session$/i, '注册任务缺少密码'],
    [/^missing email for registration session$/i, '注册任务缺少邮箱'],
  ];
  let output = text;
  for (const [pattern, replacement] of replacements) output = output.replace(pattern, replacement);
  return output;
}

function logTone(status?: string, message?: string): LogTone {
  const key = String(status || '').toLowerCase();
  const text = String(message || '');
  const failedCounts = [...text.matchAll(/失败\s*[=:：]?\s*(\d+)/g)].map((item) => Number(item[1]));
  const successCounts = [...text.matchAll(/(?:成功|通过)\s*[=:：]?\s*(\d+)/g)].map((item) => Number(item[1]));
  const failed = failedCounts.reduce((total, value) => total + value, 0);
  const succeeded = successCounts.reduce((total, value) => total + value, 0);
  if (/invalid management key|unauthorized|forbidden|请求异常|注册失败|处理失败/i.test(text)) return 'error';
  if (failed > 0) return succeeded > 0 ? 'warning' : 'error';
  if (FAILURE_STATUSES.has(key)) return 'error';
  if (WARNING_STATUSES.has(key) || /等待|排队|重试|暂停|处理中|暂未确认|无法确认/.test(text)) return 'warning';
  if (SUCCESS_STATUSES.has(key) || /(?:完成|成功|通过)/.test(text) && failed === 0) return 'success';
  return 'info';
}

function registrationStepNumber(message?: string, status?: string): number {
  const text = `${message || ''} ${status || ''}`;
  for (let index = REGISTRATION_FLOW.length - 1; index >= 0; index -= 1) {
    if (REGISTRATION_FLOW[index].pattern.test(text)) return index + 1;
  }
  return 1;
}

function sessionTimestamp(session: GrokMonitor['sessions'][number]): number {
  const lastEvent = session.events?.reduce((latest, event) => Math.max(latest, Number(event.at || 0)), 0) || 0;
  return Math.max(lastEvent, Number(session.updated_at || 0), Number(session.created_at || 0));
}

function buildRegistrationFlow(session?: GrokMonitor['sessions'][number]): Array<{ label: string; state: FlowState }> {
  if (!session) return REGISTRATION_FLOW.map(({ label }) => ({ label, state: 'pending' }));
  const states: FlowState[] = REGISTRATION_FLOW.map(() => 'pending');
  let furthest = 0;
  for (const event of session.events || []) {
    const step = registrationStepNumber(event.message, event.status);
    const tone = logTone(event.status, translateLogMessage(event.message || event.status));
    for (let index = 0; index < step - 1; index += 1) if (states[index] !== 'failed') states[index] = 'done';
    states[step - 1] = tone === 'error' ? 'failed' : tone === 'success' ? 'done' : 'running';
    furthest = Math.max(furthest, step);
  }
  const status = String(session.status || '').toLowerCase();
  if (['done', 'success', 'completed', 'imported'].includes(status)) {
    const through = session.auto_import?.enabled ? 9 : Math.max(8, furthest);
    for (let index = 0; index < through; index += 1) if (states[index] !== 'failed') states[index] = 'done';
  }
  if (session.probe?.state === 'complete') states[8] = Number(session.probe.fail || 0) > 0 ? 'failed' : 'done';
  if (session.auto_import?.enabled) {
    if (session.auto_import.ok === true) states[9] = 'done';
    else if (Number(session.auto_import.failed || 0) > 0 || session.auto_import.error) states[9] = 'failed';
  }
  if (FAILURE_STATUSES.has(status) && !states.includes('failed')) states[Math.max(0, furthest - 1)] = 'failed';
  return REGISTRATION_FLOW.map(({ label }, index) => ({ label, state: states[index] }));
}

function hotmailStatusKey(item: HotmailAccount): string {
  if (item.reserved) return 'reserved';
  if (item.failed) return 'failed';
  if (item.mail_healthy === false) return 'unhealthy';
  if (item.used || Number(item.remaining_uses || 0) <= 0) return 'used';
  if (item.mail_healthy === true) return 'healthy';
  return 'unchecked';
}

interface StyledSelectOption {
  value: string;
  label: string;
  description?: string;
}

const AUTO_IMPORT_OPTIONS: StyledSelectOption[] = [
  { value: 'false', label: '关闭', description: '仅保存到 MercuryPro 本地' },
  { value: 'true', label: '开启', description: '注册成功后自动测活并导入' },
];

const IMPORT_TARGET_OPTIONS: StyledSelectOption[] = [
  { value: 'sub2api', label: 'Sub2API', description: '导入并绑定 Grok 分组' },
  { value: 'cpa', label: 'CPA', description: '导入 CPA 管理站点' },
];

const MAIL_PROVIDER_OPTIONS: StyledSelectOption[] = [
  { value: 'custom', label: '自定义邮箱 API', description: '对接 YYDS 或自建邮箱 API' },
  { value: 'hotmail_local', label: '微软邮箱账户池（本地助手）', description: '本地账户池，每个邮箱支持 3 个槽位' },
];

function StyledSelect({
  value,
  options,
  onChange,
  ariaLabel,
  isDark,
  fieldClass,
}: {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  isDark: boolean;
  fieldClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  const choose = (option: StyledSelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + direction + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const activeOption = options[activeIndex];
      if (activeOption) choose(activeOption);
    }
  };

  return <div ref={rootRef} className="relative w-full">
    <motion.button
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleKeyDown}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.975 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      className={`${fieldClass} flex items-center justify-between gap-3 text-left cursor-pointer ${open ? 'ring-2 ring-blue-500/35 border-blue-400' : ''}`}
    >
      <motion.span key={value} initial={{ opacity: 0, y: 5, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 460, damping: 22 }} className="min-w-0 truncate">{selected?.label || value}</motion.span>
      <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-blue-500' : ''}`} />
    </motion.button>
    <AnimatePresence>
    {open && <motion.div role="listbox" aria-label={ariaLabel} initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: 0.985, transition: { duration: 0.12, ease: 'easeOut' } }} transition={{ type: 'spring', stiffness: 420, damping: 27 }} className={`absolute z-50 left-0 right-0 top-full mt-2 overflow-hidden rounded-xl border p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.18)] origin-top ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
      {options.map((option, index) => {
        const selectedOption = option.value === value;
        const activeOption = index === activeIndex;
        return <motion.button
          key={option.value}
          type="button"
          role="option"
          aria-selected={selectedOption}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}
          whileHover={{ x: 4 }}
          whileTap={{ scale: 0.985 }}
          transition={{ type: 'spring', stiffness: 430, damping: 24 }}
          className={`relative overflow-hidden w-full min-h-10 px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-left text-xs transition-colors ${selectedOption ? 'text-white' : activeOption ? isDark ? 'bg-slate-800 text-slate-100' : 'bg-blue-50 text-blue-700' : isDark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'}`}
        >
          {selectedOption && <motion.span layoutId={`styled-select-highlight-${ariaLabel}`} className="absolute inset-0 rounded-lg bg-blue-600" transition={{ type: 'spring', stiffness: 420, damping: 28 }} />}
          <span className="relative z-10 min-w-0"><strong className="block font-semibold">{option.label}</strong>{option.description && <small className={`block mt-0.5 ${selectedOption ? 'text-blue-100' : 'text-slate-400'}`}>{option.description}</small>}</span>
          <span className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${selectedOption ? 'bg-white/20' : 'opacity-0'}`}><Check className="w-3.5 h-3.5" /></span>
        </motion.button>;
      })}
    </motion.div>}
    </AnimatePresence>
  </div>;
}

interface Props {
  currentPreset: StylePreset;
}

export const GrokRegistrationPanel: React.FC<Props> = ({ currentPreset }) => {
  const theme = currentPreset.themeClasses;
  const isDark = currentPreset.mode === 'dark';
  const [tab, setTab] = useState<ConfigTab>('registration');
  const [config, setConfig] = useState<GrokConfig>(DEFAULT_CONFIG);
  const [monitor, setMonitor] = useState<GrokMonitor>({ batches: [], sessions: [] });
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [performanceProfile, setPerformanceProfile] = useState<RegistrationPerformanceProfile | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState('');
  const [pendingStartConfig, setPendingStartConfig] = useState<GrokConfig | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [solverState, setSolverState] = useState('未检测');
  const [proxyResult, setProxyResult] = useState('');
  const [hotmailPool, setHotmailPool] = useState<HotmailPool | null>(null);
  const [hotmailImportText, setHotmailImportText] = useState('');
  const [hotmailStatus, setHotmailStatus] = useState('');
  const [hotmailKeyword, setHotmailKeyword] = useState('');
  const [groups, setGroups] = useState<Array<{ id: number; name: string; platform?: string }>>([]);
  const [rotation, setRotation] = useState<RotationList>(EMPTY_ROTATION);
  const [rotationStatus, setRotationStatus] = useState('');
  const [rotationKeyword, setRotationKeyword] = useState('');
  const [rotationQuery, setRotationQuery] = useState('');
  const [rotationPageSize, setRotationPageSize] = useState(20);
  const [rotationSelected, setRotationSelected] = useState<string[]>([]);
  const [rotationLoading, setRotationLoading] = useState(false);
  const rotationPageRef = useRef(1);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const fieldClass = `w-full px-3 py-2 text-xs rounded-lg border outline-none transition focus:ring-2 focus:ring-blue-500/40 ${
    isDark ? 'bg-white/[0.035] border-white/10 text-slate-100 placeholder-slate-500' : 'bg-black/[0.025] border-black/10 text-slate-800 placeholder-slate-400'
  }`;
  const cardClass = `rounded-xl border ${isDark ? 'bg-white/[0.025] border-white/10' : 'bg-white/40 border-black/10'}`;
  const activeBatches = useMemo(
    () => monitor.batches.filter((item) => !FINISHED.has(String(item.status || '').toLowerCase())),
    [monitor.batches],
  );
  const pausedBatches = activeBatches.filter((item) => ['paused', 'pausing'].includes(String(item.status || '').toLowerCase()));

  const setField = <K extends keyof GrokConfig>(key: K, value: GrokConfig[K]) => {
    setConfig((previous) => ({ ...previous, [key]: value }));
  };

  const showError = (error: unknown) => {
    setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
  };

  const refreshMonitor = async () => {
    try {
      setMonitor(await grokRegistrationApi.monitor());
      setServiceOnline(true);
    } catch {
      setServiceOnline(false);
    }
  };

  const refreshMonitorManually = async () => {
    setBusy('monitor-refresh');
    try {
      await refreshMonitor();
    } finally {
      setBusy('');
    }
  };

  const loadPerformance = async (provider: GrokConfig['captcha_provider'] = config.captcha_provider) => {
    setPerformanceLoading(true);
    setPerformanceError('');
    try {
      setPerformanceProfile(await grokRegistrationApi.performance(provider));
    } catch (error) {
      setPerformanceProfile(null);
      setPerformanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setPerformanceLoading(false);
    }
  };

  const resetMonitor = async () => {
    setBusy('reset-monitor');
    try {
      const result = await grokRegistrationApi.resetMonitor();
      if (result.ok === false) throw new Error(result.error || '本轮任务暂时无法清除');
      await refreshMonitor();
      setNotice({ tone: 'ok', text: '本轮注册流程与日志已清除。' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const loaded = await grokRegistrationApi.config();
      setConfig(mergeConfig(loaded));
      setServiceOnline(true);
      await refreshMonitor();
    } catch (error) {
      setServiceOnline(false);
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void refreshMonitor(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadPerformance(config.captcha_provider);
  }, [config.captcha_provider]);

  useEffect(() => {
    if (config.mail_provider !== 'hotmail_local') return;
    let active = true;
    const refresh = async (reportError = false) => {
      try {
        const pool = await grokRegistrationApi.hotmailAccounts();
        if (active) setHotmailPool(pool as HotmailPool);
      } catch (error) {
        if (active && reportError) showError(error);
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [config.mail_provider]);

  useEffect(() => {
    if (config.mail_provider !== 'hotmail_local' || !hotmailPool) return;
    const slots = Math.max(0, Number(hotmailPool.available || 0));
    setConfig((previous) => {
      const count = slots > 0 ? Math.min(Math.max(1, Number(previous.count) || 1), slots) : previous.count;
      return count === previous.count ? previous : { ...previous, count };
    });
  }, [config.mail_provider, hotmailPool?.available]);

  const normalizedConfig = (): GrokConfig => {
    const requestedCount = Math.max(1, Math.floor(Number(config.count) || 1));
    const availableSlots = Math.max(0, Number(hotmailPool?.available || 0));
    const count = config.mail_provider === 'hotmail_local' && availableSlots > 0 ? Math.min(requestedCount, availableSlots) : requestedCount;
    return {
      ...config,
      registration_target: 'grok',
      registration_mode: 'browser',
      count,
      concurrency: Math.max(1, Math.floor(Number(config.concurrency) || 1)),
      registration_json_format: config.auto_import_target,
    };
  };

  const save = async () => {
    setBusy('save');
    try {
      const result = await grokRegistrationApi.saveConfig(normalizedConfig());
      setConfig(mergeConfig(result.config));
      setNotice({ tone: 'ok', text: 'Grok 注册配置已保存到 MercuryPro。' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const runStart = async (settings: GrokConfig) => {
    setBusy('start');
    try {
      await grokRegistrationApi.start(settings);
      setNotice({ tone: 'ok', text: 'Grok 注册任务已启动，执行进度会在下方实时更新。' });
      await refreshMonitor();
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const togglePause = async () => {
    const resume = pausedBatches.length > 0;
    const targets = resume ? pausedBatches : activeBatches;
    if (!targets.length) return;
    setBusy('pause');
    try {
      await Promise.all(targets.map((item) => {
        const id = item.id || item.batch_id || '';
        return resume ? grokRegistrationApi.resumeBatch(id) : grokRegistrationApi.pauseBatch(id);
      }));
      setNotice({ tone: 'info', text: resume ? '已提交继续注册请求。' : '已提交暂停注册请求。' });
      await refreshMonitor();
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const detectSolver = async () => {
    setBusy('solver');
    try {
      const result = await grokRegistrationApi.detectSolver();
      const url = result.url || result.local_solver_url || result.detected_url;
      if (url) setField('local_solver_url', String(url));
      setSolverState(result.ok === false ? '不可用' : '在线');
      setNotice({ tone: result.ok === false ? 'error' : 'ok', text: result.message || (result.ok === false ? '未发现可用 Solver。' : 'Turnstile Solver 检测通过。') });
      await loadPerformance('local');
    } catch (error) {
      setSolverState('离线');
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const detectProxy = async () => {
    setBusy('proxy');
    try {
      const result = await grokRegistrationApi.detectProxy();
      const proxy = result.proxy || result.detected_proxy || result.url;
      if (proxy) setField('proxy', String(proxy));
      setProxyResult(result.message || (proxy ? `检测到本机代理：${proxy}` : '未检测到本机代理'));
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const checkProxy = async () => {
    setBusy('proxy-check');
    try {
      const result = await grokRegistrationApi.checkProxy(config.proxy);
      const items = Array.isArray(result.results) ? result.results : [];
      setProxyResult(result.message || (items.length ? `检测完成：${items.filter((item: any) => item.ok).length}/${items.length} 个代理可用` : JSON.stringify(result)));
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const importHotmail = async () => {
    if (!hotmailImportText.trim()) return setNotice({ tone: 'error', text: '请先粘贴微软邮箱账号。' });
    setBusy('hotmail-import');
    try {
      const result = await grokRegistrationApi.importHotmail(hotmailImportText, config.hotmail_local_base_url);
      setHotmailPool(result.pool || result);
      setHotmailImportText('');
      setNotice({ tone: 'ok', text: `邮箱导入完成：新增 ${result.added || 0}，更新 ${result.updated || 0}，无效 ${result.invalid || 0}。` });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const testHotmail = async () => {
    setBusy('hotmail-test');
    try {
      const result = await grokRegistrationApi.testHotmail(normalizedConfig());
      setNotice({ tone: result.ok === false ? 'error' : 'ok', text: result.ok === false ? (result.error || '邮箱助手检测失败。') : '本地微软邮箱助手在线。' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const probeHotmail = async () => {
    setBusy('hotmail-probe');
    try {
      const result = await grokRegistrationApi.probeHotmail(config.hotmail_local_base_url);
      setHotmailPool(result.pool || result);
      setNotice({ tone: result.ok === false ? 'error' : 'ok', text: result.ok === false ? (result.error || '邮箱账户测活失败。') : '邮箱账户池测活完成。' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const concurrencyWarningRemembered = () => {
    try {
      return window.localStorage.getItem(CONCURRENCY_WARNING_KEY) === '1';
    } catch {
      return false;
    }
  };

  const start = async () => {
    const settings = normalizedConfig();
    if (settings.concurrency > 3 && !concurrencyWarningRemembered()) {
      setPendingStartConfig(settings);
      return;
    }
    await runStart(settings);
  };

  const resolveConcurrencyWarning = (choice: 'cancel' | 'continue' | 'remember') => {
    const settings = pendingStartConfig;
    setPendingStartConfig(null);
    if (!settings || choice === 'cancel') return;
    if (choice === 'remember') {
      try {
        window.localStorage.setItem(CONCURRENCY_WARNING_KEY, '1');
      } catch {
        // Browser storage is optional; starting the task should still work.
      }
    }
    void runStart(settings);
  };

  const handleHotmailAction = async (account: HotmailAccount, action: 'restore' | 'prefer' | 'probe' | 'delete') => {
    const id = String(account.id || '');
    if (!id) return;
    setBusy(`hotmail-${action}-${id}`);
    try {
      const result = action === 'probe'
        ? await grokRegistrationApi.probeHotmailOne(id, config.hotmail_local_base_url)
        : action === 'delete'
          ? await grokRegistrationApi.deleteHotmail(id)
          : await grokRegistrationApi.updateHotmail(id, action === 'prefer' ? { preferred_for_next_use: true } : { used: false });
      setHotmailPool((result.pool || result) as HotmailPool);
      const message = action === 'delete'
        ? '邮箱已从账户池删除。'
        : action === 'probe'
          ? (result.ok === false ? `邮箱测活失败：${result.error || '未知原因'}` : '邮箱测活通过。')
          : action === 'prefer'
            ? '已指定该邮箱用于下一次注册。'
            : '邮箱已恢复为可复用状态。';
      setNotice({ tone: action === 'probe' && result.ok === false ? 'error' : 'ok', text: message });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const loadGroups = async () => {
    setBusy('groups');
    try {
      const result = await grokRegistrationApi.sub2apiGroups(normalizedConfig());
      setGroups(result.groups || []);
      setNotice({ tone: 'ok', text: `已读取 ${result.groups?.length || 0} 个 Sub2API 分组。` });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const loadRotation = async (page = rotation.page || 1, silent = false) => {
    if (!silent) setRotationLoading(true);
    try {
      const result = await grokRegistrationApi.rotation({
        status: rotationStatus,
        keyword: rotationQuery,
        page,
        pageSize: rotationPageSize,
      });
      rotationPageRef.current = result.page;
      setRotation(result);
      setRotationSelected((previous) => previous.filter((id) => result.items.some((item) => item.id === id)));
    } catch (error) {
      if (!silent) showError(error);
    } finally {
      if (!silent) setRotationLoading(false);
    }
  };

  const probeRotation = async (ids: string[], allAccounts = false) => {
    if (!allAccounts && !ids.length) return;
    setBusy('rotation-probe');
    try {
      const result = await grokRegistrationApi.probeRotation(ids, allAccounts);
      setNotice({ tone: 'info', text: result.already_running ? '已有账号轮询任务正在执行。' : `已开始探活 ${result.scheduled || 0} 个账号。` });
      await loadRotation(rotation.page);
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const deleteRotation = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy('rotation-delete');
    try {
      const result = await grokRegistrationApi.deleteRotation(ids);
      setRotationSelected([]);
      setNotice({ tone: 'ok', text: `已删除 ${result.deleted || 0} 个账号轮询记录。` });
      await loadRotation(rotation.page);
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (tab !== 'rotation') return;
    void loadRotation(1);
    const timer = window.setInterval(() => void loadRotation(rotationPageRef.current, true), 3000);
    return () => window.clearInterval(timer);
  }, [tab, rotationStatus, rotationQuery, rotationPageSize]);

  const tabs: Array<{ id: ConfigTab; label: string; icon: React.ReactNode }> = [
    { id: 'registration', label: '注册配置', icon: <Settings2 className="w-4 h-4" /> },
    { id: 'mail', label: '邮箱配置', icon: <Mail className="w-4 h-4" /> },
    { id: 'proxy', label: '代理配置', icon: <Globe2 className="w-4 h-4" /> },
    { id: 'import', label: '自动导入配置', icon: <UploadCloud className="w-4 h-4" /> },
    { id: 'rotation', label: '账号轮询', icon: <RefreshCw className="w-4 h-4" /> },
  ];

  const Field = ({ label, children, wide = false, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) => (
    <label className={`space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}>
      <span className={`block text-xs font-bold ${theme.textPrimary}`}>{label}</span>
      {children}
      {hint && <span className={`block text-[10px] leading-4 ${theme.textSecondary}`}>{hint}</span>}
    </label>
  );

  const Toggle = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) => (
    <label className={`flex items-center justify-between gap-4 p-3 rounded-lg border cursor-pointer ${isDark ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
      <span><strong className={`block text-xs ${theme.textPrimary}`}>{label}</strong>{hint && <small className={theme.textSecondary}>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="w-4 h-4 accent-blue-600" />
    </label>
  );

  const focusedSession = useMemo(() => [...monitor.sessions].sort((a, b) => {
    const aActive = !FINISHED.has(String(a.status || '').toLowerCase());
    const bActive = !FINISHED.has(String(b.status || '').toLowerCase());
    if (aActive !== bActive) return aActive ? -1 : 1;
    return sessionTimestamp(b) - sessionTimestamp(a);
  })[0], [monitor.sessions]);
  const flowSteps = useMemo(() => buildRegistrationFlow(focusedSession), [focusedSession]);
  const completedFlowSteps = flowSteps.filter((step) => step.state === 'done').length;
  const logs = useMemo<RegistrationLog[]>(() => {
    const entries: RegistrationLog[] = [];
    monitor.batches.forEach((batch) => {
      const message = translateLogMessage(batch.message || batch.status);
      const at = Number(batch.updated_at || batch.created_at || 0);
      entries.push({
        key: `batch-${batch.id || batch.batch_id}-${at}-${message}`,
        at,
        status: String(batch.status || ''),
        message,
        source: '批次',
        step: 1,
        tone: logTone(batch.status, message),
      });
    });
    monitor.sessions.forEach((session) => {
      (session.events || []).forEach((event, index) => {
        const message = translateLogMessage(event.message || event.status);
        const at = Number(event.at || session.updated_at || session.created_at || 0);
        entries.push({
          key: `${session.id || session.email}-${at}-${index}-${event.status}-${message}`,
          at,
          status: String(event.status || session.status || ''),
          message,
          source: `Grok${session.batch_index ? ` #${session.batch_index}` : ''}${session.email ? ` · ${session.email}` : ''}`,
          step: registrationStepNumber(event.message || message, event.status),
          tone: logTone(event.status || session.status, message),
        });
      });
    });
    return entries.sort((a, b) => a.at - b.at).slice(-300);
  }, [monitor]);
  const filteredHotmailAccounts = useMemo(() => (hotmailPool?.accounts || []).filter((account) => {
    const matchesStatus = !hotmailStatus || hotmailStatusKey(account) === hotmailStatus;
    const keyword = hotmailKeyword.trim().toLowerCase();
    return matchesStatus && (!keyword || String(account.email || '').toLowerCase().includes(keyword));
  }), [hotmailPool, hotmailStatus, hotmailKeyword]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [logs.length, logs[logs.length - 1]?.key]);
  const hotmailAvailableSlots = Math.max(0, Number(hotmailPool?.available || 0));
  const recommendedConcurrency = Number(performanceProfile?.recommended_concurrency || performanceProfile?.effective_cap || 0);
  const performancePhysicalCores = performanceProfile?.physical_cores ?? '--';
  const performanceMemory = performanceProfile?.memory_available_gb ?? '--';
  const performanceSolverThreads = performanceProfile?.solver_threads || performanceProfile?.local_slots || '--';
  const proxyCount = config.proxy.split(/\r?\n/).filter((item) => item.trim()).length;
  const registrationRounds = Math.ceil(Math.max(1, Number(config.count) || 1) / Math.max(1, Number(config.concurrency) || 1));
  const mailReady = config.mail_provider === 'hotmail_local'
    ? Boolean(config.hotmail_local_base_url.trim() && hotmailAvailableSlots > 0)
    : Boolean(config.mail_base_url.trim() && config.mail_api_key.trim());
  const captchaReady = config.captcha_provider === 'local' ? solverState === '在线' : Boolean(config.yescaptcha_key.trim());
  const importReady = !config.auto_import_enabled || (config.auto_import_target === 'cpa'
    ? Boolean(config.cpa_base_url.trim() && config.cpa_management_key.trim())
    : Boolean(config.sub2api_base_url.trim() && (config.sub2api_auth_mode === 'api_key'
      ? config.sub2api_api_key.trim()
      : config.sub2api_admin_email.trim() && config.sub2api_admin_password.trim())));
  const launchChecks = [
    { label: '内置注册引擎', detail: serviceOnline ? '服务在线，可以创建任务' : serviceOnline === false ? '服务尚未就绪' : '正在检测服务状态', ready: serviceOnline === true },
    { label: '验证码服务', detail: config.captcha_provider === 'local' ? `本地 Solver：${solverState}` : captchaReady ? 'YesCaptcha 密钥已填写' : '等待填写 YesCaptcha 密钥', ready: captchaReady },
    { label: '注册邮箱', detail: mailReady ? (config.mail_provider === 'hotmail_local' ? '微软邮箱账户池已配置' : '自定义邮箱 API 已配置') : '请先完成邮箱配置', ready: mailReady },
    { label: '注册后导入', detail: !config.auto_import_enabled ? '当前关闭，仅保存到本地' : importReady ? `将自动导入 ${config.auto_import_target.toUpperCase()}` : '自动导入参数尚未完整', ready: importReady },
  ];
  const confirmationContent = pendingConfirmation?.kind === 'reset-monitor'
    ? {
        title: '清除本轮注册记录？',
        description: '将清除当前批次的注册流程状态和全部日志。',
        detail: '如果任务仍在运行，请先暂停或等待任务结束；此操作不会删除已经注册或导入的账号。',
        confirmLabel: '确认清除',
      }
    : pendingConfirmation?.kind === 'delete-hotmail'
      ? {
          title: '删除邮箱账户？',
          description: `确定从微软邮箱账户池删除“${pendingConfirmation.account.email || '这个邮箱'}”吗？`,
          detail: '该邮箱的本地账户记录、使用槽位及测活状态会一并移除。',
          confirmLabel: '确认删除',
        }
      : pendingConfirmation?.kind === 'delete-rotation'
        ? {
            title: `删除 ${pendingConfirmation.ids.length} 个账号记录？`,
            description: '选中的账号将从 MercuryPro 本地轮询台账中移除。',
            detail: '只删除本地轮询记录，不会删除已经导入 CPA 或 Sub2API 站点的账号。',
            confirmLabel: '确认删除',
          }
        : null;

  const confirmPendingAction = () => {
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    if (!pending) return;
    if (pending.kind === 'reset-monitor') void resetMonitor();
    else if (pending.kind === 'delete-hotmail') void handleHotmailAction(pending.account, 'delete');
    else void deleteRotation(pending.ids);
  };

  return (
    <div className={`flex-1 overflow-y-auto p-3 ${theme.appBg}`}>
      <div className={`w-full min-h-full p-4 sm:p-5 space-y-4 rounded-2xl ${theme.cardBg} ${theme.shadow}`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-lg">G</div>
              <div>
                <h2 className={`text-lg font-extrabold ${theme.textPrimary}`}>Grok 注册中心</h2>
                <p className={`text-xs ${theme.textSecondary}`}>配置 xAI 浏览器注册、接码邮箱、代理池与注册后自动导入</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${serviceOnline ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' : serviceOnline === false ? 'bg-rose-500/10 border-rose-500/30 text-rose-600' : 'bg-slate-500/10 border-slate-500/30 text-slate-500'}`}>
              <CircleDot className="inline w-3 h-3 mr-1" />内置注册引擎 {serviceOnline ? '在线' : serviceOnline === false ? '未就绪' : '检测中'}
            </span>
            <button onClick={() => void load()} disabled={loading} className={`p-2 rounded-lg border ${theme.border} ${theme.textSecondary}`} title="重新读取配置"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </div>

        <div className={`${cardClass} p-1.5 flex gap-1 overflow-x-auto`}>
          {tabs.map((item) => (
            <button key={item.id} onClick={() => setTab(item.id)} className={`min-w-max flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition ${tab === item.id ? 'bg-blue-600 text-white shadow-sm' : `${theme.textSecondary} hover:bg-slate-500/10`}`}>
              {item.icon}{item.label}
            </button>
          ))}
        </div>

        {notice && (
          <div className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${notice.tone === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : notice.tone === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300' : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300'}`}>
            {notice.tone === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <CircleDot className="w-4 h-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className={`relative ${tab === 'rotation' ? '' : 'space-y-4 xl:space-y-0 xl:pr-[376px]'}`}>
        <section className={`${cardClass} min-w-0 overflow-hidden flex flex-col ${tab === 'rotation' ? '' : 'xl:min-h-[calc(100vh-260px)]'}`}>
          <div className={`px-4 py-3 border-b ${theme.border} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
            <div>
              <h3 className={`text-sm font-bold ${theme.textPrimary}`}>{tabs.find((item) => item.id === tab)?.label}</h3>
              <p className={`text-[11px] ${theme.textSecondary}`}>{tab === 'rotation' ? '持续维护已注册账号状态，每 30 分钟自动执行全量探活。' : '当前仅启用 Grok（xAI），OpenAI 注册保持关闭。'}</p>
            </div>
            <div className="flex items-center gap-2">
              {tab === 'rotation' ? <>
                <button onClick={() => void loadRotation(rotation.page)} disabled={rotationLoading} className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${theme.border} ${theme.textPrimary}`}><RefreshCw className={`w-3.5 h-3.5 ${rotationLoading ? 'animate-spin' : ''}`} />刷新</button>
                <button onClick={() => void probeRotation(rotationSelected)} disabled={!!busy || !rotationSelected.length} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'rotation-probe' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}激活所选</button>
                <button onClick={() => setPendingConfirmation({ kind: 'delete-rotation', ids: [...rotationSelected] })} disabled={!!busy || !rotationSelected.length} className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'rotation-delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}删除所选</button>
                <button onClick={() => void probeRotation([], true)} disabled={!!busy || !rotation.summary.total} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'rotation-probe' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}全部激活</button>
              </> : <>
                <button onClick={() => void save()} disabled={!!busy || !serviceOnline} className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${theme.border} ${theme.textPrimary} disabled:opacity-50`}>{busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}保存配置</button>
                <button onClick={() => void togglePause()} disabled={!!busy || !activeBatches.length} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'pause' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pausedBatches.length ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}{pausedBatches.length ? '继续注册' : '暂停注册'}</button>
                <button onClick={() => void start()} disabled={!!busy || !serviceOnline || !mailReady} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">{busy === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}开始注册</button>
              </>}
            </div>
          </div>

          <div className="p-4 sm:p-5 flex-1">
            {loading ? <div className={`py-16 flex items-center justify-center gap-2 text-xs ${theme.textSecondary}`}><Loader2 className="w-4 h-4 animate-spin" />正在读取内置 Grok 引擎配置…</div> : (
              <>
                {tab === 'registration' && <div className="h-full flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="注册目标"><input value="Grok (xAI)" disabled className={`${fieldClass} opacity-70`} /></Field>
                    <Field label="注册方式"><input value="浏览器注册" disabled className={`${fieldClass} opacity-70`} /></Field>
                    <Field label={config.mail_provider === 'hotmail_local' ? `注册数量（可用槽位 ${hotmailAvailableSlots}）` : '注册数量'}><input type="number" min={1} max={config.mail_provider === 'hotmail_local' ? Math.max(1, hotmailAvailableSlots) : 10000} value={config.count} onChange={(e) => setField('count', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label={`并发数（推荐最大为 ${recommendedConcurrency || '--'}）`}><input type="number" min={1} value={config.concurrency} onChange={(e) => setField('concurrency', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label="错峰毫秒"><input type="number" min={0} max={60000} value={config.stagger_ms} onChange={(e) => setField('stagger_ms', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label="Captcha 服务"><select value={config.captcha_provider} onChange={(e) => setField('captcha_provider', e.target.value as GrokConfig['captcha_provider'])} className={fieldClass}><option value="local">本地 Turnstile Solver</option><option value="yescaptcha">YesCaptcha</option></select></Field>
                    {config.captcha_provider === 'local' ? <Field label={`本地 Solver（${solverState}）`} wide><div className="flex gap-2"><input value={config.local_solver_url} onChange={(e) => setField('local_solver_url', e.target.value)} className={fieldClass} /><button onClick={() => void detectSolver()} disabled={!!busy} className="px-3 rounded-lg bg-slate-600 text-white text-xs font-bold min-w-max flex items-center gap-1.5 disabled:opacity-50">{busy === 'solver' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}重新检测</button></div></Field> : <Field label="YesCaptcha Key" wide><input type="password" value={config.yescaptcha_key} onChange={(e) => setField('yescaptcha_key', e.target.value)} className={fieldClass} /></Field>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Toggle label="自动调优错峰" checked={config.auto_tune_enabled} onChange={(value) => setField('auto_tune_enabled', value)} />
                    <Toggle label="导入前测活" checked={config.pre_import_probe_enabled} onChange={(value) => setField('pre_import_probe_enabled', value)} />
                    <Toggle label="显示注册浏览器" hint="仅建议调试时开启" checked={!config.grok_headless} onChange={(value) => setField('grok_headless', !value)} />
                  </div>

                  <div className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${theme.border} ${isDark ? 'bg-blue-500/[0.055]' : 'bg-blue-50/70'}`}>
                    <div className="flex items-start gap-2.5 min-w-0">
                      {performanceLoading ? <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-blue-500" /> : <Activity className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />}
                      <div className="min-w-0">
                        <strong className={`block text-[11px] ${theme.textPrimary}`}>服务器性能评估</strong>
                        <p className={`text-[10px] mt-1 leading-5 ${performanceError ? 'text-rose-600' : theme.textSecondary}`}>
                          {performanceError
                            ? `性能检测失败：${performanceError}`
                            : performanceProfile
                              ? <>检测：{performancePhysicalCores} 个物理核心 · 可用内存 {performanceMemory} GB · Solver {performanceSolverThreads} 线程 · 推荐最大并发为 <b className="text-blue-600">{recommendedConcurrency || '--'}</b>（仅供参考）</>
                              : '正在评估服务器 CPU、内存与 Solver 容量…'}
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={() => void loadPerformance()} disabled={performanceLoading} className={`px-3 py-2 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-50 ${theme.border} ${theme.textPrimary}`}><RefreshCw className={`w-3.5 h-3.5 ${performanceLoading ? 'animate-spin' : ''}`} />重新评估</button>
                  </div>

                  <div className="mt-auto pt-1 grid grid-cols-1 2xl:grid-cols-[1.15fr_1fr] gap-4">
                    <div className={`rounded-xl border p-4 ${theme.border} ${isDark ? 'bg-slate-900/45' : 'bg-slate-50/70'}`}>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div><h4 className={`text-xs font-bold ${theme.textPrimary}`}>本次注册任务概览</h4><p className={`text-[10px] mt-1 ${theme.textSecondary}`}>配置保存后，启动任务会按以下策略执行</p></div>
                        <Activity className="w-4 h-4 text-blue-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          { label: '计划账号', value: `${Math.max(1, Number(config.count) || 1)} 个`, icon: <Settings2 className="w-3.5 h-3.5" /> },
                          { label: '并发与轮次', value: `${Math.max(1, Number(config.concurrency) || 1)} 并发 · ${registrationRounds} 轮`, icon: <Activity className="w-3.5 h-3.5" /> },
                          { label: '网络出口', value: proxyCount ? `${proxyCount} 条代理 · ${config.proxy_strategy === 'round_robin' ? '轮询' : config.proxy_strategy === 'random' ? '随机' : '固定'}` : '本机网络直连', icon: <Globe2 className="w-3.5 h-3.5" /> },
                          { label: '完成后处理', value: config.auto_import_enabled ? `测活并导入 ${config.auto_import_target.toUpperCase()}` : '保存到本地账户池', icon: <UploadCloud className="w-3.5 h-3.5" /> },
                        ].map((item) => <div key={item.label} className={`rounded-lg border p-3 ${theme.border} ${isDark ? 'bg-slate-950/30' : 'bg-white'}`}>
                          <div className={`flex items-center gap-1.5 text-[10px] ${theme.textSecondary}`}>{item.icon}<span>{item.label}</span></div>
                          <strong className={`block mt-1.5 text-[11px] truncate ${theme.textPrimary}`} title={item.value}>{item.value}</strong>
                        </div>)}
                      </div>
                    </div>

                    <div className={`rounded-xl border p-4 ${theme.border} ${isDark ? 'bg-slate-900/45' : 'bg-slate-50/70'}`}>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div><h4 className={`text-xs font-bold ${theme.textPrimary}`}>启动前检查</h4><p className={`text-[10px] mt-1 ${theme.textSecondary}`}>开始注册前自动核对关键依赖</p></div>
                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-2">
                        {launchChecks.map((item) => <div key={item.label} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${theme.border} ${isDark ? 'bg-slate-950/30' : 'bg-white'}`}>
                          {item.ready ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" /> : <CircleDot className="w-4 h-4 shrink-0 text-amber-500" />}
                          <div className="min-w-0"><strong className={`block text-[10px] ${theme.textPrimary}`}>{item.label}</strong><p className={`text-[9px] mt-0.5 truncate ${theme.textSecondary}`} title={item.detail}>{item.detail}</p></div>
                        </div>)}
                      </div>
                    </div>
                  </div>
                </div>}

                {tab === 'mail' && <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>邮箱类型</span><StyledSelect ariaLabel="邮箱类型" value={config.mail_provider} onChange={(value) => setField('mail_provider', value as GrokConfig['mail_provider'])} options={MAIL_PROVIDER_OPTIONS} isDark={isDark} fieldClass={fieldClass} /></div>
                    {config.mail_provider === 'custom' ? <>
                      <Field label="邮箱域名"><input value={config.mail_domain} onChange={(e) => setField('mail_domain', e.target.value)} placeholder="多个域名用逗号分隔" className={fieldClass} /></Field>
                      <Field label="API 地址"><input value={config.mail_base_url} onChange={(e) => setField('mail_base_url', e.target.value)} placeholder="YYDS 或自建邮箱 API 地址" className={fieldClass} /></Field>
                      <Field label="API Key / 管理员密钥"><input type="password" value={config.mail_api_key} onChange={(e) => setField('mail_api_key', e.target.value)} className={fieldClass} /></Field>
                    </> : <>
                      <Field label="本地助手地址"><div className="flex gap-2"><input value={config.hotmail_local_base_url} onChange={(e) => setField('hotmail_local_base_url', e.target.value)} className={fieldClass} /><button onClick={() => void testHotmail()} disabled={!!busy} className="px-3 rounded-lg bg-slate-600 text-white text-xs font-bold min-w-max flex items-center gap-1.5 disabled:opacity-50">{busy === 'hotmail-test' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}检测助手</button></div></Field>
                      <Field label="批量导入微软邮箱账号" wide hint="每行：email----password----refresh-token----client-id"><textarea rows={5} value={hotmailImportText} onChange={(e) => setHotmailImportText(e.target.value)} className={fieldClass} /></Field>
                    </>}
                  </div>
                  {config.mail_provider === 'hotmail_local' && <div className={`rounded-xl border overflow-hidden ${theme.border} ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                    <div className={`p-4 border-b ${theme.border}`}>
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <strong className={`text-xs ${theme.textPrimary}`}>微软邮箱账户池</strong>
                          <p className={`text-[10px] mt-1 leading-5 ${theme.textSecondary}`}>
                            {hotmailPool ? `账户池：共 ${hotmailPool.total || 0} · 可用槽位 ${hotmailPool.available || 0}（每号 ${hotmailPool.alias_uses || 3} 次含 +别名） · 账号 ${hotmailPool.available_accounts || 0} · 测活通过 ${hotmailPool.healthy || 0} · 测活失败 ${hotmailPool.unhealthy || 0} · 未测活 ${hotmailPool.unchecked || 0} · 注册失败 ${hotmailPool.failed || 0} · 已用尽 ${hotmailPool.used || 0}` : '正在等待读取账户池'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0"><button onClick={() => void probeHotmail()} disabled={!!busy} className={`px-3 py-2 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 ${theme.border} ${theme.textPrimary}`}>{busy === 'hotmail-probe' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}全部重新测活</button><button onClick={() => void importHotmail()} disabled={!!busy} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50">{busy === 'hotmail-import' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}导入并自动测活</button></div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[150px_minmax(220px,1fr)] gap-2 mt-3">
                        <select value={hotmailStatus} onChange={(event) => setHotmailStatus(event.target.value)} className={fieldClass}><option value="">全部状态</option><option value="healthy">测活通过</option><option value="unchecked">未测活</option><option value="unhealthy">测活失败</option><option value="reserved">使用中</option><option value="failed">注册失败</option><option value="used">已用尽</option></select>
                        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><input value={hotmailKeyword} onChange={(event) => setHotmailKeyword(event.target.value)} placeholder="模糊搜索邮箱名称" className={`${fieldClass} pl-8`} /></div>
                      </div>
                    </div>

                    <div className="max-h-[360px] overflow-auto">
                      <table className="w-full min-w-[920px] text-left text-[10px]">
                        <thead className={`sticky top-0 z-10 ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500'}`}><tr><th className="px-4 py-2.5">邮箱账号</th><th className="px-3 py-2.5">状态</th><th className="px-3 py-2.5">验证码</th><th className="px-3 py-2.5">Client ID / Refresh Token</th><th className="px-3 py-2.5 text-center">操作</th></tr></thead>
                        <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                          {filteredHotmailAccounts.map((account) => {
                            const status = hotmailStatusKey(account);
                            const useLimit = Math.max(1, Number(account.use_limit || hotmailPool?.alias_uses || 3));
                            const useCount = Math.max(0, Number(account.use_count || 0));
                            const remaining = Math.max(0, Number(account.remaining_uses ?? (useLimit - useCount)));
                            const latestCode = account.verification_entries?.[0];
                            const statusLabel = account.reserved ? '使用中' : account.failed ? '注册失败' : account.mail_healthy === false ? '测活失败' : account.used || remaining <= 0 ? `已用尽 ${useCount}/${useLimit}` : account.preferred_for_next_use ? `已指定 · 余 ${remaining}/${useLimit}` : account.mail_healthy === true ? `测活通过 · 余 ${remaining}/${useLimit}` : `未测活 · 余 ${remaining}/${useLimit}`;
                            const statusStyle = status === 'healthy' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : status === 'unhealthy' || status === 'failed' ? 'border-rose-500/30 bg-rose-500/10 text-rose-600' : status === 'used' ? 'border-amber-500/30 bg-amber-500/10 text-amber-600' : status === 'reserved' ? 'border-blue-500/30 bg-blue-500/10 text-blue-600' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600';
                            const canUse = !account.failed && !account.used && !account.reserved && account.mail_healthy !== false && remaining > 0;
                            const operationBusy = busy.endsWith(`-${account.id}`);
                            return <tr key={account.id} className={isDark ? 'hover:bg-white/[0.025]' : 'hover:bg-black/[0.025]'}>
                              <td className="px-4 py-3 max-w-[260px]"><div className="flex items-center gap-2 min-w-0"><span className={`w-2 h-2 rounded-full shrink-0 ${account.mail_healthy === false ? 'bg-rose-500' : account.mail_healthy === true ? 'bg-emerald-400' : 'bg-amber-400'}`} /><strong className={`truncate text-[11px] ${theme.textPrimary}`} title={account.email}>{account.email || '未记录邮箱'}</strong></div><p className={`mt-1 ml-4 truncate ${account.failure_reason || account.mail_health_error ? 'text-rose-500' : theme.textSecondary}`} title={account.failure_reason || account.mail_health_error || account.next_alias_email}>{account.failure_reason ? `注册失败：${account.failure_reason}` : account.mail_health_error ? `测活失败：${account.mail_health_error}` : account.next_alias_email && remaining > 0 ? `下次注册：${account.next_alias_email}` : `已用 ${useCount}/${useLimit} 次（含 +别名）`}</p></td>
                              <td className="px-3 py-3"><span className={`inline-flex px-2 py-1 rounded-md border font-bold ${statusStyle}`}>{statusLabel}</span></td>
                              <td className="px-3 py-3"><strong className={latestCode?.status === 'received' ? 'text-emerald-500 text-xs' : latestCode?.status === 'waiting' ? 'text-amber-500' : latestCode ? 'text-rose-500' : theme.textSecondary}>{latestCode?.status === 'received' ? latestCode.code || '--' : latestCode?.status === 'waiting' ? '读取中…' : latestCode ? '读取失败' : '--'}</strong>{latestCode?.email && <p className={`mt-1 max-w-[150px] truncate ${theme.textSecondary}`} title={latestCode.email}>{latestCode.email}</p>}</td>
                              <td className="px-3 py-3 font-mono"><strong className={theme.textPrimary}>{account.client_id_masked || '--'}</strong><p className={`mt-1 max-w-[190px] truncate ${theme.textSecondary}`} title={account.refresh_token_masked}>Refresh Token {account.refresh_token_masked || '--'}</p></td>
                              <td className="px-3 py-3"><div className="flex justify-center gap-1.5">{(account.failed || account.mail_healthy !== false && (account.used || remaining <= 0)) && <button onClick={() => void handleHotmailAction(account, 'restore')} disabled={!!busy} className="px-2 py-1.5 rounded-md border border-emerald-500/30 text-emerald-600 font-bold disabled:opacity-40">恢复未用</button>}{canUse && <button onClick={() => void handleHotmailAction(account, 'prefer')} disabled={!!busy || account.preferred_for_next_use} className="px-2 py-1.5 rounded-md border border-cyan-500/30 text-cyan-600 font-bold disabled:opacity-40">{account.preferred_for_next_use ? '已指定' : '指定使用'}</button>}<button onClick={() => void handleHotmailAction(account, 'probe')} disabled={!!busy} className={`px-2 py-1.5 rounded-md border font-bold disabled:opacity-40 ${theme.border} ${theme.textPrimary}`}>{operationBusy && busy.startsWith('hotmail-probe-') ? <Loader2 className="w-3 h-3 animate-spin" /> : '重新测活'}</button><button onClick={() => setPendingConfirmation({ kind: 'delete-hotmail', account })} disabled={!!busy} className="px-2 py-1.5 rounded-md border border-rose-500/30 text-rose-600 font-bold disabled:opacity-40">删除</button></div></td>
                            </tr>;
                          })}
                          {!filteredHotmailAccounts.length && <tr><td colSpan={5} className={`p-10 text-center ${theme.textSecondary}`}>{hotmailPool?.accounts?.length ? '没有匹配的邮箱账号' : '尚未导入微软邮箱账号'}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className={`px-4 py-2 border-t text-[10px] ${theme.border} ${theme.textSecondary}`}>显示 {filteredHotmailAccounts.length} / {hotmailPool?.total || 0} 个物理邮箱；每个邮箱依次使用本体、+1、+2 三个注册地址。</div>
                  </div>}
                </div>}

                {tab === 'proxy' && <div className="space-y-4">
                  <Field label="代理池" wide hint="每行一个代理；支持 http/socks5 URL、host:port 及带用户名密码格式"><textarea rows={8} value={config.proxy} onChange={(e) => setField('proxy', e.target.value)} placeholder={'http://127.0.0.1:7890\nsocks5://user:password@host:port'} className={`${fieldClass} font-mono`} /></Field>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="轮换策略"><select value={config.proxy_strategy} onChange={(e) => setField('proxy_strategy', e.target.value as GrokConfig['proxy_strategy'])} className={fieldClass}><option value="round_robin">轮询</option><option value="random">随机</option><option value="sticky">固定</option></select></Field>
                    <div className="flex items-end gap-2"><button onClick={() => void detectProxy()} disabled={!!busy} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 ${theme.border} ${theme.textPrimary}`}>{busy === 'proxy' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}检测本机代理</button><button onClick={() => void checkProxy()} disabled={!!busy || !config.proxy.trim()} className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">{busy === 'proxy-check' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}检测代理可用性</button></div>
                  </div>
                  {proxyResult && <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-700 dark:text-blue-300 whitespace-pre-wrap">{proxyResult}</div>}
                </div>}

                {tab === 'import' && <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>自动导入</span><StyledSelect ariaLabel="自动导入" value={String(config.auto_import_enabled)} onChange={(value) => setField('auto_import_enabled', value === 'true')} options={AUTO_IMPORT_OPTIONS} isDark={isDark} fieldClass={fieldClass} /></div>
                    <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>导入对象</span><StyledSelect ariaLabel="导入对象" value={config.auto_import_target} onChange={(value) => setField('auto_import_target', value as GrokConfig['auto_import_target'])} options={IMPORT_TARGET_OPTIONS} isDark={isDark} fieldClass={fieldClass} /></div>
                    <Field label="导入并发数"><input type="number" min={1} max={10} value={config.import_concurrency} onChange={(e) => setField('import_concurrency', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label="导入错峰毫秒"><input type="number" min={0} max={60000} value={config.import_stagger_ms} onChange={(e) => setField('import_stagger_ms', Number(e.target.value))} className={fieldClass} /></Field>
                    {config.auto_import_target === 'sub2api' ? <>
                      <Field label="Sub2API 地址"><input value={config.sub2api_base_url} onChange={(e) => setField('sub2api_base_url', e.target.value)} placeholder="https://sub2.example.com" className={fieldClass} /></Field>
                      <Field label="认证方式"><select value={config.sub2api_auth_mode} onChange={(e) => setField('sub2api_auth_mode', e.target.value as GrokConfig['sub2api_auth_mode'])} className={fieldClass}><option value="password">管理员邮箱 + 密码</option><option value="api_key">管理员 API Key</option></select></Field>
                      {config.sub2api_auth_mode === 'password' ? <><Field label="管理员邮箱"><input type="email" value={config.sub2api_admin_email} onChange={(e) => setField('sub2api_admin_email', e.target.value)} className={fieldClass} /></Field><Field label="管理员密码"><input type="password" value={config.sub2api_admin_password} onChange={(e) => setField('sub2api_admin_password', e.target.value)} className={fieldClass} /></Field></> : <Field label="管理员 API Key" wide><input type="password" value={config.sub2api_api_key} onChange={(e) => setField('sub2api_api_key', e.target.value)} className={fieldClass} /></Field>}
                      <Field label="导入后绑定 Grok 分组" wide><div className="flex gap-2"><select value={config.sub2api_xai_group_id} onChange={(e) => { const id = Number(e.target.value); const group = groups.find((item) => item.id === id); setConfig((previous) => ({ ...previous, sub2api_xai_group_id: id, sub2api_xai_group_name: group ? `${group.platform ? `[${group.platform}] ` : ''}${group.name}` : '' })); }} className={fieldClass}><option value={0}>使用 Sub2API 默认分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.platform ? `[${group.platform}] ` : ''}{group.name}</option>)}</select><button onClick={() => void loadGroups()} disabled={!!busy} className="px-3 rounded-lg bg-slate-600 text-white text-xs font-bold min-w-max flex items-center gap-1.5 disabled:opacity-50">{busy === 'groups' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}自动获取分组</button></div></Field>
                    </> : <><Field label="CPA 地址"><input value={config.cpa_base_url} onChange={(e) => setField('cpa_base_url', e.target.value)} placeholder="https://cpa.example.com" className={fieldClass} /></Field><Field label="CPA 管理密钥"><input type="password" value={config.cpa_management_key} onChange={(e) => setField('cpa_management_key', e.target.value)} className={fieldClass} /></Field></>}
                  </div>
                  <div className={`p-3 rounded-lg border text-[11px] ${theme.border} ${theme.textSecondary}`}><ShieldCheck className="inline w-4 h-4 mr-1 text-blue-500" />开启后，注册完成的 Grok 凭据会在测活通过后自动导入所选站点；关闭时仅保存在 MercuryPro 本地。</div>
                </div>}

                {tab === 'rotation' && <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className={`p-4 rounded-xl border ${theme.border} ${isDark ? 'bg-slate-900/50' : 'bg-slate-50'}`}><span className={`text-[11px] ${theme.textSecondary}`}>账号总数</span><strong className={`block text-2xl mt-1 ${theme.textPrimary}`}>{rotation.summary.total}</strong></div>
                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10"><span className="text-[11px] text-emerald-600 dark:text-emerald-300">状态正常</span><strong className="block text-2xl mt-1 text-emerald-600 dark:text-emerald-300">{rotation.summary.normal}</strong></div>
                    <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10"><span className="text-[11px] text-rose-600 dark:text-rose-300">状态异常</span><strong className="block text-2xl mt-1 text-rose-600 dark:text-rose-300">{rotation.summary.error}</strong></div>
                  </div>

                  <div className={`p-3 rounded-xl border ${theme.border} flex flex-col lg:flex-row lg:items-end gap-3`}>
                    <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(220px,1fr)_120px] gap-3 flex-1">
                      <Field label="账号状态"><select value={rotationStatus} onChange={(event) => { setRotationStatus(event.target.value); setRotationSelected([]); }} className={fieldClass}><option value="">全部状态</option><option value="normal">正常</option><option value="error">错误</option></select></Field>
                      <Field label="搜索"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><input value={rotationKeyword} onChange={(event) => setRotationKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setRotationQuery(rotationKeyword.trim()); setRotationSelected([]); } }} placeholder="账号、类型或错误信息" className={`${fieldClass} pl-8`} /></div></Field>
                      <Field label="每页"><select value={rotationPageSize} onChange={(event) => { setRotationPageSize(Number(event.target.value)); setRotationSelected([]); }} className={fieldClass}><option value={20}>20 条</option><option value={50}>50 条</option><option value={80}>80 条</option></select></Field>
                    </div>
                    <button onClick={() => { setRotationQuery(rotationKeyword.trim()); setRotationSelected([]); if (rotationQuery === rotationKeyword.trim()) void loadRotation(1); }} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-1.5"><Search className="w-3.5 h-3.5" />搜索</button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                    <span className={theme.textSecondary}>已选 {rotationSelected.length} 项 · {rotation.poll.running ? '正在执行账号探活' : '轮询空闲'}</span>
                    <span className={theme.textSecondary}>{rotation.poll.next_auto_run_at ? `下次自动轮询：${rotationDate(rotation.poll.next_auto_run_at)}` : '每 30 分钟自动全量探活'} · {rotation.poll.last_auto_run_at ? `上次：${rotationDate(rotation.poll.last_auto_run_at)}` : '尚未自动轮询'}</span>
                  </div>

                  <div className={`overflow-x-auto rounded-xl border ${theme.border}`}>
                    <table className="w-full min-w-[1080px] text-left text-[11px]">
                      <thead className={isDark ? 'bg-slate-900 text-slate-400' : 'bg-slate-100 text-slate-500'}>
                        <tr>
                          <th className="p-3 w-10"><input type="checkbox" checked={rotation.items.length > 0 && rotation.items.every((item) => rotationSelected.includes(item.id))} ref={(input) => { if (input) input.indeterminate = rotation.items.some((item) => rotationSelected.includes(item.id)) && !rotation.items.every((item) => rotationSelected.includes(item.id)); }} onChange={(event) => setRotationSelected(event.target.checked ? rotation.items.map((item) => item.id) : [])} className="accent-blue-600" /></th>
                          <th className="p-3">账号信息</th><th className="p-3">账号状态</th><th className="p-3">类型</th><th className="p-3">注册时间</th><th className="p-3">已导入站点</th><th className="p-3">导入时间</th><th className="p-3">请求状态</th><th className="p-3">存活时间</th><th className="p-3">操作</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                        {rotation.items.map((item) => {
                          const selected = rotationSelected.includes(item.id);
                          const probing = ['queued', 'running'].includes(String(item.probe_state || '').toLowerCase());
                          return <tr key={item.id} className={selected ? 'bg-blue-500/5' : ''}>
                            <td className="p-3"><input type="checkbox" checked={selected} onChange={(event) => setRotationSelected((previous) => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter((id) => id !== item.id))} className="accent-blue-600" /></td>
                            <td className={`p-3 font-bold ${theme.textPrimary}`}>{item.email || '未记录邮箱'}</td>
                            <td className="p-3"><span className={`px-2 py-1 rounded-full font-bold ${item.status === 'error' ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{item.status === 'error' ? '错误' : '正常'}</span></td>
                            <td className={`p-3 ${theme.textSecondary}`}>{String(item.account_type || 'xai').toLowerCase() === 'xai' ? 'Grok / xAI' : item.account_type}</td>
                            <td className={`p-3 ${theme.textSecondary}`}>{rotationDate(item.registered_at)}</td>
                            <td className={`p-3 ${theme.textSecondary}`}>{item.imported_to_site ? `是${item.site_target ? ` · ${String(item.site_target).toUpperCase()}` : ''}` : '否'}</td>
                            <td className={`p-3 ${theme.textSecondary}`}>{rotationDate(item.imported_at)}</td>
                            <td className={`p-3 max-w-56 truncate ${probing ? 'text-blue-500' : theme.textSecondary}`} title={item.request_status || ''}>{probing ? '正在排队探活' : item.request_status || '等待首次探活'}</td>
                            <td className={`p-3 ${theme.textSecondary}`}>{rotationDuration(item.registered_at, item.last_probe_at)}</td>
                            <td className="p-3"><div className="flex gap-1.5"><button onClick={() => void probeRotation([item.id])} disabled={!!busy} className="px-2.5 py-1.5 rounded-md bg-blue-600 text-white font-bold disabled:opacity-40 flex items-center gap-1">{busy === 'rotation-probe' && <Loader2 className="w-3 h-3 animate-spin" />}激活</button><button onClick={() => setPendingConfirmation({ kind: 'delete-rotation', ids: [item.id] })} disabled={!!busy} className="px-2.5 py-1.5 rounded-md bg-rose-600 text-white font-bold disabled:opacity-40 flex items-center gap-1">{busy === 'rotation-delete' && <Loader2 className="w-3 h-3 animate-spin" />}删除</button></div></td>
                          </tr>;
                        })}
                        {!rotation.items.length && <tr><td colSpan={10} className={`p-12 text-center ${theme.textSecondary}`}>{rotationLoading ? '正在读取账号轮询台账…' : '没有匹配的账号记录'}</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className={theme.textSecondary}>共 {rotation.total} 条</span>
                    <div className="flex items-center gap-2"><button onClick={() => void loadRotation(Math.max(1, rotation.page - 1))} disabled={rotationLoading || rotation.page <= 1} className={`px-3 py-1.5 rounded-lg border font-bold disabled:opacity-40 ${theme.border} ${theme.textPrimary}`}>上一页</button><span className={theme.textSecondary}>{rotation.page} / {rotation.pages}</span><button onClick={() => void loadRotation(Math.min(rotation.pages, rotation.page + 1))} disabled={rotationLoading || rotation.page >= rotation.pages} className={`px-3 py-1.5 rounded-lg border font-bold disabled:opacity-40 ${theme.border} ${theme.textPrimary}`}>下一页</button></div>
                  </div>
                </div>}
              </>
            )}
          </div>
        </section>

        {tab !== 'rotation' && <aside className="min-w-0 space-y-4 xl:space-y-0 xl:absolute xl:inset-y-0 xl:right-0 xl:w-[360px] xl:grid xl:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] xl:gap-4">
          <section className={`${cardClass} min-h-0 overflow-hidden flex flex-col`}>
            <div className={`px-3 py-2.5 border-b ${theme.border}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center ${theme.border}`}><ListChecks className="w-4 h-4 text-blue-500" /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><h3 className={`text-sm font-bold ${theme.textPrimary}`}>注册监控</h3><span className="px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-[10px] font-mono text-cyan-600">{String(monitor.sessions.length).padStart(2, '0')}</span></div>
                    <p className={`text-[10px] mt-0.5 truncate ${theme.textSecondary}`}>批次 {monitor.batches.length} · 运行中 {activeBatches.length}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setPendingConfirmation({ kind: 'reset-monitor' })} disabled={!!busy || !monitor.sessions.length} className="px-2 py-1.5 rounded-md border border-rose-500/30 text-[10px] font-bold text-rose-600 disabled:opacity-40 flex items-center gap-1">{busy === 'reset-monitor' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}清除本轮</button>
                  <button onClick={() => void refreshMonitorManually()} disabled={!!busy} className="px-2 py-1.5 rounded-md border border-emerald-500/30 text-[10px] font-bold text-emerald-600 flex items-center gap-1 disabled:opacity-40"><RefreshCw className={`w-3 h-3 ${busy === 'monitor-refresh' ? 'animate-spin' : ''}`} />立即刷新</button>
                </div>
              </div>
            </div>
            <div className="p-3 flex-1 min-h-0 xl:overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="min-w-0"><strong className={`block text-xs ${theme.textPrimary}`}>流程</strong><p className={`text-[10px] mt-1 truncate ${theme.textSecondary}`}>{focusedSession?.email || '尚未创建账号任务'}</p></div>
                <span className={`shrink-0 px-2 py-1 rounded-full border text-[10px] font-bold ${theme.border} ${theme.textSecondary}`}>当前账号步骤 {completedFlowSteps} / {flowSteps.length}</span>
              </div>
              <div className={`rounded-lg border px-3 py-2.5 ${theme.border} ${isDark ? 'bg-slate-950/35' : 'bg-slate-50/70'}`}>
                {flowSteps.map((step, index) => <div key={step.label} className="relative flex gap-3 pb-2 last:pb-0">
                  {index < flowSteps.length - 1 && <span className={`absolute left-[9px] top-5 bottom-0 w-px ${step.state === 'done' ? 'bg-emerald-400' : isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />}
                  <span className={`relative z-10 mt-0.5 w-[19px] h-[19px] shrink-0 rounded-full border flex items-center justify-center ${step.state === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : step.state === 'running' ? 'bg-blue-500/10 border-blue-500 text-blue-600' : step.state === 'failed' ? 'bg-rose-500/10 border-rose-500 text-rose-600' : isDark ? 'bg-slate-900 border-slate-700 text-slate-600' : 'bg-white border-slate-300 text-slate-300'}`}>
                    {step.state === 'done' ? <CheckCircle2 className="w-3 h-3" /> : step.state === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : step.state === 'failed' ? <CircleDot className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5 flex items-center justify-between gap-2"><p className={`text-[11px] font-medium truncate ${step.state === 'pending' ? theme.textSecondary : theme.textPrimary}`}>{step.label}</p><span className={`shrink-0 text-[9px] ${step.state === 'done' ? 'text-emerald-600' : step.state === 'running' ? 'text-blue-500' : step.state === 'failed' ? 'text-rose-600' : theme.textSecondary}`}>{step.state === 'done' ? '已完成' : step.state === 'running' ? '执行中' : step.state === 'failed' ? '执行失败' : '等待中'}</span></div>
                </div>)}
              </div>
            </div>
          </section>

          <section className="min-h-0 overflow-hidden flex flex-col rounded-xl border border-slate-700/80 bg-[#0d1117] shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
            <div className="px-4 py-3 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center gap-1.5" aria-hidden="true"><i className="w-2 h-2 rounded-full bg-rose-500/90" /><i className="w-2 h-2 rounded-full bg-amber-400/90" /><i className="w-2 h-2 rounded-full bg-emerald-500/90" /></span>
                <FileText className="w-3.5 h-3.5 text-slate-400" /><h3 className="text-xs font-semibold font-mono tracking-wide text-slate-200">日志</h3>
              </div>
              <span className="px-2 py-0.5 rounded-md border border-slate-700 bg-slate-800/80 font-mono text-[10px] text-slate-400">{logs.length} 条</span>
            </div>
            <div ref={logContainerRef} className="p-3 flex-1 min-h-0 max-h-[420px] xl:max-h-none overflow-y-auto bg-[#0d1117] font-mono [scrollbar-color:#475569_#0d1117] [scrollbar-width:thin]">
              {logs.length ? <div className="space-y-1">{logs.map((log) => {
                const toneStyle = log.tone === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-400'
                  : log.tone === 'error'
                    ? 'border-rose-500/20 bg-rose-500/[0.08] text-rose-400'
                    : log.tone === 'warning'
                      ? 'border-amber-500/20 bg-amber-500/[0.07] text-amber-300'
                      : 'border-white/[0.06] bg-white/[0.025] text-slate-300';
                return <div key={log.key} title={log.source} className={`px-2.5 py-2 rounded-md border text-[10px] leading-4 ${toneStyle}`}><p className="break-words"><time className="opacity-50 mr-2">{log.at ? new Date(log.at * 1000).toLocaleTimeString('zh-CN', { hour12: false }) : '--'}</time><b>步骤 {log.step}：</b>{log.message}</p></div>;
              })}</div> : <div className="min-h-44 flex items-center justify-center text-center text-[11px] leading-5 text-slate-500"><span className="mr-2 text-emerald-500">$</span>注册日志将在这里自动滚动显示<span className="ml-1 inline-block w-1.5 h-3 bg-slate-500/70 animate-pulse" aria-hidden="true" /></div>}
            </div>
          </section>
        </aside>}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(pendingConfirmation && confirmationContent)}
        title={confirmationContent?.title || ''}
        description={confirmationContent?.description || ''}
        detail={confirmationContent?.detail}
        confirmLabel={confirmationContent?.confirmLabel}
        tone="danger"
        currentPreset={currentPreset}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={confirmPendingAction}
      />
      {pendingStartConfig && <div className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="concurrency-warning-title">
        <div className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${theme.border} ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0"><Activity className="w-5 h-5" /></div>
            <div className="min-w-0">
              <h3 id="concurrency-warning-title" className={`text-base font-bold ${theme.textPrimary}`}>确认高并发注册</h3>
              <p className={`text-xs mt-1.5 leading-5 ${theme.textSecondary}`}>当前设置为 <b className="text-amber-500">{pendingStartConfig.concurrency}</b> 并发，同时运行多个浏览器可能明显占用服务器资源。</p>
            </div>
          </div>
          <div className={`mt-4 rounded-xl border p-3 ${theme.border} ${isDark ? 'bg-slate-950/45' : 'bg-slate-50'}`}>
            <p className={`text-[11px] leading-5 ${theme.textSecondary}`}>{performancePhysicalCores} 个物理核心 · 可用内存 {performanceMemory} GB · Solver {performanceSolverThreads} 线程</p>
            <p className={`text-[11px] leading-5 mt-1 ${recommendedConcurrency && pendingStartConfig.concurrency > recommendedConcurrency ? 'text-amber-600' : theme.textPrimary}`}>
              {recommendedConcurrency
                ? `机器推荐最大并发为 ${recommendedConcurrency}；当前设置${pendingStartConfig.concurrency > recommendedConcurrency ? `高出推荐值 ${pendingStartConfig.concurrency - recommendedConcurrency}` : '未高于推荐值'}，你仍可自行决定。`
                : '暂未取得机器建议上限，请优先使用较低并发。'}
            </p>
          </div>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button type="button" onClick={() => resolveConcurrencyWarning('cancel')} className={`px-3 py-2.5 rounded-lg border text-xs font-bold ${theme.border} ${theme.textPrimary}`}>取消</button>
            <button type="button" onClick={() => resolveConcurrencyWarning('continue')} className="px-3 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold">仍然继续</button>
            <button type="button" onClick={() => resolveConcurrencyWarning('remember')} className="px-3 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">继续且不再提示</button>
          </div>
        </div>
      </div>}
    </div>
  );
};
