#!/usr/bin/env node
/**
 * 0.3.1 回归断言（0.3.0 审查报告新发现的问题）。
 *
 * 由 scripts/contract.mjs 调用：await runRegression(ok, { pkgDir })。
 * 单独成文件是为了让「这次新补的防线」和原有 68 条基线一眼分得开；
 * 它自带依赖与临时目录，不改动 contract.mjs 里的其它断言。
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WB_DEFAULTS } from '../src/config.js';
import { attachPromos, parsePromos, priceViewOf } from '../src/promo.js';
import { UsageLedger } from '../src/usage.js';
import { WbUpstream, WbUpstreamError } from '../src/upstream.js';
import { candidateAppExecutables } from '../src/credentials.js';
import { TOKEN_AUTO, TOKEN_CLEARED, WorkBuddyWorld } from '../src/world.js';
import { cleanWorkbuddyResidue, WORKBUDDY_DATA_FILES } from './clean-workbuddy.mjs';

/** 造一个可记录密钥库写入的最小 World，避免碰真机凭据。 */
function makeWorld(initialSecret, credentialsDir) {
  let stored = initialSecret;
  const writes = [];
  const ctx = {
    id: 'workbuddy',
    cfg: { ...WB_DEFAULTS, credentialsDir, model: 'deepseek-v4.1-flash' },
    timezone: 'Asia/Shanghai',
    botName: 'Coo',
    botDir: credentialsDir,
    packageDir: '',
    dataDir: mkdtempSync(join(tmpdir(), 'wb-reg-data-')),
    repoRoot: '',
    secret: () => stored,
    storeSecret: (name, value) => {
      writes.push([name, value]);
      stored = value;
    },
    persist: () => {},
    restart: async () => {},
  };
  return { world: new WorkBuddyWorld({ ctx }), writes, getStored: () => stored };
}

