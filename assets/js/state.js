/**
 * 全局状态与引擎工厂。
 * 视图层只读 state、调用 getEngine()，不直接关心引擎差异。
 */

import { t } from './i18n.js';
import { getSettings, saveSettings as writeSettings } from './store.js';
import { OnnxEngine } from './engine-onnx.js';
import { ServerEngine } from './engine-server.js';

let lastChipDetail = null;

export const state = {
  settings: null,
  engine: null,
  /** 视图间共享的 UI 数据（不持久化到 IndexedDB） */
  ui: {
    queue: [],
    selectedQueueId: null,
    results: [],
    modelId: null,
    activeTab: 'record',
  },
};

export async function initState() {
  state.settings = await getSettings();
  return state;
}

export async function persistSettings(patch) {
  state.settings = await writeSettings(patch);
  return state.settings;
}

/** convert.js 中直接调用的别名，参数与 persistSettings 相同。 */
export const saveSettings = persistSettings;

/** 按当前设置返回引擎实例；未配置好时返回 null。 */
export function getEngine() {
  const s = state.settings;
  if (!s) return null;
  if (s.engine === 'server') {
    if (!s.serverUrl) return null;
    return new ServerEngine({ url: s.serverUrl });
  }
  return new OnnxEngine();
}

export function currentEngineLabel() {
  const s = state.settings;
  if (!s) return t('engine.unknown');
  if (s.engine === 'server') return `${t('engine.server')} · ${s.serverUrl}`;
  return t('engine.onnx');
}

/** 顶栏引擎状态灯；记住最后一次 detail，语言切换后能原样重绘。 */
export async function refreshEngineChip(detail) {
  if (detail) lastChipDetail = detail;
  const chip = document.getElementById('engineChip');
  const dot = document.getElementById('engineDot');
  const name = document.getElementById('engineName');
  if (!chip || !dot || !name) return;

  const s = state.settings;
  chip.classList.remove('ok', 'warn', 'err');
  if (!s) { name.textContent = t('engine.unknown'); return; }

  if (detail?.ok === true) chip.classList.add('ok');
  else if (detail?.ok === false) chip.classList.add('err');

  if (lastChipDetail?.text) {
    name.textContent = lastChipDetail.text;
    chip.title = lastChipDetail.title || '';
    return;
  }

  if (s.engine === 'server') {
    name.textContent = t('engine.notReady') + ' · ' + s.serverUrl;
    chip.title = '点击“设置 → 测试连接”确认服务可用';
    return;
  }
  name.textContent = t('engine.onnx');
  chip.title = '';
}
