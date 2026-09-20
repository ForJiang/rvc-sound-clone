/**
 * 应用入口：启动引导、hash 路由、主题与语言、顶栏状态灯。
 */

import { initI18n, t, onLangChange, setLang, getLang, applyI18n } from './i18n.js';
import { $, $$, toast } from './ui.js';
import { initState, state, refreshEngineChip } from './state.js';
import { storageStatus } from './store.js';
import { initTheme } from './views/settings.js';
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
  const themeBtn = document.getElementById('themeBtn');

  const syncLangBtn = () => { if (langBtn) langBtn.textContent = getLang() === 'zh' ? 'EN' : '中'; };
  syncLangBtn();

  langBtn?.addEventListener('click', () => setLang(getLang() === 'zh' ? 'en' : 'zh'));
  onLangChange(() => {
    syncLangBtn();
    applyI18n(document);
    refreshEngineChip();   // 用当前语言重绘状态灯
    renderRoute();
  });

  themeBtn?.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem('rvc.theme', cur); } catch { /* ignore */ }
  });

  document.getElementById('engineChip')?.addEventListener('click', () => {
    location.hash = '#/settings';
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
  initTheme();
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
