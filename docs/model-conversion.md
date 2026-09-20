# 模型转换：从 .pth 到网页可用的 ONNX

浏览器引擎需要四份 ONNX 权重。页面里所有输入输出名、形状都与本文档绑定，改动任意一侧都要同步另一侧。

## 1. IO 契约

| 文件 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| `hubert.onnx` | `audio: float32[1, N]` | `feats: float32[1, T, 768]` | 16 kHz 单声道，`N = T * 320` |
| `f0.onnx` | `audio: float32[1, N]` | `f0: float32[1, T]` | 基频 Hz，清音为 0 |
| `speaker.onnx` | `sid: int64[1]` | `spk: float32[1, 768]` | 由 `emb_g` 查表得到 |
| `generator.onnx` | `c: float32[1,T,768]`、`f0c: float32[1,T]`、`uv: float32[1,T]`、`sid: int64[1]` | `audio: float32[1, M]` | `f0c` 是 1..255 的对数音高刻度，不是 Hz |

音频约定：16 kHz、单声道、帧长 320 采样（20 ms 一跳），与 RVC 训练一致。

可变维：`N` 与 `T` 用 dynamic axes，`M` 与 `T` 相关。导出时按 3.2 秒示例长度导出即可，运行时长音频时引擎会自动分块。

## 2. 运行转换

```bash
pip install torch onnx

# 音色模型
python3 tools/export_onnx.py --pth weights/MyVoice.pth --out ./MyVoice-onnx

# 基础模型（各导一次即可）
python3 tools/export_onnx.py --hubert hubert_base.pt --f0 rmvpe.pt --out ./base-onnx
```

`tools/export_onnx.py` 里对三类模型分别做了包装：

- `HuBERTWrapper`：统一 `[1, N]` 输入；HuBERT 用 fairseq 加载，RMVPE 用其原始实现。
- `SpeakerWrapper`：把 `net_g.emb_g` 暴露成 `sid -> spk`。
- `GeneratorWrapper`：把 `enc_pitch` 与 `emb_g` 前移到图内，前端只需喂内容特征和音高。

> 如果你的 checkpoint 结构不同（例如改了 `net_g` 结构），改 `GeneratorWrapper.forward` 一处即可，网页侧无需改动。

## 3. 导入网页

把输出目录里的 `hubert.onnx`、`f0.onnx`、`speaker.onnx`、`generator.onnx`（或整目录）打成 zip，在网页「模型库 → 本地导入」拖入。文件只写入浏览器 IndexedDB。

建议大小参考：HuBERT ≈ 115MB、RMVPE ≈ 180MB、generator ≈ 50MB、speaker < 1MB。

## 4. 与本地服务引擎的区别

| | 浏览器引擎 | 本地服务引擎 |
| --- | --- | --- |
| 权重格式 | ONNX | `.pth` + `.index`（官方格式） |
| 检索索引 | 暂不支持（index_rate 被忽略） | 完整支持 |
| 依赖 | ONNX Runtime Web（CDN） | 官方 RVC WebUI + server/bridge.py |
| 速度 | 受设备限制 | GPU 加速 |

## 5. 验证

用 `--mode echo` 启动桥接层，可以不走 RVC 就验证网页的音频链路：

```bash
python3 server/bridge.py --mode echo
```

在网页「设置 → 本地服务引擎 → 测试连接」显示成功后做一次转换，能原样听到输入音频即说明录制、上传、解码、播放、下载全链路正常。
