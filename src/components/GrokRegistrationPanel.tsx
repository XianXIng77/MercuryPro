import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Activity,
  CircleDot,
  Copy,
  FileText,
  Globe2,
  Eye,
  EyeOff,
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
  ChatGPTAccountRecord,
  BrowserDebugStatus,
  RegistrationPerformanceProfile,
  RotationList,
  grokRegistrationApi,
} from '../api/grokRegistration';
import { ConfirmDialog } from './ConfirmDialog';
import { StyledSelect, StyledSelectOption } from './StyledSelect';

type ConfigTab = 'registration' | 'browser' | 'mail' | 'proxy' | 'import' | 'rotation';

const NOVNC_DEBUG_URL = '/browser-debug/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=1000&resize=scale&path=api/browser-debug/vnc';

const DEFAULT_CONFIG: GrokConfig = {
  registration_target: 'grok',
  registration_mode: 'browser',
  count: 1,
  concurrency: 1,
  stagger_ms: 1200,
  auto_tune_enabled: false,
  pre_import_probe_enabled: true,
  grok_headless: true,
  chatgpt_headless: true,
  chatgpt_step_delay_ms: 3000,
  chatgpt_checkout_probe_enabled: false,
  chatgpt_checkout_proxy: '',
  captcha_provider: 'local',
  local_solver_url: 'http://127.0.0.1:5072',
  yescaptcha_key: '',
  mail_provider: 'hotmail_local',
  mail_base_url: '',
  mail_api_key: '',
  mail_domain: '',
  mail_prefix: '',
  mail_expiry_ms: 86400000,
  hotmail_local_base_url: 'http://127.0.0.1:17373',
  hotmail_account_source: 'mail_management',
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
const COMPLETED_BATCH = new Set(['done', 'success', 'completed', 'partial', 'error', 'failed']);
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
    registration_target: value.registration_target === 'chatgpt' ? 'chatgpt' : 'grok',
    registration_mode: 'browser',
    mail_provider: value.mail_provider === 'hotmail_local' ? 'hotmail_local' : 'custom',
    hotmail_account_source: value.hotmail_account_source === 'manual' ? 'manual' : 'mail_management',
  };
}

type FlowState = 'pending' | 'running' | 'paused' | 'done' | 'failed';
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
  failed_aliases?: number[];
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
  | { kind: 'delete-hotmail-selected'; ids: string[] }
  | { kind: 'delete-hotmail-used' }
  | { kind: 'delete-hotmail-unhealthy' }
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
  requiresVisibleBrowser?: boolean;
}

function requiresVisibleBrowserAction(rawMessage?: string, translatedMessage?: string): boolean {
  const text = `${rawMessage || ''} ${translatedMessage || ''}`;
  return /manual_click_required|waiting_for_manual_action|人机验证未自动通过|等待手工完成人机验证超时|等待 xAI OAuth 回调或授权码超时/i.test(text);
}

interface ProxyCheckItem {
  index?: number;
  ok?: boolean;
  ip?: string;
  country_code?: string;
  country?: string;
  region?: string;
  city?: string;
  latency_ms?: number;
  error?: string;
}

interface ProxyResultView {
  tone: 'success' | 'warning' | 'error' | 'info';
  summary: string;
  detail?: string;
  items: Array<{
    index: number;
    ok: boolean;
    countryCode?: string;
    country?: string;
    ip?: string;
    location?: string;
    latency?: string;
    error?: string;
  }>;
}

function proxyWithCredentials(proxy: string, username?: string, password?: string): string {
  if (!username) return proxy;
  try {
    const parsed = new URL(proxy);
    parsed.username = username;
    parsed.password = password || '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return proxy;
  }
}

function proxyCountryName(countryCode?: string, fallback?: string): string {
  const code = String(countryCode || '').trim().toUpperCase();
  if (!code) return String(fallback || '未知');
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || String(fallback || code);
  } catch {
    return String(fallback || code);
  }
}

function formatProxyCheckResult(result: Record<string, any>, title = '代理检测完成'): ProxyResultView {
  const items: ProxyCheckItem[] = Array.isArray(result.items)
    ? result.items
    : Array.isArray(result.results)
      ? result.results
      : [];
  const total = Number(result.total ?? items.length);
  const healthy = Number(result.healthy ?? items.filter((item) => item.ok).length);
  const failed = Number(result.failed ?? Math.max(0, total - healthy));
  if (!items.length) {
    return {
      tone: 'error',
      summary: `${title}：未取得出口信息`,
      detail: `原因：${result.error || result.message || '没有可检测的代理'}`,
      items: [],
    };
  }
  const formattedItems = items.map((item, itemIndex) => {
    const index = Number(item.index || itemIndex + 1);
    if (!item.ok) {
      return {
        index,
        ok: false,
        ip: '未获取',
        error: item.error || '连接失败',
      };
    }
    const countryCode = String(item.country_code || '').trim().toUpperCase() || '未知';
    const country = proxyCountryName(countryCode, item.country);
    const location = [item.region, item.city].filter(Boolean).join(' / ') || '未知';
    const latency = Number.isFinite(Number(item.latency_ms)) ? `${Number(item.latency_ms)} ms` : '未知';
    return {
      index,
      ok: true,
      countryCode,
      country,
      ip: item.ip || '未知',
      location,
      latency,
    };
  });
  return {
    tone: failed === 0 ? 'success' : healthy > 0 ? 'warning' : 'error',
    summary: `${title}：共 ${total} 条，可用 ${healthy} 条，不可用 ${failed} 条`,
    items: formattedItems,
  };
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
    regional_profile_detected: '已识别代理出口，Camoufox 使用原生地区指纹',
    regional_profile_applied: '已按代理出口匹配语言、地区与时区', regional_profile_fallback: '地区解析失败，已使用默认语言与时区',
    reused_browser: '正在复用当前并发窗口', private_context_created: '已创建全新隐私上下文', loading: '正在加载', ready: '页面已就绪',
    selecting_email: '正在选择邮箱注册', selected: '已选择邮箱注册', generated: '已随机生成', filling: '正在填写', filled: '填写完成',
    waiting_before_submit: '填写完成，等待提交', submitted: '已提交', detected: '已检测到验证组件', waiting: '正在等待',
    manual: '等待人工处理', manual_click_required: '需要人工点击验证', waiting_for_manual_action: '正在等待人工操作',
    waiting_for_widget_mount: '正在等待验证组件加载', waiting_for_auto_pass: '正在等待自动通过', waiting_for_response_token: '验证成功，正在等待令牌',
    clicked: '已点击验证组件', passed: '已通过', passed_after_widget_success: '已通过', not_required: '无需验证',
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

function translateStructuredChatgptMessage(text: string): string {
  const match = text.match(/^\[chatgpt\]\s+([^:]+):\s*([^ (]+)(.*)$/i);
  if (!match) return '';
  const names: Record<string, string> = {
    init: '初始化浏览器',
    navigate: '打开 ChatGPT 登录页',
    cookie_consent: '处理 Cookie 授权',
    signup_page: '选择注册入口',
    email: '填写注册邮箱',
    password: '填写注册密码',
    recovery: '恢复认证页面',
    verification: '处理邮箱验证码',
    profile: '填写账号资料',
    completion: '完成 OpenAI 注册',
    passkey: '处理通行密钥',
    session: '获取 Session / AT',
    plus_trial: '检测 Plus 试用资格',
    checkout_kind: '检测结账类型',
    flow: 'OpenAI 注册流程',
  };
  const states: Record<string, string> = {
    starting: '开始执行',
    launched_camoufox: '已启动 Camoufox 浏览器',
    launched_chromium: '已启动 Chromium 浏览器',
    reused_browser: '正在复用当前并发浏览器',
    private_context_created: '已创建全新隐私上下文',
    loading: '正在加载',
    checking: '正在检查',
    skipped: '未开启，已跳过',
    detected: '已检测到 Cookie 弹窗',
    clicking: '正在点击“全部接受”',
    accepted: '已点击“Accept all”',
    click_not_applied: '点击后弹窗仍存在，正在重试',
    unsupported: '已检测到弹窗，但未识别接受按钮',
    not_present: '未出现 Cookie 弹窗，无需处理',
    finding_signup: '正在查找注册入口',
    already_on_signup: '当前已在注册页面',
    filling: '正在填写',
    filled: '填写完成',
    submitted: '已提交',
    auth_retry: '正在重试认证页面',
    waiting_for_form: '正在等待验证码输入框',
    waiting_for_code: '正在等待邮箱验证码',
    code_received: '已收到验证码',
    code_filled: '验证码已填写',
    code_submitted: '验证码已提交',
    waiting_for_result: '正在等待验证结果',
    still_processing: '验证仍在处理中',
    resent: '已重新发送验证码',
    prefilling_combined: '正在预填账号资料',
    skipping: '正在跳过',
    waiting: '正在等待注册完成',
    done: '已完成',
    extracting: '正在提取 Access Token',
    extracted: 'Access Token 已提取',
    eligible: '有 Plus 试用资格',
    ineligible: '无 Plus 试用资格',
    unknown: '检测结果暂时无法确认',
    oaics: '结账类型为 oaics',
    cs_live: '结账类型为 cs_live',
    cs_test: '结账类型为 cs_test',
    failed: '获取失败',
    cancelled: '已取消',
    debug_hold: '短暂保留异常页面，便于查看',
    debug_released: '调试结束，正在关闭浏览器',
    error: '失败',
    exception: '发生异常',
  };
  let detail = match[3] || '';
  detail = detail
    .replace(/\buntil=task_stopped_window_closed_or_20_seconds\b/gi, '停止任务、关闭窗口或等待 20 秒后继续')
    .replace(/\buntil=20_seconds\b/gi, '保留 20 秒')
    .replace(/\bemail=/gi, '邮箱=')
    .replace(/\battempt=/gi, '尝试次数=')
    .replace(/\bbirthdate=/gi, '生日=')
    .replace(/\bmode=/gi, '输入模式=')
    .replace(/\btimeout_sec=/gi, '超时秒数=')
    .replace(/\bseconds=/gi, '秒数=')
    .replace(/\burl=/gi, '页面=')
    .replace(/\blanguage=/gi, '语言=')
    .replace(/\blabel=/gi, '按钮=')
    .replace(/\bamount=/gi, '今日应付=')
    .replace(/\breason=/gi, '说明=')
    .replace(/\berror=/gi, '原因=');
  return `${names[match[1]] || match[1]}：${states[match[2]] || match[2]}${detail}`;
}

function translateLogMessage(value?: string): string {
  const text = String(value || '').split(/\r?\nCall log:/i, 1)[0].trim();
  if (!text) return '任务状态更新';
  const xai = translateStructuredXaiMessage(text);
  if (xai) return xai;
  const chatgpt = translateStructuredChatgptMessage(text);
  if (chatgpt) return chatgpt;
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^finished (\d+)\/(\d+) \(ok=(\d+) fail=(\d+), threads=(\d+)\)$/i))) {
    return `批次完成 ${match[1]}/${match[2]}：成功 ${match[3]}，失败 ${match[4]}，并发 ${match[5]}`;
  }
  if ((match = text.match(/^running (\d+)\/(\d+) done \(ok=(\d+) fail=(\d+), threads=(\d+), inflight=(\d+)\)$/i))) {
    return `批次处理中：完成 ${match[1]}/${match[2]}，成功 ${match[3]}，失败 ${match[4]}，当前处理 ${match[6]}`;
  }
  const replacements: Array<[RegExp, string]> = [
    [/^batch started count=(\d+) concurrency=(\d+)$/i, '批量注册已启动：共 $1 个账号，并发 $2'],
    [/^starting ChatGPT registration; email=/i, '启动 OpenAI 浏览器注册；邮箱='],
    [/^launching browser for ChatGPT signup$/i, '正在启动浏览器并打开 ChatGPT 注册页面'],
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
  if (/已按代理出口匹配语言、地区与时区/.test(text)) return 'success';
  if (/地区解析失败，已使用默认语言与时区/.test(text)) return 'warning';
  if (/invalid management key|unauthorized|forbidden|请求异常|注册失败|处理失败/i.test(text)) return 'error';
  if (failed > 0) return succeeded > 0 ? 'warning' : 'error';
  if (FAILURE_STATUSES.has(key)) return 'error';
  if (WARNING_STATUSES.has(key) || /等待|排队|重试|暂停|处理中|暂未确认|无法确认/.test(text)) return 'warning';
  if (SUCCESS_STATUSES.has(key) || /(?:完成|成功|通过)/.test(text) && failed === 0) return 'success';
  return 'info';
}

