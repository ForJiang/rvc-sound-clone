/**
 * IndexedDB 存储层：模型文件（Blob）与用户设置。
 * 数据完全留在本机浏览器，不上传。
 */

const DB_NAME = 'rvc-sound-clone';
const DB_VERSION = 1;
const STORE_MODELS = 'models';
const STORE_KV = 'kv';

let dbPromise = null;
const OPEN_TIMEOUT_MS = 6000;

/* 降级存储：IndexedDB 被禁用、被其他标签页阻塞或打开超时时使用。
   功能可用（设置、模型），但刷新后丢失。 */
const memory = {
  models: new Map(),          // id -> record
  kv: new Map(),              // k -> v
  warned: false,
};

export function isDegraded() {
  return dbPromise === null;
}

/** 供启动时探测：存储是否可用、不可用时的原因。 */
export async function storageStatus() {
  try {
    await openDB();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function openDB() {
  if (dbPromise) return dbPromise;
  const raw = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  // 打开被阻塞（例如别的标签页正在删同名库）时不能无限等待
  const guarded = Promise.race([
    raw,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('IndexedDB open timeout')), OPEN_TIMEOUT_MS,
    )),
  ]);
  guarded.catch(() => { dbPromise = null; });   // 失败后允许下次重试
  dbPromise = guarded;
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ----------------------------- 模型 ----------------------------- */

export async function listModels() {
  try {
    const db = await openDB();
    const all = await done(tx(db, STORE_MODELS, 'readonly').getAll());
    return all.map(stripBlobs);
  } catch {
    return [...memory.models.values()].map(stripBlobs);
  }
}

/** 返回不含 Blob 的元数据（Blob 体积大，列表页不要读进内存）。 */
function stripBlobs(m) {
  const files = {};
  for (const [name, blob] of Object.entries(m.files || {})) files[name] = { size: blob.size, type: blob.type };
  return { ...m, files, _hasBlobs: true };
}

export async function getModel(id) {
  try {
    const db = await openDB();
    const rec = await done(tx(db, STORE_MODELS, 'readonly').get(id));
    return rec || null;
  } catch {
    return memory.models.get(id) || null;
  }
}

export async function putModel(record) {
  try {
    const db = await openDB();
    await done(tx(db, STORE_MODELS, 'readwrite').put(record));
  } catch {
    memory.models.set(record.id, record);
  }
  return record.id;
}

export async function deleteModel(id) {
  try {
    const db = await openDB();
    await done(tx(db, STORE_MODELS, 'readwrite').delete(id));
  } catch {
    memory.models.delete(id);
  }
}

export async function clearModels() {
  try {
    const db = await openDB();
    await done(tx(db, STORE_MODELS, 'readwrite').clear());
  } catch {
    memory.models.clear();
  }
}

/** 估算所有模型占用的字节数。 */
export async function modelCacheBytes() {
  const all = await listModels();
  return all.reduce((sum, m) => sum + Object.values(m.files || {}).reduce((s, b) => s + (b.size || 0), 0), 0);
}

/** 浏览器存储配额（非标准 API，失败时返回 null）。 */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/* ----------------------------- 设置 ----------------------------- */

const DEFAULT_SETTINGS = {
  engine: 'onnx',              // 'onnx' | 'server'
  serverUrl: 'http://127.0.0.1:7865',
  outSampleRate: 0,            // 0 = 跟随源文件
  cacheModels: true,           // 模型下载后写入 IndexedDB
  theme: 'dark',
  params: {
    f0upKey: 0,
    indexRate: 0.75,
    protect: 0.33,
    rmsMixRate: 0.25,
    filterRadius: 3,
  },
};

export async function getSettings() {
  try {
    const db = await openDB();
    const row = await done(tx(db, STORE_KV, 'readonly').get('settings'));
    return mergeSettings(row?.v);
  } catch {
    return mergeSettings(memory.kv.get('settings'));
  }
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, params: { ...cur.params, ...(patch.params || {}) } };
  try {
    const db = await openDB();
    await done(tx(db, STORE_KV, 'readwrite').put({ k: 'settings', v: next }));
  } catch {
    memory.kv.set('settings', next);
  }
  return next;
}

export async function resetSettings() {
  try {
    const db = await openDB();
    await done(tx(db, STORE_KV, 'readwrite').put({ k: 'settings', v: DEFAULT_SETTINGS }));
  } catch {
    memory.kv.set('settings', DEFAULT_SETTINGS);
  }
  return DEFAULT_SETTINGS;
}

function mergeSettings(saved) {
  return { ...DEFAULT_SETTINGS, ...(saved || {}), params: { ...DEFAULT_SETTINGS.params, ...(saved?.params || {}) } };
}

export { DEFAULT_SETTINGS };
