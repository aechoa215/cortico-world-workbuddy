/**
 * WorkBuddy 上游客户端：模型目录、积分余额、chat completions 流式、token 刷新。
 *
 * 协议参照 dsh-connect-workbuddy（MIT）与 workbuddy2api（MIT）的实测结论：
 *  - 模型目录：GET  /v2/enterprises/personal/models（WorkBuddy网关；
 *    每个模型条目带 id / name / maxInputTokens / maxOutputTokens /
 *    credits（积分倍率字符串，如 "x0.79"）/ supportsImages / reasoning 等）
 *  - 对话：    POST /v2/chat/completions，强制 stream:true，SSE 回包
 *  - 登录态：  token 失效时重新从本机凭据发现（桌面端自己刷新落盘）；本模块不做
 *    自动刷新，chat 请求绝不携带 refresh token（安全红线）
 *  - 归属头：  X-IDE-Name / X-IDE-Type / X-Product = WorkBuddy，让用量页
 *    把这笔调用记成官方客户端发的
 *
 * 注意：这些是 WorkBuddy 客户端自身接口（非官方开放 API），上游调整时
 * 本模块可能需要跟着调整；解析一律宽容，缺字段留空，不虚构。
 */

import { attachPromos, parsePromos } from './promo.js';

/** WorkBuddy 客户端的官方上游域名。本扩展只支持这一套上游。 */
export const WB_BASE = 'https://copilot.tencent.com';

const MODELS_PATH = '/v2/enterprises/personal/models';
/**
 * 产品配置文档：模型目录 + 价格 + **促销徽标**（`modelPromotions` / `modelTiers`）。
 *
 * 实测（2026-11-03 CN）：用它读到的文档和 WorkBuddy 应用自己读的是同一份，比旧的
 * `/v2/enterprises/personal/models` 多出促销信息，模型条目字段完全兼容，所以现在优先
 * 读它、失败再退回旧路径（拿不到促销时只是没有折扣信息，不影响调用）。
 */
const CONFIG_PATH = '/v3/config';
const CHAT_PATH = '/v2/chat/completions';
/**
 * 计费域积分读数（官方客户端「套餐与积分」页同族接口；失败时优雅降级）。
 *
 * 注意两点（实机实测）：
 *  - 它在**计费域**，不在 chat 域：国内是 https://www.codebuddy.cn，
 *    打 copilot.tencent.com 上的同一路径只会拿到 404 page not found。
 *  - 它是 POST + 套餐分页请求，不是 GET；响应在 data.Response.Data.Accounts。
 * 路径来自 dsh-connect-workbuddy 5.17.0 的 billingBase()/get-user-resource。
 */
const CREDITS_PATH = '/v2/billing/meter/get-user-resource';
/** 计费域（积分/签到/福利）根地址。 */
const WB_BILLING_BASE = 'https://www.codebuddy.cn';

const PRODUCT_UA = 'WorkBuddy/2.63.2';
/**
 * 产品配置通道的 User-Agent —— 必须是**应用**身份而不是 CLI 身份。
 *
 * 实测（2026-11-03，同一 token、同一 URL，只改这一个头）：
 *   - `CLI/2.63.2 CodeBuddy/2.63.2`          → 文档里没有 modelPromotions / modelTiers；
 *   - `WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0` → 60 个模型 + 5 条促销 + 1 条会员档位。
 * 也就是说「促销读不到」曾经不是上游没发布，而是请求冒充了不发布它的通道。
 */
const APP_CHANNEL_UA = 'WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0';

export class WbUpstreamError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: number, kind?: string }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'WbUpstreamError';
    this.status = info.status ?? 0;
    this.code = info.code;
    this.kind = info.kind ?? 'server';
  }
}

/** 公共请求头：认证 + 官方客户端归属。绝不在这里放 refresh token。 */
function commonHeaders(cred, extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': `CLI/2.63.2 CodeBuddy/2.63.2`,
    'X-Requested-With': 'XMLHttpRequest',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Type': 'CLI',
    'X-Product': 'WorkBuddy',
    'X-Product-Version': '2.63.2',
    Authorization: `Bearer ${cred.accessToken}`,
    ...extra,
  };
}