function registrationStepNumber(message?: string, status?: string, target: 'grok' | 'chatgpt' = 'grok'): number {
  const text = `${message || ''} ${status || ''}`;
  const flow = target === 'chatgpt' ? CHATGPT_REGISTRATION_FLOW : REGISTRATION_FLOW;
  for (let index = flow.length - 1; index >= 0; index -= 1) {
    if (flow[index].pattern.test(text)) return index + 1;
  }
  return 1;
}

function sessionTimestamp(session: GrokMonitor['sessions'][number]): number {
  const lastEvent = session.events?.reduce((latest, event) => Math.max(latest, Number(event.at || 0)), 0) || 0;
  return Math.max(lastEvent, Number(session.updated_at || 0), Number(session.created_at || 0));
}

function buildRegistrationFlow(session?: GrokMonitor['sessions'][number], configuredTarget: 'grok' | 'chatgpt' = 'grok'): Array<{ label: string; state: FlowState }> {
  const target = session ? registrationTargetOf(session) : configuredTarget;
  const flow = target === 'chatgpt' ? CHATGPT_REGISTRATION_FLOW : REGISTRATION_FLOW;
  if (!session) return flow.map(({ label }) => ({ label, state: 'pending' }));
  const states: FlowState[] = flow.map(() => 'pending');
  let furthest = 0;
  for (const event of session.events || []) {
    const step = registrationStepNumber(event.message, event.status, target);
    const tone = logTone(event.status, translateLogMessage(event.message || event.status));
    for (let index = 0; index < step - 1; index += 1) if (states[index] !== 'failed') states[index] = 'done';
    states[step - 1] = tone === 'error' ? 'failed' : tone === 'success' ? 'done' : 'running';
    furthest = Math.max(furthest, step);
  }
  const status = String(session.status || '').toLowerCase();
  if (['done', 'success', 'completed', 'imported'].includes(status)) {
    const through = target === 'chatgpt'
      ? flow.length
      : session.auto_import?.enabled ? 9 : Math.max(8, furthest);
    for (let index = 0; index < through; index += 1) if (states[index] !== 'failed') states[index] = 'done';
  }
  if (status === 'paused') {
    for (let index = 0; index < states.length; index += 1) {
      if (states[index] === 'running') states[index] = 'paused';
    }
  }
  if (target === 'grok' && session.probe?.state === 'complete') states[8] = Number(session.probe.fail || 0) > 0 ? 'failed' : 'done';
  if (target === 'grok' && session.auto_import?.enabled) {
    if (session.auto_import.ok === true) states[9] = 'done';
    else if (Number(session.auto_import.failed || 0) > 0 || session.auto_import.error) states[9] = 'failed';
  }
  if (FAILURE_STATUSES.has(status) && !states.includes('failed')) states[Math.max(0, furthest - 1)] = 'failed';
  return flow.map(({ label }, index) => ({ label, state: states[index] }));
}

function hotmailStatusKey(item: HotmailAccount): string {
  if (item.reserved) return 'reserved';
  if (item.failed) return 'failed';
  if (item.mail_healthy === false) return 'unhealthy';
  if (item.used || Number(item.remaining_uses || 0) <= 0) return 'used';
  if (item.mail_healthy === true) return 'healthy';
  return 'unchecked';
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

const CHATGPT_REGISTRATION_FLOW: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'open', label: '打开 ChatGPT 注册页面', pattern: /launching browser|navigate|signup|打开.*注册页面/i },
  { key: 'email', label: '填写注册邮箱', pattern: /queued; email=|email: (?:filling|filled|submitted)|邮箱/i },
  { key: 'password', label: '填写注册密码', pattern: /password: (?:filling|filled|submitted)|密码/i },
  { key: 'verification', label: '获取邮箱验证码', pattern: /verification|code|otp|验证码/i },
  { key: 'profile', label: '完善账号资料', pattern: /profile|birth|name|账号资料/i },
  { key: 'session', label: '获取 ChatGPT Session / AT', pattern: /completion: done|session|access.?token|fetching_sso/i },
  { key: 'plus_trial', label: '检测 Plus 试用资格并保存结果', pattern: /plus_trial|plus 试用资格/i },
  { key: 'checkout_kind', label: '检测 cs_live / oaics（可选）', pattern: /checkout_kind|结账类型|cs_live|oaics|openai 注册完成|completed/i },
];

function registrationTargetOf(value?: { registration_target?: string; id?: string; batch_id?: string }): 'grok' | 'chatgpt' {
  if (value?.registration_target === 'chatgpt' || String(value?.id || value?.batch_id || '').startsWith('cgpt_') || String(value?.id || value?.batch_id || '').startsWith('batch_cgpt_')) return 'chatgpt';
  return 'grok';
}

const HOTMAIL_ACCOUNT_SOURCE_OPTIONS: StyledSelectOption[] = [
  { value: 'mail_management', label: '邮箱管理未用账号', description: '默认使用邮箱管理中 0/3、1/3、2/3 的账号' },
  { value: 'manual', label: '注册页批量导入', description: '使用在当前注册配置中批量导入的账号' },
];

const CAPTCHA_PROVIDER_OPTIONS: StyledSelectOption[] = [
  { value: 'local', label: '本地 Turnstile Solver', description: '使用部署在本机的验证码服务' },
  { value: 'yescaptcha', label: 'YesCaptcha', description: '使用 YesCaptcha API Key' },
];

const REGISTRATION_TARGET_OPTIONS: StyledSelectOption[] = [
  { value: 'grok', label: 'Grok（xAI）', description: '使用现有 xAI 注册流程' },
  { value: 'chatgpt', label: 'ChatGPT（OpenAI）', description: '使用隔离的 OpenAI 浏览器注册流程' },
];

const HOTMAIL_STATUS_OPTIONS: StyledSelectOption[] = [
  { value: '', label: '全部状态' },
  { value: 'healthy', label: '测活通过' },
  { value: 'unchecked', label: '未测活' },
  { value: 'unhealthy', label: '测活失败' },
  { value: 'reserved', label: '使用中' },
  { value: 'failed', label: '注册失败' },
  { value: 'used', label: '已用尽' },
];

const PROXY_STRATEGY_OPTIONS: StyledSelectOption[] = [
  { value: 'round_robin', label: '轮询' },
  { value: 'random', label: '随机' },
  { value: 'sticky', label: '固定' },
];

const SUB2API_AUTH_OPTIONS: StyledSelectOption[] = [
  { value: 'password', label: '管理员邮箱 + 密码' },
  { value: 'api_key', label: '管理员 API Key' },
];

const ROTATION_STATUS_OPTIONS: StyledSelectOption[] = [
  { value: '', label: '全部状态' },
  { value: 'normal', label: '正常' },
  { value: 'error', label: '错误' },
];

