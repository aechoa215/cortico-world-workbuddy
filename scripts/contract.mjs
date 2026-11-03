#!/usr/bin/env node
/**
 * 契约测试：不依赖 Coopanion 宿主，纯 Node 就能跑。
 *
 * 覆盖审查报告里「看起来对、其实悄悄失效」的那一类问题——静态清单与源码是否一致、
 * 促销时间判定、安全清单分层、账本字段名，以及复检报告点名「没有回归断言」的那些行为：
 * 哨兵语义、计费域选择、429 软硬区分、面板方法白名单、账本并发、SSE 尾行 flush、启动兜底。
 *
 * 用法：
 *   node scripts/contract.mjs            # 全部断言
 *   node scripts/contract.mjs --verbose  # 逐条打印
 */

import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildDescribe, renderDescribe } from './gen-describe.mjs';
import { WB_DEFAULTS } from '../src/config.js';
import { attachPromos, parsePromos, priceViewOf } from '../src/promo.js';
import { classifyModel, CAUTION_MODEL_IDS, SAFE_MODEL_IDS } from '../src/safety.js';
import { UsageLedger, dayKey, summarize } from '../src/usage.js';
import { classifyHttpFailure, WbUpstream } from '../src/upstream.js';
import { PANEL_METHODS, TOKEN_AUTO, TOKEN_CLEARED, WorkBuddyWorld } from '../src/world.js';
import { runRegression } from './contract-regression.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const verbose = process.argv.includes('--verbose');

let passed = 0;
const failures = [];

function ok(condition, label, detail) {
  if (condition) {
    passed += 1;
    if (verbose) console.log(`  ✓ ${label}`);
    return;
  }
  const text = detail === undefined ? label : `${label}（实际：${JSON.stringify(detail)}）`;
  failures.push(text);
  if (verbose || failures.length <= 5) console.error(`  ✗ ${text}`);
}

function readJson(name) {
  return JSON.parse(readFileSync(join(pkgDir, name), 'utf8'));
}

const pkg = readJson('package.json');
const describe = readJson('describe.json');

/* ---------------------------------------------------------------- 静态清单 */

console.log('· 清单与源码一致性');
ok(
  renderDescribe(buildDescribe()) === readFileSync(join(pkgDir, 'describe.json'), 'utf8'),
  'describe.json 与 WB_TOOL_DECLS / ENV_PROMPT.md 一致（跑 node scripts/gen-describe.mjs 可修）',
);

const changelog = readFileSync(join(pkgDir, 'CHANGELOG.md'), 'utf8');
ok(
  new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}$`, 'm').test(changelog),
  `CHANGELOG.md 里有 ## ${pkg.version} 段落`,
);

ok(pkg.cortico?.kind === 'world', 'cortico.kind = world');
ok(typeof pkg.cortico?.api === 'number', 'cortico.api 是数字（宿主按它判断兼容）');
ok(Array.isArray(pkg.cortico?.tags), 'cortico.tags 是数组（市场会渲染标签）');
ok(Array.isArray(pkg.cortico?.os) && pkg.cortico.os.includes('win32'), 'cortico.os 明确声明 win32');

for (const rel of ['src/index.js', pkg.cortico.describe, pkg.cortico.icon, pkg.cortico.webUiClient, pkg.cortico.webUiStyle]) {
  ok(existsSync(join(pkgDir, rel)), `文件存在：${rel}`);
}

ok(!existsSync(join(pkgDir, 'ENV_PROMPT.md')), '包里没有那份旧的根 ENV_PROMPT.md（真正模板在 src/）');
for (const need of ['src', 'dist', 'assets', 'scripts', 'describe.json', 'README.md', 'CHANGELOG.md']) {
  ok((pkg.files ?? []).includes(need), `files 覆盖 ${need}`);
}

/* ------------------------------------------- 环境提示词占位符 ↔ envPromptVars */

console.log('· 环境提示词变量');
const worldSource = readFileSync(join(pkgDir, 'src/world.js'), 'utf8');
const declared = new Set([...worldSource.matchAll(/'(workbuddy\.[A-Za-z]+)':/g)].map((m) => m[1]));
const used = new Set([...describe.envPrompt.matchAll(/\{\{(workbuddy\.[A-Za-z]+)\}\}/g)].map((m) => m[1]));
const missing = [...used].filter((name) => !declared.has(name));
ok(missing.length === 0, 'envPrompt 里每个 {{workbuddy.x}} 都有对应变量', missing);
ok(used.size >= 8, `envPrompt 用到了 ${used.size} 个变量`);
ok(!used.has('workbuddy.priority'), '环境提示词不再引用已删除的「中转站优先」开关', [...used]);

