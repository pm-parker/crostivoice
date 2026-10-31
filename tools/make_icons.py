#!/usr/bin/env python3
"""Generate CrostiVoice extension icons (16/48/128 px) as real PNG files.
Hand-rolled PNG encoder (IHDR + IDAT + IEND) — no external deps."""
import struct, zlib, math, os

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

def make_png(size, path):
    # canvas: transparent
    px = [[(0, 0, 0, 0)] * size for _ in range(size)]
    cx = cy = (size - 1) / 2
    R = size * 0.48                       # outer circle radius
    mic_w = size * 0.20                   # microphone body half-width
    mic_h = size * 0.26                   # microphone body half-height
    arc_r = size * 0.30                   # mic arc radius
    # gradient background circle: teal -> deep blue
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy)
            if d <= R:
                t = (y / size) ** 0.5
                r = int(13 + (10 - 13) * t)
                g = int(148 + (76 - 148) * t)
                b = int(136 + (158 - 136) * t)
                a = 255
                # rounded-square mask (squircle-ish)
                m = max(abs(x - cx), abs(y - cy))
                if m > R * 0.92:
                    if d > R * 0.86:
                        continue  # clip corners -> rounded look
                px[y][x] = (r, g, b, a)
    # microphone body (rounded capsule), white
    for y in range(size):
        for x in range(size):
            if abs(x - cx) <= mic_w:
                ny = (y - cy) / mic_h
                nx = (x - cx) / mic_w
                if nx * nx + ny * ny <= 1.0:
                    px[y][x] = (255, 255, 255, 255)
    # microphone arc (cradle), white, 2px-ish stroke
    stroke = max(1, size // 24)
    for a_deg in range(20, 161):
        a = math.radians(a_deg)
        for s in range(-stroke // 2, stroke // 2 + 1):
            x = int(cx + arc_r * math.cos(a) + s * math.cos(a))
            y = int(cy - arc_r * math.sin(a) * 0.9 + s * math.sin(a) * 0.1)
            if 0 <= x < size and 0 <= y < size:
                px[y][x] = (255, 255, 255, 255)
    # stand: vertical stem + base
    stem_x = int(cx)
    for y in range(int(cy + mic_h * 0.9), int(cy + arc_r * 0.95)):
        for dx in range(-(stroke // 2) + 1, stroke // 2 + 1):
            x = stem_x + dx
            if 0 <= x < size and 0 <= y < size:
                px[y][x] = (255, 255, 255, 255)
    base_y = int(cy + arc_r * 0.95)
    base_half = int(arc_r * 0.55)
    for dx in range(-base_half, base_half + 1):
        for dy in range(0, max(2, size // 20)):
            x, y = int(cx) + dx, base_y + dy
            if 0 <= x < size and 0 <= y < size:
                px[y][x] = (255, 255, 255, 255)
    # encode PNG (RGBA, 8-bit)
    raw = b""
    for row in px:
        raw += b"\x00" + b"".join(struct.pack("4B", *p) for p in row)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size}, {len(png)} bytes)")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 48, 128):
        make_png(s, os.path.join(OUT, f"icon-{s}.png"))
