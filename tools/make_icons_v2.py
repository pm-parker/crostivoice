#!/usr/bin/env python3
"""CrostiVoice icons — geometric mic glyph on brand gradient squircle.
Replaces the hand-drawn curves with clean linear geometry (lucide-mic style)."""
import struct, zlib, math, os, sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

def aa_circle(d, R):
    """anti-aliased coverage for point at distance d from center, radius R"""
    if d <= R - 0.75: return 1.0
    if d >= R + 0.75: return 0.0
    return max(0.0, min(1.0, (R + 0.75 - d) / 1.5))

def aa_rounded_rect(x, y, cx, cy, hw, hh, r):
    """anti-aliased coverage inside rounded rect"""
    dx = abs(x - cx) - (hw - r)
    dy = abs(y - cy) - (hh - r)
    if dx <= 0 and dy <= 0:
        # inner region
        if dx > -r and dy > -r:
            pass
        return 1.0
    dx = max(dx, 0); dy = max(dy, 0)
    d = math.hypot(dx, dy) - r
    # coverage over [−0.75, 0.75]
    if d >= 0.75: return 0.0
    if d <= -0.75: return 1.0
    return 0.5 - d / 1.5

def render(size):
    px = [[(0.0, 0.0, 0.0, 0.0)] * size for _ in range(size)]
    s = size / 128.0
    cx = cy = size / 2

    # ── background: rounded square (r = 28% of size), vertical gradient teal→blue ──
    R = size * 0.5
    hw = hh = size * 0.5
    cr = size * 0.225
    for y in range(size):
        for x in range(size):
            a = aa_rounded_rect(x + .5, y + .5, cx, cy, hw, hh, cr)
            if a <= 0: continue
            t = y / size
            r = 26 + (23 - 26) * t      # #1a94bc → #17619e mix
            g = int(148 + (97 - 148) * t)
            b = int(188 + (158 - 188) * t)
            px[y][x] = (r, g, b, a)

    def blend(x, y, col, alpha):
        if not (0 <= x < size and 0 <= y < size): return
        r0, g0, b0, a0 = px[y][x]
        na = alpha + a0 * (1 - alpha)
        if na == 0: return
        px[y][x] = (
            (col[0] * alpha + r0 * a0 * (1 - alpha)) / na,
            (col[1] * alpha + g0 * a0 * (1 - alpha)) / na,
            (col[2] * alpha + b0 * a0 * (1 - alpha)) / na,
            na,
        )

    WHITE = (255, 255, 255)
    stroke = max(2, round(9 * s))          # ~9px @128
    def disc(x, y, rad, col, alpha=1.0):
        x0, x1 = int(x - rad - 2), int(x + rad + 3)
        y0, y1 = int(y - rad - 2), int(y + rad + 3)
        for yy in range(max(0, y0), min(size, y1)):
            for xx in range(max(0, x0), min(size, x1)):
                cov = aa_circle(math.hypot(xx + .5 - x, yy + .5 - y), rad)
                if cov > 0: blend(xx, yy, col, alpha * cov)
    def ring_seg(x, y, rad, a0deg, a1deg, col, w):
        steps = max(24, int((a1deg - a0deg) * rad / 2))
        for i in range(steps + 1):
            a = math.radians(a0deg + (a1deg - a0deg) * i / steps)
            disc(x + rad * math.cos(a), y - rad * math.sin(a), w / 2, col)

    mx, my = cx, cy - size * 0.06
    mic_w = size * 0.105          # capsule half-width
    mic_h = size * 0.16           # capsule half-height
    arc_r = size * 0.21
    stem_len = size * 0.075
    base_half = size * 0.115
    base_t = max(2, round(8 * s))

    # capsule (rounded mic body)
    top_y = my - mic_h + mic_w
    bot_y = my + mic_h - mic_w
    disc(mx, top_y, mic_w, WHITE)
    disc(mx, bot_y, mic_w, WHITE)
    rect_hw = mic_w
    rect_hh = (bot_y - top_y) / 2
    for yy in range(int(top_y) - 1, int(bot_y) + 2):
        for xx in range(int(mx - rect_hw) - 1, int(mx + rect_hw) + 2):
            a = aa_rounded_rect(xx + .5, yy + .5, mx, (top_y + bot_y) / 2, rect_hw, rect_hh, rect_hw)
            if a > 0: blend(xx, yy, WHITE, a)

    # arc cradle (from 200° to 340°, i.e. lower half) + stem + base
    ring_seg(mx, my, arc_r, 205, 335, WHITE, stroke)
    # stem: from arc bottom to base
    for yy in range(int(my + arc_r * math.sin(math.radians(25))), int(my + arc_r) + 1):
        for xx in range(int(mx - stroke / 2) - 1, int(mx + stroke / 2) + 2):
            a = aa_rounded_rect(xx + .5, yy + .5, mx, yy, stroke / 2, 0.5, 1)
            if a > 0: blend(xx, yy, WHITE, a)
    # base bar (rounded)
    for yy in range(int(my + arc_r), int(my + arc_r + base_t)):
        for xx in range(int(mx - base_half) - 1, int(mx + base_half) + 2):
            a = aa_rounded_rect(xx + .5, yy + .5, mx, yy + base_t / 2, base_half, base_t / 2, base_t / 2)
            if a > 0: blend(xx, yy, WHITE, a)

    # encode
    raw = b""
    for row in px:
        raw += b"\x00" + b"".join(
            struct.pack("4B", int(r_ * a_ + .5) if False else int(min(255, r_)) , int(min(255, g_)), int(min(255, b_)), int(min(255, a_ * 255)))
            for (r_, g_, b_, a_) in row
        )
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    return png

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 48, 128):
        p = os.path.join(OUT, f"icon-{s}.png")
        with open(p, "wb") as f:
            f.write(render(s))
        print("wrote", p)
