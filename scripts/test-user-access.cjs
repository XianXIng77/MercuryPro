const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/utils/userAccess.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(code, sandbox);
const { resolveUserAccess, toggleUserAccess } = sandbox.exports;
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/data/menu-registry.json'), 'utf8'));
const makeUser = (overrides = {}) => ({ email: 'member@example.com', username: 'Member', role: 'user', extraMenus: [], extraPermissions: [], removedMenus: [], removedPermissions: [], roleMenus: [], rolePermissions: [], ...overrides });
const emptyRole = { key: 'user', label: 'Member', menuKeys: [], permissions: [] };
const plain = value => JSON.parse(JSON.stringify(value));
const fixtures = [];
let scenarios = 0;
let role = structuredClone(emptyRole);
let user = makeUser();
function check(label, menuOn, permissionOn, actionOn = false) {
  const actual = resolveUserAccess(user, role, catalog);
  assert.equal(actual.menuKeys.has('logs'), menuOn, label + ' menu');
  assert.equal(actual.permissions.has('logs:view'), permissionOn, label + ' permission');
  assert.equal(actual.permissions.has('register:run'), actionOn, label + ' action permission');
  fixtures.push({ label, role: structuredClone(role), user: structuredClone(user), menuOn, permissionOn, actionOn });
  scenarios += 1;
}
function click(field, value) {
  const before = plain(user);
  const otherFields = field === 'extraMenus' ? ['extraPermissions', 'removedPermissions'] : ['extraMenus', 'removedMenus'];
  const next = toggleUserAccess(user, role, catalog, field, value);
  assert.deepEqual(plain(user), before, 'toggling must not mutate the original editing state');
  for (const otherField of otherFields) assert.deepEqual(plain(next[otherField]), before[otherField], 'toggling must not change ' + otherField);
  user = next;
}
check('unassigned menu and permission', false, false);
click('extraMenus', 'logs'); check('grant only a menu', true, false);
click('extraPermissions', 'logs:view'); check('grant permission alongside menu', true, true);
click('extraMenus', 'logs'); check('revoke menu while preserving permission', false, true);
click('extraPermissions', 'logs:view'); check('revoke remaining permission', false, false);
click('extraPermissions', 'logs:view'); check('grant permission without menu', false, true);
click('extraPermissions', 'register:run'); check('grant independent action permission', false, true, true);
click('extraPermissions', 'register:run'); check('revoke action permission only', false, true);
click('extraMenus', 'logs'); check('restore menu without changing permission', true, true);
assert(!user.removedMenus.includes('logs'));
assert(!user.removedPermissions.includes('logs:view'));
role.menuKeys.push('logs'); role.permissions.push('logs:view');
check('role overlap preserves existing personal grants', true, true);
role.menuKeys = []; role.permissions = [];
check('personal grants survive removing role grants', true, true);
role.menuKeys = ['logs']; role.permissions = ['logs:view'];
click('extraMenus', 'logs'); check('revoke overlapping role and personal menu only', false, true);
click('extraPermissions', 'logs:view'); check('revoke overlapping permission separately', false, false);
click('extraPermissions', 'logs:view'); check('restore inherited permission only', false, true);
assert(!user.extraPermissions.includes('logs:view'), 'restoring inheritance must not create a personal permission grant');
click('extraMenus', 'logs'); check('restore inherited menu separately', true, true);
assert(!user.extraMenus.includes('logs'), 'restoring inheritance must not create a personal menu grant');
role.permissions = [];
check('role can provide menu without permission', true, false);
role.menuKeys = []; role.permissions = ['logs:view'];
check('role can provide permission without menu', false, true);
user.extraMenus = ['logs']; user.extraPermissions = ['logs:view'];
user.removedMenus = ['logs']; user.removedPermissions = ['logs:view'];
check('explicit grants win over conflicting legacy removals', true, true);
click('extraMenus', 'logs'); check('revoke contradictory menu grant without touching permission', false, true);
click('extraPermissions', 'logs:view'); check('revoke contradictory permission grant separately', false, false);
click('extraPermissions', 'logs:view'); check('restore permission clears its conflicting removal', false, true);
click('extraMenus', 'logs'); check('restore menu clears its conflicting removal', true, true);

// Cover every real menu, including ones whose only permission is on the menu itself.
for (const menu of catalog.filter(item => item.key !== 'access' && item.permission)) {
  let target = makeUser();
  const toggle = (field, value) => { target = toggleUserAccess(target, emptyRole, catalog, field, value); };
  const expect = (menuOn, permissionOn) => {
    const resolved = resolveUserAccess(target, emptyRole, catalog);
    assert.equal(resolved.menuKeys.has(menu.key), menuOn, menu.key + ' menu is independently assigned');
    assert.equal(resolved.permissions.has(menu.permission), permissionOn, menu.key + ' permission is independently assigned');
    scenarios += 1;
  };
  toggle('extraMenus', menu.key); expect(true, false);
  assert.deepEqual(plain(target.extraPermissions), [], menu.key + ' menu must not auto-grant permissions');
  toggle('extraPermissions', menu.permission); expect(true, true);
  toggle('extraPermissions', menu.permission); expect(true, false);
  toggle('extraMenus', menu.key); expect(false, false);
  toggle('extraPermissions', menu.permission); expect(false, true);
  toggle('extraMenus', menu.key); expect(true, true);
  toggle('extraMenus', menu.key); expect(false, true);
  const menuOnlyRole = { menuKeys: [menu.key], permissions: [] };
  const permissionOnlyRole = { menuKeys: [], permissions: [menu.permission] };
  assert(!resolveUserAccess(makeUser(), menuOnlyRole, catalog).permissions.has(menu.permission), menu.key + ' inherited menu must not imply permission');
  assert(!resolveUserAccess(makeUser(), permissionOnlyRole, catalog).menuKeys.has(menu.key), menu.key + ' inherited permission must not imply menu');
  scenarios += 2;
}

