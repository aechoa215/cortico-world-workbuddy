#!/usr/bin/env node
/**
 * 真实窗口 UI 验证（P2-2）：用 headless Chrome 打开真实的开始页 / World 页，断言
 * 「路由挂载」与「面板渲染」两件事分开成立，并把等待逻辑写成轮询 + 15s 超时。
 *
 * 用法：
 *   node scripts/verify-ui.mjs                 # 连跑 5 轮
 *   node scripts/verify-ui.mjs --runs 3 --keep # 保留截图
 *
 * 为什么以前会误报：
 *   · `Page.navigate` 只改 hash 时属于同文档导航，不重新加载页面 → 上一轮失败的产物会残留。
 *     所以这里每一轮都带 `?t=<时间戳>` 整页重载（并额外发一次 `Page.reload({ignoreCache:true})`）。
 *   · 固定 sleep 无法表达「等元素出现」，机器一慢就假失败。这里统一用 `waitFor(fn, 15000)`。
 *
 * 环境：Coopanion 需要正在运行（core 默认 127.0.0.1:17788），WorkBuddy 桌面端需要开着主进程。
 */

import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAppRoot } from './lib/app-root.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const RUNS = argOf('--runs', 5);
const PROXY_PORT = argOf('--port', 18901);
const CDP_PORT = argOf('--cdp', 9222);
const KEEP = args.includes('--keep');
const SHOTS = args.includes('--shots');
const CORE_PORT = argOf('--core', 17788);
const SHOT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'visual');
mkdirSync(SHOT_DIR, { recursive: true });

const appRoot = findAppRoot({ packageDir: fileURLToPath(new URL('..', import.meta.url)) });
if (!appRoot) fail('找不到 Coopanion 的 resources/app（可用 COOPANION_APP_ROOT 环境变量指定）');
const installDir = normalize(join(appRoot, '..', '..'));
const dataDir = join(installDir, 'data');
const consoleDir = join(appRoot, 'build', 'console');
const extModules = join(dataDir, 'extensions', 'node_modules');
const pagePkg = JSON.parse(readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'package.json'), 'utf8'));

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------- 本地代理
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.png': 'image/png' };
const readBody = (req) => new Promise((res, rej) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => res(Buffer.concat(chunks)));
  req.on('error', rej);
});

const proxy = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PROXY_PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const headers = { ...req.headers, host: `127.0.0.1:${CORE_PORT}` };
    if (headers.origin) headers.origin = `http://127.0.0.1:${CORE_PORT}`;
    if (headers.referer) headers.referer = `http://127.0.0.1:${CORE_PORT}${url.pathname}`;
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const up = http.request({ host: '127.0.0.1', port: CORE_PORT, path: req.url, method: req.method, headers }, (resp) => {
      res.writeHead(resp.statusCode || 502, resp.headers);
      resp.pipe(res);
    });
    up.on('error', (err) => { res.writeHead(502); res.end(String(err)); });
    if (body) up.write(body);
    up.end();
    return;
  }
  let path = url.pathname;
  if (path.startsWith('/assets/extensions/')) {
    const rest = path.slice('/assets/extensions/'.length).split('/');
    let pkg;
    if (rest[0].startsWith('@')) { pkg = `${rest[0]}/${rest[1]}`; rest.splice(0, 2); } else { pkg = rest.shift(); }
    rest.shift();
    const rel = rest.join('/');
    for (const file of [join(extModules, pkg, 'dist', rel), join(extModules, pkg, 'assets', rel), join(extModules, pkg, rel)]) {
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
        return;
      } catch { /* 下一个 */ }
    }
    res.writeHead(404); res.end('missing ext asset ' + path);
    return;
  }
  if (path === '/' || path === '/coopanion' || path === '/coopanion/') path = '/coopanion/index.html';
  if (!path.startsWith('/coopanion/')) { res.writeHead(404); res.end('not found'); return; }
  const file = normalize(join(consoleDir, path.slice('/coopanion/'.length)));
  if (!file.startsWith(normalize(consoleDir))) { res.writeHead(403); res.end('nope'); return; }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('missing ' + file);
  }
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- 上游存活
async function api(path, init) {
  const res = await fetch(`http://127.0.0.1:${PROXY_PORT}${path}`, init);
  return res.json();
}
const panel = (name, method, args) => api(`/api/webui/providers/world%3Aworkbuddy/panels/${name}/${method}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PROXY_PORT}` },
  body: JSON.stringify({ args }),
});
try {
  await api('/api/status');
} catch (err) {
  fail(`core 没在跑（127.0.0.1:${CORE_PORT}）：先 pwsh -File scripts/launch-coopanion.ps1`);
}

