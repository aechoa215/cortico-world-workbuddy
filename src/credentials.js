/**
 * 本机 WorkBuddy 桌面端登录凭据的发现与读取（Windows 为主，macOS / Linux 同样扫描）。
 *
 * 参照 dsh-connect-workbuddy 的 src/at-rest.ts（MIT）：
 *  - 桌面端 5.6.0 起 auth.accessToken / auth.refreshToken 不再是明文，而是
 *    { "$wbEncrypted": 1, "envelope": "<base64(JSON)>" } 字段信封：
 *    envelope = { suite, keyId, nonce, authTag, ciphertext }，AES-256-GCM，
 *    12 字节 nonce、16 字节 tag，AAD 是对 scheme/suite/keyId/framing 的
 *    长度前缀转录。字段密钥由 App 构建期常量（经其原生模块吐出 base64 串）
 *    的 SHA-256 派生，keyId 取该哈希前 16 个 hex。
 *  - 本模块实现同一套解封原语；密钥负载（含 atRestSecretKey 的 JSON）的获取
 *    与宿主环境强相关，由调用方经环境变量 WORKBUDDY_AT_REST_KEY 注入，
 *    注入失败时回退到「面板手动粘贴 token」，绝不算错密钥硬试。
 *
 * 安全红线：token 只经 ctx.storeSecret() 落密钥库，不写配置、不进日志、
 * 不上屏（面板只显示掩码与长度）。
 */

import { execFile } from 'node:child_process';
import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const AAD_DOMAIN = Buffer.from('WB-AAD\0', 'ascii');
const SYMMETRIC_SCHEME = 'sym-v1';
const FRAMING_FIELD = 2;
const FORMAT_FIELD = 'WBEV1';

/**
 * WorkBuddy 数据目录候选（按平台）。
 * @returns {string[]}
 */
export function candidateCredentialDirs() {
  const home = homedir();
  const dirs = [];
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  // 桌面端 5.7.x 起真正的登录态在 CodeBuddyExtension 的 Public/auth 下，
  // 文件名是 workbuddy-desktop.info / workbuddy-desktop-ai.info（不是 *.json，
  // 也不在 %APPDATA%\WorkBuddy）。实机来源：dsh-connect-workbuddy 的
  // WORKBUDDY_LIVE_FILENAMES 与 defaultDesktopAuthCandidates()。
  // 放最前面：这份是「活文件」，优先于别处的旧副本。
  if (platform() === 'win32' && localAppData) {
    dirs.push(join(localAppData, 'CodeBuddyExtension', 'Data', 'Public', 'auth'));
    dirs.push(join(localAppData, 'CodeBuddyExtension', 'Data', 'Public'));
  }
  if (platform() === 'darwin') {
    for (const name of ['CodeBuddyExtension', 'WorkBuddy']) {
      dirs.push(join(home, 'Library', 'Application Support', name, 'Data', 'Public', 'auth'));
    }
  }
  if (platform() === 'win32' && appData) {
    for (const name of ['WorkBuddy', 'workbuddy', 'WorkBuddyAI', 'WorkBuddy AI', 'workbuddy-ai']) {
      dirs.push(join(appData, name));
    }
  }
  if (platform() === 'darwin') {
    for (const name of ['WorkBuddy', 'WorkBuddy AI', 'workbuddy-ai']) {
      dirs.push(join(home, 'Library', 'Application Support', name));
    }
  }
  for (const name of ['WorkBuddy', 'workbuddy', 'WorkBuddyAI', 'workbuddy-ai']) {
    dirs.push(join(home, '.config', name));
  }
  return dirs;
}

/**
 * 目录里可能装着登录态的文件名（含 Storage / leveldb 导出等常见命名）。
 * `.info` 是 WorkBuddy 桌面端自己的后缀（workbuddy-desktop.info 一族）。
 */
const STORE_FILE_RE =
  /(?:auth|session|state|storage|token|user).*\.(?:json|info)$|^(?:config|store)\.json$|^workbuddy-desktop.*\.info$/i;

/** 顶层的兜底扫描只认这两种后缀，其余文件不看（避免把二进制当 JSON 读）。 */
const SCANNABLE_EXT = /\.(?:json|info)$/i;

/**
 * 在候选目录里发现登录凭据。
 * @param {string} [overrideDir] 配置的凭据目录，优先且只用它。
 * @returns {{ dir: string, file: string, credential: object, encrypted: boolean } | null}
 */
