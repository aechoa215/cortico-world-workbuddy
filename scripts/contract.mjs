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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildDescribe, renderDescribe } from './gen-describe.mjs';
import { WB_CONFIG_GROUP, WB_DEFAULTS } from '../src/config.js';
import { attachPromos, parsePromos, priceViewOf } from '../src/promo.js';
import { classifyModel, CAUTION_MODEL_IDS, SAFE_MODEL_GROUPS, SAFE_MODEL_IDS } from '../src/safety.js';
import { pickCacheEntry, readLocalCatalog } from '../src/localcatalog.js';
import { readRecentWorldLogs } from '../src/selfcheck.js';
import { UsageLedger, dayKey, summarize } from '../src/usage.js';
import { classifyHttpFailure, normalizeModel, WbUpstream } from '../src/upstream.js';
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
  toolNames.join(',') === ['wb_chat', 'wb_credits', 'wb_list_models', 'wb_select_model', 'wb_selfcheck'].join(','),
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
ok(SAFE_MODEL_IDS.includes('hy4free'), 'hy4free 在安全清单里');
ok(SAFE_MODEL_IDS.includes('hy4std'), 'hy4std 在安全清单里');
ok(!SAFE_MODEL_IDS.includes('hy4-preview'), '已下架的 hy4-preview 不在安全清单里');

ok(CAUTION_MODEL_IDS.includes('hy4free'), 'hy4free 标为谨慎档（限时免费试用）');
ok(!CAUTION_MODEL_IDS.includes('hy4std'), 'hy4std 是常规定价，不按谨慎档处理');

const hy4free = classifyModel('hy4free', { id: 'hy4free' });
ok(hy4free.allow === true && hy4free.caution === true, 'hy4free 可调用但带谨慎提示', hy4free);

const hy4std = classifyModel('hy4std', { id: 'hy4std' });
ok(hy4std.allow === true && hy4std.caution === false, 'hy4std 可调用且不带谨慎提示', hy4std);

const hy4Old = classifyModel('hy4-preview', { id: 'hy4-preview' });
ok(hy4Old.tier === 'retired' && hy4Old.allow === false, 'hy4-preview 已从目录移除、不再放行', hy4Old);

const hy4Ctrl = classifyModel('hy4-preview-ctrl', { id: 'hy4-preview-ctrl' });
ok(hy4Ctrl.tier === 'experimental' && hy4Ctrl.allow === false, '同前缀实验号仍是实验预览、不放行', hy4Ctrl.tier);

const hy4Group = SAFE_MODEL_GROUPS.find((g) => g.label === '混元');
ok(
  Boolean(hy4Group) && hy4Group.ids.includes('hy4free') && hy4Group.ids.includes('hy4std'),
  '混元分组同时列出 hy4free / hy4std',
  hy4Group?.ids,
);

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
// 0.3.5：顶部徽标只在挂载时渲染一次，会与面板实时状态不一致，整段删除。
ok(!('badges' in ui), '不再有顶部徽标（当前模型/倍率/今日积分以面板为准）', Object.keys(ui));
ok(!('prefer' in uiWorld.cfg), '配置里不再有 prefer 开关字段', Object.keys(uiWorld.cfg));

// --------------------------------------------------- 本地目录缓存（0.3.7）

console.log('· 本地目录缓存（0.3.7）');

// 桌面端每次启动写两份：GUI 主通道（62 个模型 + 促销）与 CLI 子集（58 个、0 条促销）。
const cachePromoDoc = {
  models: Array.from({ length: 62 }, (_, i) => ({
    id: `gui-${i}`,
    name: `GUI ${i}`,
    credits: 'x0.29',
    maxInputTokens: 960000,
    maxOutputTokens: 64000,
  })),
  modelPromotions: [
    {
      id: 'hy4-free-trial-202611',
      modelIds: ['gui-0'],
      discount: { discountedCredits: '0x', factor: 0, displayMode: 'strikethrough' },
    },
  ],
  modelTiers: [{ id: 'tier-1', modelIds: ['gui-1'], badge: { label: '订阅优先' } }],
};
const cacheCliDoc = {
  models: Array.from({ length: 58 }, (_, i) => ({ id: `cli-${i}` })),
  modelPromotions: [],
  modelTiers: [],
};

const pickedPromo = pickCacheEntry([
  { path: 'cli.json', mtime: 2000, text: JSON.stringify(cacheCliDoc) }, // 更新，但是 CLI 子集
  { path: 'gui.json', mtime: 1000, text: JSON.stringify(cachePromoDoc) }, // 更旧，但带促销
]);
ok(
  pickedPromo?.path === 'gui.json' && pickedPromo.withPromos === true,
  '两份都合法时优先带促销的那份（62 个），不被 58 个的 CLI 子集按 mtime 抢走',
  pickedPromo?.path,
);

const pickedHalf = pickCacheEntry([
  { path: 'half.json', mtime: 3000, text: '{"models":[{"id":"x"}' }, // 桌面端写了一半
  { path: 'gui.json', mtime: 1000, text: JSON.stringify(cachePromoDoc) },
]);
ok(pickedHalf?.path === 'gui.json', '坏 JSON 被跳过，不因为「更新」就把目录读空', pickedHalf?.path);

const pickedBadShape = pickCacheEntry([
  { path: 'empty.json', mtime: 5000, text: JSON.stringify({ models: [], modelPromotions: [{ id: 'p' }] }) },
  { path: 'no-id.json', mtime: 4000, text: JSON.stringify({ models: [{ name: 'x' }] }) },
  { path: 'gui.json', mtime: 1000, text: JSON.stringify(cachePromoDoc) },
]);
ok(pickedBadShape?.path === 'gui.json', 'models 为空 / 模型缺 string id 的缓存不算候选', pickedBadShape?.path);
ok(pickCacheEntry([]) === null, '没有缓存文件时返回 null');
ok(
  pickCacheEntry([{ path: 'a.json', mtime: 2, text: JSON.stringify(cacheCliDoc) }])?.withPromos === false,
  '只有不带促销的缓存时接受它（促销记为空，不当作非法）',
);

