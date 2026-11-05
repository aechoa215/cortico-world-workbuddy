/**
 * 自查（0.3.12，聊天里的 `/wb`）：把桥接状态整理成一张给人看的表，并读 core.log 里与
 * `worlds.workbuddy` 相关的最近若干行。
 *
 * 只做两件事：读本机状态、读本机日志。不联网、不加依赖、不写文件；任何失败都变成一句
 * 「读不到」，不向上抛——自查本身不应该把对话弄崩。
 *
 * 与 `scripts/selfcheck.mjs`（构建期自检）无关，重名只是巧合。
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 读 core.log 时最多回看多少字节；日志再大也只读尾部，避免一次把几十 MB 拉进内存。 */
export const LOG_TAIL_BYTES = 512 * 1024;

/** 日志里属于本 World 的行前缀（框架的 logger 写法）。 */
export const LOG_WORLD_MARK = 'worlds.workbuddy';

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地时区的 `MM-DD HH:mm`；无效或缺失返回 `—`。 */
export function formatClock(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '—';
  const d = new Date(t);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const TOKEN_SOURCE_LABELS = {
  plain: '明文凭据文件',
  decrypted: '加密凭据（本机解密）',
  manual: '面板手动粘贴',
};

/**
 * 生成 `/wb` 的状态表。输入是已经取好的快照，函数本身不读世界状态。
 *
 * @param {object} v
 * @param {boolean} v.running       WorkBuddy 主进程是否在跑
 * @param {number|null} [v.mainPid] 视作主进程的 pid
 * @param {boolean} v.authed        是否有可用登录态
 * @param {string|null} [v.tokenSource] 凭据来源（只用来显示来源名，绝不显示 token）
 * @param {string} [v.catalogLabel] `catalogSourceView().label`
 * @param {number} [v.modelCount]   目录里的模型数
 * @param {number} [v.safeCount]    安全清单放行的模型数
 * @param {string} [v.localPath]    本次采用的本机缓存文件路径
 * @param {number} [v.catalogAt]    目录时间戳
 * @param {string} [v.model]        当前模型 id
 * @param {string|null} [v.multiplier] 当前模型倍率的显示文本
 * @param {number} [v.todayCredit]  今日消耗积分（本地记账）
 * @param {number} [v.todayCalls]   今日调用次数
 * @param {number} [v.todayTokens]  今日 token 数
 * @returns {string}
 */
export function renderStatus(v = {}) {
  const running = v.running === true;
  const pid = Number.isFinite(Number(v.mainPid)) && Number(v.mainPid) > 0 ? Number(v.mainPid) : null;
  const modelCount = Number(v.modelCount) || 0;
  const safeCount = Number(v.safeCount) || 0;
  const sourceName = v.tokenSource ? TOKEN_SOURCE_LABELS[v.tokenSource] ?? String(v.tokenSource) : '';
  const authed = v.authed === true
    ? `已发现${sourceName ? `（${sourceName}，内容已脱敏）` : '（内容已脱敏）'}`
    : '未发现（需要登录 WorkBuddy 客户端，或在「账号」面板粘贴 token）';
  const label = typeof v.catalogLabel === 'string' && v.catalogLabel ? v.catalogLabel : '—';
  const local = typeof v.localPath === 'string' && v.localPath ? v.localPath : '—（当前用的是磁盘目录或服务器目录）';
  const model = typeof v.model === 'string' && v.model ? v.model : '';
  const multiplier = typeof v.multiplier === 'string' && v.multiplier ? v.multiplier : '倍率未知';
  const credit = Number.isFinite(Number(v.todayCredit)) ? Math.round(Number(v.todayCredit) * 100) / 100 : 0;
  const calls = Number(v.todayCalls) || 0;
  const tokens = Number(v.todayTokens) || 0;

  return [
    'WorkBuddy 桥接自查',
    `主进程：${running ? `运行中（mainPid ${pid ?? '未知'}）` : '未检测到'}`,
    `登录态：${authed}`,
    `目录来源：${label}${modelCount > 0 ? `（${modelCount} 个模型）` : ''}`,
    `安全清单：${safeCount} 个可调用 / ${modelCount} 个`,
    `本地缓存：${local}`,
    `上次刷新：${formatClock(v.catalogAt)}`,
    `当前模型：${model ? `${model} · ${multiplier}` : `未选择 · ${multiplier}`}`,
    `今日积分：${credit}（${calls} 次调用 · ${tokens} tokens）`,
  ].join('\n');
}

/** 读文件尾部 `maxBytes` 字节并按 UTF-8 解码。 */
export function readTailText(path, maxBytes = LOG_TAIL_BYTES) {
  const st = statSync(path);
  const start = Math.max(0, st.size - Math.max(1, maxBytes));
  const len = st.size - start;
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, len, start);
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8');
}

/**
 * core.log 的候选路径：Coopanion 装在 `%LOCALAPPDATA%\Programs\Coopanion` 时，
 * 日志在它的 `data\logs\core.log`。从当前进程的 exe 目录再推一条，覆盖装在别处的情况。
 */
export function coreLogCandidates(env = process.env, execPath = process.execPath) {
  const out = [];
  const localAppData = typeof env.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : '';
  if (localAppData) out.push(join(localAppData, 'Programs', 'Coopanion', 'data', 'logs', 'core.log'));
  if (execPath) out.push(join(dirname(execPath), 'data', 'logs', 'core.log'));
  return [...new Set(out)];
}

/**
 * 取 core.log 里最近的 n 行 `worlds.workbuddy` 日志。没文件、没权限、没匹配都不抛。
 *
 * @param {{lines?: number, candidates?: string[]}} [opts]
 * @returns {{ok: true, path: string, lines: string[], empty?: boolean}
 *   | {ok: false, path?: string, error: string}}
 */
export function readRecentWorldLogs(opts = {}) {
  const wanted = Math.max(1, Math.min(200, Number(opts.lines) || 20));
  const candidates = Array.isArray(opts.candidates) && opts.candidates.length > 0
    ? opts.candidates
    : coreLogCandidates();

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const rows = readTailText(path)
        .split(/\r?\n/)
        .filter((line) => line.includes(LOG_WORLD_MARK));
      if (rows.length === 0) return { ok: true, path, lines: [], empty: true };
      return { ok: true, path, lines: rows.slice(-wanted) };
    } catch (err) {
      return { ok: false, path, error: String(err?.message ?? err) };
    }
  }
  return { ok: false, error: `找不到 core.log（找过：${candidates.join('；') || '没有候选路径'}）` };
}
