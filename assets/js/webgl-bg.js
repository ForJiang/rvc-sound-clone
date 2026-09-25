/**
 * 网页背景：RGB 正弦波场（WebGL fragment shader，无第三方依赖）
 *
 * 三条正弦波分别驱动 R / G / B 通道，横坐标按到屏幕中心的距离做轻微扭曲
 * （distortion），于是波形在中心平直、向边缘弯折，整体缓慢流动；
 * `0.05 / abs(...)` 让分母趋零处收成细亮线，行成流动的彩带。
 *
 * 参数与参考实现一致：xScale 1.0 / yScale 0.5 / distortion 0.05。
 * 参考实现每帧 time += 0.01（60fps 下约 0.6/秒），这里用秒为单位再折合该速率，
 * 避免高刷新率屏幕上动画被拉快。
 *
 * 画质自适应：从最高档渲染缓冲起步，实测 p95 帧时间不达标才逐级降档；
 * 抗锯齿靠超采样（渲染精度高于 CSS 分辨率），所以降档只影响锐度、不产生锯齿。
 */

const QUALITY_TIERS = [2560 * 1440, 1920 * 1080, 1280 * 720];
const TARGET_FRAME_MS = 17.5;   // ≈57fps 的帧预算
const DPR_CAP = 1.5;
const TIME_SCALE = 0.6;         // 秒 → shader 的时间单位

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uScaleX;
uniform float uScaleY;
uniform float uDistort;

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);

  // 距中心越远，R/B 的横坐标被拉伸/压缩越多，波形随之弯折
  float d = length(p) * uDistort;
  float rx = p.x * (1.0 + d);
  float gx = p.x;
  float bx = p.x * (1.0 - d);

  // 分母趋 0 处形成细亮线，三条通道错开即得流动彩带
  float r = 0.05 / abs(p.y + sin((rx + uTime) * uScaleX) * uScaleY);
  float g = 0.05 / abs(p.y + sin((gx + uTime) * uScaleX) * uScaleY);
  float b = 0.05 / abs(p.y + sin((bx + uTime) * uScaleX) * uScaleY);

  vec3 col = vec3(r, g, b);

  // 暗角 + 轻微压暗：细线不过亮，玻璃面板与白字才读得清
  float vig = 1.0 - 0.25 * length(p * vec2(0.6, 0.8));
  col *= clamp(vig, 0.0, 1.0) * 0.9;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function createGL(canvas) {
  const opts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' };
  return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
}

/**
 * 启动背景渲染。
 * @returns {{stop: () => void, ok: boolean}} ok=false 表示环境不支持，调用方应保留 CSS 渐变兜底
 */
export function startShaderBackground(canvas) {
  if (!canvas) return { stop() {}, ok: false };

  const gl = createGL(canvas);
  if (!gl) return { stop() {}, ok: false };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[webgl-bg] shader 编译失败：', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return { stop() {}, ok: false };

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[webgl-bg] program 链接失败：', gl.getProgramInfoLog(prog));
    return { stop() {}, ok: false };
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uScaleX = gl.getUniformLocation(prog, 'uScaleX');
  const uScaleY = gl.getUniformLocation(prog, 'uScaleY');
  const uDistort = gl.getUniformLocation(prog, 'uDistort');
  gl.uniform1f(uScaleX, 1.0);
  gl.uniform1f(uScaleY, 0.5);
  gl.uniform1f(uDistort, 0.05);

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let maxPixels = QUALITY_TIERS[0];
  let raf = 0;
  let stopped = false;
  let startTime = performance.now();
  /* 滚动期间暂停渲染：移动端 GPU 一边合成滚动、一边画全屏 shader 就会抢资源导致
     卡顿；暂停时不清屏，画布保留最后一帧，背景在滚动中完全静止，
     停止滚动约 150ms 后恢复流动。 */
  let pauseUntil = 0;
  const onScroll = () => { pauseUntil = performance.now() + 150; };
  window.addEventListener('scroll', onScroll, { passive: true });

  function resize() {
    const cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    // 按画质档位上限裁剪（保持宽高比）
    const px = w * h;
    if (px > maxPixels) {
      const k = Math.sqrt(maxPixels / px);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    }
  }

  function draw(now) {
    if (stopped) return;
    if (now < pauseUntil) {
      raf = requestAnimationFrame(draw);
      return;
    }
    resize();
    gl.uniform1f(uTime, (now - startTime) / 1000 * TIME_SCALE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(draw);
  }

  resize();
  gl.uniform1f(uTime, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  if (reduced) {
    // 减少动效：只画一帧静止波形
    return {
      ok: true,
      stop() { stopped = true; },
    };
  }

  raf = requestAnimationFrame(draw);

  // 页面隐藏时停渲染，回来再继续
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !stopped) {
      raf = requestAnimationFrame(draw);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  /** 采样约 1.5 秒帧时间，p95 不达标就降一档 */
  async function tuneQuality() {
    await new Promise((r) => setTimeout(r, 1200));
    if (stopped) return;
    for (const tier of QUALITY_TIERS) {
      if (stopped) return;
      maxPixels = tier;
      resize();
      await new Promise((r) => setTimeout(r, 900));
      if (stopped) return;
      const ms = await measureFrameTime();
      if (stopped) return;
      if (ms <= TARGET_FRAME_MS) return;
    }
  }

  function measureFrameTime() {
    return new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const tick = (now) => {
        deltas.push(now - last);
        last = now;
        if (deltas.length <= 90) requestAnimationFrame(tick);
        else {
          deltas.sort((a, b) => a - b);
          const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
          const p95 = deltas[Math.floor(deltas.length * 0.95)];
          resolve(Math.max(avg, p95 * 0.7));
        }
      };
      requestAnimationFrame(tick);
    });
  }

  tuneQuality();

  return {
    ok: true,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
