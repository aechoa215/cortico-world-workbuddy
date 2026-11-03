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

## What it reads

| Path | Why | Data |
|---|---|---|
| `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info` | To learn your WorkBuddy login | `auth.accessToken`, `auth.refreshToken`, `auth.expiresAt`, `auth.domain`, `account` |
| `%APPDATA%\WorkBuddy*\*.json` (if present) | Older WorkBuddy builds store the login here | same fields when stored in plain text |
| `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth` (fallback) | Same as above, directory scan | same fields |
| `WorkBuddy.exe` / `WorkBuddy AI.exe` (known install locations) | Only to ask the app for its own at-rest key | the key payload printed by the app's own `loggerGet()` binding; never stored |
| `<Coopanion data>\home\companion\config.json` | Read `worlds.workbuddy` | model id, `envPrompt` / `safeOnly` flags |

The token is decrypted in memory only when the file is encrypted, is used only as the
`Authorization: Bearer` header for WorkBuddy's own endpoints, and is never written anywhere except
the Coopanion deployment `.env` if you paste one in the account panel yourself (the framework's
`storeSecret`). Refresh tokens are never sent with chat requests.

## Where data goes

By default, only these two hosts, both WorkBuddy's:

- `https://copilot.tencent.com` — model catalogue and chat completions
- `https://www.codebuddy.cn` — credit balance

If you set `worlds.workbuddy.baseUrl` (a proxy or mirror), **every** request — catalogue,
chat and credit balance — goes to that host instead, and the token is sent there too. That is
your own configuration choice, not a default. No other hosts are contacted. No logs contain
tokens: every log line goes through `maskToken()`.

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
