#!/usr/bin/env node
/**
 * 显式卸载清理：只清本扩展自己的配置块、三份数据文件和手动 token/哨兵。
 * 宿主界面卸载只删扩展包，不会调用 World.stop()；普通 stop()/重启又不能删用户数据，
 * 所以清理由用户在卸载后主动执行。--check 只读，--clean 才修改，且绝不打印 token。
 *
 * 用法：
 *   node scripts/clean-workbuddy.mjs --check
 *   node scripts/clean-workbuddy.mjs --clean
 * 隔离验证可显式传 --bot-dir <部署目录> --data-dir <数据目录>。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAppRoot } from './lib/app-root.mjs';

export const WORKBUDDY_DATA_FILES = ['workbuddy-usage.jsonl', 'workbuddy-catalog.json', 'workbuddy-balance.json'];

function readConfig(path) {
  if (!existsSync(path)) return { value: null, text: '' };
  const text = readFileSync(path, 'utf8');
  return { value: JSON.parse(text), text };
}

/** 返回残留位置与布尔状态，不返回任何凭据内容。 */
export function inspectWorkbuddyResidue({ botDir, dataDir }) {
  const configPath = join(botDir, 'config.json');
  const envPath = join(botDir, '.env');
  const config = readConfig(configPath);
  const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  return {
    botDir,
    dataDir,
    configPath,
    envPath,
    configPresent: config.value?.worlds && Object.hasOwn(config.value.worlds, 'workbuddy'),
    envPresent: /^[\t ]*accessToken[\t ]*=/m.test(env),
    dataFiles: WORKBUDDY_DATA_FILES.map((name) => join(dataDir, name)).filter((path) => existsSync(path)),
  };
}

/** 幂等清理；返回清理前后状态供 CLI 与契约测试核对。 */
export function cleanWorkbuddyResidue({ botDir, dataDir, clean = false }) {
  const before = inspectWorkbuddyResidue({ botDir, dataDir });
  if (clean) {
    if (before.configPresent) {
      const config = readConfig(before.configPath);
      delete config.value.worlds.workbuddy;
      const indent = /^\{\r?\n([\t ]+)\S/.exec(config.text)?.[1] ?? '  ';
      const newline = config.text.includes('\r\n') ? '\r\n' : '\n';
      const trailing = config.text.endsWith(newline) ? newline : '';
      writeFileSync(before.configPath, `${JSON.stringify(config.value, null, indent)}${trailing}`, 'utf8');
    }
    if (before.envPresent) {
      const env = readFileSync(before.envPath, 'utf8');
      const next = env.replace(/^[\t ]*accessToken[\t ]*=.*(?:\r?\n|$)/gm, '');
      writeFileSync(before.envPath, next, 'utf8');
    }
    for (const path of before.dataFiles) rmSync(path, { force: true });
  }
  return { before, after: inspectWorkbuddyResidue({ botDir, dataDir }) };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function runCli() {
  const check = process.argv.includes('--check');
  const clean = process.argv.includes('--clean');
  if (check === clean) {
    console.error('用法：node scripts/clean-workbuddy.mjs --check | --clean（二选一）');
    process.exit(2);
  }
  const pkgDir = fileURLToPath(new URL('..', import.meta.url));
  const appRoot = process.env.COOPANION_APP_ROOT || findAppRoot({ packageDir: pkgDir });
  const defaultBotDir = appRoot ? join(appRoot, '..', '..', 'data', 'home', 'companion') : '';
  const botDir = resolve(argValue('--bot-dir') || defaultBotDir);
  const dataDir = resolve(argValue('--data-dir') || join(defaultBotDir, 'data'));
  if (!defaultBotDir && (!argValue('--bot-dir') || !argValue('--data-dir'))) {
    console.error('✗ 找不到 Coopanion 部署目录；请显式传 --bot-dir 与 --data-dir');
    process.exit(2);
  }
  try {
    const result = cleanWorkbuddyResidue({ botDir, dataDir, clean });
    const state = clean ? result.after : result.before;
    console.log(`配置 worlds.workbuddy：${state.configPresent ? '存在' : '无'}`);
    console.log(`.env accessToken：${state.envPresent ? '存在（值未读取到输出）' : '无'}`);
    for (const path of state.dataFiles) console.log(`数据文件：${path}`);
    if (!clean) console.log('（--check：未做任何改动；卸载扩展后执行 --clean 清理）');
    const left = state.configPresent || state.envPresent || state.dataFiles.length > 0;
    console.log(clean && !left ? '✓ 本扩展的配置、数据与凭据残留已清理' : left ? '发现上述本扩展残留' : '✓ 没有本扩展残留');
    process.exit(clean && left ? 1 : 0);
  } catch (err) {
    console.error(`✗ 清理失败：${err?.message ?? err}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
