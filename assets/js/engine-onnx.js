/**
 * 浏览器引擎：用 ONNX Runtime Web 在页跑完整 RVC 推理流水线。
 *
 * 需要四组 ONNX 权重（IO 契约见 docs/model-conversion.md，可用 tools/export_onnx.py 从 .pth 转换）：
 *   hubert.onnx     audio:  f32[1, N]      -> feats:  f32[1, T, 768]   (16kHz 单声道)
 *   f0.onnx         audio:  f32[1, N]      -> f0:     f32[1, T]        (Hz，0 表示清音)
 *   speaker.onnx    sid:    i64[1]         -> spk:    f32[1, 768]
 *   generator.onnx  c: f32[1,T,768], f0c: f32[1,T], uv: f32[1,T], sid: i64[1] -> audio: f32[1,M] 或 [M]
 *
 * 音频 16kHz、帧长 320 采样（20ms 一跳），与 RVC 训练时一致。
 */

import { t } from './i18n.js';
import { SAMPLE_RATE_16K, resample, toMono } from './audio.js';
import { getModel } from './store.js';

const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.all.min.mjs';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
const HOP = 320;
const MAX_SECONDS = 90;
const WIN_SECONDS = 15;      // 分块长度
const CROSSFADE = 0.25;      // 交叉淡化秒数

let ortPromise = null;

/** 动态加载 ONNX Runtime Web；CDN 不可用时给出可读错误。 */
export function loadOrt() {
  if (ortPromise) return ortPromise;
  ortPromise = import(/* @vite-ignore */ ORT_URL).then((mod) => {
    const ort = mod.default || mod;
    // GitHub Pages 没有 COOP/COEP 头，多线程 wasm 会被浏览器拒绝，这里保守关掉
    ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? 4 : 1;
    ort.env.wasm.simd = true;
    ort.env.wasm.wasmPaths = ORT_WASM;
    ort.env.logLevel = 'error';
    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    return { ort, hasWebGpu };
  }).catch((err) => {
    ortPromise = null;
    throw new Error(`无法加载 ONNX Runtime（${ORT_URL}）：${err.message}。请检查网络，或改用本地服务引擎`);
  });
  return ortPromise;
}

const sessionCache = new Map();

async function getSession(modelId, file, opts = {}) {
  const key = `${modelId}/${file}`;
  if (sessionCache.has(key)) return sessionCache.get(key);
  const rec = await getModel(modelId);
  const blob = rec?.files?.[file];
  if (!blob) throw new Error(`缺少模型文件 ${file}（模型 ${modelId}）。请到“模型库”重新下载或导入`);
  const buf = await blob.arrayBuffer();
  const { ort, hasWebGpu } = await loadOrt();
  const eps = [];
  if (hasWebGpu && opts.preferWebGpu !== false) eps.push('webgpu');
  eps.push('wasm');
  const session = await ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: eps, graphOptimizationLevel: 'all' });
  sessionCache.set(key, session);
  return session;
}

/* --------------------------- 信号处理 --------------------------- */

/** RMS 包络，每帧（HOP）一个值，用于 protect 与 rms 混合。 */
function frameRms(pcm) {
  const n = Math.ceil(pcm.length / HOP);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const start = i * HOP;
    const end = Math.min(pcm.length, start + HOP);
    for (let j = start; j < end; j++) sum += pcm[j] * pcm[j];
    out[i] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return out;
}

/** 一维中值滤波，radius 为单侧窗口。 */
function medianFilter1d(src, radius) {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return src;
  const n = src.length;
  const out = new Float32Array(n);
  const win = new Float32Array(2 * r + 1);
  for (let i = 0; i < n; i++) {
    const len = Math.min(n, i + r + 1) - Math.max(0, i - r);
    for (let k = 0; k < len; k++) win[k] = src[Math.max(0, i - r) + k] || 0;
    // 小窗口插入排序，避免大数组排序开销
    for (let a = 1; a < len; a++) {
      const v = win[a];
      let b = a - 1;
      while (b >= 0 && win[b] > v) { win[b + 1] = win[b]; b--; }
      win[b + 1] = v;
    }
    out[i] = win[Math.floor(len / 2)];
  }
  return out;
}

