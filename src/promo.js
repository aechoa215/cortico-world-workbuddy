/**
 * WorkBuddy 的「限时折扣 / 限时免费 / 订阅优先」徽标与价格。
 *
 * 上游把促销放在 `/v3/config` 的 `modelPromotions` 与 `modelTiers` 里，**和模型目录同一份
 * 文档**，所以读一次目录就能拿到，不需要额外请求。关键点是：促销是「时钟的函数」——
 * `schedule.daily` 描述每天哪几个小时打折（例如每晚 23:00–07:50 打五折），`schedule.validFrom`
 * / `validUntil` 描述活动本身的有效期。因此这里**不在拉取时解析成死值**，只把候选促销
 * 原样挂到模型上，谁在生效、折扣多少一律在渲染/计算的那一刻按当前时间判断。
 *
 * 上游字段（2026-11-03 实测 CN `/v3/config`）：
 *   modelPromotions: [
 *     { id, kind:'discount', enabled, priority, modelIds:['glm-5.2'],
 *       badge: { label:'夜间折扣', shortLabel?, color, icon, display?:'activeOnly' },
 *       hover: { textZh:'每晚 23:00—次日 8:00 积分限时立减…', action:{type:'selectModel'} },
 *       discount: { discountedCredits:'0.50x', factor:0.5, displayMode:'strikethrough' },
 *       schedule: { timezone:'Asia/Shanghai', daily:[{ start:'23:00', end:'7:50' }] } },
 *   ]
 *   modelTiers: [ { id:'tier-standard-2026q3', badge:{label:'订阅优先'}, modelIds:[...] } ]
 *
 * 与模型自身的 `credits`（目录倍率，例如 `"x0.11"`）的关系：
 *   - `displayMode:'replace'`   → 促销价就是当前倍率；
 *   - `displayMode:'strikethrough'` → 目录价划线、促销价为实际价（本模块同样取促销价）。
 *   没有可用折扣的促销（只有徽标，例如「订阅优先」）不改变倍率。
 */

/** WorkBuddy 未声明时区时的默认活动时区。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** `'HH:mm'` → 当天分钟数；`24:00` 表示 1440（一天的终点）。 */
export function minutesOfClock(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined;
  if (minutes > 59) return undefined;
  if (hours > 24) return undefined;
  if (hours === 24) return minutes === 0 ? 1440 : undefined;
  return hours * 60 + minutes;
}

/** 在 `timeZone` 里、`nowMs` 时刻是当天第几分钟。时区不可用时退回 UTC，而不是抛错。 */
function minutesInZone(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  return hour * 60 + minute;
}

/**
 * 某时区此刻的「当天分钟数」。
 *
 * 上层传进来的时区可能不合法（上游偶尔给 'Asia/Shanghai ' 这种带空格的写法，
 * 或者干脆给个拼错的区名）。这时退回 UTC 继续判定，绝不像以前那样直接返回 0——
 * 返回 0 等于把所有活动都当成「在 00:00 生效」，过期促销会被误判成正在打折。
 */
export function zonedMinutes(nowMs, timeZone) {
  const wanted = typeof timeZone === 'string' && timeZone.trim() !== '' ? timeZone.trim() : DEFAULT_TIMEZONE;
  try {
    return minutesInZone(nowMs, wanted) ?? NaN;
  } catch {
    try {
      return minutesInZone(nowMs, 'UTC') ?? NaN;
    } catch {
      return NaN;
    }
  }
}

/** 把 YYYY-MM-DD 的当地午夜换算成时间戳；非法时区沿用每日时段的 UTC 回退。 */
function zonedDateTimestamp(year, month, day, timeZone) {
  const target = Date.UTC(year, month - 1, day);
  const wanted = typeof timeZone === 'string' && timeZone.trim() !== '' ? timeZone.trim() : DEFAULT_TIMEZONE;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: wanted,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  }
  let guess = target;
  // 先按 UTC 猜，再用该时区偏移修正；迭代两次可覆盖 DST 切换前后的偏移变化。
  for (let i = 0; i < 2; i += 1) {
    const parts = formatter.formatToParts(new Date(guess));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    guess = target - (localAsUtc - guess);
  }
  return guess;
}

/**
 * 把上游给的时间点归一成毫秒时间戳。
 * 数字也认（< 1e12 视为 Unix 秒）；纯日期按活动时区解释，validUntil 含当天整日。
 */
export function timestampOf(value, timeZone, endOfDay = false) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return timestampOf(Number(text));
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      const check = new Date(Date.UTC(year, month - 1, day));
      if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
      return zonedDateTimestamp(year, month, day + (endOfDay ? 1 : 0), timeZone);
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** 是否落在任一每日时段内（支持跨零点的 23:00→7:50）。 */
export function withinDailyWindows(windows, nowMinutes) {
  return windows.some((w) => {
    const start = minutesOfClock(w.start);
    const end = minutesOfClock(w.end);
    if (start === undefined || end === undefined) return false;
    if (start === end) return true;
    if (end > start) return nowMinutes >= start && nowMinutes < end;
    return nowMinutes >= start || nowMinutes < end;
  });
}

