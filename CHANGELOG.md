# 更新日志

## 0.1.7

按 WorkBuddy 官方对话给出的合规口径，给桥接加「安全清单」闸门（仍只在本机，未推送 / 未发布）。

- **新增 `src/safety.js`**：把 WorkBuddy 的筛选原则固化成 `SAFE_MODEL_IDS`（21 个公开对话模型）、
  分组表 `SAFE_MODEL_GROUPS`、谨慎档 `CAUTION_MODEL_IDS`（hy3 系列与 preview）与 `classifyModel()`。
  `classifyModel` 把目录里每个模型判成 `safe / caution / alias / disabled / media / code / retired /
  format / experimental / unknown` 十档，附中文理由；`allow` 只对前两档为真。
- **闸门默认开启**（`worlds.workbuddy.safeOnly = true`）：`wb_chat`、`wb_select_model` 与面板的
  「使用」按钮都会拒绝安全清单外的模型，并给出「判定档位 + 理由 + 如何解除」的说明；
  关掉这个配置才能调用 disabled / 内部别名 / 预览等模型，风险自负。
- **`wb_list_models` 默认只列安全清单**（按 DeepSeek / GLM / 混元 / Kimi / 其他分组，带此刻倍率），
  传 `all=true` 才追加其余模型及其排除理由。
- **被排除的典型项**：`wb-lite`（目录 `disabled:true`）、`auto` / `fast-model` / `balanced-model` /
  `deep-model`（内部路由别名）、`hunyuan-image-alpha*` / `kling-video-v3` / `minimax-video-h3`（媒体）、
  `codewise-*`（代码补全）、`hy4-preview*`（实验预览）、19 个已下架（11102）、`glm-5.0-turbo`（11150）。
- **模型目录面板**新增「合规」列（安全清单 / 安全清单·谨慎 / 各排除档位，悬停看理由），
  默认只显示安全清单，勾选「显示全部模型（含不建议项）」才展开；不安全项的选择按钮置灰。
- `envPromptVars()` 增加 `workbuddy.safeOnly`；`ENV_PROMPT.md` 增加一条：闸门开着时不要绕过拒绝，
  应该告诉用户原因并改推荐安全清单里的模型。
- `describe.json` 的 `envPrompt` 与 `wb_list_models` 描述同步（多了 `all` 参数）。

## 0.1.6

新增「用量」面板与真实的时段优惠计算（只在本机验证，未发布）。

- **优惠来自 `/v3/config`**：改用应用身份 UA（`WorkBuddy/5.8.3 … CLI/2.161.0`）拉取目录，
  同时拿到 `modelPromotions` / `modelTiers`。用 CLI 身份只能读到精简后的目录，
  促销与档位字段整个缺失——这是之前倍率「永远显示原价」的根因。
- **新增 `src/promo.js`**：解析 `schedule`（`timezone` / `validFrom` / `validUntil` / 跨零点的 `daily`
  时段、`dailyUnusable`）、`discount`（`discountedCredits` 就是生效倍率本身，不是相对系数）、
  `badge`（含 `display:"activeOnly"`）与 `priority`；按优先级选出此刻生效的那条。
  `priceViewOf(model, now)` 给出 `{base, effective, promoId, badge, windowText, hoverText, isFree}`。
- **新增「用量」面板**（`world:workbuddy` 第 4 个页签）：区间概览（今天 / 近 7 天 / 近 30 天）、
  按模型聚合、积分包明细、限时优惠清单、最近调用明细；带「刷新余额」与「清空本地账本」。
- **新增 `src/usage.js`**：每次 `wb_chat` 往 `<dataDir>/workbuddy-usage.jsonl` 记一行
  （tokens 来自 SSE 的 `usage`，积分来自 `usage.credit` 即上游真实扣费，倍率记当时生效值），
  读的时候裁掉 90 天以前的行；余额快照另存 `workbuddy-balance.json`。
- `fetchCredits` 现在返回 `{total, used, packages[]}`（逐包剩余 / 已用 / 周期），
  `wb_credits` 一并打印「本周期已用」。
- `wb_chat` 回执补充「用量：输入 N tok / 输出 N tok / 缓存命中 N tok / 共 N tok / 本次消耗积分 N（N ms）」。
- `wb_list_models` 标注此刻生效倍率（含原价对比、时段）与优惠徽标；`wb_select_model` 提示此刻倍率。
- 环境提示词新增 `{{workbuddy.todayCredit}}` / `{{workbuddy.todayTokens}}`，并在倍率旁说明已含生效中的限时优惠。
- 详情页徽标增加「今日积分」。

## 0.1.5

发布前收尾：停用 / 卸载彻底不留痕，并把元数据指向真实仓库。

- **停用即还原**：`stop()` 现在会调用 `removeHostInjection()`，把上一次注入撤干净——剥掉
  `index.html` 里的引用行、删掉 `workbuddy-home.js` 与 `index.html.workbuddy-backup`。
  只从**当前** index.html 剥行、绝不用旧备份覆盖，所以宿主升级过也不会被降级。
  这是扩展市场对「改写宿主程序文件」类扩展的硬性要求（同类扩展 `cortico-world-coo-control`
  正是因「停用前不还原、改动一直保留」被拉黑）。
