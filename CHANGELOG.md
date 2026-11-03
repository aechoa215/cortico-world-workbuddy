# 更新日志

## 0.3.4

按复核结论做减法：移除反复「假开启」的「中转站优先」功能，只保留可确认的事实。

### 删掉的功能

- **「中转站优先」整体移除**：详情页页签与复选框、`worlds.workbuddy.prefer` 配置、
  `priority` 面板方法（`state` / `set` / `process`）、环境提示词里的「每轮先 `wb_chat`」强制规则、
  第三盏「中转站优先」灯，以及主进程退出时自动熄灯的逻辑全部删除。`wb_*` 工具改为按需调用：
  Coo 在用户点名 WorkBuddy 或明显更合适时才调用，不再每轮强制消耗积分。
- **`storage: [{ key: 'workbuddy-catalog' }]` 声明删除**：宿主不再为本扩展生成空的「数据清理」页签。
- **死代码**：`world.js` 的 `canRelay`、未使用的 `dailyWindowText` / `DEFAULT_SAFE_MODEL` /
  `SAFE_MODEL_IDS` 导入，`wbproc.js` 的 `describeProc`，`upstream.js` 里永远为空的
  `X-User-Id` / `X-Domain` 请求头，一并删除。

### 修正

- **主进程状态改为只读**：放在「模型目录」面板顶部（6 秒轮询，状态翻转才推送），不再参与任何开关。
- **优惠状态判定**：`wb_list_models` 的「生效中 / 即将生效」改用 `promoActiveAt()`，
  只有徽标、不改价的促销不再被误标成「即将生效」。
- **环境提示词收敛**：倍率说明改成「模型自身价格 + 本桥接此刻能核实的限时改价（含免费窗口）」，
  并明确「只挂徽标的优惠可能不改价」；`{{workbuddy.priority}}` 变量与其段落删除。
- 契约与 UI 验证同步更新：断言没有 `priority` 面板、只有两盏灯、无 `storage`、配置无 `prefer`；
  UI 脚本改为断言页签不含「是否启用 WorkBuddy」与「数据清理」。

## 0.3.3

按 0.3.2 审查结果修复现有功能，不新增模型、面板或上游能力。

- **折扣时间**：纯日期 `validFrom` / `validUntil` 按 `schedule.timezone` 的当地午夜解释，
  `validUntil` 包含所写日期的整日；`daily` 省略时区时默认 `Asia/Shanghai`，非法时区仍回退 UTC。
- **用量准确性**：分段 SSE `usage` 改为逐字段合并，末帧只有 `credit` 时不再丢 token；
  未回传积分与明确 0 积分分开统计，面板以 `+ ?` 标出未知缺口；账本补记折扣前倍率，
  并在响应完成时取倍率，避免跨折扣窗口写旧值。
- **只做减法**：删除未接线的 `usageState(days)`、`spanDays` / `windowDays`；按模型表固定为
  近 30 天并明确标注，与概览同口径。
- **开关就绪**：环境提示词与第三盏灯同时检查主进程、登录态和已选模型，模型为空时不再假开启。
- **卸载清理**：新增显式 `scripts/clean-workbuddy.mjs --check | --clean`，只清本扩展的配置块、
  三份数据文件与 `.env` 的 `accessToken` 行。普通 `stop()` / 重启不删数据；宿主界面卸载后
  执行该脚本即可无残留，其他配置和密钥不受影响。
- 文案只称“本机已登录的 WorkBuddy 客户端”，删除多余的区域版本区分。

## 0.3.2

只桥接本机已登录的 WorkBuddy 桌面端，不再提供区域切换；同时把「用量」面板对齐宿主的
「用量与成本」口径。仍然只在本机验证，未推送 / 未发布。

### 删掉的功能

- **区域（region）配置整体移除**：`worlds.workbuddy.region`、`WB_REGION_BASE`、区域枚举与
  对应的上游 / 计费域切换全部删除。扩展现在固定走
  `copilot.tencent.com`（目录 / 对话）与 `www.codebuddy.cn`（积分）；自定义 `baseUrl` 仍可用，
  它同时替换这两个域。README、SECURITY、CHANGELOG、`describe.json`、环境提示词里的相关文案同步删除。
- 环境提示词不再输出 `workbuddy.region` 变量；`catalog.json` 与账本里也不再写 `region` 字段
  （旧文件里的该字段读入后直接忽略）。

### 修正

- **开关可以「假开启」**：`priority/set` 以前只检查主进程，登录态失效或没选模型时也能点亮，
  结果每轮 `wb_chat` 都失败。现在开启前依次校验主进程、登录态、模型目录，分别返回
  `no-process` / `no-auth` / `no-model`，面板按原因提示；没有选过模型时自动落到
  `preferredSafeModel(safeModelIds())` 并持久化。