// 真文件系统：路径、mtime、-tpl- 跳过、目录不存在
const cacheHome = mkdtempSync(join(tmpdir(), 'wb-cfghome-'));
const cacheDir = join(cacheHome, 'cache');
mkdirSync(cacheDir, { recursive: true });
const guiPath = join(cacheDir, 'acc-product-config-v3-100-uuid-a.json');
const cliPath = join(cacheDir, 'acc-product-config-v3-100-uuid-b.json');
const tplPath = join(cacheDir, 'acc-product-config-v3-100-uuid-tpl-main.json');
const oldMs = Date.now() - 3600e3;
const newerMs = Date.now() - 60e3;
writeFileSync(guiPath, JSON.stringify(cachePromoDoc));
writeFileSync(cliPath, JSON.stringify(cacheCliDoc));
writeFileSync(tplPath, JSON.stringify({ models: [{ id: 'tpl-only' }], modelPromotions: [] }));
utimesSync(guiPath, new Date(oldMs), new Date(oldMs));
utimesSync(cliPath, new Date(newerMs), new Date(newerMs));
utimesSync(tplPath, new Date(newerMs), new Date(newerMs));

const localRead = await readLocalCatalog({ dir: cacheHome });
ok(localRead?.models.length === 62, '从缓存目录读到 62 个模型的那份', localRead?.models.length);
ok(localRead?.promos.length === 2, '促销与档位都解析出来（1 条促销 + 1 条档位）', localRead?.promos.length);
ok(
  localRead?.path === guiPath && localRead?.mtime === statSync(guiPath).mtimeMs,
  '返回选中文件的路径与该文件的 mtime',
  [localRead?.path, localRead?.mtime],
);
ok(!localRead?.models.some((m) => m.id === 'tpl-only'), '-tpl- 模板文件不参与选择');
ok(
  localRead?.models[0]?.maxTokens === 64000 && localRead?.models[0]?.creditMultiplier === 0.29,
  '复用 upstream.normalizeModel 解析（maxOutputTokens / credits 都转成内部字段）',
  localRead?.models[0],
);
ok((await readLocalCatalog({ dir: join(cacheHome, 'missing') })) === null, '缓存目录不存在时返回 null（不抛错）');

process.env.WORKBUDDY_CONFIG_DIR = cacheHome;
const consoleLog = { warn: () => {}, info: () => {}, error: () => {} };

// 本地比磁盘新 → 用本地
const localWorld = makeWorld(TOKEN_CLEARED);
localWorld.host = { log: consoleLog };
localWorld.catalog = [{ id: 'disk-old' }];
localWorld.catalogAt = oldMs - 3600e3;
localWorld.catalogSource = 'v3-config';
await localWorld.loadLocalCatalog();
ok(
  localWorld.catalog.length === 62 && localWorld.catalog[0]?.id === 'gui-0',
  '本地缓存比磁盘目录新时用本地那份',
  localWorld.catalog.length,
);
ok(
  localWorld.catalogSource === 'local-cache' && localWorld.catalogAt === statSync(guiPath).mtimeMs,
  '用本地时 catalogSource = local-cache、catalogAt 取缓存文件 mtime',
  [localWorld.catalogSource, localWorld.catalogAt],
);
const savedLocal = JSON.parse(readFileSync(localWorld.catalogPath(), 'utf8'));
ok(
  savedLocal.at === localWorld.catalogAt,
  '落盘写的是目录时间而不是 Date.now（否则下次启动会把本地缓存判成旧的）',
  savedLocal.at,
);
ok(
  savedLocal.source === 'local-cache' && savedLocal.path === guiPath,
  '落盘记录来源与缓存路径',
  [savedLocal.source, savedLocal.path],
);

// 磁盘比本地新 → 保持原样
const diskWorld = makeWorld(TOKEN_CLEARED);
diskWorld.host = { log: consoleLog };
diskWorld.catalog = [{ id: 'disk-new' }];
diskWorld.catalogAt = Date.now() + 3600e3;
diskWorld.catalogSource = 'v3-config';
await diskWorld.loadLocalCatalog();
ok(
  diskWorld.catalog.length === 1 && diskWorld.catalog[0]?.id === 'disk-new',
  '磁盘目录比本地缓存新时保持原样（不被旧缓存覆盖）',
  diskWorld.catalog.map((m) => m.id),
);
ok(diskWorld.catalogSource === 'v3-config', '磁盘更新时来源仍是 v3-config', diskWorld.catalogSource);

// 面板 state：结构化 catalogSource
const viewWorld = makeWorld(TOKEN_CLEARED);
viewWorld.host = { log: consoleLog };
viewWorld.catalog = [{ id: 'gui-0', name: 'GUI 0' }];
viewWorld.catalogAt = oldMs;
viewWorld.catalogSource = 'local-cache';
viewWorld.localCatalogPath = guiPath;
const stateOfView = await viewWorld.handleInvoke('models', 'state', [], 'zh');
ok(
  stateOfView.catalogSource?.kind === 'local-cache' && /^本地缓存 · /.test(String(stateOfView.catalogSource?.label)),
  'models/state 带结构化 catalogSource，label 形如「本地缓存 · MM-DD HH:mm」',
  stateOfView.catalogSource,
);
ok(
  stateOfView.catalogSource?.at === oldMs && stateOfView.catalogSource?.path === guiPath,
  'catalogSource 带 at 与本地缓存路径（面板可显示出处）',
  stateOfView.catalogSource,
);

// 主进程没跑（0.3.8 起）：仍然排「读本地缓存」——缓存是纯本地文件，读它不需要桌面端在跑。
// 主进程闸门只留在「从服务器刷新」那条路上，否则首次安装且 WorkBuddy 没开时会无目录可看。
const gateWorld = makeWorld(TOKEN_CLEARED);
gateWorld.host = { log: consoleLog };
gateWorld.proc = { running: false, pids: [], mainPid: null, via: 'test', detail: '', at: Date.now() };
gateWorld.scheduleLocalCatalog();
ok(gateWorld._localTimer !== null, '主进程没跑时也排「读本地缓存」任务（0.3.8）');
const scheduledOnce = gateWorld._localTimer;
gateWorld.scheduleLocalCatalog();
ok(
  scheduledOnce !== null && gateWorld._localTimer === scheduledOnce,
  '同一次「没跑 → 在跑」翻转只排一次（重复调用不叠加定时器）',
);

