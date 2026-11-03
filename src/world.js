/**
 * WorkBuddy 桥接 World：发现本机登录态 → 读模型目录（含默认积分倍率）→
 * 面板选模型 → wb_* 工具供 Coo 调用所选模型。
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { WB_CONFIG_GROUP } from './config.js';
import { WB_BASE, WbUpstream, WbUpstreamError } from './upstream.js';
import { discoverCredentials, maskToken, resolveTokensWithKey } from './credentials.js';
import { detectWorkBuddy } from './wbproc.js';
import { attachPromos, discountText, priceViewOf, promoActiveAt } from './promo.js';
import { UsageLedger, summarize } from './usage.js';
import { classifyModel, preferredSafeModel, safeGroupsOf } from './safety.js';


const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const CATALOG_FILE = 'workbuddy-catalog.json';

/** 面板可用的语言文案。 */
const L10N = {
  zh: {
    noAuth: '未发现本机 WorkBuddy 登录态。请先登录 WorkBuddy 客户端，或在「账号」面板手动粘贴 access token。',
  },
  en: {
    noAuth: 'No local WorkBuddy sign-in found. Sign in the WorkBuddy desktop app, or paste an access token in the Account panel.',
  },
};

function t(language, key) {
  return (L10N[language] ?? L10N.en)[key] ?? L10N.en[key] ?? key;
}

/**
 * 全部工具声明（不含 handler）。describe.tools 与 tools() 共用这一份。
 * 工具名以 wb_ 为前缀，避免与其他 World 冲突。
 */