/** 活动的绝对有效期是否覆盖此刻。 */
export function promoWithinAbsoluteWindow(promo, nowMs) {
  const schedule = promo?.schedule;
  if (schedule === undefined) return true;
  if (schedule.validFrom !== undefined && nowMs < schedule.validFrom) return false;
  if (schedule.validUntil !== undefined && nowMs >= schedule.validUntil) return false;
  return true;
}

/**
 * 活动的每日时段是否覆盖此刻。
 *
 * 上游说了有时段但我们读不懂（`dailyUnusable`）时按「不生效」处理：宁可少报一次折扣，
 * 也不能凭空宣称正在打折。
 */
export function promoWithinDailyWindow(promo, nowMs) {
  const schedule = promo?.schedule;
  if (schedule === undefined) return true;
  if (schedule.dailyUnusable === true) return false;
  if (schedule.daily === undefined || schedule.daily.length === 0) return true;
  return withinDailyWindows(schedule.daily, zonedMinutes(nowMs, schedule.timezone));
}

/** 此刻是否生效（绝对窗口 + 每日时段都成立）。 */
export function promoActiveAt(promo, nowMs) {
  return promoWithinAbsoluteWindow(promo, nowMs) && promoWithinDailyWindow(promo, nowMs);
}

/** 促销是否自带任何时间声明（自带时间才可能「现在生效」）。 */
export function hasSchedule(promo) {
  return promo?.schedule !== undefined;
}

/** `"0.11x"` / `"0.11"` / `0.11` → 0.11；无法解析时 undefined。 */
export function multiplierOfText(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  // 上游把倍率写成 `"x0.11"`，也见过 `"0.11x"`；两种前缀/后缀都剥掉。
  const stripped = value.trim().replace(/^x/i, '').replace(/x$/i, '').trim();
  if (stripped === '') return undefined;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * 此刻应当**画在界面上**的倍率：`priority` 高者优先，同为促销时「促销」优先于「会员档」；
 * 只认有可用折扣、且此刻生效的条目。没有则返回 undefined（沿用目录价）。
 */
function sortByPriority(promos) {
  return [...promos].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.source === b.source ? 0 : a.source === 'promotion' ? -1 : 1),
  );
}

/**
 * 此刻真正改价的那条促销。
 *
 * 以前 selectPromoMultiplier() 只返回倍率、priceViewOf() 又去重新挑一条「优先级最高」的
 * 活动来读 promoId/windowText：当高优先级那条只有徽标没有折扣时，面板就会显示
 * 「倍率取自 A、时段取自 B」的错配。这里把「哪条活动改的价」和「价是多少」绑在一起返回。
 * @returns {{ promo: Record<string, any>, multiplier: number } | undefined}
 */
export function selectPromoDiscount(promos, nowMs) {
  if (!Array.isArray(promos) || promos.length === 0) return undefined;
  for (const promo of sortByPriority(promos)) {
    const discount = promo.discount;
    if (discount === undefined || discount.multiplier === undefined) continue;
    if (discount.displayMode !== 'replace' && discount.displayMode !== 'strikethrough') continue;
    if (!promoActiveAt(promo, nowMs)) continue;
    return { promo, multiplier: discount.multiplier };
  }
  return undefined;
}

/** 此刻生效的倍率（没有活动命中时返回 undefined，交给调用方回落目录价）。 */
export function selectPromoMultiplier(promos, nowMs) {
  return selectPromoDiscount(promos, nowMs)?.multiplier;
}

/**
 * 此刻该展示的徽标：优先「正在跑」的活动（带时间声明的），其次带绝对时间且未过期的；
 * `badge.display === 'activeOnly'` 的档位徽标（例如「订阅优先」）不会在空闲时抢镜。
 */
export function selectPromoBadge(promos, nowMs) {
  if (!Array.isArray(promos) || promos.length === 0) return undefined;
  const sorted = sortByPriority(promos);
  const running = sorted.find((promo) => hasSchedule(promo) && promoActiveAt(promo, nowMs));
  if (running !== undefined) return running;
  return sorted.find(
    (promo) => promo.badge?.display !== 'activeOnly' && promoWithinAbsoluteWindow(promo, nowMs) && promo.schedule?.dailyUnusable !== true,
  );
}