- **环境提示词与实际状态脱节**：`workbuddy.priority` 只有在「开关开 + 主进程在跑 + 已登录」
  时才输出 `on`，避免提示词命令桌宠调用一个必然失败的通道。
- `loadTokens()` / `setToken()` 成功时清空 `lastError`，登录态恢复后面板不再挂着旧错误。
- `usageState(days)` 支持区间参数（0/1/7/30/90，默认 30）；`summarize().spanDays` 不再恒为 1。
- 面板「用量」改名「用量与成本」：区间概览新增失败数、缓存命中、合计 token 与「全部」一行，
  按模型聚合同样补上失败数与合计 token；数据仍全部来自账本，不新增任何存储。
- `world.js` 构造器补上漏声明的 `_procConfirm`，删掉 0.3.0 遗留的孤儿 JSDoc。

## 0.3.1

按 0.3.0 审查报告复核并修复（仍只在本机验证，未推送 / 未发布）。

### 高 / 中优先级

- **`/v3/config` 401/403 的错误分类（最严重）**：`upstream.js` 把 `kind` 字符串当成
  `WbUpstreamError` 的第二参（`info` 对象）传，错误恒为 `kind='server'`、`status=0`；
  连锁导致 `models.refresh` 不返回 `noAuth`、`toolChat` 不清 token、前端不提示重新登录。
  现在传 `{ status: 401|403, kind: 'session_dead' }`；`fetchCatalog` 每次重置认证标记，
  `fetchModelsLegacy` 的 403 也判 `session_dead`。
- **`dailyUnusable` 恒为 false**：`parseSchedule` 过滤后 `daily` 是 `[]` 而不是 `undefined`，
  写错的时段会被当成「全天打折」。现在按「上游给了时段但一条都解析不出来」判定，
  并让该促销按「不生效」处理（宁可少报一次折扣）。
- **`rediscover` 静默覆盖手动 token**：手动粘贴 token 后点「重新检测」，0.3.0 仍写
  `wb-auto` 把密钥库里的真 token 覆盖掉，重启后丢失。现在只有密钥库里确实是
  `wb-cleared` 登出哨兵、且探测成功时才改写。
- **「今日积分」跨午夜不归零**：新增 `localDay()` / `rollTodayIfNeeded()`，
  `envPromptVars()` / `webUi()` / `toolChat()` 累加前都翻篇；详情页徽标、环境提示词与
  用量面板 `summary.totals.today` 从此一致。
- **发布流程**：Release 不再与 CI 各自监听 `v*` tag。现在 `release.yml` 里 `publish`
  `needs: verify`（同一条流水线跑 contract / 构建 / dist 一致性），CI 校验没过就不会发布；
  `ci.yml` 只负责 push/PR，tag 触发交给 Release。
- **0.2.x 升级残留**：新增 `scripts/clean-legacy-injection.mjs`（`--check` / `--clean`，
  幂等、只删本扩展留下的三样东西、绝不覆盖 `index.html` 其他内容）。扩展本体仍
  **一个字节都不改宿主文件**，清理是用户主动跑的一次性迁移工具。
- **SECURITY.md 自相矛盾**：删掉「下次启动会重新注入」的残句，写清 0.3.0 起不碰宿主、
  自定义 `baseUrl` 时 token 会发往该主机、可执行文件覆盖两种安装形态。
- **`refresh()` 死代码**：`WbUpstream.refresh()` 与 `/v2/auth/refresh` 全仓库无调用点，
  README 原理图却列了它。现在删掉未接入的实现与原理图那一行，如实写明
  「登录态失效 → 重新从本机凭据发现」；`credentials.js` 仍解析 `refreshToken`（不外发），
  chat 请求绝不携带它。
- **`candidateAppExecutables()` 漏 `WorkBuddy AI.exe`**：桌面端两种安装形态的目录名与
  exe 名都覆盖，另一种形态也能自动解封 at-rest 密钥。

### 低优先级 / 一致性

- `wb_chat` 描述补回 "Requires the WorkBuddy desktop app to be running"（`WB_TOOL_DECLS`、
  `definition.js`，`describe.json` 重新生成）。
- 英文面板不再写已删除的「开始页 Relay first 按钮」；`dist/webui.js` 重新构建。
- `writeBalance()` 走与账本同一条写队列、临时文件名带 pid；`usageState()` 只在确有
  超期行时才整文件重写账本。
- `clearToken` 当下就写 `lastError`（可操作提示不必等重启）；`tools()` handler 不再假设
  `args` 一定存在；`offlineChecks()` 与 CI 语法检查覆盖 `scripts/lib/*.mjs`；
  `reinstall.ps1` 删掉空 `if` 死代码。