- 新增配置 `worlds.workbuddy.hostInject`（默认 `true`）：关掉后既不注入也不还原，
  只保留 World 详情页里的开关；不想让扩展碰宿主文件时用这个。
- `package.json`：`author` 换成 `大肥鱼 (aechoa215) <yawenpeng0831@gmail.com>`，
  补齐 `repository` / `homepage` / `bugs` 指向 `github.com/aechoa215/cortico-world-workbuddy`。
- README「卸载与还原」补充自动还原行为；配置表加 `hostInject`。
- 启动瞬间不再误报：`start()` 未跑完之前，四盏灯里的登录态显示「正在读取登录态…」而不是
  「未发现登录态」——此前 Core 刚起来时抢读会看到约一秒的假 offline。
- 提交身份与发布元数据统一：`author.email` 与 git 全局身份都指向 Git 账号绑定的
  `yawenpeng0831@gmail.com`（此前是 `799713644@qq.com`，两处不一致会让 npm 元数据与提交记录对不上）。
- `LICENSE` 版权主体由占位写法 `cortico-world-workbuddy contributors` 改为 `aechoa215`。
- 仓库配套：`.gitignore`（依赖、测试截图、目录缓存、`*.tgz` 不进历史）与
  `.github/workflows/ci.yml`（语法体检 → `dist` 与源码同步校验 → `selfcheck --allow-missing-host`，
  矩阵 ubuntu/windows × node 22/24；UI 端到端只在 Windows 上尽力而为）。

## 0.1.4

补齐公开分发所需的元数据（不改变任何运行时行为，工具与面板逻辑同 0.1.3）：

- 新增 `LICENSE`（MIT）与 `SECURITY.md`（读哪些文件、只发往哪两个域名、哪些从不写盘），两者都进 `files`，随 npm 包发布。
- `package.json` 补齐 `author` / `repository` / `homepage` / `bugs`，npm 页与市场详情页可溯源。
- `os` 改为 `["win32"]`：只在 Windows 实机验证过，不再对 macOS / Linux 虚报可用。
- `cortico.tags` 声明为 `unofficial-api` / `external-setup` / `sensitive-data`（官方标签词表的原义：用账号调客户端内部接口 / 需先装 WorkBuddy 桌面端 / 读本机凭据）。
- `devDependencies` 补 `esbuild`，`scripts.build:web` 不再依赖 Coopanion 自带的那份；新增 `prepack`，`npm publish` 前自动重建 `dist/webui.js`，避免产物过期。
- `scripts/selfcheck.mjs` 新增 `--allow-missing-host`（也认 `WB_ALLOW_MISSING_HOST=1`）：CI 或没装 Coopanion 的机器上找不到宿主时警告并退出 0，不再红叉；真失败仍是退出 1。新增 `scripts.verify`。
- README 增补两节：「它改了宿主程序的哪些文件（以及怎么还原）」逐条列出 index.html 注入行、新增脚本与备份文件；「发布（GitHub / npm / 扩展市场）」给出 npm 优先、`[sync]` 催收录的流程与发版前三连检。

## 0.1.3

把「开始页注入」从手工操作变成仓库里的脚本，并修掉三类会咬人的环境问题：

- 新增 `src/host.js`：宿主静态资源的定位、检查、幂等注入、备份与还原。
  - `findAppRoot()` 依次试 `process.resourcesPath`、`<data>/../resources/app`、
    `dirname(process.execPath)/resources/app`、包目录上溯，按 `build/console/index.html` 判定。
  - `inspectHostInjection()` 返回 `ok` 与具体的 `reason`
    （`app-root-not-found` / `index-html-not-found` / `injector-file-missing` / `script-tag-missing`）；
    `ensureHostInjection()` 首次改写前把 `index.html` 备份为 `index.html.workbuddy-backup`，
    注入脚本头部带 `/* bundled:<version> */`。
- World 启动时自愈：`syncHostUi({repair:true})` 在 `start()` 里跑一次、之后每 60 秒复查一次。
  宿主升级把 `build/console` 还原掉时，下一次检查会自动重注入；修复失败只记 `warn`，
  `wb_*` 工具照常工作，不会因为 UI 缺失而影响对话。
- 状态可见：`webui()` 增加第 4 盏灯「开始页按钮」；「是否启用 WorkBuddy」面板多一行宿主状态，
  并新增「重新注入开始页按钮」按钮（`priority` 面板的 `repair` 方法）。
- `scripts/launch-coopanion.ps1`：启动前清除 `ELECTRON_RUN_AS_NODE`（终端残留这个变量会让
  Electron 以 Node 模式启动：窗口不出、`--version` 打印 v24.x），再拉起进程并轮询
  `/api/status` 直到就绪，最后打印端口、pid、扩展版本与 lamps。
- `scripts/host-inject.mjs`：注入的手动/CI 入口，支持 `--check`（只检查，退出码表状态）
  与 `--restore`（从备份还原并删除注入脚本）。