const ROTATION_PAGE_SIZE_OPTIONS: StyledSelectOption[] = [20, 50, 80].map((size) => ({
  value: String(size),
  label: `${size} 条`,
}));

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
  const [proxyResult, setProxyResult] = useState<ProxyResultView | null>(null);
  const [hotmailPool, setHotmailPool] = useState<HotmailPool | null>(null);
  const [hotmailImportText, setHotmailImportText] = useState('');
  const [hotmailStatus, setHotmailStatus] = useState('');
  const [hotmailKeyword, setHotmailKeyword] = useState('');
  const [hotmailSelected, setHotmailSelected] = useState<string[]>([]);
  const [restoreUsesDialog, setRestoreUsesDialog] = useState<{ account: HotmailAccount; count: number } | null>(null);
  const [groups, setGroups] = useState<Array<{ id: number; name: string; platform?: string }>>([]);
  const [rotation, setRotation] = useState<RotationList>(EMPTY_ROTATION);
  const [rotationStatus, setRotationStatus] = useState('');
  const [rotationKeyword, setRotationKeyword] = useState('');
  const [rotationQuery, setRotationQuery] = useState('');
  const [rotationPageSize, setRotationPageSize] = useState(20);
  const [rotationSelected, setRotationSelected] = useState<string[]>([]);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [chatgptAccounts, setChatgptAccounts] = useState<ChatGPTAccountRecord[]>([]);
  const [chatgptAccountSelected, setChatgptAccountSelected] = useState<string[]>([]);
  const [visibleChatgptPasswords, setVisibleChatgptPasswords] = useState<Set<string>>(() => new Set());
  const [chatgptAccountsLoading, setChatgptAccountsLoading] = useState(false);
  const [currentChatgptBatchId, setCurrentChatgptBatchId] = useState('');
  const [logClearBefore, setLogClearBefore] = useState(0);
  const [archivedLogs, setArchivedLogs] = useState<RegistrationLog[]>([]);
  const [debugBrowserKey, setDebugBrowserKey] = useState(0);
  const [browserDebugStatus, setBrowserDebugStatus] = useState<BrowserDebugStatus | null>(null);
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
  const runningBatches = activeBatches.filter((item) => !['paused', 'pausing'].includes(String(item.status || '').toLowerCase()));
  const visibleBrowserRequested = config.registration_target === 'chatgpt' ? !config.chatgpt_headless : !config.grok_headless;
  const debugBrowserVisible = visibleBrowserRequested && !!browserDebugStatus?.enabled && !!browserDebugStatus.viewer_available;
  const debugBrowserDisabledReason = !visibleBrowserRequested
    ? '请先在注册配置中开启“显示注册浏览器”'
    : !browserDebugStatus?.enabled
      ? '服务器尚未开启浏览器调试桌面'
      : !browserDebugStatus.viewer_available
        ? '服务器缺少 noVNC 页面资源'
        : '';
  const browserViewerUrl = browserDebugStatus?.viewer_url || NOVNC_DEBUG_URL;

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
    const logsToKeep = logs;
    try {
      const result = await grokRegistrationApi.resetMonitor();
      if (result.ok === false) throw new Error(result.error || '本轮任务暂时无法清除');
      setArchivedLogs(logsToKeep);
      setCurrentChatgptBatchId('');
      await refreshMonitor();
      setNotice({ tone: 'ok', text: '本轮注册监控已清除，任务日志已保留。' });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [loaded, debugStatus] = await Promise.all([
        grokRegistrationApi.config(),
        grokRegistrationApi.browserDebugStatus().catch(() => null),
      ]);
      setConfig(mergeConfig(loaded));
      setBrowserDebugStatus(debugStatus);
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
        const pool = await grokRegistrationApi.hotmailAccounts(config.hotmail_account_source, config.registration_target);
        if (active) setHotmailPool(pool as HotmailPool);
      } catch (error) {
        if (active && reportError) showError(error);
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [config.mail_provider, config.hotmail_account_source, config.registration_target]);

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
      registration_target: config.registration_target,
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
      setNotice({ tone: 'ok', text: `${config.registration_target === 'chatgpt' ? 'ChatGPT' : 'Grok'} 注册配置已保存到 MercuryPro。` });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const runStart = async (settings: GrokConfig) => {
    setBusy('start');
    if (settings.registration_target === 'chatgpt') setCurrentChatgptBatchId('');
    try {
      const result = await grokRegistrationApi.start(settings);
      if (settings.registration_target === 'chatgpt') {
        setCurrentChatgptBatchId(String(result.batch_id || result.id || ''));
      }
      setNotice({ tone: 'ok', text: `${settings.registration_target === 'chatgpt' ? 'ChatGPT' : 'Grok'} 注册任务已启动，执行进度会在下方实时更新。` });
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
      if (!proxy) {
        setProxyResult({ tone: 'error', summary: '未检测到本机代理', detail: `原因：${result.error || result.message || '系统代理、环境变量和常见代理端口均未发现可用地址'}`, items: [] });
        return;
      }
      const detectedProxy = proxyWithCredentials(
        String(proxy),
        String(result.proxy_username || ''),
        String(result.proxy_password || ''),
      );
      setField('proxy', detectedProxy);
      const checked = await grokRegistrationApi.checkProxy(detectedProxy);
      setProxyResult(formatProxyCheckResult(checked, `已检测到${result.source || '本机代理'}并查询出口`));
    } catch (error) {
      showError(error);
      setProxyResult({ tone: 'error', summary: '代理检测失败', detail: `原因：${error instanceof Error ? error.message : String(error)}`, items: [] });
    } finally {
      setBusy('');
    }
  };

  const checkProxy = async () => {
    setBusy('proxy-check');
    try {
      const result = await grokRegistrationApi.checkProxy(config.proxy);
      setProxyResult(formatProxyCheckResult(result));
    } catch (error) {
      showError(error);
      setProxyResult({ tone: 'error', summary: '代理检测失败', detail: `原因：${error instanceof Error ? error.message : String(error)}`, items: [] });
    } finally {
      setBusy('');
    }
  };

  const importHotmail = async () => {
    if (!hotmailImportText.trim()) return setNotice({ tone: 'error', text: '请先粘贴微软邮箱账号。' });
    setBusy('hotmail-import');
    try {
      const result = await grokRegistrationApi.importHotmail(hotmailImportText, config.hotmail_local_base_url);
      setHotmailPool(await grokRegistrationApi.hotmailAccounts(config.hotmail_account_source, config.registration_target) as HotmailPool);
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
      const result = await grokRegistrationApi.probeHotmail(config.hotmail_local_base_url, config.hotmail_account_source);
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
          : await grokRegistrationApi.updateHotmail(id, action === 'prefer'
            ? { preferred_for_next_use: true, registration_target: config.registration_target }
            : { used: false, registration_target: config.registration_target });
      setHotmailPool(await grokRegistrationApi.hotmailAccounts(config.hotmail_account_source, config.registration_target) as HotmailPool);
      if (action === 'delete') setHotmailSelected((previous) => previous.filter((item) => item !== id));
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

  const openVisibleRegistrationBrowser = async () => {
    if (activeBatches.length > 0) {
      setNotice({ tone: 'error', text: '当前仍有注册批次运行。请先停止或等待当前批次结束，再打开新的可视验证浏览器，避免重复启动浏览器。' });
      return;
    }
    setBusy('open-visible-browser');
    try {
      const nextConfig = {
        ...normalizedConfig(),
        ...(config.registration_target === 'chatgpt' ? { chatgpt_headless: false } : { grok_headless: false }),
        count: 1,
        concurrency: 1,
      };
      const result = await grokRegistrationApi.saveConfig(nextConfig);
      setConfig(mergeConfig(result.config));
      await grokRegistrationApi.start(nextConfig);
      await refreshMonitor();
      setNotice({
        tone: 'info',
        text: '已启动一个可视注册任务，Camoufox 将自动打开；检测到人机验证后请在浏览器窗口中手工完成。',
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const copyChatgptAccessToken = async (sessionId: string) => {
    if (!sessionId) return;
    setBusy(`copy-at-${sessionId}`);
    try {
      const result = await grokRegistrationApi.chatgptAccessToken(sessionId);
      const token = String(result.access_token || '').trim();
      if (!token) throw new Error('该账号尚未生成 Access Token');
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        const input = document.createElement('textarea');
        input.value = token;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setNotice({ tone: 'ok', text: `已复制 ${result.email || 'ChatGPT 账号'} 的 AT。` });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const loadChatgptAccounts = async (silent = false) => {
    if (!silent) setChatgptAccountsLoading(true);
    try {
      const result = await grokRegistrationApi.chatgptAccounts();
      const accounts = result.accounts || [];
      setChatgptAccounts(accounts);
      const ids = new Set(accounts.map((item) => item.id));
      setChatgptAccountSelected((previous) => previous.filter((id) => ids.has(id)));
      setVisibleChatgptPasswords((previous) => new Set([...previous].filter((id) => ids.has(id))));
    } catch (error) {
      if (!silent) showError(error);
    } finally {
      if (!silent) setChatgptAccountsLoading(false);
    }
  };

  const copyChatgptAccountTokens = async (ids: string[], allAccounts = false) => {
    if (!allAccounts && !ids.length) return;
    setBusy(allAccounts ? 'copy-all-at' : 'copy-selected-at');
    try {
      const result = await grokRegistrationApi.chatgptAccountTokens(ids, allAccounts);
      const text = (result.tokens || [])
        .map((item) => String(item.access_token || '').trim())
        .filter(Boolean)
        .join('\n');
      if (!text) throw new Error('所选账号尚未生成 Access Token');
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement('textarea');
        input.value = text;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setNotice({ tone: 'ok', text: `已复制 ${result.total || 0} 个 OpenAI 账号的 AT，每行一个。` });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const deleteHotmailAccounts = async (kind: 'selected' | 'used' | 'unhealthy', ids: string[] = []) => {
    if (kind === 'selected' && !ids.length) return;
    setBusy(`hotmail-delete-${kind}`);
    try {
      const result = kind === 'selected'
        ? await grokRegistrationApi.deleteHotmailSelected(ids)
        : kind === 'used'
          ? await grokRegistrationApi.deleteHotmailUsed(config.registration_target)
          : await grokRegistrationApi.deleteHotmailUnhealthy();
      const selectedPool = await grokRegistrationApi.hotmailAccounts(config.hotmail_account_source, config.registration_target) as HotmailPool;
      setHotmailPool(selectedPool);
      const remainingIds = new Set((selectedPool.accounts || []).map((item: HotmailAccount) => String(item.id || '')));
      setHotmailSelected((previous) => previous.filter((id) => remainingIds.has(id)));
      const skipped = Number(result.skipped_reserved || 0);
      setNotice({
        tone: 'ok',
        text: `已删除 ${Number(result.deleted || 0)} 个邮箱${skipped ? `，跳过 ${skipped} 个使用中的邮箱` : ''}。`,
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy('');
    }
  };

  const restoreHotmailUses = async () => {
    const pending = restoreUsesDialog;
    const id = String(pending?.account.id || '');
    if (!pending || !id) return;
    setBusy(`hotmail-restore-uses-${id}`);
    try {
      const result = await grokRegistrationApi.restoreHotmailUses(id, pending.count, config.registration_target);
      setHotmailPool(await grokRegistrationApi.hotmailAccounts(config.hotmail_account_source, config.registration_target) as HotmailPool);
      setRestoreUsesDialog(null);
      setNotice({ tone: 'ok', text: `已为该邮箱恢复 ${Number(result.restored || 0)} 次注册使用机会。` });
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
    if (tab !== 'rotation' || config.registration_target === 'chatgpt') return;
    void loadRotation(1);
    const timer = window.setInterval(() => void loadRotation(rotationPageRef.current, true), 3000);
    return () => window.clearInterval(timer);
  }, [tab, rotationStatus, rotationQuery, rotationPageSize, config.registration_target]);

  useEffect(() => {
    if (tab !== 'rotation' || config.registration_target !== 'chatgpt') return;
    void loadChatgptAccounts();
    const timer = window.setInterval(() => void loadChatgptAccounts(true), 3000);
    return () => window.clearInterval(timer);
  }, [tab, config.registration_target]);

  const tabs: Array<{ id: ConfigTab; label: string; icon: React.ReactNode; disabled?: boolean }> = [
    { id: 'registration', label: '注册配置', icon: <Settings2 className="w-4 h-4" /> },
    { id: 'browser', label: '显示浏览器', icon: <Globe2 className="w-4 h-4" />, disabled: !debugBrowserVisible },
    { id: 'mail', label: '邮箱配置', icon: <Mail className="w-4 h-4" /> },
    { id: 'proxy', label: '代理配置', icon: <Globe2 className="w-4 h-4" /> },
    { id: 'import', label: config.registration_target === 'chatgpt' ? '自动导入（暂不启用）' : '自动导入配置', icon: <UploadCloud className="w-4 h-4" /> },
    { id: 'rotation', label: config.registration_target === 'chatgpt' ? '账号管理' : '账号轮询', icon: <RefreshCw className="w-4 h-4" /> },
  ];

  const Field = useCallback(({ label, children, wide = false, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) => (
    <div className={`space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}>
      <span className={`block text-xs font-bold ${theme.textPrimary}`}>{label}</span>
      {children}
      {hint && <span className={`block text-[10px] leading-4 ${theme.textSecondary}`}>{hint}</span>}
    </div>
  ), [theme.textPrimary, theme.textSecondary]);

  const Toggle = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) => (
    <label className={`flex items-center justify-between gap-4 p-3 rounded-lg border cursor-pointer ${isDark ? 'bg-slate-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
      <span><strong className={`block text-xs ${theme.textPrimary}`}>{label}</strong>{hint && <small className={theme.textSecondary}>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="w-4 h-4 accent-blue-600" />
    </label>
  );

  const focusedSession = useMemo(() => monitor.sessions.filter((session) => registrationTargetOf(session) === config.registration_target).sort((a, b) => {
    const aActive = !FINISHED.has(String(a.status || '').toLowerCase());
    const bActive = !FINISHED.has(String(b.status || '').toLowerCase());
    if (aActive !== bActive) return aActive ? -1 : 1;
    return sessionTimestamp(b) - sessionTimestamp(a);
  })[0], [monitor.sessions, config.registration_target]);
  const flowSteps = useMemo(() => buildRegistrationFlow(focusedSession, config.registration_target), [focusedSession, config.registration_target]);
  const completedFlowSteps = flowSteps.filter((step) => step.state === 'done').length;
  const chatgptTokenSessions = useMemo(() => monitor.sessions
    .filter((session) => currentChatgptBatchId
      && registrationTargetOf(session) === 'chatgpt'
      && String(session.batch_id || '') === currentChatgptBatchId
      && session.access_token_available)
    .sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a)), [monitor.sessions, currentChatgptBatchId]);
  const logs = useMemo<RegistrationLog[]>(() => {
    const entries: RegistrationLog[] = [...archivedLogs];
    monitor.batches.forEach((batch) => {
      const batchId = String(batch.id || batch.batch_id || '');
      const status = String(batch.status || '').toLowerCase();
      const completed = COMPLETED_BATCH.has(status);
      const successCount = Number(batch.ok_count ?? batch.success ?? 0);
      const failureCount = Number(batch.fail_count ?? batch.failed ?? 0);
      const total = Number(batch.count ?? batch.finished ?? (successCount + failureCount));
      const message = completed
        ? `批次完成：共 ${total} 个，成功 ${successCount} 个，失败 ${failureCount} 个`
        : translateLogMessage(batch.message || batch.status);
      const batchAt = Number(batch.updated_at || batch.created_at || 0);
      const relatedSessionAt = completed
        ? monitor.sessions.reduce((latest, session) => {
            if (String(session.batch_id || '') !== batchId) return latest;
            const latestEventAt = (session.events || []).reduce(
              (eventLatest, event) => Math.max(eventLatest, Number(event.at || 0)),
              0,
            );
            return Math.max(latest, sessionTimestamp(session), latestEventAt);
          }, 0)
        : 0;
      // Keep the aggregate result after every event belonging to this batch.
      const at = completed ? Math.max(batchAt, relatedSessionAt) + 0.001 : batchAt;
      entries.push({
        key: `batch-${batchId}-${at}-${message}`,
        at,
        status,
        message,
        source: '批次',
        step: 1,
        tone: logTone(batch.status, message),
      });
    });
    monitor.sessions.forEach((session) => {
      const sessionTarget = registrationTargetOf(session);
      (session.events || []).forEach((event, index) => {
        const message = translateLogMessage(event.message || event.status);
        const at = Number(event.at || session.updated_at || session.created_at || 0);
        entries.push({
          key: `${session.id || session.email}-${at}-${index}-${event.status}-${message}`,
          at,
          status: String(event.status || session.status || ''),
          message,
          source: `${sessionTarget === 'chatgpt' ? 'ChatGPT' : 'Grok'}${session.batch_index ? ` #${session.batch_index}` : ''}${session.email ? ` · ${session.email}` : ''}`,
          step: registrationStepNumber(event.message || message, event.status, sessionTarget),
          tone: logTone(event.status || session.status, message),
          requiresVisibleBrowser: requiresVisibleBrowserAction(event.message, message),
        });
      });
    });
    return [...new Map(entries.map((entry) => [entry.key, entry])).values()]
      .filter((entry) => entry.at > logClearBefore)
      .sort((a, b) => a.at - b.at)
      .slice(-300);
  }, [monitor, archivedLogs, logClearBefore]);
  const filteredHotmailAccounts = useMemo(() => (hotmailPool?.accounts || []).filter((account) => {
    const matchesStatus = !hotmailStatus || hotmailStatusKey(account) === hotmailStatus;
    const keyword = hotmailKeyword.trim().toLowerCase();
    return matchesStatus && (!keyword || String(account.email || '').toLowerCase().includes(keyword));
  }), [hotmailPool, hotmailStatus, hotmailKeyword]);
  const filteredHotmailIds = filteredHotmailAccounts.map((account) => String(account.id || '')).filter(Boolean);
  const allFilteredHotmailSelected = filteredHotmailIds.length > 0 && filteredHotmailIds.every((id) => hotmailSelected.includes(id));
  const someFilteredHotmailSelected = filteredHotmailIds.some((id) => hotmailSelected.includes(id));

  useEffect(() => {
    const existingIds = new Set((hotmailPool?.accounts || []).map((account) => String(account.id || '')));
    setHotmailSelected((previous) => {
      const next = previous.filter((id) => existingIds.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [hotmailPool]);

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
  const checkoutProbeReady = config.registration_target !== 'chatgpt'
    || !config.chatgpt_checkout_probe_enabled
    || Boolean(config.chatgpt_checkout_proxy.trim());
  const captchaReady = config.registration_target === 'chatgpt' || (config.captcha_provider === 'local' ? solverState === '在线' : Boolean(config.yescaptcha_key.trim()));
  const importReady = !config.auto_import_enabled || (config.auto_import_target === 'cpa'
    ? Boolean(config.cpa_base_url.trim() && config.cpa_management_key.trim())
    : Boolean(config.sub2api_base_url.trim() && (config.sub2api_auth_mode === 'api_key'
      ? config.sub2api_api_key.trim()
      : config.sub2api_admin_email.trim() && config.sub2api_admin_password.trim())));
  const launchChecks = [
    { label: '内置注册引擎', detail: serviceOnline ? '服务在线，可以创建任务' : serviceOnline === false ? '服务尚未就绪' : '正在检测服务状态', ready: serviceOnline === true },
    config.registration_target === 'chatgpt'
      ? { label: 'OpenAI 浏览器环境', detail: '使用独立 Camoufox 指纹与全新隐私上下文', ready: serviceOnline === true }
      : { label: '验证码服务', detail: config.captcha_provider === 'local' ? `本地 Solver：${solverState}` : captchaReady ? 'YesCaptcha 密钥已填写' : '等待填写 YesCaptcha 密钥', ready: captchaReady },
    { label: '注册邮箱', detail: mailReady ? (config.mail_provider === 'hotmail_local' ? '微软邮箱账户池已配置' : '自定义邮箱 API 已配置') : '请先完成邮箱配置', ready: mailReady },
    ...(config.registration_target === 'chatgpt' ? [{
      label: 'Checkout 类型检测',
      detail: !config.chatgpt_checkout_probe_enabled ? '当前关闭，注册后跳过 oaics / cs_live 查询' : checkoutProbeReady ? '将通过专用德国代理查询（DE / EUR）' : '已开启，请填写一条专用德国代理',
      ready: checkoutProbeReady,
    }] : []),
    config.registration_target === 'chatgpt'
      ? { label: '注册结果', detail: '保存 Session / AT 后即完成，不执行 Agent Identity 或站点导入', ready: true }
      : { label: '注册后导入', detail: !config.auto_import_enabled ? '当前关闭，仅保存到本地' : importReady ? `将自动导入 ${config.auto_import_target.toUpperCase()}` : '自动导入参数尚未完整', ready: importReady },
  ];
  const confirmationContent = pendingConfirmation?.kind === 'reset-monitor'
    ? {
        title: '清除本轮注册记录？',
        description: '仅清除当前批次的注册监控和流程状态，任务日志会继续保留。',
        detail: '如果任务仍在运行，请先暂停或等待任务结束；此操作不会清理日志，也不会删除已经注册或导入的账号。',
        confirmLabel: '确认清除',
      }
    : pendingConfirmation?.kind === 'delete-hotmail'
      ? {
          title: '删除邮箱账户？',
          description: `确定从微软邮箱账户池删除“${pendingConfirmation.account.email || '这个邮箱'}”吗？`,
          detail: '该邮箱的本地账户记录、使用槽位及测活状态会一并移除。',
          confirmLabel: '确认删除',
        }
      : pendingConfirmation?.kind === 'delete-hotmail-selected'
        ? {
            title: `删除选中的 ${pendingConfirmation.ids.length} 个邮箱？`,
            description: '选中的邮箱将从微软邮箱账户池中移除。',
            detail: '正在被注册任务占用的邮箱会自动跳过；其余删除操作不可撤销。',
            confirmLabel: '删除所选',
          }
        : pendingConfirmation?.kind === 'delete-hotmail-used'
          ? {
              title: '删除全部用尽邮箱？',
              description: `当前账户池有 ${hotmailPool?.used || 0} 个邮箱已用尽全部注册次数。`,
              detail: '正在被注册任务占用的邮箱会自动跳过；其余删除操作不可撤销。',
              confirmLabel: '删除用尽邮箱',
            }
          : pendingConfirmation?.kind === 'delete-hotmail-unhealthy'
            ? {
                title: '删除全部激活失败邮箱？',
                description: `当前账户池有 ${hotmailPool?.unhealthy || 0} 个邮箱最近一次测活失败。`,
                detail: '建议确认 Refresh Token 确实失效后再删除；正在使用中的邮箱会自动跳过。',
                confirmLabel: '删除激活失败',
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
    else if (pending.kind === 'delete-hotmail-selected') void deleteHotmailAccounts('selected', pending.ids);
    else if (pending.kind === 'delete-hotmail-used') void deleteHotmailAccounts('used');
    else if (pending.kind === 'delete-hotmail-unhealthy') void deleteHotmailAccounts('unhealthy');
    else void deleteRotation(pending.ids);
  };

  return (
    <div className={`flex-1 overflow-y-auto p-3 ${theme.appBg}`}>
      <div className={`w-full min-h-full p-4 sm:p-5 space-y-4 rounded-2xl ${theme.cardBg} ${theme.shadow}`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-lg">{config.registration_target === 'chatgpt' ? 'O' : 'G'}</div>
              <div>
                <h2 className={`text-lg font-extrabold ${theme.textPrimary}`}>账号注册中心</h2>
                <p className={`text-xs ${theme.textSecondary}`}>隔离配置 Grok 与 ChatGPT 浏览器注册，共用邮箱管理、代理池与注册后处理</p>
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
            <button key={item.id} type="button" disabled={item.disabled} title={item.id === 'browser' && item.disabled ? debugBrowserDisabledReason : undefined} onClick={() => setTab(item.id)} className={`min-w-max flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition disabled:cursor-not-allowed ${tab === item.id ? 'bg-blue-600 text-white shadow-sm' : item.disabled ? `${theme.textSecondary} opacity-35` : `${theme.textSecondary} hover:bg-slate-500/10`}`}>
              {item.icon}{item.label}
            </button>
          ))}
        </div>

        {notice && (
          <div className={`rounded-lg border px-4 py-3 text-[13px] font-semibold leading-5 flex items-center gap-3 ${isDark ? 'border-slate-700 bg-slate-800/80 text-slate-100' : 'border-slate-300 bg-slate-100 text-slate-800'}`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${notice.tone === 'ok' ? 'bg-emerald-500' : notice.tone === 'error' ? 'bg-rose-500' : 'bg-blue-500'}`} />
            <span>{notice.text}</span>
          </div>
        )}

        <div className={`relative ${tab === 'rotation' || tab === 'browser' ? '' : 'space-y-4 xl:space-y-0 xl:pr-[376px]'}`}>
        <section className={`${cardClass} min-w-0 overflow-hidden flex flex-col ${tab === 'rotation' ? '' : 'xl:min-h-[calc(100vh-260px)]'}`}>
          <div className={`px-4 py-3 border-b ${theme.border} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
            <div>
              <h3 className={`text-sm font-bold ${theme.textPrimary}`}>{tabs.find((item) => item.id === tab)?.label}</h3>
              <p className={`text-[11px] ${theme.textSecondary}`}>{tab === 'rotation' ? (config.registration_target === 'chatgpt' ? '管理已注册 OpenAI 账号，并复制本地保存的 Access Token。' : '持续维护已注册账号状态，每 30 分钟自动执行全量探活。') : tab === 'browser' ? '通过 MercuryPro 主站实时查看 Linux 容器中的注册浏览器画面。' : `当前注册目标：${config.registration_target === 'chatgpt' ? 'ChatGPT（OpenAI）' : 'Grok（xAI）'}。`}</p>
            </div>
            <div className="flex items-center gap-2">
              {tab === 'browser' ? <>
                <button type="button" onClick={() => setDebugBrowserKey((value) => value + 1)} className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${theme.border} ${theme.textPrimary}`}><RefreshCw className="w-3.5 h-3.5" />重新连接</button>
                <button type="button" onClick={() => window.open(browserViewerUrl, '_blank', 'noopener,noreferrer')} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5"><Globe2 className="w-3.5 h-3.5" />新窗口打开</button>
              </> : tab === 'rotation' ? config.registration_target === 'chatgpt' ? <>
                <button onClick={() => void loadChatgptAccounts()} disabled={chatgptAccountsLoading} className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${theme.border} ${theme.textPrimary}`}><RefreshCw className={`w-3.5 h-3.5 ${chatgptAccountsLoading ? 'animate-spin' : ''}`} />刷新</button>
                <button onClick={() => void copyChatgptAccountTokens(chatgptAccountSelected)} disabled={!!busy || !chatgptAccountSelected.length} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'copy-selected-at' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}复制所选 AT</button>
                <button onClick={() => void copyChatgptAccountTokens([], true)} disabled={!!busy || !chatgptAccounts.length} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'copy-all-at' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}复制全部 AT</button>
              </> : <>
                <button onClick={() => void loadRotation(rotation.page)} disabled={rotationLoading} className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${theme.border} ${theme.textPrimary}`}><RefreshCw className={`w-3.5 h-3.5 ${rotationLoading ? 'animate-spin' : ''}`} />刷新</button>
                <button onClick={() => void probeRotation(rotationSelected)} disabled={!!busy || !rotationSelected.length} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'rotation-probe' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}激活所选</button>
                <button onClick={() => setPendingConfirmation({ kind: 'delete-rotation', ids: [...rotationSelected] })} disabled={!!busy || !rotationSelected.length} className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'rotation-delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}删除所选</button>
                <button onClick={() => void probeRotation([], true)} disabled={!!busy || !rotation.summary.total} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'rotation-probe' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}全部激活</button>
              </> : <>
                <button onClick={() => void save()} disabled={!!busy || !serviceOnline} className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${theme.border} ${theme.textPrimary} disabled:opacity-50`}>{busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}保存配置</button>
                <button onClick={() => void togglePause()} disabled={!!busy || !activeBatches.length} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">{busy === 'pause' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pausedBatches.length ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}{pausedBatches.length ? '继续注册' : '暂停注册'}</button>
                <button onClick={() => void start()} disabled={!!busy || !serviceOnline || !mailReady || !checkoutProbeReady} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">{busy === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}开始注册</button>
              </>}
            </div>
          </div>

          <div className="p-4 sm:p-5 flex-1">
            {loading ? <div className={`py-16 flex items-center justify-center gap-2 text-xs ${theme.textSecondary}`}><Loader2 className="w-4 h-4 animate-spin" />正在读取内置注册引擎配置…</div> : (
              <>
                {tab === 'registration' && <div className="h-full flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="注册目标"><StyledSelect ariaLabel="注册目标" value={config.registration_target} onChange={(value) => setField('registration_target', value as GrokConfig['registration_target'])} options={REGISTRATION_TARGET_OPTIONS} isDark={isDark} /></Field>
                    <Field label="注册方式"><input value="浏览器注册" disabled className={`${fieldClass} opacity-70`} /></Field>
                    <Field label={config.mail_provider === 'hotmail_local' ? `注册数量（可用槽位 ${hotmailAvailableSlots}）` : '注册数量'}><input type="number" min={1} max={config.mail_provider === 'hotmail_local' ? Math.max(1, hotmailAvailableSlots) : 10000} value={config.count} onChange={(e) => setField('count', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label={`并发数（推荐最大为 ${recommendedConcurrency || '--'}）`}><input type="number" min={1} value={config.concurrency} onChange={(e) => setField('concurrency', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label="错峰毫秒"><input type="number" min={0} max={60000} value={config.stagger_ms} onChange={(e) => setField('stagger_ms', Number(e.target.value))} className={fieldClass} /></Field>
                    {config.registration_target === 'chatgpt' && <Field label="页面操作间隔（毫秒）" hint="适当放慢填写和点击，减少页面状态未稳定导致的失败。"><input type="number" min={0} max={30000} value={config.chatgpt_step_delay_ms} onChange={(e) => setField('chatgpt_step_delay_ms', Number(e.target.value))} className={fieldClass} /></Field>}
                    {config.registration_target === 'grok' ? <>
                      <Field label="Captcha 服务"><StyledSelect ariaLabel="Captcha 服务" value={config.captcha_provider} onChange={(value) => setField('captcha_provider', value as GrokConfig['captcha_provider'])} options={CAPTCHA_PROVIDER_OPTIONS} isDark={isDark} /></Field>
                      {config.captcha_provider === 'local' ? <Field label={`本地 Solver（${solverState}）`} wide><div className="flex gap-2"><input value={config.local_solver_url} onChange={(e) => setField('local_solver_url', e.target.value)} className={fieldClass} /><button onClick={() => void detectSolver()} disabled={!!busy} className="px-3 rounded-lg bg-slate-600 text-white text-xs font-bold min-w-max flex items-center gap-1.5 disabled:opacity-50">{busy === 'solver' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}重新检测</button></div></Field> : <Field label="YesCaptcha Key" wide><input type="password" value={config.yescaptcha_key} onChange={(e) => setField('yescaptcha_key', e.target.value)} className={fieldClass} /></Field>}
                    </> : <Field label="OpenAI 注册策略" wide hint="该流程与 Grok 完全隔离，不使用 Grok 的 Turnstile Solver。"><input value="openai-free 风格：独立 Camoufox 指纹、全新隐私上下文、邮箱验证码、自动提取 AT" disabled className={`${fieldClass} opacity-75`} /></Field>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Toggle label="自动调优错峰" checked={config.auto_tune_enabled} onChange={(value) => setField('auto_tune_enabled', value)} />
                    <Toggle label="导入前测活" checked={config.pre_import_probe_enabled} onChange={(value) => setField('pre_import_probe_enabled', value)} />
                    <Toggle label="显示注册浏览器" checked={config.registration_target === 'chatgpt' ? !config.chatgpt_headless : !config.grok_headless} onChange={(value) => config.registration_target === 'chatgpt' ? setField('chatgpt_headless', !value) : setField('grok_headless', !value)} />
                  </div>

                  {config.registration_target === 'chatgpt' && <div className={`rounded-xl border p-4 space-y-3 ${theme.border} ${isDark ? 'bg-slate-900/45' : 'bg-slate-50/70'}`}>
                    <Toggle label="检测 Checkout 类型（oaics / cs_live）" hint="默认关闭；开启后才会发起查询。" checked={config.chatgpt_checkout_probe_enabled} onChange={(value) => setField('chatgpt_checkout_probe_enabled', value)} />
                    {config.chatgpt_checkout_probe_enabled && <Field label="专用德国代理" wide hint="仅用于 Checkout 类型查询，固定按 DE / EUR 请求；不会替换注册代理或 Plus 试用检测所用网络。">
                      <input type="password" value={config.chatgpt_checkout_proxy} onChange={(e) => setField('chatgpt_checkout_proxy', e.target.value)} placeholder="us.1024proxy.io:3000:用户名-region-DE-sid-随机ID-t-5:密码" className={`${fieldClass} font-mono`} />
                    </Field>}
                    {config.chatgpt_checkout_probe_enabled && !config.chatgpt_checkout_proxy.trim() && <p className="text-[10px] font-bold text-rose-600">开启后必须填写一条有效的德国代理，才能开始注册。</p>}
                  </div>}

                  {config.registration_target === 'chatgpt' && <div className={`rounded-xl border overflow-hidden ${theme.border} ${isDark ? 'bg-slate-900/45' : 'bg-slate-50/70'}`}>
                    <div className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${theme.border}`}>
                      <div><h4 className={`text-xs font-bold ${theme.textPrimary}`}>ChatGPT 注册结果</h4><p className={`text-[10px] mt-1 ${theme.textSecondary}`}>仅显示本次启动批次；AT 仅在点击复制时从后端安全读取。</p></div>
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-600">可复制 {chatgptTokenSessions.length}</span>
                    </div>
                    {chatgptTokenSessions.length ? <div className="divide-y divide-slate-500/10">
                      {chatgptTokenSessions.slice(0, 10).map((session) => {
                        const sessionId = String(session.id || '');
                        return <div key={sessionId} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0"><strong className={`block truncate text-[11px] ${theme.textPrimary}`}>{session.email || '未记录邮箱'}</strong><div className="mt-1 flex flex-wrap items-center gap-1.5"><span className={`text-[9px] ${theme.textSecondary}`}>AT 已生成并保存在本地</span><span title={session.plus_trial?.reason || '尚未检测'} className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${session.plus_trial?.status === 'eligible' ? 'bg-violet-500/15 text-violet-500' : session.plus_trial?.status === 'ineligible' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-1 ring-inset ring-rose-500/30' : 'bg-amber-500/15 text-amber-500'}`}>Plus：{session.plus_trial?.status === 'eligible' ? '有资格' : session.plus_trial?.status === 'ineligible' ? '无资格' : '未知'}</span><span title={session.checkout_probe?.reason || '尚未检测'} className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${session.checkout_probe?.kind === 'oaics' ? 'bg-cyan-500/15 text-cyan-500' : session.checkout_probe?.kind === 'cs_live' ? 'bg-emerald-500/15 text-emerald-500' : session.checkout_probe?.status === 'disabled' ? 'bg-slate-500/10 text-slate-500' : 'bg-amber-500/15 text-amber-500'}`}>Checkout：{session.checkout_probe?.kind === 'oaics' ? 'oaics' : session.checkout_probe?.kind === 'cs_live' ? 'cs_live' : session.checkout_probe?.status === 'disabled' ? '未开启' : '未知'}</span></div></div>
                          <button type="button" onClick={() => void copyChatgptAccessToken(sessionId)} disabled={!!busy || !sessionId} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 px-3 py-2 text-[10px] font-bold text-blue-600 hover:bg-blue-500/10 disabled:opacity-40">{busy === `copy-at-${sessionId}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}复制 AT</button>
                        </div>;
                      })}
                    </div> : <div className={`px-4 py-6 text-center text-[10px] ${theme.textSecondary}`}>{currentChatgptBatchId ? '本次注册成功并获取 Session 后，这里会出现检测结果和“复制 AT”。' : '启动新的 ChatGPT 注册任务后，这里只显示该批次的注册结果。'}</div>}
                  </div>}

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
                    <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>邮箱类型</span><StyledSelect ariaLabel="邮箱类型" value={config.mail_provider} onChange={(value) => setField('mail_provider', value as GrokConfig['mail_provider'])} options={MAIL_PROVIDER_OPTIONS} isDark={isDark} /></div>
                    {config.mail_provider === 'custom' ? <>
                      <Field label="邮箱域名"><input value={config.mail_domain} onChange={(e) => setField('mail_domain', e.target.value)} placeholder="多个域名用逗号分隔" className={fieldClass} /></Field>
                      <Field label="API 地址"><input value={config.mail_base_url} onChange={(e) => setField('mail_base_url', e.target.value)} placeholder="YYDS 或自建邮箱 API 地址" className={fieldClass} /></Field>
                      <Field label="API Key / 管理员密钥"><input type="password" value={config.mail_api_key} onChange={(e) => setField('mail_api_key', e.target.value)} className={fieldClass} /></Field>
                    </> : <>
                      <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>账号来源</span><StyledSelect ariaLabel="微软邮箱账号来源" value={config.hotmail_account_source} onChange={(value) => setField('hotmail_account_source', value as GrokConfig['hotmail_account_source'])} options={HOTMAIL_ACCOUNT_SOURCE_OPTIONS.map((option) => option.value === 'mail_management' ? { ...option, description: config.registration_target === 'chatgpt' ? '仅使用邮箱管理中 OpenAI 状态为 0/1 的账号' : '仅使用邮箱管理中 Grok 状态为 0/3、1/3、2/3 的账号' } : option)} isDark={isDark} /></div>
                      <Field label="本地助手地址"><div className="flex gap-2"><input value={config.hotmail_local_base_url} onChange={(e) => setField('hotmail_local_base_url', e.target.value)} className={fieldClass} /><button onClick={() => void testHotmail()} disabled={!!busy} className="px-3 rounded-lg bg-slate-600 text-white text-xs font-bold min-w-max flex items-center gap-1.5 disabled:opacity-50">{busy === 'hotmail-test' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}检测助手</button></div></Field>
                      {config.hotmail_account_source === 'manual' && <Field label="批量导入微软邮箱账号" wide hint="每行：email----password----refresh-token----client-id"><textarea rows={5} value={hotmailImportText} onChange={(e) => setHotmailImportText(e.target.value)} className={fieldClass} /></Field>}
                    </>}
                  </div>
                  {config.mail_provider === 'hotmail_local' && <div className={`rounded-xl border overflow-hidden ${theme.border} ${isDark ? 'bg-slate-900/40' : 'bg-slate-50'}`}>
                    <div className={`p-4 border-b ${theme.border}`}>
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <strong className={`text-xs ${theme.textPrimary}`}>微软邮箱账户池</strong>
                          <p className={`text-[10px] mt-1 leading-5 ${theme.textSecondary}`}>
                            {hotmailPool ? `当前查看：${config.registration_target === 'chatgpt' ? 'OpenAI（每邮箱仅 1 次）' : 'Grok（每邮箱 3 次，含 +别名）'} · 账户池共 ${hotmailPool.total || 0} · 可用 ${hotmailPool.available || 0} · 可用账号 ${hotmailPool.available_accounts || 0} · 测活通过 ${hotmailPool.healthy || 0} · 测活失败 ${hotmailPool.unhealthy || 0} · 未测活 ${hotmailPool.unchecked || 0} · 注册失败 ${hotmailPool.failed || 0} · 已用尽 ${hotmailPool.used || 0}` : '正在等待读取账户池'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                          {config.hotmail_account_source === 'manual' && <>
                          <button onClick={() => setPendingConfirmation({ kind: 'delete-hotmail-selected', ids: [...hotmailSelected] })} disabled={!!busy || !hotmailSelected.length} className="px-3 py-2 rounded-lg border border-rose-500/30 text-rose-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" />删除所选{hotmailSelected.length ? `（${hotmailSelected.length}）` : ''}</button>
                          <button onClick={() => setPendingConfirmation({ kind: 'delete-hotmail-used' })} disabled={!!busy || !Number(hotmailPool?.used || 0)} className="px-3 py-2 rounded-lg border border-amber-500/30 text-amber-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" />删除用尽</button>
                          <button onClick={() => setPendingConfirmation({ kind: 'delete-hotmail-unhealthy' })} disabled={!!busy || !Number(hotmailPool?.unhealthy || 0)} className="px-3 py-2 rounded-lg border border-rose-500/30 text-rose-600 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" />删除激活失败</button>
                          </>}
                          <button onClick={() => void probeHotmail()} disabled={!!busy} className={`px-3 py-2 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 ${theme.border} ${theme.textPrimary}`}>{busy === 'hotmail-probe' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}全部重新测活</button>
                          {config.hotmail_account_source === 'manual' && <button onClick={() => void importHotmail()} disabled={!!busy} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50">{busy === 'hotmail-import' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}导入并自动测活</button>}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[150px_minmax(220px,1fr)] gap-2 mt-3">
                        <StyledSelect ariaLabel="邮箱状态" value={hotmailStatus} onChange={setHotmailStatus} options={HOTMAIL_STATUS_OPTIONS} isDark={isDark} />
                        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><input value={hotmailKeyword} onChange={(event) => setHotmailKeyword(event.target.value)} placeholder="模糊搜索邮箱名称" className={`${fieldClass} pl-8`} /></div>
                      </div>
                    </div>

                    <div className="max-h-[360px] overflow-auto">
                      <table className="w-full min-w-[760px] text-left text-[10px]">
                        <thead className={`sticky top-0 z-10 ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-500'}`}><tr><th className="px-3 py-2.5 w-10 text-center"><input type="checkbox" aria-label="全选当前筛选结果" title="全选当前筛选结果" checked={allFilteredHotmailSelected} ref={(input) => { if (input) input.indeterminate = someFilteredHotmailSelected && !allFilteredHotmailSelected; }} onChange={(event) => setHotmailSelected((previous) => event.target.checked ? Array.from(new Set([...previous, ...filteredHotmailIds])) : previous.filter((id) => !filteredHotmailIds.includes(id)))} className="accent-blue-600" /></th><th className="px-4 py-2.5 text-center">邮箱账号</th><th className="px-3 py-2.5 text-center">状态</th><th className="px-3 py-2.5 text-center">验证码</th><th className="px-3 py-2.5 text-center">操作</th></tr></thead>
                        <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                          {filteredHotmailAccounts.map((account) => {
                            const status = hotmailStatusKey(account);
                            const useLimit = Math.max(1, Number(account.use_limit || hotmailPool?.alias_uses || 3));
                            const useCount = Math.max(0, Number(account.use_count || 0));
                            const remaining = Math.max(0, Number(account.remaining_uses ?? (useLimit - useCount)));
                            const restorableUses = Math.min(useLimit, useCount);
                            const accountId = String(account.id || '');
                            const selected = hotmailSelected.includes(accountId);
                            const latestCode = account.verification_entries?.[0];
                            const statusLabel = account.reserved ? '使用中' : account.failed ? '注册失败' : account.mail_healthy === false ? '测活失败' : account.used || remaining <= 0 ? `已用尽 ${useCount}/${useLimit}` : account.preferred_for_next_use ? `已指定 · 余 ${remaining}/${useLimit}` : account.mail_healthy === true ? `测活通过 · 余 ${remaining}/${useLimit}` : `未测活 · 余 ${remaining}/${useLimit}`;
                            const statusStyle = status === 'healthy' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : status === 'unhealthy' || status === 'failed' ? 'border-rose-500/30 bg-rose-500/10 text-rose-600' : status === 'used' ? 'border-amber-500/30 bg-amber-500/10 text-amber-600' : status === 'reserved' ? 'border-blue-500/30 bg-blue-500/10 text-blue-600' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600';
                            const canUse = !account.failed && !account.used && !account.reserved && account.mail_healthy !== false && remaining > 0;
                            const operationBusy = busy.endsWith(`-${accountId}`);
                            return <tr key={account.id} className={selected ? 'bg-blue-500/[0.07]' : isDark ? 'hover:bg-white/[0.025]' : 'hover:bg-black/[0.025]'}>
                              <td className="px-3 py-3 text-center"><input type="checkbox" aria-label={`选择 ${account.email || '邮箱'}`} checked={selected} onChange={(event) => setHotmailSelected((previous) => event.target.checked ? Array.from(new Set([...previous, accountId])) : previous.filter((id) => id !== accountId))} className="accent-blue-600" /></td>
                              <td className="px-4 py-3 max-w-[260px]"><div className="flex items-center gap-2 min-w-0"><span className={`w-2 h-2 rounded-full shrink-0 ${account.mail_healthy === false ? 'bg-rose-500' : account.mail_healthy === true ? 'bg-emerald-400' : 'bg-amber-400'}`} /><strong className={`truncate text-[11px] ${theme.textPrimary}`} title={account.email}>{account.email || '未记录邮箱'}</strong></div><p className={`mt-1 ml-4 truncate ${account.failure_reason || account.mail_health_error ? 'text-rose-500' : theme.textSecondary}`} title={account.failure_reason || account.mail_health_error || account.next_alias_email}>{account.failure_reason ? `注册失败：${account.failure_reason}` : account.mail_health_error ? `测活失败：${account.mail_health_error}` : account.next_alias_email && remaining > 0 ? `下次注册：${account.next_alias_email}` : `已用 ${useCount}/${useLimit} 次${config.registration_target === 'grok' ? '（含 +别名）' : ''}`}</p></td>
                              <td className="px-3 py-3 text-center"><span className={`inline-flex px-2 py-1 rounded-md border font-bold ${statusStyle}`}>{statusLabel}</span></td>
                              <td className="px-3 py-3 text-center"><strong className={latestCode?.status === 'received' ? 'text-emerald-500 text-xs' : latestCode?.status === 'waiting' ? 'text-amber-500' : latestCode ? 'text-rose-500' : theme.textSecondary}>{latestCode?.status === 'received' ? latestCode.code || '--' : latestCode?.status === 'waiting' ? '读取中…' : latestCode ? '读取失败' : '--'}</strong>{latestCode?.email && <p className={`mx-auto mt-1 max-w-[150px] truncate ${theme.textSecondary}`} title={latestCode.email}>{latestCode.email}</p>}</td>
                              <td className="px-3 py-3"><div className="flex justify-center gap-1.5">{account.failed && <button onClick={() => void handleHotmailAction(account, 'restore')} disabled={!!busy || account.reserved} className="px-2 py-1.5 rounded-md border border-emerald-500/30 text-emerald-600 font-bold disabled:opacity-40">允许复用</button>}{restorableUses > 0 && <button onClick={() => setRestoreUsesDialog({ account, count: 1 })} disabled={!!busy || account.reserved} className="px-2 py-1.5 rounded-md border border-amber-500/30 text-amber-600 font-bold disabled:opacity-40">恢复次数</button>}{canUse && <button onClick={() => void handleHotmailAction(account, 'prefer')} disabled={!!busy || account.preferred_for_next_use} className="px-2 py-1.5 rounded-md border border-cyan-500/30 text-cyan-600 font-bold disabled:opacity-40">{account.preferred_for_next_use ? '已指定' : '指定使用'}</button>}<button onClick={() => void handleHotmailAction(account, 'probe')} disabled={!!busy} className={`px-2 py-1.5 rounded-md border font-bold disabled:opacity-40 ${theme.border} ${theme.textPrimary}`}>{operationBusy && busy.startsWith('hotmail-probe-') ? <Loader2 className="w-3 h-3 animate-spin" /> : '重新测活'}</button>{config.hotmail_account_source === 'manual' && <button onClick={() => setPendingConfirmation({ kind: 'delete-hotmail', account })} disabled={!!busy} className="px-2 py-1.5 rounded-md border border-rose-500/30 text-rose-600 font-bold disabled:opacity-40">删除</button>}</div></td>
                            </tr>;
                          })}
                          {!filteredHotmailAccounts.length && <tr><td colSpan={5} className={`p-10 text-center ${theme.textSecondary}`}>{hotmailPool?.accounts?.length ? '没有匹配的邮箱账号' : '尚未导入微软邮箱账号'}</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className={`px-4 py-2 border-t text-[10px] ${theme.border} ${theme.textSecondary}`}>显示 {filteredHotmailAccounts.length} / {hotmailPool?.total || 0} 个物理邮箱 · 已选 {hotmailSelected.length} 个；{config.registration_target === 'chatgpt' ? '这里只显示 OpenAI 独立的 0/1 使用状态。' : '这里只显示 Grok 独立的 0/3 使用状态，并依次使用本体、+1、+2。'}</div>
                  </div>}
                </div>}

                {tab === 'proxy' && <div className="space-y-4">
                  <Field label="代理池" wide hint="每行一条；推荐格式：主机:端口:用户名:密码（不需要添加 http://），例如 us.1024proxy.io:3000:账号-region-US-sid-随机ID-t-5:密码"><textarea rows={8} value={config.proxy} onChange={(e) => setField('proxy', e.target.value)} placeholder={'us.1024proxy.io:3000:username-region-US-sid-AbCd1234-t-5:password\nus.1024proxy.io:3000:username-region-US-sid-EfGh5678-t-5:password'} className={`${fieldClass} font-mono`} /></Field>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="轮换策略"><StyledSelect ariaLabel="代理轮换策略" value={config.proxy_strategy} onChange={(value) => setField('proxy_strategy', value as GrokConfig['proxy_strategy'])} options={PROXY_STRATEGY_OPTIONS} isDark={isDark} /></Field>
                    <div className="flex items-end gap-2"><button onClick={() => void detectProxy()} disabled={!!busy} className={`flex-1 px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 ${theme.border} ${theme.textPrimary}`}>{busy === 'proxy' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}检测本机代理</button><button onClick={() => void checkProxy()} disabled={!!busy || !config.proxy.trim()} className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">{busy === 'proxy-check' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}检测代理可用性</button></div>
                  </div>
                  {proxyResult && <div className={`rounded-lg border shadow-sm ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-300 bg-white text-slate-800'}`}>
                    <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${proxyResult.tone === 'success' ? 'bg-emerald-500' : proxyResult.tone === 'warning' ? 'bg-amber-500' : proxyResult.tone === 'error' ? 'bg-rose-500' : 'bg-blue-500'}`} />
                      <strong className="leading-5">{proxyResult.summary}</strong>
                    </div>
                    {proxyResult.detail && <div className={`border-t px-3.5 py-2.5 text-xs ${isDark ? 'border-slate-700 text-rose-300' : 'border-slate-200 text-rose-700'}`}>{proxyResult.detail}</div>}
                    {proxyResult.items.length > 0 && <div className={`divide-y border-t ${isDark ? 'divide-slate-700 border-slate-700' : 'divide-slate-200 border-slate-200'}`}>
                      {proxyResult.items.map((item) => <div key={item.index} className="flex items-start gap-2.5 px-3.5 py-2.5 text-xs leading-6">
                        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <p>
                          <strong>代理 {item.index}：</strong>
                          <span className={item.ok ? 'font-bold text-emerald-600 dark:text-emerald-300' : 'font-bold text-rose-600 dark:text-rose-300'}>{item.ok ? '可用' : '不可用'}</span>
                          {item.ok ? <>
                            <span>｜国家/地区：</span><span className="font-semibold text-emerald-600 dark:text-emerald-300">{item.countryCode}（{item.country}）</span>
                            <span>｜出口 IP：</span><span className="font-semibold text-emerald-600 dark:text-emerald-300">{item.ip}</span>
                            <span>｜位置：</span><span className="font-semibold text-emerald-600 dark:text-emerald-300">{item.location}</span>
                            <span>｜延迟：</span><span className="font-semibold text-emerald-600 dark:text-emerald-300">{item.latency}</span>
                          </> : <>
                            <span>｜出口 IP：</span><span className="font-semibold text-rose-600 dark:text-rose-300">{item.ip}</span>
                            <span>｜原因：</span><span className="font-semibold text-rose-600 dark:text-rose-300">{item.error}</span>
                          </>}
                        </p>
                      </div>)}
                    </div>}
                  </div>}
                </div>}

                {tab === 'browser' && <div className="h-[calc(100vh-330px)] min-h-[560px] overflow-hidden rounded-xl border border-slate-700 bg-black shadow-inner">
                  <iframe key={debugBrowserKey} src={browserViewerUrl} title="注册浏览器实时画面" allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen className="block h-full w-full border-0 bg-black" />
                </div>}

                {tab === 'import' && (config.registration_target === 'chatgpt' ? <div className={`p-5 rounded-xl border ${theme.border} ${isDark ? 'bg-slate-900/50' : 'bg-slate-50'}`}>
                  <div className="flex items-start gap-3"><ShieldCheck className="w-5 h-5 mt-0.5 text-emerald-500 shrink-0" /><div><strong className={`text-sm ${theme.textPrimary}`}>OpenAI 自动导入暂不启用</strong><p className={`mt-1 text-xs leading-5 ${theme.textSecondary}`}>当前 OpenAI 注册在获取并保存 Session / Access Token 后直接完成，不执行 Codex Agent Identity，也不会导入 Sub2API 或 CPA。已保存的 AT 可在“账号管理”中复制。</p></div></div>
                </div> : <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>自动导入</span><StyledSelect ariaLabel="自动导入" value={String(config.auto_import_enabled)} onChange={(value) => setField('auto_import_enabled', value === 'true')} options={AUTO_IMPORT_OPTIONS} isDark={isDark} /></div>
                    <div className="space-y-1.5"><span className={`block text-xs font-bold ${theme.textPrimary}`}>导入对象</span><StyledSelect ariaLabel="导入对象" value={config.auto_import_target} onChange={(value) => setField('auto_import_target', value as GrokConfig['auto_import_target'])} options={IMPORT_TARGET_OPTIONS} isDark={isDark} /></div>
                    <Field label="导入并发数"><input type="number" min={1} max={10} value={config.import_concurrency} onChange={(e) => setField('import_concurrency', Number(e.target.value))} className={fieldClass} /></Field>
                    <Field label="导入错峰毫秒"><input type="number" min={0} max={60000} value={config.import_stagger_ms} onChange={(e) => setField('import_stagger_ms', Number(e.target.value))} className={fieldClass} /></Field>
                    {config.auto_import_target === 'sub2api' ? <>
                      <Field label="Sub2API 地址"><input value={config.sub2api_base_url} onChange={(e) => setField('sub2api_base_url', e.target.value)} placeholder="https://sub2.example.com" className={fieldClass} /></Field>
                      <Field label="认证方式"><StyledSelect ariaLabel="Sub2API 认证方式" value={config.sub2api_auth_mode} onChange={(value) => setField('sub2api_auth_mode', value as GrokConfig['sub2api_auth_mode'])} options={SUB2API_AUTH_OPTIONS} isDark={isDark} /></Field>
                      {config.sub2api_auth_mode === 'password' ? <><Field label="管理员邮箱"><input type="email" value={config.sub2api_admin_email} onChange={(e) => setField('sub2api_admin_email', e.target.value)} className={fieldClass} /></Field><Field label="管理员密码"><input type="password" value={config.sub2api_admin_password} onChange={(e) => setField('sub2api_admin_password', e.target.value)} className={fieldClass} /></Field></> : <Field label="管理员 API Key" wide><input type="password" value={config.sub2api_api_key} onChange={(e) => setField('sub2api_api_key', e.target.value)} className={fieldClass} /></Field>}
                      <Field label="导入后绑定 Grok 分组" wide><div className="flex gap-2"><StyledSelect ariaLabel="导入后绑定 Grok 分组" value={String(config.sub2api_xai_group_id)} onChange={(value) => { const id = Number(value); const group = groups.find((item) => item.id === id); setConfig((previous) => ({ ...previous, sub2api_xai_group_id: id, sub2api_xai_group_name: group ? `${group.platform ? `[${group.platform}] ` : ''}${group.name}` : '' })); }} options={[{ value: '0', label: '使用 Sub2API 默认分组' }, ...groups.map((group) => ({ value: String(group.id), label: `${group.platform ? `[${group.platform}] ` : ''}${group.name}` }))]} isDark={isDark} /><button onClick={() => void loadGroups()} disabled={!!busy} className="px-3 rounded-lg bg-slate-600 text-white text-xs font-bold min-w-max flex items-center gap-1.5 disabled:opacity-50">{busy === 'groups' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}自动获取分组</button></div></Field>
                    </> : <><Field label="CPA 地址"><input value={config.cpa_base_url} onChange={(e) => setField('cpa_base_url', e.target.value)} placeholder="https://cpa.example.com" className={fieldClass} /></Field><Field label="CPA 管理密钥"><input type="password" value={config.cpa_management_key} onChange={(e) => setField('cpa_management_key', e.target.value)} className={fieldClass} /></Field></>}
                  </div>
                  <div className={`p-3 rounded-lg border text-[11px] ${theme.border} ${theme.textSecondary}`}><ShieldCheck className="inline w-4 h-4 mr-1 text-blue-500" />开启后，注册完成的 Grok 凭据会在测活通过后自动导入所选站点；关闭时仅保存在 MercuryPro 本地。</div>
                </div>)}

                {tab === 'rotation' && (config.registration_target === 'chatgpt' ? <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div className={`p-4 rounded-xl border ${theme.border} ${isDark ? 'bg-slate-900/50' : 'bg-slate-50'}`}><span className={`text-[11px] ${theme.textSecondary}`}>OpenAI 账号总数</span><strong className={`block text-2xl mt-1 ${theme.textPrimary}`}>{chatgptAccounts.length}</strong></div>
                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10"><span className="text-[11px] text-emerald-600 dark:text-emerald-300">可复制 AT</span><strong className="block text-2xl mt-1 text-emerald-600 dark:text-emerald-300">{chatgptAccounts.filter((item) => item.access_token_available).length}</strong></div>
                    <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/10"><span className="text-[11px] text-blue-600 dark:text-blue-300">已选择</span><strong className="block text-2xl mt-1 text-blue-600 dark:text-blue-300">{chatgptAccountSelected.length}</strong></div>
                    <div className="p-4 rounded-xl border border-violet-500/20 bg-violet-500/10"><span className="text-[11px] text-violet-600 dark:text-violet-300">Plus 试用资格</span><strong className="block text-2xl mt-1 text-violet-600 dark:text-violet-300">{chatgptAccounts.filter((item) => item.plus_trial?.status === 'eligible').length}</strong></div>
                  </div>

                  <div className={`overflow-x-auto rounded-xl border ${theme.border}`}>
                    <table className="w-full min-w-[1020px] text-left text-[11px]">
                      <thead className={isDark ? 'bg-slate-900 text-slate-400' : 'bg-slate-100 text-slate-500'}>
                        <tr>
                          <th className="p-3 w-10"><input type="checkbox" aria-label="选择全部 OpenAI 账号" checked={chatgptAccounts.length > 0 && chatgptAccounts.every((item) => chatgptAccountSelected.includes(item.id))} ref={(input) => { if (input) input.indeterminate = chatgptAccounts.some((item) => chatgptAccountSelected.includes(item.id)) && !chatgptAccounts.every((item) => chatgptAccountSelected.includes(item.id)); }} onChange={(event) => setChatgptAccountSelected(event.target.checked ? chatgptAccounts.map((item) => item.id) : [])} className="accent-blue-600" /></th>
                          <th className="p-3 text-center">邮箱</th><th className="p-3 text-center">密码</th><th className="p-3 text-center">AT 状态</th><th className="p-3 text-center">Plus 试用</th><th className="p-3 text-center">Checkout 类型</th><th className="p-3 text-center">保存时间</th><th className="p-3 text-center">操作</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
                        {chatgptAccounts.map((item) => {
                          const selected = chatgptAccountSelected.includes(item.id);
                          const passwordVisible = visibleChatgptPasswords.has(item.id);
                          const registrationPassword = String(item.password || '');
                          return <tr key={item.id} className={selected ? 'bg-blue-500/5' : ''}>
                            <td className="p-3"><input type="checkbox" aria-label={`选择 ${item.email || 'OpenAI 账号'}`} checked={selected} onChange={(event) => setChatgptAccountSelected((previous) => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter((id) => id !== item.id))} className="accent-blue-600" /></td>
                            <td className={`p-3 text-center font-bold ${theme.textPrimary}`}>{item.email || '未记录邮箱'}</td>
                            <td className="p-3"><div className="flex items-center justify-center gap-1.5">{registrationPassword ? <><span className={`font-mono ${theme.textPrimary}`}>{passwordVisible ? registrationPassword : '••••••••••••'}</span><button type="button" aria-label={passwordVisible ? `隐藏 ${item.email} 的密码` : `显示 ${item.email} 的密码`} title={passwordVisible ? '隐藏密码' : '显示密码'} onClick={() => setVisibleChatgptPasswords((previous) => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className={`p-1 rounded transition hover:bg-blue-500/10 ${theme.textSecondary}`}>{passwordVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button></> : <span className={theme.textSecondary}>-</span>}</div></td>
                            <td className="p-3 text-center"><span className="inline-flex px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">已保存</span></td>
                            <td className="p-3 text-center">{item.plus_trial?.status === 'eligible' ? <span title={item.plus_trial.reason || ''} className="inline-flex px-2 py-1 rounded-full bg-violet-500/10 text-violet-600 font-bold">有资格</span> : item.plus_trial?.status === 'ineligible' ? <span title={item.plus_trial.reason || ''} className="inline-flex px-2 py-1 rounded-full border border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-400 font-extrabold shadow-sm">无资格</span> : <span title={item.plus_trial?.reason || '尚未检测'} className="inline-flex px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 font-bold">未知</span>}</td>
                            <td className="p-3 text-center">{item.checkout_probe?.kind === 'oaics' ? <span title={item.checkout_probe.reason || ''} className="inline-flex px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-600 font-bold">oaics</span> : item.checkout_probe?.kind === 'cs_live' ? <span title={item.checkout_probe.reason || ''} className="inline-flex px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">cs_live</span> : item.checkout_probe?.status === 'disabled' ? <span title={item.checkout_probe.reason || ''} className="inline-flex px-2 py-1 rounded-full bg-slate-500/10 text-slate-500 font-bold">未开启</span> : <span title={item.checkout_probe?.reason || '尚未检测'} className="inline-flex px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 font-bold">未知</span>}</td>
                            <td className={`p-3 text-center ${theme.textSecondary}`}>{rotationDate(item.created_at)}</td>
                            <td className="p-3 text-center"><button onClick={() => void copyChatgptAccountTokens([item.id])} disabled={!!busy} className="px-3 py-1.5 rounded-md bg-blue-600 text-white font-bold disabled:opacity-40 inline-flex items-center gap-1">{busy === 'copy-selected-at' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Copy className="w-3 h-3" />}复制 AT</button></td>
                          </tr>;
                        })}
                        {!chatgptAccounts.length && <tr><td colSpan={8} className={`p-12 text-center ${theme.textSecondary}`}>{chatgptAccountsLoading ? '正在读取本地 OpenAI 账号…' : '尚未保存包含 AT 的 OpenAI 账号'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <p className={`text-[11px] ${theme.textSecondary}`}>AT 来自注册成功后保存在本地的原始 ChatGPT Session；“复制所选”和“复制全部”均按每行一个 AT 写入剪贴板。</p>
                </div> : <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className={`p-4 rounded-xl border ${theme.border} ${isDark ? 'bg-slate-900/50' : 'bg-slate-50'}`}><span className={`text-[11px] ${theme.textSecondary}`}>账号总数</span><strong className={`block text-2xl mt-1 ${theme.textPrimary}`}>{rotation.summary.total}</strong></div>
                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10"><span className="text-[11px] text-emerald-600 dark:text-emerald-300">状态正常</span><strong className="block text-2xl mt-1 text-emerald-600 dark:text-emerald-300">{rotation.summary.normal}</strong></div>
                    <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10"><span className="text-[11px] text-rose-600 dark:text-rose-300">状态异常</span><strong className="block text-2xl mt-1 text-rose-600 dark:text-rose-300">{rotation.summary.error}</strong></div>
                  </div>

                  <div className={`p-3 rounded-xl border ${theme.border} flex flex-col lg:flex-row lg:items-end gap-3`}>
                    <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(220px,1fr)_120px] gap-3 flex-1">
                      <Field label="账号状态"><StyledSelect ariaLabel="账号状态" value={rotationStatus} onChange={(value) => { setRotationStatus(value); setRotationSelected([]); }} options={ROTATION_STATUS_OPTIONS} isDark={isDark} /></Field>
                      <Field label="搜索"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" /><input value={rotationKeyword} onChange={(event) => setRotationKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setRotationQuery(rotationKeyword.trim()); setRotationSelected([]); } }} placeholder="账号、类型或错误信息" className={`${fieldClass} pl-8`} /></div></Field>
                      <Field label="每页"><StyledSelect ariaLabel="每页显示数量" value={String(rotationPageSize)} onChange={(value) => { setRotationPageSize(Number(value)); setRotationSelected([]); }} options={ROTATION_PAGE_SIZE_OPTIONS} isDark={isDark} /></Field>
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
                </div>)}
              </>
            )}
          </div>
        </section>

        {tab !== 'rotation' && tab !== 'browser' && <aside className="min-w-0 flex flex-col gap-4 xl:absolute xl:inset-y-0 xl:right-0 xl:w-[360px] xl:grid xl:grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section className={`${cardClass} order-2 min-h-0 overflow-hidden flex flex-col`}>
            <div className={`px-3 py-2.5 border-b ${theme.border}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center ${theme.border}`}><ListChecks className="w-4 h-4 text-blue-500" /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><h3 className={`text-sm font-bold ${theme.textPrimary}`}>注册监控</h3><span className="px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-[10px] font-mono text-cyan-600">{String(monitor.sessions.length).padStart(2, '0')}</span></div>
                    <p className={`text-[10px] mt-0.5 truncate ${theme.textSecondary}`}>批次 {monitor.batches.length} · 运行中 {runningBatches.length}{pausedBatches.length ? ` · 已暂停 ${pausedBatches.length}` : ''}</p>
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
                <div className="min-w-0"><strong className={`block text-xs ${theme.textPrimary}`}>流程</strong><div className="mt-1 flex flex-wrap items-center gap-2 min-w-0"><p className={`text-[10px] truncate ${theme.textSecondary}`}>{focusedSession?.email || '尚未创建账号任务'}</p>{config.registration_target === 'chatgpt' && focusedSession?.plus_trial && <span title={focusedSession.plus_trial.reason || ''} className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${focusedSession.plus_trial.status === 'eligible' ? 'bg-violet-500/15 text-violet-500' : focusedSession.plus_trial.status === 'ineligible' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-1 ring-inset ring-rose-500/30' : 'bg-amber-500/15 text-amber-500'}`}>Plus 试用：{focusedSession.plus_trial.status === 'eligible' ? '有资格' : focusedSession.plus_trial.status === 'ineligible' ? '无资格' : '未知'}</span>}{config.registration_target === 'chatgpt' && focusedSession?.checkout_probe && <span title={focusedSession.checkout_probe.reason || ''} className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${focusedSession.checkout_probe.kind === 'oaics' ? 'bg-cyan-500/15 text-cyan-500' : focusedSession.checkout_probe.kind === 'cs_live' ? 'bg-emerald-500/15 text-emerald-500' : focusedSession.checkout_probe.status === 'disabled' ? 'bg-slate-500/10 text-slate-500' : 'bg-amber-500/15 text-amber-500'}`}>Checkout：{focusedSession.checkout_probe.kind === 'oaics' ? 'oaics' : focusedSession.checkout_probe.kind === 'cs_live' ? 'cs_live' : focusedSession.checkout_probe.status === 'disabled' ? '未开启' : '未知'}</span>}</div></div>
                <span className={`shrink-0 px-2 py-1 rounded-full border text-[10px] font-bold ${theme.border} ${theme.textSecondary}`}>当前账号步骤 {completedFlowSteps} / {flowSteps.length}</span>
              </div>
              <div className={`rounded-lg border px-3 py-2.5 ${theme.border} ${isDark ? 'bg-slate-950/35' : 'bg-slate-50/70'}`}>
                {flowSteps.map((step, index) => <div key={step.label} className="relative flex gap-3 pb-2 last:pb-0">
                  {index < flowSteps.length - 1 && <span className={`absolute left-[9px] top-5 bottom-0 w-px ${step.state === 'done' ? 'bg-emerald-400' : isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />}
                  <span className={`relative z-10 mt-0.5 w-[19px] h-[19px] shrink-0 rounded-full border flex items-center justify-center ${step.state === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : step.state === 'running' ? 'bg-blue-500/10 border-blue-500 text-blue-600' : step.state === 'paused' ? 'bg-amber-500/10 border-amber-500 text-amber-600' : step.state === 'failed' ? 'bg-rose-500/10 border-rose-500 text-rose-600' : isDark ? 'bg-slate-900 border-slate-700 text-slate-600' : 'bg-white border-slate-300 text-slate-300'}`}>
                    {step.state === 'done' ? <CheckCircle2 className="w-3 h-3" /> : step.state === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : step.state === 'paused' ? <Pause className="w-3 h-3" /> : step.state === 'failed' ? <CircleDot className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5 flex items-center justify-between gap-2"><p className={`text-[11px] font-medium truncate ${step.state === 'pending' ? theme.textSecondary : theme.textPrimary}`}>{step.label}</p><span className={`shrink-0 text-[9px] ${step.state === 'done' ? 'text-emerald-600' : step.state === 'running' ? 'text-blue-500' : step.state === 'paused' ? 'text-amber-500' : step.state === 'failed' ? 'text-rose-600' : theme.textSecondary}`}>{step.state === 'done' ? '已完成' : step.state === 'running' ? '执行中' : step.state === 'paused' ? '已暂停' : step.state === 'failed' ? '执行失败' : '等待中'}</span></div>
                </div>)}
              </div>
            </div>
          </section>

          <section className="order-1 min-h-0 overflow-hidden flex flex-col rounded-xl border border-slate-700/80 bg-[#0d1117] shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
            <div className="px-4 py-3 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center gap-1.5" aria-hidden="true"><i className="w-2 h-2 rounded-full bg-rose-500/90" /><i className="w-2 h-2 rounded-full bg-amber-400/90" /><i className="w-2 h-2 rounded-full bg-emerald-500/90" /></span>
                <FileText className="w-3.5 h-3.5 text-slate-400" /><h3 className="text-xs font-semibold font-mono tracking-wide text-slate-200">日志</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-md border border-slate-700 bg-slate-800/80 font-mono text-[10px] text-slate-400">{logs.length} 条</span>
                <button type="button" onClick={() => setLogClearBefore(Math.max(Date.now() / 1000, ...logs.map((log) => log.at)))} disabled={!logs.length} className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-400 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3 w-3" />清理日志</button>
              </div>
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
                return <div key={log.key} title={log.source} className={`px-2.5 py-2 rounded-md border text-[10px] leading-4 ${toneStyle}`}>
                  <p className="break-words"><time className="opacity-50 mr-2">{log.at ? new Date(log.at * 1000).toLocaleTimeString('zh-CN', { hour12: false }) : '--'}</time><b>步骤 {log.step}：</b>{log.message}</p>
                  {log.requiresVisibleBrowser && <div className="mt-2 flex justify-end"><button type="button" onClick={() => void openVisibleRegistrationBrowser()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-200 transition hover:bg-amber-400/20 disabled:opacity-50"><Play className="h-3 w-3" />打开验证浏览器</button></div>}
                </div>;
              })}</div> : <div className="min-h-44 flex items-center justify-center text-center text-[11px] leading-5 text-slate-500"><span className="mr-2 text-emerald-500">$</span>注册日志将在这里自动滚动显示<span className="ml-1 inline-block w-1.5 h-3 bg-slate-500/70 animate-pulse" aria-hidden="true" /></div>}
            </div>
          </section>
        </aside>}
        </div>
      </div>
      {restoreUsesDialog && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="restore-hotmail-uses-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRestoreUsesDialog(null); }}>
        <div className={`w-full max-w-md rounded-2xl border p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <h2 id="restore-hotmail-uses-title" className={`text-base font-bold ${theme.textPrimary}`}>恢复邮箱使用次数</h2>
          <p className={`mt-2 text-xs leading-5 ${theme.textSecondary}`}>邮箱：{restoreUsesDialog.account.email || '未记录邮箱'}</p>
          <div className="mt-4 space-y-1.5">
            <span className={`block text-xs font-bold ${theme.textPrimary}`}>本次恢复次数</span>
            <StyledSelect
              ariaLabel="本次恢复次数"
              value={String(restoreUsesDialog.count)}
              onChange={(value) => setRestoreUsesDialog((previous) => previous ? { ...previous, count: Number(value) } : null)}
              options={Array.from({ length: Math.max(1, Math.min(Number(restoreUsesDialog.account.use_limit || hotmailPool?.alias_uses || 3), Number(restoreUsesDialog.account.use_count || 0) + (restoreUsesDialog.account.failed_aliases?.length || 0))) }, (_, index) => ({ value: String(index + 1), label: `恢复 ${index + 1} 次` }))}
              isDark={isDark}
              disabled={busy.startsWith('hotmail-restore-uses-')}
            />
          </div>
          <div className={`mt-4 rounded-xl border px-3.5 py-3 text-[11px] leading-5 ${isDark ? 'border-slate-700/80 bg-slate-950/55 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>系统会优先恢复测试失败占用的次数，再从最近使用的注册地址开始恢复。正在执行注册任务的邮箱不能修改。</div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" disabled={!!busy} onClick={() => setRestoreUsesDialog(null)} className={`rounded-xl border px-4 py-2.5 text-xs font-bold disabled:opacity-50 ${theme.border} ${theme.textPrimary}`}>取消</button>
            <button type="button" disabled={!!busy} onClick={() => void restoreHotmailUses()} className="rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2.5 text-xs font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60">{busy.startsWith('hotmail-restore-uses-') && <Loader2 className="w-4 h-4 animate-spin" />}确认恢复</button>
          </div>
        </div>
      </div>}
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
