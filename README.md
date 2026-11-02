# cortico-world-workbuddy

把 **本机已登录的 WorkBuddy 客户端**（国内版 / 国际版）的模型桥接进
[Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 桌宠：Coo 可以直接调用你
WorkBuddy 账号里的模型，World 面板里可以浏览模型目录、查看每个模型的
**默认积分倍率**（如 `x0.79`）并点选要用的模型；World 详情页有一个「是否启用Workbuddy」
开关，打开后桌宠每轮对话都先问 WorkBuddy。

这是一个 Cortico 的 World 扩展（`kind: world`，`api: 6`），纯 ESM JS、零运行时依赖，
面板产物已随包构建好（`dist/webui.js`）。

> **风险提示**：本扩展使用的是 WorkBuddy 客户端自身的接口（非官方开放 API），
> 上游一旦收紧限制，扩展可能失效。每次 `wb_chat` 调用都消耗**你自己账号**的积分，
> 按上游给出的倍率真实扣费；扩展不提供账号、不共享凭据、不绕过计费。
> 请自行评估账号风险，官方 WorkBuddy 客户端始终是最安全的选择。

## 安装（0.3.0，Coopanion 0.2.17 实机验证）

一条命令（推荐，脚本会做完打包、装卸、哈希与版本校验）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reinstall.ps1
```

手工装的话，三步：

1. 装 World 包。用 Coopanion 自带的 pnpm，**必须带 `--store-dir`**（否则
   `ERR_PNPM_UNEXPECTED_STORE`），工作目录是 `<data>\extensions`；**同版本重装要先 remove**
   （`file:` 依赖按版本复用，不 remove 等于没装）：

   ```powershell
   cd "C:\Users\<你>\AppData\Local\Programs\Coopanion\data\extensions"
   node "C:\Users\<你>\AppData\Local\Programs\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" remove cortico-world-workbuddy
   node "C:\Users\<你>\AppData\Local\Programs\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" `
     add "$env:LOCALAPPDATA\cortico-world-workbuddy\build\cortico-world-workbuddy-0.3.0.tgz" `
     --config.strict-dep-builds=false `
     --store-dir "C:\Users\<你>\AppData\Local\Programs\Coopanion\data\pnpm\store\v11"
   ```

   也可以在 Coopanion 设置窗 → 高级模式 →「World 扩展」→ 手动安装里填本包目录的绝对路径。

2. 在 `data\home\companion\config.json` 的 `worlds.workbuddy` 段里确认开关（可选，面板也能改）：

   ```json
   "workbuddy": {
     "enabled": true, "region": "cn", "model": "deepseek-v4.1-flash",
     "credentialsDir": "", "baseUrl": "", "maxTokens": 2048,
     "envPrompt": true, "prefer": false
   }
   ```

3. 重启 Coopanion（ESM 模块缓存不支持热换代码），用带环境清理的启动器：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-coopanion.ps1
   ```

   > **为什么要有启动器**：终端里残留 `ELECTRON_RUN_AS_NODE=1`（比如跑过 Node 子进程）时，
   > 从这里启动的 Electron 会进入 **Node 模式**：窗口不出来、`Coopanion.exe --version`
   > 打印 `v24.x`（node 版本）、`--enable-logging` 报 `bad option`。这不是二进制损坏，
   > 是环境变量被继承。启动器只清本进程树里的这个变量，不动用户/机器级设置。


## 卸载与还原

- **只卸扩展**：在「World 扩展」里卸载 / 或 `pnpm remove cortico-world-workbuddy`。
  详情页入口随之消失，桌宠工具表里也不再有 `wb_*`——Coopanion 主体不受影响。
- **不碰宿主文件**：0.3.0 起扩展**不再往 Coopanion 主界面注入任何脚本或按钮**，
  `resources\app` 下一个字节都不会被改写，卸载后不需要还原任何东西。
- **旧版本残留**：如果装过 0.2.x，宿主 `build\console\` 里可能还留着 `workbuddy-home.js`
  与 `index.html` 里的一行引用；删掉那个文件、去掉 `index.html` 里
  `<script type="module" src="./workbuddy-home.js"></script>` 这一行即可。

## 工作原理

```
Coopanion (Coo)
  └─ World: workbuddy
       ├─ 主进程检测  tasklist / pgrep → WorkBuddy.exe 在不在跑（2.5s 缓存）
       ├─ 凭据发现   %LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info
       │              （$wbEncrypted 信封 → 用桌面端自己的二进制自动解封）
       ├─ 上游客户端 copilot.tencent.com（对话）/ www.codebuddy.cn（计费）
       │    ├─ GET  /v3/config                              模型目录 + 促销（models / modelPromotions / modelTiers）
       │    ├─ POST /v2/chat/completions                     对话（SSE 流式）
       │    ├─ POST /v2/auth/refresh                         刷新 token（X-Refresh-Token）
       │    └─ POST /v2/billing/meter/get-user-resource      积分余额（只读）
       ├─ 工具        wb_list_models / wb_select_model / wb_chat / wb_credits
       └─ WebUI 面板  模型目录、账号、是否启用 WorkBuddy（中转站优先）
```

- **主进程检测**：桌面端的渲染进程都是主进程的子进程，所以「有 `WorkBuddy.exe`」等价于
  「主进程在跑」。`wb_chat` / `wb_credits` 都以此为前提，不在跑时直接返回
  「未检测到 WorkBuddy 主进程」，不打上游。
- **凭据**：桌面端 5.7.x 起登录态在 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\`
  下的 `workbuddy-desktop.info`（不是 `%APPDATA%\WorkBuddy\*.json`，也不是 `.json`）。
  字段加密时，扩展会用 `WorkBuddy.exe` 自己的 `loggerGet()` 取 `atRestSecretKey` 自动解封，
  不需要你手动设环境变量；实在拿不到时，在「账号」面板手动粘 access token 即可——
  token 只经 `ctx.storeSecret()` 进部署的密钥库，**不写配置、不进日志、面板只显示掩码**。
- **积分倍率**：完全来自上游目录的 `credits` 字段，扩展不写死；刷新后缓存到
  `workbuddy-catalog.json`，重启不丢。
- **区域**：国内版 `copilot.tencent.com` 与国际版 `www.workbuddy.ai` 是两个上游；
  计费域国内是 `www.codebuddy.cn`。切 `worlds.workbuddy.region` 后重新刷新目录。

## 「中转站优先」开关

一份状态（`worlds.workbuddy.prefer`），一个入口，默认是**关**：

| 入口 | 位置 | 行为 |
|---|---|---|
| 详情页开关 | 「World 扩展」→ WorkBuddy 桥接 →「是否启用Workbuddy」 | 勾选＝开；取消＝关 |

> 0.3.0 起**不再往主界面「开始」页注入「中转站优先」按钮**（也就不需要改宿主文件）。
> 想快速开关，把它当书签存一下 World 详情页即可。

- 开 → 环境提示词告诉 Coo：每轮对话先 `wb_chat`（用 `worlds.workbuddy.model`），
  再把回答用自己的话讲出来并说明是哪个模型答的。
- 关 → Coo 完全不碰 `wb_*`（用户明确点名 WorkBuddy 时除外）。
- 打开时若没检测到主进程：不会把开关打开，面板提示「未检测到Workbuddy」。
- 主进程在 6 秒轮询里退出时，开关自动熄灭，避免亮着却调不通。

## 面板

| 面板 | 内容 |
|---|---|
| 模型目录 | 刷新目录；逐模型一行：名称/id、**合规档位**、**此刻倍率**（含限时折扣时显示 `x0.5 ← x0.79 23:00–07:50`，x0 标「免费」）、上下文、推理档、「选用」按钮；默认只列安全清单，勾选「显示全部模型（含不建议项）」才展开其余项 |
| 账号 | 登录态来源（本机发现 / 手动）、掩码 token、积分余额查询、重新检测、手动 token 存取 |
| 是否启用 WorkBuddy | 「中转站优先」开关 + WorkBuddy 主进程状态 |
| 用量 | 区间概览（今天 / 近 7 天 / 近 30 天）、按模型聚合、积分包明细、限时优惠清单、最近调用；带「刷新余额」「清空本地账本」 |

### 安全清单（合规闸门）

WorkBuddy 官方对话给出的口径是：只调用「官方公开目录里、当前可正常对话」的模型，
`disabled`、内部路由别名、媒体/代码补全与状态不明的模型都不要经外部软件调用，否则有风控/封号风险。
这里把它落成代码：

- 白名单 22 个（`src/safety.js` 的 `SAFE_MODEL_IDS`，按 DeepSeek / GLM / 混元 / Kimi / 其他分组）：
  `deepseek-v4.1-flash`、`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v3-2-volc`、
  `glm-5.3-flash`、`glm-5.3`、`glm-5.2`、`hy3`、`hy3-b`、`hy3-c`、`hy3-x`、`hunyuan-chat`、
  `hy4-preview`、`kimi-k2.5`、`kimi-k2.8-preview`、`kimi-k3-1`、`kimi-k3.1-pro`、`minimax-m2.7`、
  `minimax-m3.1-flash`、`mimo-v2.6-pro`、`space-bunny`、`step-5-preview`。
  其中 `hy3*` 与 `*preview`（含 `hy4-preview`）标为「谨慎」（免费试用/预览，别做高频自动化）。
- 其余全部**拒绝**：`wb-lite`（目录 `disabled:true`）、`auto` / `fast-model` / `balanced-model` /
  `deep-model`（内部路由别名）、4 个媒体模型、`codewise-*`、其他 `hy4-preview*` 变体（只精确放行
  `hy4-preview`）、19 个已下架的、
  `glm-5.0-turbo`（11150 请求格式不符）。
- 闸门是 `worlds.workbuddy.safeOnly`（默认 `true`）。开着时 `wb_chat` / `wb_select_model` / 面板「选用」
  三处一致拒绝，并说明「判定档位 + 理由 + 怎么解除」；关掉才放行，属于明示的风险自负。
- 清单是按 2026-11 的官方目录定的，官方加新模型不会被自动信任——这正是「未列入安全清单」这一档的意义。


### 倍率与限时优惠怎么算

- 目录来自 `GET /v3/config`（应用身份 UA）：一次同时拿到 `models`、`modelPromotions`、`modelTiers`。
  用 CLI 身份只能读到精简目录，促销字段会整段缺失——这是「倍率永远显示原价」的根因。
- 一条促销的生效条件是 `schedule`：`timezone`（默认按条目给的时区算）、`validFrom`/`validUntil`、
  `daily` 时段（支持 `23:00`→`07:50` 这类跨零点窗口）。命中的条目按 `priority` 取最高；平手时促销优先于档位。
- `discount.discountedCredits`（如 `0.50x`）**就是生效倍率本身**，不是相对原价的系数。
  `displayMode: "replace"` 直接替换显示，`"strikethrough"` 表示「划线原价 + 新价」并排。
- `badge.display: "activeOnly"` 的徽标只在生效时段出现（如「限时免费」试用）。

### 用量统计口径

- 每次 `wb_chat` 记一行到 `%APPDATA%\..\Coopanion\data\home\companion\data\workbuddy-usage.jsonl`
  （实机路径；实际就是 `ctx.dataDir`）：`ts/model/region/ok/promptTokens/completionTokens/totalTokens/cachedTokens/reasoningTokens/credit/multiplier/promoId/source/durationMs`。
- `credit` 取 SSE 最后一段的 `usage.credit`，即**上游真实扣费**；倍率 0.11 的模型单次请求不足 1 分时上游就是 0，这里照抄不折算。
- 积分包余额另存 `workbuddy-balance.json`（`POST /v2/billing/meter/get-user-resource` 的 `*Precise` 字段求和），
  面板上的「刷新余额」会重取一次。
- 账本只保留 90 天，读的时候顺带裁掉；「清空本地账本」会把它清成空文件，服务端数据不受影响。

## 工具（给 Coo / 模型调用）

| 工具 | 作用 |
|---|---|
| `wb_list_models` | 列出**安全清单内**的模型及此刻倍率（含限时优惠与时段），并单列优惠清单；传 `all=true` 才带上被排除项与理由（只读） |
| `wb_select_model` | 按 id 选择 `wb_chat` 的默认模型，持久化；提示此刻倍率；安全清单外会被拒 |
| `wb_chat` | 用选中模型回答一个单轮问题（**真实消耗积分**，需主进程在跑）；回执附输入/输出/缓存 token 与本次积分；安全清单外会被拒 |
| `wb_credits` | 只读查询积分余额与本周期已用（需主进程在跑） |

## 配置（`worlds.workbuddy.*`）

| 键 | 默认 | 说明 |
|---|---|---|
| `region` | `cn` | `cn` / `global` |
| `model` | `""` | 当前模型 id（面板点选即写这里） |
| `credentialsDir` | `""` | 自定义凭据目录，留空自动发现（重启生效） |
| `baseUrl` | `""` | 自定义上游地址，代理/中转用（重启生效） |
| `maxTokens` | `2048` | `wb_chat` 单次输出上限 |
| `envPrompt` | `true` | 是否把桥接状态写进 system 前缀（关掉后「中转站优先」也不生效） |
| `prefer` | `false` | 「中转站优先」，由详情页开关写入 |
| `safeOnly` | `true` | 只允许调用安全清单内的公开对话模型；关掉会放行 disabled / 别名 / 预览等项，风险自负 |

## 开发与校验

```bash
# 重新构建面板产物（改了 src/webui/client.js 后）
# 优先用本地 devDependency（锁在 package-lock.json 的 0.24.2），没装则退回宿主自带的 esbuild；
# `prepack` 走 `--strict`：两条路都没有就直接失败，绝不静默发布过期 dist。
node scripts/build-web.mjs

# 契约检查（不依赖宿主，CI 必跑）：describe.json 与源码一致、版本号与 CHANGELOG 对齐、
# 促销/安全清单/账本断言，以及哨兵、计费域、429 软硬、面板白名单、并发、SSE flush 等回归断言
node scripts/contract.mjs

# 由源码重新生成 describe.json（改过工具声明或 ENV_PROMPT.md 之后）
node scripts/gen-describe.mjs

# 框架契约自检（dry-mount：定义、工具、envPrompt、webUi）
# 缺宿主时（CI）自动改跑「离线检查」：全部文件 node --check + contract，不再无条件成功
node scripts/selfcheck.mjs

# 真实窗口 UI 验证（headless Chrome + CDP，连跑 5 轮；需 Coopanion 正在运行）
node scripts/verify-ui.mjs --runs 5

```

UI 验证脚本的两个约定（踩过坑，别再用固定 sleep）：每轮导航都带 `?t=<时间戳>` 整页重载
（`Page.navigate` 只改 hash 属于同文档导航，不会重新加载），元素等待统一走 15 秒轮询，
并把「路由挂载」与「面板渲染」拆成两条断言——否则一次产物没加载就会被误判成「按钮没了」。

版本号规范：任何改动都 bump `package.json` 的 `version`，备份目录按版本命名
（`F:\coo-connect-wb\0.3.0\`），再用 `scripts/reinstall.ps1` 装；它先把 tgz 解出来，再拿**解出来的内容**与安装目录逐文件比对哈希，
不一致直接非零退出。

打包注意：**不要用 PowerShell 的 `Get-Content -Raw | Set-Content` 改 `package.json`**
（会带 BOM / 把中文写坏，pnpm 报 `Bad control character in string literal in JSON`），
用 node 读写 JSON；tgz 必须以 `package/` 为前缀：

```bash
tar -czf cortico-world-workbuddy-0.3.0.tgz -C <stage> package
```

协议细节参照 [dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)
（MIT）的实测结论；扩展框架契约见 Cortico 的 `docs/extensions.md` / `docs/worlds.md` /
`docs/webui.md`。

## 宿主文件：一个字节都不改

0.3.0 起本扩展**不再往 Coopanion 主界面注入任何东西**——「中转站优先」只剩 World 详情页里
那个勾选框，工具、面板、账本全在各自主张的地方，`resources\app` 下不会有任何改动，卸载即干净。

如果你装过 0.2.x，宿主 `build\console\` 里可能还留着两处痕迹，删掉即可：

| 文件 | 说明 |
|---|---|
| `<app>\build\console\index.html` | 删掉 `<script type="module" src="./workbuddy-home.js"></script>` 这一行 |
| `<app>\build\console\workbuddy-home.js` | 旧的注入脚本，直接删 |
| `<app>\build\console\index.html.workbuddy-backup` | 首次注入前的原件备份，确认 `index.html` 干净后可删 |

## 发布（GitHub / npm / 扩展市场）

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
node scripts/contract.mjs        # 不依赖宿主，68 条断言
node scripts/selfcheck.mjs       # dry-mount 框架契约
node scripts/verify-ui.mjs --runs 3

# 2. 提交并打 tag
git tag v0.3.0 && git push --tags

# 3. 发布（prepack 会自动重建 dist/webui.js）
npm publish --access public

# 4. 让市场立刻收录（可选；Action 也会定时扫）
gh issue create -R Pal-AI-Lab/cortico-extensions --title "[sync] cortico-world-workbuddy" --body ""
```

对标签有异议用 `[tags]`、申请蓝标认证用 `[certify]`、被拉黑申诉用 `[appeal]`，
正文一行一项 `键: 值`（`package` / `add` / `remove` / `reason` / `evidence`）。

CI 里没有 Coopanion，自检会跳过而不是红叉：

```bash
node scripts/selfcheck.mjs --allow-missing-host   # 找不到宿主 → 警告 + 退出码 0
```

凭据读取范围与网络出口见 [SECURITY.md](./SECURITY.md)：读哪些文件、只发给哪两个域名、哪些从不写盘。

## 免责

本扩展与腾讯 / WorkBuddy 官方无关，也不代表 Pal AI Lab / Cortico / Coopanion 官方立场。
使用即表示你理解：所有调用消耗自己账号的积分，账号状态由上游管理，
扩展作者不对账号限制或扣费负责。凭据处理细节见 [SECURITY.md](./SECURITY.md)。