- `scripts/reinstall.ps1`：一键重装。打包 → `pnpm remove` → `pnpm add` → 逐文件哈希校验 →
  与 `/api/extensions` 核对版本，任一处不符以非零码退出。**同版本重装必须先 remove**，
  否则 pnpm 按 `file:` 规格判定复用旧包（这不是 bug，是 lockfile 语义）。
- `scripts/verify-ui.mjs`：真实窗口验证。每轮带 `?t=<时间戳>` 整页重载 + `Page.reload({ignoreCache:true})`，
  元素等待用 15 秒轮询而不是固定 sleep，并把「路由挂载」与「面板渲染」分成两条断言；
  连跑 5 轮全绿才算通过。
- 文档措辞纠正：问题出在**会话/终端残留的** `ELECTRON_RUN_AS_NODE`（进程作用域），
  不是 Coopanion 的二进制或 FUSE 有问题。

## 0.1.2

「中转站优先」开关 + WorkBuddy 主进程检测：

- 新增 `src/wbproc.js`：用系统自带的 `tasklist`（Windows）/ `pgrep`（macOS、Linux）
  探测 WorkBuddy 主进程，结果缓存 2.5 秒，不引第三方依赖。桌面端的渲染进程都是主进程的
  子进程，所以「有 WorkBuddy.exe」等价于「主进程在跑」。
- `wb_chat` / `wb_credits` 现在要求主进程在跑：不在跑时直接返回
  「未检测到 WorkBuddy 主进程」，不去打上游。
- 新增「中转站优先」开关，状态只有一份（`worlds.workbuddy.prefer`），两个入口：
  - 「开始」页 →「可选择的模型」下一排的「中转站优先：WorkBuddy」图标按钮；
  - 「World 扩展」→ WorkBuddy 桥接详情页的「是否启用Workbuddy」开关。
  两处都走 `priority` 面板的 `state` / `set`，默认均为关。
- 打开时若主进程不在跑：开关保持熄灭，并提示「未检测到Workbuddy」（服务端返回
  `ok:false` + `reason:"no-process"`，不会把开关打开）。主进程在 6 秒轮询里退出时，
  开关自动熄灭。
- 环境提示词新增 `{{workbuddy.priority}}` 与 `{{workbuddy.process}}`，并写清「中转站优先」
  的规则：开 + 进程在跑 → 每轮先 `wb_chat` 再转述；关 → 完全不碰 `wb_*`。
- 开始页按钮靠注入脚本 `<Coopanion>/resources/app/build/console/workbuddy-home.js`
  （外加 `index.html` 一行 `<script type="module">`）实现。插件卸载 / World 未挂载时，
  脚本查不到 `workbuddy` World 就什么都不做，不会让主界面报错。

## 0.1.1

实机联调（Coopanion 0.2.17 / WorkBuddy 桌面端 5.x）后修的问题：

- 凭据发现：新增桌面端的真实落盘位置
  `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth`
  （文件名 `workbuddy-desktop.info` / `workbuddy-desktop-ai.info`，不是 `*.json`，
  也不在 `%APPDATA%\WorkBuddy`），并允许扫描 `.info`。这份「活文件」排在最前。
- 加密凭据自动解封：拿不到 `WORKBUDDY_AT_REST_KEY` 时，改为用桌面端自己的二进制
  以纯 Node 模式问出密钥负载
  （`ELECTRON_RUN_AS_NODE=1 WorkBuddy.exe -e "process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()"`），
  进程内缓存一次；不需要用户手动粘贴 token。
- 积分查询修好：原来打的是 chat 域的 `GET /billing/meter/packages`（404，
  既不是那个域也不是 GET）。改为计费域的
  `POST https://www.codebuddy.cn/v2/billing/meter/get-user-resource`
  （`ProductCode: p_tcaca`，读 `data.Response.Data.Accounts[].CycleCapacityRemainPrecise`）。
- 适配 Coopanion 的 World 契约：`ctx.secret()` 是同步的（不再 `.catch`）、
  `ctx.persist()` 必须带 patch（`{ model }`）、`ctx.storeSecret()` 同步调用。

## 0.1.0

首个版本：

- 自动发现本机（Windows / macOS / Linux）WorkBuddy 桌面端登录凭据，支持明文与
  `$wbEncrypted` 加密信封（AES-256-GCM 解封，密钥经 `WORKBUDDY_AT_REST_KEY` 注入）；
  发现失败时可在「账号」面板手动粘贴 access token（只进密钥库，不上屏、不落配置）。
- 「模型目录」面板：一键从 WorkBuddy 刷新模型目录，逐模型显示**默认积分倍率**
  （如 x0.79，倍率完全由上游给出）、上下文窗口与推理档位，点选即设为默认模型。
- 工具：`wb_list_models` / `wb_select_model` / `wb_chat` / `wb_credits`。
- 账号面板：登录态来源与掩码 token、积分余额只读查询、重新检测登录。
- 环境提示词把当前区域、所选模型与倍率写进 system 前缀。
