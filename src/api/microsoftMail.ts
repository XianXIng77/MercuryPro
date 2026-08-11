import { Email, MailAccount } from '../types';

export interface MicrosoftMailAccountDto {
  accountId: number | string;
  email: string;
  clientId?: string;
  refreshToken?: string;
  accessToken?: string;
  scope?: string;
  grantType?: string;
  status?: string;
  registrationUseCount?: number;
  registrationUseLimit?: number;
  openaiRegistrationUseCount?: number;
  openaiRegistrationUseLimit?: number;
  openaiRegistrationUsed?: boolean;
  openaiRegistrationFailed?: boolean;
  openaiRegistrationFailureReason?: string;
  createTime?: string;
  updateTime?: string;
}

export interface AccountListQuery {
  pageNum: number;
  pageSize: number;
  email?: string;
  clientId?: string;
  status?: string;
}

export interface AccountListResult {
  rows: MailAccount[];
  total: number;
}

export interface ImportRecord {
  lineNo?: number;
  email?: string;
  rawLine?: string;
  addStatus?: number;
  message?: string;
}

interface ApiResponse<T> {
  code?: number;
  msg?: string;
  data?: T;
  rows?: T extends unknown[] ? T : never;
  total?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json;charset=utf-8');
  }

  const response = await fetch(`/api/microsoft${path}`, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload?.msg ? payload.msg : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  if (payload && typeof payload === 'object' && typeof payload.code === 'number' && payload.code !== 200) {
    throw new Error(payload.msg || '邮件接口请求失败');
  }
  return payload as T;
}

function queryString<T extends object>(params: T) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function mapAccount(dto: MicrosoftMailAccountDto): MailAccount {
  const email = dto.email || '';
  const useLimit = Math.max(1, Number(dto.registrationUseLimit || 3));
  const fallbackCount = dto.status === '1' ? useLimit : 0;
  const useCount = Math.max(0, Math.min(useLimit, Number(dto.registrationUseCount ?? fallbackCount)));
  const backendStatus = useCount >= useLimit ? '1' : useCount > 0 ? '2' : '0';
  return {
    id: String(dto.accountId),
    accountId: dto.accountId,
    accountName: email,
    emailAddress: email,
    clientId: dto.clientId,
    refreshToken: dto.refreshToken,
    accessToken: dto.accessToken,
    scope: dto.scope,
    grantType: dto.grantType,
    backendStatus,
    usageStatus: backendStatus === '1' ? '已用' : backendStatus === '2' ? '使用中' : '未用',
    registrationUseCount: useCount,
    registrationUseLimit: useLimit,
    grokRegistrationUseCount: useCount,
    grokRegistrationUseLimit: useLimit,
    openaiRegistrationUseCount: Math.max(0, Math.min(1, Number(
      dto.openaiRegistrationUseCount ?? (dto.openaiRegistrationUsed ? 1 : 0),
    ))),
    openaiRegistrationUseLimit: 1,
    openaiRegistrationUsed: dto.openaiRegistrationUsed === true,
    openaiRegistrationFailed: dto.openaiRegistrationFailed === true,
    openaiRegistrationFailureReason: dto.openaiRegistrationFailureReason || '',
    createdTime: dto.createTime || '',
    refreshResult: '未刷新',
    protocol: 'Exchange',
    serverHost: 'graph.microsoft.com',
    status: 'active',
    unreadCount: 0,
    totalMails: 0,
    lastSyncTime: dto.updateTime || '尚未同步',
    tags: [],
    messages: [],
  };
}

export async function listMicrosoftMailAccounts(query: AccountListQuery): Promise<AccountListResult> {
  const response = await request<ApiResponse<MicrosoftMailAccountDto[]>>(
    `/accounts${queryString(query)}`,
  );
  const rows = Array.isArray(response.rows) ? response.rows : [];
  return { rows: rows.map(mapAccount), total: Number(response.total || 0) };
}

