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
import { findAppRoot } from '../src/host.js';

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
const panel = (method, args) => api(`/api/webui/providers/world%3Aworkbuddy/panels/priority/${method}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PROXY_PORT}` },
  body: JSON.stringify({ args }),
});
try {
  await api('/api/status');
} catch (err) {
  fail(`core 没在跑（127.0.0.1:${CORE_PORT}）：先 pwsh -File scripts/launch-coopanion.ps1`);
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
  const b = document.querySelector('button[data-workbuddy-home-button="1"]');
  return { hasRow: !!document.querySelector('[data-workbuddy-home="1"]'), hasButton: !!b,
    on: b?.classList.contains('on') ?? null, aria: b?.getAttribute('aria-pressed') ?? null,
    label: [...document.querySelectorAll('.home-pickervisor, .home-pickerlabel')].map((n) => n.textContent.trim()) };
})()`;

const readWorldPage = `(() => {
  const label = [...document.querySelectorAll('*')].find((n) => n.textContent?.trim() === '是否启用Workbuddy' && n.offsetParent !== null);
  const box = document.querySelector('input[type="checkbox"]');
  return { hash: location.hash, routeMounted: /provider\\/world%3Aworkbuddy/.test(location.hash),
    panelRendered: !!label, checkbox: !!box, checked: box?.checked ?? null,
    tabs: [...document.querySelectorAll('button,a')].map((n) => n.textContent.trim()).filter((t) => t && t.length < 24) };
})()`;

const results = [];
let hardFailures = 0;

for (let run = 1; run <= RUNS; run += 1) {
  const tag = Date.now();
  const row = { run, checks: {} };
  consoleErrors.length = 0;

  // 归零
  await panel('set', [false]);

  // --- 开始页：路由挂载 + 注入行 ---
  await send('Page.navigate', { url: `${HOME}?t=${tag}` });
  try {
    await waitFor('开始页 .home-picker', async () => evaluate(`!!document.querySelector('.home .home-picker')`));
    row.checks.homeRoute = true;
    const st = await waitFor('注入行 workbuddy 按钮', async () => {
      const v = await evaluate(readHome);
      return v.hasRow && v.hasButton ? v : false;
    });
    row.checks.homeButton = true;
    row.checks.rowLabel = st.label.includes('中转站优先：');

    // 点开
    await evaluate(`document.querySelector('button[data-workbuddy-home-button="1"]').click()`);
    const on = await waitFor('按钮高亮 + prefer=true', async () => {
      const v = await evaluate(readHome);
      const api = await panel('state', []);
      return v.on === true && api.prefer === true ? { v, api } : false;
    });
    row.checks.toggleOn = true;
    if (SHOTS && run === 1) await shot('home-on');
    row.checks.model = on.api.model;

    // 点关
    await evaluate(`document.querySelector('button[data-workbuddy-home-button="1"]').click()`);
    await waitFor('按钮熄灭 + prefer=false', async () => {
      const v = await evaluate(readHome);
      const api = await panel('state', []);
      return v.on === false && api.prefer === false ? true : false;
    });
    row.checks.toggleOff = true;
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
    await waitFor('页签出现', async () => evaluate(`[...document.querySelectorAll('button,a')].some((n) => n.textContent.trim() === '是否启用 WorkBuddy')`));
    row.checks.worldTabs = true;
    await evaluate(clickByText('是否启用 WorkBuddy'));
    const pane = await waitFor('面板渲染（复选框）', async () => {
      const v = await evaluate(readWorldPage);
      return v.panelRendered && v.checkbox ? v : false;
    });
    row.checks.panelRendered = true;
    // 勾上
    await evaluate(`document.querySelector('input[type="checkbox"]').click()`);
    await waitFor('面板勾选 → prefer=true', async () => {
      const dom = await evaluate(`document.querySelector('input[type="checkbox"]')?.checked ?? null`);
      const api = await panel('state', []);
      return dom === true && api.prefer === true ? true : false;
    });
    row.checks.panelToggleOn = true;
    if (SHOTS && run === 1) { await sleep(400); await shot('world-priority-on'); }
    await evaluate(`document.querySelector('input[type="checkbox"]').click()`);
    await waitFor('面板取消 → prefer=false', async () => {
      const dom = await evaluate(`document.querySelector('input[type="checkbox"]')?.checked ?? null`);
      const api = await panel('state', []);
      return dom === false && api.prefer === false ? true : false;
    });
    row.checks.panelToggleOff = true;
    // --- 用量面板：页签 → 渲染 → 概览表有行 ---
    await evaluate(clickByText('用量'));
    const usage = await waitFor('用量面板渲染', async () => {
      const v = await evaluate(`(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '刷新余额' && b.offsetParent !== null);
        const chip = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent || '').startsWith('今日积分'));
        const rows = document.querySelectorAll('table tr').length;
        return { hasRefresh: !!btn, chip: (chip?.textContent || '').trim(), rows };
      })()`);
      return v.hasRefresh && v.rows >= 4 ? v : false;
    });
    row.checks.usageRendered = usage.hasRefresh === true;
    row.checks.usageRows = usage.rows;
    row.checks.usageChip = usage.chip;
    if (SHOTS && run === 1) { await sleep(300); await shot('world-usage'); }
    if (KEEP) await shot(`run${run}-world`);
    void pane;
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
  results.push(row);
  console.log(`run ${run}: ${JSON.stringify(row.checks)}${row.consoleErrors.length ? ` errors=${row.consoleErrors.length}` : ''}`);
}

// ---------------------------------------------------------------- 收尾
await panel('set', [false]);
ws.close();
chrome.kill();
proxy.close();
await sleep(300);

const summary = { ok: hardFailures === 0, runs: RUNS, version: pagePkg.version, failures: hardFailures, results };
const outFile = join(fileURLToPath(new URL('.', import.meta.url)), 'visual', 'verify-ui.json');
writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: summary.ok, runs: RUNS, failures: hardFailures, report: outFile }));
process.exit(summary.ok ? 0 : 1);
