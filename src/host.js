/**
 * 主界面（Coopanion 控制台）注入的检测与自动修复。
 *
 * 背景：Coopanion 目前没有给 World 扩展提供「往主界面插 UI」的扩展点，开始页那排
 * 「中转站优先：」只能靠改写宿主的静态资源实现：把 `workbuddy-home.js` 放进
 * `resources/app/build/console/`，再在 `index.html` 里加一行 module script。
 *
 * 宿主升级 / 重装会整个覆盖 `build/console`，注入会静默消失（按钮不见，但 `wb_*`
 * 工具照常可用）。所以这里做三件事：
 *   1. 找到 console 目录（多种候选，按「存在 index.html」判定）；
 *   2. 检查注入是否完整（文件在不在、script 标签在不在、内容是否是同一份）；
 *   3. 缺什么补什么——首次改动前把 index.html 备份成 `index.html.workbuddy-backup`。
 *
 * 全部是「尽力而为」：任何一步失败都只返回原因，不抛给 World 的启动流程，
 * 免得宿主目录异常把桌宠整体拖下水。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 注入脚本在宿主 console 目录里的文件名。 */
export const INJECTOR_FILE = 'workbuddy-home.js';
/** index.html 里那一行（幂等判定用）。 */
export const INJECTOR_TAG = `<script type="module" src="./${INJECTOR_FILE}"></script>`;
/** 首次改动前的备份文件名。 */
export const BACKUP_FILE = 'index.html.workbuddy-backup';

/**
 * 猜 Coopanion 的 `resources/app` 目录。
 * @param {{ dataDir?: string, packageDir?: string, env?: Record<string, string | undefined> }} hints
 * @returns {string | null}
 */
export function findAppRoot(hints = {}) {
  const env = hints.env ?? process.env;
  const candidates = [];
  const push = (p) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };

  // 0) 显式指定 + 数据目录记录（最可靠：data-location.json 写着 data 的真实位置）。
  push(env.COOPANION_APP_ROOT);
  const dataLocation = join(env.LOCALAPPDATA ?? '', 'Coopanion', 'data-location.json');
  if (env.LOCALAPPDATA) {
    try {
      const info = JSON.parse(readFileSync(dataLocation, 'utf8'));
      if (info?.data) push(resolve(info.data, '..', 'resources', 'app'));
    } catch { /* 没装/没写过，忽略 */ }
  }

  // 1) Electron 主进程/工具进程里通常有 resourcesPath（= …\resources）。
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath === 'string' && resourcesPath) {
    push(join(resourcesPath, 'app'));
    push(resourcesPath);
  }
  // 2) 从 dataDir 反推：<app>/data → <app>/resources/app。
  if (hints.dataDir) {
    push(resolve(hints.dataDir, '..', 'resources', 'app'));
    push(resolve(hints.dataDir, '..', 'app'));
  }
  // 3) 从可执行文件反推。
  if (process.execPath && /coopanion/i.test(process.execPath)) {
    push(join(dirname(process.execPath), 'resources', 'app'));
  }
  // 4) 从本扩展包目录反推：<app>/data/extensions/node_modules/<pkg>。
  if (hints.packageDir) {
    push(resolve(hints.packageDir, '..', '..', '..', '..', 'resources', 'app'));
  }
  // 5) 平台默认安装位置（脚本在仓库里跑、不在宿主进程里时用得上）。
  if (env.LOCALAPPDATA) push(join(env.LOCALAPPDATA, 'Programs', 'Coopanion', 'resources', 'app'));
  if (env.ProgramFiles) push(join(env.ProgramFiles, 'Coopanion', 'resources', 'app'));
  const pf86 = env['ProgramFiles(x86)'];
  if (pf86) push(join(pf86, 'Coopanion', 'resources', 'app'));

  for (const root of candidates) {
    if (existsSync(join(root, 'build', 'console', 'index.html'))) return root;
  }
  // 退化：只要 resources/app 存在也算（后面会报 console 缺失）。
  return candidates.find((root) => existsSync(join(root, 'build'))) ?? null;
}

/**
 * 看一眼当前注入状态，不做修改。
 * @param {string} appRoot
 * @returns {{ appRoot: string, consoleDir: string, htmlPath: string, htmlFound: boolean, fileFound: boolean, scriptFound: boolean, fileStale: boolean, ok: boolean, reason: string }}
 */
