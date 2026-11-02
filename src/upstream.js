/**
 * WorkBuddy 上游客户端：模型目录、积分余额、chat completions 流式、token 刷新。
 *
 * 协议参照 dsh-connect-workbuddy（MIT）与 workbuddy2api（MIT）的实测结论：
 *  - 模型目录：GET  /v2/enterprises/personal/models（/v2 形态两区网关都答；
 *    每个模型条目带 id / name / maxInputTokens / maxOutputTokens /
 *    credits（积分倍率字符串，如 "x0.79"）/ supportsImages / reasoning 等）
 *  - 对话：    POST /v2/chat/completions，强制 stream:true，SSE 回包
 *  - 刷新：    POST /v2/auth/refresh，刷新令牌走 X-Refresh-Token 头，
 *    chat 请求绝不携带 refresh token（安全红线）
 *  - 归属头：  X-IDE-Name / X-IDE-Type / X-Product = WorkBuddy，让用量页
 *    把这笔调用记成官方客户端发的
 *
 * 注意：这些是 WorkBuddy 客户端自身接口（非官方开放 API），上游调整时
 * 本模块可能需要跟着调整；解析一律宽容，缺字段留空，不虚构。
 */

/** 两个区域的官方上游域名。 */
export const WB_REGION_BASE = {
  cn: 'https://copilot.tencent.com',
  global: 'https://www.workbuddy.ai',
};

const MODELS_PATH = '/v2/enterprises/personal/models';
const CHAT_PATH = '/v2/chat/completions';
const REFRESH_PATH = '/v2/auth/refresh';
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
/** 计费域（积分/签到/福利）根地址，按区域。 */
const WB_BILLING_BASE = {
  cn: 'https://www.codebuddy.cn',
  global: 'https://www.workbuddy.ai',
};

const PRODUCT_UA = 'WorkBuddy/2.63.2';

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
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.log = opts.log ?? { warn: () => {} };
  }

  url(path) {
    return `${this.baseUrl}${path}`;
  }

  /** 计费域的完整地址（积分、签到、福利都在这边，和 chat 域不同）。 */
  billingUrl(path) {
    const base = this.baseUrl.includes('copilot.tencent.com')
      ? WB_BILLING_BASE.cn
      : this.baseUrl.includes('codebuddy.ai')
        ? 'https://www.codebuddy.ai'
        : WB_BILLING_BASE.global;
    return `${base}${path}`;
  }

  /**
   * 读取模型目录。返回规范化后的模型数组；解析不出的字段留空。
   * @param {{ accessToken: string }} cred
   */
  async fetchModels(cred) {
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
        kind: res.status === 401 ? 'session_dead' : 'server',
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
    if (!Array.isArray(list)) return { total: null, packages: [] };
    let total = 0;
    const packages = [];
    for (const p of list) {
      // 与官方客户端同口径：优先 cycle 家族的精确剩余。
      const remain = Number(p?.CycleCapacityRemainPrecise ?? p?.cycleRemain ?? p?.CapacityRemain ?? 0);
      if (!Number.isFinite(remain)) continue;
      total += remain;
      packages.push({
        name: String(p?.PackageName ?? p?.packageName ?? '积分包'),
        remain,
      });
    }
    return { total, packages };
  }

  /**
   * 刷新 access token。刷新令牌只出现在这一条请求里。
   * @param {{ refreshToken: string }} cred
   * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number }>}
   */
  async refresh(cred) {
    const res = await fetch(this.url(REFRESH_PATH), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': PRODUCT_UA,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Refresh-Token': cred.refreshToken,
        'X-Auth-Refresh-Source': 'workbuddy',
      },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      throw new WbUpstreamError(`token 刷新失败 HTTP ${res.status}`, {
        status: res.status,
        kind: 'session_dead',
      });
    }
    const data = body.data ?? body;
    const accessToken = data.accessToken ?? data.access_token;
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new WbUpstreamError('token 刷新响应里没有 accessToken', { kind: 'session_dead' });
    }
    return {
      accessToken,
      refreshToken: data.refreshToken ?? data.refresh_token,
      expiresIn: data.expiresIn ?? data.expires_in,
    };
  }

  /**
   * 发起一次对话（SSE 流式），把增量文本逐段交给 onDelta。
   * @param {{ accessToken: string }} cred
   * @param {{ model: string, messages: Array<{role: string, content: string}>, maxTokens?: number, signal?: AbortSignal }} req
   * @param {(delta: string) => void} onDelta
   * @returns {Promise<{ text: string, credit?: number }>}
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
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let evt;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
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
        if (evt.usage && typeof evt.usage.credit === 'number') credit = evt.usage.credit;
      }
    }
    return { text, credit };
  }
}

/** 解析上游模型条目。credits 形如 "x0.79" / "0.79" / 0.79，倍率完全由上游给出。 */
function normalizeModel(m) {
  if (!m || typeof m !== 'object') return null;
  const id = m.id ?? m.model ?? m.name;
  if (typeof id !== 'string' || id === '') return null;
  const out = {
    id,
    name: typeof m.name === 'string' && m.name !== '' ? m.name : id,
    contextWindow: num(m.maxInputTokens ?? m.contextWindow ?? m.context_window),
    maxTokens: num(m.maxOutputTokens ?? m.maxTokens ?? m.max_tokens),
    creditMultiplier: parseCredits(m.credits ?? m.creditMultiplier),
    supportsImages: m.supportsImages === true && m.disabledMultimodal !== true,
    supportsToolCall: m.supportsToolCall === true || m.supports_tool_call === true,
    description: str(m.descriptionZh ?? m.description ?? m.descriptionEn),
    reasoning: parseReasoning(m.reasoning),
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

function classifyHttpFailure(status, text) {
  if (status === 401 || status === 403) return 'session_dead';
  if (status === 429) return /6004|14003|重置|reset/i.test(text) ? 'soft_rate' : 'soft_rate';
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