gateWorld.proc = { running: false, pids: [], mainPid: null, via: 'test', detail: '', at: Date.now() };
// refreshCatalog 开头会再 syncProc(true) 一次。这里把它桩掉：否则本机恰好开着
// WorkBuddy 时会被真的探到「在跑」，闸门放行，这条断言就变成看机器状态了。
gateWorld.syncProc = async () => {};
let gateError = null;
try {
  await gateWorld.refreshCatalog();
} catch (err) {
  gateError = err;
}
ok(
  gateError !== null && /主进程没在跑/.test(String(gateError?.message ?? '')),
  '主进程没跑时 refreshCatalog 直接抛错（消息说人话，不发请求）',
  String(gateError?.message ?? gateError),
);
await gateWorld.stop();
ok(gateWorld._localTimer === null, 'stop() 清掉待执行的读缓存任务');

// M3（0.3.8）：读本地缓存不能擦掉与目录无关的错误（认证 / 上次刷新失败）。
const errWorld = makeWorld(TOKEN_CLEARED);
errWorld.host = { log: consoleLog };
errWorld.catalog = [{ id: 'disk-old' }];
errWorld.catalogAt = oldMs - 3600e3;
errWorld.lastError = '已登出：点「重新探测」或重新填 token 才能继续使用。';
await errWorld.loadLocalCatalog();
ok(
  errWorld.catalog.length === 62 && /已登出/.test(String(errWorld.lastError)),
  'M3：读本地缓存成功时不清掉 lastError（认证提示要留着）',
  errWorld.lastError,
);

// H2（0.3.8）：只剩无促销的 CLI 子集（且 mtime 在未来）时，不能顶掉已有促销的完整目录。
const cliOnlyHome = mkdtempSync(join(tmpdir(), 'wb-cli-only-'));
mkdirSync(join(cliOnlyHome, 'cache'), { recursive: true });
const cliOnlyPath = join(cliOnlyHome, 'cache', 'acc-product-config-v3-9-uuid.json');
writeFileSync(cliOnlyPath, JSON.stringify(cacheCliDoc));
const futureMs = Date.now() + 7200e3;
utimesSync(cliOnlyPath, new Date(futureMs), new Date(futureMs));
process.env.WORKBUDDY_CONFIG_DIR = cliOnlyHome;
const h2World = makeWorld(TOKEN_CLEARED);
h2World.host = { log: consoleLog };
h2World.catalog = [{ id: 'gui-0' }];
h2World.promos = [{ id: 'night', modelIds: ['gui-0'], discount: { multiplier: 0.5 } }];
h2World.catalogAt = Date.now() - 3600e3;
h2World.catalogSource = 'local-cache';
await h2World.loadLocalCatalog();
ok(
  h2World.catalog.length === 1 && h2World.catalog[0].id === 'gui-0',
  'H2：无促销的 CLI 子集不覆盖已有的完整目录（哪怕 mtime 更新）',
  h2World.catalog.map((m) => m.id),
);
ok(
  h2World.promos.length === 1 && h2World.catalogSource === 'local-cache',
  'H2：促销与来源都保持不变',
  [h2World.promos.length, h2World.catalogSource],
);
delete process.env.WORKBUDDY_CONFIG_DIR;

// 0.3.5：v3 接口失败退回 legacy 时，不拿降级目录覆盖已有的 v3 目录（否则促销与倍率全丢）
const guardWorld = makeWorld(TOKEN_AUTO);
guardWorld.host = { log: { warn: () => {}, info: () => {}, error: () => {} } };
// 0.3.7 起 refreshCatalog 开头要求主进程在跑，这里直接给一个「在跑」的快照。
guardWorld.syncProc = async () =>
  (guardWorld.proc = { running: true, pids: [1], mainPid: 1, via: 'test', detail: '', at: Date.now() });
guardWorld.tokens = { accessToken: 'test-only', source: 'test' };
guardWorld.catalog = [{ id: 'glm-5.3', creditMultiplier: 0.69 }];
guardWorld.promos = [{ id: 'night', modelIds: ['glm-5.3'], discount: { multiplier: 0.5 } }];
guardWorld.catalogSource = 'v3-config';
guardWorld.upstream = () => ({ fetchCatalog: async () => ({ models: [{ id: 'legacy-only' }], promos: [], source: 'legacy' }) });
const guarded = await guardWorld.refreshCatalog();
ok(guarded.length === 1 && guarded[0].id === 'glm-5.3', 'legacy 刷新结果不覆盖已有的 v3 目录', guarded.map((m) => m.id));
ok(guardWorld.promos.length === 1 && guardWorld.catalogSource === 'v3-config', '保留 v3 来源与促销', guardWorld.catalogSource);
ok(/v3|legacy/.test(String(guardWorld.lastError ?? '')), '保留旧目录时给出提示', guardWorld.lastError);

// H1（0.3.8）：legacy 降级保护不能只认 'v3-config'——0.3.7 之后最常见的完整目录来源是 local-cache。
const lcGuard = makeWorld(TOKEN_AUTO);
lcGuard.host = { log: { warn: () => {}, info: () => {}, error: () => {} } };
lcGuard.syncProc = async () =>
  (lcGuard.proc = { running: true, pids: [1], mainPid: 1, via: 'test', detail: '', at: Date.now() });
lcGuard.tokens = { accessToken: 'test-only', source: 'test' };
lcGuard.catalog = [{ id: 'glm-5.3', creditMultiplier: 0.69 }];
lcGuard.promos = [{ id: 'night', modelIds: ['glm-5.3'], discount: { multiplier: 0.5 } }];
lcGuard.catalogSource = 'local-cache';
lcGuard.upstream = () => ({ fetchCatalog: async () => ({ models: [{ id: 'legacy-only' }], promos: [], source: 'legacy' }) });
const lcGuarded = await lcGuard.refreshCatalog();
ok(
  lcGuarded.length === 1 && lcGuarded[0].id === 'glm-5.3',
  'H1：local-cache 的完整目录不被 legacy 降级结果覆盖',
  lcGuarded.map((m) => m.id),
);
ok(
  lcGuard.promos.length === 1 && lcGuard.catalogSource === 'local-cache',
  'H1：保留 local-cache 来源与促销',
  [lcGuard.promos.length, lcGuard.catalogSource],
);

