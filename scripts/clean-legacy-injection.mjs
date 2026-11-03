#!/usr/bin/env node
/**
 * 一次性迁移工具：清理 0.2.x 主页注入留在宿主 `build/console` 里的三样东西。
 *
 * 0.3.0 起扩展本体**不再改写宿主任何文件**，所以这个脚本不由扩展自动执行：
 * 装过 0.2.x 的用户主动跑一次即可。它只删本扩展自己留下的东西：
 *   - `index.html` 里引用 `workbuddy-home.js` 的那一行 `<script>`
 *   - `workbuddy-home.js`
 *   - `index.html.workbuddy-backup`
 * 绝不用备份覆盖 `index.html`（避免把宿主升级过的文件降级），也不碰其余内容。
 *
 * 用法：
 *   node scripts/clean-legacy-injection.mjs --check   # 只列出会动的项，不改文件
 *   node scripts/clean-legacy-injection.mjs --clean   # 执行清理（幂等）
 *   COOPANION_APP_ROOT=<...>/resources/app            # 显式指定宿主位置
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAppRoot } from './lib/app-root.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const checkOnly = process.argv.includes('--check');
const doClean = process.argv.includes('--clean');
if (checkOnly === doClean) {
  console.error('用法：node scripts/clean-legacy-injection.mjs --check | --clean（二选一）');
  process.exit(2);
}

const appRoot = process.env.COOPANION_APP_ROOT || findAppRoot({ packageDir: pkgDir });
if (!appRoot) {
  console.error('✗ 找不到 Coopanion 的 resources/app（可设 COOPANION_APP_ROOT 指定）');
  process.exit(2);
}
const consoleDir = join(appRoot, 'build', 'console');
const htmlPath = join(consoleDir, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`✗ 找不到 ${htmlPath}`);
  process.exit(2);
}

/** 只认「引用了 workbuddy-home.js 的 script 行」，其他一行都不动。 */
const INJECT_LINE = /<script[^>]*workbuddy-home\.js/i;

const text = readFileSync(htmlPath, 'utf8');
const newline = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
const kept = lines.filter((line) => !INJECT_LINE.test(line));
const removedLines = lines.length - kept.length;

const files = [
  join(consoleDir, 'workbuddy-home.js'),
  join(consoleDir, 'index.html.workbuddy-backup'),
].filter((p) => existsSync(p));

console.log(`宿主：${consoleDir}`);
console.log(`index.html 注入引用行：${removedLines} 行`);
for (const p of files) console.log(`残留文件：${p}`);

if (removedLines === 0 && files.length === 0) {
  console.log('✓ 已经是干净的，无需清理（扩展本体不会重新注入）');
  process.exit(0);
}
if (checkOnly) {
  console.log('（--check：以上为待清理项，未做任何改动；执行请加 --clean）');
  process.exit(0);
}

if (removedLines > 0) {
  writeFileSync(htmlPath, kept.join(newline), 'utf8');
  console.log(`✓ 已剥掉 ${removedLines} 行注入引用（保留原有 ${newline === '\r\n' ? 'CRLF' : 'LF'} 换行风格）`);
}
for (const p of files) {
  rmSync(p, { force: true });
  console.log(`✓ 已删除 ${p}`);
}
console.log('✓ 清理完成；扩展本体不会重新注入，卸载也不需要还原。');
