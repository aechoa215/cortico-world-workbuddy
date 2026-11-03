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
    procRunning: "WorkBuddy \u4E3B\u8FDB\u7A0B\uFF1A\u8FD0\u884C\u4E2D",
    procStopped: "WorkBuddy \u4E3B\u8FDB\u7A0B\uFF1A\u672A\u68C0\u6D4B\u5230",
    usageTitle: "\u7528\u91CF\u4E0E\u6210\u672C",
    usageDesc: "\u7ECF\u7531 WorkBuddy \u6D88\u8017\u7684 token \u4E0E\u79EF\u5206\uFF08\u672C\u5730\u8BB0\u8D26\uFF09\uFF1A\u79EF\u5206\u53D6\u4E0A\u6E38\u6BCF\u6B21\u8C03\u7528\u56DE\u4F20\u7684\u771F\u5B9E\u6263\u8D39\uFF08\u53EF\u80FD\u4E3A 0\uFF09\uFF0Ctoken \u53D6\u540C\u4E00\u6BB5 SSE \u7684 usage\uFF1B\u500D\u7387\u6309\u76EE\u5F55 + \u9650\u65F6\u4F18\u60E0\u5B9E\u65F6\u8BA1\u7B97\u3002",
    usageRefresh: "\u5237\u65B0\u4F59\u989D",
    usageClear: "\u6E05\u7A7A\u672C\u5730\u8D26\u672C",
    usageCleared: "\u672C\u5730\u8D26\u672C\u5DF2\u6E05\u7A7A",
    metricCalls: "\u8C03\u7528",
    metricFailed: "\u5931\u8D25",
    metricCredit: "\u79EF\u5206",
    metricInput: "\u8F93\u5165 tok",
    metricOutput: "\u8F93\u51FA tok",
    metricCached: "\u7F13\u5B58\u547D\u4E2D",
    metricTotal: "\u5171 tok",
    spanToday: "\u4ECA\u5929",
    spanWeek: "\u8FD1 7 \u5929",
    spanMonth: "\u8FD1 30 \u5929",
    spanAll: "\u5168\u90E8",
    byModel: "\u6309\u6A21\u578B\uFF08\u8FD1 30 \u5929\uFF09",
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
    todayTokens: "\u4ECA\u65E5 token",
    colSafety: "\u5408\u89C4",
    safetySafe: "\u5B89\u5168\u6E05\u5355",
    safetyCaution: "\u5B89\u5168\u6E05\u5355\xB7\u8C28\u614E",
    showAllModels: "\u663E\u793A\u5168\u90E8\u6A21\u578B\uFF08\u542B\u4E0D\u5EFA\u8BAE\u9879\uFF09",
    unsafePick: "\u8BE5\u6A21\u578B\u4E0D\u5728\u5B89\u5168\u6E05\u5355\u5185\uFF0C\u5DF2\u62D2\u7EDD\u9009\u62E9",
    safeOnlyOn: "\u4EC5\u8C03\u7528\u5B89\u5168\u6E05\u5355\u6A21\u578B",
    safeOnlyOff: "safeOnly \u5DF2\u5173\u95ED\uFF1A\u5168\u90E8\u6A21\u578B\u53EF\u8C03\u7528\uFF08\u542B WorkBuddy \u4E0D\u5EFA\u8BAE\u5916\u90E8\u8C03\u7528\u7684\u9879\uFF09"
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
    procRunning: "WorkBuddy process: running",
    procStopped: "WorkBuddy process: not detected",
    usageTitle: "Usage & cost",
    usageDesc: "Tokens and credits spent through WorkBuddy (locally recorded): credits are the per-call figure the upstream returns (may be 0), tokens come from the same SSE usage block; multipliers combine the catalog with time-limited offers in real time.",
    usageRefresh: "Refresh balance",
    usageClear: "Clear local ledger",
    usageCleared: "Local ledger cleared",
    metricCalls: "Calls",
    metricFailed: "Failed",
    metricCredit: "Credits",
    metricInput: "Input tok",
    metricOutput: "Output tok",
    metricCached: "Cached",
    metricTotal: "Total tok",
    spanToday: "Today",
    spanWeek: "Last 7 days",
    spanMonth: "Last 30 days",
    spanAll: "All",
    byModel: "By model (last 30 days)",
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
    todayTokens: "Tokens today",
    colSafety: "Policy",
    safetySafe: "Safe list",
    safetyCaution: "Safe list \xB7 caution",
    showAllModels: "Show all models (including discouraged ones)",
    unsafePick: "This model is outside the safe list and cannot be selected",
    safeOnlyOn: "Safe-list only",
    safeOnlyOff: "safeOnly is off: every model is callable (including ones WorkBuddy discourages)"
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
    desc: s.colModel === "\u6A21\u578B" ? "\u9ED8\u8BA4\u53EA\u5217 WorkBuddy \u516C\u5F00\u5BF9\u8BDD\u6A21\u578B\uFF08\u5B89\u5168\u6E05\u5355\uFF09\uFF1B\u52FE\u9009\u300C\u663E\u793A\u5168\u90E8\u6A21\u578B\u300D\u53EF\u67E5\u770B\u88AB\u6392\u9664\u9879\u53CA\u5176\u7406\u7531\u3002" : 'Only WorkBuddy public chat models are listed by default; tick "Show all models" to see excluded ones and why.'
  });
  ctx.root.append(sheet.el);
  const head = ui.rowbar();
  const refreshBtn = ui.button(s.refresh, { variant: "primary" });
  const stateChip = ui.chip("", "plain");
  const procChip = ui.chip("", "plain");
  const currentChip = ui.chip("", "accent");
  const allBox = ui.checkbox(s.showAllModels, { checked: false });
  head.append(refreshBtn, stateChip, procChip, currentChip, allBox.el);
  sheet.body.append(head);
  const errLine = ui.msgline();
  sheet.body.append(errLine);
  const table = ui.table({
    head: [s.colModel, s.colSafety, s.colMultiplier, s.colContext, s.colReasoning, s.colAction],
    maxHeight: "calc(100vh - 320px)"
  });
  sheet.body.append(table.el);
  let state = null;
  function renderChips() {
    const models = state?.models ?? [];
    const safeCount = models.filter((m) => m.safety?.allow).length;
    stateChip.textContent = `${s.lastRefresh}: ${fmtTs(state?.catalogAt, s)} \xB7 ${safeCount}/${models.length} ${s.models} \xB7 ${state?.safeOnly === false ? s.safeOnlyOff : s.safeOnlyOn}`;
    currentChip.textContent = `${s.currentModel}: ${state?.model || "\u2014"}`;
    procChip.textContent = state?.running ? s.procRunning : s.procStopped;
  }
  function pickable(m) {
    if (state?.safeOnly === false) return true;
    return m.safety?.allow !== false;
  }
  function renderTable() {
    const all = state?.models ?? [];
    const models = allBox.checked ? all : all.filter((m) => m.safety?.allow);
    table.clear(models.length ? void 0 : s.empty);
    for (const m of models) {
      const mul = fmtMultiplier(m, s);
      const isCurrent = state.model === m.id;
      const safety = m.safety ?? {};
      const nameCell = ui.h("div");
      nameCell.append(ui.h("div", null, m.name || m.id));
      const sub = ui.h("div", "dim", m.id);
      sub.style.fontSize = "12px";
      sub.style.opacity = "0.65";
      nameCell.append(sub);
      if (m.description) nameCell.title = m.description;
      const safePill = ui.pill(
        safety.label ?? "\u2014",
        safety.allow ? safety.caution ? "plain" : "on" : "plain"
      );
      if (safety.reason) safePill.title = safety.reason;
      if (!safety.allow) {
        safePill.style.opacity = "0.6";
        nameCell.style.opacity = "0.6";
      }
      const mulPill = ui.pill(mul.text, mul.free ? "on" : "plain");
      if (mul.promo) mulPill.title = mul.promo;
      const allowed = pickable(m);
      const btn = ui.button(isCurrent ? s.selected : s.select, {
        size: "sm",
        variant: isCurrent ? "plain" : "primary",
        onClick: async () => {
          if (!allowed) {
            ui.toast(`${s.unsafePick}${safety.reason ? `\uFF1A${safety.reason}` : ""}`, "bad");
            return;
          }
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
      if (!allowed) {
        btn.disabled = true;
        btn.title = safety.reason ?? "";
      }
      table.addRow([
        nameCell,
        safePill,
        mulPill,
        m.contextWindow ? String(m.contextWindow) : "\u2014",
        m.reasoning?.supportedEfforts?.join(" / ") ?? "\u2014",
        btn
      ]);
    }
  }
  allBox.input.addEventListener("change", () => {
    renderChips();
    renderTable();
  });
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
function fmtNum(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "\u2014";
  return String(Math.round(n * 100) / 100);
}
function fmtCredit(bucket) {
  const known = fmtNum(bucket?.credit);
  return (bucket?.creditUnknown ?? 0) > 0 ? `${known} + ?` : known;
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
    head: [
      "",
      s.metricCalls,
      s.metricFailed,
      s.metricCredit,
      s.metricInput,
      s.metricOutput,
      s.metricCached,
      s.metricTotal
    ],
    maxHeight: "220px"
  });
  sheet.body.append(overview.el);
  const modelSection = ui.section(s.byModel);
  const modelTable = ui.table({
    head: [s.colModel, s.metricCalls, s.metricFailed, s.metricCredit, s.metricInput, s.metricOutput, s.metricTotal],
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
    return [
      label,
      String(b.calls ?? 0),
      String(b.failed ?? 0),
      fmtCredit(b),
      fmtNum(b.prompt),
      fmtNum(b.completion),
      fmtNum(b.cached),
      fmtNum(b.total)
    ];
  }
  function render() {
    const totals = state?.summary?.totals ?? {};
    todayChip.textContent = `${s.todayCredit}: ${fmtCredit(totals.today)} \xB7 ${s.todayTokens}: ${fmtNum(
      (totals.today?.prompt ?? 0) + (totals.today?.completion ?? 0)
    )}`;
    balanceChip.textContent = `${s.balanceTitle}: ${fmtNum(state?.balance?.total)}`;
    const spans = [
      spanRow(s.spanToday, totals.today),
      spanRow(s.spanWeek, totals.week),
      spanRow(s.spanMonth, totals.month),
      spanRow(s.spanAll, totals.all)
    ];
    overview.clear();
    for (const row of spans) overview.addRow(row);
    const byModel = state?.summary?.byModel ?? [];
    modelTable.clear(byModel.length > 0 ? void 0 : s.noData);
    for (const m of byModel) {
      modelTable.addRow([
        m.model,
        String(m.calls ?? 0),
        String(m.failed ?? 0),
        fmtCredit(m),
        fmtNum(m.prompt),
        fmtNum(m.completion),
        fmtNum(m.total)
      ]);
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
        // 账本里的字段名就是 total/prompt/completion（不是 totalTokens），
        // 以前这里恒读出 0，最近调用表的 token 列一直是 0。
        fmtNum(r.total ?? (r.prompt ?? 0) + (r.completion ?? 0)),
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
    usage: { mount: mountUsage }
  }
};
export {
  client_default as default
};
