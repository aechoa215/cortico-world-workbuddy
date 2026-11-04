/**
 * 模型安全清单（合规口径）。
 *
 * 依据：WorkBuddy 官方对话给出的「避免违反用户协议/触发风控」筛选原则——
 * 只调用「官方公开目录里、当前可正常对话」的模型；凡是 disabled、内部路由别名、
 * 状态不明（请求格式报错）、媒体/代码补全模型，一律不通过外部软件调用。
 *
 * 这里把结论固化成三件事：
 *   1. SAFE_MODEL_IDS：可直接用 wb_chat 调用的白名单（0.3.6 起 18 个：0.3.5 的 17 个
 *      去掉已下架的 hy4-preview，补上 HY4 的新 id hy4free / hy4std）；
 *   2. classifyModel()：给目录里每个模型打等级与理由，供面板展示与拦截；
 *   3. DEFAULT_SAFE_MODEL：当前选择失效时的回落项（同样是白名单内的 flash 档）。
 *
 * 0.3.5 按官方选择器重新校对过一遍：目录里仍有、但应用选择器不显示的 id
 * （deepseek-v4-flash / deepseek-v3-2-volc / hy3-b / hy3-c / hy3-x / kimi-k2.5 /
 * minimax-m2.7 / hunyuan-chat）不再放行；其中 hunyuan-chat 在 v3 目录里没有
 * credits 字段，倍率无法核验。旧 id kimi-k3-1 在 v3 目录中已不存在，换成 kimi-k3-2。
 *
 * 0.3.6 跟进上游 HY4 改版（2026-11-04 拉取目录核对）：显示名同为「Hy4」的 id 变成两个——
 * hy4free（带「限时免费」促销，比照 hy3 记为谨慎档）与 hy4std（x0.29 常规定价、非 preview，
 * 按公开对话模型放行）；原 hy4-preview 已从目录消失，从白名单摘掉并并入 DELISTED_IDS 置灰。
 * 同前缀的 hy4-preview-ctrl / hy4-preview-exp / hy4preview-exp1 / hy4preview-exp2 仍按实验预览拦下。
 *
 * 清单会随官方目录变化而过时——这正是 classifyModel 返回 safe=false 时给出
 * 「不在安全清单内」的原因，而不是断言模型不可用。用户可以显式关掉 safeOnly
 * 自行承担风险，扩展不做单方面放行。
 */

/** WorkBuddy 选择器里的公开对话模型白名单。 */
export const SAFE_MODEL_IDS = [
  // DeepSeek
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  // GLM
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.3-flashx',
  'glm-5.2',
  // 混元
  'hy3',
  // HY4：2026-11-04 目录改版后 hy4-preview 已消失，拆成两个 id，显示名都叫「Hy4」。
  // hy4free 带「限时免费」促销（比照 hy3 进 CAUTION）；hy4std 是 x0.29 常规定价、非 preview。
  'hy4free',
  'hy4std',
  // Kimi
  'kimi-k2.8-preview',
  'kimi-k3-2',
  'kimi-k3.1-pro',
  'kimi-k3.1-pro-highspeed',
  // 其他
  'minimax-m3-pay',
  'minimax-m3.1-flash',
  'mimo-v2.6-pro',
  'space-bunny',
  'step-5-preview',
];