/** 每日时段的短文案：`23:00–07:50`；多个时段用「、」连接。 */
export function dailyWindowText(promo) {
  const daily = promo?.schedule?.daily;
  if (!Array.isArray(daily) || daily.length === 0) return '';
  const pad = (v) => {
    const m = minutesOfClock(v);
    if (m === undefined) return v;
    if (m === 1440) return '24:00';
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  return daily.map((w) => `${pad(w.start)}–${pad(w.end)}`).join('、');
}

/** 绝对有效期文案：`即日起` / `至 2026-10-08` / `2026-10-02 ~ 2026-10-08`。 */
export function absoluteWindowText(promo, formatDate) {
  const schedule = promo?.schedule;
  const fmt = formatDate ?? ((ms) => new Date(ms).toISOString().slice(0, 10));
  const from = schedule?.validFrom;
  const until = schedule?.validUntil;
  // 纯日期的 validUntil 在内部存成次日 00:00（排他边界），展示仍用上游写的当天日期。
  const untilText = schedule?.validUntilDate ?? (until === undefined ? undefined : fmt(until));
  if (from === undefined && until === undefined) return '';
  if (from !== undefined && until !== undefined) return `${fmt(from)} ~ ${untilText}`;
  if (from !== undefined) return `${fmt(from)} 起`;
  return `至 ${untilText}`;
}

/** 折扣文案：`5 折（0.50x）`、`免费（0x）`。 */
export function discountText(promo) {
  const discount = promo?.discount;
  if (discount === undefined || discount.multiplier === undefined) return '';
  const m = discount.multiplier;
  if (m === 0) return '限时免费';
  const tenths = m * 10;
  const rounded = Math.round(tenths * 10) / 10;
  const label = `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} 折`;
  return `${label}（${String(m)}x）`;
}

/** 上游 `discount` 字段 → 归一化折扣。 */
function parseDiscount(raw) {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const fromString = multiplierOfText(raw.discountedCredits);
  const fromFactor =
    typeof raw.factor === 'number' && Number.isFinite(raw.factor) && raw.factor >= 0 ? raw.factor : undefined;
  const multiplier = fromString ?? fromFactor;
  const displayMode = raw.displayMode === 'replace' || raw.displayMode === 'strikethrough' ? raw.displayMode : undefined;
  if (multiplier === undefined && displayMode === undefined) return undefined;
  return {
    ...(multiplier === undefined ? {} : { multiplier }),
    ...(displayMode === undefined ? {} : { displayMode }),
  };
}

/** 上游 `schedule` → 归一化时段。 */
export function parseSchedule(raw) {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const timezone = typeof raw.timezone === 'string' && raw.timezone !== '' ? raw.timezone : undefined;
  const validFrom = timestampOf(raw.validFrom, timezone);
  const validUntil = timestampOf(raw.validUntil, timezone, true);
  const validUntilDate = typeof raw.validUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.validUntil.trim())
    ? raw.validUntil.trim()
    : undefined;
  const rawDaily = Array.isArray(raw.daily) ? raw.daily : undefined;
  const daily =
    rawDaily === undefined
      ? undefined
      : rawDaily
          .map((w) => ({ start: w?.start, end: w?.end }))
          .filter((w) => minutesOfClock(w.start) !== undefined && minutesOfClock(w.end) !== undefined);
  // 上游确实给了时段、但一条都解析不出来时，绝不能当成「没有时段限制」全时段生效。
  // 0.3.0 写成 `daily === undefined && ...`，而过滤后得到的是空数组 []，判定恒为 false，
  // 于是把写错的时段当作全天打折（审查报告第 2 条）。
  const dailyUnusable = rawDaily !== undefined && rawDaily.length > 0 && (daily === undefined || daily.length === 0);
  if (
    timezone === undefined &&
    validFrom === undefined &&
    validUntil === undefined &&
    daily === undefined &&
    !dailyUnusable
  ) {
    return undefined;
  }
  return {
    ...(timezone === undefined ? {} : { timezone }),
    ...(validFrom === undefined || Number.isNaN(validFrom) ? {} : { validFrom }),
    ...(validUntil === undefined || Number.isNaN(validUntil) ? {} : { validUntil }),
    ...(validUntilDate === undefined || validUntil === undefined ? {} : { validUntilDate }),
    ...(daily === undefined ? {} : { daily }),
    ...(dailyUnusable ? { dailyUnusable: true } : {}),
  };
}

