import { describeTools } from 'cortico/world.ts';
import { WB_DEFAULTS } from './config.js';
import { WB_TOOL_DECLS, WorkBuddyWorld } from './world.js';

/** @type {import('cortico/world.ts').WorldDefinition} */
export const WORKBUDDY = {
  id: 'workbuddy',
  label: 'WorkBuddy 桥接',
  defaults: () => ({ ...WB_DEFAULTS }),
  // ctx.cfg 是 worlds.workbuddy 的活引用：region / model / maxTokens 等热改即生效。
  create: (ctx) => new WorkBuddyWorld({ ctx }),
  // 自描述：可能出现的全部工具与会推出的全部事件，不进提示词。
  describe: {
    tools: describeTools(WB_TOOL_DECLS, {
      wb_list_models: {
        zh: '列出本机 WorkBuddy 账号可用的模型及各自的默认积分倍率。',
        en: 'Lists WorkBuddy models for the signed-in account with each default credit multiplier.',
      },
      wb_select_model: {
        zh: '选择 wb_chat 默认调用的 WorkBuddy 模型。',
        en: 'Selects the default WorkBuddy model for wb_chat.',
      },
      wb_chat: {
        zh: '用选中的 WorkBuddy 模型回答一个单轮问题（消耗本人账号积分）。',
        en: 'Asks the selected WorkBuddy model a single-turn question (spends your own credits).',
      },
      wb_credits: {
        zh: '只读查询当前账号的 WorkBuddy 积分余额。',
        en: 'Read-only check of the WorkBuddy credit balance.',
      },
    }),
    events: [
      {
        type: 'workbuddy.started',
        description: { zh: 'World 挂载完成，报告登录态与目录概况。', en: 'The World was mounted; reports sign-in and catalog status.' },
      },
    ],
  },
};
