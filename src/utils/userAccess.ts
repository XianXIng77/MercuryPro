import type { AuthMenu } from '../api/auth';
import type { AccessUser, RoleDefinition } from '../api/accessControl';

type RoleAccess = Pick<RoleDefinition, 'menuKeys' | 'permissions'>;
const list = (values: string[] | undefined) => [...new Set(values || [])];

/** Keep role grants and user overrides separate; resolve only for display/access. */
export function resolveUserAccess(user: AccessUser, role: RoleAccess | undefined, catalog: AuthMenu[]) {
  const roleMenus = new Set(role?.menuKeys || user.roleMenus || []);
  const rolePermissions = new Set(role?.permissions || user.rolePermissions || []);
  for (const menu of catalog) if (roleMenus.has(menu.key) && menu.permission) rolePermissions.add(menu.permission);
  const menuKeys = new Set([...roleMenus, ...(user.extraMenus || [])]);
  const permissions = new Set([...rolePermissions, ...(user.extraPermissions || [])]);
  for (const menu of catalog) if ((user.extraMenus || []).includes(menu.key) && menu.permission) permissions.add(menu.permission);
  for (const key of user.removedMenus || []) menuKeys.delete(key);
  for (const menu of catalog) {
    if ((user.removedMenus || []).includes(menu.key) && menu.permission && !(user.extraPermissions || []).includes(menu.permission) && !catalog.some(other => menuKeys.has(other.key) && other.permission === menu.permission)) permissions.delete(menu.permission);
  }
  for (const code of user.removedPermissions || []) permissions.delete(code);
  if (user.role === 'admin') { menuKeys.add('access'); permissions.add('access:manage'); }
  else { menuKeys.delete('access'); permissions.delete('access:manage'); }
  return { menuKeys, permissions, roleMenus, rolePermissions };
}

/** A click sets a desired effective state, clearing the opposite override. */
export function toggleUserAccess(user: AccessUser, role: RoleAccess | undefined, catalog: AuthMenu[], field: 'extraMenus' | 'extraPermissions', value: string): AccessUser {
  const effective = resolveUserAccess(user, role, catalog);
  const next = { ...user, extraMenus: list(user.extraMenus), extraPermissions: list(user.extraPermissions), removedMenus: list(user.removedMenus), removedPermissions: list(user.removedPermissions) };
  if (value === 'access' || value === 'access:manage') return next;
  const setGrant = (add: 'extraMenus' | 'extraPermissions', remove: 'removedMenus' | 'removedPermissions', key: string, enabled: boolean, inherited: boolean) => {
    if (enabled) {
      next[remove] = next[remove].filter(item => item !== key);
      // Preserve an explicit extra grant when a role later starts granting it too.
      if (!inherited && !next[add].includes(key)) next[add].push(key);
    } else {
      next[add] = next[add].filter(item => item !== key);
      if (!next[remove].includes(key)) next[remove].push(key);
    }
  };
  if (field === 'extraMenus') {
    const enabled = !effective.menuKeys.has(value);
    setGrant('extraMenus', 'removedMenus', value, enabled, effective.roleMenus.has(value));
    const permission = catalog.find(menu => menu.key === value)?.permission;
    if (permission && (enabled || !catalog.some(menu => menu.key !== value && effective.menuKeys.has(menu.key) && menu.permission === permission))) {
      setGrant('extraPermissions', 'removedPermissions', permission, enabled, effective.rolePermissions.has(permission));
    }
  } else {
    const enabled = !effective.permissions.has(value);
    setGrant('extraPermissions', 'removedPermissions', value, enabled, effective.rolePermissions.has(value));
  }
  return next;
}
