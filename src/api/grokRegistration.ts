export interface GrokConfig {
  registration_target: 'grok';
  registration_mode: 'browser';
  count: number;
  concurrency: number;
  stagger_ms: number;
  auto_tune_enabled: boolean;
  pre_import_probe_enabled: boolean;
  grok_headless: boolean;
  captcha_provider: 'local' | 'yescaptcha';
  local_solver_url: string;
  yescaptcha_key: string;
  mail_provider: 'custom' | 'hotmail_local';
  mail_base_url: string;
  mail_api_key: string;
  mail_domain: string;
  mail_prefix: string;
  mail_expiry_ms: number;
  hotmail_local_base_url: string;
  hotmail_account_source: 'mail_management' | 'manual';
  proxy: string;
  proxy_strategy: 'round_robin' | 'random' | 'sticky';
  import_concurrency: number;
  import_stagger_ms: number;
  auto_import_enabled: boolean;
  auto_import_target: 'sub2api' | 'cpa';
  registration_json_format: 'sub2api' | 'cpa';
  sub2api_base_url: string;
  sub2api_auth_mode: 'password' | 'api_key';
  sub2api_admin_email: string;
  sub2api_admin_password: string;
  sub2api_api_key: string;
  sub2api_xai_group_id: number;
  sub2api_xai_group_name: string;
  cpa_base_url: string;
  cpa_management_key: string;
  [key: string]: unknown;
}

export interface GrokBatch {
  id?: string;
  batch_id?: string;
  status?: string;
  message?: string;
  count?: number;
  finished?: number;
  ok_count?: number;
  fail_count?: number;
  running?: number;
  paused?: number;
  success?: number;
  failed?: number;
  created_at?: number;
  updated_at?: number;
}

export interface GrokSession {
  id?: string;
  batch_id?: string;
  status?: string;
  message?: string;
  error?: string;
  email?: string;
  batch_index?: number;
  created_at?: number;
  updated_at?: number;
  events?: Array<{ at?: number; status?: string; message?: string }>;
  pre_import_probe_enabled?: boolean;
  registration_json_format?: 'sub2api' | 'cpa';
  probe?: { count?: number; ok?: number; fail?: number; uncertain?: number; state?: string };
  auto_import?: { enabled?: boolean; ok?: boolean; skipped?: boolean; imported?: number; failed?: number; error?: string; target?: string };
  pipeline_queue?: { phase?: string; position?: number; concurrency?: number };
}

export interface GrokMonitor {
  batches: GrokBatch[];
  sessions: GrokSession[];
}

export interface RegistrationPerformanceProfile {
  logical_cores?: number;
  physical_cores?: number;
  cpu_percent?: number | null;
  memory_total_gb?: number | null;
  memory_available_gb?: number | null;
  memory_available_percent?: number | null;
  provider?: string;
  cpu_cap?: number;
  memory_cap?: number;
  recommended_concurrency?: number;
  solver_threads?: number;
  local_slots?: number;
  global_limit?: number;
  effective_cap?: number;
  solver?: Record<string, unknown>;
}

export interface RotationRecord {
  id: string;
  email?: string;
  account_type?: string;
  status?: 'normal' | 'error';
  site_target?: string;
  imported_to_site?: boolean;
  registered_at?: number;
  imported_at?: number;
  request_status?: string;
  last_probe_at?: number;
  last_probe_result?: string;
  probe_state?: string;
  updated_at?: number;
}

export interface RotationList {
  items: RotationRecord[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  summary: { total: number; normal: number; error: number };
  poll: { running?: boolean; interval_seconds?: number; last_auto_run_at?: number; next_auto_run_at?: number };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail?.error || data?.detail || data?.error || `HTTP ${response.status}`;
    const hint = data?.hint ? `；${data.hint}` : '';
    throw new Error(`${typeof detail === 'string' ? detail : JSON.stringify(detail)}${hint}`);
  }
  return data as T;
}