/** Hz -> RVC 的 1..255 对数音高刻度；清音为 0。 */
const F0_MIN = 32.7;      // C1
const F0_MAX = 1975.5;    // B6
const F0_BINS = 256;

export function freqToBin(hz) {
  if (!hz || hz <= 0) return 0;
  const v = 1127 * Math.log2(Math.max(hz, F0_MIN) / F0_MIN);
  return Math.max(1, Math.min(F0_BINS - 1, Math.round(v)));
}

/** 线性插值补齐零值（清音段音高）。 */
function fillZeros(f0) {
  const n = f0.length;
  const out = Float32Array.from(f0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (out[i] > 0) { last = out[i]; continue; }
    if (last > 0) out[i] = last;
  }
  // 开头的清音用第一个有效值回填
  let first = 0;
  for (let i = 0; i < n; i++) if (out[i] > 0) { first = out[i]; break; }
  for (let i = 0; i < n; i++) if (f0[i] <= 0 && first > 0) out[i] = first;
  return out;
}

function tensorFrom(ort, data, shape, type = 'float32') {
  return new ort.Tensor(type, data, shape);
}

/** 交叠相加的交叉淡化。 */
function applyCrossfade(target, block, offset, fadeSamples) {
  const n = Math.min(block.length, target.length - offset);
  if (n <= 0) return;
  const fade = Math.min(fadeSamples, Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    const w = fade <= 0 ? 1 : Math.min(1, i / fade);
    target[offset + i] = target[offset + i] * (1 - w) + block[i] * w;
  }
}

/* ---------------------------- 引擎 ---------------------------- */

export class OnnxEngine {
  static id = 'onnx';
  static label = () => '浏览器引擎（ONNX）';

  /** 能力自检：能否加载 ORT、WebGPU 是否可用、模型是否齐备。 */
  async describe(modelId) {
    const info = { ok: false, backend: 'wasm', webgpu: false, missing: [], ort: false };
    try {
      const { ort, hasWebGpu } = await loadOrt();
      info.ort = true;
      info.webgpu = !!hasWebGpu;
      info.backend = hasWebGpu ? 'webgpu/wasm' : 'wasm';
    } catch (err) {
      info.error = err.message;
      return info;
    }
    if (modelId) {
      const rec = await getModel(modelId).catch(() => null);
      const need = ['hubert.onnx', 'f0.onnx', 'speaker.onnx', 'generator.onnx'];
      info.missing = need.filter((f) => !rec?.files?.[f]);
      info.ok = info.missing.length === 0;
      if (!info.ok) info.error = `缺少模型文件：${info.missing.join(', ')}`;
    } else {
      info.ok = true;
    }
    return info;
  }

