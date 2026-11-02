#!/usr/bin/env node
/**
 * 把「开始页按钮」注入到宿主的 `resources/app/build/console`。
 *
 * 用法：
 *   node scripts/host-inject.mjs              # 检查 + 修复（幂等）
 *   node scripts/host-inject.mjs --check      # 只检查，不改
 *   node scripts/host-inject.mjs --restore    # 从备份还原 index.html 并删注入脚本
 *   node scripts/host-inject.mjs --app <dir>  # 显式指定 resources/app
 *
 * 为什么要有这个脚本：Coopanion 目前没有 World 扩展的「主界面挂载点」，开始页那排
 * 「中转站优先：」只能改写宿主静态资源；宿主升级会覆盖 build/console，扩展启动时会
 * 自动重注入（src/host.js），这个脚本是同一套逻辑的手动/CI 入口。
 */

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_FILE,
  INJECTOR_FILE,
  describeHostInjection,
  ensureHostInjection,
  findAppRoot,
  inspectHostInjection,
  stripInjection,
} from '../src/host.js';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const restore = args.includes('--restore');
const appFlag = args.indexOf('--app');
const explicitApp = appFlag >= 0 ? args[appFlag + 1] : '';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const injectorSource = readFileSync(join(pkgDir, 'assets', INJECTOR_FILE), 'utf8');

const appRoot = explicitApp || findAppRoot({ packageDir: pkgDir });
if (!appRoot) {
  console.error('✗ 找不到 Coopanion 的 resources/app；用 --app 指定（例如 C:\\...\\Coopanion\\resources\\app）');
  process.exit(2);
}
console.log(`· app root: ${appRoot}`);

if (restore) {
  const state = inspectHostInjection(appRoot);
  const backup = join(state.consoleDir, BACKUP_FILE);
  if (existsSync(backup)) {
    copyFileSync(backup, state.htmlPath);
  } else {
    // 老版本是手工注入的，没有备份：就地剥掉引用行，效果等价。
    writeFileSync(state.htmlPath, stripInjection(readFileSync(state.htmlPath, 'utf8')), 'utf8');
    console.log('· 没有备份文件，已就地移除引用行');
  }
  const injector = join(state.consoleDir, INJECTOR_FILE);
  if (existsSync(injector)) rmSync(injector);
  console.log('✓ 已还原 index.html 并删除注入脚本');
  process.exit(0);
}

const before = inspectHostInjection(appRoot);
console.log(`· 当前：${describeHostInjection(before)}${before.ok ? '' : `（reason=${before.reason}）`}`);

if (checkOnly) {
  console.log(JSON.stringify({ ok: before.ok, ...before }, null, 2));
  process.exit(before.ok ? 0 : 1);
}

const result = ensureHostInjection({ appRoot, source: injectorSource, sourceVersion: pkg.version });
if (result.ok) {
  console.log(
    result.changed.length > 0
      ? `✓ 注入完成（${result.changed.join(', ')}）；重新打开控制台即可看到按钮`
      : '✓ 注入已是最新，无需改动',
  );
  process.exit(0);
}
console.error(`✗ 注入失败：${result.reason}`);
process.exit(1);
