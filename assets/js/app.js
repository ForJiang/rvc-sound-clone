/**
 * 应用入口：启动引导、hash 路由、背景特效与语言、顶栏状态灯。
 */

import { initI18n, t, onLangChange, setLang, getLang, applyI18n } from './i18n.js';
import { $, $$, toast } from './ui.js';
import { initState, state, refreshEngineChip } from './state.js';
import { storageStatus } from './store.js';
import { startLiquidBackground } from './liquid-bg.js';
import { viewConvert } from './views/convert.js';
import { viewModels } from './views/models.js';
import { viewSettings } from './views/settings.js';
import { viewHelp } from './views/help.js';

const ROUTES = {
  '/convert': viewConvert,
  '/models': viewModels,
  '/settings': viewSettings,
  '/help': viewHelp,
};

let currentCleanup = null;

/**
 * 当前页面构建对应的提交号；与 assets/version.json 比对判断是否有新版。
 * 发版时同步更新这里的值和 assets/version.json 的 version 字段。
 */
const BUILD = 'aa2ccc31';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;   // 5 分钟轮询一次
let updateNotified = false;

/**
 * 轮询 version.json（带 cache-busting 参数，确保拿到最新内容）。
 * 发现新版本时弹一次提示，用户点“立即刷新”即加载新版。
 */
function watchForUpdates() {
  const check = async () => {
    try {
      const res = await fetch('assets/version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.version || data.version === BUILD || updateNotified) return;
      updateNotified = true;
      showUpdateToast(data.version);
    } catch {
      /* 网络抖动时静默跳过，下次轮询再试 */
    }
  };
  setTimeout(() => { check(); setInterval(check, CHECK_INTERVAL_MS); }, 4000);
}

function showUpdateToast(version) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = 'toast ok update-toast';
  node.innerHTML = '';
  const ico = document.createElement('span');
  ico.className = 't-ico';
  ico.textContent = '↻';
  const body = document.createElement('div');
  body.className = 't-body';
  const title = document.createElement('div');
  title.className = 't-title';
  title.textContent = t('update.available');
  const msg = document.createElement('div');
  msg.className = 't-msg';
  msg.textContent = t('update.hint');
  const btn = document.createElement('button');
  btn.className = 'btn primary sm';
  btn.type = 'button';
  btn.textContent = t('update.reload');
  btn.style.marginTop = '8px';
  btn.addEventListener('click', () => location.reload());
  const close = document.createElement('button');
  close.className = 'icon-btn';
  close.type = 'button';
  close.setAttribute('aria-label', t('common.close'));
  close.textContent = '✕';
  close.style.marginLeft = '8px';
  close.addEventListener('click', () => node.remove());
  body.append(title, msg, btn);
  node.append(ico, body, close);
  host.append(node);
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const key = '/' + (hash.split('?')[0] || 'convert');
  return ROUTES[key] ? key : '/convert';
}

async function renderRoute() {
  const key = parseRoute();
  const view = ROUTES[key];
  const root = $('#view');
  try {
    currentCleanup?.();
  } catch (err) {
    console.error('[cleanup]', err);   // 清理失败不能阻断路由切换
  }
  currentCleanup = null;
  root.replaceChildren();
  $$('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.route === key.slice(1)));
  document.title = `${routeTitle(key)} · RVC Sound Clone`;
  try {
    const handle = await view(root);
    currentCleanup = handle?.destroy || null;
  } catch (err) {
    console.error('[view]', err);
    root.append(
      Object.assign(document.createElement('div'), {
        className: 'notice err',
        textContent: `${t('convert.failed', { msg: err.message })}`,
      }),
    );
  }
}

/* --------------------------- 顶栏交互 --------------------------- */

function wireTopbar() {
  const langBtn = document.getElementById('langBtn');

  const syncLangBtn = () => { if (langBtn) langBtn.textContent = getLang() === 'zh' ? 'EN' : '中'; };
  syncLangBtn();

  langBtn?.addEventListener('click', () => setLang(getLang() === 'zh' ? 'en' : 'zh'));
  onLangChange(() => {
    syncLangBtn();
    applyI18n(document);
    refreshEngineChip();   // 用当前语言重绘状态灯
    renderRoute();
  });

  document.getElementById('engineChip')?.addEventListener('click', () => {
    location.hash = '#/settings';
  });

  // 品牌区点击即刷新网页：hash 路由下重复点同一链接不会触发 hashchange，
  // 所以显式回首页再 reload，让点击始终有"刷新"的反馈
  document.querySelector('a.brand')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (location.hash !== '#/convert') location.hash = '#/convert';
    location.reload();
  });
}

function routeTitle(key) {
  return key === '/models' ? t('nav.models')
    : key === '/settings' ? t('nav.settings')
      : key === '/help' ? t('nav.help')
        : t('nav.convert');
}

/* ----------------------------- 启动 ----------------------------- */

async function boot() {
  // 液态金属背景：失败/不支持时静默保留 CSS 渐变兜底
  startLiquidBackground(document.getElementById('liquidBg'));

  initI18n();
  applyI18n(document);

  const bootText = document.getElementById('bootText');
  const bootBar = document.getElementById('bootBar');
  if (bootText) bootText.textContent = t('common.loading');

  wireTopbar();

  await initState();
  await refreshEngineChip();
  if (bootBar) bootBar.style.width = '70%';

  window.addEventListener('hashchange', renderRoute);
  await renderRoute();
  if (bootBar) bootBar.style.width = '100%';
  document.getElementById('boot')?.classList.add('hidden');

  // 存储可用性：不可用时明确告知，而不是让用户以为模型已保存
  storageStatus().then((st) => {
    if (!st.ok) toast(t('storage.degraded', { reason: st.error }), { type: 'warn', duration: 9000 });
  });

  watchForUpdates();

  if (!navigator.mediaDevices?.getUserMedia) {
    $('#toasts')?.append(
      Object.assign(document.createElement('div'), {
        className: 'toast warn',
        textContent: t('toast.browserOld'),
      }),
    );
  }
}

boot().catch((err) => {
  console.error('[boot]', err);
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'boot-text';
    p.textContent = '启动失败：' + (err?.message || err);
    bootEl.append(p);
  }
});
