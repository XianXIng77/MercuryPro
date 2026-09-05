const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/components/MailboxInboxView.tsx'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children } };
}
const ReactMock = { useState: null, useRef: null, useMemo: null, useCallback: null, useEffect: null, createElement };
ReactMock.default = ReactMock;
const icon = (name) => ({ name });
const icons = new Proxy({}, { get: (_target, name) => icon(name) });
const motion = new Proxy({}, { get: (_target, name) => ({ name: 'motion.' + String(name) }) });

const api = makeApi();
const componentModule = { exports: {} };
const sandbox = {
  module: componentModule,
  exports: componentModule.exports,
  require(request) {
    if (request === 'react') return ReactMock;
    if (request === 'motion/react') return { AnimatePresence: { name: 'AnimatePresence' }, motion };
    if (request === 'lucide-react') return icons;
    if (request.endsWith('/api/microsoftMail')) return api;
    if (request.endsWith('/StyledSelect')) return { StyledSelect: { name: 'StyledSelect' } };
    throw new Error('Unexpected import: ' + request);
  },
  console,
  Error,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(code, sandbox, { filename: 'MailboxInboxView.tsx' });
const MailboxInboxView = componentModule.exports.MailboxInboxView;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function makeEmail(id, body = '') {
  return { id, subject: 'Subject ' + id, senderName: 'Sender', senderEmail: 'sender@example.com', recipient: 'receiver@example.com', date: '2026-09-05', body, bodyContentType: body.startsWith('<') ? 'html' : 'text', snippet: 'preview', tags: [], attachments: [], isRead: false, isStarred: false };
}
function makeApi() {
  return {
    listMicrosoftMessages: async () => [{ id: 'one', subject: 'One', body: { content: 'LIST SECRET' }, bodyPreview: 'preview' }],
    listPublicMicrosoftMessages: async () => [],
    refreshPublicMicrosoftToken: async () => ({}),
    getMicrosoftMessage: async (_accountId, id) => ({ id, subject: id, body: { content: 'detail-' + id } }),
    getPublicMicrosoftMessage: async (_token, id) => ({ id, subject: id, body: { content: 'detail-' + id } }),
    mapMicrosoftMessage: (raw, recipient) => makeEmail(raw.id || 'x', raw.body?.content || ''),
  };
}
const theme = { appBg:'', navBg:'', border:'', cardBg:'', shadow:'', textPrimary:'', textSecondary:'' };
const account = { id: 'a1', accountId: 'a1', emailAddress: 'owner@example.com' };

function makeRunner(props) {
  const state = [];
  const refs = [];
  const memoDeps = [];
  const effectDeps = [];
  const cleanups = [];
  let stateIndex = 0;
  let rendering = false;
  let tree;
  let pendingEffects = [];
  let rerenderNeeded = false;
  ReactMock.useState = (initial) => {
    const index = stateIndex++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    const set = (value) => {
      state[index] = typeof value === 'function' ? value(state[index]) : value;
      rerenderNeeded = true;
    };
    return [state[index], set];
  };
  ReactMock.useRef = (initial) => {
    const index = stateIndex++;
    if (!refs[index]) refs[index] = { current: initial };
    return refs[index];
  };
  const depsChanged = (oldDeps, nextDeps) => !oldDeps || oldDeps.length !== nextDeps.length || nextDeps.some((value, i) => value !== oldDeps[i]);
  ReactMock.useMemo = (factory, deps) => {
    const index = stateIndex++;
    if (!memoDeps[index] || depsChanged(memoDeps[index].deps, deps)) memoDeps[index] = { deps, value: factory() };
    return memoDeps[index].value;
  };
  ReactMock.useCallback = (fn, deps) => ReactMock.useMemo(() => fn, deps);
  ReactMock.useEffect = (effect, deps) => {
    const index = stateIndex++;
    if (!effectDeps[index] || depsChanged(effectDeps[index], deps)) {
      if (cleanups[index]) cleanups[index]();
      effectDeps[index] = deps;
      pendingEffects.push({ index, effect });
    }
  };
  const render = () => {
    if (rendering) return;
    rendering = true;
    do {
      rerenderNeeded = false;
      stateIndex = 0;
      tree = MailboxInboxView(props);
    } while (rerenderNeeded);
    rendering = false;
    const effects = pendingEffects.splice(0);
    for (const { index, effect } of effects) {
      const cleanup = effect();
      if (typeof cleanup === 'function') cleanups[index] = cleanup;
    }
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      if (rerenderNeeded && !rendering) render();
    }
  };
  render();
  return { get tree() { return tree; }, render, flush, state };
}
function walk(node, visit, out = []) {
  if (node == null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { node.forEach((item) => walk(item, visit, out)); return out; }
  out.push(node);
  visit(node);
  walk(node.props?.children, visit, out);
  return out;
}
// Include iframe documents when asserting that protected content is absent.
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return (node.props?.srcDoc || '') + text(node.props?.children);
}

function buttons(tree) {
  return walk(tree, (item) => {}, []).filter((item) => item.type === 'button');
}
function buttonByText(tree, needle) {
  const button = buttons(tree).find((item) => (text(item).includes(needle) || item.props['aria-label'] === needle || item.props.title === needle));
  assert(button, 'button not found: ' + needle);
  return button;
}
function hasText(tree, needle) { return text(tree).includes(needle); }
async function click(runner, button) {
  button.props.onClick?.({ preventDefault() {} });
  await runner.flush();
}

async function scenario(label, fn) {
  Object.assign(api, makeApi());
  try { await fn(); console.log('PASS ' + label); }
  catch (error) { console.error('FAIL ' + label + ': ' + error.stack); process.exitCode = 1; }
}

