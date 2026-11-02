/**
 * 模型安全清单（合规口径）。
 *
 * 依据：WorkBuddy 官方对话给出的「避免违反用户协议/触发风控」筛选原则——
 * 只调用「官方公开目录里、当前可正常对话」的模型；凡是 disabled、内部路由别名、
 * 状态不明（请求格式报错）、媒体/代码补全模型，一律不通过外部软件调用。
 *
 * 这里把结论固化成三件事：
 *   1. SAFE_MODEL_IDS：可直接用 wb_chat 调用的白名单（WorkBuddy 给的 22 个）；
 *   2. classifyModel()：给目录里每个模型打等级与理由，供面板展示与拦截；
 *   3. DEFAULT_SAFE_MODEL：当前选择失效时的回落项（同样是白名单内的 flash 档）。
 *
 * 清单会随官方目录变化而过时——这正是 classifyModel 返回 safe=false 时给出
 * 「不在安全清单内」的原因，而不是断言模型不可用。用户可以显式关掉 safeOnly
 * 自行承担风险，扩展不做单方面放行。
 */

/** WorkBuddy 建议的公开对话模型白名单。 */
export const SAFE_MODEL_IDS = [
  // DeepSeek
  'deepseek-v4.1-flash',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v3-2-volc',
  // GLM
  'glm-5.3-flash',
  'glm-5.3',
  'glm-5.2',
  // 混元
  'hy3',
  'hy3-b',
  'hy3-c',
  'hy3-x',
  'hunyuan-chat',
  // 混元 4 预览：0.1.7 探测时它正忙（超时被判成不可用），用户指出后复测通过，
  // 按用户要求纳入白名单；仍属 preview 档，放在 CAUTION 里提示「别高频自动化」。
  'hy4-preview',
  // Kimi
  'kimi-k2.5',
  'kimi-k2.8-preview',
  'kimi-k3-1',
  'kimi-k3.1-pro',
  // 其他
  'minimax-m2.7',
  'minimax-m3.1-flash',
  'mimo-v2.6-pro',
  'space-bunny',
  'step-5-preview',
];

/** 白名单分组（面板与 wb_list_models 用同一份顺序）。 */
export const SAFE_MODEL_GROUPS = [
  { label: 'DeepSeek', ids: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v3-2-volc'] },
  { label: 'GLM', ids: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2'] },
  { label: '混元', ids: ['hy3', 'hy3-b', 'hy3-c', 'hy3-x', 'hunyuan-chat', 'hy4-preview'] },
  { label: 'Kimi', ids: ['kimi-k2.5', 'kimi-k2.8-preview', 'kimi-k3-1', 'kimi-k3.1-pro'] },
  { label: '其他', ids: ['minimax-m2.7', 'minimax-m3.1-flash', 'mimo-v2.6-pro', 'space-bunny', 'step-5-preview'] },
];

/** 白名单里属于「免费试用/预览」的模型：能用，但不适合高频自动化调用。 */
export const CAUTION_MODEL_IDS = ['hy3', 'hy3-b', 'hy3-c', 'kimi-k2.8-preview', 'step-5-preview', 'hy4-preview'];

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

/** 请求格式不符（11150）的模型，状态不明。 */
const FORMAT_UNSUPPORTED_IDS = ['glm-5.0-turbo'];

/** 实验预览系列（能对话，但未列入安全清单）。 */
// 只精确放行 hy4-preview 本身（在 SAFE_MODEL_IDS 里）；同前缀的新实验号（如 hy4-preview-v2）
// 仍然会被判成「实验预览·未列入安全清单」，需要人工复核后再加白名单。
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
  if (inList(mid, FORMAT_UNSUPPORTED_IDS)) return make('format', '请求格式不符（11150），状态不明');
  if (startsWithAny(mid, EXPERIMENTAL_PREFIXES)) return make('experimental', '实验预览模型，未列入安全清单');
  return make('unknown', 'WorkBuddy 未把它列为公开对话模型');
}

/** 白名单模型的建议默认次序：优先 flash 档，避开试用/预览。 */
export function preferredSafeModel(availableIds = SAFE_MODEL_IDS) {
  const order = [DEFAULT_SAFE_MODEL, 'deepseek-v4-flash', 'glm-5.3-flash', 'minimax-m3.1-flash'];
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
