/**
 * WorkBuddy 桥接 World：发现本机登录态 → 读模型目录（含默认积分倍率）→
 * 面板选模型 → wb_* 工具供 Coo 调用所选模型。
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { WB_CONFIG_GROUP } from './config.js';
import { WB_REGION_BASE, WbUpstream, WbUpstreamError } from './upstream.js';
import { discoverCredentials, maskToken, resolveTokensWithKey } from './credentials.js';
import { detectWorkBuddy } from './wbproc.js';
import { attachPromos, dailyWindowText, discountText, priceViewOf, promoActiveAt } from './promo.js';
import { UsageLedger, summarize } from './usage.js';
import { backupPathOf, describeHostInjection, ensureHostInjection, findAppRoot, inspectHostInjection, removeHostInjection } from './host.js';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
/** 开始页注入脚本的源码（装到宿主 console 目录的那份就是它）。 */
const HOST_INJECTOR_FILE = fileURLToPath(new URL('../assets/workbuddy-home.js', import.meta.url));
const CATALOG_FILE = 'workbuddy-catalog.json';
/** 本包版本号，写进注入脚本尾部，宿主升级后能看出是哪一版注入的。 */
const PKG_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version ?? '';
  } catch {
    return '';
  }
})();

/** 面板可用的语言文案。 */
const L10N = {
  zh: {
    noAuth: '未发现本机 WorkBuddy 登录态。请先登录 WorkBuddy 客户端，或在「账号」面板手动粘贴 access token。',
    catalogEmpty: '模型目录为空，请在「模型目录」面板点「从 WorkBuddy 刷新」。',
    noModel: '尚未选择模型。请在「模型目录」面板选一个模型。',
  },
  en: {
    noAuth: 'No local WorkBuddy sign-in found. Sign in the WorkBuddy desktop app, or paste an access token in the Account panel.',
    catalogEmpty: 'Model catalog is empty. Click "Refresh from WorkBuddy" in the Models panel.',
    noModel: 'No model selected. Pick one in the Models panel.',
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
      'List the WorkBuddy models available to the signed-in account, each with its default credit multiplier (e.g. x0.79), context window and reasoning efforts. Read-only; costs nothing.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
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
      'Ask the selected WorkBuddy model a single-turn question and return its answer. This spends the user\'s own WorkBuddy credits at the model\'s multiplier; keep prompts concise. Use the model parameter only to override the selected model for one call.',
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
      'Show the remaining WorkBuddy credit balance of the signed-in account (read-only).',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

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
    /**
     * 主界面注入状态（开始页那排按钮）。宿主升级会覆盖 build/console，所以启动时自检 + 自动补注入。
     * @type {null | { appRoot: string, consoleDir: string, htmlPath: string, ok: boolean, reason: string, changed: string[], checkedAt: number }}
     */
    this.hostUi = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._hostTimer = null;
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
    return this.cfg.baseUrl || WB_REGION_BASE[this.cfg.region] || WB_REGION_BASE.cn;
  }

  upstream() {
    return new WbUpstream({ baseUrl: this.baseUrl(), log: this.log });
  }

  catalogPath() {
    return join(this.ctx.dataDir, CATALOG_FILE);
  }

  // -------------------------------------------------------------------------
  // WorkBuddy 主进程检测（「中转站优先」的前提条件）
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
      // 一次误判就会把「中转站优先」自动熄灭。确认一次再落定，避免抖动。
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

  /**
   * 检查（并在需要时修复）开始页注入。
   *
   * 宿主升级/重装会把 `resources/app/build/console` 整个覆盖掉，注入随之消失——
   * 此时按钮不见，但 `wb_*` 工具照常能用。所以这里「尽力而为」地补回来：
   * 找不到宿主目录、没有写权限、文件被锁，都只记 warn，绝不抛出去。
   *
   * @param {{ repair?: boolean }} [opts] repair=false 时只检查不动手。
   */
  async syncHostUi(opts = {}) {
    const repair = opts.repair === true;
    const appRoot = findAppRoot({ dataDir: this.ctx.dataDir, packageDir: this.ctx.packageDir });
    let state = inspectHostInjection(appRoot);
    const changed = [];
    if (repair && !state.ok && state.htmlFound) {
      let source = '';
      try {
        source = readFileSync(HOST_INJECTOR_FILE, 'utf8');
      } catch (err) {
        this.log.warn?.(`workbuddy: 读不到注入脚本 ${HOST_INJECTOR_FILE}：${err?.message ?? err}`);
      }
      if (source) {
        const r = ensureHostInjection({ appRoot, source, sourceVersion: PKG_VERSION });
        changed.push(...r.changed);
        state = r.state ?? state;
        if (!r.ok && r.reason) {
          this.log.warn?.(`workbuddy: 主界面按钮注入失败（${this.cfg.prefer ? '不影响桌宠调用，仅少了开始页入口' : '不影响使用'}）：${r.reason}`);
        } else if (r.changed.length > 0) {
          this.log.info?.(`workbuddy: 已修复主界面注入（${r.changed.join(', ')}），下次打开控制台即可看到按钮。`);
        }
      }
    }
    this.hostUi = { ...state, changed, checkedAt: Date.now() };
    return this.hostUi;
  }

  /**
   * 撤掉宿主注入（停用 / 卸载 / 退出时调用）。
   *
   * 扩展市场的硬规矩：改写宿主程序文件的扩展，停用或卸载时必须把改动还原，
   * 否则改动会一直留在本地——`cortico-world-coo-control` 就是因为这条被拉黑的。
   * 这里只剥引用行、删注入脚本和备份，不用旧备份覆盖 index.html（避免把宿主升级降级）。
   */
  async removeHostUi() {
    if (this.cfg.hostInject === false) return { ok: true, changed: [], reason: 'disabled' };
    try {
      const appRoot = findAppRoot({ dataDir: this.ctx.dataDir, packageDir: this.ctx.packageDir });
      const r = removeHostInjection(appRoot);
      if (r.changed.length > 0) {
        this.log.info?.(`workbuddy: 已还原主界面注入（${r.changed.join(', ')}），宿主文件恢复未改动状态。`);
      } else if (!r.ok && r.reason) {
        this.log.warn?.(`workbuddy: 还原主界面注入失败：${r.reason}`);
      }
      this.hostUi = r.state ? { ...r.state, changed: [], checkedAt: Date.now() } : null;
      return r;
    } catch (err) {
      const reason = String(err?.message ?? err);
      this.log.warn?.(`workbuddy: 还原主界面注入失败：${reason}`);
      return { ok: false, changed: [], reason };
    }
  }

  /** 主界面注入状态的行摘要（给面板/日志用）。 */
  hostUiLine() {
    if (!this.hostUi) return 'unknown';
    return describeHostInjection(this.hostUi);
  }

  /** 「中转站优先」是否打开。默认关。 */
  get preferOn() {
    return this.cfg.prefer === true;
  }
  /** 未开优先、或主进程没在跑时，真正能走中转站吗？ */
  get canRelay() {
    return this.preferOn && this.proc.running;
  }

  /**
   * 开关的唯一写入口：开始页按钮与 World 详情页开关都打这里，保证两边永远同一份状态。
   * @param {boolean} on
   */
  async setPrefer(on) {
    const value = on === true;
    this.cfg.prefer = value;
    try {
      this.ctx.persist({ prefer: value });
    } catch (err) {
      this.log.warn?.(`workbuddy: 保存「中转站优先」失败：${err?.message ?? err}`);
    }
    // 用缓存采样即可：定时器每 6s 刷一次，点开关不该卡在 tasklist 上。
    await this.syncProc();
    const state = this.priorityState();
    this.broadcast({ kind: 'priority', ...state });
    return state;
  }

  /** 开始页 / 详情页共用的状态对象。 */
  priorityState() {
    return {
      /** @type {boolean} */
      prefer: this.preferOn,
      /** @type {boolean} */
      running: !!this.proc.running,
      mainPid: this.proc.mainPid,
      via: this.proc.via,
      model: this.cfg.model || '',
      region: this.cfg.region,
      authed: !!this.tokens,
      catalogSize: this.catalog.length,
      checkedAt: this.proc.at,
      /** 开始页按钮是否已注入宿主（宿主升级会覆盖，启动时自动补回）。 */
      hostUi: this.hostUi
        ? {
            ok: !!this.hostUi.ok,
            reason: this.hostUi.reason ?? '',
            label: describeHostInjection(this.hostUi),
            consoleDir: this.hostUi.consoleDir ?? '',
            backup: backupPathOf(this.hostUi),
          }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // 凭据：手动粘贴（密钥库）优先，其次本机发现
  // -------------------------------------------------------------------------

  async loadTokens() {
    // 框架的 ctx.secret(name) 是同步的（读部署 .env / 进程环境），没有 Promise 的 catch。
    let manual = null;
    try {
      manual = this.ctx.secret('accessToken') || null;
    } catch {
      manual = null;
    }
    if (manual) {
      this.tokens = { accessToken: manual, source: 'manual' };
      return this.tokens;
    }
    const found = discoverCredentials(this.cfg.credentialsDir || undefined);
    if (found) {
      // 桌面端 5.6+ 的 token 是加密的：先试环境变量密钥，再问桌面端二进制要一次。
      const resolved = await resolveTokensWithKey(found.credential);
      if (resolved.accessToken) {
        this.tokens = resolved;
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
            region: this.cfg.region,
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
  // World 契约
  // -------------------------------------------------------------------------

  envPromptVars() {
    if (!this.cfg.envPrompt) return null;
    const price = this.priceOf(this.cfg.model);
    const promoBit =
      price && price.promoId !== undefined && typeof price.effective === 'number'
        ? `（限时 ${discountText(this.promos.find((p) => p.id === price.promoId)) || '优惠'}${price.windowText ? ` ${price.windowText}` : ''}）`
        : '';
    return {
      'workbuddy.region': this.cfg.region === 'global' ? 'international' : 'domestic (CN)',
      'workbuddy.model': this.cfg.model || '(none selected)',
      'workbuddy.multiplier':
        price && typeof price.effective === 'number' ? `x${price.effective}${promoBit}` : '(unknown)',
      'workbuddy.catalogSize': String(this.catalog.length),
      'workbuddy.authed': this.tokens ? 'yes' : 'no',
      'workbuddy.priority': this.preferOn ? 'on' : 'off',
      'workbuddy.process': this.proc.running ? 'running' : 'stopped',
      'workbuddy.todayCredit': String(Math.round(this.today.credit * 100) / 100),
      'workbuddy.todayTokens': String(this.today.prompt + this.today.completion),
    };
  }

  tools() {
    return [
      {
        ...WB_TOOL_DECLS[0],
        handler: async () => this.toolListModels(),
      },
      {
        ...WB_TOOL_DECLS[1],
        handler: async (args) => this.toolSelectModel(String(args.model ?? '')),
      },
      {
        ...WB_TOOL_DECLS[2],
        handler: async (args) =>
          this.toolChat({
            prompt: String(args.prompt ?? ''),
            model: typeof args.model === 'string' ? args.model : undefined,
            system: typeof args.system === 'string' ? args.system : undefined,
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
    this.loadCatalogFromDisk();
    await this.loadTokens();
    await this.syncProc(true);
    this._procTimer = setInterval(() => {
      void (async () => {
        const before = this.proc.running;
        try {
          const state = await this.syncProc(true);
          if (state.running !== before) this.broadcast({ kind: 'process', ...this.priorityState() });
          // 主进程退出后中转站不可能再用：把「中转站优先」一并熄灭，避免界面亮着却调不通。
          if (!state.running && this.preferOn) await this.setPrefer(false);
        } catch {
          /* 探测失败不改状态，等下一次 */
        }
      })();
    }, 6000);
    this._procTimer.unref?.();
    // 刚启动时探测偶尔比桌面端枚举慢半拍：1.2 秒后再确认一次，免得界面先亮出「未检测到主进程」。
    this._procConfirm = setTimeout(() => {
      void this.syncProc(true)
        .then(() => this.broadcast({ kind: 'process', ...this.priorityState() }))
        .catch(() => {});
    }, 1200);
    this._procConfirm.unref?.();
    // 开始页按钮的自检 + 自动补注入：宿主升级会覆盖 build/console，这里负责长回来。
    try {
      await this.syncHostUi({ repair: true });
    } catch (err) {
      this.log.warn?.(`workbuddy: 主界面注入自检失败（不影响 wb_* 工具）：${err?.message ?? err}`);
    }
    this._hostTimer = setInterval(() => {
      void this.syncHostUi({ repair: true }).catch(() => {});
    }, 60000);
    this._hostTimer.unref?.();
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
    await host.pushEvent({
      type: 'workbuddy.started',
      ts: new Date().toISOString(),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: this.tokens
        ? `WorkBuddy 桥接已挂载：${this.cfg.region} 区，目录 ${this.catalog.length} 个模型，当前模型 ${this.cfg.model || '(未选)'}。`
        : 'WorkBuddy 桥接已挂载，但未发现登录态；wb_* 工具暂不可用。',
    });
    this.started = true;
  }

  async stop() {
    // 先还原宿主改动再收摊：市场规矩是「停用/卸载不留痕」。
    await this.removeHostUi();
    if (this._procTimer) {
      clearInterval(this._procTimer);
      this._procTimer = null;
    }
    if (this._procConfirm) {
      clearTimeout(this._procConfirm);
      this._procConfirm = null;
    }
    if (this._hostTimer) {
      clearInterval(this._hostTimer);
      this._hostTimer = null;
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

  toolListModels() {
    if (this.catalog.length === 0) return `WorkBuddy 模型目录为空。${this.lastError || '请先在面板刷新目录。'}`;
    const now = Date.now();
    const lines = this.catalog.map((m) => {
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
    });
    const current = this.cfg.model
      ? `当前选择：${this.cfg.model}（此刻 ${this.selectedMultiplier() ?? '倍率未知'}）\n`
      : '当前未选择模型。\n';
    const promoLines = this.promos
      .filter((p) => Array.isArray(p.modelIds) && p.modelIds.length > 0)
      .map((p) => {
        const base = this.findModel(p.modelIds[0]);
        const view = priceViewOf({ ...(base ?? { id: p.modelIds[0] }), promos: [p] }, now);
        const when = view.windowText || view.absoluteText || '';
        const flag = view.promoId === p.id ? '生效中' : view.badgeActive ? '即将生效' : '未生效';
        return `- ${p.id}：${discountText(p)}${when ? `，${when}` : ''}，影响 ${p.modelIds.join('/')}（${flag}）`;
      });
    const promoBlock = promoLines.length > 0 ? `\n限时优惠：\n${promoLines.join('\n')}` : '';
    return current + lines.join('\n') + promoBlock;
  }

  async toolSelectModel(id) {
    const model = this.findModel(id);
    if (!model) return { text: `目录里没有模型「${id}」。先用 wb_list_models 看可用 id。`, failed: true };
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
    // 中转站可用的前提：WorkBuddy 桌面端主进程在跑。
    await this.syncProc();
    if (!this.proc.running) {
      return { text: '未检测到 WorkBuddy 主进程：请先启动 WorkBuddy 桌面端再试。', failed: true };
    }
    const useId = model || this.cfg.model;
    if (!useId) return { text: '尚未选择模型；先 wb_list_models 再 wb_select_model。', failed: true };
    const tokens = await this.ensureTokens();
    if (!tokens) return { text: '未发现 WorkBuddy 登录态，无法调用。', failed: true };
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const price = this.priceOf(useId);
    const startedAt = Date.now();
    /** 记一笔账本；失败不影响本次调用的回执。 */
    const record = async (entry) => {
      try {
        await this.ledger.append({ ts: startedAt, model: useId, region: this.cfg.region, source: this.tokens?.source ?? '', ...entry });
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
        promoId: price?.promoId,
        durationMs,
      });
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
        {
          label: zh ? '中转站优先' : 'Relay first',
          state: this.preferOn ? 'online' : 'offline',
          hint: this.preferOn ? '开：桌宠优先走 WorkBuddy 模型' : '关：跳过 WorkBuddy',
        },
        {
          label: zh ? '开始页按钮' : 'Home button',
          state: this.hostUi?.ok ? 'online' : this.hostUi ? 'error' : 'offline',
          hint: this.hostUi ? this.hostUiLine() : '正在检查宿主注入…',
        },
      ],
      badges: [
        { label: zh ? '区域' : 'Region', value: this.cfg.region, tone: 'plain' },
        {
          label: zh ? '当前模型' : 'Model',
          value: this.cfg.model || '—',
          tone: this.cfg.model ? 'on' : 'off',
        },
        {
          label: zh ? '倍率' : 'Multiplier',
          value: this.selectedMultiplier() ?? '—',
          tone: 'plain',
        },
        {
          label: zh ? '今日积分' : 'Today',
          value: `${Math.round(this.today.credit * 100) / 100}`,
          tone: this.today.credit > 0 ? 'on' : 'plain',
        },
      ],
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
          id: 'priority',
          title: zh ? '是否启用 WorkBuddy' : 'Enable WorkBuddy',
          description: zh
            ? '与「开始」页的「中转站优先」按钮同一份状态：打开后桌宠每轮对话优先调用 WorkBuddy 的模型，关闭则完全跳过。默认为关。'
            : 'Same state as the “Relay first” button on the Home page: when on, the pet asks a WorkBuddy model first every turn; when off, WorkBuddy is skipped entirely. Off by default.',
          getMethods: ['state'],
        },
        {
          id: 'usage',
          title: zh ? '用量' : 'Usage',
          description: zh
            ? '本机记账的调用用量（积分与 token）、WorkBuddy 积分包余额，以及当前生效的限时折扣 / 免费。'
            : 'Call usage recorded locally (credits and tokens), WorkBuddy credit balance, and currently active time-limited discounts / free tiers.',
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
            { name: 'workbuddy.region', description: '桥接的区域（国内 / 国际）。' },
            { name: 'workbuddy.model', description: '当前选用的模型 id。' },
            { name: 'workbuddy.multiplier', description: '所选模型的默认积分倍率。' },
            { name: 'workbuddy.catalogSize', description: '目录里模型的数量。' },
            { name: 'workbuddy.authed', description: '是否已有可用登录态。' },
            { name: 'workbuddy.priority', description: '「中转站优先」开关：on / off。' },
            { name: 'workbuddy.process', description: 'WorkBuddy 主进程状态：running / stopped。' },
            { name: 'workbuddy.todayCredit', description: '今日已消耗积分（本地记账）。' },
            { name: 'workbuddy.todayTokens', description: '今日 token 用量（本地记账）。' },
          ],
        },
      ],
      storage: [{ key: 'workbuddy-catalog', label: zh ? '模型目录缓存' : 'Model catalog cache' }],
      invoke: (panel, method, args) => this.handleInvoke(panel, method, args, language),
      stream: (panel, socket) => {
        if (panel !== 'models' && panel !== 'account' && panel !== 'priority' && panel !== 'usage') {
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
   */
  async usageState() {
    const now = Date.now();
    await this.ledger.prune(now);
    const records = await this.ledger.readAll();
    const summary = summarize(records, now, { days: 30 });
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
      region: this.cfg.region,
      running: !!this.proc.running,
      authed: !!this.tokens,
    };
  }

  /** 从账本重算今日小计（启动时 + 每次调用后调用）。 */
  async refreshToday() {
    const records = await this.ledger.readAll();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const day = start.toISOString().slice(0, 10);
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
    // 「中转站优先」：开始页按钮与 World 详情页开关共用这组方法，状态只有一个来源。
    if (panel === 'priority') {
      if (method === 'state') {
        await this.syncProc();
        return { ok: true, ...this.priorityState() };
      }
      if (method === 'set') {
        const on = args[0] === true || args[0] === 'on' || args[0] === 1 || args[0] === 'true';
        if (on) {
          await this.syncProc();
          if (!this.proc.running) {
            // 未检测到主进程：保持熄灭，并把原因交给调用方弹提示。
            const state = this.priorityState();
            return { ok: false, error: '未检测到Workbuddy', reason: 'no-process', ...state };
          }
        }
        const state = await this.setPrefer(on);
        return { ok: true, ...state };
      }
      if (method === 'process') {
        await this.syncProc(true);
        return { ok: true, ...this.priorityState() };
      }
      if (method === 'host') {
        // 只看不动：面板用它画「开始页按钮：已注入 / 可修复」。
        const state = await this.syncHostUi({ repair: false });
        return { ok: !!state.ok, hostUi: this.priorityState().hostUi, changed: state.changed };
      }
      if (method === 'repair') {
        // 手动修复入口：宿主升级覆盖了 build/console 之后，用户在面板上点一下就能补回来。
        const state = await this.syncHostUi({ repair: true });
        const hostUi = this.priorityState().hostUi;
        if (!state.ok) {
          return { ok: false, error: `主界面按钮修复失败：${state.reason || 'unknown'}`, hostUi };
        }
        this.broadcast({ kind: 'host', ...this.priorityState() });
        return { ok: true, hostUi, changed: state.changed };
      }
      throw new Error(`unknown method: ${method}`);
    }
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
        region: this.cfg.region,
        baseUrl: this.baseUrl(),
        model: this.cfg.model,
        catalogAt: this.catalogAt,
        lastError: this.lastError,
        models: this.catalog.map((m) => ({ ...m, price: priceViewOf(m, Date.now()) })),
        prefer: this.preferOn,
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
      this.cfg.model = id;
      this.ctx.persist({ model: id });
      return { ok: true, model: id, multiplier: found.creditMultiplier ?? null };
    }
    if (method === 'setToken') {
      const token = String(args[0] ?? '').trim();
      if (!token) return { ok: false, error: 'empty token' };
      this.ctx.storeSecret('accessToken', token);
      this.tokens = { accessToken: token, source: 'manual' };
      return { ok: true, mask: maskToken(token) };
    }
    if (method === 'clearToken') {
      try {
        this.ctx.storeSecret('accessToken', '');
      } catch {
        // 空值会被框架拒绝；清空手动密钥时忽略即可。
      }
      this.tokens = null;
      await this.loadTokens();
      return { ok: true, authed: !!this.tokens };
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
      this.tokens = null;
      await this.loadTokens();
      return { ok: true, authed: !!this.tokens, source: this.tokens?.source ?? null, error: this.tokens ? null : this.lastError };
    }
    throw new Error(`unknown method: ${method}`);
  }
}