// H3（0.3.8）：start() 不再发余额请求——余额只在用户点「刷新余额 / 查询积分」时取。
const bootWorld = makeWorld(TOKEN_AUTO);
bootWorld.loadTokens = async () => {};
bootWorld.tokens = { accessToken: 'test-only', source: 'test' };
bootWorld.syncProc = async () =>
  (bootWorld.proc = { running: true, pids: [1], mainPid: 1, via: 'test', detail: '', at: Date.now() });
let balanceCalls = 0;
bootWorld.syncBalance = async () => {
  balanceCalls += 1;
};
await bootWorld.start({ log: consoleLog, pushEvent: async () => {} });
ok(balanceCalls === 0, 'H3：start() 不发带 token 的余额请求（模型目录与余额都不主动联网）', balanceCalls);
await bootWorld.stop();

// ---------------------------------------------------------------------------
// 0.3.9：本地目录读取窄版异步 + 6 秒 tick 周期复查
// ---------------------------------------------------------------------------
console.log('· 0.3.9：本地目录异步读与周期复查');

// 静态：只有 readFile 是异步的；同步 readdir/stat 保留（扫描原子性 + 不进 libuv 线程池）。
const lcSrc = readFileSync(join(pkgDir, 'src/localcatalog.js'), 'utf8');
ok(!/readFileSync/.test(lcSrc), 'localcatalog.js 不再有 readFileSync（读文件已全异步）');
ok(/from 'node:fs\/promises'/.test(lcSrc), "localcatalog.js 从 node:fs/promises 取 readFile");
const pendingRead = readLocalCatalog({ dir: join(cacheHome, 'missing') });
ok(pendingRead instanceof Promise, 'readLocalCatalog() 返回 Promise（调用方必须 await）');
await pendingRead;