/** 白名单分组（面板与 wb_list_models 用同一份顺序）。 */
export const SAFE_MODEL_GROUPS = [
  { label: 'DeepSeek', ids: ['deepseek-v4.1-flash', 'deepseek-v4-pro'] },
  { label: 'GLM', ids: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2'] },
  { label: '混元', ids: ['hy3', 'hy4free', 'hy4std'] },
  { label: 'Kimi', ids: ['kimi-k2.8-preview', 'kimi-k3-2', 'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'] },
  { label: '其他', ids: ['minimax-m3-pay', 'minimax-m3.1-flash', 'mimo-v2.6-pro', 'space-bunny', 'step-5-preview'] },
];

/** 白名单里属于「免费试用/预览」的模型：能用，但不适合高频自动化调用。 */
export const CAUTION_MODEL_IDS = ['hy3', 'kimi-k2.8-preview', 'step-5-preview', 'hy4free'];

/** 当前选择失效时的回落模型。 */
export const DEFAULT_SAFE_MODEL = 'deepseek-v4.1-flash';

/** 内部路由别名：疑似仅限 WorkBuddy 应用内 UI 使用。 */
const ALIAS_IDS = ['auto', 'fast-model', 'balanced-model', 'deep-model'];

/** 媒体生成模型：不属于 /v2/chat/completions 的对话范围。 */
const MEDIA_IDS = ['hunyuan-image-alpha', 'hunyuan-image-alpha-edit', 'kling-video-v3', 'minimax-video-h3'];

/** 代码补全模型：走补全接口，对话接口只会回空。 */
const CODE_IDS = ['codewise-rewrite', 'codewise-nes-a4-027-aide', 'codewise-jump', 'codewise-completions'];

/** 实测已下架（11102 service info not found）的模型，仅用于展示时置灰。 */
const RETIRED_IDS = [
  'hy4-preview-x',
  'minimax-m2.5',
  'glm-4.6v',
  'kimi-k2-thinking',
  'glm-4.6',
  'deepseek-v3-1-volc',
  'deepseek-v3-1',
  'deepseek-v3-0324-lkeap',
  'deepseek-r1-0528-lkeap',
  'kimi-k2-instruct-taiji',
  'completion-gf',
  'default-1.1',
  'default-1.2',
  'hunyuan-3b',
  'hunyuan-7b-dense',
  'hunyuan-2.0-instruct',
  'deepseek-r1-0528',
  'deepseek-v3-0324',
  'deepseek-v3-0324-taco-completion',
];

/**
 * 已从官方目录消失、但没有实测过 11102 的模型：展示时与「已下架」同样置灰，同样不放行。
 * 0.3.6：hy4-preview 被 HY4 的新 id（hy4free / hy4std）取代后不再出现在目录里。
 */
const DELISTED_IDS = ['hy4-preview'];

/** 请求格式不符（11150）的模型，状态不明。 */
const FORMAT_UNSUPPORTED_IDS = ['glm-5.0-turbo'];

/** 实验预览系列（能对话，但未列入安全清单）。 */
// 0.3.6 起这里不再放行任何 id：hy4-preview 本身已下架（见 DELISTED_IDS），同前缀的
// hy4-preview-ctrl / -exp / hy4preview-exp1 / -exp2 等实验号一律判成「实验预览·未列入安全清单」，
// 需要人工复核后才会加进白名单。
const EXPERIMENTAL_PREFIXES = ['hy4-preview', 'hy4preview-'];

const TIER_LABEL = {
  safe: '安全清单',
  caution: '安全清单（谨慎）',
  alias: '内部路由别名',
  disabled: '目录已标 disabled',
  media: '媒体生成模型',
  code: '代码补全模型',
  retired: '已下架',
  format: '状态不明',
  experimental: '实验预览',
  unknown: '不在安全清单',
};

function inList(id, list) {
  return list.includes(id);
}

function startsWithAny(id, prefixes) {
  return prefixes.some((p) => id.startsWith(p));
}

/**
 * 判定一个模型属于哪一档。
 * @param {string} id
 * @param {{ disabled?: boolean }} [model]
 * @returns {{ id: string, tier: string, label: string, reason: string, allow: boolean, caution: boolean }}
 */
export function classifyModel(id, model) {
  const mid = String(id ?? '');
  const make = (tier, reason) => ({
    id: mid,
    tier,
    label: TIER_LABEL[tier] ?? tier,
    reason,
    allow: tier === 'safe' || tier === 'caution',
    caution: tier === 'caution',
  });

  if (model?.disabled === true) return make('disabled', '目录里标了 disabled，WorkBuddy 明确建议不要调用');
  if (inList(mid, SAFE_MODEL_IDS)) {
    return inList(mid, CAUTION_MODEL_IDS)
      ? make('caution', '公开对话模型；属免费试用或 preview，能用但不适合高频自动化调用')
      : make('safe', '公开对话模型，WorkBuddy 建议的调用范围');
  }
  if (inList(mid, ALIAS_IDS)) return make('alias', '内部路由别名，疑似仅限 WorkBuddy 应用内使用');
  if (inList(mid, MEDIA_IDS)) return make('media', '图像/视频生成模型，不在对话接口范围内');
  if (inList(mid, CODE_IDS)) return make('code', '代码补全模型，对话接口不会给出正文');
  if (inList(mid, RETIRED_IDS)) return make('retired', '已下架（11102 service info not found）');
  if (inList(mid, DELISTED_IDS)) return make('retired', '已从官方目录移除（0.3.6 核对），不再放行');
  if (inList(mid, FORMAT_UNSUPPORTED_IDS)) return make('format', '请求格式不符（11150），状态不明');
  if (startsWithAny(mid, EXPERIMENTAL_PREFIXES)) return make('experimental', '实验预览模型，未列入安全清单');
  return make('unknown', 'WorkBuddy 未把它列为公开对话模型');
}

/** 白名单模型的建议默认次序：优先 flash 档，避开试用/预览。 */
export function preferredSafeModel(availableIds = SAFE_MODEL_IDS) {
  const order = [DEFAULT_SAFE_MODEL, 'glm-5.3-flash', 'minimax-m3.1-flash'];
  for (const id of order) if (availableIds.includes(id)) return id;
  const firstStable = availableIds.find((id) => inList(id, SAFE_MODEL_IDS) && !inList(id, CAUTION_MODEL_IDS));
  return firstStable ?? DEFAULT_SAFE_MODEL;
}

/** 白名单按分组展开，只保留确实在目录里的。 */
export function safeGroupsOf(availableIds) {
  const set = new Set(availableIds ?? []);
  return SAFE_MODEL_GROUPS.map((g) => ({ label: g.label, ids: g.ids.filter((id) => set.has(id)) })).filter(
    (g) => g.ids.length > 0,
  );
}