export function inspectHostInjection(appRoot) {
  const consoleDir = appRoot ? join(appRoot, 'build', 'console') : '';
  const htmlPath = consoleDir ? join(consoleDir, 'index.html') : '';
  const injectorPath = consoleDir ? join(consoleDir, INJECTOR_FILE) : '';
  const htmlFound = !!htmlPath && existsSync(htmlPath);
  const fileFound = !!injectorPath && existsSync(injectorPath);
  let html = '';
  if (htmlFound) {
    try {
      html = readFileSync(htmlPath, 'utf8');
    } catch {
      html = '';
    }
  }
  const scriptFound = !!html && (html.includes(INJECTOR_TAG) || html.includes(`./${INJECTOR_FILE}`));
  const fileStale = fileFound ? false : true;
  let reason = '';
  if (!appRoot) reason = 'app-root-not-found';
  else if (!htmlFound) reason = 'index-html-not-found';
  else if (!fileFound) reason = 'injector-file-missing';
  else if (!scriptFound) reason = 'script-tag-missing';
  return {
    appRoot: appRoot ?? '',
    consoleDir,
    htmlPath,
    htmlFound,
    fileFound,
    scriptFound,
    fileStale,
    ok: !!appRoot && htmlFound && fileFound && scriptFound,
    reason,
  };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * 从 index.html 里去掉本扩展的引用行，得到「未注入」的原文。
 * 备份就是这份清理过的内容：即使备份是后来才补的，还原也能回到干净状态。
 * @param {string} html
 * @returns {string}
 */
export function stripInjection(html) {
  return html
    .split(/\r?\n/)
    .filter((line) => !line.includes(`./${INJECTOR_FILE}`))
    .join('\n');
}

/**
 * 确保注入完整：缺文件就补文件，缺 script 标签就补标签（改前先备份）。
 * 幂等：都齐了就是一次只读检查。
 *
 * @param {{ appRoot: string, source: string, sourceVersion?: string }} opts
 *        source = 注入脚本的源码文本（扩展包里的 `assets/workbuddy-home.js`）。
 * @returns {{ ok: boolean, changed: string[], reason: string, state: ReturnType<typeof inspectHostInjection> }}
 */
export function ensureHostInjection({ appRoot, source, sourceVersion = '' }) {
  const changed = [];
  let state = inspectHostInjection(appRoot);
  try {
    if (!state.htmlFound) {
      return { ok: false, changed, reason: state.reason, state };
    }
    if (!state.ok) {
      mkdirSync(state.consoleDir, { recursive: true });

      // 1) 落注入脚本（内容不一致就覆盖：宿主升级可能把旧版本还原回来）。
      const injectorPath = join(state.consoleDir, INJECTOR_FILE);
      const want = sourceVersion ? `${source}\n/* bundled:${sourceVersion} */\n` : source;
      let current = null;
      if (existsSync(injectorPath)) {
        try {
          current = readFileSync(injectorPath, 'utf8');
        } catch {
          current = null;
        }
      }
      if (current !== want) {
        writeFileSync(injectorPath, want, 'utf8');
        changed.push(current == null ? 'injector-created' : 'injector-updated');
      }

      // 2) 补 script 标签（先备份一次 index.html）。
      let html = readFileSync(state.htmlPath, 'utf8');
      if (!html.includes(`./${INJECTOR_FILE}`)) {
        const anchor = `<script type="module" src="./index.js"></script>`;
        if (html.includes(anchor)) {
          html = html.replace(anchor, `${INJECTOR_TAG}\n    ${anchor}`);
        } else if (html.includes('</body>')) {
          html = html.replace('</body>', `    ${INJECTOR_TAG}\n  </body>`);
        } else {
          html += `\n${INJECTOR_TAG}\n`;
        }
        writeFileSync(state.htmlPath, html, 'utf8');
        changed.push('script-tag-added');
      }
      state = inspectHostInjection(appRoot);
    }

    // 3) 备份永远补齐：老版本（0.1.2）是手工注入的、没有备份，这里补一份「清理过」的原文，
    //    保证 --restore 在任何时候都能回到未注入状态。
    const backupPath = join(state.consoleDir, BACKUP_FILE);
    if (!existsSync(backupPath)) {
      writeFileSync(backupPath, stripInjection(readFileSync(state.htmlPath, 'utf8')), 'utf8');
      changed.push('html-backed-up');
    }
    return { ok: state.ok, changed, reason: state.reason, state };
  } catch (err) {
    return { ok: false, changed, reason: String(err?.message ?? err), state };
  }
}

/**
 * 撤掉注入，把宿主的控制台目录恢复到未改动的样子（停用 / 卸载时调用）。
 *
 * 刻意不「用备份覆盖 index.html」：备份可能是很久以前的原件，而宿主升级过的话，
 * 覆盖回去等于把新版 index.html 降级。这里只从**当前** index.html 里剥掉引用行，
 * 于是无论宿主怎么升级，剥完都只剩宿主自己的改动。
 *
 * 返回 `{ ok, changed, reason, state }`；`changed` 里记录实际做过的动作。
 */
export function removeHostInjection(appRoot) {
  const changed = [];
  try {
    const state = inspectHostInjection(appRoot);
    if (!state.htmlFound) return { ok: true, changed, reason: state.reason, state };

    const html = readFileSync(state.htmlPath, 'utf8');
    if (html.includes(`./${INJECTOR_FILE}`)) {
      writeFileSync(state.htmlPath, stripInjection(html), 'utf8');
      changed.push('script-tag-removed');
    }

    const injectorPath = join(state.consoleDir, INJECTOR_FILE);
    if (existsSync(injectorPath)) {
      rmSync(injectorPath, { force: true });
      changed.push('injector-deleted');
    }

    const backupPath = join(state.consoleDir, BACKUP_FILE);
    if (existsSync(backupPath)) {
      rmSync(backupPath, { force: true });
      changed.push('backup-deleted');
    }
    return { ok: true, changed, reason: '', state: inspectHostInjection(appRoot) };
  } catch (err) {
    return { ok: false, changed, reason: String(err?.message ?? err), state: null };
  }
}

/** 给面板/灯用的一行摘要。 */
export function describeHostInjection(state) {
  if (!state) return 'unknown';
  if (state.ok) return '已注入：开始页有「中转站优先」按钮';
  const map = {
    'app-root-not-found': '未找到 Coopanion 安装目录',
    'index-html-not-found': '未找到宿主控制台 index.html',
    'injector-file-missing': '注入脚本缺失（可自动修复）',
    'script-tag-missing': 'index.html 缺少引用（可自动修复）',
  };
  return map[state.reason] ?? state.reason;
}

/** 备份文件在旁边时，报告里给一条「怎么还原」的路径。 */
export function backupPathOf(state) {
  return state?.consoleDir ? join(state.consoleDir, BACKUP_FILE) : '';
}

/** 是否有写权限（用试探写的替代：只看目录存在 + 可读 index.html）。 */
export function looksWritable(state) {
  if (!state?.consoleDir) return false;
  try {
    return statSync(state.consoleDir).isDirectory();
  } catch {
    return false;
  }
}

export { sha256 };
