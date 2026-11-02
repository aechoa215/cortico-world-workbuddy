# Security policy

This extension talks to *your own* WorkBuddy account on *your own* machine. It has no server,
no telemetry and no third-party analytics. This file states exactly what it touches, so you can
judge the risk before installing.

## What it reads

| Path | Why | Data |
|---|---|---|
| `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info` | To learn your WorkBuddy login | `auth.accessToken`, `auth.refreshToken`, `auth.expiresAt`, `auth.domain`, `account` |
| `%APPDATA%\WorkBuddy*\*.json` (if present) | Older WorkBuddy builds store the login here | same fields when stored in plain text |
| `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth` (fallback) | Same as above, directory scan | same fields |
| `C:\Program Files\WorkBuddy\WorkBuddy.exe` | Only to ask the app for its own at-rest key | the key payload printed by the app's own `loggerGet()` binding; never stored |
| `<Coopanion data>\home\companion\config.json` | Read/write `worlds.workbuddy` | region, model id, `prefer` flag |

The token is decrypted in memory only when the file is encrypted, is used only as the
`Authorization: Bearer` header for WorkBuddy's own endpoints, and is never written anywhere except
the Coopanion deployment `.env` if you paste one in the account panel yourself (the framework's
`storeSecret`).

## Where data goes

Only three hosts, all WorkBuddy's:

- `https://copilot.tencent.com` — model catalogue and chat completions (region `cn`)
- `https://www.codebuddy.cn` — credit balance (region `cn`)
- `https://www.workbuddy.ai` — catalogue, chat, credits (region `global`)

Nothing else. No logs contain tokens: every log line goes through `maskToken()`.

## What it writes

- `<Coopanion data>/worlds/workbuddy/workbuddy-catalog.json` — cached model list, no credentials.
- `worlds.workbuddy.*` in the companion config (region, model, `prefer`, `envPrompt`).
- **Host files, only when the start-page button is injected:** `resources/app/build/console/index.html`
  (0.3.0 removed the home-page injection; the extension no longer touches host files).
  The original `index.html` is kept as `index.html.workbuddy-backup` next to it.
  Nothing to undo — the extension does not modify Coopanion files anymore. Earlier versions
  one-line reference by hand. A Coopanion update that replaces `build/console` simply removes the
  injection; the extension puts it back on the next start.

## Reporting a vulnerability

Open a private security advisory on the repository, or a normal issue if the report does not
include secrets. Please do not paste access tokens, refresh tokens or `workbuddy-desktop.info`
contents into an issue — redact everything after the first eight characters.
