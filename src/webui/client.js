/**
 * WorkBuddy 桥接的 WebUI 面板（浏览器 bundle 源码，esbuild 打成 dist/webui.js）。
 * 契约：默认导出 { panels: { <id>: { mount(ctx) } } }；浏览器侧只用 ctx 与 DOM，
 * 不 import 任何 node 模块，也不直连 /api/。
 */

const TEXT = {
  zh: {
    refresh: '从 WorkBuddy 刷新',
    refreshing: '刷新中…',
    select: '选用',
    selected: '当前',
    colModel: '模型',
    colId: 'id',
    colMultiplier: '默认积分倍率',
    colContext: '上下文',
    colReasoning: '推理档',
    colAction: '操作',
    empty: '目录为空。点上方「从 WorkBuddy 刷新」拉取本机账号可用的模型。',
    notRefreshed: '尚未刷新',
    lastRefresh: '上次刷新',
    multiplierFree: '免费',
    status: '状态',
    authed: '已登录',
    noAuth: '未发现登录态',
    source: '来源',
    token: 'Token（掩码）',
    account: '账号',
    region: '区域',
    upstream: '上游',
    rediscover: '重新检测本机登录',
    pasteToken: '手动粘贴 access token',
    saveToken: '保存 token',
    clearToken: '清除手动 token',
    tokenSaved: 'token 已存入密钥库',
    credits: '积分余额',
    queryCredits: '查询积分',
    creditsFail: '积分查询失败',
    lastError: '最近错误',
    models: '个模型',
    currentModel: '当前模型',
    priorityTitle: '中转站优先',
    priorityLabel: '是否启用Workbuddy',
    priorityDesc:
      '与「开始」页的「中转站优先」按钮是同一份状态：打开后桌宠每轮对话优先调用 WorkBuddy 的模型，关闭则完全跳过 WorkBuddy。需要 WorkBuddy 桌面端主进程在运行。',
    procRunning: 'WorkBuddy 主进程：运行中',
    procStopped: 'WorkBuddy 主进程：未检测到',
    noProcess: '未检测到Workbuddy',
    enabledOn: '已开启：桌宠优先走 WorkBuddy 模型',
    enabledOff: '已关闭：桌宠跳过 WorkBuddy',
    hostOk: '开始页按钮：已注入',
    hostBroken: '开始页按钮：未注入（宿主升级可能覆盖了控制台文件）',
    hostUnknown: '开始页按钮：状态未知',
    repair: '重新注入开始页按钮',
    repairing: '正在重新注入…',
    repaired: '已修复，重新打开控制台即可看到按钮',
    repairFail: '修复失败',
  },
  en: {
    refresh: 'Refresh from WorkBuddy',
    refreshing: 'Refreshing…',
    select: 'Use',
    selected: 'Current',
    colModel: 'Model',
    colId: 'id',
    colMultiplier: 'Default credit multiplier',
    colContext: 'Context',
    colReasoning: 'Efforts',
    colAction: 'Action',
    empty: 'Catalog is empty. Click "Refresh from WorkBuddy" to fetch models for the signed-in account.',
    notRefreshed: 'never',
    lastRefresh: 'Last refresh',
    multiplierFree: 'free',
    status: 'Status',
    authed: 'Signed in',
    noAuth: 'No sign-in found',
    source: 'Source',
    token: 'Token (masked)',
    account: 'Account',
    region: 'Region',
    upstream: 'Upstream',
    rediscover: 'Re-detect local sign-in',
    pasteToken: 'Paste an access token manually',
    saveToken: 'Save token',
    clearToken: 'Clear manual token',
    tokenSaved: 'Token stored in the secret store',
    credits: 'Credit balance',
    queryCredits: 'Query credits',
    creditsFail: 'Credit query failed',
    lastError: 'Last error',
    models: 'models',
    currentModel: 'Current model',
    priorityTitle: 'Relay first',
    priorityLabel: 'Enable Workbuddy',
    priorityDesc:
      'Same state as the “Relay first” button on the Home page: when on, the pet asks a WorkBuddy model first every turn; when off, WorkBuddy is skipped entirely. Requires the WorkBuddy desktop main process.',
    procRunning: 'WorkBuddy process: running',
    procStopped: 'WorkBuddy process: not detected',
    noProcess: 'Workbuddy not detected',
    enabledOn: 'On: the pet asks WorkBuddy first',
    enabledOff: 'Off: the pet skips WorkBuddy',
    hostOk: 'Home button: injected',
    hostBroken: 'Home button: not injected (a host update may have replaced the console files)',
    hostUnknown: 'Home button: unknown',
    repair: 'Re-inject the home button',
    repairing: 'Re-injecting…',
    repaired: 'Fixed. Reopen the console to see the button',
    repairFail: 'Repair failed',
  },
};

