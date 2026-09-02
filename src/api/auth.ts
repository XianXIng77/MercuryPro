/** MercuryPro 登录认证 API 客户端(/api/auth/*)。会话为 HttpOnly Cookie,无需手动携带 token。 */

export interface AuthUser {
  email: string;
  username: string;
  role: string;
}

export interface UserStatsPoint {
  label: string;
  count: number;
  date?: string;
}

export interface UserDashboardStats {
  summary: {
    totalUsers: number;
    newUsersLast30Days: number;
    newUsersToday: number;
    growthRate: number;
  };
  dailyRegistrations: UserStatsPoint[];
  weeklyRegistrations: UserStatsPoint[];
  roleDistribution: UserStatsPoint[];
  generatedAt: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json;charset=utf-8');
  }
  // same-origin 让浏览器自动带上/保存 HttpOnly 会话 Cookie
  const response = await fetch(`/api/auth${path}`, { ...init, headers, credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const getMessage = (value: unknown): string | null => {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (!value || typeof value !== 'object') return null;
      const record = value as Record<string, unknown>;
      for (const key of ['detail', 'message', 'error', 'msg']) {
        const message = getMessage(record[key]);
        if (message) return message;
      }
      return null;
    };
    throw new Error(getMessage(payload) || `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export const authApi = {
  login(email: string, password: string, remember: boolean) {
    return request<{ user: AuthUser }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
    });
  },

  register(email: string, password: string, username: string, remember: boolean, inviteCode: string) {
    return request<{ user: AuthUser }>('/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, remember, invite_code: inviteCode }),
    });
  },

  logout() {
    return request<{ ok: boolean }>('/logout', { method: 'POST' });
  },

  me() {
    return request<{ user: AuthUser }>('/me');
  },

  stats() {
    return request<UserDashboardStats>('/stats');
  },
};
