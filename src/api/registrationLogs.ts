/** 注册诊断日志 API(/api/logs/*)。数据来自后端 log/ 目录下的事件文件夹。 */

export interface RegistrationLogItem {
  id: string;
  time: string;
  stage: string;
  outcome: string;
  email: string;
  hasScreenshot: boolean;
}

export interface RegistrationLogListResult {
  items: RegistrationLogItem[];
  total: number;
  stages: string[];
}

export interface RegistrationLogQuery {
  email?: string;
  stage?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/logs${path}`, {
    ...init,
    credentials: 'same-origin',
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : '请求失败,请稍后重试';
    throw new Error(detail);
  }
  return payload as T;
}

export const registrationLogsApi = {
  list(query: RegistrationLogQuery = {}) {
    const params = new URLSearchParams();
    if (query.email) params.set('email', query.email);
    if (query.stage) params.set('stage', query.stage);
    if (query.outcome) params.set('outcome', query.outcome);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    return request<RegistrationLogListResult>(`?${params.toString()}`);
  },

  logText(id: string) {
    return request<string>(`/${encodeURIComponent(id)}/log`);
  },

  screenshotUrl(id: string) {
    return `/api/logs/${encodeURIComponent(id)}/screenshot`;
  },
};