const toolNames = describe.tools.map((t) => t.name).sort();
ok(
  toolNames.join(',') === ['wb_chat', 'wb_credits', 'wb_list_models', 'wb_select_model'].join(','),
  'describe.tools 名字齐全',
);
ok(
  describe.tools.every((t) => Array.isArray(t.tags) && t.parameters?.type === 'object'),
  '每个工具都有 tags 与 object 参数',
);

/* ------------------------------------------------------------------- 促销 */

console.log('· 促销与倍率');
const NOW = Date.parse('2026-11-03T23:30:00+08:00');
const promotions = [
  {
    id: 'night',
    kind: 'discount',
    enabled: true,
    priority: 100,
    modelIds: ['glm-5.2'],
    discount: { discountedCredits: '0.50x', factor: 0.5, displayMode: 'strikethrough' },
    schedule: { timezone: 'Asia/Shanghai', daily: [{ start: '23:00', end: '7:50' }] },
  },
  {
    id: 'badge-only',
    kind: 'discount',
    enabled: true,
    priority: 500,
    modelIds: ['glm-5.2'],
    badge: { label: '白天徽标' },
    schedule: { timezone: 'Asia/Shanghai', daily: [{ start: '00:00', end: '23:59' }] },
  },
  {
    id: 'expired',
    kind: 'discount',
    enabled: true,
    priority: 900,
    modelIds: ['glm-5.2'],
    discount: { discountedCredits: '0x', displayMode: 'replace' },
    schedule: { timezone: 'Asia/Shanghai', validUntil: '2020-01-01T00:00:00Z' },
  },
  {
    id: 'numeric',
    kind: 'discount',
    enabled: true,
    priority: 60,
    modelIds: ['hy3'],
    discount: { discountedCredits: '0.25x', displayMode: 'replace' },
    schedule: { timezone: 'Asia/Shanghai', validUntil: 1893456000 },
  },
  {
    id: 'bad-zone',
    kind: 'discount',
    enabled: true,
    priority: 40,
    modelIds: ['hunyuan-chat'],
    discount: { discountedCredits: '0.10x', displayMode: 'replace' },
    schedule: { timezone: 'Not/AZone', daily: [{ start: '00:00', end: '23:59' }] },
  },
];
const promos = parsePromos(promotions, []);
const models = attachPromos(
  [
    { id: 'glm-5.2', credits: 'x0.79' },
    { id: 'hy3', credits: 'x0' },
    { id: 'hunyuan-chat', credits: 'x0.30' },
  ],
  promos,
);

const night = priceViewOf(models[0], NOW);
ok(night.promoId === 'night', '夜里挑的是真正改价的那条促销（不是优先级更高的徽标项）', night.promoId);
ok(night.effective === 0.5, '夜里生效倍率 = 0.5', night.effective);
ok(night.base === 0.79, '目录倍率 x0.79 解析正确', night.base);
ok(night.windowText === '23:00–07:50', '时段文案', night.windowText);
ok(night.discounted === true, 'discounted 标记为真');

const noon = priceViewOf(models[0], Date.parse('2026-11-03T12:00:00+08:00'));
ok(noon.effective === 0.79, '白天不打折', noon.effective);
ok(noon.promoId === undefined || noon.promoId === null, '白天不挂促销 id（过期那条与徽标条都不该改价）', noon.promoId);

const numeric = priceViewOf(models[1], NOW);
ok(numeric.promoId === 'numeric', '数字时间戳（Unix 秒）的有效期被识别', numeric.promoId);

const badZone = priceViewOf(models[2], NOW);
ok(badZone.promoId === 'bad-zone', '非法时区退回 UTC 后窗口仍生效', badZone.promoId);

const defaultZonePromo = parsePromos([{
  id: 'default-zone', modelIds: ['glm-5.2'], discount: { discountedCredits: '0.50x', displayMode: 'replace' },
  schedule: { daily: [{ start: '23:00', end: '7:50' }] },
}], []);
const defaultZoneModel = attachPromos([{ id: 'glm-5.2', credits: 'x0.79' }], defaultZonePromo)[0];
ok(priceViewOf(defaultZoneModel, NOW).effective === 0.5, 'daily 省略 timezone 时按 Asia/Shanghai 判定', priceViewOf(defaultZoneModel, NOW));