export function discoverCredentials(overrideDir) {
  const dirs = overrideDir ? [overrideDir] : candidateCredentialDirs();
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    // 先扫一层目录下命名像凭据的文件，再扫全部顶层 JSON/.info 兜底。
    const ordered = [
      ...files.filter((f) => STORE_FILE_RE.test(f)),
      ...files.filter((f) => SCANNABLE_EXT.test(f) && !STORE_FILE_RE.test(f)),
    ];
    for (const file of ordered) {
      const path = join(dir, file);
      try {
        if (!statSync(path).isFile()) continue;
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        const found = extractCredential(parsed);
        if (found) {
          return { dir, file: path, credential: found.credential, encrypted: found.encrypted };
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * 从一份 JSON 里提取 auth 段。识别明文与加密信封两种形态。
 * @returns {{ credential: { accessToken?: string, refreshToken?: string, encryptedFields?: object, account?: object }, encrypted: boolean } | null}
 */
function extractCredential(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const auth = findAuthSection(parsed, 0);
  if (!auth) return null;
  const access = auth.accessToken ?? auth.access_token;
  const refresh = auth.refreshToken ?? auth.refresh_token;
  const encrypted = isEncryptedWrapper(access) || isEncryptedWrapper(refresh);
  const credential = {
    accessToken: typeof access === 'string' ? access : undefined,
    refreshToken: typeof refresh === 'string' ? refresh : undefined,
    encryptedFields: encrypted
      ? {
          accessToken: isEncryptedWrapper(access) ? access : undefined,
          refreshToken: isEncryptedWrapper(refresh) ? refresh : undefined,
        }
      : undefined,
    account: pickAccount(parsed),
  };
  if (!credential.accessToken && !credential.encryptedFields?.accessToken) return null;
  return { credential, encrypted };
}

function findAuthSection(node, depth) {
  if (depth > 3 || !node || typeof node !== 'object') return null;
  if (typeof node.accessToken === 'string' || isEncryptedWrapper(node.accessToken)
      || typeof node.access_token === 'string' || isEncryptedWrapper(node.access_token)) {
    return node;
  }
  for (const key of ['auth', 'session', 'login', 'user', 'account', 'state']) {
    const child = node[key];
    if (child && typeof child === 'object') {
      const found = findAuthSection(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function pickAccount(parsed) {
  const u = parsed.user ?? parsed.account ?? parsed.profile;
  if (!u || typeof u !== 'object') return undefined;
  return {
    name: strOr(u.name ?? u.nickname ?? u.username ?? u.email),
    uid: strOr(u.uid ?? u.id ?? u.userId),
  };
}

function strOr(v) {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** 是否是 { $wbEncrypted: 1, envelope } 字段信封。 */
export function isEncryptedWrapper(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2
    && keys[0] === '$wbEncrypted'
    && keys[1] === 'envelope'
    && value.$wbEncrypted === 1
    && typeof value.envelope === 'string';
}

// ---------------------------------------------------------------------------
// 加密字段解封（AES-256-GCM + 长度前缀 AAD 转录，与桌面端同形）
// ---------------------------------------------------------------------------

function encodeUint32(value) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function encodeLengthPrefixed(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeUint32(bytes.length), bytes]);
}

/** FIELD framing 的 AAD 转录；与桌面端密封时的 transcript 逐字节一致。 */
function fieldAad(keyId, suite) {
  return Buffer.concat([
    AAD_DOMAIN,
    Buffer.from([1]),
    encodeLengthPrefixed(FORMAT_FIELD),
    encodeLengthPrefixed(SYMMETRIC_SCHEME),
    encodeUint32(suite),
    encodeLengthPrefixed(keyId),
    Buffer.from([FRAMING_FIELD]),
    Buffer.from([0]), // 无 sequence
    Buffer.from([0]), // final === undefined
  ]);
}

export function deriveAtRestKeyId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * 由密钥负载 JSON 派生 32 字节字段密钥。
 * 注意：桌面端哈希的是 base64 字符串本身而非解码后的字节，必须同形。
 */
export function deriveAtRestKey(payloadJson) {
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error('at-rest 密钥负载不是合法 JSON');
  }
  const secret = payload?.atRestSecretKey;
  if (typeof secret !== 'string' || secret === '') {
    throw new Error('at-rest 密钥负载里没有 atRestSecretKey');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** 打开一个加密字段，返回明文。keyId 不符或 GCM 校验失败都抛错，绝不降级成截断的 token。 */
export function openEncryptedField(field, key) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(field.envelope, 'base64').toString('utf8'));
  } catch {
    throw new Error('加密字段的 envelope 不是合法 JSON');
  }
  const { suite, keyId, nonce, authTag, ciphertext } = envelope ?? {};
  if (typeof suite !== 'number' || typeof keyId !== 'string'
      || typeof nonce !== 'string' || typeof authTag !== 'string' || typeof ciphertext !== 'string') {
    throw new Error('加密字段 envelope 缺少必要字段');
  }
  const expected = deriveAtRestKeyId(key);
  if (keyId !== expected) {
    throw new Error(`加密字段属于另一把密钥（${keyId} ≠ ${expected}）`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'), { authTagLength: 16 });
  decipher.setAAD(fieldAad(keyId, suite));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * 用可用的密钥把凭据里的加密字段解成明文 token。
 * 密钥负载来源（按优先级）：显式传入的 payload JSON、WORKBUDDY_AT_REST_KEY 环境变量。
 * @param {object} credential extractCredential 的产物
 * @param {string} [payloadJson] 含 atRestSecretKey 的 JSON 串
 * @returns {{ accessToken?: string, refreshToken?: string, source: 'plain' | 'decrypted' | 'none', account?: object }}
 */
export function resolveTokens(credential, payloadJson = process.env.WORKBUDDY_AT_REST_KEY) {
  const out = { source: 'none', account: credential.account };
  if (credential.accessToken) {
    out.accessToken = credential.accessToken;
    out.refreshToken = credential.refreshToken;
    out.source = 'plain';
    return out;
  }
  const enc = credential.encryptedFields;
  if (!enc?.accessToken) return out;
  if (!payloadJson) return out;
  try {
    const key = deriveAtRestKey(payloadJson);
    out.accessToken = openEncryptedField(enc.accessToken, key);
    if (enc.refreshToken) out.refreshToken = openEncryptedField(enc.refreshToken, key);
    out.source = 'decrypted';
  } catch {
    return { source: 'none', account: credential.account };
  }
  return out;
}

// ---------------------------------------------------------------------------
// at-rest 密钥的自动取得：问桌面端自己的二进制
// ---------------------------------------------------------------------------

/**
 * 桌面端可执行文件的已知位置（按平台）。
 * @returns {string[]}
 */
export function candidateAppExecutables() {
  const exe = [];
  if (platform() === 'win32') {
    // 桌面端有 WorkBuddy / WorkBuddy AI 两种安装形态，目录名与 exe 名都可能带 AI：
    // 只找 WorkBuddy.exe 时，另一种形态拿不到 at-rest 密钥（审查报告第 9 条）。
    const dirs = ['WorkBuddy', 'WorkBuddy AI'];
    const bins = ['WorkBuddy.exe', 'WorkBuddy AI.exe'];
    for (const env of ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMW6432', 'PROGRAMFILES(X86)']) {
      const root = process.env[env];
      if (!root) continue;
      for (const dir of dirs) {
        for (const bin of bins) {
          exe.push(join(root, 'Programs', dir, bin));
          exe.push(join(root, dir, bin));
        }
      }
    }
  }
  if (platform() === 'darwin') {
    exe.push('/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy');
    exe.push(join(homedir(), 'Applications', 'WorkBuddy.app', 'Contents', 'MacOS', 'WorkBuddy'));
  }
  if (platform() === 'linux') {
    exe.push('/opt/WorkBuddy/workbuddy', '/usr/bin/workbuddy');
  }
  return exe;
}

/**
 * 让桌面端把它的 at-rest 密钥负载交出来。
 *
 * 桌面端 5.6.0 起把 accessToken 加密落盘，密钥只在它自己的原生绑定里；
 * 唯一不需要逆向常量、也不需要用户手动粘贴的办法，就是用它自己的二进制
 * 以纯 Node 模式（ELECTRON_RUN_AS_NODE）跑一句取值脚本：
 *   process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()
 * 这正是 dsh-connect-workbuddy 的做法（fetchAtRestKeyPayload）。
 * 拿不到（没装桌面端、版本不匹配、超时）就返回 null，由调用方降级。
 * @returns {Promise<string | null>}
 */
export function fetchAtRestKeyPayload() {
  const executable = candidateAppExecutables().find((p) => existsSync(p));
  if (!executable) return Promise.resolve(null);
  const script =
    "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}"
    + 'catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}';
  return new Promise((resolve) => {
    execFile(
      executable,
      ['-e', script],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: 20_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        const payload = typeof stdout === 'string' ? stdout.trim() : '';
        resolve(error === null && payload !== '' ? payload : null);
      },
    );
  });
}

let cachedKeyPayload;
let cachedKeyAt = 0;
/** 密钥缓存的存活时间：桌面端轮换密钥时最多晚一分钟跟上。 */
const KEY_CACHE_MS = 60_000;

/**
 * 解凭据：明文直接用；加密字段先试环境变量里的密钥，再问桌面端要一次（进程内缓存）。
 * @param {object} credential extractCredential 的产物
 * @returns {Promise<{ accessToken?: string, refreshToken?: string, source: string, account?: object }>}
 */
export async function resolveTokensWithKey(credential) {
  const plain = resolveTokens(credential);
  if (plain.accessToken || !credential.encryptedFields?.accessToken) return plain;
  // 只把「真的拿到了密钥」当成缓存：
  // 以前拿到 null 也写进缓存，于是用户装好/登录桌面端之后，扩展还得重启才认得凭据。
  // 现在失败结果按 60 秒过期，成功结果也按 60 秒刷新（桌面端轮换密钥时能跟上）。
  const fresh = cachedKeyPayload && Date.now() - cachedKeyAt < KEY_CACHE_MS;
  if (!fresh) {
    cachedKeyPayload = await fetchAtRestKeyPayload();
    cachedKeyAt = Date.now();
  }
  if (!cachedKeyPayload) return plain;
  return resolveTokens(credential, cachedKeyPayload);
}

/** token 的掩码展示：只留头尾各 4 个字符与总长度。 */
export function maskToken(token) {
  if (typeof token !== 'string' || token.length === 0) return '(空)';
  if (token.length <= 12) return `(${token.length} 字符)`;
  return `${token.slice(0, 4)}…${token.slice(-4)} (${token.length} 字符)`;
}