async function run() {
  Object.assign(api, makeApi());
  await scenario('列表正文不进入详情，详情403不渲染正文', async () => {
    for (const publicAccessToken of [undefined, 'test-signed-link']) {
      const detail = deferred();
      api.getMicrosoftMessage = async () => detail.promise;
      api.getPublicMicrosoftMessage = async () => detail.promise;
      api.listPublicMicrosoftMessages = api.listMicrosoftMessages;
      const runner = makeRunner({ account, publicAccessToken, currentPreset: { mode:'light', themeClasses:theme } });
      await runner.flush();
      assert(!hasText(runner.tree, 'LIST SECRET'));
      await click(runner, buttonByText(runner.tree, '查看正文'));
      assert(!hasText(runner.tree, 'LIST SECRET'), 'loading must not show list body');
      detail.reject(new Error('无权限'));
      await runner.flush();
      assert(hasText(runner.tree, '无权限'));
      assert(!hasText(runner.tree, 'LIST SECRET'));
      assert(!hasText(runner.tree, 'Subject one'), 'denied details must hide the header too');
      assert(!buttons(runner.tree).some((button) => text(button).includes('查看正文')));
      assert.equal(walk(runner.tree, () => {}).filter((node) => node.type === 'iframe').length, 0);
    }
  });

  await scenario('HTML 和文本详情成功均渲染内容', async () => {
    for (const body of ['<p>HTML BODY</p>', 'PLAIN BODY']) {
      api.getMicrosoftMessage = async (_account, id) => ({ id, body: { content: body }, subject: id });
      api.mapMicrosoftMessage = (raw) => makeEmail(raw.id, body);
      const runner = makeRunner({ account, currentPreset: { mode:'light', themeClasses:theme } });
      await runner.flush();
      await click(runner, buttonByText(runner.tree, '查看正文'));
      await runner.flush();
      assert(hasText(runner.tree, body));
    }
  });

  await scenario('详情刷新403清除旧正文，重试成功恢复', async () => {
    let attempt = 0;
    const retry = deferred();
    api.getMicrosoftMessage = async (_account, id) => {
      attempt++;
      if (attempt === 1) return { id, body: { content: 'ORIGINAL BODY' }, subject: id };
      if (attempt === 2) throw new Error('无权限');
      return retry.promise;
    };
    api.mapMicrosoftMessage = (raw) => makeEmail(raw.id, raw.body.content);
    const runner = makeRunner({ account, currentPreset: { mode:'light', themeClasses:theme } });
    await runner.flush();
    await click(runner, buttonByText(runner.tree, '查看正文'));
    await runner.flush();
    assert(hasText(runner.tree, 'ORIGINAL BODY'));
    await click(runner, buttonByText(runner.tree, '重新加载正文'));
    await runner.flush();
    assert(hasText(runner.tree, '无权限'));
    assert(!hasText(runner.tree, 'ORIGINAL BODY'));
    await click(runner, buttonByText(runner.tree, '重新加载正文'));
    retry.resolve({ id:'one', body:{ content:'RECOVERED BODY' }, subject:'one' });
    await runner.flush();
    assert(hasText(runner.tree, 'RECOVERED BODY'));
  });

  await scenario('列表刷新不解除详情403', async () => {
    let detailReject;
    api.getMicrosoftMessage = async () => new Promise((_resolve, reject) => { detailReject = reject; });
    api.listMicrosoftMessages = async () => [];
    const runner = makeRunner({ account, currentPreset: { mode:'light', themeClasses:theme } });
    await runner.flush();
    // list is empty in this case, so use the first fixture API response instead.
    api.listMicrosoftMessages = async () => [{ id:'one', subject:'One', bodyPreview:'preview' }];
    await click(runner, buttonByText(runner.tree, '刷新邮件'));
    await runner.flush();
    await click(runner, buttonByText(runner.tree, '查看正文'));
    detailReject(new Error('无权限'));
    await runner.flush();
    assert(hasText(runner.tree, '无权限'));
    await click(runner, buttonByText(runner.tree, '刷新邮件'));
    await runner.flush();
    assert(hasText(runner.tree, '无权限'));
  });

  await scenario('返回、新选择和过期请求不串信', async () => {
    const requests = {};
    api.listMicrosoftMessages = async () => [{ id:'one', subject:'One' }, { id:'two', subject:'Two' }];
    api.getMicrosoftMessage = (_account, id) => {
      const request = deferred();
      requests[id] = request;
      return request.promise;
    };
    api.mapMicrosoftMessage = (raw) => makeEmail(raw.id, raw.body?.content || '');
    const runner = makeRunner({ account, currentPreset: { mode:'light', themeClasses:theme } });
    await runner.flush();
    await click(runner, buttonByText(runner.tree, '查看正文'));
    await click(runner, buttonByText(runner.tree, '返回邮件列表'));
    requests.one.resolve({ id:'one', body:{content:'STALE ONE'} });
    await runner.flush();
    assert(!hasText(runner.tree, 'STALE ONE'));
    await click(runner, buttonByText(runner.tree, '查看正文'));
    // selected one: now select two directly from list by closing first
    await click(runner, buttonByText(runner.tree, '返回邮件列表'));
    const listButtons = buttons(runner.tree).filter((button) => text(button).includes('查看正文'));
    assert(listButtons.length >= 2);
    await click(runner, listButtons[1]);
    requests.two.resolve({ id:'two', body:{content:'CURRENT TWO'} });
    await runner.flush();
    assert(hasText(runner.tree, 'CURRENT TWO'));
    requests.one.reject(new Error('OLD ERROR'));
    await runner.flush();
    assert(!hasText(runner.tree, 'OLD ERROR'));
    assert(hasText(runner.tree, 'CURRENT TWO'));
  });
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