// Shared permission codes cannot cause either menu to be granted or revoked together.
const sharedCatalog = [...catalog, { key: 'logs-copy', path: '/logs-copy', label: 'Shared log view', permission: 'logs:view' }];
const sharedRole = { menuKeys: ['logs', 'logs-copy'], permissions: ['logs:view'] };
let shared = toggleUserAccess(makeUser(), sharedRole, sharedCatalog, 'extraMenus', 'logs');
let resolved = resolveUserAccess(shared, sharedRole, sharedCatalog);
assert(!resolved.menuKeys.has('logs'));
assert(resolved.menuKeys.has('logs-copy'));
assert(resolved.permissions.has('logs:view'));
shared = toggleUserAccess(shared, sharedRole, sharedCatalog, 'extraPermissions', 'logs:view');
resolved = resolveUserAccess(shared, sharedRole, sharedCatalog);
assert(!resolved.menuKeys.has('logs'));
assert(resolved.menuKeys.has('logs-copy'));
assert(!resolved.permissions.has('logs:view'));
shared = toggleUserAccess(shared, sharedRole, sharedCatalog, 'extraMenus', 'logs');
resolved = resolveUserAccess(shared, sharedRole, sharedCatalog);
assert(resolved.menuKeys.has('logs'));
assert(resolved.menuKeys.has('logs-copy'));
assert(!resolved.permissions.has('logs:view'));
scenarios += 3;

// Reloaded raw inheritance is a fallback, never reconstructed from menu definitions.
resolved = resolveUserAccess(makeUser({ roleMenus: ['logs'], rolePermissions: [] }), undefined, catalog);
assert(resolved.menuKeys.has('logs'));
assert(!resolved.permissions.has('logs:view'));
resolved = resolveUserAccess(makeUser({ roleMenus: [], rolePermissions: ['logs:view'] }), undefined, catalog);
assert(!resolved.menuKeys.has('logs'));
assert(resolved.permissions.has('logs:view'));
resolved = resolveUserAccess(makeUser({ roleMenus: ['logs'], rolePermissions: ['logs:view'] }), emptyRole, catalog);
assert(!resolved.menuKeys.has('logs'));
assert(!resolved.permissions.has('logs:view'));
scenarios += 3;

// Access center remains a protected exception for administrators and ordinary users.
const protectedRole = { menuKeys: ['access'], permissions: ['access:manage'] };
const ordinary = makeUser({ extraMenus: ['access'], extraPermissions: ['access:manage'] });
resolved = resolveUserAccess(ordinary, protectedRole, catalog);
assert(!resolved.menuKeys.has('access'));
assert(!resolved.permissions.has('access:manage'));
const admin = makeUser({ role: 'admin', removedMenus: ['access'], removedPermissions: ['access:manage'] });
resolved = resolveUserAccess(admin, emptyRole, catalog);
assert(resolved.menuKeys.has('access'));
assert(resolved.permissions.has('access:manage'));
for (const target of [ordinary, admin]) {
  for (const [field, value] of [['extraMenus', 'access'], ['extraPermissions', 'access:manage']]) {
    assert.deepEqual(plain(toggleUserAccess(target, emptyRole, catalog, field, value)), plain(target));
    scenarios += 1;
  }
}
scenarios += 2;

// Ownership follows current identity, including after a transfer, and future catalog entries.
const futureCatalog = [...catalog, { key: 'future', path: '/future', label: 'Future menu', permission: 'future:view', permissions: [{ code: 'future:edit', label: 'Edit future item' }] }];
for (const ownerIdentity of [{ role: 'owner', email: 'new-owner@example.com' }, { role: 'user', isOwner: true }]) {
  const owner = makeUser({ ...ownerIdentity, removedMenus: futureCatalog.map(menu => menu.key), removedPermissions: ['future:view', 'future:edit'] });
  resolved = resolveUserAccess(owner, emptyRole, futureCatalog);
  assert.equal(resolved.menuKeys.size, futureCatalog.length);
  assert(resolved.permissions.has('future:view'));
  assert(resolved.permissions.has('future:edit'));
  for (const [field, value] of [['extraMenus', 'logs'], ['extraPermissions', 'logs:view']]) {
    assert.deepEqual(plain(toggleUserAccess(owner, emptyRole, futureCatalog, field, value)), plain(owner), 'owner access is immutable');
  }
  scenarios += 1;
}
resolved = resolveUserAccess(makeUser({ email: 'm@xianxing.art', role: 'admin' }), emptyRole, futureCatalog);
assert(!resolved.menuKeys.has('future'), 'former owner email must not retain owner access');
assert(!resolved.permissions.has('future:edit'), 'former owner email must not retain future permissions');
assert(resolved.menuKeys.has('access'), 'former owner retains ordinary administrator access');
scenarios += 1;

if (process.argv.includes('--fixtures')) process.stdout.write(JSON.stringify(fixtures));
else console.log(`PASS: ${scenarios} user access scenarios (${fixtures.length} save/reload fixtures)`);
