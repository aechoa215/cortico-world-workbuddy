/**
 * 本地用量账本。
 *
 * 目的：WorkBuddy 的服务端只给「余额 / 每个套餐已用多少」，没有按模型、按小时的调用明细；
 * 而 Coopanion 的「用量与成本」页要的正是「今天几次、多少 token、多少积分、哪个模型」。
 * 所以每次真实调用都在本地记一行 JSONL，界面上按区间聚合。
 *
 * 记账口径（每一列都有明确来源，绝不估算）：
 *   - tokens：来自上游 SSE 最后一段的 `usage`（prompt/completion/total/cached/reasoning）；
 *   - credit：同一段的 `usage.credit`，即上游**实际扣的积分**（可能为 0，例如倍率 0.11
 *     的模型单次调用不足 1 分，上游就是记 0，这里照抄）；
 *   - multiplier：调用当时该模型生效的倍率（含限时折扣），用于「按倍率折算」的参考列。
 *
 * 文件：`<dataDir>/workbuddy-usage.jsonl`（只追加；超过 90 天的行在写入时顺带裁掉）。
 * 余额快照：`<dataDir>/workbuddy-balance.json`（服务端余额 + 采样时间）。
 */

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const USAGE_FILE = 'workbuddy-usage.jsonl';
export const BALANCE_FILE = 'workbuddy-balance.json';

/** 账本保留天数（超过就从文件里裁掉，避免无限增长）。 */
const RETENTION_DAYS = 90;
/** 单次读取上限，避免文件异常变大时把内存吃光。 */
const MAX_LINES = 20000;

export class UsageLedger {
  /**
   * @param {{ dataDir: string, log?: { warn(msg: string): void } }} opts
   */
  constructor(opts) {
    this.dir = opts.dataDir;
    this.log = opts.log ?? { warn: () => {} };
    /**
     * 写操作队列。
     *
     * append() 是「追加」、prune()/clear() 是「整文件重写」。两者并发时，重写会把
     * 刚追加进去的那行覆盖掉。这里把三种写操作串成一条链，读操作不排队（读到的
     * 是最近一次落盘的内容即可）。
     * @type {Promise<unknown>}
     */
    this._queue = Promise.resolve();
  }