export async function updateMicrosoftMailAccount(accountId: number | string, status: '0' | '1') {
  return request<ApiResponse<unknown>>(`/accounts/${encodeURIComponent(String(accountId))}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function deleteMicrosoftMailAccount(accountId: number | string) {
  return request<ApiResponse<unknown>>(`/accounts/${encodeURIComponent(String(accountId))}`, {
    method: 'DELETE',
  });
}

export async function deleteMicrosoftMailAccounts(accountIds: Array<number | string>) {
  const response = await request<ApiResponse<{ deleted?: number; missing?: number }>>('/accounts', {
    method: 'DELETE',
    body: JSON.stringify({ ids: accountIds }),
  });
  return response.data || {};
}

export async function importMicrosoftMailAccounts(file: File): Promise<ImportRecord[]> {
  const response = await request<ApiResponse<ImportRecord[]>>('/accounts/import', {
    method: 'POST',
    body: JSON.stringify({ content: await file.text() }),
  });
  return Array.isArray(response.data) ? response.data : [];
}

export async function refreshMicrosoftToken(accountId: number | string) {
  const response = await request<ApiResponse<Record<string, unknown>>>(`/accounts/${encodeURIComponent(String(accountId))}/refresh-token`, {
    method: 'POST',
  });
  return response.data || {};
}

function field<T = unknown>(source: Record<string, any>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null) return source[key] as T;
  }
  return undefined;
}

function formatGraphDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').replace('Z', '');
  return date.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
}

export function mapMicrosoftMessage(raw: Record<string, any>, recipient: string): Email {
  const from = field<Record<string, any>>(raw, 'from', 'From') || {};
  const address = field<Record<string, any>>(from, 'emailAddress', 'EmailAddress') || {};
  const body = field<Record<string, any>>(raw, 'body', 'Body') || {};
  const received = field<string>(raw, 'receivedDateTime', 'ReceivedDateTime') || '';
  const content = field<string>(body, 'content', 'Content') || '';
  const contentType = (field<string>(body, 'contentType', 'ContentType') || 'text').toLowerCase();
  const senderEmail = field<string>(address, 'address', 'Address') || '';
  return {
    id: field<string>(raw, 'id', 'Id') || crypto.randomUUID(),
    senderName: field<string>(address, 'name', 'Name') || senderEmail || '未知发件人',
    senderEmail,
    recipient,
    subject: field<string>(raw, 'subject', 'Subject') || '无主题',
    snippet: field<string>(raw, 'bodyPreview', 'BodyPreview') || '',
    body: content,
    bodyContentType: contentType === 'html' ? 'html' : 'text',
    date: formatGraphDate(received),
    timestamp: received ? new Date(received).getTime() : 0,
    isRead: Boolean(field<boolean>(raw, 'isRead', 'IsRead')),
    isStarred: field<string>(field<Record<string, any>>(raw, 'flag', 'Flag') || {}, 'flagStatus', 'FlagStatus') === 'flagged',
    folderId: 'inbox',
    tags: field<string[]>(raw, 'categories', 'Categories') || [],
    urgency: field<string>(raw, 'importance', 'Importance') === 'high' ? 'high' : 'normal',
    attachments: [],
  };
}

export async function listMicrosoftMessages(accountId: number | string, top = 20) {
  const response = await request<ApiResponse<Record<string, any>>>(
    `/accounts/${encodeURIComponent(String(accountId))}/messages${queryString({ top })}`,
  );
  const data = response.data || {};
  const values = field<Record<string, any>[]>(data, 'value', 'Value') || [];
  return values;
}

export async function getMicrosoftMessage(accountId: number | string, messageId: string) {
  const response = await request<ApiResponse<Record<string, any>>>(
    `/accounts/${encodeURIComponent(String(accountId))}/messages/${encodeURIComponent(messageId)}`,
  );
  return response.data || {};
}
