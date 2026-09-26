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
 * 清晰度：波形是按归一化坐标生成的，与渲染分辨率无关，所以「多给像素」只会让细亮线
 * 更锐、不会改变画面。DPR_CAP 决定要不要按屏幕实拍密度渲染——小于 devicePixelRatio
 * 时浏览器会把画布放大，细线立刻发虚。档位上限同样如此：宁可留给 tuneQuality 去降，
 * 也不要一开始就欠采样。
 *
 * 画质自适应：从最高档渲染缓冲起步，实测 p95 帧时间不达标才逐级降档；
 * 抗锯齿靠超采样（渲染精度高于 CSS 分辨率），所以降档只影响锐度、不产生锯齿。
 */

// 档位是「渲染缓冲的总像素上限」，从高到低；降档只掉锐度不产生锯齿
const QUALITY_TIERS = [3840 * 2160, 2560 * 1440, 1600 * 900];
const TARGET_FRAME_MS = 17.5;   // ≈57fps 的帧预算
const DPR_CAP = 2;              // 按屏幕实拍密度渲染；低于 devicePixelRatio 会被浏览器放大
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

  /* 渲染缓冲能不能开到这个尺寸，最终由 GL 的上限说话。档位和 DPR_CAP 只是期望值，
     真超过了 drawArrays 会静默失败（画面上什么都不显示），所以在设尺寸前先夹一道。 */
  const glMaxW = gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.[0] || 8192;
  const glMaxH = gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.[1] || 8192;

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let maxPixels = QUALITY_TIERS[0];
  let raf = 0;
  let stopped = false;
  let startTime = performance.now();
  let lastNow = startTime;
  /* 滚动期间暂停渲染：触屏设备 GPU 一边合成滚动、一边画全屏 shader 就会抢资源导致
     卡顿；暂停时不清屏，画布保留最后一帧，背景在滚动中完全静止，
     停止滚动约 150ms 后恢复流动。
     只对触屏主设备（hover: none）启用——桌面端指针精密、GPU 也够用，
     一旦暂停反而会看到背景「突然停住」，得不偿失。
     暂停期间动画时钟一并停走，恢复后波形从原处继续，不会往前跳。 */
  const pauseWhileScrolling = window.matchMedia?.('(hover: none)').matches === true;
  let pauseUntil = 0;    // 暂停截止时刻
  let pauseStart = 0;    // 本次暂停起点，0 表示当前不在暂停
  let pausedMs = 0;      // 累计被暂停的毫秒数
  const onScroll = () => {
    if (!pauseStart) pauseStart = performance.now();
    pauseUntil = performance.now() + 150;
  };
  if (pauseWhileScrolling) window.addEventListener('scroll', onScroll, { passive: true });

  /* 画布尺寸：CSS 是 width:100% + height:100lvh，两者都由视口决定，
     所以只在「盒子尺寸真的变了」时重算即可。用 ResizeObserver 而不是每帧读
     clientWidth/clientHeight——每帧读布局属性会强制同步 layout，
     滚动和入场动画期间白搭一次重排，纯粹是浪费。
     老浏览器退回 resize / orientationchange 事件。 */
  let lastW = 0;
  let lastH = 0;
  function applySize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    // GL 上限兜底：超了 drawArrays 会静默失败，画面直接全黑
    if (w > glMaxW || h > glMaxH) {
      const k = Math.min(glMaxW / w, glMaxH / h);
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    // 按画质档位上限裁剪（保持宽高比）
    const px = w * h;
    if (px > maxPixels) {
      const k = Math.sqrt(maxPixels / px);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
  }

  function measureFromCanvas() {
    applySize(
      Math.max(1, canvas.clientWidth || window.innerWidth),
      Math.max(1, canvas.clientHeight || window.innerHeight),
    );
  }

  /** ResizeObserver 的 entry 自带盒子尺寸，读它不触发 layout。 */
  function measureFromEntry(entry) {
    let w = 0, h = 0;
    if (entry.contentBoxSize && entry.contentBoxSize[0]) {
      w = entry.contentBoxSize[0].inlineSize;
      h = entry.contentBoxSize[0].blockSize;
    } else if (entry.contentRect) {
      w = entry.contentRect.width;
      h = entry.contentRect.height;
    }
    if (w && h) applySize(Math.max(1, w), Math.max(1, h));
    else measureFromCanvas();
  }

  measureFromCanvas();

  /* ResizeObserver 管「盒子尺寸变了」。resize / orientationchange 仍然要听——
     devicePixelRatio 变化时（窗口拖到另一块屏幕、改系统显示缩放）CSS 尺寸并没变，
     ResizeObserver 不会触发，得靠 resize 事件按新 DPR 重算；老浏览器也只有事件可用。 */
  let sizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    sizeObserver = new ResizeObserver((entries) => {
      for (const e of entries) measureFromEntry(e);
    });
    sizeObserver.observe(canvas);
  }
  window.addEventListener('resize', measureFromCanvas);
  window.addEventListener('orientationchange', measureFromCanvas);

  function draw(now) {
    if (stopped) return;
    if (now < pauseUntil) {
      lastNow = now;
      raf = requestAnimationFrame(draw);
      return;
    }
    // 刚结束一段暂停：把这段时间从动画时钟里扣掉
    if (pauseStart) { pausedMs += now - pauseStart; pauseStart = 0; }
    lastNow = now;
    gl.uniform1f(uTime, (now - startTime - pausedMs) / 1000 * TIME_SCALE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(draw);
  }

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
      // 后台这些时间没有渲染，从动画时钟里扣掉，切回来时波形不会前跳
      if (lastNow) { pausedMs += performance.now() - lastNow; pauseStart = 0; }
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
      measureFromCanvas();   // 档位变了，按新上限重算一次缓冲尺寸
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
      window.removeEventListener('resize', measureFromCanvas);
      window.removeEventListener('orientationchange', measureFromCanvas);
      document.removeEventListener('visibilitychange', onVisibility);
      if (typeof ResizeObserver === 'function') sizeObserver?.disconnect();
    },
  };
}