export const grokRegistrationApi = {
  health: () => request<Record<string, unknown>>('/api/grok/health'),
  config: () => request<GrokConfig>('/api/grok/config'),
  performance: (provider: GrokConfig['captcha_provider']) => request<RegistrationPerformanceProfile>(`/api/grok/performance?provider=${encodeURIComponent(provider)}`),
  saveConfig: (config: GrokConfig) => request<{ ok: boolean; config: GrokConfig }>('/api/grok/config', { method: 'PUT', body: JSON.stringify(config) }),
  start: (config: GrokConfig) => request<Record<string, unknown>>('/api/grok/register', { method: 'POST', body: JSON.stringify(config) }),
  monitor: () => request<GrokMonitor>('/api/grok/sessions'),
  resetMonitor: () => request<{ ok?: boolean; error?: string }>('/api/grok/sessions/reset', { method: 'POST' }),
  pauseBatch: (id: string) => request<Record<string, unknown>>(`/api/grok/batches/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeBatch: (id: string) => request<Record<string, unknown>>(`/api/grok/batches/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  detectSolver: () => request<Record<string, any>>('/api/grok/solver/detect'),
  detectProxy: () => request<Record<string, any>>('/api/grok/proxy/detect'),
  checkProxy: (proxy: string) => request<Record<string, any>>('/api/grok/proxy/check', { method: 'POST', body: JSON.stringify({ proxy }) }),
  sub2apiGroups: (config: GrokConfig) => request<{ groups?: Array<{ id: number; name: string; platform?: string }> }>('/api/grok/sub2api/groups', {
    method: 'POST',
    body: JSON.stringify({
      sub2api_base_url: config.sub2api_base_url,
      sub2api_auth_mode: config.sub2api_auth_mode,
      sub2api_admin_email: config.sub2api_admin_email,
      sub2api_admin_password: config.sub2api_admin_password,
      sub2api_api_key: config.sub2api_api_key,
    }),
  }),
  hotmailAccounts: (source: GrokConfig['hotmail_account_source'] = 'mail_management') => request<Record<string, any>>(`/api/grok/mail/hotmail/accounts?source=${encodeURIComponent(source)}`),
  importHotmail: (text: string, baseUrl: string) => request<Record<string, any>>('/api/grok/mail/hotmail/accounts/import', { method: 'POST', body: JSON.stringify({ text, base_url: baseUrl }) }),
  probeHotmail: (baseUrl: string, source: GrokConfig['hotmail_account_source']) => request<Record<string, any>>('/api/grok/mail/hotmail/accounts/probe', { method: 'POST', body: JSON.stringify({ base_url: baseUrl, source }) }),
  probeHotmailOne: (id: string, baseUrl: string) => request<Record<string, any>>(`/api/grok/mail/hotmail/accounts/${encodeURIComponent(id)}/probe`, { method: 'POST', body: JSON.stringify({ base_url: baseUrl }) }),
  updateHotmail: (id: string, payload: { used?: boolean; preferred_for_next_use?: boolean }) => request<Record<string, any>>(`/api/grok/mail/hotmail/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  restoreHotmailUses: (id: string, count: number) => request<Record<string, any>>(`/api/grok/mail/hotmail/accounts/${encodeURIComponent(id)}/restore-uses`, { method: 'POST', body: JSON.stringify({ count }) }),
  deleteHotmail: (id: string) => request<Record<string, any>>(`/api/grok/mail/hotmail/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteHotmailSelected: (ids: string[]) => request<Record<string, any>>('/api/grok/mail/hotmail/accounts', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  deleteHotmailUsed: () => request<Record<string, any>>('/api/grok/mail/hotmail/accounts/used', { method: 'DELETE' }),
  deleteHotmailUnhealthy: () => request<Record<string, any>>('/api/grok/mail/hotmail/accounts/unhealthy', { method: 'DELETE' }),
  testHotmail: (config: GrokConfig) => request<Record<string, any>>('/api/grok/mail/hotmail/test', { method: 'POST', body: JSON.stringify(config) }),
  rotation: (params: { status?: string; keyword?: string; page?: number; pageSize?: number }) => {
    const query = new URLSearchParams({
      page: String(params.page || 1),
      page_size: String(params.pageSize || 20),
    });
    if (params.status) query.set('status', params.status);
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
    return request<RotationList>(`/api/grok/account-rotation?${query}`);
  },
  probeRotation: (ids: string[], allAccounts = false) => request<{ ok: boolean; scheduled?: number; already_running?: boolean }>('/api/grok/account-rotation/probe', {
    method: 'POST', body: JSON.stringify({ ids, all_accounts: allAccounts }),
  }),
  probeRotationOne: (id: string) => request<{ ok: boolean; scheduled?: number }>(`/api/grok/account-rotation/${encodeURIComponent(id)}/probe`, { method: 'POST' }),
  deleteRotation: (ids: string[]) => request<{ ok: boolean; deleted?: number }>('/api/grok/account-rotation', { method: 'DELETE', body: JSON.stringify({ ids }) }),
};
