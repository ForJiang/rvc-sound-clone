# 架构说明

```
┌──────────────────────────── 浏览器（纯静态） ────────────────────────────┐
│ index.html                                                            │
│  ├─ assets/css/style.css                                               │
│  └─ assets/js/                                                         │
│      ├─ app.js            hash 路由 + 启动引导                         │
│      ├─ state.js          设置/共享状态 + 引擎工厂                      │
│      ├─ i18n.js           中英文案                                      │
│      ├─ ui.js             DOM/toast/模态框/波形/ZIP                    │
│      ├─ audio.js          录音、解码、重采样、WAV 编码、播放器           │
│      ├─ store.js          IndexedDB（模型 Blob + 设置）                │
│      ├─ catalog.js        models/manifest.json + 本地索引合并           │
│      ├─ engine-onnx.js    ONNX Runtime Web 推理流水线                   │
│      ├─ engine-server.js  本地服务 HTTP 客户端                          │
│      └─ views/            convert / models / settings / help            │
│                                                                        │
│  IndexedDB: 模型权重 Blob、用户设置                                     │
│  Cache/CDN : onnxruntime-web、fflate（解压 zip 包）                     │
└────────────────────────────────────────────────────────────────────────┘
                │                          │
        浏览器内推理                HTTP + CORS
                │                          │
┌───────────────▼──────────┐   ┌────────────▼─────────────────────────┐
│ 4 × ONNX 权重             │   │ server/bridge.py（Python 标准库）     │
│ hubert / f0 / speaker /   │   │  ├─ /api/health   上游与音色自检     │
│ generator                 │   │  └─ /api/convert  转发 + 协议翻译    │
└───────────────────────────┘   └────────────┬─────────────────────────┘
                                             │ HTTP JSON
                                  ┌──────────▼───────────────────────┐
                                  │ 官方 RVC WebUI（api.py :5555）   │
                                  │ /pld_id_get、/infer_dev           │
                                  └──────────────────────────────────┘
```

## 为什么是两套引擎

RVC 的完整推理链（HuBERT 内容特征 + RMVPE 音高 + 检索索引 + HiFiGAN 声码器）在浏览器里跑 WASM/WebGPU 是可行的，但需要把权重转成 ONNX，且首次下载体积大、长音频速度受限。所以：

- **浏览器引擎**：零安装、隐私最好，适合短音频和尝鲜；
- **本地服务引擎**：复用官方实现，音质与速度最好，适合重度使用。

两套引擎实现同一个 `convert()` 接口，视图层无感知。

## 数据流

1. 录音/上传 → `AudioContext.decodeAudioData` → `AudioBuffer`
2. `resample()` 到 16 kHz → `encodeWav()` 得到 WAV Blob
3. 引擎推理：
   - ONNX：`pcm` → `f0.onnx` → 变调/平滑/分桶 → `hubert.onnx` → 与 `speaker.onnx` 融合（protect）→ `generator.onnx` → 输出
   - server：WAV base64 → bridge → RVC → 返回 WAV base64
4. `AudioBuffer` 回放；`encodeWav()` 导出；`makeZip()` 批量打包

## 存储

- IndexedDB `rvc-sound-clone/models`：模型文件 Blob（`keyPath: id`）
- IndexedDB `rvc-sound-clone/kv`：`{ k: 'settings', v: Settings }`
- localStorage：语言、主题

## 视觉系统