// 面板接口先冒烟：浏览器断言再漂亮，扩展没装上 / 没加载都是空转。
// 0.3.10 起 models/state 必须带 catalogSource（{ kind, at, label }），这是面板「更新时间」的数据源。
try {
  const st = await panel('models', 'state', []);
  if (!st || typeof st !== 'object' || !Array.isArray(st.models)) {
    throw new Error(`models/state 没返回 models 数组：${JSON.stringify(st).slice(0, 200)}`);
  }
  if (!st.catalogSource || typeof st.catalogSource.label !== 'string') {
    throw new Error(`models/state 缺 catalogSource.label（0.3.10 契约）：${JSON.stringify(st).slice(0, 200)}`);
  }
} catch (err) {
  fail(`面板接口冒烟失败（扩展没装好 / 没加载？）：${err.message}`);
}

// ---------------------------------------------------------------- Chrome
const chromePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].find((p) => p && existsSync(p));
if (!chromePath) fail('找不到 Chrome（本脚本用它做真实渲染验证）');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 端口按需找一个空闲的（9222 常被上一次没退干净的 Chrome 占着，会连到僵尸 target）
async function freePort(start) {
  for (let port = start; port < start + 40; port += 1) {
    const ok = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (ok) return port;
  }
  fail(`找不到空闲端口（从 ${start} 起）`);
}
const cdpPort = await freePort(CDP_PORT);

const profile = mkdtempSync(join(tmpdir(), 'wbui-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,900',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

let browserWs;
for (let i = 0; i < 80 && !browserWs; i += 1) {
  try {
    const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
    browserWs = version.webSocketDebuggerUrl;
  } catch { /* 还没起来 */ }
  if (!browserWs) await sleep(250);
}
if (!browserWs) fail('Chrome CDP 没起来');

const require = createRequire(join(appRoot, 'node_modules', 'noop.js'));
const WebSocket = require('ws');
const ws = new WebSocket(browserWs, { perMessageDeflate: false });
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, method } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('uncaught: ' + (msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text ?? '?'));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const e = msg.params.entry;
    consoleErrors.push(`log: ${e.text}${e.url ? ` @ ${e.url}` : ''}`);
  }
});
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

let sessionId = '';
const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject, method });
  ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});

// 自己开一个 page target 并以 flatten 方式挂上去：比复用 /json/list 里的 target 稳
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const attached = await send('Target.attachToTarget', { targetId, flatten: true });
sessionId = attached.sessionId;
if (!sessionId) fail('CDP 会话挂载失败（拿不到 sessionId）');

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result?.value;
};

// 轮询等待，替代固定 sleep
async function waitFor(label, fn, timeoutMs = 15000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn().catch((err) => ({ __err: String(err) }));
    if (last && last.__err === undefined && last !== false) return last;
    await sleep(intervalMs);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}；最后一次=${JSON.stringify(last)}`);
}

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

const HOME = `http://127.0.0.1:${PROXY_PORT}/coopanion/`;
const worldUrl = (tag) => `http://127.0.0.1:${PROXY_PORT}/coopanion/?t=${tag}#/provider/world%3Aworkbuddy`;