  /** 串行执行一次写操作；前一次失败不影响后一次。 */
  _withLock(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 原子替换账本文件（先写临时文件再 rename，进程中途被杀也不会留下半个文件）。 */
  async _replace(text) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, this.path);
  }

  get path() {
    return join(this.dir, USAGE_FILE);
  }

  get balancePath() {
    return join(this.dir, BALANCE_FILE);
  }

  /**
   * 追加一条调用记录。
   * @param {{
   *   ts?: number, model: string, region?: string, ok?: boolean, error?: string,
   *   promptTokens?: number, completionTokens?: number, totalTokens?: number,
   *   cachedTokens?: number, reasoningTokens?: number, credit?: number | null,
   *   multiplier?: number | null, promoId?: string, source?: string, durationMs?: number,
   * }} entry
   */
  async append(entry) {
    const record = {
      ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
      model: String(entry.model ?? '—'),
      region: entry.region,
      ok: entry.ok !== false,
      ...(entry.error === undefined ? {} : { error: String(entry.error).slice(0, 300) }),
      ...num('promptTokens', entry.promptTokens),
      ...num('completionTokens', entry.completionTokens),
      ...num('totalTokens', entry.totalTokens),
      ...num('cachedTokens', entry.cachedTokens),
      ...num('reasoningTokens', entry.reasoningTokens),
      ...(typeof entry.credit === 'number' && Number.isFinite(entry.credit) ? { credit: entry.credit } : {}),
      ...(typeof entry.multiplier === 'number' && Number.isFinite(entry.multiplier)
        ? { multiplier: entry.multiplier }
        : {}),
      ...(entry.promoId === undefined ? {} : { promoId: String(entry.promoId) }),
      ...(entry.source === undefined ? {} : { source: String(entry.source) }),
      ...num('durationMs', entry.durationMs),
    };
    try {
      await this._withLock(async () => {
        await mkdir(this.dir, { recursive: true });
        await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8');
      });
    } catch (err) {
      this.log.warn?.(`写用量账本失败：${err?.message ?? err}`);
    }
    return record;
  }

  /** 读全部记录（读坏了就当空账本，绝不因为账本问题让对话失败）。 */
  async readAll() {
    try {
      const text = await readFile(this.path, 'utf8');
      const out = [];
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const rec = JSON.parse(line);
          if (rec && typeof rec === 'object' && typeof rec.ts === 'number') out.push(rec);
        } catch {
          // 单行坏了只跳过这一行
        }
      }
      if (out.length > MAX_LINES) out.splice(0, out.length - MAX_LINES);
      return out;
    } catch (err) {
      if (err?.code !== 'ENOENT') this.log.warn?.(`读用量账本失败：${err?.message ?? err}`);
      return [];
    }
  }

  /** 清空账本（面板上的「清空」按钮）。 */
  async clear() {
    try {
      await this._withLock(() => this._replace(''));
      return true;
    } catch (err) {
      this.log.warn?.(`清空用量账本失败：${err?.message ?? err}`);
      return false;
    }
  }

  /** 裁掉超过保留期的行（写入后顺带调用一次，失败只记日志）。 */
  async prune(nowMs = Date.now()) {
    const cutoff = nowMs - RETENTION_DAYS * 864e5;
    try {
      return await this._withLock(async () => {
        const text = await readFile(this.path, 'utf8');
        const kept = text
          .split('\n')
          .filter((line) => {
            if (line.trim() === '') return false;
            try {
              const rec = JSON.parse(line);
              return typeof rec?.ts === 'number' && rec.ts >= cutoff;
            } catch {
              return false;
            }
          })
          .join('\n');
        const next = kept === '' ? '' : `${kept}\n`;
        await this._replace(next);
        return true;
      });
    } catch (err) {
      if (err?.code !== 'ENOENT') this.log.warn?.(`裁剪账本失败：${err?.message ?? err}`);
      return false;
    }
  }

  /** 最近一次成功读到的服务端余额（用于「上次同步」与离线展示）。 */
  async readBalance() {
    try {
      const text = await readFile(this.balancePath, 'utf8');
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /** 写入余额快照（先写临时文件再改名，避免半截 JSON）。 */
  async writeBalance(snapshot) {
    try {
      await mkdir(dirname(this.balancePath), { recursive: true });
      const tmp = join(this.dir, `${BALANCE_FILE}.tmp`);
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(tmp, this.balancePath);
      return true;
    } catch (err) {
      this.log.warn?.(`写余额快照失败：${err?.message ?? err}`);
      return false;
    }
  }
}

/**
 * 把记录聚合成面板要的形状。
 *
 * @param {Array<{ts:number, model:string, ok?:boolean, credit?:number, promptTokens?:number, completionTokens?:number, totalTokens?:number, cachedTokens?:number, reasoningTokens?:number}>} records
 * @param {number} nowMs
 * @param {{ days?: number }} [opts]
 */
export function summarize(records, nowMs, opts = {}) {
  const windowDays = opts.days ?? 30;
  const startOfToday = startOfDay(nowMs);
  const windows = {
    today: startOfToday,
    week: startOfToday - 6 * 864e5,
    month: startOfToday - 29 * 864e5,
    all: 0,
  };

  const totals = {};
  for (const [key, from] of Object.entries(windows)) totals[key] = emptyTotals();

  /** 按模型聚合（近 N 天）。 */
  const byModel = new Map();
  /** 按天聚合（近 N 天，用于迷你趋势）。 */
  const byDay = new Map();

  for (const rec of records) {
    const credit = numberOr(rec.credit, 0);
    const prompt = numberOr(rec.promptTokens, 0);
    const completion = numberOr(rec.completionTokens, 0);
    const total = numberOr(rec.totalTokens, prompt + completion);
    const cached = numberOr(rec.cachedTokens, 0);
    const reasoning = numberOr(rec.reasoningTokens, 0);
    const ok = rec.ok !== false;

    for (const [key, from] of Object.entries(windows)) {
      if (rec.ts < from) continue;
      accumulate(totals[key], { credit, prompt, completion, total, cached, reasoning, ok });
    }

    if (rec.ts < windows.month) continue;
    const m = byModel.get(rec.model) ?? { model: rec.model, ...emptyTotals() };
    accumulate(m, { credit, prompt, completion, total, cached, reasoning, ok });
    byModel.set(rec.model, m);

    const day = dayKey(rec.ts);
    const d = byDay.get(day) ?? { day, ...emptyTotals() };
    accumulate(d, { credit, prompt, completion, total, cached, reasoning, ok });
    byDay.set(day, d);
  }

  const modelRows = [...byModel.values()].sort((a, b) => b.credit - a.credit || b.total - a.total);
  const dayRows = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const recent = [...records]
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    .slice(0, 15)
    .map((rec) => ({
    ts: rec.ts,
    model: rec.model,
    ok: rec.ok !== false,
    credit: numberOr(rec.credit, 0),
    total: numberOr(rec.totalTokens, numberOr(rec.promptTokens, 0) + numberOr(rec.completionTokens, 0)),
    prompt: numberOr(rec.promptTokens, 0),
    completion: numberOr(rec.completionTokens, 0),
    multiplier: rec.multiplier,
    durationMs: rec.durationMs,
  }));

  const spanDays = Math.max(1, Math.ceil((nowMs - startOfToday) / 864e5) + 1);
  return {
    windowDays,
    spanDays,
    totals,
    byModel: modelRows.slice(0, 10),
    byDay: dayRows.slice(-Math.max(7, Math.min(30, windowDays))),
    recent,
    recordCount: records.length,
  };
}

function emptyTotals() {
  return { calls: 0, failed: 0, credit: 0, prompt: 0, completion: 0, total: 0, cached: 0, reasoning: 0 };
}

function accumulate(target, v) {
  target.calls += 1;
  if (!v.ok) target.failed += 1;
  target.credit += v.credit;
  target.prompt += v.prompt;
  target.completion += v.completion;
  target.total += v.total;
  target.cached += v.cached;
  target.reasoning += v.reasoning;
}

function num(key, value) {
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
