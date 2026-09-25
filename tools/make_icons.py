#!/usr/bin/env python3
"""按 assets/favicon.svg 的几何生成多尺寸 PNG 与多分辨率 ICO。

纯标准库：圆角矩形 SDF + smoothstep 覆盖率做抗锯齿，PNG 用 zlib 手写，
不依赖 PIL / numpy / cairosvg。改了 favicon.svg 的几何后重跑本脚本即可。

    python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

VIEW = 64.0
# 深色圆角底（左上角坐标与半径）
TILE = (1.0, 1.0, 62.0, 62.0, 15.0)
TILE_RGB = (0x0A / 255, 0x0A / 255, 0x0C / 255)
# 三条音量柱（x, y, w, h），统一圆角半径
BARS = [(17.0, 26.0, 8.0, 12.0), (28.0, 15.0, 8.0, 34.0), (39.0, 21.0, 8.0, 22.0)]
BAR_R = 4.0
# 音量柱的纵向渐变（与 SVG 的 linearGradient 一致：顶 #ffffff → 底 #c3c9d6）
GRAD_TOP = (1.0, 1.0, 1.0)
GRAD_BOT = (0xC3 / 255, 0xC9 / 255, 0xD6 / 255)

PNG_SIZES = [16, 32, 48, 180, 192, 512]
ICO_SIZES = [16, 32, 48]


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def sd_round_rect(px, py, x, y, w, h, r):
    """圆角矩形有符号距离（单位=viewBox 单位，内部为负）。"""
    qx = abs(px - (x + w / 2)) - (w / 2 - r)
    qy = abs(py - (y + h / 2)) - (h / 2 - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def coverage(dist, px_per_unit):
    """把 SVG 单位的距离换算成像素距离，1px 线性抗锯齿。"""
    return clamp(0.5 - dist * px_per_unit, 0.0, 1.0)


def render(size):
    """返回 RGBA bytes，长宽均为 size。"""
    scale = VIEW / size                 # 每像素覆盖多少 viewBox 单位
    px_per_unit = size / VIEW
    out = bytearray()
    for py_i in range(size):
        sy = (py_i + 0.5) * scale       # 像素中心的 SVG 坐标
        for px_i in range(size):
            sx = (px_i + 0.5) * scale
            tile_cov = coverage(sd_round_rect(sx, sy, *TILE), px_per_unit)
            if tile_cov <= 0.0:
                out.extend((0, 0, 0, 0))
                continue
            # 音量柱：取覆盖率最大的那一根（柱之间不重叠，等价于并集）
            best = 0.0
            for (x, y, w, h) in BARS:
                c = coverage(sd_round_rect(sx, sy, x, y, w, h, BAR_R), px_per_unit)
                if c > best:
                    best = c
            # 纵向渐变（SVG 的 y1=0 → y2=64）
            t = clamp(sy / VIEW)
            grad = tuple(GRAD_TOP[i] + (GRAD_BOT[i] - GRAD_TOP[i]) * t for i in range(3))
            rgb = tuple(TILE_RGB[i] + (grad[i] - TILE_RGB[i]) * best for i in range(3))
            a = tile_cov * 255.0
            out.extend((int(round(rgb[0] * 255)), int(round(rgb[1] * 255)),
                        int(round(rgb[2] * 255)), int(round(a))))
    return bytes(out)


def png_bytes(size, rgba):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)                    # filter: none
        raw.extend(rgba[y * stride:(y + 1) * stride])
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def ico_bytes(images):
    """images: [(size, png_bytes)]，PNG 压缩条目（Vista 及以上支持）。"""
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    dirs, blobs = b"", b""
    for size, png in images:
        dim = size if size < 256 else 0
        dirs += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        blobs += png
        offset += len(png)
    return header + dirs + blobs


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rendered = {}
    for size in PNG_SIZES:
        png = png_bytes(size, render(size))
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        with open(path, "wb") as f:
            f.write(png)
        rendered[size] = png
        print(f"icon-{size}.png  {len(png)} bytes")
    ico = ico_bytes([(s, rendered[s]) for s in ICO_SIZES])
    with open(os.path.join(OUT_DIR, "favicon.ico"), "wb") as f:
        f.write(ico)
    print(f"favicon.ico  {len(ico)} bytes（含 {', '.join(str(s) for s in ICO_SIZES)} 三档）")


if __name__ == "__main__":
    main()