与 [Image Metadata Cleaner](https://forjiang.github.io/image-metadata-cleaner/) 同一套设计变量：
底色 `#0a0a0c`，玻璃面板 `rgba(13,14,18,.62)` + 白色 9% 描边 + `backdrop-blur(16px)`，
圆角 22/14/9px，主 CTA 近白底深色字，内嵌表面用白色低透明度叠加（而非黑色凹槽）。

`assets/js/webgl-bg.js` 用自研 WebGL fragment shader 画 RGB 正弦波背景：三条正弦波分别驱动
R/G/B 通道，横坐标按到屏幕中心的距离做 distortion 扭曲，`0.05 / abs(...)` 把分母趋零处收成
细亮线，形成缓慢流动的彩带；参数为 xScale 1.0 / yScale 0.5 / distortion 0.05。
内容统一压在玻璃面板上保证可读性。背景渲染带画质自适应档位（2560×1440 起步，p95 帧时间超标才降档），
`prefers-reduced-motion` 下静态成一帧，WebGL 不可用时回落到 CSS 渐变。

移动端另有三处适配：画布 CSS 高度用 `100lvh` 而非 `100%`（地址栏收放会改变视口高度，
用 `100%` 会让画布反复重算尺寸、波形被拉伸跳动，`lvh` 取两种状态里的较大值，可见区域始终稳定）；
`≤860px` 时把玻璃面板的 `backdrop-filter` 从 16px 降到 6px；
触屏设备滚动期间通过 passive scroll 监听暂停渲染（不清屏、保留最后一帧，停下约 150ms 后恢复），
把 GPU 让给页面合成。

滚动暂停只在触屏主设备（`hover: none`）上启用。桌面端指针精密、GPU 也够用，若也暂停，
连续滑动时 scroll 事件密集到达会让暂停一再续期，背景整段停住；松手时动画时钟已走完整个手势时长，
波形在一帧内前跳——即「背景突然静止、卡顿」。暂停期与切后台期的时长会从动画时钟里扣掉，
恢复时波形从原处继续。移动端暂停本身保留（那是省 GPU 的本意），只把恢复前跳消掉。

### 内容块入场

每张卡片都有一个上浮入场（`opacity: 0 → 1` + `translateY(30px → 0)`，0.5s），
按页面里的 DOM 顺序错峰浮现。实现分两半：

- `assets/js/app.js` 的 `staggerEnter()` 在路由渲染完后遍历内容块，把延迟写进
  每个块的 `--enter-delay`（0.05s 起步、每块错 0.05s、封顶 0.9s），并打上 `.enter`。
- `style.css` 里 `.view .enter` 读这个变量播 `rise` 关键帧。

为什么不直接写 `.view > *` + `nth-child`：四个视图的挂载结构差别很大（help 整页裹在
`.doc` 里、convert 多套一层 `.grid`、models 要再深一层），按直接子元素猜层级命中的
全是外壳，卡片本身一动不动。所以改成按块类型列出选择器（`.card` / `.step-card` /
`.page-title` / `.doc > section` / `.panel` 等），模型库的页签栏与表格类名与别处共用，
单独用 `.panel` 打标。

两点约束：只标路由初始渲染出来的块，交互中动态加进来的卡片不会突然淡入；
`.enter` 不能嵌套（父子都套动画位移会叠加），所以模型库的来源网格不打 `.panel`，
让里面每张 `.card` 自己上浮。`prefers-reduced-motion: reduce` 下整条关掉，
内容直接呈现。

### 站点图标

图标分两套底，都由 `tools/make_icons.py` 从 `assets/favicon.svg` 的几何光栅化生成
（圆角矩形 SDF + 覆盖率抗锯齿，纯标准库，不依赖 PIL / cairosvg）：

- **圆角渐变底**——`rx=14`（64 viewBox 的 22%）+ 左上 `#2a2c33` 到右下 `#101114` 的斜向渐变，
  用于 favicon 与 manifest。与 image-metadata-cleaner 同一套；纯深色底压在深色标签栏上看不出
  圆角轮廓，略亮的渐变底才让它在 16px 下依然分明。四角透明。
- **直角站点底色**（`#0a0a0c`）整幅不透明——只有 `apple-touch-icon`（icon-180）用这一套。
  iOS 会自己给 apple-touch-icon 套一层圆角 mask，源图预先裁圆会被二次裁切，透明角还会透出
  用户桌面壁纸，所以那一档必须保持直角整幅不透明。

主 favicon 以 base64 内联在 `index.html` 里：浏览器把 favicon 按页面 URL 缓存在自己的
favicon 数据库中，只换文件 URL 甚至改 `?v=` 都不重取，内联可保证已打开的标签页也能拿到新图。

## 部署

纯静态。默认走 GitHub Pages 的「分支部署」：push 到 `main` 即发布仓库根目录，无需构建。
自定义域名或想改用 Actions 部署时，参考 `docs/deploy-actions-optional.yml`。

## 已知取舍

- 浏览器引擎暂不解析 FAISS `.index` 文件，`index_rate` 在该引擎下被忽略（界面有提示）。
- protect 的实现是近似版：按帧 RMS 决定「用内容特征还是说话人嵌入」，与官方按清音段 padding 的做法效果接近但不等价。
- ONNX Runtime 通过 CDN 加载。完全离线使用时请把 `ort.all.min.mjs` 与 `dist/*.wasm` 放到 `assets/vendor/` 并改 `engine-onnx.js` 顶部的 `ORT_URL` / `ORT_WASM`。
