/**
 * worlds.workbuddy 配置段：默认值与配置组 schema。
 * 规范：配置组的每个路径都必须落在 worlds.workbuddy. 段内，且在 defaults() 里有对应默认项。
 */

/**
 * @typedef {object} WbConfigSection
 * @property {boolean} enabled
 * @property {string} model 当前选用的模型 id；空串 = 未选择。
 * @property {string} credentialsDir 自定义凭据目录（留空 = 自动发现）。
 * @property {string} baseUrl 自定义上游 base URL（留空 = WorkBuddy 官方域名）。
 * @property {number} maxTokens 单次 wb_chat 的最大输出 token。
 * @property {boolean} envPrompt 是否把桥接状态写进 system 前缀的环境段。
 * @property {boolean} safeOnly 只允许调用安全清单内的公开对话模型。默认开。
 * @property {boolean} localCatalog 优先读 WorkBuddy 桌面端落盘的本地目录缓存。默认开。
 * @property {number} localCatalogDelayMs 检测到主进程后，延后多久读本地缓存（毫秒）。
 * 注意：手动粘贴的 access token 走 ctx.storeSecret()，不落配置。
 * 0.3.0 起不再有 hostInject：扩展不再改写宿主任何文件。
 * 0.3.2 起只桥接本机已登录的 WorkBuddy 客户端。
 * 0.3.4 起移除「中转站优先」开关：wb_* 工具按需调用，不再每轮强制走 WorkBuddy。
 */

export const WB_DEFAULTS = {
  enabled: false,
  model: '',
  credentialsDir: '',
  baseUrl: '',
  maxTokens: 2048,
  envPrompt: true,
  /**
   * 只允许调用 WorkBuddy 公开对话模型（安全清单）。
   * 关掉后能用 disabled / 内部别名 / 预览等模型，但那属于「已知会违反对方使用建议」的操作，
   * 默认必须是 true。
   */
  safeOnly: true,
  /**
   * 优先读 WorkBuddy 桌面端落盘的本地目录缓存（0.3.7）。
   *
   * 桌面端每次启动都会把 /v3/config 原文写进 ~/.workbuddy/cache/，字段与上游一致。
   * 模型目录不再自动向服务器拉取：只有用户在模型面板点「从服务器刷新」才请求。
   * 0.3.9 起运行期每 6 秒只 stat 一次缓存目录，变了才异步读文件。
   */
  localCatalog: true,
  /**
   * 启动时 / 检测到主进程后，延后多久再读本地缓存（毫秒）。
   *
   * 桌面端是「启动时落盘」，刚启动的那几秒文件可能还没写完，
   * 立刻读会拿到上一轮的目录，所以要留一点时间。
   */
  localCatalogDelayMs: 3000,
};

/** World 配置组（WebUI 通用渲染的旋钮）。模型选择走自定义面板，不在这里。 */
export const WB_CONFIG_GROUP = {
  id: 'world:workbuddy',
  owner: 'world:workbuddy',
  schema: {
    type: 'object',
    title: 'WorkBuddy 桥接',
    properties: {
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
        description: '自定义 WorkBuddy 上游 base URL，留空使用WorkBuddy 官方域名（copilot.tencent.com）。代理 / 中转场景使用；改完重启生效。',
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
      'worlds.workbuddy.safeOnly': {
        type: 'boolean',
        title: '只调用安全清单模型',
        description:
          '默认开：wb_chat / wb_select_model 只接受 WorkBuddy 官方模型列表里的对话模型（18 个），disabled、内部路由别名、媒体与代码补全模型一律拒绝。关掉会放行这些项，但那既超出本扩展的用途范围，也容易触发上游限制，风险自负。',
        'x-hot': true,
      },
      'worlds.workbuddy.localCatalog': {
        type: 'boolean',
        title: '优先使用本机缓存目录',
        description:
          '开启后，启动时与检测到 WorkBuddy 主进程后各读一次桌面端落盘的模型目录缓存（~/.workbuddy/cache/），并与上一次从服务器抓到的目录比时间，谁新用谁；面板顶部会显示目录的更新时间。运行期每 6 秒只 stat 一次缓存目录（几毫秒），目录没变就不读文件。模型目录不再自动向服务器拉取，只有在模型面板点「从服务器刷新」才请求（且要求主进程在跑）。',
        'x-hot': true,
      },
      'worlds.workbuddy.localCatalogDelayMs': {
        type: 'number',
        title: '读到主进程后延迟读缓存（毫秒）',
        description:
          '桌面端只在启动时落盘目录，刚启动或刚检测到主进程时文件可能还没写完，延后几秒再读更稳。',
        minimum: 1000,
        maximum: 15000,
        'x-hot': false,
      },
    },
  },
};
