#!/usr/bin/env node
/**
 * 框架契约自检（dry-mount）：不启动 Coopanion，只按 Cortico 的判据检查这个 World 包。
 *
 * 检查项：`defaults()` / `create()` / `tools()` / `envPromptVars()` / `webUi()` 的形状，
 * 工具名前缀、tags、parameters 是否合法，webUi 的 panels / config / promptDocs 是否自洽。
 *
 * 用法：node scripts/selfcheck.mjs [--allow-missing-host] [--verbose]
 *   --allow-missing-host  找不到 Coopanion 宿主（CI / 没装 Coopanion 的机器）时只警告并退出 0
 *   --verbose             打印 dry-mount 的 stderr
 * 退出码：0 全绿（或缺宿主且给了 --allow-missing-host）；1 有 failures；2 环境问题。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findAppRoot } from '../src/host.js';

const verbose = process.argv.includes('--verbose');
const allowMissingHost = process.argv.includes('--allow-missing-host') || process.env.WB_ALLOW_MISSING_HOST === '1';
const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

/** 缺宿主时的统一出口：给了 --allow-missing-host 就只警告。 */
function missingHost(reason) {
  if (allowMissingHost) {
    console.warn(`⚠ 跳过自检：${reason}`);
    console.warn('  （--allow-missing-host 已生效，CI 与没装 Coopanion 的机器上视为通过。）');
    process.exit(0);
  }
  console.error(`✗ ${reason}`);
  console.error('  装了 Coopanion 的话设 COOPANION_APP_ROOT=<...>/resources/app；只想过语法检查用 --allow-missing-host。');
  process.exit(2);
}

const appRoot = process.env.COOPANION_APP_ROOT || findAppRoot({ packageDir: pkgDir });
if (!appRoot) missingHost('找不到 Coopanion 的 resources/app。');

const loader = join(appRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const runtime = join(appRoot, 'build', 'cortico', 'src', 'extensions', 'runtime.ts');
for (const file of [loader, runtime]) {
  if (!existsSync(file)) missingHost(`缺少 ${file}（Coopanion 版本不匹配？）`);
}

const scratch = mkdtempSync(join(tmpdir(), 'wbselfcheck-'));
const reportFile = join(scratch, 'report.json');
const body = fileURLToPath(new URL('./_drymount.mjs', import.meta.url));
const result = spawnSync(process.execPath, [
  '--import', pathToFileURL(loader).href,
  '--import', pathToFileURL(runtime).href,
  body,
  pkgDir,
  scratch,
  reportFile,
], { encoding: 'utf8' });

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr && (result.status !== 0 || verbose)) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`✗ dry-mount 执行失败（退出码 ${result.status}）`);
  process.exit(1);
}

let report = null;
try {
  report = JSON.parse(readFileSync(reportFile, 'utf8'));
} catch {
  console.error('✗ 读不到自检报告（dry-mount 没写出结果）');
  process.exit(1);
}
rmSync(scratch, { recursive: true, force: true });

const failures = report.failures ?? [];
const warnings = report.warnings ?? [];
if (failures.length > 0) {
  console.error(`✗ ${pkg.name} ${pkg.version}：${failures.length} 条失败`);
  process.exit(1);
}
console.log(
  `✓ ${pkg.name} ${pkg.version} 自检通过` +
  `（${(report.ok ?? []).length} 项通过，${warnings.length} 条提醒）`,
);
process.exit(0);
