/**
 * 本地服务引擎：把转换请求转发给运行在你机器上的 RVC 服务（server/bridge.py）。
 *
 * HTTP 协议（约定见 docs/architecture.md）：
 *   GET  {base}/api/health -> { ok, service, upstream, models: string[] }
 *   POST {base}/api/convert
 *        body   { audio: <base64 wav>, sample_rate, model, out_sample_rate,
 *                 params: { f0up_key, index_rate, protect, rms_mix_rate, filter_radius } }
 *        result { audio: <base64 wav>, sample_rate, metrics: { ms } }
 */

export class ServerEngine {
  static id = 'server';
  static label = () => '本地服务引擎';

  constructor({ url = 'http://127.0.0.1:7865', signal } = {}) {
    this.base = url.replace(/\/+$/, '');
    this.signal = signal;
  }

  async health() {
    const res = await this.#fetch('/api/health', { method: 'GET', timeout: 6000 });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || 'bridge reported not ok');
    return data;
  }

  async listModels() {
    const data = await this.health();
    return data.models || [];
  }

  /**
   * @param {{wav: Blob, sampleRate: number, model: object, outSampleRate: number,
   *          params: object, onProgress?: (p:number, label?:string)=>void}} opts
   * @returns {{audio: AudioBuffer, sampleRate: number, metrics: object}}
   */
  async convert(opts) {
    const { wav, sampleRate, model, outSampleRate = 0, params, onProgress } = opts;
    onProgress?.(0.08, '上传音频');
    const audio = await blobToBase64(wav);

    onProgress?.(0.25, '服务端推理');
    const res = await this.#fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio,
        sample_rate: sampleRate,
        model: model ? { name: model.name, id: model.id } : null,
        out_sample_rate: outSampleRate,
        params: {
          f0up_key: params.f0upKey ?? 0,
          index_rate: params.indexRate ?? 0.75,
          protect: params.protect ?? 0.33,
          rms_mix_rate: params.rmsMixRate ?? 0.25,
          filter_radius: params.filterRadius ?? 3,
        },
      }),
      timeout: 300000,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    onProgress?.(0.9, '解码输出');
    const bytes = base64ToBytes(data.audio);
    const audioBuffer = await decodePcm(bytes);
    return {
      audio: audioBuffer,
      sampleRate: data.sample_rate || audioBuffer.sampleRate,
      metrics: data.metrics || {},
    };
  }

  async #fetch(path, { timeout = 15000, ...init } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(this.base + path, { ...init, signal: ctrl.signal });
      return res;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`请求超时（${Math.round(timeout / 1000)}s）：${this.base}${path}`);
      }
      throw new Error(`无法连接 ${this.base}${path}：${err.message}。静态页面跨域访问本地服务时，请先启动 server/bridge.py`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------- 小工具 ------------------------- */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const buf = fr.result;
      let binary = '';
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      resolve(btoa(binary));
    };
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsArrayBuffer(blob);
  });
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function decodePcm(bytes) {
  // 复用 audio.js 的解码器：WAV 走纯 JS 解析，不依赖浏览器解码能力
  const { decode } = await import('./audio.js');
  return decode(bytes.buffer.slice(0));
}
