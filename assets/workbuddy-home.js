/**
 * 「中转站优先」开始页按钮的注入脚本（Coopanion 控制台窗口 /coopanion/ 下运行）。
 *
 * 设计原则：只加一块 DOM，尽量不碰别人。
 * - 插件没装 / World 没启用时，脚本什么也不做（连行都不建）。
 * - 任何异常都在本地吞掉并打 console.warn，绝不让主界面挂掉。
 * - 状态与「World 扩展 · WorkBuddy 桥接 · 是否启用Workbuddy」开关同源：都调用
 *   world:workbuddy 的 priority 面板 state / set。
 *
 * 安装：放在 Coopanion 的 build/console/ 下，并在 index.html 加一行
 *   <script type="module" src="./workbuddy-home.js"></script>
 * 卸载：删掉这个文件与那一行即可；插件被卸载时脚本会自动发现自己没事可做。
 */

const PAGE_ID = 'world:workbuddy';
const PANEL_ID = 'priority';
const ROW_LABEL = '中转站优先：';
const NO_PROC_MSG = '未检测到Workbuddy';
const POLL_MS = 3000;

// WorkBuddy 桌面端图标，从 C:\Program Files\WorkBuddy\WorkBuddy.exe 的关联图标导出（32x32 PNG）。
const ICON = 'data:image/png;base64,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';

const log = (...args) => {
  if (window.__workbuddyHomeDebug) console.log('[workbuddy-home]', ...args);
};
const warn = (err) => console.warn('[workbuddy-home]', err);

/** 当前状态（服务端是唯一真相，这里只是缓存）。 */
const state = { available: false, prefer: false, running: false, model: '' };

let rowLabel = null;
let rowBox = null;
let button = null;
let mark = null;
let text = null;
let toastTimer = null;
let busy = false;

function panelUrl(method) {
  return `/api/webui/providers/${encodeURIComponent(PAGE_ID)}/panels/${encodeURIComponent(PANEL_ID)}/${encodeURIComponent(method)}`;
}

async function callPanel(method, args) {
  const res = await fetch(panelUrl(method), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: args ?? [] }),
  });
  if (!res.ok) throw new Error(`面板 ${method} 返回 ${res.status}`);
  return res.json();
}

async function worldAvailable() {
  try {
    const res = await fetch('/api/worlds', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const body = await res.json();
    const list = Array.isArray(body) ? body : Array.isArray(body?.worlds) ? body.worlds : [];
    return list.some((w) => {
      const id = String(w?.id ?? w?.worldId ?? '');
      if (id !== 'workbuddy') return false;
      const status = String(w?.status ?? '');
      return !status || status === 'active' || status === 'loaded' || status === 'mounted';
    });
  } catch (err) {
    warn(err);
    return false;
  }
}

function paint() {
  if (!button) return;
  const on = !!(state.prefer && state.running);
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.title = on
    ? `已开启：桌宠每轮先问 WorkBuddy（${state.model || '默认模型'}）`
    : state.running
      ? '点一下让桌宠优先走 WorkBuddy 的模型'
      : '未检测到 WorkBuddy 主进程';
}

function toast(message) {
  try {
    let el = document.getElementById('workbuddy-home-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'workbuddy-home-toast';
      el.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:28px',
        'transform:translateX(-50%)',
        'z-index:2147483000',
        'padding:9px 16px',
        'border-radius:999px',
        'font-size:13px',
        'line-height:1.2',
        'color:var(--foreground,#111)',
        'background:var(--surface,#fff)',
        'border:1px solid var(--border,rgba(0,0,0,.16))',
        'box-shadow:0 6px 24px rgba(0,0,0,.16)',
        'pointer-events:none',
        'transition:opacity .18s',
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (el) el.style.opacity = '0';
    }, 2200);
  } catch (err) {
    warn(err);
  }
}

function ensureRow() {
  const picker = document.querySelector('.home .home-picker');
  if (!picker) return null;
  if (rowBox && picker.contains(rowBox)) return rowBox;

  // 开始页每次重新渲染都会丢这块 DOM，整套重建。
  rowLabel = document.createElement('div');
  rowLabel.className = 'home-pickerlabel';
  rowLabel.textContent = ROW_LABEL;

  rowBox = document.createElement('div');
  rowBox.className = 'home-vendors';
  rowBox.dataset.workbuddyHome = '1';

  button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-vendor';
  button.dataset.workbuddyHomeButton = '1';

  mark = document.createElement('span');
  mark.className = 'home-vendormark';
  if (ICON.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = ICON;
    img.alt = '';
    img.style.cssText = 'width:17px;height:17px;display:block;border-radius:3px';
    mark.append(img);
  }

  text = document.createElement('span');
  text.textContent = 'WorkBuddy';

  button.append(mark, text);
  button.addEventListener('click', onClick);
  rowBox.append(button);

  picker.append(rowLabel, rowBox);
  paint();
  log('injected');
  return rowBox;
}

function removeRow() {
  try {
    rowLabel?.remove();
    rowBox?.remove();
  } catch (err) {
    warn(err);
  }
  rowLabel = rowBox = button = mark = text = null;
}

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    state.available = await worldAvailable();
    if (!state.available) {
      removeRow();
      return;
    }
    const r = await callPanel('state');
    if (r && typeof r === 'object') {
      state.prefer = r.prefer === true;
      state.running = r.running === true;
      state.model = typeof r.model === 'string' ? r.model : '';
    }
    if (document.querySelector('.home .home-picker')) ensureRow();
    paint();
  } catch (err) {
    // World 不在 / 面板报错：安静收场，下一轮再试。
    log('refresh failed', err);
  } finally {
    busy = false;
  }
}

async function onClick(event) {
  event?.preventDefault?.();
  if (!button) return;
  try {
    // 以服务端为准：先问一次当前状态，避免本地缓存过期导致「点了没反应」或「点了又开」。
    const snap = await callPanel('state');
    if (snap && typeof snap === 'object') {
      state.prefer = snap.prefer === true;
      state.running = snap.running === true;
      state.model = typeof snap.model === 'string' ? snap.model : state.model;
    }
    const target = !(state.prefer && state.running);
    button.disabled = true;
    const r = await callPanel('set', [target]);
    if (r?.ok) {
      state.prefer = r.prefer === true;
      state.running = r.running === true;
      state.model = typeof r.model === 'string' ? r.model : state.model;
      paint();
      if (state.prefer) toast(`已开启：桌宠优先走 WorkBuddy（${state.model || '默认模型'}）`);
      else toast('已关闭：跳过 WorkBuddy');
    } else {
      // 未检测到主进程（或其它失败）：按钮保持熄灭，并把原因说出来。
      state.prefer = r?.prefer === true;
      state.running = r?.running === true;
      paint();
      toast(r?.reason === 'no-process' || !r?.running ? NO_PROC_MSG : String(r?.error ?? '切换失败'));
    }
  } catch (err) {
    warn(err);
    paint();
    toast('切换失败');
  } finally {
    if (button) button.disabled = false;
  }
}

function start() {
  // 先确认插件在，再挂监听；没装就直接退出，省得白跑。
  void refresh();

  const observer = new MutationObserver(() => {
    if (document.querySelector('.home .home-picker')) {
      if (!rowBox || !document.contains(rowBox)) void refresh();
    } else if (rowBox && !document.querySelector('.home')) {
      removeRow();
    }
  });
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (err) {
    warn(err);
  }

  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void refresh();
  }, POLL_MS);
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
} catch (err) {
  warn(err);
}