export async function runRegression(ok, { pkgDir } = {}) {
  console.log('· 0.3.1 回归防线（审查报告新发现）');

  /* ---- 1. /v3/config 401/403：分类、状态码、不降级、标记不残留 ---------- */
  let configHits = 0;
  let legacyHits = 0;
  const authServer = createServer((req, res) => {
    if (req.url.startsWith('/v3/config')) {
      configHits += 1;
      if (configHits === 1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"msg":"unauthorized"}');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { models: [{ id: 'glm-5.2', credits: 'x0.79' }] } }));
      }
      return;
    }
    legacyHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"data":{"models":[]}}');
  });
  await new Promise((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  const authUrl = `http://127.0.0.1:${authServer.address().port}`;
  const authUp = new WbUpstream({ baseUrl: authUrl });
  let deadErr = null;
  try {
    await authUp.fetchCatalog({ accessToken: 'dead' });
  } catch (err) {
    deadErr = err;
  }
  ok(deadErr instanceof WbUpstreamError, '401 抛的是 WbUpstreamError', String(deadErr));
  ok(deadErr?.kind === 'session_dead', '401 的 kind 是 session_dead（0.3.0 传错参数恒为 server）', deadErr?.kind);
  ok(deadErr?.status === 401, '401 的 status 是 401（不是 0）', deadErr?.status);
  ok(configHits === 1, '401 只请求 /v3/config 一次', configHits);
  ok(legacyHits === 0, '401 不降级到 legacy 目录', legacyHits);

  // 同一个 WbUpstream 复用：上一次的 401 不能污染下一次成功请求
  const second = await authUp.fetchCatalog({ accessToken: 'ok' });
  authServer.close();
  ok(second.source === 'v3-config', '复用 WbUpstream 时上次的 401 标记被重置', second.source);
  ok(legacyHits === 0, '两次请求都没有降级到 legacy', legacyHits);

  /* ---- 2. 写错的 daily 时段不能当成全天打折 ------------------------------ */
  const brokenPromos = parsePromos(
    [
      {
        id: 'broken-window',
        kind: 'discount',
        enabled: true,
        priority: 100,
        modelIds: ['glm-5.2'],
        discount: { discountedCredits: '0.10x', displayMode: 'replace' },
        schedule: { timezone: 'Asia/Shanghai', daily: [{ start: 'WHAT', end: 'NOPE' }] },
      },
    ],
    [],
  );
  const brokenModel = attachPromos([{ id: 'glm-5.2', credits: 'x0.79' }], brokenPromos)[0];
  ok(brokenPromos[0].schedule?.dailyUnusable === true, '无效时段被标成 dailyUnusable', brokenPromos[0].schedule);
  const brokenNoon = priceViewOf(brokenModel, Date.parse('2026-11-03T12:00:00+08:00'));
  ok(brokenNoon.effective === 0.79, '时段读不懂时按目录价，不误报折扣', brokenNoon.effective);
  ok(brokenNoon.promoId === undefined, '时段读不懂时不挂促销 id', brokenNoon.promoId);

  /* ---- 3. rediscover 不覆盖手动粘贴的 token ------------------------------ */
  const emptyDir = mkdtempSync(join(tmpdir(), 'wb-reg-empty-'));
  const manualW = makeWorld('manual-token-value', emptyDir);
  const manualResult = await manualW.world.handleInvoke('account', 'rediscover', [], 'zh');
  ok(manualW.getStored() === 'manual-token-value', '手动 token 下 rediscover 不覆盖密钥库', manualW.getStored());
  ok(manualW.writes.length === 0, '手动 token 下 rediscover 完全不写密钥库', manualW.writes);
  ok(
    manualResult.authed === true && manualResult.source === 'manual',
    '手动 token 下 rediscover 仍显示 manual 已登录',
    manualResult,
  );

  const liveDir = mkdtempSync(join(tmpdir(), 'wb-reg-live-'));
  writeFileSync(join(liveDir, 'workbuddy-desktop.info'), JSON.stringify({ auth: { accessToken: 'auto-found' } }));
  const clearedW = makeWorld(TOKEN_CLEARED, liveDir);
  const clearedResult = await clearedW.world.handleInvoke('account', 'rediscover', [], 'zh');
  ok(clearedW.getStored() === TOKEN_AUTO, '登出哨兵 + 探测成功 → 改写为 wb-auto', clearedW.getStored());
  ok(clearedResult.authed === true, '重新探测后恢复登录态', clearedResult);

  const clearedEmptyW = makeWorld(TOKEN_CLEARED, emptyDir);
  const clearedEmptyResult = await clearedEmptyW.world.handleInvoke('account', 'rediscover', [], 'zh');
  ok(clearedEmptyW.getStored() === TOKEN_CLEARED, '探测失败时保留 wb-cleared 登出哨兵', clearedEmptyW.getStored());
  ok(clearedEmptyResult.authed === false, '探测失败时仍是未登录', clearedEmptyResult);

  const clearW = makeWorld('manual-token-value', emptyDir);
  await clearW.world.handleInvoke('account', 'clearToken', [], 'zh');
  ok(/重新探测/.test(String(clearW.world.lastError ?? '')), 'clearToken 当下就给可操作提示', clearW.world.lastError);

  /* ---- 4. 跨午夜后「今日积分」归零 -------------------------------------- */
  const rollW = makeWorld(TOKEN_AUTO, emptyDir);
  rollW.world.today = { day: '2020-01-01', credit: 12.5, calls: 3, prompt: 100, completion: 50 };
  const rolledVars = rollW.world.envPromptVars();
  ok(rolledVars['workbuddy.todayCredit'] === '0', '跨日后提示词里的今日积分归零', rolledVars['workbuddy.todayCredit']);
  ok(rollW.world.today.day !== '2020-01-01', '跨日后 today.day 翻到当天', rollW.world.today.day);
  const rolledUi = rollW.world.webUi('zh');
  ok(rolledUi.badges.find((b) => b.label === '今日积分')?.value === '0', '跨日后详情页徽标归零');
  ok(
    rollW.world.localDay(Date.parse('2026-11-03T00:30:00+08:00')) === '2026-11-03',
    'localDay 用本地日期（UTC+8 的 00:30 仍是当天）',
    rollW.world.localDay(Date.parse('2026-11-03T00:30:00+08:00')),
  );

  /* ---- 5. 自动解封覆盖两种安装形态 -------------------------------------- */
  const appExes = candidateAppExecutables();
  ok(
    process.platform !== 'win32' || appExes.some((p) => p.endsWith('WorkBuddy AI.exe')),
    'candidateAppExecutables 覆盖 WorkBuddy AI.exe',
    appExes.slice(0, 4),
  );

  /* ---- 6. 余额快照并发写不会互相覆盖 ------------------------------------ */
  const balLedger = new UsageLedger({ dataDir: mkdtempSync(join(tmpdir(), 'wb-reg-bal-')), log: { warn: () => {} } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => balLedger.writeBalance({ total: i, at: i })));
  const bal = await balLedger.readBalance();
  ok(bal !== null && typeof bal.total === 'number', '并发写余额快照后仍是可读的完整 JSON', bal);

  /* ---- 7. 工具描述 / 面板文案与源码一致 --------------------------------- */
  const describeJson = JSON.parse(readFileSync(join(pkgDir, 'describe.json'), 'utf8'));
  const chatDecl = describeJson.tools.find((t) => t.name === 'wb_chat');
  ok(
    chatDecl?.description?.includes('Requires the WorkBuddy desktop app to be running') === true,
    'wb_chat 描述带「需桌面端在运行」前提',
    chatDecl?.description,
  );
  ok(
    !/Home page/.test(readFileSync(join(pkgDir, 'src', 'webui', 'client.js'), 'utf8')),
    '英文面板不再提已删除的开始页按钮',
  );
  const argsW = makeWorld(TOKEN_AUTO, emptyDir);
  let argsErr = null;
  try {
    await argsW.world.tools()[2].handler(undefined);
  } catch (err) {
    argsErr = err;
  }
  ok(argsErr === null, 'tools() handler 收到 undefined args 不抛 TypeError', String(argsErr));

  /* ---- 8. 0.3.4 移除开关后：未选模型也能列目录，提示词不再命令每轮调用 -------- */
  const noModelW = makeWorld(TOKEN_AUTO, emptyDir);
  noModelW.world.cfg.model = '';
  noModelW.world.proc = { running: true, pids: [1], mainPid: 1, via: 'test', detail: '', at: Date.now() };
  noModelW.world.tokens = { accessToken: 'test-only', source: 'test' };
  ok(/目录为空/.test(noModelW.world.toolListModels({})), '空目录时 wb_list_models 给出可读提示（不再依赖任何开关）');
  const vars = noModelW.world.envPromptVars();
  ok(
    vars['workbuddy.process'] === 'running' && vars['workbuddy.model'] === '(none selected)',
    '未选模型时环境提示词如实报告进程与占位模型',
    vars,
  );
  ok(!('workbuddy.priority' in vars), '环境提示词变量里不再有 workbuddy.priority');

  /* ---- 9. 显式卸载清理只删本扩展残留，不动其他配置与密钥 ---------------- */
  const cleanBotDir = mkdtempSync(join(tmpdir(), 'wb-clean-bot-'));
  const cleanDataDir = mkdtempSync(join(tmpdir(), 'wb-clean-data-'));
  writeFileSync(join(cleanBotDir, 'config.json'), JSON.stringify({ worlds: { workbuddy: { enabled: true }, other: { enabled: true } }, keep: 7 }, null, 2));
  writeFileSync(join(cleanBotDir, '.env'), 'OTHER_SECRET=keep\naccessToken=not-printed\n');
  for (const name of WORKBUDDY_DATA_FILES) writeFileSync(join(cleanDataDir, name), name === 'workbuddy-usage.jsonl' ? '' : '{}');
  const checked = cleanWorkbuddyResidue({ botDir: cleanBotDir, dataDir: cleanDataDir, clean: false });
  ok(checked.before.configPresent && checked.before.envPresent && checked.before.dataFiles.length === 3, '清理前能识别配置、凭据与三份数据文件');
  const cleaned = cleanWorkbuddyResidue({ botDir: cleanBotDir, dataDir: cleanDataDir, clean: true });
  ok(!cleaned.after.configPresent && !cleaned.after.envPresent && cleaned.after.dataFiles.length === 0, '显式清理后本扩展无配置、凭据与数据残留');
  const remainingConfig = JSON.parse(readFileSync(join(cleanBotDir, 'config.json'), 'utf8'));
  const remainingEnv = readFileSync(join(cleanBotDir, '.env'), 'utf8');
  ok(remainingConfig.keep === 7 && remainingConfig.worlds.other.enabled === true, '清理保留宿主其他配置', remainingConfig);
  ok(remainingEnv === 'OTHER_SECRET=keep\n', '清理只移除 accessToken 行，保留其他密钥', remainingEnv);
}
