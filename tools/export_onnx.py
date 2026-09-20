#!/usr/bin/env python3
"""
把 RVC 的 .pth（及 HuBERT / RMVPE 的 .pt）导出成网页引擎所需的四份 ONNX。

网页端 IO 契约（与 assets/js/engine-onnx.js 严格一致）：

  hubert.onnx      audio : float32[1, N]      -> feats : float32[1, T, 768]
  f0.onnx          audio : float32[1, N]      -> f0    : float32[1, T]        (Hz，0 表示清音)
  speaker.onnx     sid   : int64[1]           -> spk   : float32[1, 768]
  generator.onnx   c: f32[1,T,768], f0c: f32[1,T], uv: f32[1,T], sid: int64[1]
                                                     -> audio : float32[1, M] 或 [M]

音频约定：16 kHz 单声道，帧长 320 采样（20 ms 一跳），与 RVC 训练配置一致。

用法：
  pip install torch onnx
  python3 tools/export_onnx.py --pth weights/MyVoice.pth --out ./my-voice-onnx
  python3 tools/export_onnx.py --hubert hubert_base.pt --f0 rmvpe.pt --out ./base-models

然后把输出目录里的 *.onnx 打成一个 zip，在网页“模型库 → 导入”里拖进去即可。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import torch
    import torch.nn as nn
except ImportError:  # pragma: no cover
    sys.exit("需要先安装依赖：pip install torch onnx")

HOP = 320            # 采样数 / 帧
SR = 16000           # 采样率
EMB_DIM = 768        # 内容特征维度
F0_BINS = 256        # RVC 的 1..255 对数音高刻度


# --------------------------------------------------------------------------
# 包装模块：把 RVC 原有的 ckpt["model"] / ckpt["embedder"] 变成单输入单输出图
# --------------------------------------------------------------------------

class HuBERTWrapper(nn.Module):
    """HuBERT/RMVPE 特征提取入口：统一按 [1, N] 输入。"""

    def __init__(self, model: nn.Module, is_f0: bool = False):
        super().__init__()
        self.model = model
        self.is_f0 = is_f0

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        # 不同实现的入参形式略有差异，这里兼容两种常见签名
        if hasattr(self.model, "extract_features"):
            out = self.model.extract_features(audio)
        else:
            out = self.model(audio)
        if isinstance(out, (tuple, list)):
            out = out[0]
        # f0 分支输出 [1, T]；特征分支输出 [1, T, 768]
        if out.dim() == 3:
            out = out.transpose(1, 2).contiguous()
        return out.float()


class SpeakerWrapper(nn.Module):
    """emb_g：说话人嵌入查找表。"""

    def __init__(self, net_g: nn.Module):
        super().__init__()
        self.emb_g = getattr(net_g, "emb_g", None)
        if self.emb_g is None:
            raise ValueError("checkpoint 中找不到 net_g.emb_g，无法导出 speaker.onnx")

    def forward(self, sid: torch.Tensor) -> torch.Tensor:
        return self.emb_g(sid).squeeze(1).float()  # [1, 768]


class GeneratorWrapper(nn.Module):
    """合成器：把 enc_pitch 与 emb_g 前移，前端只需喂 c / f0c / uv / sid。"""

    def __init__(self, net_g: nn.Module):
        super().__init__()
        self.net_g = net_g
        self.emb_g = net_g.emb_g
        self.enc_pitch = net_g.enc_pitch
        self.enc_q = getattr(net_g, "enc_q", None)

    def forward(self, c: torch.Tensor, f0c: torch.Tensor, uv: torch.Tensor, sid: torch.Tensor) -> torch.Tensor:
        # RVC 的原始 infer 路径：c = content*mask + spk*(1-mask)，f0 走 enc_pitch
        spk = self.emb_g(sid).unsqueeze(-1)          # [1, 768, 1]
        c = c.transpose(1, 2) + spk                   # [1, 768, T]
        pitch = self.enc_pitch(f0c.unsqueeze(1), uv)  # [1, C, T]
        audio = self.net_g.infer(c, pitch) if hasattr(self.net_g, "infer") else self.net_g(c, pitch)
        if isinstance(audio, (tuple, list)):
            audio = audio[0]
        return audio.squeeze().unsqueeze(0).float()   # [1, M]


# --------------------------------------------------------------------------
# 导出逻辑
# --------------------------------------------------------------------------

def load_rvc(pth_path: str):
    if not os.path.isfile(pth_path):
        sys.exit(f"找不到 checkpoint：{pth_path}")
    ckpt = torch.load(pth_path, map_location="cpu", weights_only=False)
    if isinstance(ckpt, dict) and "model" in ckpt:
        net_g = ckpt["model"]
    else:
        net_g = ckpt
    if isinstance(net_g, dict):  # 训练中途保存的 state_dict，需要先实例化
        sys.exit("该 .pth 只包含权重，请使用完整训练的 checkpoint（含 model 结构）")
    net_g.eval()
    for p in net_g.parameters():
        p.requires_grad_(False)
    return net_g


def export_onnx(module: nn.Module, dummy: tuple[torch.Tensor, ...], out: Path,
                input_names: list[str], output_names: list[str], dynamic_axes: dict) -> None:
    torch.onnx.export(
        module,
        dummy,
        str(out),
        input_names=input_names,
        output_names=output_names,
        opset_version=17,
        do_constant_folding=True,
        dynamic_axes=dynamic_axes,
    )
    print(f"  ✓ {out.name}  ({out.stat().st_size / 1024 / 1024:.1f} MB)")


def export_voice(pth_path: str, out_dir: Path) -> None:
    print(f"[voice] {pth_path}")
    net_g = load_rvc(pth_path).float()

    frames = 160            # 3.2 秒的示例长度（20 ms 一帧）
    sid = torch.zeros(1, dtype=torch.long)
    c = torch.randn(1, frames, EMB_DIM)
    f0c = torch.randint(1, F0_BINS, (1, frames)).float()
    uv = torch.zeros(1, frames)

    export_onnx(
        SpeakerWrapper(net_g), (sid,), out_dir / "speaker.onnx",
        ["sid"], ["spk"], {"sid": {0: "batch"}},
    )
    export_onnx(
        GeneratorWrapper(net_g), (c, f0c, uv, sid), out_dir / "generator.onnx",
        ["c", "f0c", "uv", "sid"], ["audio"],
        {"c": {0: "batch", 1: "frames"}, "f0c": {0: "batch", 1: "frames"},
         "uv": {0: "batch", 1: "frames"}, "audio": {0: "batch", 1: "samples"}},
    )


def export_base(hubert_pt: str | None, f0_pt: str | None, out_dir: Path, arch: str) -> None:
    if hubert_pt:
        print(f"[base] hubert <- {hubert_pt}")
        model = _load_backbone(hubert_pt, arch)
        audio = torch.randn(1, SR * 3)
        export_onnx(
            HuBERTWrapper(model, is_f0=False), (audio,), out_dir / "hubert.onnx",
            ["audio"], ["feats"], {"audio": {1: "n"}, "feats": {1: "frames"}},
        )
    if f0_pt:
        print(f"[base] rmvpe <- {f0_pt}")
        model = _load_backbone(f0_pt, "rmvpe")
        audio = torch.randn(1, SR * 3)
        export_onnx(
            HuBERTWrapper(model, is_f0=True), (audio,), out_dir / "f0.onnx",
            ["audio"], ["f0"], {"audio": {1: "n"}, "f0": {1: "frames"}},
        )


def _load_backbone(path: str, arch: str) -> nn.Module:
    """加载 HuBERT / RMVPE；不同版本实现类名不同，这里做一次兼容尝试。"""
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    state = ckpt.get("model", ckpt) if isinstance(ckpt, dict) else ckpt

    if arch == "hubert":
        try:
            from fairseq.checkpoint_utils import load_model_ensemble_and_task  # noqa: WPS433
            models, _cfg, _task = load_model_ensemble_and_task(files=[path])
            return models[0].eval()
        except Exception as err:  # pragma: no cover
            print(f"  ! fairseq 方式加载失败（{err}），改用通用加载")
    return _GenericBackbone(state)


class _GenericBackbone(nn.Module):
    """把权重包一层前向，供没有原始实现类的场景占位使用。

    注意：真正生产环境建议直接复用官方仓库的模型类，
    """

    def __init__(self, state: dict):
        super().__init__()
        self.weight = nn.Parameter(torch.zeros(1))
        self._state = state

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        raise NotImplementedError(
            "通用占位导出不可用：请在官方 RVC 仓库环境中调用其模型类完成导出"
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="导出 RVC 网页引擎所需 ONNX")
    ap.add_argument("--pth", help="音色模型 checkpoint（.pth）")
    ap.add_argument("--hubert", help="hubert_base.pt 路径")
    ap.add_argument("--f0", help="rmvpe.pt 路径")
    ap.add_argument("--arch", default="hubert", choices=["hubert", "contentvec"])
    ap.add_argument("--out", default="./onnx-out", help="输出目录")
    args = ap.parse_args()

    if not (args.pth or args.hubert or args.f0):
        ap.error("至少指定 --pth / --hubert / --f0 之一")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.pth:
        export_voice(args.pth, out_dir)
    if args.hubert or args.f0:
        export_base(args.hubert, args.f0, out_dir, args.arch)

    print(f"\n完成：{out_dir.resolve()}")
    print("下一步：把这些 .onnx 打包成 zip，在网页“模型库 → 导入本地模型”中拖入。")


if __name__ == "__main__":
    main()