function strings(ctx) {
  return TEXT[ctx.language === 'en' ? 'en' : 'zh'];
}

function fmtMultiplier(m, s) {
  if (typeof m.creditMultiplier !== 'number') return { text: '—', free: false };
  if (m.creditMultiplier === 0) return { text: `x0 · ${s.multiplierFree}`, free: true };
  return { text: `x${m.creditMultiplier}`, free: false };
}

function fmtTs(ms, s) {
  if (!ms) return s.notRefreshed;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function mountModels(ctx) {
  const s = strings(ctx);
  const { ui } = ctx;

  const sheet = ui.sheet({
    title: s.colModel === '模型' ? 'WorkBuddy 模型目录' : 'WorkBuddy model catalog',
    desc: s.empty,
  });
  ctx.root.append(sheet.el);

  const head = ui.rowbar();
  const refreshBtn = ui.button(s.refresh, { variant: 'primary' });
  const stateChip = ui.chip('', 'plain');
  const currentChip = ui.chip('', 'accent');
  head.append(refreshBtn, stateChip, currentChip);
  sheet.body.append(head);

  const errLine = ui.msgline();
  sheet.body.append(errLine);

  const table = ui.table({
    head: [s.colModel, s.colMultiplier, s.colContext, s.colReasoning, s.colAction],
    maxHeight: 'calc(100vh - 320px)',
  });
  sheet.body.append(table.el);

  let state = null;

  function renderChips() {
    stateChip.textContent = `${s.lastRefresh}: ${fmtTs(state?.catalogAt, s)} · ${state?.models?.length ?? 0} ${s.models}`;
    currentChip.textContent = `${s.currentModel}: ${state?.model || '—'}`;
  }

  function renderTable() {
    const models = state?.models ?? [];
    table.clear(models.length ? undefined : s.empty);
    for (const m of models) {
      const mul = fmtMultiplier(m, s);
      const isCurrent = state.model === m.id;
      const nameCell = ui.h('div');
      nameCell.append(ui.h('div', null, m.name || m.id));
      const sub = ui.h('div', 'dim', m.id);
      sub.style.fontSize = '12px';
      sub.style.opacity = '0.65';
      nameCell.append(sub);
      if (m.description) nameCell.title = m.description;

      const mulPill = ui.pill(mul.text, mul.free ? 'on' : 'plain');

      const btn = ui.button(isCurrent ? s.selected : s.select, {
        size: 'sm',
        variant: isCurrent ? 'plain' : 'primary',
        onClick: async () => {
          const off = ui.disable(btn);
          try {
            const r = await ctx.invoke('select', [m.id]);
            if (r?.ok) {
              state.model = m.id;
              ui.toast(`${m.id} ✓`);
              renderChips();
              renderTable();
            } else {
              ui.toast(r?.error ?? 'failed', 'bad');
            }
          } catch (err) {
            ui.toast(String(err?.message ?? err), 'bad');
          } finally {
            off.dispose();
          }
        },
      });
      if (isCurrent) btn.disabled = true;

      table.addRow([
        nameCell,
        mulPill,
        m.contextWindow ? String(m.contextWindow) : '—',
        m.reasoning?.supportedEfforts?.join(' / ') ?? '—',
        btn,
      ]);
    }
  }

  async function load() {
    state = await ctx.invoke('state');
    renderChips();
    renderTable();
    errLine.textContent = state?.lastError ?? '';
  }

  refreshBtn.addEventListener('click', async () => {
    const off = ui.disable(refreshBtn);
    refreshBtn.textContent = s.refreshing;
    try {
      const r = await ctx.invoke('refresh');
      if (r?.ok) {
        ui.toast(`${r.count} ${s.models}`);
        await load();
      } else {
        errLine.textContent = r?.error ?? 'failed';
        ui.toast(r?.error ?? 'failed', 'bad');
      }
    } catch (err) {
      errLine.textContent = String(err?.message ?? err);
    } finally {
      refreshBtn.textContent = s.refresh;
      off.dispose();
    }
  });

  // 服务端推送（目录刷新 / 选择变化）时跟着刷新。
  ctx.stream({
    message: () => load().catch(() => {}),
  });

  load().catch((err) => {
    errLine.textContent = String(err?.message ?? err);
  });
}

function mountAccount(ctx) {
  const s = strings(ctx);
  const { ui } = ctx;

  const sheet = ui.sheet({ title: s.account === '账号' ? 'WorkBuddy 账号' : 'WorkBuddy account' });
  ctx.root.append(sheet.el);

  const kvWrap = ui.h('div');
  sheet.body.append(kvWrap);
  const errLine = ui.msgline();
  sheet.body.append(errLine);

  const actions = ui.actions();
  const rediscoverBtn = ui.button(s.rediscover);
  const creditsBtn = ui.button(s.queryCredits);
  actions.append(rediscoverBtn, creditsBtn);
  sheet.body.append(actions);

  const tokenSection = ui.section(s.pasteToken);
  const tokenInput = ui.input({ type: 'password', placeholder: 'access token', cls: 'mono' });
  const saveBtn = ui.button(s.saveToken, { variant: 'primary' });
  const clearBtn = ui.button(s.clearToken, { variant: 'danger', size: 'sm' });
  const tokenRow = ui.rowbar();
  tokenRow.append(tokenInput, saveBtn, clearBtn);
  tokenSection.append(tokenRow);
  sheet.body.append(tokenSection);

  let state = null;

  function render() {
    const rows = [
      { k: s.status, v: state?.authed ? s.authed : s.noAuth },
      { k: s.source, v: state?.tokenSource ?? '—' },
      { k: s.token, v: state?.tokenMask ?? '—' },
      { k: s.account, v: state?.account?.name ?? '—' },
      { k: s.region, v: state?.region ?? '—' },
      { k: s.upstream, v: state?.baseUrl ?? '—' },
    ];
    if (state?.lastError) rows.push({ k: s.lastError, v: state.lastError });
    kvWrap.replaceChildren(ui.kv(rows));
  }

  async function load() {
    state = await ctx.invoke('state');
    render();
  }

  rediscoverBtn.addEventListener('click', async () => {
    const off = ui.disable(rediscoverBtn);
    try {
      const r = await ctx.invoke('rediscover');
      if (r?.authed) ui.toast(s.authed);
      else ui.toast(r?.error ?? s.noAuth, 'bad');
      await load();
    } finally {
      off.dispose();
    }
  });

  creditsBtn.addEventListener('click', async () => {
    const off = ui.disable(creditsBtn);
    try {
      const r = await ctx.invoke('credits');
      if (r?.ok) {
        const lines = [`${s.credits}: ${r.total ?? '—'}`];
        for (const p of (r.packages ?? []).slice(0, 20)) lines.push(`${p.name}: ${p.remain}`);
        ui.drawer(s.credits, lines.join('\n'));
      } else {
        ui.toast(`${s.creditsFail}: ${r?.error ?? ''}`, 'bad');
      }
    } catch (err) {
      ui.toast(String(err?.message ?? err), 'bad');
    } finally {
      off.dispose();
    }
  });

  saveBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    const off = ui.disable(saveBtn, tokenInput);
    try {
      const r = await ctx.invoke('setToken', [token]);
      if (r?.ok) {
        tokenInput.value = '';
        ui.toast(s.tokenSaved);
        await load();
      } else {
        ui.toast(r?.error ?? 'failed', 'bad');
      }
    } finally {
      off.dispose();
    }
  });

  clearBtn.addEventListener('click', async () => {
    await ctx.invoke('clearToken');
    await load();
  });

  load().catch((err) => {
    errLine.textContent = String(err?.message ?? err);
  });
}

