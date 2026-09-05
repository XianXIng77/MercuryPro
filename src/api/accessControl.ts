import { AuthMenu, AccessProfile } from './auth';

export interface PermissionDefinition {
  code: string;
  label: string;
  group: string;
}

export interface RoleDefinition {
  key: string;
  label: string;
  description: string;
  color: string;
  menuKeys: string[];
  permissions: string[];
}

export interface AccessUser extends AccessProfile {
  email: string;
  username: string;
  role: string;
  roleLabel?: string;
  extraMenus: string[];
  extraPermissions: string[];
  removedMenus: string[];
  removedPermissions: string[];
  roleMenus: string[];
  rolePermissions: string[];
  createdAt?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json;charset=utf-8');
  const response = await fetch(`/api/auth${path}`, { ...init, headers, credentials: 'same-origin' });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload ? (payload as { detail?: string }).detail : null;
    throw new Error(detail || `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export const accessApi = {
  catalog: () => request<{ menus: AuthMenu[]; permissions: PermissionDefinition[] }>('/access/catalog'),
  roles: () => request<{ items: RoleDefinition[] }>('/access/roles'),
  users: () => request<{ items: AccessUser[] }>('/access/users'),
  user: (email: string) => request<AccessUser>('/access/users/' + encodeURIComponent(email)),
  updateRole: (role: RoleDefinition) => request<RoleDefinition>(`/access/roles/${encodeURIComponent(role.key)}`, { method: 'PUT', body: JSON.stringify(role) }),
  updateUser: (user: Pick<AccessUser, 'email' | 'role' | 'extraMenus' | 'extraPermissions' | 'removedMenus' | 'removedPermissions'>) => request<{ user: AccessUser } & AccessProfile>(`/access/users/${encodeURIComponent(user.email)}`, { method: 'PUT', body: JSON.stringify({ role: user.role, extraMenus: user.extraMenus, extraPermissions: user.extraPermissions, removedMenus: user.removedMenus, removedPermissions: user.removedPermissions }) }),
};
