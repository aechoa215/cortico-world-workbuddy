# cortico-world-workbuddy

把 **本机已登录的 WorkBuddy 客户端**的模型桥接进
[Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 桌宠。装好之后，Coo 可以在和你**文字对话**时
按需调用你 WorkBuddy 账号里的模型；World 面板里可以浏览模型目录、看每个模型此刻的**积分倍率**
（如 `x0.79`）、点选默认模型。

这是一个 Cortico 的 World 扩展（`kind: world`，`api: 6`），纯 ESM JS、零运行时依赖，面板产物
（`dist/webui.js`）随包构建好。当前版本 **0.3.13**。

## 这是什么

一句话：**只给桌宠 Coo 用的、按需触发的 WorkBuddy 模型桥**。

- 只做一件事：你与 Coo 文字对话时，让 Coo 调用你本机已登录的 WorkBuddy 账号里的对话模型，并把回答转述给你。
- 每次调用都真实消耗**你自己账号**的积分，按上游给出的倍率扣费；扩展不冒充官方客户端以外的身份，也不改写用量。
- 零运行时依赖、不监听端口、不对外提供 HTTP 接口；除宿主内的 Coo 外没有调用方。
- 不读、不传、不共享别人的凭据；只使用本机当前登录态。

它**不是**、也不应被当作：

| 不要这样用 | 为什么 |
|---|---|
| 通用 API 网关 / OpenAI 兼容服务 | 没有监听端口、没有对外接口、没有多路复用 |
| 批量、自动化或爬取工具 | 没有批量接口、没有循环调用、没有后台任务；每次调用都由一次对话显式发起 |
| 多账号池 / 凭据共享 / 转售服务 | 只读本机当前登录态，不收集、不上传、不共享凭据 |
| 绕过计费的手段 | 每次 `wb_chat` 都按上游倍率真实扣积分，不伪造计费、不改写用量 |

把它接进「每回合强制调用」「多账号轮询」「给别的应用当 API」这类场景，既超出本扩展的设计，
也超出 WorkBuddy 服务条款允许的使用范围，风险与后果由使用者自行承担。

## 装之前要知道什么

- **系统**：Windows（`os: ["win32"]`）。macOS / Linux 的凭据与进程探测代码在，但没有实机验证过，不虚报。
- **宿主**：Coopanion 0.2.17（`api: 6`），Node ≥ 22。
- **前置**：本机装好并**已登录** WorkBuddy 桌面端。没登录也能装，但 `wb_chat` / `wb_credits` 要等登录后才可用。
- **风险**：本扩展走的是 WorkBuddy 客户端自身的接口（非官方开放 API），**可能不符合对方服务条款**。
  后果从「被限流」到「封号 / 订阅终止不退款」都有可能，插件本身也可能某天随上游改动失效。
  完整披露（含概率表与自保建议）见 [SECURITY.md](./SECURITY.md) 的「使用风险」一节；
  一句话版本：**小号先行、发现异常立刻停用、保留官方 API 作退路**。
- **宿主文件零改动**：本扩展不往 Coopanion 主界面注入任何东西，`resources\app` 不会被改写。
  详见「宿主文件：一个字节都不改」。

## 快速开始

### 1. 安装

一条命令（推荐；脚本会做完打包、装卸、哈希与版本校验）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reinstall.ps1
```

手工装的话，三步。第一步装 World 包——用 Coopanion 自带的 pnpm，**必须带 `--store-dir`**
（否则报 `ERR_PNPM_UNEXPECTED_STORE`），工作目录是 `<data>\extensions`；**同版本重装要先 remove**
（`file:` 依赖按版本复用，不 remove 等于没装）：

```powershell
cd "C:\Users\<你>\AppData\Local\Programs\Coopanion\data\extensions"
node "C:\Users\<你>\AppData\Local\Programs\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" remove cortico-world-workbuddy
node "C:\Users\<你>\AppData\Local\Programs\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" `
  add "$env:LOCALAPPDATA\cortico-world-workbuddy\build\cortico-world-workbuddy-0.3.13.tgz" `
  --config.strict-dep-builds=false `
  --store-dir "C:\Users\<你>\AppData\Local\Programs\Coopanion\data\pnpm\store\v11"
```

装扩展走上面两条：跑 `scripts/reinstall.ps1`，或者自己用宿主自带的 pnpm 装卸。装进去之后它会出现在「World 扩展」那张页面里，可以**停用**和**删除**。

第二步（可选，面板也能改）在 `data\home\companion\config.json` 的 `worlds.workbuddy` 段确认开关：

```json
"workbuddy": {
  "enabled": true, "model": "deepseek-v4.1-flash",
  "credentialsDir": "", "baseUrl": "", "maxTokens": 2048,
  "envPrompt": true, "safeOnly": true,
  "localCatalog": true, "localCatalogDelayMs": 3000
}
```

第三步重启 Coopanion（ESM 模块缓存不支持热换代码），用带环境清理的启动器：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-coopanion.ps1
```

> **为什么要有启动器**：终端里残留 `ELECTRON_RUN_AS_NODE=1`（比如跑过 Node 子进程）时，从这里
> 启动的 Electron 会进入 **Node 模式**：窗口不出来、`Coopanion.exe --version` 打印 `v24.x`
> （node 版本）、`--enable-logging` 报 `bad option`。这不是二进制损坏，是环境变量被继承；
> 启动器只清本进程树里的这个变量，不动用户/机器级设置。

### 2. 第一次打开

- 模型面板可能先显示磁盘上那份目录；启动 3 秒后会读一次 WorkBuddy 的本地缓存（见
  「模型目录怎么来」），顶部会显示「更新时间」和出处。
- 想看桥接当前状态，在聊天里发 **`/wb`**（见「面板与自查」）。
- 目录为空或过期时，在模型面板点「**从服务器刷新**」——这是唯一会主动拉上游的操作，且要求 WorkBuddy 主进程在跑。

### 3. 卸载与还原

1. 在「World 扩展」里卸载，或执行 `pnpm remove cortico-world-workbuddy`，然后重启 Coopanion。
   详情页入口与 `wb_*` 工具随之消失，Coopanion 主体和其他 World 不受影响。
2. 宿主的卸载接口只删除扩展包，不调用扩展清理逻辑，也不删除部署配置和账本。因此在源码目录
   再执行一次显式清理（先检查、后清理）：

   ```bash
   node scripts/clean-workbuddy.mjs --check
   node scripts/clean-workbuddy.mjs --clean
   ```

   清理范围只有：`config.json` 的 `worlds.workbuddy` 块、`.env` 的 `accessToken` 行
   （真实 token 或 `wb-cleared` / `wb-auto` 哨兵），以及数据目录里的
   `workbuddy-usage.jsonl`、`workbuddy-catalog.json`、`workbuddy-balance.json`。
   其他配置、其他密钥和宿主文件不动，命令输出也不会显示 token。普通 `stop()` / 重启不会删除账本。
3. 装过 0.2.x 的机器，另跑一次旧版注入清理（见「宿主文件：一个字节都不改」）。

## 配置项一览

全部键都在 `worlds.workbuddy.*` 下，面板里能改的会即时生效；标「重启生效」的需要重启 Coopanion。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 是否启用本 World。安装时宿主写成 `true`；关掉等于停用，工具与面板一起消失 |
| `model` | `""` | 当前模型 id（面板点选即写这里）；空表示未选择 |
| `credentialsDir` | `""` | 自定义凭据目录，留空自动发现（重启生效） |
| `baseUrl` | `""` | 自定义上游地址，代理/中转用；设置后目录、对话、余额三处都走它（重启生效） |
| `maxTokens` | `2048` | `wb_chat` 单次输出上限 |
| `envPrompt` | `true` | 是否把桥接状态写进 system 前缀 |
| `safeOnly` | `true` | 只允许调用安全清单内的公开对话模型；关掉会放行 disabled / 别名 / 预览等项，风险自负 |
| `localCatalog` | `true` | 是否读 WorkBuddy 本地缓存目录（`~/.workbuddy/cache/`，可用 `WORKBUDDY_CONFIG_DIR` 改）；关掉后只认磁盘上手头那份目录 |
| `localCatalogDelayMs` | `3000` | 启动 / 检测到主进程后，隔多少毫秒再读本地缓存（给桌面端落盘留时间），夹在 1000–15000 |

## 模型目录怎么来（本地缓存优先 + 手动刷新）

WorkBuddy 桌面端每次启动都会把 `/v3/config` 的原文写到
`~/.workbuddy/cache/acc-product-config-v3-<pid>-<uuid>.json`（根目录可用环境变量
`WORKBUDDY_CONFIG_DIR` 改），字段名与本扩展解析上游时完全一致。所以目录有两个来源：

| 来源 | 什么时候用 | 面板上的样子 |
|---|---|---|
| 本机缓存 | 启动后 3 秒读一次；之后每 6 秒轮询，只在主进程号变化、缓存目录 mtime 变化、或每 30 轮（约 3 分钟）兜底时才真正读文件 | `本地缓存 · 11-04 21:12` |
| 服务器 | 只在你点「从服务器刷新」时请求，且要求 WorkBuddy 主进程在跑 | `服务器 · 11-04 20:30` |

两份按时间戳比，**谁新用谁**：用本地那份时时间取缓存文件 mtime，磁盘那份更新就保持原样；
两种情况都会把目录与时间戳统一落盘（落盘写目录时间，不写当时时间）。不做 TTL 过期判定——
只有「谁新用谁 + 标注更新时间」，不会因为缓存放久了就拒用。

目录本身、对话与余额的其余细节：

- **目录**：`GET /v3/config`（应用身份 UA）。用 CLI 身份只能读到精简目录、促销字段整段缺失——
  这是「倍率永远显示原价」的根因，所以扩展从不走 CLI 目录。
- **对话**：`POST /v2/chat/completions`（SSE 流式），固定走 `copilot.tencent.com`；
  **余额**：`POST /v2/billing/meter/get-user-resource`，走 `www.codebuddy.cn`。配了自定义
  `baseUrl` 时两个域都由它替换。
- **主进程检测**：桌面端的渲染进程都是主进程的子进程，所以「有 `WorkBuddy.exe`」等价于「主进程在跑」
  （`tasklist` / `pgrep`，2.5 秒缓存）。`wb_chat` / `wb_credits` 都以此为前提，不在跑时直接返回
  「未检测到 WorkBuddy 主进程」，不打上游。
- **凭据**：桌面端 5.7.x 起登录态在 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\`
  下的 `workbuddy-desktop.info`。字段加密时，扩展用 `WorkBuddy.exe` 自己的 `loggerGet()` 取
  `atRestSecretKey` 自动解封；实在拿不到时在「账号」面板手动粘 access token 即可——token 只经
  `ctx.storeSecret()` 进部署的密钥库，**不写配置、不进日志、面板只显示掩码**。
- **登录态失效**：`/v3/config` 返回 401/403 时直接判 `session_dead` 并清掉本次 token；下一次调用
  重新从本机凭据发现。本扩展不调用刷新接口，chat 请求也绝不携带 refresh token。
- **倍率**：完全来自上游目录的 `credits` 字段，扩展不写死。一条促销按 `schedule` 生效
  （时区默认 `Asia/Shanghai`、`validFrom` / `validUntil`、`daily` 时段支持 `23:00`→`07:50` 跨零点）；
  `discount.discountedCredits`（如 `0.50x`）**就是生效倍率本身**，不是相对原价的系数。

## 安全清单与闸门

`disabled`、内部路由别名、媒体/代码补全与状态不明的模型都不要经外部软件调用，否则有风控/封号风险。
这里把它落成代码（`src/safety.js`）：

- **白名单 18 个**，按 DeepSeek / GLM / 混元 / Kimi / 其他分组：
  `deepseek-v4.1-flash`、`deepseek-v4-pro`、`glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.2`、
  `hy3`、`hy4free`、`hy4std`、`kimi-k2.8-preview`、`kimi-k3-2`、`kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、
  `minimax-m3-pay`、`minimax-m3.1-flash`、`mimo-v2.6-pro`、`space-bunny`、`step-5-preview`。
  其中 `hy3`、`kimi-k2.8-preview`、`step-5-preview`、`hy4free` 标为「**谨慎**」（免费试用 / 预览，
  别做高频自动化）。
- **可调用但需注意**：`hy4free` 带 11/4–11/15「限时免费」促销，比照 `hy3` 记为谨慎档；`hy4std`
  是 x0.29 常规定价、非 preview，按公开对话模型放行。旧 id `hy4-preview` 已从官方目录消失，
  并入 `DELISTED_IDS` 置灰、不再放行。
- **其余全部拒绝**：`wb-lite`（目录 `disabled: true`）、`auto` / `fast-model` / `balanced-model` /
  `deep-model`（内部路由别名）、4 个媒体模型、`codewise-*`、同前缀实验号（`hy4-preview-ctrl`、
  `hy4-preview-exp`、`hy4preview-exp1`、`hy4preview-exp2`）、20 个已下架或已移出目录的
  （含 `hy4-preview-x` 与已移出目录的 `hy4-preview`）、`glm-5.0-turbo`（11150 请求格式不符）。
- **闸门**是 `worlds.workbuddy.safeOnly`（默认 `true`）。开着时 `wb_chat` / `wb_select_model` /
  面板「选用」三处一致拒绝，并说明「判定档位 + 理由 + 怎么解除」；关掉才放行，属于明示的风险自负。

## 面板与自查

详情页有三个面板：

| 面板 | 内容 |
|---|---|
| 模型目录 | 顶部显示目录**更新时间/出处**（`本地缓存 · 11-04 21:12` / `服务器 · 11-04 20:30`）与只读主进程状态；「从服务器刷新」按钮（主进程没在跑时禁用并说明原因）；逐模型一行：名称/id、**合规档位**、**此刻倍率**（含限时折扣时显示 `x0.5 ← x0.79 23:00–07:50`，x0 标「免费」）、上下文、推理档、「选用」按钮；默认只列安全清单，勾选「显示全部模型（含不建议项）」才展开其余项 |
| 账号 | 登录态来源（本机发现 / 手动）、掩码 token、积分余额查询、重新检测、手动 token 存取 |
| 用量与成本 | 区间概览（今天 / 近 7 天 / 近 30 天 / 全部，列：调用、失败、积分、输入/输出/缓存命中/合计 token）、按模型近 30 天聚合、积分包明细、限时优惠清单、最近调用；带「刷新余额」「清空本地账本」 |

### 工具（给 Coo / 模型调用）

| 工具 | 作用 |
|---|---|
| `wb_list_models` | 列出**安全清单内**的模型及此刻倍率（含限时优惠与时段），并单列优惠清单；传 `all=true` 才带上被排除项与理由（只读） |
| `wb_select_model` | 按 id 选择 `wb_chat` 的默认模型，持久化；提示此刻倍率；安全清单外会被拒 |
| `wb_chat` | 用选中模型回答一个单轮问题（**真实消耗积分**，需主进程在跑）；回执附输入/输出/缓存 token 与本次积分；安全清单外会被拒 |
| `wb_credits` | 只读查询积分余额与本周期已用（需主进程在跑） |
| `wb_selfcheck` | 自查入口的实现，对应聊天里的 `/wb`（只读、不花积分） |

`wb_*` 工具由 Coo 按需调用，不调用就不花积分。

### 自查入口 `/wb`

在聊天里对 Coo 说 `/wb`，它会调 `wb_selfcheck` 工具并把结果原样转达。三个分支：

| 输入 | 内容 |
|---|---|
| `/wb` | 状态表：主进程与 mainPid、登录态（只显示「已发现 / 未发现」和凭据来源，token 永不打印）、目录来源与模型数、安全清单可调用数、本地缓存路径、上次刷新时间、当前模型与倍率、今日积分与调用数 |
| `/wb logs [n]` | Coopanion `core.log` 里 `worlds.workbuddy` 的最近 n 行（默认 20，1–200）；读不到就如实说读不到，不报错 |
| `/wb models` | 当前可调用模型及此刻倍率（与 `wb_list_models` 同一份渲染） |

实现只用 `node:fs` / `node:path`：不联网、不加依赖、不写文件，任何失败都折成一句「读不到」。
Coopanion 的 World API 没有注册斜杠指令的钩子，
所以 `/wb` 是「`wb_selfcheck` 工具 + `src/ENV_PROMPT.md` 里的映射约定」，不是框架原生指令。

### 用量统计口径

- 每次 `wb_chat` 记一行到 `<Coopanion data>\home\companion\data\workbuddy-usage.jsonl`
  （即 `ctx.dataDir`）：`ts/model/ok/promptTokens/completionTokens/totalTokens/cachedTokens/reasoningTokens/credit/multiplier/baseMultiplier/promoId/source/durationMs`。
- `credit` 取 SSE 各段合并后的 `usage.credit`，即**上游真实扣费**；倍率 0.11 的模型单次请求不足 1 分时
  上游就是 0，这里照抄不折算。上游未回传时记为未知，概览用 `+ ?` 标出缺口，绝不当成 0；
  `multiplier` 是响应完成时的生效倍率，`baseMultiplier` 是目录原价。
- 积分包余额另存 `workbuddy-balance.json`（`POST /v2/billing/meter/get-user-resource` 的 `*Precise`
  字段求和），面板上的「刷新余额」会重取一次。账本只保留 90 天，读的时候顺带裁掉；
  「清空本地账本」会把它清成空文件，服务端数据不受影响。

## 已知问题与已解决问题

- **已知问题**（挂起 / 未修 / 设计取舍，含平台限制）：见 [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) 的
  「挂起 / 未修」与「平台 / 环境限制」两张表——例如三处「查积分」主进程闸门口径不一、缓存目录只增不减、
  本地缓存没有账号归属标记。这份文件只留在本地工作副本里供对照，**不进 npm 包，也不随 GitHub 发布上传**。
- **已解决问题**：同一份文件的「已关闭」表按版本倒序列出 0.3.8–0.3.11 修掉的项（legacy 降级误覆盖、
  CLI 子集顶掉完整目录、启动时主动联网查余额、`verify-ui` 不消费断言结果等）；每条的细节与复现见
  对应的 `REVIEW-*.md` 与 TEST-REPORT。

## 常见问题

**问：模型面板是空的 / 只有很少几个模型？**
先看顶部「更新时间」。没有来源说明两条都还没成功：等 3 秒（启动后读本地缓存）或点「从服务器刷新」。
WorkBuddy 没装或没登录也不影响读缓存，但刷新要求主进程在跑。

**问：「从服务器刷新」按钮是灰的？**
主进程没在跑。先打开 WorkBuddy 桌面端，面板最多 6 秒后自己变可用；按钮上的提示文字会说明原因。

**问：为什么某个模型选不了 / 显示「不在安全清单」？**
它不在白名单里（disabled、内部别名、媒体/代码模型、实验号、已下架等）。`wb_list_models` 传
`all=true` 能看到每个被拒项的理由。想强行放行只能关 `safeOnly`，那是明示的风险自负。

**问：倍率显示的是原价，但官方显示有折扣？**
多半是读到了 CLI 通道的精简目录（促销字段缺失）。正常情况下扩展优先用带促销的 GUI 缓存；
点一次「从服务器刷新」即可纠正。

**问：重启 Coopanion 后窗口不出来，`--version` 打印 `v24.x`？**
终端里残留了 `ELECTRON_RUN_AS_NODE=1`。用 `scripts/launch-coopanion.ps1` 启动，它只清本进程树的这个变量。

**问：卸载后配置和账本还在？**
宿主卸载只删包。按「卸载与还原」跑一次 `clean-workbuddy.mjs --clean`。

**问：`/wb` 没反应？**
`/wb` 不是框架原生指令，靠环境提示词把「用户发了 /wb」映射成工具调用。若 Coo 没照做，直接说
「用 wb_selfcheck 查一下状态」也能触发；`envPrompt` 关掉时提示词里没有这条约定。

**问：会不会偷偷改宿主文件 / 偷传数据？**
不会。读哪些文件、默认只发给哪两个官方域名、哪些从不写盘，见 [SECURITY.md](./SECURITY.md)。

## 版本与发版

### 开发与校验

```bash
# 重新构建面板产物（改了 src/webui/client.js 后）
# 优先用本地 devDependency（锁在 package-lock.json 的 0.28.2），没装则退回宿主自带的 esbuild；
# `prepack` 走 `--strict`：两条路都没有就直接失败，绝不静默发布过期 dist。
node scripts/build-web.mjs

# 契约检查（不依赖宿主，CI 必跑）
node scripts/contract.mjs

# 由源码重新生成 describe.json（改过工具声明或 ENV_PROMPT.md 之后）
node scripts/gen-describe.mjs

# 框架契约自检（dry-mount：定义、工具、envPrompt、webUi）
# 缺宿主时（CI）自动改跑离线检查：全部文件 node --check + contract，不再无条件成功
node scripts/selfcheck.mjs

# 真实窗口 UI 验证（headless Chrome + CDP，连跑 3 轮；需 Coopanion 正在运行）
node scripts/verify-ui.mjs --runs 3
```

UI 验证脚本的约定（踩过坑，别再用固定 sleep）：每轮导航都带 `?t=<时间戳>` 整页重载（`Page.navigate`
只改 hash 属于同文档导航，不会重新加载），元素等待统一走 15 秒轮询，并把「路由挂载」与「面板渲染」
拆成两条断言。另有几条必须为真的检查（都在 `REQUIRED_CHECKS` 里，缺一条就整轮失败）：模型面板来源芯片
的文本、「从服务器刷新」按钮的 `disabled` 与面板 `state.running` 是否一致（**一个读 DOM、一个读接口**，
不同源才抓得到绑定写坏）、切到账号面板后能否等到「查询积分」按钮。

### 版本号与打包

任何改动都 bump `package.json` 的 `version`，备份目录按版本命名（`F:\coo-connect-wb\0.3.13\`），
再用 `scripts/reinstall.ps1` 装；它先解出 tgz，再拿**解出来的内容**与安装目录逐文件比对哈希，
不一致直接非零退出。

打包注意：**不要用 PowerShell 的 `Get-Content -Raw | Set-Content` 改 `package.json`**
（会带 BOM / 把中文写坏，pnpm 报 `Bad control character in string literal in JSON`），用 node 读写 JSON；
tgz 必须以 `package/` 为前缀：

```bash
tar -czf cortico-world-workbuddy-0.3.13.tgz -C <stage> package
```

`scripts/reinstall.ps1` **只走 `npm pack`**（`prepack` 会重建 `dist/webui.js`）；找不到 npm 或 pack
失败直接报错退出，不再退回手工 `tar`——那条路会绕过 `prepack`，把一份旧 `dist/webui.js` 装进宿主。
上面的 `tar` 命令只用于手动核对包内容。

包的发布清单用 `files` 白名单（`src` / `dist` / `assets` / `README.md` / `CHANGELOG.md` /
`describe.json` / `scripts` / `LICENSE` / `SECURITY.md`），`.npmignore` 再排除 `scripts/visual/`、
`TEST-REPORT.md`、`KNOWN-ISSUES.md` 等。**`KNOWN-ISSUES.md` 只留在本地工作副本供对照：
不进 npm 包，也不随 GitHub 发布上传**；
用 `npm pack --dry-run` 可以核对清单。

### 发布（GitHub / npm / 扩展市场）

Cortico 的扩展**从 npm 安装**；GitHub 是源码与申请的入口，官方索引仓
[cortico-extensions](https://github.com/Pal-AI-Lab/cortico-extensions) 只放标签词表、认证与覆盖项。
Action 定时扫 npm 生成市场目录，所以发版顺序是：**先 npm publish，再 `[sync]` 催收录**。

本包发布元数据：

| 项 | 值 | 为什么 |
|---|---|---|
| `os` | `["win32"]` | 只在 Windows 实机验证过；macOS/Linux 的凭据与进程探测代码在，但没跑过，不虚报 |
| `cortico.tags` | `unofficial-api`, `external-setup`, `sensitive-data` | 用账号调客户端内部接口 / 需先装 WorkBuddy 桌面端 / 会读本机凭据文件 |
| `License` | MIT（`LICENSE` 随包） | 市场与 npm 页都会读 |
| `engines.node` | `>=22` | 与 Coopanion 0.2.x 的运行环境一致 |
| `cortico.describe` | `describe.json` | 工具 / 事件 / 环境提示词的机器可读自描述，工具变了要重新生成 |

发布步骤：

```bash
# 1. 发版前三连检（需要本机真实宿主）
node scripts/contract.mjs
node scripts/selfcheck.mjs
node scripts/verify-ui.mjs --runs 3

# 2. 提交并打 tag
git tag v0.3.13 && git push --tags

# 3. 发布（prepack 会自动重建 dist/webui.js）
npm publish --access public

# 4. 让市场立刻收录（可选；Action 也会定时扫）
gh issue create -R Pal-AI-Lab/cortico-extensions --title "[sync] cortico-world-workbuddy" --body ""
```

对标签有异议用 `[tags]`、申请蓝标认证用 `[certify]`、被拉黑申诉用 `[appeal]`，正文一行一项
`键: 值`（`package` / `add` / `remove` / `reason` / `evidence`）。

CI 里没有 Coopanion：自检改跑离线检查（全部源码 `node --check` + `contract`），不会红叉，也不会
无条件算通过：`node scripts/selfcheck.mjs --allow-missing-host`。

## 宿主文件：一个字节都不改

如果你装过 0.2.x，宿主 `build\console\` 里可能还留着三处痕迹。扩展本体不会自动改宿主文件
（这正是 0.3.0 起的承诺），请用一次性迁移脚本清理：

```bash
node scripts/clean-legacy-injection.mjs --check   # 只列出会动的项
node scripts/clean-legacy-injection.mjs --clean   # 执行清理（幂等）
```

| 文件 | 脚本会做什么 |
|---|---|
| `<app>\build\console\index.html` | 只剥掉 `<script type="module" src="./workbuddy-home.js"></script>` 这一行，保留原有换行风格与其余内容 |
| `<app>\build\console\workbuddy-home.js` | 删除旧的注入脚本 |
| `<app>\build\console\index.html.workbuddy-backup` | 删除首次注入前的原件备份 |

## 许可与致谢

MIT，见 [LICENSE](./LICENSE)。本扩展与腾讯 / WorkBuddy 官方无关，也不代表 Pal AI Lab / Cortico /
Coopanion 官方立场；它使用的不是 WorkBuddy 官方开放 API，而是本机客户端自身的接口，上游一旦调整
或收紧，扩展可能失效，也可能带来账号层面的风险。

使用即表示你理解并接受：

1. **仅限个人、本地、桌宠文字对话中的按需调用**——这是本扩展唯一的设计用途；
2. 所有调用消耗**你自己账号**的积分，倍率与扣费以上游为准，扩展只做记录与展示；
3. 账号状态、积分变动、风控与封禁由上游裁量，本扩展作者不承担任何责任；
4. 把本扩展用于对外提供接口、批量调用、多账号共享、绕过计费或其它未声明用途，属于超出设计范围的使用，
   后果由使用者自行承担。

凭据读取范围、网络出口、写盘内容与风险披露见 [SECURITY.md](./SECURITY.md)。
官方 [服务条款](https://www.workbuddy.cn/document/term) 与
[可接受使用政策](https://www.workbuddy.cn/document/acceptable-use-policy) 始终优先于本扩展的任何行为。

协议细节参照 [dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)（MIT）的
实测结论；扩展框架契约见 Cortico 的 `docs/extensions.md` / `docs/worlds.md` / `docs/webui.md`。