export class WbUpstream {
  /**
   * @param {{ baseUrl: string, log?: { warn(msg: string): void } }} opts
   */
  constructor(opts) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/+$/, '');
    /** 用户显式配置了 baseUrl（代理 / 镜像）：计费请求也走它。 */
    this.customBase = Boolean(this.baseUrl) && this.baseUrl !== WB_BASE;
    this.log = opts.log ?? { warn: () => {} };
  }

  url(path) {
    return `${this.baseUrl}${path}`;
  }

  /**
   * 计费域的完整地址（积分、签到、福利都在这边，和 chat 域不同）。
   *
   * 没配 `baseUrl` 时用官方计费域；配了自定义 baseUrl（代理/镜像）就跟着走同一个出口，
   * 否则 chat 走代理、积分直连官方域名，代理用户的网络与隐私假设会被打破。
   */
  billingUrl(path) {
    return `${this.customBase ? this.baseUrl : WB_BILLING_BASE}${path}`;
  }

  /**
   * 读取模型目录 + 促销（同一个文档）。
   *
   * 返回 `{ models, promos, source }`：
   *   - `models` 已把促销挂到各自条目上（`model.promos`，未解析生效与否）；
   *   - `promos` 是归一化后的促销列表，供「限时优惠」面板直接展示；
   *   - `source` 是 `'v3-config'` 或 `'legacy'`（后者没有促销）。
   *
   * 读 `/v3/config` 用应用身份（见 APP_CHANNEL_UA）；它失败、非 0 或解析不出模型时，
   * 退回旧目录路径，保证「目录失败」不会连带把对话一起弄坏。
   * @param {{ accessToken: string }} cred
   */
  async fetchCatalog(cred) {
    // 每次请求重新判定：认证失败标记留在实例上会污染后续请求（同一个 WbUpstream
    // 被复用时，上一次的 401 会让下一次成功请求也被判成登录态失效）。
    this._authFailed = false;
    this._authStatus = 0;
    try {
      const res = await fetch(this.url(CONFIG_PATH), {
        method: 'GET',
        headers: {
          ...commonHeaders(cred),
          'User-Agent': APP_CHANNEL_UA,
          'X-IDE-Type': 'APP',
          'X-Product-Version': '5.8.3',
        },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json().catch(() => null);
      const data = body?.data ?? body;
      if (!res.ok) {
        // 静默降级会让「为什么没有限时优惠」变成悬案，这里至少留一条 warn。
        this._authFailed = res.status === 401 || res.status === 403;
        if (this._authFailed) this._authStatus = res.status;
        this.log?.warn?.(
          `产品配置 HTTP ${res.status}${this._authFailed ? '（认证失败，不再降级）' : '，退回旧目录路径（本次没有促销信息）'}。`,
        );
      } else if (!data || typeof data !== 'object') {
        this.log?.warn?.('产品配置返回空内容，退回旧目录路径（本次没有促销信息）。');
      } else {
        const rawModels = Array.isArray(data.models) ? data.models : [];
        const models = rawModels.map((m) => normalizeModel(m)).filter((m) => m && m.id);
        if (models.length > 0) {
          const promos = parsePromos(data.modelPromotions, data.modelTiers);
          return { models: attachPromos(models, promos), promos, source: 'v3-config' };
        }
        this.log?.warn?.('产品配置里没有可用的模型条目，退回旧目录路径。');
      }
    } catch (err) {
      this.log?.warn?.(`产品配置读取失败，退回旧目录路径：${err?.message ?? err}`);
    }
    // 认证类失败（401/403）再打一次旧接口没有意义：token 本身是死的，
    // 降级只会把真实错误（session_dead）换成 legacy 的二次失败，掩盖问题。
    if (this._authFailed) {
      // 构造函数第二参是 info 对象（status / kind）。0.3.0 写成 'session_dead'
      // 字符串，读不到 kind，错误恒为 'server'、status=0，上层于是不清 token、
      // 面板也不提示重新登录（审查报告里最严重的一条）。
      throw new WbUpstreamError('WorkBuddy 登录态已失效（产品配置返回 401/403），请重新登录客户端。', {
        status: this._authStatus,
        kind: 'session_dead',
      });
    }
    const models = await this.fetchModelsLegacy(cred);
    return { models, promos: [], source: 'legacy' };
  }

  /**
   * 读取模型目录（兼容入口）。
   * @param {{ accessToken: string }} cred
   */
  async fetchModels(cred) {
    const { models } = await this.fetchCatalog(cred);
    return models;
  }

  /**
   * 旧目录路径（无促销）。保留作为 `/v3/config` 的降级。
   * @param {{ accessToken: string }} cred
   */
  async fetchModelsLegacy(cred) {
    const res = await fetch(this.url(MODELS_PATH), {
      method: 'GET',
      headers: commonHeaders(cred),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new WbUpstreamError(`模型目录请求失败 HTTP ${res.status}`, {
        status: res.status,
        code: body?.code,
        kind: res.status === 401 || res.status === 403 ? 'session_dead' : 'server',
      });
    }
    if (body && typeof body.code === 'number' && body.code !== 0 && body.code !== 200) {
      throw new WbUpstreamError(`模型目录业务错误 code=${body.code}: ${body.msg ?? ''}`, {
        status: res.status,
        code: body.code,
        kind: body.code === 401 || body.code === 14001 ? 'session_dead' : 'server',
      });
    }
    const list = body?.data?.models ?? body?.data ?? body?.models ?? [];
    if (!Array.isArray(list)) return [];
    return list.map((m) => normalizeModel(m)).filter((m) => m && m.id);
  }
  /**
   * 只读积分余额（按套餐聚合前的原始条目）。接口属于计费域，
   * 上游若调整路径，这里抛错、调用方降级显示，不影响模型目录与对话。
   * @param {{ accessToken: string }} cred
   */
  async fetchCredits(cred) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const res = await fetch(this.billingUrl(CREDITS_PATH), {
      method: 'POST',
      headers: commonHeaders(cred, {
        'X-CodeBuddy-Request': '1',
        'Accept-Language': 'zh-CN',
        Origin: this.billingUrl(''),
        Referer: `${this.billingUrl('')}/`,
        ...(cred.uid ? { 'X-User-Id': String(cred.uid) } : {}),
        ...(cred.domain ? { 'X-Domain': String(cred.domain) } : {}),
      }),
      body: JSON.stringify({
        PageNumber: 1,
        PageSize: 100,
        ProductCode: 'p_tcaca',
        Status: [0, 3],
        PackageEndTimeRangeBegin: fmt(now),
        PackageEndTimeRangeEnd: fmt(new Date(now.getTime() + 3185136e6)),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new WbUpstreamError(`积分查询失败 HTTP ${res.status}`, { status: res.status });
    }
    const wrapper = body?.data?.Response?.Data ?? body?.data ?? null;
    const list = wrapper?.Accounts ?? wrapper?.accounts ?? wrapper?.packages ?? [];
    if (!Array.isArray(list)) return { total: null, used: null, packages: [], accounts: 0 };
    let total = 0;
    let used = 0;
    let accounts = 0;
    const packages = [];
    for (const p of list) {
      // 与官方客户端同口径：优先 cycle 家族的精确剩余/已用。
      const remain = Number(p?.CycleCapacityRemainPrecise ?? p?.cycleRemain ?? p?.CapacityRemain ?? 0);
      if (!Number.isFinite(remain)) continue;
      const spent = Number(p?.CycleCapacityUsedPrecise ?? p?.CapacityUsedPrecise ?? p?.CapacityUsed ?? 0);
      const size = Number(p?.CycleCapacitySizePrecise ?? p?.CapacitySizePrecise ?? p?.CapacitySize ?? 0);
      total += remain;
      if (Number.isFinite(spent)) used += spent;
      accounts += 1;
      packages.push({
        name: String(p?.PackageName ?? p?.packageName ?? '积分包'),
        remain,
        used: Number.isFinite(spent) ? spent : 0,
        size: Number.isFinite(size) ? size : 0,
        cycleStart: str(p?.CycleStartTime),
        cycleEnd: str(p?.CycleEndTime),
        expiresAt: str(p?.ExpiredTime),
        status: typeof p?.Status === 'number' ? p.Status : undefined,
      });
    }
    packages.sort((a, b) => b.remain - a.remain);
    return { total, used, packages, accounts };
  }

  /**
   * 发起一次对话（SSE 流式），把增量文本逐段交给 onDelta。
   * @param {{ accessToken: string }} cred
   * @param {{ model: string, messages: Array<{role: string, content: string}>, maxTokens?: number, signal?: AbortSignal }} req
   * @param {(delta: string) => void} onDelta
   * @returns {Promise<{ text: string, credit?: number, usage?: { promptTokens?: number, completionTokens?: number, totalTokens?: number, cachedTokens?: number, reasoningTokens?: number, credit?: number } }>}
   */
  async chat(cred, req, onDelta) {
    const res = await fetch(this.url(CHAT_PATH), {
      method: 'POST',
      headers: commonHeaders(cred, { Accept: 'text/event-stream' }),
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        max_tokens: req.maxTokens,
      }),
      signal: req.signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new WbUpstreamError(`对话请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`, {
        status: res.status,
        kind: classifyHttpFailure(res.status, text),
      });
    }
    let text = '';
    let credit;
    let usage = {};
    const decoder = new TextDecoder();
    let buf = '';
    /** 处理一行 SSE；末尾残留（没有换行）也走这里。 */
    const handleLine = (raw) => {
      const line = raw.trimEnd();
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (payload === '' || payload === '[DONE]') return;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        return;
      }
      // 业务错误（排队 6020/6021/6022、限流 6004/14003、渠道 11128 等）原样抛出。
      if (typeof evt.code === 'number' && evt.code !== 0 && evt.code !== 200) {
        throw new WbUpstreamError(`上游业务错误 code=${evt.code}: ${evt.msg ?? evt.message ?? ''}`, {
          code: evt.code,
          kind: classifyBusinessCode(evt.code),
        });
      }
      const delta = evt.choices?.[0]?.delta?.content ?? evt.choices?.[0]?.message?.content;
      if (typeof delta === 'string' && delta !== '') {
        text += delta;
        onDelta(delta);
      }
      if (typeof evt.credit === 'number') credit = evt.credit;
      if (evt.usage && typeof evt.usage === 'object') {
        // 最后一段 SSE 带完整用量（实测：prompt_tokens / completion_tokens / total_tokens /
        // 明细里的 cached_tokens、reasoning_tokens，以及本次真实扣费 credits 的 `credit`）。
        const u = evt.usage;
        const next = {
          promptTokens: numberOrUndefined(u.prompt_tokens),
          completionTokens: numberOrUndefined(u.completion_tokens),
          totalTokens: numberOrUndefined(u.total_tokens),
          cachedTokens:
            numberOrUndefined(u.prompt_tokens_details?.cached_tokens) ?? numberOrUndefined(u.cached_tokens),
          reasoningTokens:
            numberOrUndefined(u.completion_tokens_details?.reasoning_tokens) ??
            numberOrUndefined(u.completion_thinking_tokens),
          credit: numberOrUndefined(u.credit),
        };
        // SSE 可能分多帧返回用量，末帧只带 credit；逐字段合并，不能用末帧覆盖前帧 token。
        for (const [key, value] of Object.entries(next)) {
          if (value !== undefined) usage[key] = value;
        }
        if (typeof u.credit === 'number') credit = u.credit;
      }
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    }
    // 流的最后一段可能没有换行（实测带 usage 的收尾帧就是这样）；不 flush 会把它整段丢掉，
    // 于是「本次消耗积分」永远是 0。
    buf += decoder.decode();
    if (buf.trim() !== '') handleLine(buf);
    return { text, credit, usage };
  }
}

/** `0` 是合法用量，只有 null / undefined / NaN 才算「没有」。 */
function numberOrUndefined(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 解析上游模型条目。credits 形如 "x0.79" / "0.79" / 0.79，倍率完全由上游给出。
 * 0.3.7 起导出：本地缓存（localcatalog.js）里的 models[] 与上游同形，复用这一份解析。
 */
export function normalizeModel(m) {
  if (!m || typeof m !== 'object') return null;
  const id = m.id ?? m.model ?? m.name;
  if (typeof id !== 'string' || id === '') return null;
  const out = {
    id,
    name: typeof m.name === 'string' && m.name !== '' ? m.name : id,
    contextWindow: num(m.maxInputTokens ?? m.contextWindow ?? m.context_window),
    maxTokens: num(m.maxOutputTokens ?? m.maxTokens ?? m.max_tokens),
    creditMultiplier: parseCredits(m.credits ?? m.creditMultiplier),
    /** 原始倍率文本（`"x0.11"`），促销计算按它取基准价。 */
    credits: str(m.credits),
    supportsImages: m.supportsImages === true && m.disabledMultimodal !== true,
    supportsToolCall: m.supportsToolCall === true || m.supports_tool_call === true,
    description: str(m.descriptionZh ?? m.description ?? m.descriptionEn),
    reasoning: parseReasoning(m.reasoning),
    /** 目录里标了 disabled=true 的模型：调用它们等于绕过官方限制，安全清单直接拒。 */
    disabled: m.disabled === true,
  };
  return out;
}

function parseCredits(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /([0-9]+(?:\.[0-9]+)?)/.exec(v);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function parseReasoning(r) {
  if (!r || typeof r !== 'object') return undefined;
  const efforts = Array.isArray(r.supportedEfforts)
    ? r.supportedEfforts.filter((e) => typeof e === 'string')
    : typeof r.effort === 'string'
      ? [r.effort]
      : undefined;
  if (!efforts || efforts.length === 0) return undefined;
  return {
    supportedEfforts: efforts,
    defaultEffort: typeof r.defaultEffort === 'string' ? r.defaultEffort : efforts[0],
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function str(v) {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function classifyHttpFailure(status, text) {
  if (status === 401 || status === 403) return 'session_dead';
  // 429 以前两个分支都返回 soft_rate（三元表达式两边一样，等于没判）。真实语义是：
  // 「额度耗尽」与「太频繁」要分开，前者不该被当成可重试的软限流。
  if (status === 429) return /14018|额度|quota|insufficient|exhaust/i.test(text) ? 'hard_credit' : 'soft_rate';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'client';
  return 'server';
}

function classifyBusinessCode(code) {
  if (code === 6020 || code === 6021 || code === 6022) return 'model_queue';
  if (code === 6004) return 'soft_rate';
  if (code === 14003) return 'model_busy';
  if (code === 11128) return 'channel_reject';
  if (code === 14018) return 'hard_credit';
  if (code === 401 || code === 14001) return 'session_dead';
  return 'server';
}
