/**
 * UI 工具：DOM 构建、toast、模态框、波形绘制、格式化、下载。
 * 全部返回 DOM 节点，视图层直接用，无模板字符串注入 XSS 隐患（用户内容统一走 textContent）。
 */

import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 创建元素：el('button.btn.primary', {type:'button'}, [children], 'text') */
export function el(tag, attrs = {}, children = [], text) {
  const parts = String(tag).split('.').filter(Boolean);
  const node = document.createElement(parts[0] || 'div');
  node.className = parts.slice(1).join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (text !== undefined && node.childNodes.length === 0) node.textContent = String(text);
  return node;
}

/* ---------------------------- toast ---------------------------- */

const ICONS = { ok: '✓', err: '✕', warn: '!', info: 'i' };

export function toast(message, { type = 'info', title, duration = 4200 } = {}) {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div.toast.' + type, {}, [
    el('span.t-ico', {}, [], ICONS[type] || 'i'),
    el('div.t-body', {}, [
      title ? el('div.t-title', {}, [], title) : null,
      el('div.t-msg', {}, [], message),
    ]),
  ]);
  host.append(node);
  const kill = () => {
    node.classList.add('out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };
  if (duration > 0) setTimeout(kill, duration);
  node.addEventListener('click', kill);
  return node;
}

/* --------------------------- 模态框 --------------------------- */

export function modal({ title, body = [], footer = [], onClose, wide = false }) {
  const root = $('#modalRoot');
  if (!root) return { close() {} };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    root.replaceChildren();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const backdrop = el('div.modal-backdrop', {
    onClick: (e) => { if (e.target === backdrop) close(); },
  }, [
    el('div.modal', wide ? { style: { width: 'min(820px, 100%)' } } : {}, [
      el('div.modal-head', {}, [
        el('h3', {}, [], title),
        el('button.icon-btn', { type: 'button', 'aria-label': t('common.close'), onclick: close, style: { marginLeft: 'auto' } }, [], '✕'),
      ]),
      el('div.modal-body', {}, body),
      footer.length ? el('div.modal-foot', {}, footer) : null,
    ]),
  ]);
  root.append(backdrop);
  document.addEventListener('keydown', onKey);
  return { close, backdrop };
}

export function confirmDialog(message, { title = t('common.confirm'), okText = t('common.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: [el('p', { style: { margin: '0', color: 'var(--ink-dim)' } }, [], message)],
      footer: [
        el('button.btn.ghost', { type: 'button', onclick: () => { m.close(); resolve(false); } }, [], t('common.cancel')),
        el('button.btn' + (danger ? '.danger' : '.primary'), {
          type: 'button',
          onclick: () => { m.close(); resolve(true); },
        }, [], okText),
      ],
    });
  });
}

/* --------------------------- 窗口组件 --------------------------- */

export function notice(text, { type = 'info', icon = 'i' } = {}) {
  return el('div.notice.' + type, {}, [
    el('span.ico', {}, [], icon),
    el('div', {}, Array.isArray(text) ? text : [text]),
  ]);
}

export function card(title, { sub, step, right = [] } = {}, body = []) {
  return el('section.card', {}, [
    el('div.row', {}, [
      step ? el('span.num', {}, [], String(step)) : null,
      el('h2.card-title', {}, [], title),
      ...right.map((r) => (typeof r === 'function' ? r() : r)),
    ]),
    sub ? el('p.card-sub', {}, [], sub) : null,
    ...body,
  ]);
}

export function slider({ label, hint, min, max, step, value, unit = '', format, onChange }) {
  const valEl = el('span.val');
  const fmt = (v) => (format ? format(v) : String(v)) + unit;
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: () => {
      const v = Number(input.value);
      valEl.textContent = fmt(v);
      onChange?.(v);
    },
  });
  valEl.textContent = fmt(Number(value));
  return el('label.field.slider-row', {}, [
    el('div.slider-head', {}, [el('span.name', {}, [], label), valEl]),
    input,
    hint ? el('div.slider-hint', {}, [], hint) : null,
  ]);
}

export function switchBox(label, checked, onChange) {
  const input = el('input', {
    type: 'checkbox',
    onchange: () => onChange(input.checked),
  });
  input.checked = !!checked;
  return el('label.switch', {}, [input, el('span.track'), el('span', {}, [], label)]);
}

export function btn(label, { variant = '', size = '', onClick, disabled, title, type = 'button', attrs = {} } = {}) {
  return el(`button.btn${variant ? '.' + variant : ''}${size ? '.' + size : ''}`, {
    type, title, disabled, onclick: onClick, ...attrs,
  }, [], label);
}

export function progress(indeterminate = false) {
  return el('div.progress' + (indeterminate ? '.indeterminate' : ''), {}, [el('span')]);
}

export function spinner() {
  return el('span.spinner');
}

/* --------------------------- 格式化 --------------------------- */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ---------------------------- 下载 ---------------------------- */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('toast.copied'), { type: 'ok' });
  } catch {
    // 老浏览器回退
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } }, [], text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? t('toast.copied') : t('toast.copyFail'), { type: ok ? 'ok' : 'err' });
  }
}

/* --------------------------- 波形绘制 --------------------------- */

/**
 * 把 [-1,1] 的 PCM 画成波形。未播放部分用半透明白，播放过的是纯白。
 */
export function drawWave(canvas, samples, { progress = 0, color, wave = 'rgba(255,255,255,.92)' } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 96;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!samples || samples.length === 0) return;

  const bars = Math.max(24, Math.floor(w / 3));
  const step = Math.max(1, Math.floor(samples.length / bars));
  const gap = 1;
  const barW = Math.max(1, w / bars - gap);
  const mid = h / 2;

  for (let i = 0; i < bars; i++) {
    const start = i * step;
    let peak = 0;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(samples[start + j] || 0);
      if (v > peak) peak = v;
    }
    const bh = Math.max(1.5, peak * (h - 6));
    const x = i * (barW + gap);
    const played = x / w <= progress;
    ctx.fillStyle = color || (played ? wave : 'rgba(255,255,255,.30)');
    ctx.fillRect(x, mid - bh / 2, barW, bh);
  }
}

/** 简易频谱条，用于实时录音电平。 */
export function drawMeter(canvas, analyser) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 120;
  const h = canvas.clientHeight || 18;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!analyser) return;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);
  const bars = 24;
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const idx = Math.floor((i / bars) ** 1.4 * buf.length);
    const v = buf[idx] / 255;
    const bh = Math.max(2, v * h);
    // 电平条：银色系，与整体单色视觉一致
    const grad = ctx.createLinearGradient(0, h, 0, h - bh);
    grad.addColorStop(0, 'rgba(255,255,255,.45)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  }
}

/* ------------------------ ZIP 打包（无依赖） ------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** 生成 store（method 0）ZIP，足够网页下载使用。 */
export function makeZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const { time, date } = dosDateTime();
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, data);
    offset += 30 + nameBytes.length + data.length;

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset - data.length - nameBytes.length - 30, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
  }

  const cd = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, cd, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