const clickByText = (text) => `(() => {
  const nodes = [...document.querySelectorAll('button,a,div,span,li')];
  const hit = nodes.reverse().find((n) => n.textContent && n.textContent.trim() === ${JSON.stringify(text)} && n.offsetParent !== null);
  if (!hit) return false;
  (hit.closest('button,a,[role="tab"],li') ?? hit).click();
  return true;
})()`;

const readHome = `(() => {
  // 0.3.0 起主页不再注入按钮：这里同时断言「开始页正常渲染」与「没有残留注入行」。
  return { mounted: !!document.querySelector('.home .home-picker'),
    injectedRow: !!document.querySelector('[data-workbuddy-home]'),
    labels: [...document.querySelectorAll('.home-pickerlabel')].map((n) => n.textContent.trim()) };
})()`;

const readModelsPage = `(() => {
  const th = [...document.querySelectorAll('th')].map((n) => n.textContent.trim());
  const text = document.body.innerText || '';
  return { policy: th.includes('合规'), headers: th.join('|'),
    rows: document.querySelectorAll('table tr').length,
    proc: /WorkBuddy 主进程：(运行中|未检测到)/.test(text),
    tabs: [...document.querySelectorAll('button,a')].map((n) => n.textContent.trim()).filter((t) => t && t.length < 24) };
})()`;

const results = [];
let hardFailures = 0;
// 必须为真的检查项：0.3.10 起 row.checks 里的布尔值会被真正消费（以前只写进 JSON，
// summary.ok 只看 hardFailures，新加的检查恒「通过」）。
const REQUIRED_CHECKS = [
  'homeRoute',
  'homeNoInjection',
  'worldRoute',
  'worldTabs',
  'noPriorityTab',
  'noStorageTab',
  'panelRendered',
  'modelsProcessChip',
  'usageRendered',
  'modelsPolicyColumn',
  'modelsHasShowAll',
  // 0.3.11：0.3.7 以来新增的三处界面，之前没有任何窗口断言（REVIEW-0.3.7 M8）。
  'modelsSourceChip',
  'refreshDisabledMatchesProc',
  'accountCreditsButton',
];
// 「同源比对」（读页面文本再和自己预期的常量比）只作为 meta 记录，不算断言——
// 它们只能证明「渲染出了东西」，证明不了「渲染对了」。真正的断言必须是 waitFor 谓词，
// 或者读两个不同来源（DOM vs 面板 state）再比较。