- README 统一：CI 是「改跑离线检查」而非「跳过」、三个域名口径、版本号与安装示例。
- `reinstall.ps1` 的 `npm pack` 不再被误判：Windows PowerShell 5.1 在
  `$ErrorActionPreference='Stop'` 下把 npm 的 stderr `notice` 当 `NativeCommandError` 抛出，
  于是静默退回手工 tar、绕过 `prepack`（审查报告第 6 条的真正触发点）。现在临时降为
  `Continue` 并按真实退出码判断，打包必走 `prepack`。
- `contract.mjs` 从 68 条扩到 95 条（+27）：新增 `scripts/contract-regression.mjs`
  承载 0.3.1 回归防线（session_dead 分类与不降级、无效时段不打折、
  rediscover 不覆盖手动 token、跨日归零、两种安装形态、余额快照并发写），
  并修掉 0.3.0 的断言数量口径（声称「补 25 条」，实际 55→68 只 +13）。

## 0.3.0

**撤除主界面注入，并按复检报告修掉 9 处中优先级问题。**

### 删掉的功能（以及随之消失的冗余）

- 不再往 Coopanion 主界面「开始」页注入「中转站优先」按钮：删除 `src/host.js`、
  `scripts/host-inject.mjs`、`assets/workbuddy-home.js`；`world.js` 去掉 `syncHostUi()`、
  `hostInjectorSource()`、`removeHostUi()`、`hostUiLine()` 与 60 秒自检定时器。
- 四盏灯回到三盏（WorkBuddy / 主进程 / 中转站优先），`hostInject` 配置项删除，
  `priority` 面板不再有 `host` / `repair` 方法，面板里的「重新注入」按钮与相关文案一并移除。
- 扩展现在**不改写宿主任何文件**，卸载不需要还原；装过 0.2.x 的机器按 README
  的「旧版本残留」一段手工清一次 `build\console` 即可。

### 按复检报告修复

- `rediscover` 之后不再残留「已登出」哨兵：新增 `TOKEN_AUTO = 'wb-auto'`，探测成功即改写，
  重启后不会又变回未登录。
- `/v3/config` 返回 401/403 时直接判 `session_dead`，不再降级去读没有促销的旧目录。
- 自定义 `baseUrl` 时积分查询跟着走同一出口（以前固定打到 `www.codebuddy.cn`）。
- 构建可复现：`package-lock.json` 锁 esbuild 0.24.2；`build-web.mjs` 新增 `--strict`，
  `prepack` 用它——找不到 esbuild 时直接失败，不再静默沿用旧 `dist`。
- 数量口径统一为 22 个安全模型（代码 / 配置描述 / README 一致），并注明只精确放行
  `hy4-preview`（同前缀的新实验号仍需人工复核）。
- `describe.json` 生成化后补回 `wb_chat` / `wb_credits` 的「Requires the WorkBuddy desktop app
  to be running」前提。
- `contract.mjs` 扩容到 68 条断言，新增复检点名缺口的回归项：哨兵语义、计费域选择、
  429 软硬区分、面板方法白名单、账本并发（`append` 与 `prune` 串行）、SSE 尾行 flush、
  `start()` 兜底、本地日期；同时修掉一条恒真断言。
- 顺手修：`recent` 按时间倒序（以前 `slice(-15).reverse()` 会先取到最旧那条）、
  `wb-cleared` 时给出可操作提示、`selfcheck` 失败路径清理临时目录、`gen-describe` 英文语法。

## 0.2.0

按 hy4-preview 的审查报告把 17 类问题逐个修掉，并把 `hy4-preview` 纳入安全清单（仍只在本机，未推送 / 未发布）。

- **新模型**：`hy4-preview` 进入安全清单（0.1.7 探测时它正好繁忙、误判为不可用），同时标为「谨慎」
  —— 预览档，不要把高频自动化打到它身上。
- **`worlds.workbuddy.hostInject` 真正生效**：关掉后 `start()` 与 60 秒巡检都不再改写宿主
  `build\console\index.html`，并会主动清掉上一次留下的注入与备份；`stop()` 也先于开关判断执行还原
  （装完再关掉的场景以前会漏还原）。
- **promo 计算改成同一条促销说了算**：原来「生效倍率」取自真正打折的那条，「徽标 / 时段 / promoId」
  取自优先级最高的生效项，两者可能不是同一条，导致面板写着 A 的名字、收着 B 的价。现在
  `selectPromoDiscount()` 一次挑出「真正改价」的促销，`priceViewOf()` 的
  `effective / promoId / windowText / discount` 全部来自它，并新增 `discounted` 布尔。
- **促销时间解析**：`validFrom` / `validUntil` 现在同时接受 ISO 字符串与数字时间戳（<1e12 视为 Unix 秒
  —— 以前数字时间戳被静默丢弃，过期活动会一直生效）；`daily` 时段在时区无法识别时退回 UTC
  （以前 `catch` 里 `return 0`，等于把所有活动当成 00:00 生效）；`24:00` 与跨零点窗口照旧。