  /**
   * @param {{audioBuffer: AudioBuffer, model: {id}, params: object,
   *          outSampleRate?: number, onProgress?: (p:number, label?:string)=>void}} opts
   */
  async convert(opts) {
    const { audioBuffer, model, params, outSampleRate = 0, onProgress } = opts;
    const { ort, hasWebGpu } = await loadOrt();

    const src = toMono(audioBuffer);
    const inRate = audioBuffer.sampleRate;
    if (src.length / inRate > MAX_SECONDS) {
      throw new Error(t('convert.failed', { msg: `单次转换上限 ${MAX_SECONDS} 秒，请切分音频` }));
    }

    onProgress?.(0.05, '音频重采样');
    const srcBuf = await resample(audioBuffer, SAMPLE_RATE_16K);
    const pcm = toMono(srcBuf);

    onProgress?.(0.15, '加载模型');
    const [hubert, f0Net, speaker, generator] = await Promise.all([
      getSession(model.id, 'hubert.onnx'),
      getSession(model.id, 'f0.onnx'),
      getSession(model.id, 'speaker.onnx'),
      getSession(model.id, 'generator.onnx', { preferWebGpu: false }),
    ]);

    const totalFrames = Math.floor(pcm.length / HOP);
    const out = new Float32Array(pcm.length);
    const rms = frameRms(pcm);
    const winLen = Math.floor(WIN_SECONDS * SAMPLE_RATE_16K);
    const fadeLen = Math.floor(CROSSFADE * SAMPLE_RATE_16K);

    let cursor = 0;
    let processed = 0;
    const totalBlocks = Math.max(1, Math.ceil(pcm.length / winLen));

    while (cursor < pcm.length) {
      const end = Math.min(pcm.length, cursor + winLen);
      const block = pcm.subarray(cursor, end);
      const npad = Math.ceil(block.length / HOP) * HOP;
      const padded = new Float32Array(npad);
      padded.set(block);

      // 1) 说话人嵌入
      const sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      const spkOut = (await speaker.run({ sid })).spk;
      const spk = toF32(spkOut);

      // 2) HuBERT 内容特征
      const featsOut = (await hubert.run({ audio: new ort.Tensor('float32', padded, [1, npad]) })).feats;
      const feats = toF32(featsOut);
      const frames = Math.min(totalFrames, Math.floor(npad / HOP));

      // 3) F0 提取 + 平滑 + 变调
      const f0Raw = await this.#extractF0(f0Net, ort, padded, frames);
      const shifted = new Float32Array(frames);
      const semis = Number(params.f0upKey ?? 0);
      const ratio = Math.pow(2, semis / 12);
      for (let i = 0; i < frames; i++) shifted[i] = f0Raw[i] * ratio;
      const smoothed = medianFilter1d(shifted, params.filterRadius ?? 3);

      const f0c = new Float32Array(frames);
      const uv = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        f0c[i] = freqToBin(smoothed[i]);
        uv[i] = smoothed[i] <= 0 ? 1 : 0;
      }

      // 4) protect：清音/低能量帧用说话人嵌入替换内容特征
      const mask = buildProtectMask(rms, cursor, frames, params.protect ?? 0.33);
      const c = new Float32Array(frames * 768);
      for (let i = 0; i < frames; i++) {
        const m = mask[i];
        for (let j = 0; j < 768; j++) {
          const content = feats[i * 768 + j] ?? 0;
          c[i * 768 + j] = content * m + (spk[j % spk.length] || 0) * (1 - m);
        }
      }

      // 5) 声码器
      const genOut = (await generator.run({
        c: new ort.Tensor('float32', c, [1, frames, 768]),
        f0c: new ort.Tensor('float32', f0c, [1, frames]),
        uv: new ort.Tensor('float32', uv, [1, frames]),
        sid: new ort.Tensor('int64', BigInt64Array.from([0n]), [1]),
      }));
      const wav = takeFirst(genOut);
      const blockOut = toF32(wav);

      // 6) RMS 包络混合：保留一部分原始音量变化
      const mixed = rmsMix(blockOut, rms, cursor, params.rmsMixRate ?? 0.25);

      applyCrossfade(out, mixed, cursor, fadeLen);

      processed++;
      onProgress?.(0.15 + 0.7 * (processed / totalBlocks), '合成中');
      cursor = end;
    }

    onProgress?.(0.9, '输出重采样');
    const gain = normalizeGain(out);
    for (let i = 0; i < out.length; i++) out[i] *= gain;

