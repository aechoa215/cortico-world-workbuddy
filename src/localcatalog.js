/**
 * WorkBuddy 桌面端的本地目录缓存（0.3.7 起）。
 *
 * 桌面端每次启动都会把 /v3/config 的原文落到
 * `<配置目录>/cache/acc-product-config-v3-<pid>-<uuid>.json`，里面的
 * `models` / `modelPromotions` / `modelTiers` 字段名与本扩展解析上游时完全一致，
 * 所以这里只负责「找文件 + 挑对那份 + 复用 normalizeModel / parsePromos」，
 * 不再重复实现一遍解析。
 *
 * 为什么需要「挑」：桌面端每次启动写两份——一份 62 个模型带促销（GUI 主通道），
 * 一份 58 个模型、0 条促销（CLI 通道子集）。两份都结构合法，只按 mtime 取最新
 * 有时会撞上子集（倍率与限时折扣会整段丢失），所以选择规则是「优先带促销的那份」。
 *
 * 0.3.9：读文件改成异步（`node:fs/promises` 的 readFile + AbortSignal），并给整次扫描
 * 一个总时限；`readdir` / `lstat` 保持同步——它们实测只要 0.2–0.3 ms，保持扫描的原子性，
 * 也不用把成百上千个请求塞进 libuv 线程池（默认 4 线程，会和宿主自己的 IO 抢）。
 * 跳过的候选通过 `skipped[]` 交回 world 层，由它决定要不要重试（见 world.loadLocalCatalog）。
 *
 * 0.3.10：`statSync` → `lstatSync`——缓存目录里指向网络盘 / 重解析点的符号链接不再被跟随，
 * 也不会因为一次 stat 挂住整次扫描（`isFile()` 对链接项为 false，自然跳过）。
 */
import { lstatSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { attachPromos, parsePromos } from './promo.js';
import { normalizeModel } from './upstream.js';

const CACHE_PREFIX = 'acc-product-config-v3-';
const CACHE_SUFFIX = '.json';
/** 桌面端的模板文件（`...-tpl-...json`）不是配置，扫到要跳过。 */
const TPL_MARK = '-tpl-';
/**
 * 单份缓存文件的大小上限。
 *
 * 正常一份 62 模型的 GUI 文档是几百 KB；超过 8 MB 基本只有两种可能——桌面端写坏了，
 * 或者磁盘上被人塞了别的东西。这种文件不参与选择，免得一次 readFile 吃掉几十 MB。
 */
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
/**
 * 整次扫描的总时限（0.3.9）。
 *
 * 注意是**整次扫描**一个预算，不是「每文件 N 秒」——后者在最坏情况下会累积一堆悬挂读，
 * 长期占住 libuv 线程池，反而拖慢宿主自己的 IO。到点就 abort 掉在途的 readFile、
 * 停止继续读后面的候选；已经读到的仍然照常参与选择。
 */
const DEFAULT_SCAN_TIMEOUT_MS = 5000;

/** WorkBuddy 配置目录：环境变量优先，否则 `~/.workbuddy`。 */
export function resolveConfigDir() {
  const env = process.env.WORKBUDDY_CONFIG_DIR?.trim();
  return env || join(homedir(), '.workbuddy');
}

/** 本地缓存目录：`<配置目录>/cache`。 */
export function cacheDirOf(dir = resolveConfigDir()) {
  return join(dir, 'cache');
}

/**
 * 列出候选缓存文件，按 mtime 从新到旧。
 * 只做文件系统的事，不做内容判断（保持同步：实测 19 份约 0.2–0.3 ms）。
 * @param {string} [dir] WorkBuddy 配置目录
 * @returns {Array<{ path: string, mtime: number, size: number }>}
 */
export function listCacheFiles(dir = resolveConfigDir()) {
  const cacheDir = cacheDirOf(dir);
  let names;
  try {
    names = readdirSync(cacheDir);
  } catch {
    // 目录不存在 / 无权访问：当作没有缓存，由调用方决定是否回落到磁盘目录。
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.startsWith(CACHE_PREFIX) || !name.endsWith(CACHE_SUFFIX)) continue;
    if (name.includes(TPL_MARK)) continue;
    const path = join(cacheDir, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile()) continue;
      out.push({ path, mtime: st.mtimeMs, size: st.size });
    } catch {
      /* 扫描期间被删掉：跳过 */
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * 判一份缓存文档合不合法、带不带促销。**纯函数**，只吃文本。
 *
 * 与 `parseCacheDoc()` 的区别只有一个：它把「不合法」的原因分开了——
 * 0.3.9 的重试策略要靠这个原因区分「桌面端还没写完（parse，可重试）」与
 * 「命名合规但内容不是配置（shape，永久性，不重试）」。
 *
 * 0.3.10：判定与过滤同源——逐条模型用 upstream 的 `normalizeModel` 当谓词（它认
 * `id ?? model ?? name`），坏条目在这里就丢掉，**全部丢光**才判 shape。以前要求
 * 「每个模型都有 string id」，一条 `{ model: 'x' }` 脏数据就能废掉整份 62 模型的
 * 合法缓存，而下游 `buildCatalog()` 本来就是逐条过滤——严苛检查在宽松过滤之前，
 * 纯口径漂移。返回的 `doc.models` 已经是干净数组（缺 id 的按兜底取名补齐），
 * 所以 `buildCatalog()` 里的 map/filter 对它是恒等操作。
 *
 * @param {unknown} text
 * @returns {{ doc: object, withPromos: boolean } | { reason: 'parse' | 'shape' }}
 */
export function classifyCacheDoc(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { reason: 'parse' }; // 坏 JSON / 桌面端写了一半
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { reason: 'shape' };
  if (!Array.isArray(doc.models) || doc.models.length === 0) return { reason: 'shape' };
  const models = [];
  for (const m of doc.models) {
    if (normalizeModel(m) === null) continue;
    // 通过谓词但没写 `id` 的条目：补一个兜底 id，下游面板与 classifyModel 都按 id 找模型。
    models.push(m.id == null ? { ...m, id: m.model ?? m.name } : m);
  }
  if (models.length === 0) return { reason: 'shape' };
  return {
    doc: { ...doc, models },
    withPromos: Array.isArray(doc.modelPromotions) && doc.modelPromotions.length > 0,
  };
}

/**
 * 解析并校验单份缓存文档。**纯函数**：只吃文本，便于单测。
 *
 * 入选条件：JSON 能解析、是对象、`models` 是非空数组，且至少有一条模型能被
 * `normalizeModel` 解析（`id ?? model ?? name` 有非空 string）；脏条目逐条丢掉。
 *
 * @param {unknown} text
 * @returns {{ doc: object, withPromos: boolean } | null}
 */
export function parseCacheDoc(text) {
  const parsed = classifyCacheDoc(text);
  return 'reason' in parsed ? null : parsed;
}

/**
 * 选择顺序（0.3.9 起由 `pickCacheEntry()` 与 `readLocalCatalog()` 共用，防止两套规则漂移）：
 * 带非空 `modelPromotions` 的那份优先，其次才是列表里的第一份（列表本身按 mtime 倒序）。
 *
 * @param {Array<{ withPromos?: boolean }>} entries
 * @returns {any | null}
 */
export function preferPromo(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.find((e) => e?.withPromos) ?? list[0] ?? null;
}

/**
 * 挑出该用哪份缓存。**纯函数**：不碰文件系统，便于单测。
 *
 * @param {Array<{ path?: string, mtime: number, text: string }>} entries 已按 mtime 倒序
 * @returns {{ path?: string, mtime: number, doc: object, withPromos: boolean } | null}
 */
export function pickCacheEntry(entries) {
  const valid = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parsed = parseCacheDoc(entry?.text);
    if (parsed === null) continue;
    valid.push({ path: entry.path, mtime: Number(entry.mtime) || 0, ...parsed });
  }
  return preferPromo(valid);
}

/** 把选中的那份拼成 world 层的目录（models 已挂促销）。 */
function buildCatalog(picked) {
  const doc = picked.doc;
  const promos = parsePromos(doc.modelPromotions, doc.modelTiers);
  const models = attachPromos(
    doc.models.map((m) => normalizeModel(m)).filter((m) => m !== null),
    promos,
  );
  return {
    models,
    promos,
    tiers: Array.isArray(doc.modelTiers) ? doc.modelTiers : [],
    mtime: picked.mtime,
    path: picked.path ?? '',
  };
}

/**
 * 读本地缓存目录，返回规范化后的目录；一个文件都没扫到时返回 null（扫到文件但都不合法时
 * 返回 models 为空的壳，带上 skipped，供 world 层决定是否重试）。
 *
 * 产出与 upstream.fetchCatalog() 同形（models 已挂促销），这样 world 里「谁新用谁」
 * 只比时间戳，不关心目录是从哪条路来的。
 *
 * 0.3.9：按 mtime 倒序**逐个异步读、命中即返回**（带促销的那份通常就是最新的一两份，
 * 正常路径只读 1–2 次）；跳过的候选全部记进 `skipped[]`，原因分 `parse` / `shape` / `io`，
 * 由 world 层决定重试策略。整次扫描共享一个总时限（默认 5 秒，可用 `timeoutMs` 覆盖）。
 *
 * @param {{ dir?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{
 *   models: object[], promos: object[], tiers: object[], mtime: number, path: string,
 *   skipped: Array<{ path: string, mtime: number, size: number, reason: 'parse' | 'shape' | 'io' }>,
 * } | null>}
 */
export async function readLocalCatalog(opts = {}) {
  const files = listCacheFiles(opts.dir);
  const skipped = [];
  const valid = [];
  const asked = Number(opts.timeoutMs);
  const timeoutMs = Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_SCAN_TIMEOUT_MS;

  // 总时限：到点 abort 掉在途的 readFile，真取消而不是等它自己读完。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    for (const file of files) {
      if (controller.signal.aborted) break;
      if (Number(file.size) > MAX_CACHE_BYTES) {
        skipped.push({ ...file, reason: 'shape' });
        continue;
      }
      let text;
      try {
        text = await readFile(file.path, 'utf8', { signal: controller.signal });
      } catch {
        // 超时（AbortError）/ 权限 / 扫描期间被删：都算 io，不重试。
        skipped.push({ path: file.path, mtime: file.mtime, size: file.size, reason: 'io' });
        if (controller.signal.aborted) break;
        continue;
      }
      if (controller.signal.aborted) {
        skipped.push({ path: file.path, mtime: file.mtime, size: file.size, reason: 'io' });
        break;
      }
      const parsed = classifyCacheDoc(text);
      if ('reason' in parsed) {
        skipped.push({ path: file.path, mtime: file.mtime, size: file.size, reason: parsed.reason });
        continue;
      }
      valid.push({
        path: file.path,
        mtime: file.mtime,
        size: file.size,
        doc: parsed.doc,
        withPromos: parsed.withPromos,
      });
      if (preferPromo(valid)?.withPromos) break; // 已经拿到带促销的那份，不必再读更旧的
    }
  } finally {
    clearTimeout(timer);
  }

  const picked = preferPromo(valid);
  if (picked === null) {
    // 一个候选都不合法、但确实扫到过文件：仍把 `skipped` 交回去（models 为空），
    // 否则「唯一那份正在被桌面端半写」这件事在 world 层完全看不见，也就没机会重试。
    if (skipped.length === 0) return null;
    return { models: [], promos: [], tiers: [], mtime: 0, path: '', skipped };
  }
  return { ...buildCatalog(picked), skipped };
}