for (let run = 1; run <= RUNS; run += 1) {
  const tag = Date.now();
  const row = { run, checks: {}, meta: {} };
  consoleErrors.length = 0;

  // --- 开始页：正常渲染，且确认 0.3.0 已不再注入任何按钮 ---
  await send('Page.navigate', { url: `${HOME}?t=${tag}` });
  try {
    const home = await waitFor('开始页 .home-picker', async () => {
      const val = await evaluate(readHome);
      return val.mounted ? val : false;
    });
    row.checks.homeRoute = true;
    row.checks.homeNoInjection = home.injectedRow === false;
    row.meta.homeLabels = home.labels;
    if (KEEP) await shot(`run${run}-home`);
  } catch (err) {
    row.checks.homeError = String(err.message || err);
    hardFailures += 1;
  }

  // --- World 页：路由挂载 vs 面板渲染，分两步断言 ---
  // 注意：这里不用「navigate 后跟 Page.reload」——导航过程中 reload 会被 CDP 判为
  // 「Not attached to an active page」。带 `?t=` 的新 URL 本身就是整页加载，够用。
  await send('Page.navigate', { url: worldUrl(Date.now()) });
  try {
    await waitFor('World 页完成加载', async () => (await evaluate(`document.readyState`)) === 'complete');
    await waitFor('World 页路由挂载', async () => evaluate(`/provider\\/world%3Aworkbuddy/.test(location.hash)`));
    row.checks.worldRoute = true;
    await waitFor('页签出现', async () => evaluate(`[...document.querySelectorAll('button,a')].some((n) => n.textContent.trim() === '模型目录')`));
    row.checks.worldTabs = true;
    // 0.3.4：删掉「中转站优先」页签；不再声明 storage，宿主也不会生成空白「数据清理」页签。
    const tabs = await evaluate(`[...document.querySelectorAll('button,a')].map((n) => n.textContent.trim()).filter((t) => t && t.length < 24)`);
    row.checks.noPriorityTab = !tabs.includes('是否启用 WorkBuddy');
    row.checks.noStorageTab = !tabs.includes('数据清理');
    await evaluate(clickByText('模型目录'));
    await waitFor('模型目录渲染', async () => {
      const v = await evaluate(readModelsPage);
      return v.rows > 0 ? v : false;
    });
    row.checks.panelRendered = true;

    // 0.3.11：来源芯片（「更新时间」）——等它真的出现，再从文本里取 label 判断，
    // 不是拿 waitFor 已经要求为真的同一字段回填。
    const sourceChip = await waitFor('模型面板来源芯片', async () => evaluate(`(() => {
      const n = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && /^更新时间[:：]/.test((e.textContent || '').trim()),
      );
      const text = n ? n.textContent.trim() : '';
      const label = text.replace(/^更新时间[:：]\s*/, '').split(' · ')[0].trim();
      return label ? { label } : false;
    })()`));
    if (!/本地缓存|服务器|—/.test(sourceChip.label)) {
      throw new Error(`来源芯片文本不认识：${JSON.stringify(sourceChip.label)}`);
    }
    row.checks.modelsSourceChip = true;

    // 0.3.11：主进程芯片必须与面板 state 对得上（DOM 文本 vs API，两个来源）。
    const panelState = await panel('models', 'state', []);
    if (!panelState || typeof panelState.running !== 'boolean') {
      throw new Error('models/state 的 running 不是布尔值：' + JSON.stringify(panelState).slice(0, 200));
    }
    const procText = await evaluate(`(() => {
      const n = [...document.querySelectorAll('*')].find(
        (e) => e.children.length === 0 && /WorkBuddy 主进程：(运行中|未检测到)/.test(e.textContent || ''),
      );
      return n ? n.textContent.trim() : '';
    })()`);
    row.checks.modelsProcessChip =
      procText === (panelState.running ? 'WorkBuddy 主进程：运行中' : 'WorkBuddy 主进程：未检测到');

    // 0.3.11：刷新按钮的禁用态必须等于「主进程没在跑」。running 取自面板 state，
    // disabled 取自真实 DOM——两边不同源，绑定写反或写死都会被这条抓出来。
    const refreshBtn = await waitFor('「从服务器刷新」按钮', async () => evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === '从服务器刷新');
      return b ? { disabled: !!b.disabled } : false;
    })()`));
    if (refreshBtn.disabled !== !panelState.running) {
      throw new Error(`刷新按钮禁用态与主进程不一致：disabled=${refreshBtn.disabled} running=${panelState.running}`);
    }
    row.checks.refreshDisabledMatchesProc = true;
    if (SHOTS && run === 1) { await sleep(300); await shot('world-models'); }
    // --- 用量面板：页签 → 渲染 → 概览表有行 ---
    await evaluate(clickByText('用量与成本'));
    const usage = await waitFor('用量面板渲染', async () => {
      const v = await evaluate(`(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '刷新余额' && b.offsetParent !== null);
        const chip = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').startsWith('今日积分'));
        const rows = document.querySelectorAll('table tr').length;
        return { hasRefresh: !!btn, chip: (chip?.textContent || '').trim(), rows };
      })()`);
      // 0.3.11：等待只看「面板渲染出来了」（积分 chip 有内容），渲染质量由下面的 check 判。
      return v.chip ? v : false;
    });
    row.checks.usageRendered = usage.hasRefresh === true && usage.rows >= 4 && /\d/.test(usage.chip);
    row.meta.usageRows = usage.rows;
    row.meta.usageChip = usage.chip;
    if (SHOTS && run === 1) { await sleep(300); await shot('world-usage'); }
    // --- 模型目录：合规列 + 默认只列安全清单 ---
    await evaluate(clickByText('模型目录'));
    const modelsView = await waitFor('模型目录渲染', async () => {
      const v = await evaluate(`(() => {
        const th = [...document.querySelectorAll('th')].map((n) => n.textContent.trim());
        const rows = document.querySelectorAll('table tr').length;
        const safePills = [...document.querySelectorAll('td span')].filter((n) => /安全清单/.test(n.textContent || '')).length;
        const allBox = [...document.querySelectorAll('input[type="checkbox"]')].length;
        return { hasPolicy: th.includes('合规'), headers: th.join('|'), rows, safePills, checkboxes: allBox };
      })()`);
      // 0.3.11：等待只看「表格渲染出来了」，合规列 / 全量开关由 check 单独判。
      return v.rows > 0 ? v : false;
    });
    row.checks.modelsPolicyColumn = modelsView.hasPolicy === true;
    row.meta.modelsRows = modelsView.rows;
    row.meta.modelsSafePills = modelsView.safePills;
    row.checks.modelsHasShowAll = modelsView.checkboxes >= 1;

    // 0.3.11：账号面板是独立页签，切过去必须能等到「查询积分」按钮（0.3.7 起账号面板带积分查询）。
    await evaluate(clickByText('账号'));
    const creditsBtn = await waitFor('账号面板「查询积分」按钮', async () => evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (n) => n.textContent.trim() === '查询积分' && n.offsetParent !== null,
      );
      return b ? true : false;
    })()`));
    if (creditsBtn !== true) throw new Error('账号面板没有可见的「查询积分」按钮');
    row.checks.accountCreditsButton = true;
    if (SHOTS && run === 1) { await sleep(300); await shot('world-models'); }
    if (KEEP) await shot(`run${run}-world`);
  } catch (err) {
    row.checks.worldError = String(err.message || err);
    hardFailures += 1;
  }

  // 宿主自己的噪声：面板 WebSocket（测试代理不支持 upgrade）、favicon，以及控制台右上角
