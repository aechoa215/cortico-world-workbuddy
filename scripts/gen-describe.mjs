#!/usr/bin/env node
/**
 * 生成 `describe.json`。
 *
 * 为什么需要它：`describe.json` 是给市场/宿主看的清单，`WB_TOOL_DECLS` 是运行时真正注册的
 * 工具声明。两份各写各的，于是 0.1.7 里 `wb_chat` / `wb_credits` 的描述已经对不上了。
 * 这里把 `describe.json` 变成生成物：
 *
 *   - 工具名 / 描述 / 参数 / tags：来自 `src/world.js` 的 `WB_TOOL_DECLS`（唯一来源）；
 *   - 中英摘要：本文件里的 `SUMMARIES`（市场展示用的短句，源码里没有这个概念）；
 *   - 事件：本文件里的 `EVENTS`；
 *   - 环境提示词：`src/ENV_PROMPT.md` 全文。
 *
 * 用法：
 *   node scripts/gen-describe.mjs           # 写回 describe.json
 *   node scripts/gen-describe.mjs --check   # 只比对，不一致退出码 1
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WB_TOOL_DECLS } from '../src/world.js';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));

/** 市场列表里显示的一两句摘要（describe.json 的 summary 字段）。 */
const SUMMARIES = {
  wb_list_models: {
    zh: '列出 WorkBuddy 公开对话模型（安全清单）及各自的积分倍率、上下文与推理档；all=true 时附上被排除的项与原因。',
    en: 'Lists the safe WorkBuddy chat models with multiplier, context and reasoning efforts; all=true also lists excluded ones with reasons.',
  },
  wb_select_model: {
    zh: '选择 wb_chat 默认使用的 WorkBuddy 模型，选择会持久保存。',
    en: 'Selects the default WorkBuddy model for wb_chat; the choice persists across restarts.',
  },
  wb_chat: {
    zh: '向当前选中的 WorkBuddy 模型发一句单轮提问并取回答，会消耗用户自己的 WorkBuddy 积分。',
    en: "Asks the selected WorkBuddy model a single-turn question; spends the user's own WorkBuddy credits.",
  },
  wb_credits: {
    zh: '读取当前 WorkBuddy 账号的剩余积分与各积分包的已用/剩余（只读）。',
    en: 'Shows remaining WorkBuddy credits and per-package usage (read-only).',
  },
};

const EVENTS = [
  {
    type: 'workbuddy.started',
    description: {
      zh: 'World 挂载完成，报告登录态与目录概况。',
      en: 'The World was mounted; reports sign-in and catalog status.',
    },
  },
];

/** 由源码生成 describe.json 的对象。 */
export function buildDescribe() {
  const envPrompt = readFileSync(join(pkgDir, 'src', 'ENV_PROMPT.md'), 'utf8').replace(/\s+$/, '');
  return {
    tools: WB_TOOL_DECLS.map((decl) => ({
      name: decl.name,
      description: decl.description,
      summary: SUMMARIES[decl.name] ?? { zh: decl.name, en: decl.name },
      tags: [...(decl.tags ?? [])],
      parameters: decl.parameters,
    })),
    events: EVENTS,
    envPrompt,
  };
}

/** 便于测试：把对象序列化成写入文件时的文本。 */
export function renderDescribe(obj = buildDescribe()) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const target = join(pkgDir, 'describe.json');
  const next = renderDescribe();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      current = '';
    }
    if (current !== next) {
      console.error('✗ describe.json 与源码不一致；跑 `node scripts/gen-describe.mjs` 重新生成。');
      process.exit(1);
    }
    console.log('✓ describe.json 与源码一致');
  } else {
    writeFileSync(target, next, 'utf8');
    console.log(`✓ 已生成 describe.json（tools ${WB_TOOL_DECLS.length} 个）`);
  }
}
