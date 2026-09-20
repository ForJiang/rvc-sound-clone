/**
 * 模型库页：下载基础模型、导入本地模型、查看缓存占用。
 */

import { t, onLangChange } from '../i18n.js';
import { el, card, btn, notice, toast, formatBytes, confirmDialog } from '../ui.js';
import { catalog } from '../catalog.js';
import { getModel, putModel, deleteModel, clearModels, modelCacheBytes, storageEstimate } from '../store.js';
import { state, refreshEngineChip } from '../state.js';

const CACHE = 'rvc-model-cache-v1';

export async function viewModels(root) {
  const { entries, sources } = await catalog();
  const localIds = new Set(entries.filter((e) => e.downloaded).map((e) => e.id));

  const downloading = new Map();
  let tab = 'base';

  const tableBody = el('tbody');
  const cacheText = el('span.muted.mono');
  const quotaText = el('div.faint');

  const importInput = el('input', {
    type: 'file', multiple: true, accept: '.pth,.index,.onnx,.zip', style: 'display: none',
    onchange: (e) => { importFiles([...e.target.files]); e.target.value = ''; },
  });

  const dropzone = el('div.dropzone', {
    onclick: () => importInput.click(),
    ondragover: (e) => { e.preventDefault(); dropzone.classList.add('drag'); },
    ondragleave: () => dropzone.classList.remove('drag'),
    ondrop: (e) => { e.preventDefault(); dropzone.classList.remove('drag'); importFiles([...e.dataTransfer.files]); },
  }, [
    el('div.dz-icon', {}, [], '📦'),
    el('strong', {}, [], t('models.import.title')),
    el('small', {}, [], t('models.import.formats')),
  ]);

  const head = el('header', {}, [
    el('h1.page-title', {}, [], t('models.title')),
    el('p.lead', {}, [], t('models.sub')),
  ]);

  const tabs = el('div.row.tight', {}, [
    tabBtn('models.tab.base', 'base'),
    tabBtn('models.tab.voice', 'voice'),
    tabBtn('models.tab.custom', 'custom'),
  ]);

  function tabBtn(key, id) {
    return btn(t(key), {
      size: 'sm', attrs: { 'aria-pressed': String(tab === id) },
      onClick: () => { tab = id; renderTable(); renderTabs(); },
    });
  }

  function renderTabs() {
    tabs.replaceChildren(
      tabBtn('models.tab.base', 'base'),
      tabBtn('models.tab.voice', 'voice'),
      tabBtn('models.tab.custom', 'custom'),
    );
  }

  const table = el('div.table-wrap', {}, [
    el('table.data', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, [], t('models.col.name')),
        el('th', {}, [], t('models.col.kind')),
        el('th', {}, [], t('models.col.size')),
        el('th', {}, [], t('models.col.status')),
        el('th', {}, [], t('models.col.action')),
      ])]),
      tableBody,
    ]),
  ]);

  const baseSources = el('div.grid.cols-2', {}, (sources.length ? sources : []).map((s) =>
    el('div.card', { style: { padding: '12px 14px' } }, [
      el('strong', {}, [], s.name),
      el("p.faint", {}, [], s.desc || ""),
      el('a', { href: s.url, target: '_blank', rel: 'noreferrer' }, [], s.url),
    ])));

  const importCard = card(t('models.import.title'), {}, [
    notice(t('models.import.hint'), { type: 'info', icon: '📦' }),
    el('div', { style: 'margin-top:12px' }, [dropzone]),
  ]);

  const body = el('div', {}, [tabs, table, el('div', { style: 'height:18px' }), importCard, el('div', { style: 'height:18px' }), baseSources]);

  root.append(head, el('div', { style: 'display:flex;flex-direction:column;gap:20px' }, [
    card(t('models.cache'), { right: [
      cacheText,
      btn(t('models.cache.clear'), { size: 'sm', variant: 'danger', onClick: clearCache }),
    ] }, [quotaText]),
    body,
  ]));

  /* ------------------------- 渲染 ------------------------- */

  function visibleEntries() {
    if (tab === 'base') return entries.filter((e) => e.kind === 'base');
    if (tab === 'voice') return entries.filter((e) => e.kind === 'voice' && e.source === 'catalog');
    return entries.filter((e) => e.source === 'import');
  }

  const EMPTY_MSG = {
    voice: 'models.empty.voice',
    custom: 'models.empty.imported',
    base: 'models.empty.imported',
  };

  function renderTable() {
    const rows = visibleEntries();
    if (!rows.length) {
      tableBody.replaceChildren(el('tr', {}, [el('td', {
        colspan: 5, style: 'text-align:center;color:var(--text-faint);padding:22px;line-height:1.7;max-width:640px;margin:0 auto',
      }, [], t(EMPTY_MSG[tab] || 'models.empty.imported'))]));
      return;
    }
    tableBody.replaceChildren(...rows.map((m) => el('tr', {}, [
      el('td', {}, [
        el('div', { style: 'font-weight:550' }, [], m.name),
        m.note ? el('div.faint', {}, [], m.note) : null,
        m.kind === 'base' && !m.downloaded ? el('div.faint', { style: 'color:var(--warn);margin-top:2px' }, [], t('models.base.whyConvert')) : null,
        m.source === 'import' && m.files?.length
          ? el('div.file-detail', {}, m.files.map((f) =>
              el('span.chip' + (f.size ? '.ok' : ''), {}, [], `${f.name}${f.size ? ' · ' + formatBytes(f.size) : ''}`)))
          : null,
      ]),
      el('td', {}, [el('span.badge' + (m.kind === 'base' ? '.brand' : ''), {}, [], m.kind === 'base' ? 'base' : 'voice')]),
      el('td.mono', {}, [], m.size ? formatBytes(m.size) : '—'),
      el('td', {}, [statusBadge(m)]),
      el('td', {}, [actionBtns(m)]),
    ])));
  }

  function statusBadge(m) {
    const dl = downloading.get(m.id);
    if (dl) return el('span.badge.warn', {}, [], `${t('models.status.downloading')} ${Math.round((dl.loaded / dl.total) * 100) || 0}%`);
    if (m.downloaded) return el('span.badge.ok', {}, [], t('models.status.ready'));
    if (m.kind === 'base') return el('span.badge.warn', { title: t('models.base.whyConvert') }, [], t('models.base.needConvert'));
    return el('span.badge', {}, [], t('models.status.none'));
  }

  function actionBtns(m) {
    // 基础模型是 .pt，浏览器引擎用不了，给转换指引而不是误导性的下载
    if (m.kind === 'base' && !m.downloaded) {
      return el('a.btn.sm', {
        href: 'https://github.com/ForJiang/rvc-sound-clone/blob/main/docs/model-conversion.md',
        target: '_blank', rel: 'noreferrer', title: t('models.base.whyConvert'),
      }, [], t('models.action.convertGuide'));
    }
    const dl = downloading.get(m.id);
    if (dl) {
      return el('div.row.tight', {}, [
        el('div.progress', { style: 'flex:1;min-width:70px' }, [el('span', { style: `width:${Math.round((dl.loaded / dl.total) * 100)}%` })]),
        btn(t('models.action.cancel'), { size: 'sm', variant: 'ghost', onClick: () => dl.controller.abort() }),
      ]);
    }
    if (m.downloaded) {
      return el('div.row.tight', {}, [
        btn(t('models.action.use'), { size: 'sm', onClick: () => { state.ui.modelId = m.id; toast(t('toast.saved'), { type: 'ok' }); } }),
        m.source === 'import'
          ? btn(t('models.action.delete'), { size: 'sm', variant: 'danger', onClick: () => removeModel(m) })
          : btn(t('models.action.delete'), { size: 'sm', variant: 'ghost', onClick: () => removeModel(m) }),
      ]);
    }
    if (m.source !== 'catalog' || !m.files?.length) return el('span.faint', {}, [], '—');
    return btn(t('models.action.download'), { size: 'sm', variant: 'primary', onClick: () => download(m) });
  }

  async function download(m) {
    const controller = new AbortController();
    downloading.set(m.id, { loaded: 0, total: m.size || 1, controller });
    renderTable();
    try {
      const files = {};
      for (const f of m.files) {
        const res = await fetch(f.url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${f.name}`);
        const len = Number(res.headers.get('content-length') || f.size || 0);
        const blob = await streamToBlob(res, (loaded) => {
          const dl = downloading.get(m.id);
          if (dl) { dl.loaded = loaded; renderTable(); }
        }, len);
        files[f.name] = blob;
      }
      await putModel({
        id: m.id, name: m.name, kind: m.kind, engine: m.engine || 'onnx',
        license: m.license || 'unknown', note: m.note || '', files, addedAt: Date.now(),
      });
      m.downloaded = true;
      m.files = m.files.map((f) => ({ ...f, downloaded: true }));
      toast(t('models.import.ok', { name: m.name }), { type: 'ok' });
    } catch (err) {
      if (err.name === 'AbortError') toast(t('common.cancel'), { type: 'warn' });
      else toast(err.message, { type: 'err', duration: 7000 });
    } finally {
      downloading.delete(m.id);
      renderTable();
      refreshCache();
    }
  }

  async function removeModel(m) {
    const ok = await confirmDialog(t('models.delete.confirm', { name: m.name }), { danger: true, okText: t('common.delete') });
    if (!ok) return;
    await deleteModel(m.id);
    m.downloaded = false;
    m.files = (m.files || []).map((f) => ({ ...f, downloaded: false }));
    localIds.delete(m.id);
    toast(t('models.delete.ok', { name: m.name }), { type: 'ok' });
    renderTable();
    refreshCache();
  }

  async function clearCache() {
    const bytes = await modelCacheBytes();
    await clearModels();
    toast(t('models.cache.cleared', { bytes: formatBytes(bytes) }), { type: 'ok' });
    for (const m of entries) {
      m.downloaded = m.source === 'import' ? false : false;
      m.files = (m.files || []).map((f) => ({ ...f, downloaded: false }));
    }
    renderTable();
    refreshCache();
  }

  async function importFiles(files) {
    let imported = 0;
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.zip')) { await importZip(file); imported++; continue; }
      if (!/\.(pth|index|onnx)$/.test(lower)) { toast(t('models.import.bad', { name: file.name }), { type: 'warn' }); continue; }
      const id = 'import-' + file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_').slice(0, 40);
      const existing = await getModel(id);
      const rec = existing
        ? { ...existing, files: { ...(existing.files || {}), [file.name]: file } }
        : {
            id, name: file.name.replace(/\.[^.]+$/, ''),
            kind: 'voice', engine: lower.endsWith('.onnx') ? 'onnx' : 'server',
            license: 'user-provided', note: t('models.self'),
            files: { [file.name]: file }, addedAt: Date.now(),
          };
      rec.engine = Object.keys(rec.files).some((n) => n.endsWith('.onnx')) ? 'onnx' : 'server';
      await putModel(rec);
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.downloaded = true;
        entry.files = Object.keys(rec.files).map((n) => ({ name: n }));
      } else {
        entries.push({
          id, name: rec.name, kind: 'voice', engine: rec.engine, license: rec.license,
          note: rec.note, source: 'import', downloaded: true, size: file.size,
          files: [{ name: file.name }],
        });
      }
      imported++;
      const hasIndex = Object.keys(rec.files).some((n) => n.endsWith('.index'));
      toast(hasIndex ? t('models.import.ok', { name: rec.name }) : t('models.import.needIndex', { name: rec.name }), { type: 'ok' });
    }
    if (imported) { renderTable(); refreshCache(); }
  }

  async function importZip(file) {
    // zip 解包：读取本地文件头，支持 store/deflate
    const buf = new Uint8Array(await file.arrayBuffer());
    const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.mjs').catch(() => ({}));
    if (!unzipSync) throw new Error('解压组件加载失败，请改用单个文件导入');
    const out = unzipSync(buf);
    const name = file.name.replace(/\.zip$/i, '');
    const files = {};
    for (const [path, data] of Object.entries(out)) {
      const base = path.split('/').pop();
      if (!/\.(pth|index|onnx)$/i.test(base)) continue;
      files[base] = new Blob([data], { type: 'application/octet-stream' });
    }
    if (!Object.keys(files).length) { toast(t('models.import.bad', { name: file.name }), { type: 'warn' }); return; }
    const id = 'import-' + name.replace(/[^\w.-]/g, '_').slice(0, 40);
    const existing = await getModel(id);
    const engine = Object.keys(files).some((n) => n.endsWith('.onnx')) ? 'onnx' : 'server';
    await putModel({
      id, name, kind: 'voice', engine, license: 'user-provided',
      note: t('models.self'), files: { ...(existing?.files || {}), ...files }, addedAt: Date.now(),
    });
    const hasIndex = Object.keys(files).some((n) => n.endsWith('.index'));
    toast(hasIndex ? t('models.import.ok', { name }) : t('models.import.needIndex', { name }), { type: 'ok' });
    entries.push({
      id, name, kind: 'voice', engine, license: 'user-provided', note: t('models.self'),
      source: 'import', downloaded: true,
      size: Object.values(files).reduce((s, b) => s + b.size, 0),
      files: Object.keys(files).map((n) => ({ name: n })),
    });
  }

  async function refreshCache() {
    const bytes = await modelCacheBytes();
    cacheText.textContent = formatBytes(bytes);
    const est = await storageEstimate();
    quotaText.textContent = est
      ? `已用 ${formatBytes(est.usage)} / 配额 ${formatBytes(est.quota)}`
      : t('models.cache.empty');
  }

  renderTabs();
  renderTable();
  refreshCache();

  const stop = onLangChange(() => {
    renderTabs();
    renderTable();
    refreshCache();
  });

  return { destroy: () => stop() };
}

/** fetch 流式读取为 Blob，用于显示下载进度。 */
async function streamToBlob(res, onProgress, total) {
  if (!res.body || !total) {
    const blob = await res.blob();
    onProgress(blob.size);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded);
  }
  return new Blob(chunks);
}

export { CACHE };
