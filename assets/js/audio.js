/**
 * 音频工具箱：录音（getUserMedia + MediaRecorder）、解码、重采样、WAV 编码、播放。
 * 不依赖任何第三方库；解码交给浏览器的 AudioContext.decodeAudioData。
 */

import { drawMeter } from './ui.js';

export const SAMPLE_RATE_16K = 16000;

function ctxClass() {
  return window.AudioContext || window.webkitAudioContext;
}

export function isAudioSupported() {
  return typeof ctxClass() === 'function';
}

/** 懒加载单例 AudioContext；resume() 必须在用户手势后调用。 */
export function getContext() {
  if (!isAudioSupported()) throw new Error('Web Audio API unavailable');
  if (!getContext._ctx) getContext._ctx = new ctxClass();
  return getContext._ctx;
}

export async function listInputs() {
  try {
    await navigator.mediaDevices?.getUserMedia({ audio: true }); // 触发权限以拿到设备标签
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

/**
 * 录音器： MediaRecorder → webm/opus blob → 解码为 PCM。
 * 同时提供 AnalyserNode 供电平条使用。
 */
export class Recorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.analyser = null;
    this.source = null;
    this._raf = 0;
    this.startedAt = 0;
    this._onLevel = null;
    this._onTick = null;
  }

  get recording() {
    return !!this.recorder && this.recorder.state === 'recording';
  }

  async start({ deviceId, onLevel, onTick } = {}) {
    if (this.recording) throw new Error('already recording');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('navigator.mediaDevices unavailable (需要 HTTPS 或 localhost)');

    const constraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    const ctx = getContext();
    await ctx.resume();
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.7;
    this.source.connect(this.analyser);

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', ''].find((m) => !m || MediaRecorder.isTypeSupported(m)) || '';
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.startedAt = performance.now();

    this._onLevel = onLevel;
    this._onTick = onTick;
    const loop = () => {
      if (!this.recording) return;
      const buf = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / buf.length);
      this._onLevel?.(Math.min(1, rms * 2.6));
      this._onTick?.(performance.now() - this.startedAt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** 停止并返回 { blob, arrayBuffer } */
  async stop() {
    if (!this.recording) return null;
    const rec = this.recorder;
    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.stop();
    await done;
    cancelAnimationFrame(this._raf);
    this.cleanup();
    const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
    if (blob.size < 2048) throw new Error('recorded audio too short');
    return { blob, arrayBuffer: await blob.arrayBuffer() };
  }

  cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.recorder = null;
    this._onLevel = null;
  }

  /** 把 AnalyserNode 绑到 canvas 上画实时电平（停止时自动清空）。 */
  attachMeter(canvas) {
    const loop = () => {
      if (!this.analyser) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); return; }
      drawMeter(canvas, this.analyser);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

/** 解码任意浏览器支持的音频为 AudioBuffer。 */
/** 判断字节流是否是 WAV（RIFF/WAVE 头）。 */
export function isWav(bytes) {
  if (bytes.length < 12) return false;
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE';
}

/**
 * 纯 JS 解析 PCM/float WAV，支持 8/16/24/32 位整型与 32 位浮点。
 * 这样即使环境的 Web Audio 解码能力不全（部分内嵌浏览器、隐私模式），WAV 依然可用。
 * @returns {{sampleRate:number, channels:Float32Array[]}}
 */
export function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);

  let pos = 12;
  let format = 1;          // 1 = PCM，3 = IEEE float，0xFFFE = 可扩展
  let channels = 1;
  let sampleRate = 16000;
  let bits = 16;
  let dataStart = -1;
  let dataLen = 0;

  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true) || 1;
      sampleRate = view.getUint32(body + 4, true) || 16000;
      bits = view.getUint16(body + 14, true) || 16;
    } else if (id === 'data') {
      dataStart = body;
      dataLen = size;
      break;   // data 一般是最后一个 chunk
    }
    pos = body + size + (size % 2);   // chunk 按 2 字节对齐
  }
  if (dataStart < 0) throw new Error('WAV 中找不到 data 块');

  const bytesPerSample = bits >> 3;
  const frames = Math.floor(Math.min(dataLen, bytes.length - dataStart) / bytesPerSample / channels);
  if (frames <= 0) throw new Error('WAV 数据长度为 0');

  const out = [];
  for (let c = 0; c < channels; c++) out.push(new Float32Array(frames));

  let off = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let v = 0;
      if (format === 3 && bits === 32) v = view.getFloat32(off, true);
      else if (bits === 16) v = view.getInt16(off, true) / 0x8000;
      else if (bits === 24) {
        const b0 = view.getUint8(off), b1 = view.getUint8(off + 1), b2 = view.getUint8(off + 2);
        let x = (b2 << 16) | (b1 << 8) | b0;
        if (x & 0x800000) x -= 0x1000000;
        v = x / 0x800000;
      } else if (bits === 32) v = view.getInt32(off, true) / 0x80000000;
      else if (bits === 8) v = (view.getUint8(off) - 128) / 128;
      out[c][i] = Math.max(-1, Math.min(1, v));
      off += bytesPerSample;
    }
  }
  return { sampleRate, channels: out };
}

