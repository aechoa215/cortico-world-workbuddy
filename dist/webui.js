// src/webui/client.js
var TEXT = {
  zh: {
    refresh: "\u4ECE WorkBuddy \u5237\u65B0",
    refreshing: "\u5237\u65B0\u4E2D\u2026",
    select: "\u9009\u7528",
    selected: "\u5F53\u524D",
    colModel: "\u6A21\u578B",
    colId: "id",
    colMultiplier: "\u9ED8\u8BA4\u79EF\u5206\u500D\u7387",
    colContext: "\u4E0A\u4E0B\u6587",
    colReasoning: "\u63A8\u7406\u6863",
    colAction: "\u64CD\u4F5C",
    empty: "\u76EE\u5F55\u4E3A\u7A7A\u3002\u70B9\u4E0A\u65B9\u300C\u4ECE WorkBuddy \u5237\u65B0\u300D\u62C9\u53D6\u672C\u673A\u8D26\u53F7\u53EF\u7528\u7684\u6A21\u578B\u3002",
    notRefreshed: "\u5C1A\u672A\u5237\u65B0",
    lastRefresh: "\u4E0A\u6B21\u5237\u65B0",
    multiplierFree: "\u514D\u8D39",
    status: "\u72B6\u6001",
    authed: "\u5DF2\u767B\u5F55",
    noAuth: "\u672A\u53D1\u73B0\u767B\u5F55\u6001",
    source: "\u6765\u6E90",
    token: "Token\uFF08\u63A9\u7801\uFF09",
    account: "\u8D26\u53F7",
    region: "\u533A\u57DF",
    upstream: "\u4E0A\u6E38",
    rediscover: "\u91CD\u65B0\u68C0\u6D4B\u672C\u673A\u767B\u5F55",
    pasteToken: "\u624B\u52A8\u7C98\u8D34 access token",
    saveToken: "\u4FDD\u5B58 token",
    clearToken: "\u6E05\u9664\u624B\u52A8 token",
    tokenSaved: "token \u5DF2\u5B58\u5165\u5BC6\u94A5\u5E93",
    credits: "\u79EF\u5206\u4F59\u989D",
    queryCredits: "\u67E5\u8BE2\u79EF\u5206",
    creditsFail: "\u79EF\u5206\u67E5\u8BE2\u5931\u8D25",
    lastError: "\u6700\u8FD1\u9519\u8BEF",
    models: "\u4E2A\u6A21\u578B",
    currentModel: "\u5F53\u524D\u6A21\u578B",
    priorityTitle: "\u4E2D\u8F6C\u7AD9\u4F18\u5148",
    priorityLabel: "\u662F\u5426\u542F\u7528Workbuddy",
    priorityDesc: "\u4E0E\u300C\u5F00\u59CB\u300D\u9875\u7684\u300C\u4E2D\u8F6C\u7AD9\u4F18\u5148\u300D\u6309\u94AE\u662F\u540C\u4E00\u4EFD\u72B6\u6001\uFF1A\u6253\u5F00\u540E\u684C\u5BA0\u6BCF\u8F6E\u5BF9\u8BDD\u4F18\u5148\u8C03\u7528 WorkBuddy \u7684\u6A21\u578B\uFF0C\u5173\u95ED\u5219\u5B8C\u5168\u8DF3\u8FC7 WorkBuddy\u3002\u9700\u8981 WorkBuddy \u684C\u9762\u7AEF\u4E3B\u8FDB\u7A0B\u5728\u8FD0\u884C\u3002",
    procRunning: "WorkBuddy \u4E3B\u8FDB\u7A0B\uFF1A\u8FD0\u884C\u4E2D",
    procStopped: "WorkBuddy \u4E3B\u8FDB\u7A0B\uFF1A\u672A\u68C0\u6D4B\u5230",
    noProcess: "\u672A\u68C0\u6D4B\u5230Workbuddy",
    enabledOn: "\u5DF2\u5F00\u542F\uFF1A\u684C\u5BA0\u4F18\u5148\u8D70 WorkBuddy \u6A21\u578B",
    enabledOff: "\u5DF2\u5173\u95ED\uFF1A\u684C\u5BA0\u8DF3\u8FC7 WorkBuddy",
    hostOk: "\u5F00\u59CB\u9875\u6309\u94AE\uFF1A\u5DF2\u6CE8\u5165",
    hostBroken: "\u5F00\u59CB\u9875\u6309\u94AE\uFF1A\u672A\u6CE8\u5165\uFF08\u5BBF\u4E3B\u5347\u7EA7\u53EF\u80FD\u8986\u76D6\u4E86\u63A7\u5236\u53F0\u6587\u4EF6\uFF09",
    hostUnknown: "\u5F00\u59CB\u9875\u6309\u94AE\uFF1A\u72B6\u6001\u672A\u77E5",
    repair: "\u91CD\u65B0\u6CE8\u5165\u5F00\u59CB\u9875\u6309\u94AE",
    repairing: "\u6B63\u5728\u91CD\u65B0\u6CE8\u5165\u2026",
    repaired: "\u5DF2\u4FEE\u590D\uFF0C\u91CD\u65B0\u6253\u5F00\u63A7\u5236\u53F0\u5373\u53EF\u770B\u5230\u6309\u94AE",
    repairFail: "\u4FEE\u590D\u5931\u8D25",
    usageTitle: "\u7528\u91CF",
    usageDesc: "\u672C\u673A\u8BB0\u8D26\u7684\u8C03\u7528\u7528\u91CF\u4E0E WorkBuddy \u79EF\u5206\u5305\u4F59\u989D\u3002\u79EF\u5206\u53D6\u4E0A\u6E38\u6BCF\u6B21\u8C03\u7528\u56DE\u4F20\u7684\u771F\u5B9E\u6263\u8D39\uFF08\u53EF\u80FD\u4E3A 0\uFF09\uFF0C\u500D\u7387\u6309\u76EE\u5F55 + \u9650\u65F6\u4F18\u60E0\u5B9E\u65F6\u8BA1\u7B97\u3002",
    usageRefresh: "\u5237\u65B0\u4F59\u989D",
    usageClear: "\u6E05\u7A7A\u672C\u5730\u8D26\u672C",
    usageCleared: "\u672C\u5730\u8D26\u672C\u5DF2\u6E05\u7A7A",
    metricCalls: "\u8C03\u7528",
    metricCredit: "\u79EF\u5206",
    metricInput: "\u8F93\u5165 tok",
    metricOutput: "\u8F93\u51FA tok",
    spanToday: "\u4ECA\u5929",
    spanWeek: "\u8FD1 7 \u5929",
    spanMonth: "\u8FD1 30 \u5929",
    byModel: "\u6309\u6A21\u578B",
    balanceTitle: "\u79EF\u5206\u5305\u4F59\u989D",
    colPkgName: "\u79EF\u5206\u5305",
    colPkgRemain: "\u5269\u4F59",
    colPkgUsed: "\u5DF2\u7528",
    colPkgCycle: "\u5468\u671F",
    promosTitle: "\u9650\u65F6\u4F18\u60E0 / \u514D\u8D39",
    promoActive: "\u751F\u6548\u4E2D",
    promoSoon: "\u672A\u751F\u6548",
    recentTitle: "\u6700\u8FD1\u8C03\u7528",
    colTime: "\u65F6\u95F4",
    colTokens: "token",
    colDuration: "\u8017\u65F6",
    noData: "\u6682\u65E0\u6570\u636E",
    totalCredit: "\u5408\u8BA1\u79EF\u5206",
    todayCredit: "\u4ECA\u65E5\u79EF\u5206",
    todayTokens: "\u4ECA\u65E5 token"
  },
  en: {
    refresh: "Refresh from WorkBuddy",
    refreshing: "Refreshing\u2026",
    select: "Use",
    selected: "Current",
    colModel: "Model",
    colId: "id",
    colMultiplier: "Default credit multiplier",
    colContext: "Context",
    colReasoning: "Efforts",
    colAction: "Action",
    empty: 'Catalog is empty. Click "Refresh from WorkBuddy" to fetch models for the signed-in account.',
    notRefreshed: "never",
    lastRefresh: "Last refresh",
    multiplierFree: "free",
    status: "Status",
    authed: "Signed in",
    noAuth: "No sign-in found",
    source: "Source",
    token: "Token (masked)",
    account: "Account",
    region: "Region",
    upstream: "Upstream",
    rediscover: "Re-detect local sign-in",
    pasteToken: "Paste an access token manually",
    saveToken: "Save token",
    clearToken: "Clear manual token",
    tokenSaved: "Token stored in the secret store",
    credits: "Credit balance",
    queryCredits: "Query credits",
    creditsFail: "Credit query failed",
    lastError: "Last error",
    models: "models",
    currentModel: "Current model",
    priorityTitle: "Relay first",
    priorityLabel: "Enable Workbuddy",
    priorityDesc: "Same state as the \u201CRelay first\u201D button on the Home page: when on, the pet asks a WorkBuddy model first every turn; when off, WorkBuddy is skipped entirely. Requires the WorkBuddy desktop main process.",
    procRunning: "WorkBuddy process: running",
    procStopped: "WorkBuddy process: not detected",
    noProcess: "Workbuddy not detected",
    enabledOn: "On: the pet asks WorkBuddy first",
    enabledOff: "Off: the pet skips WorkBuddy",
    hostOk: "Home button: injected",
    hostBroken: "Home button: not injected (a host update may have replaced the console files)",
    hostUnknown: "Home button: unknown",
    repair: "Re-inject the home button",
    repairing: "Re-injecting\u2026",
    repaired: "Fixed. Reopen the console to see the button",
    repairFail: "Repair failed",
    usageTitle: "Usage",
    usageDesc: "Locally recorded call usage plus the WorkBuddy credit balance. Credits come from the per-call figure the upstream returns (may be 0); multipliers combine the catalog with time-limited offers in real time.",
    usageRefresh: "Refresh balance",
    usageClear: "Clear local ledger",
    usageCleared: "Local ledger cleared",
    metricCalls: "Calls",
    metricCredit: "Credits",
    metricInput: "Input tok",
    metricOutput: "Output tok",
    spanToday: "Today",
    spanWeek: "Last 7 days",
    spanMonth: "Last 30 days",
    byModel: "By model",
    balanceTitle: "Credit packages",
    colPkgName: "Package",
    colPkgRemain: "Remaining",
    colPkgUsed: "Used",
    colPkgCycle: "Cycle",
    promosTitle: "Limited-time offers / free",
    promoActive: "active",
    promoSoon: "scheduled",
    recentTitle: "Recent calls",
    colTime: "Time",
    colTokens: "tokens",
    colDuration: "Latency",
    noData: "No data",
    totalCredit: "Total credits",
    todayCredit: "Credits today",
    todayTokens: "Tokens today"
  }
};
function strings(ctx) {
  return TEXT[ctx.language === "en" ? "en" : "zh"];
}
function fmtMultiplier(m, s) {
  const price = m?.price;
  const base = typeof price?.base === "number" ? price.base : typeof m?.creditMultiplier === "number" ? m.creditMultiplier : null;
  const eff = typeof price?.effective === "number" ? price.effective : base;
  if (base === null) return { text: "\u2014", free: false, promo: "" };
  if (eff === 0) return { text: `x0 \xB7 ${s.multiplierFree}${price?.windowText ? ` ${price.windowText}` : ""}`, free: true, promo: price?.badge ?? "" };
  if (typeof eff === "number" && eff < base) {
    return {
      text: `x${eff} \u2190 x${base}${price?.windowText ? ` ${price.windowText}` : ""}`,
      free: false,
      promo: price?.badge ?? ""
    };
  }
  return { text: `x${base}`, free: false, promo: price?.badge ?? "" };
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
    title: s.colModel === "\u6A21\u578B" ? "WorkBuddy \u6A21\u578B\u76EE\u5F55" : "WorkBuddy model catalog",
    desc: s.empty
  });
  ctx.root.append(sheet.el);
  const head = ui.rowbar();
  const refreshBtn = ui.button(s.refresh, { variant: "primary" });
  const stateChip = ui.chip("", "plain");
  const currentChip = ui.chip("", "accent");
  head.append(refreshBtn, stateChip, currentChip);
  sheet.body.append(head);
  const errLine = ui.msgline();
  sheet.body.append(errLine);
  const table = ui.table({
    head: [s.colModel, s.colMultiplier, s.colContext, s.colReasoning, s.colAction],
    maxHeight: "calc(100vh - 320px)"
  });
  sheet.body.append(table.el);
  let state = null;
  function renderChips() {
    stateChip.textContent = `${s.lastRefresh}: ${fmtTs(state?.catalogAt, s)} \xB7 ${state?.models?.length ?? 0} ${s.models}`;
    currentChip.textContent = `${s.currentModel}: ${state?.model || "\u2014"}`;
  }
  function renderTable() {
    const models = state?.models ?? [];
    table.clear(models.length ? void 0 : s.empty);
    for (const m of models) {
      const mul = fmtMultiplier(m, s);
      const isCurrent = state.model === m.id;
      const nameCell = ui.h("div");
      nameCell.append(ui.h("div", null, m.name || m.id));
      const sub = ui.h("div", "dim", m.id);
      sub.style.fontSize = "12px";
      sub.style.opacity = "0.65";
      nameCell.append(sub);
      if (m.description) nameCell.title = m.description;
      const mulPill = ui.pill(mul.text, mul.free ? "on" : "plain");
      if (mul.promo) mulPill.title = mul.promo;
      const btn = ui.button(isCurrent ? s.selected : s.select, {
        size: "sm",
        variant: isCurrent ? "plain" : "primary",
        onClick: async () => {
          const off = ui.disable(btn);
          try {
            const r = await ctx.invoke("select", [m.id]);
            if (r?.ok) {
              state.model = m.id;
              ui.toast(`${m.id} \u2713`);
              renderChips();
              renderTable();
            } else {
              ui.toast(r?.error ?? "failed", "bad");
            }
          } catch (err) {
            ui.toast(String(err?.message ?? err), "bad");
          } finally {
            off.dispose();
          }
        }
      });
      if (isCurrent) btn.disabled = true;
      table.addRow([
        nameCell,
        mulPill,
        m.contextWindow ? String(m.contextWindow) : "\u2014",
        m.reasoning?.supportedEfforts?.join(" / ") ?? "\u2014",
        btn
      ]);
    }
  }
  async function load() {
    state = await ctx.invoke("state");
    renderChips();
    renderTable();
    errLine.textContent = state?.lastError ?? "";
  }
  refreshBtn.addEventListener("click", async () => {
    const off = ui.disable(refreshBtn);
    refreshBtn.textContent = s.refreshing;
    try {
      const r = await ctx.invoke("refresh");
      if (r?.ok) {
        ui.toast(`${r.count} ${s.models}`);
        await load();
      } else {
        errLine.textContent = r?.error ?? "failed";
        ui.toast(r?.error ?? "failed", "bad");
      }
    } catch (err) {
      errLine.textContent = String(err?.message ?? err);
    } finally {
      refreshBtn.textContent = s.refresh;
      off.dispose();
    }
  });
  ctx.stream({
    message: () => load().catch(() => {
    })
  });
  load().catch((err) => {
    errLine.textContent = String(err?.message ?? err);
  });
}
function mountAccount(ctx) {
  const s = strings(ctx);
  const { ui } = ctx;
  const sheet = ui.sheet({ title: s.account === "\u8D26\u53F7" ? "WorkBuddy \u8D26\u53F7" : "WorkBuddy account" });
  ctx.root.append(sheet.el);
  const kvWrap = ui.h("div");
  sheet.body.append(kvWrap);
  const errLine = ui.msgline();
  sheet.body.append(errLine);
  const actions = ui.actions();
  const rediscoverBtn = ui.button(s.rediscover);
  const creditsBtn = ui.button(s.queryCredits);
  actions.append(rediscoverBtn, creditsBtn);
  sheet.body.append(actions);
  const tokenSection = ui.section(s.pasteToken);
  const tokenInput = ui.input({ type: "password", placeholder: "access token", cls: "mono" });
  const saveBtn = ui.button(s.saveToken, { variant: "primary" });
  const clearBtn = ui.button(s.clearToken, { variant: "danger", size: "sm" });
  const tokenRow = ui.rowbar();
  tokenRow.append(tokenInput, saveBtn, clearBtn);
  tokenSection.append(tokenRow);
  sheet.body.append(tokenSection);
  let state = null;
  function render() {
    const rows = [
      { k: s.status, v: state?.authed ? s.authed : s.noAuth },
      { k: s.source, v: state?.tokenSource ?? "\u2014" },
      { k: s.token, v: state?.tokenMask ?? "\u2014" },
      { k: s.account, v: state?.account?.name ?? "\u2014" },
      { k: s.region, v: state?.region ?? "\u2014" },
      { k: s.upstream, v: state?.baseUrl ?? "\u2014" }
    ];
    if (state?.lastError) rows.push({ k: s.lastError, v: state.lastError });
    kvWrap.replaceChildren(ui.kv(rows));
  }
  async function load() {
    state = await ctx.invoke("state");
    render();
  }
  rediscoverBtn.addEventListener("click", async () => {
    const off = ui.disable(rediscoverBtn);
    try {
      const r = await ctx.invoke("rediscover");
      if (r?.authed) ui.toast(s.authed);
      else ui.toast(r?.error ?? s.noAuth, "bad");
      await load();
    } finally {
      off.dispose();
    }
  });
  creditsBtn.addEventListener("click", async () => {
    const off = ui.disable(creditsBtn);
    try {
      const r = await ctx.invoke("credits");
      if (r?.ok) {
        const lines = [`${s.credits}: ${r.total ?? "\u2014"}`];
        for (const p of (r.packages ?? []).slice(0, 20)) lines.push(`${p.name}: ${p.remain}`);
        ui.drawer(s.credits, lines.join("\n"));
      } else {
        ui.toast(`${s.creditsFail}: ${r?.error ?? ""}`, "bad");
      }
    } catch (err) {
      ui.toast(String(err?.message ?? err), "bad");
    } finally {
      off.dispose();
    }
  });
  saveBtn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    const off = ui.disable(saveBtn, tokenInput);
    try {
      const r = await ctx.invoke("setToken", [token]);
      if (r?.ok) {
        tokenInput.value = "";
        ui.toast(s.tokenSaved);
        await load();
      } else {
        ui.toast(r?.error ?? "failed", "bad");
      }
    } finally {
      off.dispose();
    }
  });
  clearBtn.addEventListener("click", async () => {
    await ctx.invoke("clearToken");
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
  const hostLine = ui.msgline();
  const hostBar = ui.actions();
  const repairBtn = ui.button(s.repair, {
    size: "sm",
    variant: "plain",
    onClick: async () => {
      repairBtn.disabled = true;
      hostLine.textContent = s.repairing;
      try {
        const r = await ctx.invoke("repair");
        hostLine.textContent = r?.ok ? s.repaired : `${s.repairFail}\uFF1A${r?.error ?? r?.hostUi?.reason ?? ""}`;
        ui.toast(r?.ok ? s.repaired : s.repairFail, r?.ok ? "ok" : "bad");
        await load();
      } catch (err) {
        hostLine.textContent = `${s.repairFail}\uFF1A${String(err?.message ?? err)}`;
        ui.toast(s.repairFail, "bad");
      } finally {
        repairBtn.disabled = false;
      }
    }
  });
  hostBar.append(repairBtn);
  function apply(r) {
    if (!r) return;
    box.setChecked(r.prefer === true);
    statusLine.textContent = r.running ? s.procRunning : s.procStopped;
    const host = r.hostUi;
    if (!host) {
      hostLine.textContent = s.hostUnknown;
      hostBar.style.display = "none";
      return;
    }
    hostLine.textContent = host.ok ? s.hostOk : `${s.hostBroken}\uFF08${host.label ?? host.reason}\uFF09`;
    hostBar.style.display = host.ok ? "none" : "";
  }
  const box = ui.checkbox(s.priorityLabel, {
    checked: false,
    title: s.priorityDesc,
    onChange: async (checked) => {
      try {
        const r = await ctx.invoke("set", [checked]);
        if (r?.ok) {
          apply(r);
          ui.toast(checked ? s.enabledOn : s.enabledOff);
        } else {
          apply(r);
          box.setChecked(false);
          ui.toast(r?.error ?? s.noProcess, "bad");
        }
      } catch (err) {
        box.setChecked(false);
        ui.toast(String(err?.message ?? err), "bad");
      }
    }
  });
  sheet.body.append(box.el, statusLine, hostLine, hostBar);
  async function load() {
    apply(await ctx.invoke("state"));
  }
  ctx.stream({
    message: () => load().catch(() => {
    })
  });
  load().catch((err) => {
    statusLine.textContent = String(err?.message ?? err);
  });
}
function fmtNum(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "\u2014";
  return String(Math.round(n * 100) / 100);
}
function mountUsage(ctx) {
  const s = strings(ctx);
  const { ui } = ctx;
  const sheet = ui.sheet({ title: `${s.usageTitle} \xB7 WorkBuddy`, desc: s.usageDesc });
  ctx.root.append(sheet.el);
  const bar = ui.rowbar();
  const refreshBtn = ui.button(s.usageRefresh, { variant: "primary", size: "sm" });
  const clearBtn = ui.button(s.usageClear, { variant: "plain", size: "sm" });
  const todayChip = ui.chip("", "accent");
  const balanceChip = ui.chip("", "plain");
  bar.append(refreshBtn, clearBtn, todayChip, balanceChip);
  sheet.body.append(bar);
  const errLine = ui.msgline();
  sheet.body.append(errLine);
  const overview = ui.table({
    head: ["", s.metricCalls, s.metricCredit, s.metricInput, s.metricOutput],
    maxHeight: "220px"
  });
  sheet.body.append(overview.el);
  const modelSection = ui.section(s.byModel);
  const modelTable = ui.table({
    head: [s.colModel, s.metricCalls, s.metricCredit, s.metricInput, s.metricOutput],
    maxHeight: "260px"
  });
  modelSection.append(modelTable.el);
  sheet.body.append(modelSection);
  const pkgSection = ui.section(s.balanceTitle);
  const pkgTable = ui.table({
    head: [s.colPkgName, s.colPkgRemain, s.colPkgUsed, s.colPkgCycle],
    maxHeight: "220px"
  });
  pkgSection.append(pkgTable.el);
  sheet.body.append(pkgSection);
  const promoSection = ui.section(s.promosTitle);
  const promoWrap = ui.h("div");
  promoSection.append(promoWrap);
  sheet.body.append(promoSection);
  const recentSection = ui.section(s.recentTitle);
  const recentTable = ui.table({
    head: [s.colTime, s.colModel, s.colTokens, s.metricCredit, s.colDuration],
    maxHeight: "300px"
  });
  recentSection.append(recentTable.el);
  sheet.body.append(recentSection);
  let state = null;
  function spanRow(label, bucket) {
    const b = bucket ?? {};
    return [label, String(b.calls ?? 0), fmtNum(b.credit), fmtNum(b.prompt), fmtNum(b.completion)];
  }
  function render() {
    const totals = state?.summary?.totals ?? {};
    todayChip.textContent = `${s.todayCredit}: ${fmtNum(totals.today?.credit)} \xB7 ${s.todayTokens}: ${fmtNum(
      (totals.today?.prompt ?? 0) + (totals.today?.completion ?? 0)
    )}`;
    balanceChip.textContent = `${s.balanceTitle}: ${fmtNum(state?.balance?.total)}`;
    const spans = [spanRow(s.spanToday, totals.today), spanRow(s.spanWeek, totals.week), spanRow(s.spanMonth, totals.month)];
    overview.clear();
    for (const row of spans) overview.addRow(row);
    const byModel = state?.summary?.byModel ?? [];
    modelTable.clear(byModel.length > 0 ? void 0 : s.noData);
    for (const m of byModel) {
      modelTable.addRow([m.model, String(m.calls ?? 0), fmtNum(m.credit), fmtNum(m.prompt), fmtNum(m.completion)]);
    }
    const packages = state?.balance?.packages ?? [];
    pkgTable.clear(packages.length > 0 ? void 0 : s.noData);
    for (const p of packages) {
      const cycle = [p.cycleStart, p.cycleEnd].filter(Boolean).join(" \u2192 ") || "\u2014";
      pkgTable.addRow([p.name ?? "\u2014", fmtNum(p.remain), fmtNum(p.used), cycle]);
    }
    promoWrap.replaceChildren();
    const promos = state?.promos ?? [];
    if (promos.length === 0) {
      promoWrap.append(ui.h("div", "dim", s.noData));
    }
    for (const p of promos) {
      const row = ui.h("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.padding = "4px 0";
      row.append(ui.pill(p.badge || p.id, p.active ? "on" : "plain"));
      const text = [
        p.discountText || p.hoverText,
        p.windowText || p.absoluteText,
        (p.models ?? []).join(" / "),
        p.active ? s.promoActive : s.promoSoon
      ].filter(Boolean).join(" \xB7 ");
      const label = ui.h("div", "dim", text);
      label.style.fontSize = "12px";
      if (p.hoverText) label.title = p.hoverText;
      row.append(label);
      promoWrap.append(row);
    }
    const recent = state?.summary?.recent ?? [];
    recentTable.clear(recent.length > 0 ? void 0 : s.noData);
    for (const r of recent) {
      const when = (() => {
        try {
          return new Date(r.ts).toLocaleString();
        } catch {
          return String(r.ts);
        }
      })();
      recentTable.addRow([
        when,
        r.model ?? "\u2014",
        fmtNum(r.totalTokens ?? (r.promptTokens ?? 0) + (r.completionTokens ?? 0)),
        r.ok === false ? "\u2014" : fmtNum(r.credit),
        typeof r.durationMs === "number" ? `${r.durationMs} ms` : "\u2014"
      ]);
    }
  }
  async function load() {
    state = await ctx.invoke("state");
    errLine.textContent = state?.ok === false ? state.error ?? "" : "";
    render();
  }
  refreshBtn.addEventListener("click", async () => {
    const off = ui.disable(refreshBtn);
    refreshBtn.textContent = s.refreshing;
    try {
      state = await ctx.invoke("refresh");
      render();
      ui.toast(`${s.balanceTitle}: ${fmtNum(state?.balance?.total)}`);
    } catch (err) {
      errLine.textContent = String(err?.message ?? err);
      ui.toast(String(err?.message ?? err), "bad");
    } finally {
      refreshBtn.textContent = s.usageRefresh;
      off.dispose();
    }
  });
  clearBtn.addEventListener("click", async () => {
    const off = ui.disable(clearBtn);
    try {
      state = await ctx.invoke("clear");
      render();
      ui.toast(s.usageCleared);
    } catch (err) {
      ui.toast(String(err?.message ?? err), "bad");
    } finally {
      off.dispose();
    }
  });
  ctx.stream({
    message: () => load().catch(() => {
    })
  });
  load().catch((err) => {
    errLine.textContent = String(err?.message ?? err);
  });
}
var client_default = {
  panels: {
    models: { mount: mountModels },
    account: { mount: mountAccount },
    priority: { mount: mountPriority },
    usage: { mount: mountUsage }
  }
};
export {
  client_default as default
};
