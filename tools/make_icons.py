#!/usr/bin/env python3
"""按 assets/favicon.svg 的几何生成多尺寸 PNG 与多分辨率 ICO。

纯标准库：圆角矩形 SDF + smoothstep 覆盖率做抗锯齿，PNG 用 zlib 手写，
不依赖 PIL / numpy / cairosvg。改了 favicon.svg 的几何后重跑本脚本即可。

    python3 tools/make_icons.py

图标分为两种底：
- 圆角渐变底（rx=14，左上 #2a2c33 → 右下 #101114），用于 favicon 与 manifest；
  圆角四角是透明的，压在深色标签栏上才有圆角轮廓。
- 直角站点底色（#0a0a0c）整幅不透明，只给 apple-touch-icon：iOS 自己会套圆角
  mask，预先裁圆的源图会被二次裁切，透明角还会透出桌面壁纸。
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

VIEW = 64.0
# 深色底：左上角坐标、宽高、圆角半径，以及左上→右下的斜向渐变（与 SVG 的 tile 渐变一致）
TILE = (0.0, 0.0, 64.0)
TILE_R = 14.0
TILE_A = (0x2A / 255, 0x2C / 255, 0x33 / 255)
TILE_B = (0x10 / 255, 0x11 / 255, 0x14 / 255)
# apple-touch-icon 专用：直角 + 单一站点底色。iOS 会自己套一层圆角 mask，
# 源图预先裁圆角会被二次裁切，透明角还会透出用户桌面壁纸。
FLAT_TILE = (0x0A / 255, 0x0A / 255, 0x0C / 255)
# 三条音量柱（x, y, w, h），统一圆角半径
BARS = [(17.0, 26.0, 8.0, 12.0), (28.0, 15.0, 8.0, 34.0), (39.0, 21.0, 8.0, 22.0)]
BAR_R = 4.0
# 音量柱的纵向渐变（与 SVG 的 linearGradient 一致：顶 #ffffff → 底 #c3c9d6）
GRAD_TOP = (1.0, 1.0, 1.0)
GRAD_BOT = (0xC3 / 255, 0xC9 / 255, 0xD6 / 255)

PNG_SIZES = [16, 32, 48, 180, 192, 512]
ICO_SIZES = [16, 32, 48]


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else 1.0


def sd_round_rect(px, py, x, y, w, h, r):
    """圆角矩形有符号距离（单位=viewBox 单位，内部为负）。"""
    qx = abs(px - (x + w / 2)) - (w / 2 - r)
    qy = abs(py - (y + h / 2)) - (h / 2 - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def coverage(dist, px_per_unit):
    """把 SVG 单位的距离换算成像素距离，1px 线性抗锯齿。"""
    return clamp(0.5 - dist * px_per_unit, 0.0, 1.0)


def tile_rgb(sx, sy):
    """底色：斜向渐变。渐变轴是 (0,0)→(1,1)，投影参数即 (u+v)/2。"""
    t = (sx + sy) / (2.0 * VIEW)
    return tuple(TILE_A[i] + (TILE_B[i] - TILE_A[i]) * clamp(t) for i in range(3))


def render(size, tile_r=TILE_R, flat=False):
    """返回 RGBA bytes，长宽均为 size。flat=True 时输出直角整幅不透明的底。"""
    scale = VIEW / size                 # 每像素覆盖多少 viewBox 单位
    px_per_unit = size / VIEW
    x, y, w = TILE
    out = bytearray()
    for py_i in range(size):
        sy = (py_i + 0.5) * scale       # 像素中心的 SVG 坐标
        for px_i in range(size):
            sx = (px_i + 0.5) * scale
            tile_cov = coverage(sd_round_rect(sx, sy, x, y, w, w, tile_r), px_per_unit)
            if tile_cov <= 0.0:
                out.extend((0, 0, 0, 0))
                continue
            # 音量柱：取覆盖率最大的那一根（柱之间不重叠，等价于并集）
            best = 0.0
            for (bx, by, bw, bh) in BARS:
                c = coverage(sd_round_rect(sx, sy, bx, by, bw, bh, BAR_R), px_per_unit)
                if c > best:
                    best = c
            # 纵向渐变（SVG 的 y1=0 → y2=64）
            t = clamp(sy / VIEW)
            grad = tuple(GRAD_TOP[i] + (GRAD_BOT[i] - GRAD_TOP[i]) * t for i in range(3))
            base = FLAT_TILE if flat else tile_rgb(sx, sy)
            rgb = tuple(base[i] + (grad[i] - base[i]) * best for i in range(3))
            a = 255.0 if flat else tile_cov * 255.0
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
        # 180 是 apple-touch-icon：直角 + 整幅不透明，交给 iOS 去套圆角
        flat = size == 180
        png = png_bytes(size, render(size, tile_r=0.0 if flat else TILE_R, flat=flat))
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        with open(path, "wb") as f:
            f.write(png)
        rendered[size] = png
        print(f"icon-{size}.png  {len(png)} bytes{'（直角整幅不透明，apple-touch-icon 用）' if flat else ''}")
    ico = ico_bytes([(s, rendered[s]) for s in ICO_SIZES])
    with open(os.path.join(OUT_DIR, "favicon.ico"), "wb") as f:
        f.write(ico)
    print(f"favicon.ico  {len(ico)} bytes（含 {', '.join(str(s) for s in ICO_SIZES)} 三档）")


if __name__ == "__main__":
    main()
