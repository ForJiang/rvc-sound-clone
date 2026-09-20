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

## 部署

纯静态。推送到 GitHub 后，`.github/workflows/deploy.yml` 会构建并发布到 GitHub Pages。没有构建步骤、没有依赖安装，workflow 只做「拷贝 + 发布」。

## 已知取舍

- 浏览器引擎暂不解析 FAISS `.index` 文件，`index_rate` 在该引擎下被忽略（界面有提示）。
- protect 的实现是近似版：按帧 RMS 决定「用内容特征还是说话人嵌入」，与官方按清音段 padding 的做法效果接近但不等价。
- ONNX Runtime 通过 CDN 加载。完全离线使用时请把 `ort.all.min.mjs` 与 `dist/*.wasm` 放到 `assets/vendor/` 并改 `engine-onnx.js` 顶部的 `ORT_URL` / `ORT_WASM`。
