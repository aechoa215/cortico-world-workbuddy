/**
 * 找 Coopanion 的 `resources/app` 目录（脚本共用）。
 *
 * 0.3.0 删掉了 `src/host.js`（不再注入宿主文件），但自检、UI 验证、构建脚本仍然需要
 * 「宿主装在哪」这一个信息，所以把它单独抽成脚本侧的探测，扩展运行时不再依赖它。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {{ packageDir?: string }} [opts]
 * @returns {string} app 目录绝对路径；找不到返回空串
 */
export function findAppRoot(opts = {}) {
  const candidates = [];

  const fromEnv = process.env.COOPANION_APP_ROOT;
  if (fromEnv) candidates.push(fromEnv);

  // data-location.json 里记着 data 目录，app 在它旁边的 resources/app
  const localApp = process.env.LOCALAPPDATA;
  if (localApp) {
    const dataLocation = join(localApp, 'Coopanion', 'data-location.json');
    if (existsSync(dataLocation)) {
      try {
        const data = JSON.parse(readFileSync(dataLocation, 'utf8')).data;
        if (typeof data === 'string' && data) candidates.push(join(dirname(data), 'resources', 'app'));
      } catch {
        /* 读不出来就走下面的默认位置 */
      }
    }
    candidates.push(join(localApp, 'Programs', 'Coopanion', 'resources', 'app'));
  }

  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (base) candidates.push(join(base, 'Coopanion', 'resources', 'app'));
  }

  return candidates.find((dir) => existsSync(join(dir, 'build', 'console', 'index.html'))) ?? '';
}