/**
 * 解码任意浏览器支持的音频。
 * 优先走内置 WAV 解析（不依赖 AudioContext.decodeAudioData），
 * 其余格式交给浏览器的解码器。
 */
export async function decode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (isWav(bytes)) {
    const { sampleRate, channels } = parseWav(bytes);
    return toAudioBuffer(sampleRate, channels);
  }
  const ctx = getContext();
  if (typeof ctx.decodeAudioData !== 'function') {
    throw new Error('当前环境不支持解码该格式（缺少 decodeAudioData），请改用 WAV 文件');
  }
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  return buf;
}

/**
 * 把裸声道数据包成 AudioBuffer；AudioContext 不可用时退化为同形态对象，
 * 仍可用于波形显示与 WAV 导出（仅播放不可用）。
 */
export function toAudioBuffer(sampleRate, channels) {
  const ctx = isAudioSupported() ? getContext() : null;
  if (ctx && typeof ctx.createBuffer === 'function') {
    const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    if (buf && typeof buf.copyToChannel === 'function') {
      channels.forEach((ch, c) => buf.copyToChannel(ch, c));
      return buf;
    }
  }
  return plainBuffer(sampleRate, channels);
}

/** 与 AudioBuffer 同形态的纯数据对象：可显示波形、可导出，仅不能播放。 */
function plainBuffer(sampleRate, channels) {
  const length = channels[0].length;
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    duration: length / sampleRate,
    getChannelData: (c) => channels[c],
  };
}

/** AudioBuffer → 16bit PCM WAV Blob。 */
export function encodeWav(channels, sampleRate) {
  const data = channels.length === 1 ? channels[0] : mixToMono(channels);
  const blockAlign = 2;
  const dataSize = data.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // format = PCM
  view.setUint16(22, 1, true);         // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);        // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function mixToMono(channels) {
  const len = channels[0].length;
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i];
  for (let i = 0; i < len; i++) out[i] /= channels.length;
  return out;
}

/** 取单声道 Float32Array（复用原始 buffer，不额外拷贝时直接返回第一声道）。 */
export function toMono(audioBuffer) {
  const chans = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) chans.push(audioBuffer.getChannelData(c));
  return mixToMono(chans);
}

/** 用 OfflineAudioContext 重采样到目标采样率。 */
export async function resample(audioBuffer, targetRate) {
  if (!targetRate || audioBuffer.sampleRate === targetRate) return audioBuffer;
  if (typeof OfflineAudioContext !== 'function') return audioBuffer;   // 环境受限，保持原采样率
  const frames = Math.max(1, Math.round(audioBuffer.duration * targetRate));
  const off = new (ctxClass())({ numberOfChannels: 1, length: frames, sampleRate: targetRate });
  const src = off.createBufferSource();
  const mono = off.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
  mono.copyToChannel(toMono(audioBuffer), 0);
  src.buffer = mono;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/** 简单播放器：波形点击定位 + 播放头。 */
export class Player {
  constructor({ canvas, onEnded } = {}) {
    this.canvas = canvas;
    this.onEnded = onEnded;
    this.buffer = null;
    this.source = null;
    this.ctx = getContext();
    this.startedAt = 0;
    this.offset = 0;
    this._raf = 0;
  }

  get playing() { return !!this.source; }

  load(audioBuffer) {
    this.stop();
    this.buffer = audioBuffer;
    return this;
  }

  play(offsetSec = 0) {
    if (!this.buffer || this.playing) return;
    if (typeof this.ctx.createBufferSource !== 'function') {
      this.onEnded?.();
      throw new Error('当前环境不支持音频播放，结果仍可下载');
    }
    this.ctx.resume?.();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.ctx.destination);
    this.source.onended = () => { this.stop(); this.onEnded?.(); };
    this.offset = offsetSec;
    this.source.start(0, offsetSec);
    this.startedAt = performance.now();
    const loop = () => {
      if (!this.source) return;
      const t = (this.offset + (performance.now() - this.startedAt) / 1000) % this.buffer.duration;
      this.canvas?.dispatchEvent(new CustomEvent('player-time', { detail: t }));
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    try { this.source?.stop(); } catch { /* 已停止 */ }
    this.source = null;
  }

  toggle() {
    if (this.playing) this.stop();
    else this.play(0);
  }
}

/** 计算峰值，用于绘制静态波形。 */
export function peaksOf(samples, buckets = 220) {
  if (!samples?.length) return [];
  const step = Math.max(1, Math.floor(samples.length / buckets));
  const out = [];
  for (let i = 0; i < buckets; i++) {
    let peak = 0;
    const start = i * step;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(samples[start + j] ?? 0);
      if (v > peak) peak = v;
    }
    out.push(peak);
  }
  return out;
}