// 「v0.2.17 · GitHub」那个版本徽标 —— 它直接打 api.github.com 查最新 release，未登录时限流 403，
// 与扩展无关。这些只记录不计失败。
  const noise = /WebSocket|failed to connect to websocket|favicon|ERR_CONNECTION|api\.github\.com/i;
  row.consoleErrors = consoleErrors.filter((e) => !noise.test(e));
  if (row.consoleErrors.length > 0) hardFailures += 1;
  // 0.3.10：检查项被真正消费——任何一个必需的布尔值不为 true，这一轮就算失败。
  const failedChecks = REQUIRED_CHECKS.filter((k) => row.checks[k] !== true);
  if (failedChecks.length > 0) {
    hardFailures += 1;
    row.checkFailures = failedChecks;
  }
  results.push(row);
  console.log(
    `run ${run}: ${JSON.stringify(row.checks)}${failedChecks.length ? ` FAILED=${failedChecks.join(',')}` : ''}${row.consoleErrors.length ? ` errors=${row.consoleErrors.length}` : ''}`,
  );
}

// ---------------------------------------------------------------- 收尾
ws.close();
chrome.kill();
proxy.close();
await sleep(300);

const summary = { ok: hardFailures === 0, runs: RUNS, version: pagePkg.version, failures: hardFailures, results };
const outFile = join(fileURLToPath(new URL('.', import.meta.url)), 'visual', 'verify-ui.json');
writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: summary.ok, runs: RUNS, failures: hardFailures, report: outFile }));
process.exit(summary.ok ? 0 : 1);
