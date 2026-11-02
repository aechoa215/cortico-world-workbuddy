/**
 * worlds.workbuddy 配置段：默认值与配置组 schema。
 * 规范：配置组的每个路径都必须落在 worlds.workbuddy. 段内，且在 defaults() 里有对应默认项。
 */

/**
 * @typedef {'cn' | 'global'} WbRegion
 * @typedef {object} WbConfigSection
 * @property {boolean} enabled
 * @property {WbRegion} region 国内版 / 国际版。
 * @property {string} model 当前选用的模型 id；空串 = 未选择。
 * @property {string} credentialsDir 自定义凭据目录（留空 = 自动发现）。
 * @property {string} baseUrl 自定义上游 base URL（留空 = 按 region 取官方域名）。
 * @property {number} maxTokens 单次 wb_chat 的最大输出 token。
 * @property {boolean} envPrompt 是否把桥接状态写进 system 前缀的环境段。
 * @property {boolean} prefer 「中转站优先」：桌宠每轮对话是否先走 WorkBuddy 模型。默认关。
 * 注意：手动粘贴的 access token 走 ctx.storeSecret()，不落配置。
 */

export const WB_DEFAULTS = {
  enabled: false,
  region: 'cn',
  model: '',
  credentialsDir: '',
  baseUrl: '',
  maxTokens: 2048,
  envPrompt: true,
  /** 由开始页按钮 / World 详情页开关写入，两个入口共用这一份状态。 */
  prefer: false,
  /** 是否允许改写宿主控制台 index.html 注入「中转站优先」按钮；关闭后不注入也不还原。 */
  hostInject: true,
};

/** World 配置组（WebUI 通用渲染的旋钮）。模型选择走自定义面板，不在这里。 */
export const WB_CONFIG_GROUP = {
  id: 'world:workbuddy',
  owner: 'world:workbuddy',
  schema: {
    type: 'object',
    title: 'WorkBuddy 桥接',
    properties: {
      'worlds.workbuddy.region': {
        type: 'string',
        title: '区域',
        description: '国内版（copilot.tencent.com）或国际版（workbuddy.ai），按你登录的客户端选择。改动后需重新读取模型目录。',
        enum: ['cn', 'global'],
        'x-hot': true,
      },
      'worlds.workbuddy.model': {
        type: 'string',
        title: '当前模型',
        description: 'wb_chat 默认调用的模型 id。通常在「模型目录」面板里点选，这里可手填。',
        'x-hot': true,
      },
      'worlds.workbuddy.credentialsDir': {
        type: 'string',
        title: '凭据目录（可选）',
        description: 'WorkBuddy 客户端的数据目录。留空时按系统默认位置自动发现；改完重启本 World 生效。',
        'x-hot': false,
      },
      'worlds.workbuddy.baseUrl': {
        type: 'string',
        title: '上游地址（可选）',
        description: '自定义 WorkBuddy 上游 base URL，留空按区域取官方域名。代理 / 中转场景使用；改完重启生效。',
        'x-hot': false,
      },
      'worlds.workbuddy.maxTokens': {
        type: 'number',
        title: '单次最大输出 token',
        description: 'wb_chat 单次回答的输出上限。',
        minimum: 64,
        maximum: 65536,
        'x-hot': true,
      },
      'worlds.workbuddy.envPrompt': {
        type: 'boolean',
        title: '环境提示词',
        description: '在 system 前缀里告知 Coo 当前桥接的模型与积分倍率。',
        'x-hot': true,
      },
      'worlds.workbuddy.hostInject': {
        type: 'boolean',
        title: '主界面按钮注入',
        description: '在「开始」页加一个「中转站优先」按钮（会改写 Coopanion 的 build/console/index.html，停用或卸载时自动还原）。关掉后只能用 World 详情页的开关。',
        'x-hot': true,
      },
    },
  },
};