const dateOnlyPromo = parsePromos([{
  id: 'date-only', modelIds: ['glm-5.2'], discount: { discountedCredits: '0.20x', displayMode: 'replace' },
  schedule: { timezone: 'Asia/Shanghai', validFrom: '2026-11-03', validUntil: '2026-11-03' },
}], []);
const dateOnlyModel = attachPromos([{ id: 'glm-5.2', credits: 'x0.79' }], dateOnlyPromo)[0];
ok(priceViewOf(dateOnlyModel, Date.parse('2026-11-03T00:00:00+08:00')).effective === 0.2, '纯日期 validFrom 从当地 00:00 生效', dateOnlyPromo[0].schedule);
ok(priceViewOf(dateOnlyModel, Date.parse('2026-11-03T09:00:00+08:00')).effective === 0.2, '纯日期 validUntil 覆盖当天 08:00 之后', dateOnlyPromo[0].schedule);
ok(priceViewOf(dateOnlyModel, Date.parse('2026-11-04T00:00:00+08:00')).effective === 0.79, '纯日期 validUntil 到次日当地 00:00 才失效');
ok(priceViewOf(dateOnlyModel, Date.parse('2026-11-03T09:00:00+08:00')).absoluteText.endsWith('2026-11-03'), '纯日期有效期展示不写偏一天', priceViewOf(dateOnlyModel, NOW).absoluteText);

/* ------------------------------------------------------------------- 安全 */

console.log('· 安全清单');
ok(SAFE_MODEL_IDS.includes('hy4-preview'), 'hy4-preview 在安全清单里');
ok(CAUTION_MODEL_IDS.includes('hy4-preview'), 'hy4-preview 标为谨慎档');

const hy4 = classifyModel('hy4-preview', { id: 'hy4-preview' });
ok(hy4.allow === true && hy4.caution === true, 'hy4-preview 可调用但带谨慎提示', hy4);

const lite = classifyModel('wb-lite', { id: 'wb-lite', disabled: true });
ok(lite.tier === 'disabled' && lite.allow === false, '目录标 disabled 的模型被拒绝', lite.tier);

const alias = classifyModel('auto', { id: 'auto' });
ok(alias.tier === 'alias' && alias.allow === false, '内部别名被拒绝', alias.tier);

const media = classifyModel('hunyuan-image-alpha', { id: 'hunyuan-image-alpha' });
ok(media.tier === 'media' && media.allow === false, '媒体模型被拒绝', media.tier);

const retired = classifyModel('glm-4.6', { id: 'glm-4.6' });
ok(retired.tier === 'retired' && retired.allow === false, '已下架模型被拒绝', retired.tier);

const unknown = classifyModel('totally-new-model', { id: 'totally-new-model' });
ok(unknown.allow === false, '未知模型默认不放行', unknown.allow);

/* ------------------------------------------------------------------- 账本 */

console.log('· 用量账本');
const nowMs = Date.parse('2026-11-03T10:00:00+08:00');
const records = [
  { ts: nowMs - 3600e3, model: 'deepseek-v4.1-flash', ok: true, promptTokens: 15, completionTokens: 4, totalTokens: 19, credit: 0, multiplier: 0.11 },
  { ts: nowMs - 3 * 864e5, model: 'glm-5.2', ok: true, promptTokens: 100, completionTokens: 50, totalTokens: 150, credit: 1.25, multiplier: 0.5 },
  { ts: nowMs - 40 * 864e5, model: 'hy3', ok: false, promptTokens: 0, completionTokens: 0, totalTokens: 0, credit: 0 },
];
const summary = summarize(records, nowMs);
ok(summary.totals.today.calls === 1, '今天只统计今天那条', summary.totals.today.calls);
ok(summary.totals.week.calls === 2, '近 7 天含 3 天前那条', summary.totals.week.calls);
ok(summary.totals.month.calls === 2, '近 30 天不含 40 天前那条', summary.totals.month.calls);
ok(summary.totals.all.calls === 3, '全部含失败那条', summary.totals.all.calls);
ok(summary.totals.month.failed === 0, '近 30 天没有失败', summary.totals.month.failed);
ok(summary.recent[0].total === 19, '最近记录按时间倒序取到最新那条（total=19，不是最旧那条）', summary.recent[0].total);
ok(
  summary.recent.every((r) => 'total' in r && 'prompt' in r && 'completion' in r),
  '最近记录的字段名是 total/prompt/completion（面板按这三个名字读）',
);
ok(summary.byModel[0].model === 'glm-5.2', '按模型聚合按积分降序', summary.byModel.map((m) => m.model));
const creditGap = summarize([{ ts: nowMs, model: 'glm-5.2', ok: true, totalTokens: 3 }], nowMs);
ok(creditGap.totals.today.creditUnknown === 1, '上游未回传 credit 时计为未知，不静默算 0', creditGap.totals.today);
ok(creditGap.recent[0].credit === null, '最近调用的未知 credit 保持 null，与明确 0 区分', creditGap.recent[0]);
ok(!('windowDays' in summary) && !('spanDays' in summary), '未接线的 days/spanDays 参数与字段已删除');