/** 一条上游条目 → 归一化促销；不是促销（无 modelIds / 无 badge / enabled:false）时返回 undefined。 */
function parsePromo(raw, source) {
  if (typeof raw !== 'object' || raw === null) return undefined;
  if (raw.enabled === false) return undefined;
  const modelIds = Array.isArray(raw.modelIds) ? raw.modelIds.filter((id) => typeof id === 'string' && id !== '') : [];
  if (modelIds.length === 0) return undefined;
  const badgeLabel =
    typeof raw.badge?.label === 'string' ? raw.badge.label : typeof raw.badge?.shortLabel === 'string' ? raw.badge.shortLabel : '';
  const hoverText =
    typeof raw.hover?.textZh === 'string' ? raw.hover.textZh : typeof raw.hover?.textEn === 'string' ? raw.hover.textEn : '';
  // 以前这里只看 badge / hover：一条只改价、没有文案的促销会被整条丢掉，
  // 于是「某模型某时段打折」静默失效。现在 discount 也算有效内容。
  const schedule = parseSchedule(raw.schedule);
  const discount = parseDiscount(raw.discount);
  if (badgeLabel === '' && hoverText === '' && discount === undefined) return undefined;
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : `${source}:${modelIds.join(',')}`;
  return {
    id,
    source,
    modelIds,
    badge: {
      label: badgeLabel,
      ...(typeof raw.badge?.shortLabel === 'string' ? { shortLabel: raw.badge.shortLabel } : {}),
      ...(typeof raw.badge?.color === 'string' ? { color: raw.badge.color } : {}),
      ...(raw.badge?.display === 'activeOnly' ? { display: 'activeOnly' } : {}),
    },
    ...(hoverText === '' ? {} : { hoverText }),
    ...(schedule === undefined ? {} : { schedule }),
    ...(discount === undefined ? {} : { discount }),
    priority: typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : 0,
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
  };
}

/** `modelPromotions` + `modelTiers` → 归一化促销列表（促销在前，平手时促销优先）。 */
export function parsePromos(rawPromotions, rawTiers) {
  const promos = [];
  for (const entry of Array.isArray(rawPromotions) ? rawPromotions : []) {
    const promo = parsePromo(entry, 'promotion');
    if (promo !== undefined) promos.push(promo);
  }
  for (const entry of Array.isArray(rawTiers) ? rawTiers : []) {
    const tier = parsePromo(entry, 'tier');
    if (tier !== undefined) promos.push(tier);
  }
  return promos;
}

/** 把促销挂到它点名的每个模型上（原样保留候选，生效与否留给渲染时判断）。 */
export function attachPromos(models, promos) {
  if (!Array.isArray(promos) || promos.length === 0) return [...models];
  const byModel = new Map();
  for (const promo of promos) {
    for (const modelId of promo.modelIds) {
      const list = byModel.get(modelId);
      if (list === undefined) byModel.set(modelId, [promo]);
      else list.push(promo);
    }
  }
  return models.map((model) => {
    const list = byModel.get(model.id);
    return list === undefined ? model : { ...model, promos: [...list] };
  });
}

/**
 * 某个模型此刻的价格视图。
 *
 * 返回 `{ base, effective, promoId, badge, windowText, hoverText, isFree }`：
 *   - `base`      目录里的 `credits` 倍率；
 *   - `effective` 此刻实际生效的倍率（无折扣时等于 `base`）；
 *   - `windowText` 生效中且有每日时段时给出「23:00–07:50」这类文案，供界面直接显示。
 */
export function priceViewOf(model, nowMs) {
  const base = model?.creditMultiplier ?? multiplierOfText(model?.credits);
  const promos = Array.isArray(model?.promos) ? model.promos : [];
  // 只认「真的改了价」的那条：它的倍率、时段、折扣文案必须同源，
  // 否则会出现「倍率来自夜间折扣、时段文案来自另一个只有徽标的活动」这种错配。
  const chosen = selectPromoDiscount(promos, nowMs);
  const badgePromo = selectPromoBadge(promos, nowMs);
  const effective = chosen === undefined ? base : chosen.multiplier;
  // 没有改价活动时，时段文案退回当前生效的活动（例如只有徽标、只做展示的那种）。
  const windowPromo = chosen?.promo ?? sortByPriority(promos.filter((p) => promoActiveAt(p, nowMs)))[0];
  const windowText = windowPromo !== undefined && hasSchedule(windowPromo) ? dailyWindowText(windowPromo) : '';
  const absoluteText = windowPromo !== undefined && hasSchedule(windowPromo) ? absoluteWindowText(windowPromo) : '';
  const discounted =
    chosen !== undefined && typeof base === 'number' && typeof effective === 'number' && effective < base;
  return {
    base,
    effective,
    /** 是否真的比目录价便宜（0 元活动也算便宜，只要目录价 > 0）。 */
    discounted,
    promoId: chosen?.promo?.id,
    badge: badgePromo?.badge?.label,
    badgeActive: badgePromo !== undefined && promoActiveAt(badgePromo, nowMs),
    windowText,
    absoluteText,
    hoverText: badgePromo?.hoverText,
    discount: chosen === undefined ? undefined : discountText(chosen.promo),
    isFree: effective === 0,
  };
}
