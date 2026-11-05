# Security policy

This extension talks to *your own* WorkBuddy account on *your own* machine. It has no server,
no telemetry and no third-party analytics. This file states exactly what it touches, so you can
judge the risk before installing.

## Scope of use

This extension exists for one purpose: letting the Coo desktop pet answer **text conversations**
with you by calling a model from **your own, locally signed-in WorkBuddy account**, one call at a
time, only when a turn actually needs it.

It is **not** an API gateway, an OpenAI-compatible server, a batch/automation/crawling tool, a
multi-account pool, a credential-sharing service, or a way to bypass WorkBuddy billing. It opens no
listening port, exposes no HTTP endpoint, runs no background chat job, and sends only what your own
WorkBuddy client would send. Every `wb_chat` call is user-driven and consumes your own credits at
the upstream rate.

Do not redistribute, resell, or repurpose this extension as a model service for third parties.
That is outside its design and outside WorkBuddy's terms of service — see the Acceptable Use Policy
(§4 Restricted Use) and the Terms of Service (§3.5 Monitoring and Circumvention, §12) under
<https://www.workbuddy.cn/document/>.

## 使用风险

先说清性质：本扩展复用你在本机已经登录的 WorkBuddy 客户端能力——把客户端自己会发的请求按同样的
形状再发一次（`Authorization` 头取自本机凭据，模型目录与倍率取自客户端自己的缓存）。它没有官方
API 授权，也没有和厂商达成任何安排；换句话说，它在模拟一个已经打开的客户端，**这可能不符合
WorkBuddy 的服务条款**（参见上文 §4 限制用途、§3.5 监控与规避、§12）。是否使用、用到什么程度，
由你自己判断。

把可能发生的事按可能性排一下（只用文字描述，不给数字——这类概率没人能算准）：

| 后果 | 可能性 | 说明 |
|---|---|---|
| 请求被限流、返回 429 或临时不可用 | 较常见 | 通常是短时的，等一会儿或降低频率即可恢复 |
| 账号收到警告、被要求停止非常规调用 | 有可能 | 厂商风控看到的是客户端形态的流量，未必能区分你和它 |
| 账号被封禁 | 存在可能 | 频率高、行为异常时风险上升，且本扩展无法影响厂商的判定 |
| 订阅被终止且不退款 | 存在可能 | 一旦触发，退款与申诉都不在本扩展能处理的范围 |
| 插件某天突然失效 | 很可能 | 上游改字段、改接口或改加密方式都会让它失效，不保证及时修好 |

作者不承担的部分：不保证长期可用，也不承诺跟进上游的每一次改动；不对你的账号状态、订阅余额和
积分消耗负责；软件按现状提供，无担保、无补偿。

三条自保建议：

1. 优先用小号或备用账号试，别拿主账号当第一个试验品。
2. 一旦看到限流、异常登录提醒或账号警告，立刻停用本扩展，先确认账号没事。
3. 保留官方 API 作为退路——真需要稳定调用时走官方通道，别把业务压在客户端模拟上。

最后澄清一个容易混淆的边界：这里用的是**你自己已经付费的账号**，凭据也只从本机读取、不经过任何
第三方服务器；但「你付过钱」和「厂商允许你这样调用」是两件事，不能互相推导。

## What it reads

| Path | Why | Data |
|---|---|---|
| `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info` | To learn your WorkBuddy login | `auth.accessToken`, `auth.refreshToken`, `auth.expiresAt`, `auth.domain`, `account` |
| `%APPDATA%\WorkBuddy*\*.json` (if present) | Older WorkBuddy builds store the login here | same fields when stored in plain text |
| `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth` (fallback) | Same as above, directory scan | same fields |
| `WorkBuddy.exe` / `WorkBuddy AI.exe` (known install locations) | Only to ask the app for its own at-rest key | the key payload printed by the app's own `loggerGet()` binding; never stored |
| `<Coopanion data>\home\companion\config.json` | Read `worlds.workbuddy` | model id, `envPrompt` / `safeOnly` flags |
| `~/.workbuddy/cache/acc-product-config-v3-*.json` (since 0.3.7; root overridable with `WORKBUDDY_CONFIG_DIR`) | WorkBuddy's own cached `/v3/config`, used instead of fetching the catalogue. Since 0.3.9 the directory is `stat`-ed once per 6-second tick and a file is re-read only when it changed; the read itself is asynchronous with a 5-second budget for the whole scan. Since 0.3.10 candidates are examined with `lstat` and symlinks / reparse points are skipped — nothing outside this directory is followed | `models`, `modelPromotions`, `modelTiers` — model ids, prices, credit multipliers, promotion schedules; no credentials, no account data |

The token is decrypted in memory only when the file is encrypted, is used only as the
`Authorization: Bearer` header for WorkBuddy's own endpoints, and is never written anywhere except
the Coopanion deployment `.env` if you paste one in the account panel yourself (the framework's
`storeSecret`). Refresh tokens are never sent with chat requests.

## Where data goes

By default, only these two hosts, both WorkBuddy's:

- `https://copilot.tencent.com` — model catalogue (only when you press "Refresh from server") and
  chat completions
- `https://www.codebuddy.cn` — credit balance

If you set `worlds.workbuddy.baseUrl` (a proxy or mirror), **every** request — catalogue,
chat and credit balance — goes to that host instead, and the token is sent there too. That is
your own configuration choice, not a default. No other hosts are contacted. Token values are never
written to any log line, and wherever a token is displayed (the Account panel) it goes through
`maskToken()` first.

## What it writes

- `<Coopanion data>/home/companion/data/workbuddy-catalog.json` — cached model list, no credentials.
- `<Coopanion data>/home/companion/data/workbuddy-usage.jsonl` and `workbuddy-balance.json` — local
  usage ledger and credit snapshot, no tokens.
- `worlds.workbuddy.*` in the companion config (model, `envPrompt`, `safeOnly`).
- The deployment `.env` — only when you paste a token or clear it in the Account panel
  (the sentinels `wb-cleared` / `wb-auto` are written there; a real token only if you pasted one).

**Coopanion program files are never touched by the running extension.** Since 0.3.0 it does not
inject anything into `resources/app/build/console` and keeps no backup of host files. Coopanion's
own uninstall route removes only the package; it does not run extension cleanup code. After
uninstalling, run `node scripts/clean-workbuddy.mjs --check`, then `--clean`, from the source tree.
That explicit command removes only the `worlds.workbuddy` config block, the three data files above,
and the `accessToken` line in `.env`; it preserves every other setting and secret and never prints
the token. Ordinary `stop()` and restart never delete usage data.

If you upgraded from 0.2.x, an old one-line `<script>` reference, `workbuddy-home.js` and
`index.html.workbuddy-backup` may still be left over from that older version. Remove them once with
`node scripts/clean-legacy-injection.mjs --clean` (`--check` lists what it would touch). Neither
cleanup script runs automatically, and the extension never re-adds the injection.

## Reporting a vulnerability

Open a private security advisory on the repository, or a normal issue if the report does not
include secrets. Please do not paste access tokens, refresh tokens or `workbuddy-desktop.info`
contents into an issue — redact everything after the first eight characters.