/** 造一个 /tmp 下的假 workbuddy 配置根（带 cache/ 子目录）。 */
function makeCacheHome(tag) {
  const home = mkdtempSync(join(tmpdir(), `wb-${tag}-`));
  const dir = join(home, 'cache');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

// 目录不可读（这里是「路径是个文件」→ ENOTDIR）：按无缓存处理，不抛错。
const ioHome = mkdtempSync(join(tmpdir(), 'wb-io-'));
const plainFile = join(ioHome, 'plain.json');
writeFileSync(plainFile, '{}');
ok((await readLocalCatalog({ dir: plainFile })) === null, '缓存目录读不了时按「没有缓存」处理，不抛错');

// 选择规则只有一套：pickCacheEntry 与 readLocalCatalog 在同一个目录上选出同一个文件。
const same = makeCacheHome('same');
const sameGui = join(same.dir, 'acc-product-config-v3-21-uuid-a.json');
const sameCli = join(same.dir, 'acc-product-config-v3-21-uuid-b.json');
writeFileSync(sameGui, JSON.stringify(cachePromoDoc));
writeFileSync(sameCli, JSON.stringify(cacheCliDoc));
utimesSync(sameGui, new Date(Date.now() - 60e3), new Date(Date.now() - 60e3));
utimesSync(sameCli, new Date(Date.now() - 10e3), new Date(Date.now() - 10e3));
const samePick = pickCacheEntry([
  { path: sameCli, mtime: Date.now() - 10e3, text: JSON.stringify(cacheCliDoc) },
  { path: sameGui, mtime: Date.now() - 60e3, text: JSON.stringify(cachePromoDoc) },
]);
const sameRead = await readLocalCatalog({ dir: same.home });
ok(
  samePick?.path === sameGui && sameRead?.path === samePick?.path,
  'pickCacheEntry 与 readLocalCatalog 选中的是同一份（选择规则只有一套）',
  [samePick?.path, sameRead?.path],
);

// M5 最小复现：mainPid 与 running 都不变，只靠「缓存目录 mtime 变了」发现新目录。
const m5 = makeCacheHome('m5');
process.env.WORKBUDDY_CONFIG_DIR = m5.home;
const m5World = makeWorld(TOKEN_CLEARED);
m5World.host = { log: consoleLog };
m5World.ctx.cfg.localCatalogDelayMs = 1000;
m5World.started = true;
m5World.catalog = [{ id: 'gui-0' }];
m5World.promos = [{ id: 'night', modelIds: ['gui-0'], discount: { multiplier: 0.5 } }];
m5World.catalogAt = Date.now() - 3600e3;
m5World.catalogSource = 'v3-config';
m5World.proc = { running: true, pids: [11], mainPid: 11, via: 'tasklist', detail: '', at: Date.now() };
m5World.syncProc = async () => m5World.proc; // 进程状态逐字不变
await m5World._tick(); // 第一轮：只记基准
const m5Path = join(m5.dir, 'acc-product-config-v3-11-uuid.json');
writeFileSync(m5Path, JSON.stringify(cachePromoDoc));
// NTFS 的目录时间戳是懒更新的（同一次 stat 里可能还是旧值），这里显式设置一次，
// 等价于「写完文件后目录变更事件已经发生」，让断言只看复查逻辑、不看文件系统缓存。
utimesSync(m5.dir, new Date(), new Date());
ok(m5World.catalog.length === 1, 'M5：新缓存文件落盘前目录仍是旧的', m5World.catalog.length);
await m5World._tick(); // 第二轮：目录 mtime 变了
ok(m5World._localTimer !== null, 'M5：mainPid / running 都不变时，目录 mtime 变化仍会安排复查');
await new Promise((resolve) => setTimeout(resolve, 1300));
ok(
  m5World.catalog.length === 62 && m5World.catalogSource === 'local-cache',
  'M5：一次 tick + 延后读之后目录更新为本机缓存',
  [m5World.catalog.length, m5World.catalogSource],
);
ok(m5World.promos.length === 2, 'M5：改用本机缓存后促销照常挂上（不丢倍率）', m5World.promos.length);
await m5World.stop();

// catalogAt 被顶到未来（用户手动刷新过）时，复查不能因此失效——去重基准是独立的 _watchSeen。
const fut = makeCacheHome('fut');
process.env.WORKBUDDY_CONFIG_DIR = fut.home;
const futWorld = makeWorld(TOKEN_CLEARED);
futWorld.host = { log: consoleLog };
futWorld.ctx.cfg.localCatalogDelayMs = 1000;
futWorld.started = true;
futWorld.catalog = [{ id: 'disk' }];
futWorld.catalogAt = Date.now() + 7200e3;
futWorld.catalogSource = 'v3-config';
futWorld.proc = { running: true, pids: [12], mainPid: 12, via: 'tasklist', detail: '', at: Date.now() };
futWorld.syncProc = async () => futWorld.proc;
await futWorld._tick();
writeFileSync(join(fut.dir, 'acc-product-config-v3-12-uuid.json'), JSON.stringify(cachePromoDoc));
utimesSync(fut.dir, new Date(), new Date());
await futWorld._tick();
ok(
  futWorld._localTimer !== null,
  'catalogAt 在未来（手动刷新过）时复查仍然生效：去重基准与 catalogAt 解耦',
);
await futWorld.stop();
delete process.env.WORKBUDDY_CONFIG_DIR;

// S4-1：GUI 半写 + 上一轮完整目录 → 先不动，安排重试；写完后再读就采纳。
const s1 = makeCacheHome('s1');
process.env.WORKBUDDY_CONFIG_DIR = s1.home;
const s1World = makeWorld(TOKEN_CLEARED);
s1World.host = { log: consoleLog };
s1World.catalog = [{ id: 'disk-old' }];
s1World.promos = [{ id: 'night', modelIds: ['disk-old'], discount: { multiplier: 0.5 } }];
s1World.catalogAt = Date.now() - 3600e3;
s1World.catalogSource = 'v3-config';
const s1Path = join(s1.dir, 'acc-product-config-v3-13-uuid.json');
writeFileSync(s1Path, JSON.stringify(cachePromoDoc).slice(0, 220)); // 写了一半
await s1World.loadLocalCatalog();
ok(s1World.catalog.length === 1 && s1World.catalog[0]?.id === 'disk-old', 'S4-1：半写文件不覆盖上一轮的完整目录');
ok(
  s1World._localTimer !== null && [...s1World._parseRetry.values()][0] === 1,
  'S4-1：parse 失败的半写安排了一次延后重试（复用 3 秒延迟，不新建定时器）',
  [...s1World._parseRetry.values()],
);
if (s1World._localTimer !== null) clearTimeout(s1World._localTimer);
s1World._localTimer = null;
writeFileSync(s1Path, JSON.stringify(cachePromoDoc));
utimesSync(s1Path, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
await s1World.loadLocalCatalog();
ok(s1World.catalog.length === 62, 'S4-1：桌面端写完后重试读到完整目录', s1World.catalog.length);
await s1World.stop();

// S4-2/3：GUI 半写 + 只有 CLI 子集 → 质量闸门拒绝；catalogAt 不推进、重试计数也不增长。
const s2 = makeCacheHome('s2');
process.env.WORKBUDDY_CONFIG_DIR = s2.home;
const s2World = makeWorld(TOKEN_CLEARED);
s2World.host = { log: consoleLog };
s2World.catalog = [{ id: 'gui-0' }];
s2World.promos = [{ id: 'night', modelIds: ['gui-0'], discount: { multiplier: 0.5 } }];
s2World.catalogAt = Date.now() - 3600e3;
s2World.catalogSource = 'v3-config';
writeFileSync(join(s2.dir, 'acc-product-config-v3-14-uuid-gui.json'), JSON.stringify(cachePromoDoc).slice(0, 220));
writeFileSync(join(s2.dir, 'acc-product-config-v3-14-uuid-cli.json'), JSON.stringify(cacheCliDoc));
await s2World.loadLocalCatalog();
ok(
  s2World.catalog.length === 1 && s2World.promos.length === 1,
  'S4-2：只有 CLI 子集时质量闸门拒绝采纳（不污染完整目录）',
  [s2World.catalog.length, s2World.promos.length],
);
ok(s2World.hasCompleteCatalog() === true, 'S4-2：hasCompleteCatalog() 仍认为手上这份是完整的');
const s2At = s2World.catalogAt;
await s2World.loadLocalCatalog();
ok(
  s2World.catalogAt === s2At && s2World.catalog.length === 1 && s2World.promos.length === 1,
  'S4-3：质量闸门拒绝后第二轮仍不采纳（catalogAt / 目录 / 促销都不动，不会变成重读风暴）',
  [s2World.catalogAt, s2World.catalog.length, s2World.promos.length],
);
ok(
  s2World._localVerdict?.path === join(s2.dir, 'acc-product-config-v3-14-uuid-cli.json'),
  'S4-3：闸门拒绝按文件身份记指纹（path + 原始 mtime），重复判决由指纹挡住',
  s2World._localVerdict,
);
const s2Retries = s2World._parseRetry.size;
await s2World.loadLocalCatalog();
ok(
  s2World._parseRetry.size === s2Retries,
  'S4-3：第三轮不再新增半写重试（指纹早退，只保留那一份截断文件的一次重试）',
  [s2Retries, s2World._parseRetry.size],
);
await s2World.stop();

// S4-4：`{ name: 'missing-id' }` 在 0.3.10 的口径下**合法**（normalizeModel 认 id ?? model ?? name）。
// 这与 upstream 对服务器目录「逐条兜底取名、不整份作废」同形，是有意行为：
// 桩 world 手上只有一份无促销目录（hasCompleteCatalog() === false），会采纳它——
// 但采纳后仍是「1 个模型、无促销」，不是完整目录，也不会污染后续判断。
const s4 = makeCacheHome('s4');
process.env.WORKBUDDY_CONFIG_DIR = s4.home;
writeFileSync(join(s4.dir, 'acc-product-config-v3-15-uuid.json'), JSON.stringify({ models: [{ name: 'missing-id' }] }));
const s4World = makeWorld(TOKEN_CLEARED);
s4World.host = { log: consoleLog };
s4World.catalog = [{ id: 'disk-old' }];
s4World.catalogAt = Date.now() - 3600e3;
await s4World.loadLocalCatalog();
ok(
  s4World.catalog.length === 1 && s4World.catalog[0]?.id === 'missing-id',
  'S4-4：缺 id 但有 name 的文档按兜底取名（与 upstream 同口径，不再判 shape）',
  s4World.catalog,
);
ok(
  s4World._localTimer === null && s4World._parseRetry.size === 0,
  'S4-4：兜底取名是合法输入（shape 之外的原因不触发重试）',
  [s4World._localTimer, s4World._parseRetry.size],
);
await s4World.stop();
delete process.env.WORKBUDDY_CONFIG_DIR;

// S4-5（0.3.10）：全过滤光的文档仍判 shape、不重试。
const s5 = makeCacheHome('s5');
process.env.WORKBUDDY_CONFIG_DIR = s5.home;
writeFileSync(join(s5.dir, 'acc-product-config-v3-17-uuid.json'), JSON.stringify({ models: [null, 'x', 42] }));
const s5World = makeWorld(TOKEN_CLEARED);
s5World.host = { log: consoleLog };
s5World.catalog = [{ id: 'disk-old' }];
s5World.catalogAt = Date.now() - 3600e3;
await s5World.loadLocalCatalog();
ok(
  s5World.catalog.length === 1 && s5World.catalog[0]?.id === 'disk-old' && s5World._parseRetry.size === 0,
  'S4-5：模型条目全部无效时判 shape——整份作废、不重试、不覆盖现有目录',
  [s5World.catalog, s5World._parseRetry.size],
);
await s5World.stop();
delete process.env.WORKBUDDY_CONFIG_DIR;

// stop() 之后：在途的读不再采纳、不再落盘。
const st = makeCacheHome('stopped');
process.env.WORKBUDDY_CONFIG_DIR = st.home;
writeFileSync(join(st.dir, 'acc-product-config-v3-16-uuid.json'), JSON.stringify(cachePromoDoc));
const stopWorld = makeWorld(TOKEN_CLEARED);
stopWorld.host = { log: consoleLog };
stopWorld.catalog = [{ id: 'disk-old' }];
stopWorld.catalogAt = 0;
await stopWorld.stop();
await stopWorld.loadLocalCatalog();
ok(stopWorld.catalog.length === 1 && stopWorld.catalog[0]?.id === 'disk-old', 'stop() 之后不再采纳本地缓存（在途读被闸住）');
ok(!existsSync(stopWorld.catalogPath()), 'stop() 之后不再落盘（数据目录里没写出 catalog 文件）');
ok(stopWorld.scheduleLocalCatalog() === undefined && stopWorld._localTimer === null, 'stop() 之后不再排新的读盘任务');
delete process.env.WORKBUDDY_CONFIG_DIR;

/* --------------------------------------------------- 0.3.10 磁盘缓存与形状 */

console.log('· 0.3.10：磁盘缓存净化、判定同源、身份指纹、形状统一');

// ---- #2 loadCatalogFromDisk：只过滤不重写、promos 校验、at 钳制 ----
{
  const w = makeWorld(TOKEN_CLEARED);
  const warns = [];
  w.log.warn = (m) => warns.push(String(m));
  const dirty = [...cachePromoDoc.models, null, 'x', { name: 'fallback-name' }];
  writeFileSync(
    w.catalogPath(),
    JSON.stringify({
      at: Date.now() + 3600e3, // 未来时间：0.3.8 写出的「毒 at」
      source: 'v3-config',
      models: dirty,
      promos: [
        null,
        'x',
        { modelIds: 'no' },
        { id: 'ok', modelIds: ['gui-0'], discount: { discountedCredits: '0x', factor: 0, displayMode: 'strikethrough' } },
      ],
    }),
  );
  w.loadCatalogFromDisk();
  ok(
    w.catalog.length === 63 && w.catalog.some((m) => m?.id === 'fallback-name'),
    '#2 磁盘缓存里的坏模型条目逐条跳过，缺 id 的按 model/name 兜底取名',
    w.catalog.length,
  );
  ok(
    warns.some((m) => /无效模型条目/.test(m)),
    '#2 跳过的坏条目会留一行 warn（不再静默）',
    warns,
  );
  ok(w.promos.length === 1, '#2 脏促销条目被过滤，只留合法那条', w.promos.length);
  let usageOk = true;
  try {
    await w.usageState();
  } catch {
    usageOk = false;
  }
  ok(usageOk, '#2 过滤后 usageState() 不再因脏促销抛错');
  ok(
    w.catalogAt <= Date.now(),
    '#2 saved.at 读回时钳制到「不晚于现在」（0.3.8 的毒 at 不会让本地缓存永久失效）',
    w.catalogAt,
  );
}
{
  const w = makeWorld(TOKEN_CLEARED);
  const warns = [];
  w.log.warn = (m) => warns.push(String(m));
  writeFileSync(w.catalogPath(), '{ 这不是 JSON');
  w.loadCatalogFromDisk();
  ok(
    warns.some((m) => /磁盘目录缓存读取失败/.test(m)),
    '#2 读坏 JSON 时会留一行 warn（0.3.9 是全静默的 catch）',
    warns,
  );
}
{
  // 无损回归：合法目录读回后与写盘前逐字段一致。
  const w = makeWorld(TOKEN_CLEARED);
  writeFileSync(w.catalogPath(), JSON.stringify({ at: Date.now(), source: 'v3-config', models: cacheCliDoc.models, promos: [] }));
  w.loadCatalogFromDisk();
  ok(
    JSON.stringify(w.catalog) === JSON.stringify(cacheCliDoc.models),
    '#2 合法目录读写无损（只过滤不重写，promos / 额外字段不被 normalizeModel 抹掉）',
    [w.catalog.length, cacheCliDoc.models.length],
  );
}

// ---- #3 classifyCacheDoc 与过滤同源；world 层模型数闸门 ----
{
  const home = makeCacheHome('c310-mixed');
  writeFileSync(
    join(home.dir, 'acc-product-config-v3-31-uuid.json'),
    JSON.stringify({ models: [null, ...cachePromoDoc.models], modelPromotions: cachePromoDoc.modelPromotions, modelTiers: cachePromoDoc.modelTiers }),
  );
  const got = await readLocalCatalog({ dir: home.home });
  ok(
    got?.models.length === 62 && got?.promos.length === 2,
    '#3 混进脏条目的文档整体仍合法：脏条目落掉，62 个模型与促销都在',
    [got?.models.length, got?.promos.length],
  );
}
{
  const home = makeCacheHome('c310-name');
  writeFileSync(join(home.dir, 'acc-product-config-v3-32-uuid.json'), JSON.stringify({ models: [{ name: 'only-name' }] }));
  const got = await readLocalCatalog({ dir: home.home });
  ok(
    got?.models.length === 1 && got?.models[0]?.id === 'only-name',
    '#3 只有 name 的条目按兜底取名（与 upstream 同口径）',
    got?.models,
  );
}
{
  const home = makeCacheHome('c310-bad');
  writeFileSync(join(home.dir, 'acc-product-config-v3-33-uuid.json'), JSON.stringify({ models: [null, 'x', 42] }));
  const got = await readLocalCatalog({ dir: home.home });
  ok(
    got?.models.length === 0 && got?.skipped?.[0]?.reason === 'shape',
    '#3 全部条目都无效时才判 shape（整份作废、不重试）',
    [got?.models.length, got?.skipped?.[0]?.reason],
  );
}
{
  // B3 回归：1 模型 + 促销 的脏文档，mtime 更新，也顶不掉 62 模型的完整目录。
  const home = makeCacheHome('c310-b3');
  process.env.WORKBUDDY_CONFIG_DIR = home.home;
  const w = makeWorld(TOKEN_CLEARED);
  const warns = [];
  w.log.warn = (m) => warns.push(String(m));
  w.catalog = [...cachePromoDoc.models];
  w.promos = parsePromos(cachePromoDoc.modelPromotions, cachePromoDoc.modelTiers);
  w.catalogAt = Date.now() - 3600e3;
  w.catalogSource = 'v3-config';
  writeFileSync(
    join(home.dir, 'acc-product-config-v3-34-uuid.json'),
    JSON.stringify({
      models: [{ id: 'tiny', name: 'Tiny' }],
      modelPromotions: cachePromoDoc.modelPromotions,
      modelTiers: cachePromoDoc.modelTiers,
    }),
  );
  await w.loadLocalCatalog();
  ok(
    w.catalog.length === 62 && w.promos.length === 2,
    '#3 B3 回归：1 模型的脏文档不会顶掉 62 模型的完整目录',
    [w.catalog.length, w.promos.length],
  );
  const warned = warns.filter((m) => /少于现有/.test(m)).length;
  await w.loadLocalCatalog();
  ok(
    warned === 1 && warns.filter((m) => /少于现有/.test(m)).length === 1,
    '#3 模型数闸门对同一文件版本只 warn 一次（身份指纹生效）',
    warns,
  );
  await w.stop();
  delete process.env.WORKBUDDY_CONFIG_DIR;
}

// ---- #9 未来 mtime：每会话只采纳一次 ----
{
  const home = makeCacheHome('c310-future');
  process.env.WORKBUDDY_CONFIG_DIR = home.home;
  const w = makeWorld(TOKEN_CLEARED);
  w.log.warn = () => {};
  w.log.info = () => {};
  w.catalog = [{ id: 'disk-old' }];
  w.promos = [];
  w.catalogAt = Date.now() - 3600e3;
  w.catalogSource = 'v3-config';
  const futureMs = Date.now() + 7200e3;
  const filePath = join(home.dir, 'acc-product-config-v3-35-uuid.json');
  writeFileSync(filePath, JSON.stringify(cachePromoDoc));
  utimesSync(filePath, new Date(futureMs), new Date(futureMs));
  await w.loadLocalCatalog();
  const at1 = w.catalogAt;
  ok(
    w.catalog.length === 62 && at1 <= Date.now() && w._localVerdict?.mtime === futureMs,
    '#9 未来 mtime 仍按「更快照」采纳一次：catalogAt 钳到 now，指纹记原始 mtime',
    [at1, w._localVerdict?.mtime, futureMs],
  );
  await w.loadLocalCatalog();
  await w.loadLocalCatalog();
  ok(
    w.catalogAt === at1,
    '#9 同一个文件版本不再重复采纳（身份指纹挡住未来 mtime 回路）',
    [at1, w.catalogAt],
  );
  await w.stop();
  delete process.env.WORKBUDDY_CONFIG_DIR;
}

// ---- #4 候选文件用 lstat，符号链接不跟随（静态） ----
ok(/lstatSync/.test(lcSrc) && !/\bstatSync\s*\(/.test(lcSrc), '#4 localcatalog.js 用 lstatSync 扫描候选，符号链接不跟随');

// ---- #5 usage/state 的 catalogSource 与 models/state 同形 ----
{
  const w = makeWorld(TOKEN_CLEARED);
  w.catalog = [{ id: 'glm-5.2' }];
  w.catalogAt = Date.parse('2026-11-05T04:00:00Z');
  w.catalogSource = 'local-cache';
  w.localCatalogPath = 'C:/Users/x/.workbuddy/cache/acc-product-config-v3-1-u.json';
  const us = await w.usageState();
  ok(
    us.catalogSource && us.catalogSource.kind === 'local-cache' && /^本地缓存 · /.test(us.catalogSource.label),
    '#5 usage/state 的 catalogSource 也是 { kind, at, label, path }（与 models/state 同形）',
    us.catalogSource,
  );
}

// ---- #6 models/refresh 与 models/state 形状一致 ----
{
  const w = makeWorld(TOKEN_CLEARED);
  w.log.warn = () => {};
  w.proc = { running: true, pids: [7], mainPid: 7, via: 'test', detail: '', at: Date.now() };
  w.syncProc = async () => w.proc;
  w.ensureTokens = async () => ({ accessToken: 't' });
  w.upstream = () => ({
    fetchCatalog: async () => ({ models: cachePromoDoc.models, promos: parsePromos(cachePromoDoc.modelPromotions, cachePromoDoc.modelTiers), source: 'v3-config' }),
  });
  const res = await w.handleInvoke('models', 'refresh', [], 'zh');
  ok(
    res?.ok === true && Array.isArray(res.models) && res.models[0]?.safety && res.models[0]?.price,
    '#6 models/refresh 返回的模型与 models/state 同形（带 safety / price）',
    [res?.ok, res?.models?.[0]?.safety, res?.models?.[0]?.price],
  );
  await w.stop();
}

// ---- #8 reinstall.ps1 不再有手工 tar 兜底（静态） ----
{
  const ps = readFileSync(join(pkgDir, 'scripts/reinstall.ps1'), 'utf8');
  ok(!/tar\s+-czf/.test(ps), '#8 reinstall.ps1 删掉了手工 tar 兜底（不会再绕过 prepack）');
  ok(/Fail "npm pack 失败/.test(ps), '#8 npm pack 失败时直接 Fail 退出，不静默降级');
}

// ---- #10 verify-ui.json 的版本跟包版本一致 ----
{
  const visual = JSON.parse(readFileSync(join(pkgDir, 'scripts/visual/verify-ui.json'), 'utf8'));
  ok(visual.version === pkg.version, '#10 verify-ui.json 的 version 与 package.json 一致', [visual.version, pkg.version]);
}

// ---- 0.3.11：三条新界面窗口断言的静态防线 ----
// 0.3.10 的教训是「检查机制修好了，但新界面一个断言都没接上」。这里直接从源码里读
// REQUIRED_CHECKS 清单，防止以后有人把新键删掉又悄悄回到「11 个旧键全绿」。
{
  console.log('· 0.3.11：新界面窗口断言的静态防线');
  const ui = readFileSync(join(pkgDir, 'scripts/verify-ui.mjs'), 'utf8');
  const list = ui.match(/const REQUIRED_CHECKS = \[([\s\S]*?)\];/);
  ok(!!list, 'verify-ui.mjs 里能找到 REQUIRED_CHECKS 清单', list ? 'found' : 'missing');
  const keys = list ? [...list[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]) : [];
  for (const name of ['modelsSourceChip', 'refreshDisabledMatchesProc', 'accountCreditsButton']) {
    ok(keys.includes(name), `REQUIRED_CHECKS 含 0.3.11 新键 ${name}`, keys.join(','));
    ok(new RegExp(`row\\.checks\\.${name} =`).test(ui), `${name} 只在判据通过后置 true`, name);
  }
  ok(!/META_KEYS/.test(ui), 'verify-ui.mjs 里没有未使用的 META_KEYS 死常量', 'META_KEYS');
  ok(/const sourceChip = await waitFor\(/.test(ui), '来源芯片用 waitFor 等它出现', 'sourceChip');
  ok(/refreshBtn\.disabled !== !panelState\.running/.test(ui), '刷新按钮断言跨来源比较（DOM disabled vs state.running）', 'cross-source');
  ok(/row\.checks\.modelsProcessChip =\s*procText ===/.test(ui), '主进程芯片改为 DOM 文本与 state 比对，不再是同义反复', 'procChip');
  ok(/row\.checks\.usageRendered = usage\.hasRefresh === true/.test(ui), 'usageRendered 判据包含可失败的渲染质量', 'usageRendered');
  ok(/row\.checks\.modelsPolicyColumn = modelsView\.hasPolicy === true/.test(ui), 'modelsPolicyColumn 判据可失败', 'policyColumn');
}


// 配置组每个键都必须在 WB_DEFAULTS 里有默认值（config.js 自己写的规范，之前一直没校验）。
console.log('· 配置组与默认值');
const CFG_PREFIX = 'worlds.workbuddy.';
for (const key of Object.keys(WB_CONFIG_GROUP.schema.properties)) {
  const name = key.startsWith(CFG_PREFIX) ? key.slice(CFG_PREFIX.length) : key;
  ok(key.startsWith(CFG_PREFIX), `配置项 ${key} 落在 worlds.workbuddy. 段内`, key);
  ok(
    Object.prototype.hasOwnProperty.call(WB_DEFAULTS, name),
    `配置项 ${key} 在 WB_DEFAULTS 里有默认值`,
    name,
  );
}

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
/* --------------------------------------------------------- 0.3.12：/wb 自查 */

console.log('· /wb 自查');
{
  const wbWorld = makeWorld(TOKEN_CLEARED);
  const wbDecl = wbWorld.tools().find((t) => t.name === 'wb_selfcheck');
  ok(!!wbDecl, '/wb：wb_selfcheck 工具已注册', wbWorld.tools().map((t) => t.name));
  ok(
    ['status', 'logs', 'models'].every((a) => wbDecl?.parameters?.properties?.action?.enum?.includes(a)),
    '/wb：action 声明了 status / logs / models',
    wbDecl?.parameters?.properties?.action?.enum,
  );

  const secretToken = 'sekret-token-0-3-12-should-never-show';
  wbWorld.tokens = { accessToken: secretToken, source: 'manual' };
  wbWorld.proc = { running: true, mainPid: 4321 };
  wbWorld.catalog = [
    normalizeModel({ id: 'hy4std', name: 'Hy4', credits: 'x0.29' }),
    normalizeModel({ id: 'hy4-preview-ctrl', name: 'Hy4 ctrl', credits: 'x1' }),
  ];
  wbWorld.catalogAt = Date.parse('2026-11-05T12:00:00+08:00');
  wbWorld.catalogSource = 'local-cache';
  wbWorld.localCatalogPath = 'C:\\fake\\acc-product-config-v3-1-u.json';

  const table = wbWorld.toolWb({});
  const tableLines = [
    '主进程',
    'mainPid 4321',
    '面板手动粘贴',
    '目录来源',
    '安全清单',
    '本地缓存',
    '上次刷新',
    '当前模型',
    '今日积分',
  ];
  const missingParts = tableLines.filter((part) => !table.includes(part));
  ok(missingParts.length === 0, '/wb：状态表含主进程 / 登录态 / 目录来源 / 安全清单 / 缓存 / 刷新 / 模型 / 积分', missingParts);
  ok(!table.includes(secretToken), '/wb：状态表不打印 token', table);
  ok(
    table.includes('安全清单：1 个可调用 / 2 个'),
    '/wb：安全清单计数按 classifyModel 口径（实验号不计入可调用）',
    table.split('\n').find((l) => l.startsWith('安全清单')),
  );

  const noLog = readRecentWorldLogs({ candidates: [join(tmpdir(), 'wb-no-such-dir', 'core.log')] });
  ok(noLog.ok === false && /找不到 core.log/.test(String(noLog.error)), '/wb logs：没有日志文件时返回 ok:false 而不是抛错', noLog);
  const logsText = wbWorld.toolWb({ action: 'logs' });
  ok(
    typeof logsText === 'string' && /^(读不到 WorkBuddy 日志|最近没有 worlds\.workbuddy|最近 \d+ 条 WorkBuddy 日志)/.test(logsText),
    '/wb logs：工具分支总会给出一句可读的结果，不抛错',
    logsText.slice(0, 80),
  );

  const modelsText = wbWorld.toolWb({ action: 'models' });
  ok(modelsText.includes('积分倍率') && modelsText.includes('hy4std'), '/wb models：列出可调用模型与倍率', modelsText.slice(0, 200));

  ok(wbWorld.toolWb({ action: 'nonsense' }) === wbWorld.statusText(), '/wb：未知 action 回落成状态表');
}



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