function mountPriority(ctx) {
  const s = strings(ctx);
  const { ui } = ctx;

  const sheet = ui.sheet({ title: s.priorityTitle, desc: s.priorityDesc });
  ctx.root.append(sheet.el);

  const statusLine = ui.msgline();
  // 开始页按钮挂在宿主控制台里：宿主升级会把 build/console 覆盖掉，这里给个状态 + 一键补回。
  const hostLine = ui.msgline();
  const hostBar = ui.actions();
  const repairBtn = ui.button(s.repair, {
    size: 'sm',
    variant: 'plain',
    onClick: async () => {
      repairBtn.disabled = true;
      hostLine.textContent = s.repairing;
      try {
        const r = await ctx.invoke('repair');
        hostLine.textContent = r?.ok ? s.repaired : `${s.repairFail}：${r?.error ?? r?.hostUi?.reason ?? ''}`;
        ui.toast(r?.ok ? s.repaired : s.repairFail, r?.ok ? 'ok' : 'bad');
        await load();
      } catch (err) {
        hostLine.textContent = `${s.repairFail}：${String(err?.message ?? err)}`;
        ui.toast(s.repairFail, 'bad');
      } finally {
        repairBtn.disabled = false;
      }
    },
  });
  hostBar.append(repairBtn);

  /** 用服务端状态刷新界面（不触发 onChange）。 */
  function apply(r) {
    if (!r) return;
    box.setChecked(r.prefer === true);
    statusLine.textContent = r.running ? s.procRunning : s.procStopped;
    const host = r.hostUi;
    if (!host) {
      hostLine.textContent = s.hostUnknown;
      hostBar.style.display = 'none';
      return;
    }
    hostLine.textContent = host.ok ? s.hostOk : `${s.hostBroken}（${host.label ?? host.reason}）`;
    hostBar.style.display = host.ok ? 'none' : '';
  }

  const box = ui.checkbox(s.priorityLabel, {
    checked: false,
    title: s.priorityDesc,
    onChange: async (checked) => {
      try {
        const r = await ctx.invoke('set', [checked]);
        if (r?.ok) {
          apply(r);
          ui.toast(checked ? s.enabledOn : s.enabledOff);
        } else {
          // 没检测到 WorkBuddy 主进程（或其它失败）：开关退回关，并把原因说清楚。
          apply(r);
          box.setChecked(false);
          ui.toast(r?.error ?? s.noProcess, 'bad');
        }
      } catch (err) {
        box.setChecked(false);
        ui.toast(String(err?.message ?? err), 'bad');
      }
    },
  });
  sheet.body.append(box.el, statusLine, hostLine, hostBar);

  async function load() {
    apply(await ctx.invoke('state'));
  }

  ctx.stream({
    message: () => load().catch(() => {}),
  });

  load().catch((err) => {
    statusLine.textContent = String(err?.message ?? err);
  });
}

export default {
  panels: {
    models: { mount: mountModels },
    account: { mount: mountAccount },
    priority: { mount: mountPriority },
  },
};
