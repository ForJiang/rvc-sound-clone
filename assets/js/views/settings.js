/**
 * 设置页：引擎选择、本地服务地址、音频输出、外观与数据管理。
 */

import { t, onLangChange, setLang, getLang } from '../i18n.js';
import { el, card, btn, notice, toast, copyText, downloadBlob, switchBox } from '../ui.js';
import { state, getEngine, persistSettings, refreshEngineChip } from '../state.js';
import { resetSettings, modelCacheBytes, clearModels } from '../store.js';
import { loadOrt } from '../engine-onnx.js';

export async function viewSettings(root) {
  const s = state.settings;

  /* ---------------- 引擎 ---------------- */
  const engineBtns = el('div.row.tight', {}, [
    engineBtn('onnx'),
    engineBtn('server'),
  ]);

  const serverUrlInput = el('input', {
    type: 'url', value: s.serverUrl, placeholder: 'http://127.0.0.1:7865',
    onchange: async () => {
      await persistSettings({ serverUrl: serverUrlInput.value.trim() });
      toast(t('toast.saved'), { type: 'ok' });
      refreshEngineChip();
    },
  });

  const testBtn = btn(t('settings.server.test'), { size: 'sm', onClick: testServer });
  const testResult = el('div', { style: 'margin-top:8px;min-height:20px' });

  const serverRow = el('div', { style: 'margin-top:12px' }, [
    el('label.field', {}, [
      el('span.field-label', {}, [], t('settings.server.url')),
      el('div.row', {}, [el('div', { style: 'flex:1;min-width:220px' }, [serverUrlInput]), testBtn]),
      el('div.slider-hint', {}, [], t('settings.server.urlHint')),
    ]),
    notice(t('settings.server.hint'), { type: 'info', icon: 'ℹ' }),
    testResult,
  ]);

  const ortInfo = el('div.faint', { style: 'margin-top:10px' }, [], '…');

  const engineCard = card(t('settings.engine'), {}, [
    engineBtns,
    serverRow,
    ortInfo,
  ]);

  function engineBtn(id) {
    return btn(id === 'onnx' ? t('settings.engine.onnx') : t('settings.engine.server'), {
      size: 'sm', attrs: { 'aria-pressed': String(s.engine === id) },
      onClick: async () => {
        if (s.engine === id) return;
        await persistSettings({ engine: id });
        s.engine = id;
        renderEngine();
        await refreshEngineChip();
        toast(t('toast.saved'), { type: 'ok' });
      },
    });
  }

  function renderEngine() {
    engineBtns.replaceChildren(engineBtn('onnx'), engineBtn('server'));
    serverRow.classList.toggle('hidden', s.engine !== 'server');
    if (s.engine === 'onnx') probeOrt();
  }

  async function probeOrt() {
    ortInfo.textContent = t('common.loading');
    try {
      const { hasWebGpu } = await loadOrt();
      ortInfo.textContent = `ONNX Runtime 可用 · 后端：${hasWebGpu ? 'WebGPU + WASM 回退' : 'WASM'} · 首次推理需下载模型`;
    } catch (err) {
      ortInfo.textContent = `ONNX Runtime 加载失败：${err.message}`;
    }
  }

  async function testServer() {
    testBtn.disabled = true;
    testBtn.textContent = t('settings.server.testing');
    testResult.replaceChildren(el('span.spinner'), el('span.muted', { style: 'margin-left:8px' }, [], t('settings.server.testing')));
    try {
      const eng = new (await import('../engine-server.js')).ServerEngine({ url: serverUrlInput.value || s.serverUrl });
      const info = await eng.health();
      testResult.replaceChildren(notice(t('settings.server.ok', { detail: `${info.service}${info.upstream ? ' → ' + info.upstream : ''}` }), { type: 'info', icon: '✓' }));
      await refreshEngineChip({ ok: true, text: `${t('engine.server')} · ${s.serverUrl}` });
    } catch (err) {
      testResult.replaceChildren(notice(t('settings.server.fail', { msg: err.message }), { type: 'err', icon: '✕' }));
      await refreshEngineChip({ ok: false, text: `${t('engine.server')} · ${t('engine.error')}` });
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = t('settings.server.test');
    }
  }

  /* ---------------- 音频 ---------------- */
  const rateSelect = el('select', {
    onchange: async () => {
      await persistSettings({ outSampleRate: Number(rateSelect.value) });
      toast(t('toast.saved'), { type: 'ok' });
    },
  }, [
    el('option', { value: 0, selected: s.outSampleRate === 0 }, [], t('settings.audio.rate.keep')),
    ...[40000, 48000].map((r) => el('option', { value: r, selected: s.outSampleRate === r }, [], `${r / 1000} kHz`)),
  ]);

  const audioCard = card(t('settings.audio'), {}, [
    el('label.field', {}, [
      el('span.field-label', {}, [], t('settings.audio.outRate')),
      rateSelect,
    ]),
  ]);

  /* ---------------- 外观：跟随参考站，仅深色主题，这里只切语言 ---------------- */
  const langBtns = el('div.row.tight', {}, [langBtn('zh'), langBtn('en')]);

  const appearanceCard = card(t('settings.appearance'), {}, [
    el('div.grid.cols-2', {}, [
      el('div', {}, [el('div.field-label', {}, [], t('settings.appearance.theme')), themeNote()]),
      el('div', {}, [el('div.field-label', {}, [], t('settings.appearance.lang')), langBtns]),
    ]),
  ]);

  function themeNote() {
    return el('div.faint', { style: 'margin-top:6px' }, [], t('settings.appearance.theme.fixed'));
  }

  function langBtn(id) {
    return btn(id === 'zh' ? '中文' : 'English', {
      size: 'sm', attrs: { 'aria-pressed': String(getLang() === id) },
      onClick: () => { setLang(id); renderAppearance(); },
    });
  }

  function renderAppearance() {
    langBtns.replaceChildren(langBtn('zh'), langBtn('en'));
  }

  /* ---------------- 数据 ---------------- */
  const cacheInfo = el('span.muted.mono', {}, [], '…');

  const dataCard = card(t('settings.data'), {}, [
    el('p.muted', {}, [], t('settings.data.desc')),
    el('div.row', {}, [
      btn(t('settings.data.export'), {
        size: 'sm', onClick: () => {
          downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), 'rvc-settings.json');
          toast(t('settings.data.exported'), { type: 'ok' });
        },
      }),
      btn(t('settings.data.reset'), {
        size: 'sm', variant: 'danger',
        onClick: async () => {
          await resetSettings();
          state.settings = await resetSettings();
          toast(t('settings.reset.ok'), { type: 'ok' });
          renderAll();
        },
      }),
    ]),
  ]);

  const storageCard = card(t('models.cache'), { right: [cacheInfo] }, [
    btn(t('models.cache.clear'), {
      size: 'sm', variant: 'danger',
      onClick: async () => {
        const bytes = await modelCacheBytes();
        await clearModels();
        toast(t('models.cache.cleared', { bytes: formatBytesSafe(bytes) }), { type: 'ok' });
        refreshCache();
      },
    }),
  ]);

  async function refreshCache() {
    const bytes = await modelCacheBytes();
    cacheInfo.textContent = formatBytesSafe(bytes);
  }

  function renderAll() {
    renderEngine();
    renderAppearance();
    refreshCache();
  }

  root.append(
    el('header', {}, [el('h1.page-title', {}, [], t('settings.title'))]),
    engineCard, audioCard, appearanceCard, dataCard, storageCard,
  );

  renderAll();

  const stop = onLangChange(() => {
    root.replaceChildren(
      el('header', {}, [el('h1.page-title', {}, [], t('settings.title'))]),
      engineCard, audioCard, appearanceCard, dataCard, storageCard,
    );
    renderAll();
  });

  return { destroy: () => stop() };
}

function formatBytesSafe(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
