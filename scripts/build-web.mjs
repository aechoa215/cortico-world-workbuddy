#!/usr/bin/env node
/**
 * 重建 `dist/webui.js`（面板产物）。
 *
 * 为什么不用 `esbuild` 直接当 script：`prepack` 会在别人机器上跑，
 * 那里可能没有 `npm install` 过（没有 node_modules/esbuild），直接调 `esbuild` 会
 * `'esbuild' is not recognized`，整条 `npm pack` 就失败了。
 *
 * 解析顺序：
 *   1. 本包的 devDependency（`node_modules/esbuild`，版本由 lock 固定，CI 用这个）；
 *   2. 宿主 Coopanion 自带的那份（`--config.strict-dep-builds` 之外的本机兜底）；
 *   3. 都没有：`dist/webui.js` 已存在就警告并退出 0（产物已随包提交），否则报错。
 *
 * `--strict`：找不到 esbuild 时**不允许**沿用旧产物（返回 1）。
 * `prepack` 走 strict —— 否则没装依赖的机器会静默把过期 dist 发布出去（审查报告第 6 条）。
 *
 * 用法：node scripts/build-web.mjs [--verbose] [--strict]
 */

import { existsSync, mkdirSync, readFileSync as readTextSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const verbose = process.argv.includes('--verbose');
const strict = process.argv.includes('--strict');
const entry = join(pkgDir, 'src', 'webui', 'client.js');
const outfile = join(pkgDir, 'dist', 'webui.js');
const args = [entry, '--bundle', '--format=esm', `--outfile=${outfile}`, '--log-level=warning'];

/**
 * 宿主 Coopanion 的 app 目录（只用来兜底取它自带的 esbuild）。
 * 按「存在 build/console/index.html」判定，探测失败返回空串。
 */
function hostAppRoot() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    local && join(local, 'Programs', 'Coopanion', 'resources', 'app'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Coopanion', 'resources', 'app'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Coopanion', 'resources', 'app'),
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(join(dir, 'build', 'console', 'index.html'))) ?? '';
}

/** 找到可用的 esbuild 启动脚本（bin/esbuild 是 JS 包装，用 node 跑）。 */
function resolveEsbuild() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try {
    candidates.push(require.resolve('esbuild/bin/esbuild'));
  } catch {
    /* 本地没装 devDependencies，走宿主兜底 */
  }
  const appRoot = process.env.COOPANION_APP_ROOT || hostAppRoot();
  if (appRoot) candidates.push(join(appRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'));

  for (const bin of candidates) {
    if (!existsSync(bin)) continue;
    // 版本号在同一目录的 package.json 里
    let version = 'unknown';
    try {
      version = JSON.parse(readTextSync(join(dirname(bin), '..', 'package.json'), 'utf8')).version;
    } catch {
      /* 版本读不到不影响构建 */
    }
    return { bin, version };
  }
  return null;
}

const found = resolveEsbuild();
if (!found) {
  console.error('✗ 找不到 esbuild（本地 devDependencies 与宿主都没装）。');
  console.error('  先跑一次 `npm ci`（有 lockfile，锁的是 devDependency 的 esbuild）再重试。');
  if (!existsSync(outfile)) process.exit(1);
  if (strict) {
    console.error('✗ --strict：拒绝沿用已有的 dist/webui.js（可能是过期产物）。');
    process.exit(1);
  }
  console.warn('! 非 strict 模式：沿用已有的 dist/webui.js（本地开发可以，发布不行）。');
  process.exit(0);
}

if (verbose) console.log(`· esbuild ${found.version}：${found.bin}`);
mkdirSync(join(pkgDir, 'dist'), { recursive: true });
const result = spawnSync(process.execPath, [found.bin, ...args], { cwd: pkgDir, encoding: 'utf8' });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`✗ esbuild 失败（退出码 ${result.status}）`);
  process.exit(1);
}

const size = statSync(outfile).size;
console.log(`✓ dist/webui.js 已重建（esbuild ${found.version}，${size} 字节）`);
