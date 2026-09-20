/**
 * 模型目录：合并 models/manifest.json 与 IndexedDB 中已导入/已下载的模型。
 */

import { getModel, listModels } from './store.js';

const FALLBACK = { base: [], voices: [], sources: [] };

let manifestPromise = null;

export function loadManifest() {
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetch('models/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((err) => {
      console.warn('[catalog] manifest 加载失败，使用内置默认目录：', err.message);
      return FALLBACK;
    });
  return manifestPromise;
}

/**
 * 统一模型条目：
 * { id, name, kind:'base'|'voice', engine:'onnx'|'server', size, license, note,
 *   source:'catalog'|'import', downloaded:boolean, files:[{name,url,size}] }
 */
export async function catalog() {
  const [manifest, local] = await Promise.all([loadManifest(), listModels()]);
  const localById = new Map(local.map((m) => [m.id, m]));
  const entries = [];

  for (const base of manifest.base || []) {
    const have = localById.get(base.id);
    entries.push({
      ...base,
      source: 'catalog',
      downloaded: !!have,
      files: (base.files || []).map((f) => ({ ...f, downloaded: !!have?.files?.[f.name] })),
    });
  }

  for (const v of manifest.voices || []) {
    entries.push({ ...v, source: 'catalog', downloaded: false, files: (v.files || []).map((f) => ({ ...f, downloaded: false })) });
  }

  for (const m of local) {
    if (entries.some((e) => e.id === m.id)) continue;
    entries.push({
      id: m.id,
      name: m.name,
      kind: m.kind || 'voice',
      engine: m.engine || 'onnx',
      license: m.license || 'unknown',
      note: m.note || '',
      source: 'import',
      downloaded: true,
      size: Object.values(m.files || {}).reduce((s, b) => s + (b.size || 0), 0),
      files: Object.entries(m.files || {}).map(([name, f]) => ({ name, size: f.size })),
    });
  }

  return {
    entries,
    voices: entries.filter((e) => e.kind === 'voice'),
    base: entries.filter((e) => e.kind === 'base'),
    sources: manifest.sources || [],
  };
}

/** 读取并校验本地已下载模型的 Blob。 */
export async function loadModelFiles(id) {
  const rec = await getModel(id);
  if (!rec) throw new Error(`model not found locally: ${id}`);
  return rec;
}