- **`base` 倍率不再误读**：`multiplierOfText()` 同时剥前缀与后缀的 `x`。
- **用量账本并发安全**：`append()` / `prune()` / `clear()` 共用一条串行队列，`prune` 与 `clear` 改成
  写临时文件再 `rename` —— 以前 `prune()` 的整体重写会覆盖并发进行中的 `append()`。
- **用量面板 token 列修好**：账本字段名是 `total / prompt / completion`，面板却按
  `totalTokens / promptTokens / completionTokens` 读，所以「最近调用」的 token 列一直是 0。
- **宿主注入自愈更彻底**：`inspectHostInjection()` 会真实比对注入脚本内容（新增 `fileStale` 与
  `reason: injector-stale`），`ensureHostInjection()` 无论当前是否「看起来正常」都会把脚本更新到本版本
  —— 以前脚本写进 `if (!state.ok)` 里，升级扩展后宿主跑的还是旧脚本。
- **`--restore` 不再用备份覆盖宿主**：`scripts/host-inject.mjs --restore` 改调 `removeHostInjection()`
  （只剥引用行、删注入脚本与备份），与「绝不用旧备份覆盖、避免把宿主降级」的原则一致；
  `--check` 也把「注入脚本过期」算作失败。
- **换行风格不再被改坏**：`stripInjection()` 按原文件的换行风格重建（以前会把 CRLF 全改成 LF）。
- **`clearToken` 真的清得掉**：写不清空时返回失败不再是「假成功」；清空后写哨兵 `wb-cleared`，
  `loadTokens()` 见到哨兵就当作已登出（`rediscover` 才回落到本机凭据库）。
- **`/v3/config` 失败不再静默**：非 2xx、空数据、无模型条目分别打警告，方便判断是不是被降级到旧接口。
- **计费域固定**：`WbUpstream` 的 `billingUrl()` 使用 `WB_BILLING_BASE`
  （早期版本按域名子串猜，自定义 `baseUrl` 时会掉到错误的计费域）。
- **SSE 收尾不再丢 usage**：流结束时 `decoder.decode()` 冲刷残留字节，并把最后一段没有换行的 `data:`
  交给同一解析器 —— 以前末尾那段（正好带 `usage`）会被丢掉。
- **429 两种性质分开**：`classifyHttpFailure()` 按文案把「额度耗尽」判成 `hard_credit`，其余 429 才是
  `soft_rate`（以前两支返回同一个值）。
- **解封密钥失败不再永久缓存**：`resolveTokensWithKey()` 的成功结果只复用 60 秒，失败也按 TTL 重试
  —— 以前一次取密钥失败后，即使用户随后装了 WorkBuddy 桌面端也要重启扩展才能恢复。
- **`pgrep` 缺失不再算「没在跑」**：`probePosix()` 识别 `command not found` / 退出码 127，返回
  `via: 'error'`，不写进「未运行」的缓存。
- **启动流程兜底**：`start()` 全程包 try/catch/finally，`pushEvent` 失败只警告；任何一步抛错都不会让
  四盏灯永远停在「正在读取登录态…」。
- **面板方法白名单**：`handleInvoke()` 先校验 `panel`/`method`（`PANEL_METHODS`），未知组合直接拒绝
  —— 以前任意 panel 都能触发 `setToken` / `clearToken` 写密钥库。
- **「今日」按本地日期**：`refreshToday()` 不再用 `toISOString()` 取日期（UTC+8 下会把 today 算成前一天）。
- **`describe.json` 变成生成物**：新增 `scripts/gen-describe.mjs`，工具名 / 描述 / 参数 / tags 来自
  `WB_TOOL_DECLS`，环境提示词来自 `src/ENV_PROMPT.md`，摘要与事件写在生成器里；`--check` 可验一致性。
  删掉包里那份 724 字节的旧 `ENV_PROMPT.md` 模板（真正的模板是 `src/ENV_PROMPT.md`）。
- **新增 `scripts/contract.mjs`**：静态契约 + 单元断言（describe 与源码一致、版本与 CHANGELOG 对齐、
  提示词占位符都有对应变量、夜间/白天促销、数字时间戳、时区回退、安全清单、账本聚合、CRLF 保留），
  没装 Coopanion 的机器上也能跑；`selfcheck.mjs` 找不到宿主时改为跑它。
- **`reinstall.ps1` 不再往作者机器路径写**：默认输出到 `$env:LOCALAPPDATA\cortico-world-workbuddy\build`，
  优先 `npm pack`（会走 `prepack` 重建构建产物），手工 `tar` 只作兜底。
- **CI 补上真正的校验**：`npm run build:web` + `git diff --exit-code -- dist` + `node scripts/contract.mjs`；
  Release 工作流与 CI 统一用 `npm ci`。

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
