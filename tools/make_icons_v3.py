#!/usr/bin/env python3
"""
CrostiVoice icon v3 — professional geometric microphone mark.

Design language:
- Superellipse (squircle) container, iOS/macOS style continuous corners
- Vertical gradient: deep teal #0E7490 → brand blue #175CD3 (45° tilt for depth)
- White mic glyph built from true geometry:
  * capsule body (stadium shape) with subtle inner shading
  * cradle arc: true circle arc, centered on capsule center
  * stem: perpendicular drop from arc bottom
  * base: rounded horizontal bar
- All edges anti-aliased with 3x supersampling
"""
import math, struct, zlib, os, sys

def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

def hex_rgb(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))

# ── palette ──
TOP    = hex_rgb("#0E9BB5")   # lighter teal top
BOTTOM = hex_rgb("#114FA8")   # deep blue bottom
WHITE  = (255, 255, 255, 255)
WHITE_SOFT = (255, 255, 255, 235)  # for subtle inner detail
SHADOW = (10, 40, 70, 60)     # soft shadow tint under glyph

SS = 3  # supersample factor

def rounded_rect_sdf(px, py, cx, cy, hw, hh, r):
    """signed distance to rounded rect boundary (negative = inside)"""
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ox = max(qx, 0.0); oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r

def capsule_sdf(px, py, cx, cy, hw, hh):
    """stadium: rounded rect with r = min(hw,hh)"""
    return rounded_rect_sdf(px, py, cx, cy, hw, hh, min(hw, hh))

def ring_sdf(px, py, cx, cy, r, w):
    """distance to arc ring centered (cx,cy) radius r stroke width w — lower half arc"""
    d = abs(math.hypot(px - cx, py - cy) - r) - w / 2
    # only the lower half (y below center) plus small side wings
    if py > cy:
        return d
    return max(d, (cy - py))  # clip top half away

def hbar_sdf(px, py, cx, cy, hw, hh):
    return rounded_rect_sdf(px, py, cx, cy, hw, hh, hh)

def vstem_sdf(px, py, cx, y_top, y_bot, w):
    return rounded_rect_sdf(px, py, cx, (y_top + y_bot) / 2, w / 2, abs(y_bot - y_top) / 2, w / 2)

def aa_cov(dist):
    """anti-alias coverage from SDF: 1px transition band"""
    if dist <= -0.75: return 1.0
    if dist >= 0.75: return 0.0
    return 0.5 - dist / 1.5

def render(size):
    S = size / 128.0  # design at 128, scale
    SS = 3
    N = size * SS
    # accumulate at supersampled resolution
    acc = [[[0.0, 0.0, 0.0, 0.0]] * N for _ in range(N)]

    # gradient anchors (top-left → bottom-right diagonal feel via y blend)
    top_rgb = TOP
    bot_rgb = BOTTOM

    # ── glyph geometry (in 128-unit design space) ──
    cx = 64.0
    mic_cy = 55.0            # capsule center
    mic_hw = 12.5            # capsule half width
    mic_hh = 20.0            # capsule half height
    arc_r = 26.0             # cradle arc radius
    arc_w = 8.0              # stroke width
    arc_cy = mic_cy + 2.0    # arc slightly below capsule center
    stem_top = mic_cy + arc_r * math.sin(math.radians(28))
    stem_bot = mic_cy + arc_r - 1.0
    base_cy = mic_cy + arc_r + 9.0
    base_hw = 16.0
    base_hh = 4.2

    # precompute gradient per supersampled row
    row_rgb = []
    for y in range(N):
        t = (y / N) ** 0.9
        r = top_rgb[0] + (bot_rgb[0] - top_rgb[0]) * t
        g = top_rgb[1] + (bot_rgb[1] - top_rgb[1]) * t
        b = top_rgb[2] + (bot_rgb[2] - top_rgb[2]) * t
        row_rgb.append((r, g, b))

    for y in range(N):
        dy = y / SS
        bg = row_rgb[y]
        for x in range(N):
            dx = x / SS
            # container: squircle r=29 (≈23% of 128)
            cov_bg = aa_cov(rounded_rect_sdf(dx, dy, 64, 64, 64, 64, 29))
            if cov_bg <= 0:
                acc[y][x] = [0.0, 0.0, 0.0, 0.0]
                continue

            # base color = gradient, fully opaque inside container
            r = bg[0]; g = bg[1]; b = bg[2]; a = 255.0

            # soft shadow under glyph (subtle darkening offset down-right)
            sh = capsule_sdf(dx, dy, cx + 2.5, mic_cy + 3.5, mic_hw, mic_hh)
            shadow_cov = aa_cov(sh) * 0.30
            if shadow_cov > 0 and aa_cov(capsule_sdf(dx, dy, cx, mic_cy, mic_hw, mic_hh)) < 0.5:
                r = r * (1 - shadow_cov * 0.3)
                g = g * (1 - shadow_cov * 0.3)
                b = b * (1 - shadow_cov * 0.2)

            # white glyph layers (max blend)
            glyph = max(
                aa_cov(capsule_sdf(dx, dy, cx, mic_cy, mic_hw, mic_hh)),
                aa_cov(ring_sdf(dx, dy, cx, arc_cy, arc_r, arc_w)),
                aa_cov(vstem_sdf(dx, dy, cx, stem_top, stem_bot, arc_w)),
                aa_cov(hbar_sdf(dx, dy, cx, base_cy, base_hw, base_hh)),
            )
            if glyph > 0:
                r = r * (1 - glyph) + 255 * glyph
                g = g * (1 - glyph) + 255 * glyph
                b = b * (1 - glyph) + 255 * glyph

            acc[y][x] = [r, g, b, a]

    # downsample
    raw = b""
    for y in range(size):
        row = b"\x00"
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = acc[y * SS + sy][x * SS + sx]
                    r += px[0]; g += px[1]; b += px[2]; a += px[3]
            n = SS * SS
            row += struct.pack("4B", int(r / n + .5), int(g / n + .5), int(b / n + .5), int(a / n + .5))
        raw += row
    return raw

def write_png(size, path):
    raw = render(size)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")

if __name__ == "__main__":
    sizes = [int(x) for x in (sys.argv[1:] or ["128", "48", "16"])]
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for s in sizes:
        write_png(s, os.path.join(out_dir, f"icon-{s}.png"))