/* --------------------------------------------------------------- 回归防线 */

console.log('· 回归防线（复检报告第 9 条点名缺断言的行为）');

// 哨兵：wb-cleared 表示用户登出，wb-auto 表示「允许自动发现」
ok(TOKEN_CLEARED === 'wb-cleared' && TOKEN_AUTO === 'wb-auto', '两个凭据哨兵的取值稳定', [TOKEN_CLEARED, TOKEN_AUTO]);

const emptyCredDir = mkdtempSync(join(tmpdir(), 'wb-cred-'));

/** 造一个最小 World：只喂 loadTokens 需要的东西，避免碰真机凭据。 */
function makeWorld(secretValue) {
  const ctx = {
    id: 'workbuddy',
    cfg: { ...WB_DEFAULTS, credentialsDir: emptyCredDir, model: 'deepseek-v4.1-flash' },
    timezone: 'Asia/Shanghai',
    botName: 'Coo',
    botDir: emptyCredDir,
    packageDir: pkgDir,
    dataDir: mkdtempSync(join(tmpdir(), 'wb-data-')),
    repoRoot: pkgDir,
    secret: () => secretValue,
    storeSecret: () => {},
    persist: () => {},
    restart: async () => {},
  };
  return new WorkBuddyWorld({ ctx });
}

const signedOutWorld = makeWorld(TOKEN_CLEARED);
await signedOutWorld.loadTokens();
ok(signedOutWorld.tokens === null, 'wb-cleared：不读数据目录凭据', signedOutWorld.tokens);
ok(/已登出|重新探测/.test(String(signedOutWorld.lastError ?? '')), 'wb-cleared：提示用户已登出（可重新探测）', signedOutWorld.lastError);

const autoWorld = makeWorld(TOKEN_AUTO);
await autoWorld.loadTokens();
ok(autoWorld.tokens === null, 'wb-auto：空目录下没有可用凭据', autoWorld.tokens);
ok(
  !/已登出/.test(String(autoWorld.lastError ?? '')),
  'wb-auto：不会把自己判成「已登出」（否则 rediscover 后重启又变未登录）',
  autoWorld.lastError,
);

// 计费域：固定国内计费域，不按 baseUrl 猜；自定义 baseUrl 时跟着走同一出口
const cnUp = new WbUpstream({ baseUrl: 'https://copilot.tencent.com' });
ok(cnUp.billingUrl('/x').startsWith('https://www.codebuddy.cn'), '默认计费域是 www.codebuddy.cn', cnUp.billingUrl('/x'));
const proxyUp = new WbUpstream({ baseUrl: 'https://proxy.example.com' });
ok(proxyUp.billingUrl('/x') === 'https://proxy.example.com/x', '自定义 baseUrl 时计费走同一出口', proxyUp.billingUrl('/x'));

// 429 的软/硬区分
ok(classifyHttpFailure(429, '额度不足，请充值') === 'hard_credit', '429 + 额度文案 → hard_credit', classifyHttpFailure(429, '额度不足，请充值'));
ok(classifyHttpFailure(429, 'too many requests') === 'soft_rate', '429 普通限流 → soft_rate', classifyHttpFailure(429, 'too many requests'));

