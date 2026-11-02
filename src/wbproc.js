/**
 * WorkBuddy 桌面端主进程探测。
 *
 * 判据很简单：WorkBuddy.exe 的**主进程**在跑，就说明桌面端活着（渲染进程都是它的子进程，
 * 主进程一退，子进程随之消失）。因此「有没有 WorkBuddy.exe」就等价于「主进程在不在」。
 * 检测走系统自带的 tasklist（win32）/ pgrep（darwin、linux），不引第三方依赖。
 *
 * 结果缓存几百毫秒：桌宠一轮对话里可能连问好几次，别每次都去 spawn 一个进程。
 */

import { execFile } from 'node:child_process';

/** win32 / darwin / linux 上的可执行名（桌面端同时存在 WorkBuddy.exe 与 WorkBuddy AI.exe 两种安装形态）。 */
const IMAGE_NAMES = ['WorkBuddy.exe', 'WorkBuddy AI.exe'];

const CACHE_MS = 2500;

/** @type {{ at: number, value: WorkBuddyProcState } | null} */
let cache = null;

/**
 * @typedef {object} WorkBuddyProcState
 * @property {boolean} running 主进程是否在跑。
 * @property {number[]} pids 观察到的进程 id。
 * @property {number | null} mainPid 视作主进程的那个 pid（取最小 pid，Electron 主进程通常最早启动）。
 * @property {string} via 探测手段，便于排查：tasklist / pgrep / unsupported / error。
 * @property {string} detail 出错时的原文，正常为空串。
 * @property {number} at 采样时间戳（ms）。
 */

function run(file, args, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            code: err && typeof err.code === 'number' ? err.code : err ? -1 : 0,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? '') + (err && err.message ? ` ${err.message}` : ''),
          });
        },
      );
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(err?.message ?? err) });
    }
  });
}

/** tasklist 的 CSV 行：`"WorkBuddy.exe","9336","Console","1","120,340 K"` */
function parseTasklistCsv(text, names) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const pids = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('"')) continue;
    const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
    const image = (cells[0] ?? '').toLowerCase();
    if (!wanted.has(image)) continue;
    const pid = Number.parseInt(cells[1] ?? '', 10);
    if (Number.isFinite(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

async function probeWindows() {
  /** @type {number[]} */
  let pids = [];
  let lastDetail = '';
  let sawTool = false;
  for (const name of IMAGE_NAMES) {
    const r = await run('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH']);
    // tasklist 在没有匹配时退出码为 0、正文是一句「信息: 没有运行的任务…」；工具缺失才走 stderr。
    if (/not recognized|无法识别|不是内部或外部命令/i.test(r.stderr) && !r.stdout) continue;
    sawTool = true;
    const found = parseTasklistCsv(r.stdout, [name]);
    pids = pids.concat(found);
    if (!found.length && r.stderr.trim()) lastDetail = r.stderr.trim();
  }
  if (!sawTool) {
    return { running: false, pids: [], mainPid: null, via: 'error', detail: lastDetail || 'tasklist 不可用' };
  }
  pids.sort((a, b) => a - b);
  return { running: pids.length > 0, pids, mainPid: pids[0] ?? null, via: 'tasklist', detail: lastDetail };
}

async function probePosix() {
  const r = await run('pgrep', ['-f', 'WorkBuddy']);
  // pgrep 没匹配到进程时退出码是 1、stderr 为空；退出码非 1 或 stderr 提到「找不到命令」
  // 才是工具缺失——以前把它当成「没有在跑」还会被缓存，导致 macOS/Linux 上永远显示离线。
  const missingTool = /command not found|not found|ENOENT/i.test(r.stderr) || r.code === 127;
  if (missingTool) {
    return { running: false, pids: [], mainPid: null, via: 'error', detail: r.stderr.trim() || 'pgrep 不可用' };
  }
  if (!r.ok && !r.stdout.trim()) {
    return { running: false, pids: [], mainPid: null, via: 'pgrep', detail: r.stderr.trim() };
  }
  const pids = r.stdout
    .split(/\s+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return { running: pids.length > 0, pids, mainPid: pids[0] ?? null, via: 'pgrep', detail: '' };
}

/**
 * 探测一次 WorkBuddy 主进程状态（带短缓存）。
 * @param {boolean} [force] 跳缓存，强制采样。
 * @returns {Promise<WorkBuddyProcState>}
 */
export async function detectWorkBuddy(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_MS) return cache.value;

  let state;
  try {
    if (process.platform === 'win32') state = await probeWindows();
    else if (process.platform === 'darwin' || process.platform === 'linux') state = await probePosix();
    else state = { running: false, pids: [], mainPid: null, via: 'unsupported', detail: process.platform };
  } catch (err) {
    state = { running: false, pids: [], mainPid: null, via: 'error', detail: String(err?.message ?? err) };
  }

  const value = { ...state, at: now };
  // 只缓存「成功采样」的结论；出错时不缓存，免得一次偶发失败把状态钉死。
  if (state.via !== 'error') cache = { at: now, value };
  return value;
}

/** 给面板/提示词用的一行摘要。 */
export function describeProc(state) {
  if (!state) return 'unknown';
  if (state.running) return `running (pid ${state.mainPid ?? '?'})`;
  return 'stopped';
}
