import type { AuthMenu } from '../api/auth';
import type { AccessUser, RoleDefinition } from '../api/accessControl';

type RoleAccess = Pick<RoleDefinition, 'menuKeys' | 'permissions'>;
const list = (values: string[] | undefined) => [...new Set(values || [])];

/** Keep role grants and user overrides separate; resolve only for display/access. */
export function resolveUserAccess(user: AccessUser, role: RoleAccess | undefined, catalog: AuthMenu[]) {
  // Site ownership can be transferred; the current owner follows the live catalog.
  if (user.isOwner || user.role === 'owner') {
    const menuKeys = new Set(catalog.map(menu => menu.key));
    const permissions = new Set(catalog.flatMap(menu => [menu.permission, ...(menu.permissions || []).map(item => item.code)].filter((value): value is string => Boolean(value))));
    return { menuKeys, permissions, roleMenus: new Set(menuKeys), rolePermissions: new Set(permissions) };
  }
  const roleMenus = new Set(role?.menuKeys || user.roleMenus || []);
  const rolePermissions = new Set(role?.permissions || user.rolePermissions || []);
  // Menus control navigation; permissions control operations. Resolve each separately.
  // Explicit user grants take precedence over revoked role inheritance, as on the server.
  const menuKeys = new Set([...roleMenus].filter(key => !(user.removedMenus || []).includes(key)));
  const permissions = new Set([...rolePermissions].filter(code => !(user.removedPermissions || []).includes(code)));
  for (const key of user.extraMenus || []) menuKeys.add(key);
  for (const code of user.extraPermissions || []) permissions.add(code);
  if (user.role === 'admin') { menuKeys.add('access'); permissions.add('access:manage'); }
  else { menuKeys.delete('access'); permissions.delete('access:manage'); }
  return { menuKeys, permissions, roleMenus, rolePermissions };
}

/** A click sets a desired effective state, clearing the opposite override. */
export function toggleUserAccess(user: AccessUser, role: RoleAccess | undefined, catalog: AuthMenu[], field: 'extraMenus' | 'extraPermissions', value: string): AccessUser {
  const effective = resolveUserAccess(user, role, catalog);
  const next = { ...user, extraMenus: list(user.extraMenus), extraPermissions: list(user.extraPermissions), removedMenus: list(user.removedMenus), removedPermissions: list(user.removedPermissions) };
  if (user.isOwner || user.role === 'owner' || (field === 'extraMenus' ? value === 'access' : value === 'access:manage')) return next;
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
  } else {
    const enabled = !effective.permissions.has(value);
    setGrant('extraPermissions', 'removedPermissions', value, enabled, effective.rolePermissions.has(value));
  }
  return next;
}