// 面板方法白名单
ok(
  Array.isArray(PANEL_METHODS.account) && PANEL_METHODS.account.includes('setToken'),
  '账号面板允许 setToken',
);
ok(!PANEL_METHODS.usage.includes('setToken'), '用量面板不能间接写密钥库（白名单生效）');
ok(!('priority' in PANEL_METHODS), '0.3.4 移除「中转站优先」面板后不再有 priority 方法表', Object.keys(PANEL_METHODS));

// 0.3.4：界面只剩 3 个面板，也不再声明 storage（宿主会据此生成空白「数据清理」页签）
const uiWorld = makeWorld(TOKEN_CLEARED);
const ui = uiWorld.webUi('zh');
ok(ui.panels.map((p) => p.id).join(',') === 'models,account,usage', '0.3.4 面板只剩 models/account/usage', ui.panels.map((p) => p.id));
ok(Array.isArray(ui.lamps) && ui.lamps.length === 2, '灯态只保留 WorkBuddy + 主进程两盏', ui.lamps?.length);
ok(!('storage' in ui), '不再声明 storage（否则宿主会生成空的「数据清理」页签）');
ok(!('prefer' in uiWorld.cfg), '配置里不再有 prefer 开关字段', Object.keys(uiWorld.cfg));

// 账本并发：append 与 prune 串行，不互相覆盖
const ledger = new UsageLedger({ dataDir: mkdtempSync(join(tmpdir(), 'wb-ledger-')), log: { warn: () => {} } });
await Promise.all(
  Array.from({ length: 30 }, (_, i) =>
    ledger.append({ ts: Date.now() - i * 1000, model: 'deepseek-v4.1-flash', ok: true, promptTokens: 1, completionTokens: 1, totalTokens: 2, credit: 0 }),
  ),
);
await ledger.prune(Date.now());
const kept = await ledger.readAll();
ok(kept.length === 30, '并发 append + prune 后一条都没丢', kept.length);

// 「今天」按本地日期算，不是 UTC
ok(/getFullYear/.test(readFileSync(join(pkgDir, 'src', 'usage.js'), 'utf8')), 'dayKey 用本地日期字段（getFullYear），不用 toISOString');
const localDay = dayKey(Date.parse('2026-11-03T12:00:00+08:00'));
ok(/^\d{4}-\d{2}-\d{2}$/.test(localDay), 'dayKey 输出 YYYY-MM-DD', localDay);

// SSE：最后一段 data 没有换行时也要把 usage 处理掉（否则积分恒 0）
const sseServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: {"code":0,"choices":[{"delta":{"content":"嗨"}}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n');
  // 末尾只带 credit 且故意不带换行：既不能丢尾帧，也不能覆盖前帧 token。
  res.write('data: {"code":0,"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"credit":0.02}}');
  res.end();
});
await new Promise((resolve) => sseServer.listen(0, '127.0.0.1', resolve));
const sseUrl = `http://127.0.0.1:${sseServer.address().port}`;
const sseUp = new WbUpstream({ baseUrl: sseUrl });
const chatOut = await sseUp.chat({ accessToken: 'test-token' }, { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 }, () => {});
sseServer.close();
ok(chatOut.text === '嗨', 'SSE 正文拼接正确', chatOut.text);
ok(chatOut.usage?.totalTokens === 10, 'SSE 尾行（无换行）里的 usage 被解析', chatOut.usage);
ok(chatOut.credit === 0.02, 'SSE 尾行里的 credit 被解析', chatOut.credit);

// start() 兜底：pushEvent 失败也不能把 started 卡住（否则两盏灯永远「正在读取登录态…」）
const startWorld = makeWorld(TOKEN_CLEARED);
const failingHost = {
  log: { info: () => {}, warn: () => {}, error: () => {} },
  pushEvent: () => Promise.reject(new Error('boom')),
};
await startWorld.start(failingHost);
ok(startWorld.started === true, 'pushEvent 抛错时 start() 仍标记 started（灯态不卡住）');
await startWorld.stop();

// 0.3.1 审查报告新发现的回归防线（单独成文件，便于与上面 68 条基线区分）
await runRegression(ok, { pkgDir });

/* ------------------------------------------------------------------- 结果 */

console.log('');
if (failures.length === 0) {
  console.log(`✓ contract 通过：${passed} 条断言`);
  process.exit(0);
}
console.error(`✗ contract 失败：${failures.length} 条（通过 ${passed} 条）`);
for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
process.exit(1);