export const WB_TOOL_DECLS = [
  {
    name: 'wb_list_models',
    description:
      'List the WorkBuddy chat models that are safe to call (official public catalog only), each with its credit multiplier (e.g. x0.79, already including time-limited discounts), context window and reasoning efforts. Read-only; costs nothing. Pass all=true to also list models that are disabled, internal routing aliases, media/code models or delisted ones — those are not callable through this bridge while worlds.workbuddy.safeOnly is on.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        all: { type: 'boolean', description: 'Also list models outside the safe list (shown with their risk reason).' },
      },
    },
  },
  {
    name: 'wb_select_model',
    description:
      'Select which WorkBuddy model wb_chat should use by default. The id must come from wb_list_models. Persists across restarts.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: { type: 'string', description: 'Model id from wb_list_models.' },
      },
      required: ['model'],
    },
  },
  {
    name: 'wb_chat',
    description:
      'Ask the selected WorkBuddy model a single-turn question and return its answer. This spends the user\'s own WorkBuddy credits at the model\'s multiplier; keep prompts concise. Use the model parameter only to override the selected model for one call. Requires the WorkBuddy desktop app to be running.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string', description: 'The user message to send.' },
        model: { type: 'string', description: 'Optional model id overriding the selected one for this call.' },
        system: { type: 'string', description: 'Optional system prompt for this call.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'wb_credits',
    description:
      'Show the remaining WorkBuddy credit balance of the signed-in account (read-only). Requires the WorkBuddy desktop app to be running.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

/**
 * 「用户主动登出」的哨兵值。
 *
 * 框架的 `ctx.storeSecret(name, '')` 会被拒绝（空值不写 .env），所以以前点「清除密钥」
 * 写不进去、下次 `loadTokens()` 又把旧 token 读回来，界面一直显示「已登录」。
 * 这里写一个不可能与真 token 相撞的字符串，`loadTokens()` 见到它就当作「已登出」。
 */
export const TOKEN_CLEARED = 'wb-cleared';
/**
 * 「允许自动发现」哨兵：用户点过「重新探测」并且成功之后写它。
 *
 * 为什么需要两个哨兵：框架的 storeSecret 拒绝空值（写空串会被丢掉），
 * 所以「登出」只能靠 `wb-cleared` 表示；但如果 rediscover 只是本次进程内跳过它，
 * 密钥库里的 `wb-cleared` 还在，扩展一重启就又变回未登录（审查报告第 2 条）。
 * 于是 rediscover 成功后把哨兵换成 `wb-auto`：既不是旧 token，也不阻止自动发现。
 */
export const TOKEN_AUTO = 'wb-auto';

/**
 * 面板 → 允许调用的方法。
 *
 * 与 `webUi().panels[].getMethods` 是同一套口径：`getMethods` 声明的是「打开面板时会读的方法」，
 * 这里还包含按钮触发的写方法。不在表里的组合一律报错——特别是不允许从任意面板
 * 调到 `setToken` / `clearToken`（会写框架的密钥库）。
 */
export const PANEL_METHODS = {
  usage: ['state', 'refresh', 'clear'],
  models: ['state', 'refresh', 'select'],
  account: ['state', 'rediscover', 'credits', 'setToken', 'clearToken'],
};

export class WorkBuddyWorld {
  id = 'workbuddy';

  /**
   * @param {object} opts
   * @param {object} opts.ctx WorldContext（cfg / dataDir / secret / storeSecret / persist / log 由 host 提供）
   */
  constructor(opts) {
    this.ctx = opts.ctx;
    /** @type {import('node:events').EventEmitter | null} */
    this.host = null;
    this.catalog = []; // 规范化模型数组（含 creditMultiplier）
    this.catalogAt = 0;
    this.lastError = '';
    this.tokens = null; // { accessToken, refreshToken, source }
    /** start() 是否跑完。没跑完时灯态一律显示「检查中」，否则会误报「未发现登录态」。 */
    this.started = false;
    this._sockets = new Set();
    /**
     * 最近一次 WorkBuddy 主进程采样。envPromptVars() 是同步的，所以这里存一份快照，
     * 由定时器和每次工具调用去刷新；async 检测只在 syncProc() 里做。
     * @type {{ running: boolean, pids: number[], mainPid: number | null, via: string, detail: string, at: number }}
     */
    this.proc = { running: false, pids: [], mainPid: null, via: 'unknown', detail: '', at: 0 };
    /** @type {ReturnType<typeof setInterval> | null} */
    this._procTimer = null;
    /** 启动后 1.2 秒的二次确认定时器（防桌面端枚举慢半拍）。 */
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._procConfirm = null;
    /**
     * 目录里带进来的促销 / 档位（/v3/config 的 modelPromotions + modelTiers）。
     * 倍率不能只看模型的 credits：夜间折扣、限时免费都挂在这些条目上。
     * @type {Array<Record<string, unknown>>}
     */
    this.promos = [];
    /** 目录来源：v3-config（带促销）或 legacy（只有倍率）。 */
    this.catalogSource = '';
    /** 每次调用的用量账本（本地 JSONL），以及最近一次积分包快照。 */
    this.ledger = new UsageLedger({ dataDir: this.ctx.dataDir, log: this.log });
    /** @type {null | { total: number | null, used: number | null, packages: unknown[], at: number }} */
    this.lastBalance = null;
    /** 今日用量小计。envPromptVars() 是同步的，所以这里存一份快照，由账本与每次调用刷新。 */
    this.today = { day: '', credit: 0, calls: 0, prompt: 0, completion: 0 };
  }

  get cfg() {
    return this.ctx.cfg;
  }

  get log() {
    return this.host?.log ?? console;
  }

  baseUrl() {
    return this.cfg.baseUrl || WB_BASE;
  }

  upstream() {
    return new WbUpstream({ baseUrl: this.baseUrl(), log: this.log });
  }

  catalogPath() {
    return join(this.ctx.dataDir, CATALOG_FILE);
  }

  // -------------------------------------------------------------------------
  // WorkBuddy 主进程检测（灯态、面板只读状态与 wb_* 工具共用）
  // -------------------------------------------------------------------------

  /**
   * 刷新主进程快照。force=false 时交给 wbproc 的短缓存，连续调用不会反复 spawn。
   * @param {boolean} [force]
   */
  async syncProc(force = false) {
    try {
      const state = await detectWorkBuddy(force);
      const next = {
        running: !!state.running,
        pids: state.pids ?? [],
        mainPid: state.mainPid ?? null,
        via: state.via ?? 'unknown',
        detail: state.detail ?? '',
        at: state.at ?? Date.now(),
      };
      // 「在跑 → 没在跑」这种翻转要多看一眼：tasklist 在系统忙时偶尔漏一行，
      // 一次误判就会让灯态闪成「未检测到主进程」。确认一次再落定，避免抖动。
      if (!next.running && this.proc?.running && next.via !== 'error') {
        await new Promise((r) => setTimeout(r, 300).unref?.());
        const again = await detectWorkBuddy(true);
        if (again.running) Object.assign(next, {
          running: true,
          pids: again.pids ?? [],
          mainPid: again.mainPid ?? null,
          via: again.via ?? next.via,
          detail: again.detail ?? '',
          at: again.at ?? Date.now(),
        });
      }
      this.proc = next;
    } catch (err) {
      this.proc = {
        running: false,
        pids: [],
        mainPid: null,
        via: 'error',
        detail: String(err?.message ?? err),
        at: Date.now(),
      };
    }
    return this.proc;
  }

  // -------------------------------------------------------------------------
  // 凭据：手动粘贴（密钥库）优先，其次本机发现
  // -------------------------------------------------------------------------

  async loadTokens(opts = {}) {
    // 框架的 ctx.secret(name) 是同步的（读部署 .env / 进程环境），没有 Promise 的 catch。
    let manual = null;
    try {
      manual = this.ctx.secret('accessToken') || null;
    } catch {
      manual = null;
    }
    const signedOut = manual === TOKEN_CLEARED;
    if (manual === TOKEN_AUTO) manual = null;
    if (manual && !signedOut) {
      this.tokens = { accessToken: manual, source: 'manual' };
      this.lastError = '';
      return this.tokens;
    }
    // 用户显式登出后，不再偷偷从数据目录里把凭据读回来——否则「清除」等于没生效。
    // 想重新发现，走面板的「重新探测」（rediscover）或重新填 token。
    if (signedOut && opts.rediscover !== true) {
      this.tokens = null;
      this.lastError = '已登出：点「重新探测」或重新填 token 才能继续使用。';
      return null;
    }
    const found = discoverCredentials(this.cfg.credentialsDir || undefined);
    if (found) {
      // 桌面端 5.6+ 的 token 是加密的：先试环境变量密钥，再问桌面端二进制要一次。
      const resolved = await resolveTokensWithKey(found.credential);
      if (resolved.accessToken) {
        this.tokens = resolved;
        this.lastError = '';
        return this.tokens;
      }
      this.lastError = found.encrypted
        ? '发现加密的 WorkBuddy 凭据，但拿不到解封密钥（桌面端未安装 / WORKBUDDY_AT_REST_KEY 未设置）。'
        : '发现 WorkBuddy 数据目录，但读不到可用 token。';
    }
    this.tokens = null;
    return null;
  }

  async ensureTokens() {
    if (this.tokens?.accessToken) return this.tokens;
    return this.loadTokens();
  }

  // -------------------------------------------------------------------------
  // 目录读写
  // -------------------------------------------------------------------------

  loadCatalogFromDisk() {
    try {
      if (!existsSync(this.catalogPath())) return;
      const saved = JSON.parse(readFileSync(this.catalogPath(), 'utf8'));
      if (Array.isArray(saved.models)) {
        this.catalog = saved.models;
        this.catalogAt = Number(saved.at) || 0;
        this.promos = Array.isArray(saved.promos) ? saved.promos : [];
        this.catalogSource = typeof saved.source === 'string' ? saved.source : '';
        // 老缓存里没带促销：把磁盘上的促销重新挂一遍，否则倍率会退回原价。
        if (this.promos.length > 0) this.catalog = attachPromos(this.catalog, this.promos);
      }
    } catch {
      /* 损坏的缓存按没有处理 */
    }
  }

  async saveCatalog() {
    try {
      await mkdir(this.ctx.dataDir, { recursive: true });
      await writeFile(
        this.catalogPath(),
        JSON.stringify(
          {
            at: Date.now(),
            source: this.catalogSource,
            models: this.catalog,
            promos: this.promos,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch (err) {
      this.log.warn(`workbuddy: 目录落盘失败：${err?.message ?? err}`);
    }
  }

  async refreshCatalog() {
    const tokens = await this.ensureTokens();
    if (!tokens) throw new WbUpstreamError('no-auth', { kind: 'session_dead' });
    const { models, promos, source } = await this.upstream().fetchCatalog(tokens);
    // v3 接口偶发失败时 upstream 会退回 legacy（模型更少、没有促销）。本地已经有
    // 一份完整的 v3 目录时，不拿这种降级结果覆盖它，否则倍率与限时折扣会一起丢失。
    if (source === 'legacy' && this.catalogSource === 'v3-config' && this.catalog.length > 0) {
      this.lastError = 'v3 目录暂时不可用，已保留上一次的完整目录（含促销与倍率）';
      this.log.warn(`workbuddy: ${this.lastError}`);
      this.broadcast({ kind: 'catalog', count: this.catalog.length });
      return this.catalog;
    }
    this.catalog = models;
    this.promos = promos;
    this.catalogSource = source;
    this.catalogAt = Date.now();
    this.lastError = '';
    await this.saveCatalog();
    this.broadcast({ kind: 'catalog', count: models.length });
    return models;
  }

  findModel(id) {
    return this.catalog.find((m) => m.id === id);
  }

  // -------------------------------------------------------------------------
  // 合规闸门：只放行 WorkBuddy 公开对话模型
  // -------------------------------------------------------------------------

  /** 目录里哪些模型进了安全清单（按目录顺序）。 */
  safeModelIds() {
    return this.catalog.filter((m) => classifyModel(m.id, m).allow).map((m) => m.id);
  }

  /** 单个模型的合规判定。 */
  safetyOf(id) {
    return classifyModel(id, this.findModel(id));
  }

  /** 把模型的合规判定挂进 models/state 的返回，供面板渲染。 */
  describeModel(m) {
    const safety = classifyModel(m.id, m);
    return { ...m, safety, price: priceViewOf(m, Date.now()) };
  }

  /**
   * wb_chat / wb_select_model 的准入检查。
   * @returns {string|null} 拒绝时返回给模型看的说明，放行时 null。
   */
  rejectUnsafeModel(id) {
    const safety = this.safetyOf(id);
    if (safety.allow || this.cfg.safeOnly === false) return null;
    const hint = '（workbuddy.safeOnly 已开；如确需使用，可在 World 配置里关掉它，风险自负）';
    return `模型 ${id} 不在 WorkBuddy 安全清单内，判定为「${safety.label}」：${safety.reason}。${hint}`;
  }

  // -------------------------------------------------------------------------
  // World 契约
  // -------------------------------------------------------------------------

  envPromptVars() {
    if (!this.cfg.envPrompt) return null;
    this.rollTodayIfNeeded(); // 跨过午夜后提示词里的「今日积分」不能还累计昨天
    const price = this.priceOf(this.cfg.model);
    const promoBit =
      price && price.promoId !== undefined && typeof price.effective === 'number'
        ? `（限时 ${discountText(this.promos.find((p) => p.id === price.promoId)) || '优惠'}${price.windowText ? ` ${price.windowText}` : ''}）`
        : '';
    return {
      'workbuddy.model': this.cfg.model || '(none selected)',
      'workbuddy.multiplier':
        price && typeof price.effective === 'number' ? `x${price.effective}${promoBit}` : '(unknown)',
      'workbuddy.catalogSize': String(this.catalog.length),
      'workbuddy.authed': this.tokens ? 'yes' : 'no',
      'workbuddy.process': this.proc.running ? 'running' : 'stopped',
      'workbuddy.safeOnly': this.cfg.safeOnly === false ? 'off' : 'on',
      'workbuddy.todayCredit': String(Math.round(this.today.credit * 100) / 100),
      'workbuddy.todayTokens': String(this.today.prompt + this.today.completion),
    };
  }

  tools() {
    return [
      {
        ...WB_TOOL_DECLS[0],
        handler: async (args) => this.toolListModels({ all: args?.all === true }),
      },
      {
        ...WB_TOOL_DECLS[1],
        handler: async (args) => this.toolSelectModel(String(args?.model ?? '')),
      },
      {
        ...WB_TOOL_DECLS[2],
        handler: async (args) =>
          this.toolChat({
            prompt: String(args?.prompt ?? ''),
            model: typeof args?.model === 'string' ? args.model : undefined,
            system: typeof args?.system === 'string' ? args.system : undefined,
          }),
      },
      {
        ...WB_TOOL_DECLS[3],
        handler: async () => this.toolCredits(),
      },
    ];
  }

  async start(host) {
    this.host = host;
    this.started = false;
    // 整个启动流程包在 try/finally 里：任何一步抛错（网络、文件、宿主事件）都不能让
    // `started` 永远停在 false——那会让两盏灯一直显示「正在读取登录态…」。
    try {
      this.loadCatalogFromDisk();
      await this.loadTokens();
      await this.syncProc(true);
      this._procTimer = setInterval(() => {
        void (async () => {
          const before = this.proc.running;
          try {
            const state = await this.syncProc(true);
            // 只在「在跑 / 没在跑」真正翻转时推一次，避免每 6 秒让面板重绘。
            if (state.running !== before) {
              this.broadcast({
                kind: 'process',
                running: state.running,
                mainPid: state.mainPid,
                via: state.via,
              });
            }
          } catch {
            /* 探测失败不改状态，等下一次 */
          }
        })();
      }, 6000);
      this._procTimer.unref?.();
      // 刚启动时探测偶尔比桌面端枚举慢半拍：1.2 秒后再确认一次，免得界面先亮出「未检测到主进程」。
      this._procConfirm = setTimeout(() => {
        void this.syncProc(true)
          .then((state) =>
            this.broadcast({ kind: 'process', running: state.running, mainPid: state.mainPid, via: state.via }),
          )
          .catch(() => {});
      }, 1200);
      this._procConfirm.unref?.();
      // 有凭据而目录为空时后台补一次刷新，失败只记日志。
      if (this.tokens && this.catalog.length === 0) {
        this.refreshCatalog().catch((err) => {
          this.lastError = err?.message ?? String(err);
          this.log.warn(`workbuddy: 启动时刷新目录失败：${this.lastError}`);
        });
      }
      // 用量：今日小计从账本重算；余额快照后台补一份（查不到也不影响启动）。
      try {
        await this.refreshToday();
      } catch (err) {
        this.log.warn?.(`workbuddy: 读取用量账本失败：${err?.message ?? err}`);
      }
      if (this.tokens) {
        void this.syncBalance().catch(() => {});
      }
      // 挂载事件只是通知：宿主事件总线出问题时不该拖累启动。
      try {
        await host.pushEvent({
          type: 'workbuddy.started',
          ts: new Date().toISOString(),
          source: this.id,
          origin: 'internal',
          senderKey: this.id,
          text: this.tokens
            ? `WorkBuddy 桥接已挂载：目录 ${this.catalog.length} 个模型，当前模型 ${this.cfg.model || '(未选)'}。`
            : 'WorkBuddy 桥接已挂载，但未发现登录态；wb_* 工具暂不可用。',
        });
      } catch (err) {
        this.log.warn?.(`workbuddy: 挂载事件推送失败（不影响 wb_* 工具）：${err?.message ?? err}`);
      }
    } catch (err) {
      this.log.warn?.(`workbuddy: 启动流程异常（wb_* 工具仍可尝试调用）：${err?.message ?? err}`);
    } finally {
      this.started = true;
    }
  }

  async stop() {
    if (this._procTimer) {
      clearInterval(this._procTimer);
      this._procTimer = null;
    }
    if (this._procConfirm) {
      clearTimeout(this._procConfirm);
      this._procConfirm = null;
    }
    for (const s of this._sockets) {
      try {
        s.close('world stop');
      } catch {
        /* ignore */
      }
    }
    this._sockets.clear();
    this.host = null;
  }

  // -------------------------------------------------------------------------
  // 工具实现（回执只陈述可确认的事实）
  // -------------------------------------------------------------------------

  toolListModels({ all = false } = {}) {
    if (this.catalog.length === 0) return `WorkBuddy 模型目录为空。${this.lastError || '请先在面板刷新目录。'}`;
    const now = Date.now();
    const safeOnly = this.cfg.safeOnly !== false;

    const describe = (m) => {
      const parts = [`- ${m.id}`];
      if (m.name !== m.id) parts.push(`(${m.name})`);
      const price = priceViewOf(m, now);
      if (typeof price.base === 'number') {
        const discounted =
          price.promoId !== undefined && typeof price.effective === 'number' && price.effective < price.base;
        parts.push(
          discounted
            ? `积分倍率 x${price.effective}（原价 x${price.base}${price.windowText ? `，${price.windowText}` : ''}）`
            : `积分倍率 x${price.base}`,
        );
      }
      if (price.badge) parts.push(`${price.badgeActive ? '优惠中' : '优惠'}：${price.badge}`);
      if (m.contextWindow) parts.push(`上下文 ${m.contextWindow}`);
      if (m.reasoning?.supportedEfforts) parts.push(`推理档 ${m.reasoning.supportedEfforts.join('/')}`);
      if (m.supportsImages) parts.push('支持图片输入');
      return parts.join('，');
    };

    const safeModels = this.catalog.filter((m) => classifyModel(m.id, m).allow);
    const otherModels = this.catalog.filter((m) => !classifyModel(m.id, m).allow);

    const groups = safeGroupsOf(safeModels.map((m) => m.id));
    const groupBlocks = groups.map((g) => {
      const rows = g.ids.map((id) => describe(this.findModel(id))).filter(Boolean);
      return `【${g.label}】\n${rows.join('\n')}`;
    });

    const current = this.cfg.model
      ? `当前选择：${this.cfg.model}（此刻 ${this.selectedMultiplier() ?? '倍率未知'}）\n`
      : '当前未选择模型。\n';
    const policy = safeOnly
      ? `安全清单：${safeModels.length}/${this.catalog.length} 个模型可调用（WorkBuddy 公开目录里的对话模型；wb_list_models 传 all=true 可看其余项及原因）。\n`
      : `注意：safeOnly 已关闭，${this.catalog.length} 个模型全部可调用——其中含 disabled/别名/媒体等 WorkBuddy 不建议外部调用的项。\n`;

    const promoLines = this.promos
      .filter((p) => Array.isArray(p.modelIds) && p.modelIds.length > 0)
      .map((p) => {
        const base = this.findModel(p.modelIds[0]);
        const view = priceViewOf({ ...(base ?? { id: p.modelIds[0] }), promos: [p] }, now);
        const when = view.windowText || view.absoluteText || '';
        // 生效与否只看时段（promoActiveAt）：只挂徽标、不改价的促销没有 promoId，
        // 拿「是否改价」判断会把正在生效的徽标类活动标成「即将生效」。
        const flag = promoActiveAt(p, now) ? '生效中' : view.badgeActive ? '即将生效' : '未生效';
        return `- ${p.id}：${discountText(p)}${when ? `，${when}` : ''}，影响 ${p.modelIds.join('/')}（${flag}）`;
      });
    const promoBlock = promoLines.length > 0 ? `\n限时优惠：\n${promoLines.join('\n')}` : '';

    if (!all) {
      const body = groupBlocks.length > 0 ? groupBlocks.join('\n') : '（安全清单里的模型当前都不在目录中，先刷新目录。）';
      return `${current}${policy}\n${body}${promoBlock}`;
    }

    const otherRows = otherModels.map((m) => {
      const safety = classifyModel(m.id, m);
      return `- ${m.id}：${safety.label}——${safety.reason}`;
    });
    const otherBlock =
      otherRows.length > 0
        ? `\n\n其余 ${otherRows.length} 个模型（不建议通过外部软件调用${safeOnly ? '，当前会被拒绝' : '，但 safeOnly 已关闭'}）：\n${otherRows.join('\n')}`
        : '';
    return `${current}${policy}\n${groupBlocks.join('\n')}${otherBlock}${promoBlock}`;
  }

  async toolSelectModel(id) {
    const model = this.findModel(id);
    if (!model) return { text: `目录里没有模型「${id}」。先用 wb_list_models 看可用 id。`, failed: true };
    const reject = this.rejectUnsafeModel(id);
    if (reject) return { text: reject, failed: true };
    this.cfg.model = id;
    // 框架的 ctx.persist(patch) 必须带 patch；只写本 World 段内的字段。
    this.ctx.persist({ model: id });
    const price = this.priceOf(id);
    const mul =
      price && typeof price.effective === 'number'
        ? price.promoId !== undefined && typeof price.base === 'number' && price.effective < price.base
          ? `，此刻倍率 x${price.effective}（原价 x${price.base}${price.windowText ? `，${price.windowText}` : ''}）`
          : `，此刻倍率 x${price.effective}`
        : '';
    this.broadcast({ kind: 'selection', model: id });
    return `已选择 WorkBuddy 模型 ${model.name}（${id}）${mul}。之后 wb_chat 默认用它。`;
  }

  async toolChat({ prompt, model, system }) {
    if (!prompt) return { text: 'prompt 不能为空。', failed: true };
    // 桥接可用的前提：WorkBuddy 桌面端主进程在跑。
    await this.syncProc();
    if (!this.proc.running) {
      return { text: '未检测到 WorkBuddy 主进程：请先启动 WorkBuddy 桌面端再试。', failed: true };
    }
    const useId = model || this.cfg.model;
    if (!useId) {
      const suggestion = preferredSafeModel(this.safeModelIds());
      return {
        text: `尚未选择模型；先 wb_list_models 再 wb_select_model（建议 ${suggestion}）。`,
        failed: true,
      };
    }
    const reject = this.rejectUnsafeModel(useId);
    if (reject) return { text: reject, failed: true };
    const tokens = await this.ensureTokens();
    if (!tokens) return { text: '未发现 WorkBuddy 登录态，无法调用。', failed: true };
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const startedAt = Date.now();
    /** 记一笔账本；失败不影响本次调用的回执。 */
    const record = async (entry) => {
      try {
        await this.ledger.append({ ts: startedAt, model: useId, source: this.tokens?.source ?? '', ...entry });
      } catch (err) {
        this.log.warn?.(`workbuddy: 用量落盘失败：${err?.message ?? err}`);
      }
    };
    try {
      const { text, credit, usage } = await this.upstream().chat(
        tokens,
        { model: useId, messages, maxTokens: this.cfg.maxTokens },
        () => {},
      );
      const durationMs = Date.now() - startedAt;
      // 用响应完成时的价格记账，避免请求跨过折扣边界后仍写发起时的旧倍率。
      const price = this.priceOf(useId);
      const used = typeof usage?.credit === 'number' ? usage.credit : credit;
      await record({
        ok: true,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        cachedTokens: usage?.cachedTokens,
        reasoningTokens: usage?.reasoningTokens,
        credit: used,
        multiplier: price?.effective,
        baseMultiplier: price?.base,
        promoId: price?.promoId,
        durationMs,
      });
      // 跨午夜后先把今日小计翻篇，否则连续运行的 Coopanion 会把昨天的用量
      // 继续累加到今天的徽标 / envPrompt（用量面板的 summary.totals.today 是对的，
      // 两处「今日积分」互相矛盾 —— 审查报告第 4 条）。
      this.rollTodayIfNeeded();
      if (typeof used === 'number') this.today.credit += used;
      this.today.calls += 1;
      if (typeof usage?.promptTokens === 'number') this.today.prompt += usage.promptTokens;
      if (typeof usage?.completionTokens === 'number') this.today.completion += usage.completionTokens;

      const parts = [];
      if (typeof price?.effective === 'number') {
        parts.push(
          price.promoId !== undefined && typeof price.base === 'number' && price.effective < price.base
            ? `倍率 x${price.effective}（原价 x${price.base}${price.windowText ? `，${price.windowText}` : ''}）`
            : `倍率 x${price.effective}`,
        );
      }
      const head = `WorkBuddy 模型 ${useId}${parts.length ? `（${parts.join('，')}）` : ''} 回答：\n${text}`;
      const bits = [];
      if (typeof usage?.promptTokens === 'number') bits.push(`输入 ${usage.promptTokens} tok`);
      if (typeof usage?.completionTokens === 'number') bits.push(`输出 ${usage.completionTokens} tok`);
      if (typeof usage?.cachedTokens === 'number' && usage.cachedTokens > 0) bits.push(`缓存命中 ${usage.cachedTokens} tok`);
      if (typeof usage?.totalTokens === 'number') bits.push(`共 ${usage.totalTokens} tok`);
      if (typeof used === 'number') bits.push(`本次消耗积分 ${used}`);
      const usageLine = bits.length > 0 ? `\n用量：${bits.join(' / ')}（${durationMs} ms）` : '';
      return head + usageLine;
    } catch (err) {
      if (err instanceof WbUpstreamError && err.kind === 'session_dead') {
        this.tokens = null; // 下次调用重新发现
      }
      await record({ ok: false, error: String(err?.message ?? err), durationMs: Date.now() - startedAt });
      return { text: `WorkBuddy 调用失败：${err?.message ?? err}`, failed: true };
    }
  }

  async toolCredits() {
    await this.syncProc();
    if (!this.proc.running) {
      return { text: '未检测到 WorkBuddy 主进程：请先启动 WorkBuddy 桌面端再查积分。', failed: true };
    }
    const tokens = await this.ensureTokens();
    if (!tokens) return { text: '未发现 WorkBuddy 登录态。', failed: true };
    try {
      const { total, used, packages } = await this.upstream().fetchCredits(tokens);
      if (total === null) return '上游未返回积分数据。';
      this.lastBalance = { total, used: used ?? null, packages, at: Date.now() };
      void this.ledger.writeBalance(this.lastBalance).catch(() => {});
      const lines = packages.slice(0, 10).map((p) => `- ${p.name}：剩余 ${p.remain}${typeof p.used === 'number' ? `，已用 ${p.used}` : ''}`);
      const usedBit = typeof used === 'number' ? `（本周期已用 ${used}）` : '';
      return `当前积分合计约 ${total}${usedBit}${lines.length ? `\n${lines.join('\n')}` : ''}`;
    } catch (err) {
      return { text: `积分查询失败：${err?.message ?? err}`, failed: true };
    }
  }

  // -------------------------------------------------------------------------
  // WebUI
  // -------------------------------------------------------------------------

  webUi(language) {
    this.rollTodayIfNeeded(); // 详情页徽标同样要跟着本地日期翻篇
    const zh = language !== 'en';
    return {
      label: zh ? 'WorkBuddy 桥接' : 'WorkBuddy Bridge',
      lamps: [
        {
          label: 'WorkBuddy',
          state: this.tokens ? 'online' : this.lastError ? 'error' : 'offline',
          hint: this.tokens
            ? `已登录（${this.tokens.source}），目录 ${this.catalog.length} 个模型`
            : this.started
              ? this.lastError || '未发现登录态'
              : '正在读取登录态…',
        },
        {
          label: zh ? '主进程' : 'Process',
          state: this.proc.running ? 'online' : 'offline',
          hint: this.proc.running
            ? `WorkBuddy 在跑（pid ${this.proc.mainPid ?? '?'}，${this.proc.via}）`
            : this.started
              ? '未检测到 WorkBuddy 主进程'
              : '正在检测 WorkBuddy 主进程…',
        },
      ],
      // 0.3.5：顶部徽标（当前模型/倍率/今日积分）只在页面挂载时算一次，之后不会更新，
      // 会与面板内的实时状态打架，因此整段删除；这三处信息分别以
      // 模型目录芯片、逐模型倍率列、用量与成本面板为准。
      config: [WB_CONFIG_GROUP],
      panels: [
        {
          id: 'models',
          title: zh ? '模型目录' : 'Model catalog',
          description: zh
            ? '从 WorkBuddy 刷新模型目录，逐模型显示默认积分倍率，点选一个作为 wb_chat 的默认模型。'
            : 'Refresh the WorkBuddy catalog, see each model\'s default credit multiplier, and pick the default model for wb_chat.',
          getMethods: ['state'],
        },
        {
          id: 'account',
          title: zh ? '账号' : 'Account',
          description: zh
            ? '登录态来源、积分余额与手动 token 入口。token 只存密钥库，不上屏。'
            : 'Credential source, credit balance and manual token entry. Tokens live in the secret store only.',
          getMethods: ['state'],
        },
        {
          id: 'usage',
          title: zh ? '用量与成本' : 'Usage & cost',
          description: zh
            ? '经由 WorkBuddy 消耗的 token 量与积分量（本地记账）、积分包余额，以及当前生效的限时折扣 / 免费。'
            : 'Tokens and credits spent through WorkBuddy (locally recorded), the credit balance, and currently active time-limited discounts / free tiers.',
          getMethods: ['state'],
        },
      ],
      promptDocs: [
        {
          key: 'worlds.workbuddy.envPrompt',
          title: zh ? 'WorkBuddy 桥接 · 环境提示词' : 'WorkBuddy Bridge · env prompt',
          description: zh ? '桥接状态进 system 前缀的那一段。' : 'The bridge-status segment of the system prefix.',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'workbuddy.model', description: '当前选用的模型 id。' },
            { name: 'workbuddy.multiplier', description: '所选模型的默认积分倍率。' },
            { name: 'workbuddy.catalogSize', description: '目录里模型的数量。' },
            { name: 'workbuddy.authed', description: '是否已有可用登录态。' },
            { name: 'workbuddy.process', description: 'WorkBuddy 主进程状态：running / stopped。' },
            { name: 'workbuddy.safeOnly', description: '安全清单闸门：on（只放行公开对话模型）/ off。' },
            { name: 'workbuddy.todayCredit', description: '今日已消耗积分（本地记账）。' },
            { name: 'workbuddy.todayTokens', description: '今日 token 用量（本地记账）。' },
          ],
        },
      ],
      invoke: (panel, method, args) => this.handleInvoke(panel, method, args, language),
      stream: (panel, socket) => {
        if (panel !== 'models' && panel !== 'account' && panel !== 'usage') {
          socket.close('unknown panel');
          return;
        }
        this._sockets.add(socket);
        socket.onClose(() => this._sockets.delete(socket));
      },
    };
  }

  /** 某个模型此刻的价格视图（含限时折扣 / 免费）。 */
  priceOf(id) {
    const model = id ? this.findModel(id) : null;
    return model ? priceViewOf(model, Date.now()) : null;
  }

  selectedMultiplier() {
    const price = this.priceOf(this.cfg.model);
    if (!price) return null;
    if (typeof price.effective !== 'number') return null;
    if (price.effective === 0) return 'x0（限时免费）';
    return price.promoId !== undefined && price.effective < price.base
      ? `x${price.effective}（原价 x${price.base}）`
      : `x${price.effective}`;
  }

  /** 查一次积分包余额，落一份快照（面板与 wb_credits 共用）。 */
  async syncBalance() {
    const tokens = await this.ensureTokens();
    if (!tokens) return null;
    try {
      const r = await this.upstream().fetchCredits(tokens);
      /** @type {{ total: number | null, used: number | null, packages: unknown[], at: number }} */
      const snapshot = { total: r.total ?? null, used: r.used ?? null, packages: r.packages ?? [], at: Date.now() };
      this.lastBalance = snapshot;
      await this.ledger.writeBalance(snapshot);
      return snapshot;
    } catch (err) {
      this.log.warn?.(`workbuddy: 积分包快照失败：${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * 用量面板的数据面：本地账本聚合 + 积分包快照 + 促销清单。
   *
   * 口径：积分以每次调用 SSE 里的 `usage.credit` 为准（上游真实扣费）；
   * 倍率只用于「预估/解释」，不拿它去折算金额。
   *
   */
  async usageState() {
    const now = Date.now();
    // 0.3.0 每次打开面板都整文件重写一遍账本（prune 无条件执行）。只有确实存在
    // 超期行时才裁，且裁完重新读，保证聚合用的是裁剪后的内容。
    let records = await this.ledger.readAll();
    const cutoff = now - 90 * 864e5;
    if (records.some((r) => typeof r.ts !== 'number' || r.ts < cutoff)) {
      await this.ledger.prune(now);
      records = await this.ledger.readAll();
    }
    const summary = summarize(records, now);
    const balance = this.lastBalance ?? (await this.ledger.readBalance());
    const promos = this.promos.map((promo) => {
      const firstId = Array.isArray(promo.modelIds) ? promo.modelIds[0] : undefined;
      const base = firstId ? this.findModel(firstId) : null;
      const view = priceViewOf({ ...(base ?? { id: firstId ?? '' }), promos: [promo] }, now);
      return {
        id: promo.id,
        kind: promo.kind ?? '',
        source: promo.source ?? '',
        models: promo.modelIds ?? [],
        badge: promo.badge?.label ?? '',
        // 有的条目只是「徽标」（没有 discount 字段）：它的生效与否只能看时段，
        // 所以这里用 promoActiveAt 判断，而不是拿「是否改价」判断。
        active: promoActiveAt(promo, now),
        discountActive: view.promoId === promo.id,
        badgeActive: view.badgeActive,
        windowText: view.windowText,
        absoluteText: view.absoluteText,
        hoverText: view.hoverText ?? '',
        discountText: discountText(promo),
        effective: view.effective,
      };
    });
    return {
      ok: true,
      summary,
      balance,
      promos,
      catalogSource: this.catalogSource,
      catalogAt: this.catalogAt,
      model: this.cfg.model,
      price: this.priceOf(this.cfg.model),
      running: !!this.proc.running,
      authed: !!this.tokens,
    };
  }

  /** 本地日期键 YYYY-MM-DD（与 usage.dayKey 同口径，绝不用 toISOString 的 UTC 日期）。 */
  localDay(ms = Date.now()) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * 跨过本地午夜后把「今日」小计归零。
   *
   * envPromptVars() / webUi() 是同步的，不能在这里 await 账本；先把过期的计数清掉，
   * 下一次 refreshToday()（启动、清空账本）再从账本重算精确值。
   */
  rollTodayIfNeeded() {
    const day = this.localDay();
    if (this.today.day === day) return this.today;
    this.today = { day, credit: 0, calls: 0, prompt: 0, completion: 0 };
    return this.today;
  }

  /** 从账本重算今日小计（启动时 + 清空账本时调用）。 */
  async refreshToday() {
    const records = await this.ledger.readAll();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const day = this.localDay(start.getTime());
    const today = { day, credit: 0, calls: 0, prompt: 0, completion: 0 };
    for (const r of records) {
      if (typeof r?.ts !== 'number' || r.ts < start.getTime()) continue;
      today.calls += 1;
      if (typeof r.credit === 'number') today.credit += r.credit;
      if (typeof r.promptTokens === 'number') today.prompt += r.promptTokens;
      if (typeof r.completionTokens === 'number') today.completion += r.completionTokens;
    }
    this.today = today;
    return today;
  }

  broadcast(obj) {
    const text = JSON.stringify(obj);
    for (const s of this._sockets) {
      try {
        s.send(text);
      } catch {
        /* ignore */
      }
    }
  }

  /** 面板数据面。 */
  async handleInvoke(panel, method, args, language) {
    // 面板 ↔ 方法白名单。
    //
    // 之前任何 panel 都能调到 `setToken` / `clearToken`，等于把「写密钥库」暴露给
    // 任意页面的调用方。这里按声明收口：没列出来的组合直接拒绝。
    const allowed = PANEL_METHODS[panel];
    if (!allowed) throw new Error(`unknown panel: ${panel}`);
    if (!allowed.includes(method)) throw new Error(`panel ${panel} 不支持方法 ${method}`);

    // 「用量」面板：本地账本聚合 + 积分包快照 + 促销清单。积分以 usage.credit 为准，不拿倍率倒推。
    if (panel === 'usage') {
      if (method === 'state') return await this.usageState();
      if (method === 'refresh') {
        await this.syncBalance();
        return await this.usageState();
      }
      if (method === 'clear') {
        await this.ledger.clear();
        await this.refreshToday();
        this.broadcast({ kind: 'usage', cleared: true });
        return await this.usageState();
      }
      throw new Error(`unknown method: ${method}`);
    }
    if (method === 'state') {
      return {
        authed: !!this.tokens,
        tokenSource: this.tokens?.source ?? null,
        tokenMask: this.tokens?.accessToken ? maskToken(this.tokens.accessToken) : null,
        account: this.tokens?.account ?? null,
        baseUrl: this.baseUrl(),
        model: this.cfg.model,
        catalogAt: this.catalogAt,
        lastError: this.lastError,
        safeOnly: this.cfg.safeOnly !== false,
        models: this.catalog.map((m) => this.describeModel(m)),
        running: !!this.proc.running,
        mainPid: this.proc.mainPid,
      };
    }
    if (method === 'refresh') {
      try {
        const models = await this.refreshCatalog();
        return { ok: true, count: models.length, models };
      } catch (err) {
        this.lastError = err?.message ?? String(err);
        return { ok: false, error: this.lastError, noAuth: err instanceof WbUpstreamError && err.kind === 'session_dead' };
      }
    }
    if (method === 'select') {
      const id = String(args[0] ?? '');
      const found = this.findModel(id);
      if (!found) return { ok: false, error: `unknown model: ${id}` };
      const reject = this.rejectUnsafeModel(id);
      if (reject) return { ok: false, error: reject, unsafe: true };
      this.cfg.model = id;
      this.ctx.persist({ model: id });
      return { ok: true, model: id, multiplier: found.creditMultiplier ?? null };
    }
    if (method === 'setToken') {
      const token = String(args[0] ?? '').trim();
      if (!token) return { ok: false, error: 'empty token' };
      this.ctx.storeSecret('accessToken', token);
      this.tokens = { accessToken: token, source: 'manual' };
      this.lastError = '';
      return { ok: true, mask: maskToken(token) };
    }
    if (method === 'clearToken') {
      // 写哨兵而不是空串（空串会被框架拒掉），并回读确认——写不进去就如实报错。
      let stored = false;
      try {
        this.ctx.storeSecret('accessToken', TOKEN_CLEARED);
        stored = this.ctx.secret('accessToken') === TOKEN_CLEARED;
      } catch (err) {
        return { ok: false, error: `写入失败：${err?.message ?? err}` };
      }
      this.tokens = null;
      // 立刻给出可操作提示：0.3.0 要等重启后 loadTokens 才设 lastError，
      // 当下灯只显示「未发现登录态」，用户不知道该点「重新探测」。
      this.lastError = '已登出：点「重新探测」或重新填 token 才能继续使用。';
      if (!stored) return { ok: false, error: '密钥库拒绝了写入，未能登出。' };
      return { ok: true, authed: false };
    }
    if (method === 'credits') {
      const tokens = await this.ensureTokens();
      if (!tokens) return { ok: false, error: t(language, 'noAuth') };
      try {
        const r = await this.upstream().fetchCredits(tokens);
        this.lastBalance = { total: r.total ?? null, used: r.used ?? null, packages: r.packages ?? [], at: Date.now() };
        void this.ledger.writeBalance(this.lastBalance).catch(() => {});
        return { ok: true, ...r };
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    }
    if (method === 'rediscover') {
      // 只有「密钥库里还留着 wb-cleared 登出哨兵」时才需要把它换成 wb-auto。
      // 用户手动粘贴过 token 时 loadTokens() 直接返回那份 manual token，
      // 0.3.0 这时仍写 TOKEN_AUTO，把密钥库里的真 token 覆盖掉，重启后手动 token 丢失
      // （审查报告第 3 条）。
      let stored = null;
      try {
        stored = this.ctx.secret('accessToken');
      } catch {
        stored = null;
      }
      const wasCleared = stored === TOKEN_CLEARED;
      this.tokens = null;
      // 用户主动要求重新探测：这时才允许越过「已登出」哨兵去读数据目录。
      await this.loadTokens({ rediscover: true });
      if (this.tokens?.accessToken && wasCleared) {
        // 探测成功就把哨兵从「已登出」换成「允许自动发现」：
        // 否则密钥库里留着 wb-cleared，扩展一重启又会变回未登录（审查报告第 2 条）。
        try {
          this.ctx.storeSecret('accessToken', TOKEN_AUTO);
        } catch (err) {
          this.log.warn?.(`workbuddy: 更新凭据哨兵失败（下次启动可能仍需重新探测）：${err?.message ?? err}`);
        }
      }
      return { ok: true, authed: !!this.tokens, source: this.tokens?.source ?? null, error: this.tokens ? null : this.lastError };
    }
    throw new Error(`unknown method: ${method}`);
  }
}