    const targetRate = outSampleRate || inRate || SAMPLE_RATE_16K;
    const audioOut = await floatToAudioBuffer(out, SAMPLE_RATE_16K, targetRate);
    onProgress?.(1, '完成');
    return { audio: audioOut, sampleRate: targetRate, metrics: { ms: 0, backend: hasWebGpu ? 'webgpu/wasm' : 'wasm', frames: totalFrames } };
  }

  async #extractF0(session, ort, pcm, frames) {
    const pcmToUse = pcm.length >= frames * HOP ? pcm : pcm;
    const out = (await session.run({ audio: new ort.Tensor('float32', pcmToUse, [1, pcmToUse.length]) }));
    const key = out.f0 ? 'f0' : Object.keys(out)[0];
    const flat = toF32(out[key]);
    if (flat.length === frames) return Float32Array.from(flat);
    // 帧数不一致时线性重采样到 frames
    const res = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const x = (i / frames) * flat.length;
      const i0 = Math.floor(x);
      const frac = x - i0;
      res[i] = (flat[i0] ?? 0) * (1 - frac) + (flat[Math.min(flat.length - 1, i0 + 1)] ?? 0) * frac;
    }
    return res;
  }
}

/* --------------------------- 辅助函数 --------------------------- */

/** 归一化 ORT 输出为 Float32Array（兼容 require_grad/Tensor 中 data 为 Uint8Array 的情况）。 */
function toF32(t) {
  if (!t) return new Float32Array(0);
  if (t instanceof Float32Array) return t;
  const data = t.data ?? t;
  if (data instanceof Float32Array) return data;
  const view = data instanceof Uint8Array
    ? new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    : new Float32Array(data);
  return view;
}

function takeFirst(outputs) {
  const keys = Object.keys(outputs);
  return outputs[keys[0]];
}

/** protect 掩码：能量越低保留越少的内容特征（越接近说话人嵌入）。 */
function buildProtectMask(rms, offsetFrames, frames, protect) {
  const mask = new Float32Array(frames);
  const p = Math.max(0, Math.min(1, protect));
  const strength = 0.35 + p * 1.3;     // 0.33 -> 约 0.78
  for (let i = 0; i < frames; i++) {
    const r = rms[offsetFrames + i] ?? 0;
    const voiced = Math.min(1, r / 0.06);
    mask[i] = Math.max(0, Math.min(1, voiced * strength));
  }
  return mask;
}

/** 用原始 RMS 包络修正输出音量，rmsMix=0 表示完全用合成器包络。 */
function rmsMix(out, rms, offsetFrames, rmsMix) {
  if (rmsMix <= 0) return out;
  const n = Math.min(out.length, rms.length - offsetFrames);
  const win = Math.round(SAMPLE_RATE_16K * 0.05); // 50ms 平滑
  const result = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    result[i] = i < n ? out[i] : 0;
  }
  for (let i = 0; i < n; i++) {
    const srcIdx = Math.min(rms.length - 1, offsetFrames + Math.floor(i / SAMPLE_RATE_16K * 50));
    const targetRms = rms[srcIdx];
    // 输出帧能量
    const start = Math.max(0, i - win);
    const end = Math.min(n, i + win);
    let e = 0;
    for (let j = start; j < end; j++) e += result[j] * result[j];
    e = Math.sqrt(e / Math.max(1, end - start));
    const gain = e > 1e-5 ? Math.min(2.5, (targetRms / e) * rmsMix + (1 - rmsMix)) : 1;
    result[i] *= gain;
  }
  return result;
}

/** 峰值归一化到 -1.5dBFS，避免削波。 */
function normalizeGain(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
  }
  if (peak < 1e-6) return 1;
  return Math.min(1, 0.84 / peak);
}

async function floatToAudioBuffer(pcm, fromRate, toRate) {
  const { getContext } = await import('./audio.js');
  const ctx = getContext();
  let buffer = ctx.createBuffer(1, pcm.length, fromRate);
  buffer.copyToChannel(pcm, 0);
  if (toRate !== fromRate) buffer = await resample(buffer, toRate);
  return buffer;
}

export { fillZeros };
