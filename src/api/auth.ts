/** MercuryPro 登录认证 API 客户端(/api/auth/*)。会话为 HttpOnly Cookie,无需手动携带 token。 */

export interface AuthUser {
  email: string;
  username: string;
  role: string;
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
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? String((payload as { detail: unknown }).detail)
        : '请求失败,请稍后重试';
    throw new Error(detail);
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

  register(email: string, password: string, username: string, remember: boolean) {
    return request<{ user: AuthUser }>('/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, remember }),
    });
  },

  logout() {
    return request<{ ok: boolean }>('/logout', { method: 'POST' });
  },

  me() {
    return request<{ user: AuthUser }>('/me');
  },
};
