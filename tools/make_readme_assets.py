#!/usr/bin/env python3
"""CrostiVoice README 视觉资产生成器 — GitHub 双主题适配。

产出(docs/assets/):
  hero-dark.png / hero-light.png   首图横幅(产品名 + 一句话 + 特性徽章)
  pipeline.png                     三层文本管线图(暗色固定,GitHub 深浅皆可读)
  compare-dark.png / compare-light.png  四方案对比表
用法: python3 make_readme_assets.py [--light-only]
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "assets")
os.makedirs(OUT, exist_ok=True)

# ── 字体 ──
NOTO = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
NOTO_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
DEJA = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
DEJA_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf"
SC, SC_B = 2, 2  # SC index in ttc

def F(size, bold=False):
    return ImageFont.truetype(NOTO_B if bold else NOTO, size, index=SC_B if bold else SC)

def FD(size, bold=False):
    return ImageFont.truetype(DEJA_B if bold else DEJA, size)

def FM(size):
    return ImageFont.truetype(MONO, size)

# ── 调色板 ──
THEMES = {
    "dark": dict(
        bg="#0b1220", bg2="#101a2e", card="#141c2b", card2="#182236",
        line="#26314a", text="#edf1f7", text2="#9aa7b8", text3="#64748b",
        brand="#4d8dfd", brand2="#2dd4bf", green="#34d399", red="#f87171",
        yellow="#fbbf24", greenbg="#0d2b22", redbg="#2a1518", yebg="#2a2013",
        shadow="rgba",
    ),
    "light": dict(
        bg="#ffffff", bg2="#f6f8fa", card="#ffffff", card2="#f9fafc",
        line="#e2e6ee", text="#0f1720", text2="#4b5563", text3="#94a3b8",
        brand="#175cd3", brand2="#0e9bb5", green="#0a8a5f", red="#d64545",
        yellow="#b7791f", greenbg="#e7f7f0", redbg="#fdf0f0", yebg="#fdf6e9",
    ),
}

def tw(d, t, f):
    return d.textbbox((0, 0), t, font=f)[2]

def th(d, t, f):
    bb = d.textbbox((0, 0), t, font=f)
    return bb[3] - bb[1]

def rr(d, box, rad, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=width)

def ss_polygon(d, pts, fill):
    d.polygon(pts, fill=fill)

# ════════════════════════ hero 横幅 ════════════════════════
def make_hero(t, path):
    W, H = 1200, 320
    img = Image.new("RGB", (W, H), t["bg"])
    d = ImageDraw.Draw(img)
    # 微弱点阵(每 28px 一颗 1px 点,几乎不可见,提供质感)
    for yy in range(14, H, 28):
        for xx in range(14, W, 28):
            d.point((xx, yy), fill=t["line"])

    # 中央内容
    # 图标 squircle
    ic = 116; ix = (W - ic) // 2; iy = 34
    # 渐变 squircle:逐行插值 teal->blue
    grad = Image.new("RGB", (ic, ic))
    gd = ImageDraw.Draw(grad)
    c1, c2 = (14, 155, 181), (17, 79, 168)
    for y in range(ic):
        k = y / ic
        col = tuple(int(c1[j] + (c2[j] - c1[j]) * k) for j in range(3))
        gd.line([(0, y), (ic, y)], fill=col)
    mask = Image.new("L", (ic, ic), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, ic - 1, ic - 1], radius=int(ic * 0.24), fill=255)
    img.paste(grad, (ix, iy), mask)
    # 麦克风 glyph(白):胶囊+弧+柄+底座
    gx, gy = ix + ic // 2, iy + ic // 2 - 6
    mw, mh = 22, 38
    d.rounded_rectangle([gx - mw // 2, gy - mh // 2, gx + mw // 2, gy + mh // 2], radius=mw // 2, fill=(255, 255, 255))
    d.arc([gx - 30, gy - 12, gx + 30, gy + 44], start=15, end=165, fill=(255, 255, 255), width=9)
    d.rectangle([gx - 4, gy + 22, gx + 4, gy + 44], fill=(255, 255, 255))
    d.rounded_rectangle([gx - 22, gy + 46, gx + 22, gy + 54], radius=4, fill=(255, 255, 255))

    y = iy + ic + 22
    # 主标题(用 textbbox 拿完整含 descender 的高度)
    f1 = F(44, True)
    title = "CrostiVoice"
    tw1 = tw(d, title, f1)
    bb1 = d.textbbox((0, 0), title, font=f1)
    f2 = F(26, True)
    sub = "语音输入 · 说完即上屏"
    bb2 = d.textbbox((0, 0), sub, font=f2)
    d.text(((W - tw1) // 2, y), title, font=f1, fill=t["text"])
    y += (bb1[3] - bb1[1]) + 26
    d.text(((W - tw(d, sub, f2)) // 2, y), sub, font=f2, fill=t["text2"])
    y += (bb2[3] - bb2[1]) + 24

    # 特性徽章行
    badges = [
        ("本地 AI 断句", t["brand"]),
        ("同音字纠错", t["brand2"]),
        ("离线运行", t["green"]),
        ("零遥测", t["green"]),
        ("MIT 开源", t["text3"]),
    ]
    fb = F(17, True)
    pad_x, pad_y, gap = 16, 9, 12
    widths = [tw(d, s, fb) + pad_x * 2 for s, _ in badges]
    total = sum(widths) + gap * (len(badges) - 1)
    bx = (W - total) // 2
    for (s, col), w in zip(badges, widths):
        rr(d, [bx, y, bx + w, y + 34], 17, outline=col, width=2)
        d.text((bx + pad_x, y + 7), s, font=fb, fill=col)
        bx += w + gap
    img.save(path)
    print("hero →", path)

# ════════════════════════ 管线图 ════════════════════════
def make_pipeline(t, path):
    W, H = 1200, 560
    img = Image.new("RGB", (W, H), t["bg"])
    d = ImageDraw.Draw(img)

    fx = W // 2
    # 顶部输入
    f_lbl = F(21, True)
    f_sub = F(16)
    f_n = FD(20, True)
    inp = "识别结果:无标点长串"
    wi = tw(d, inp, f_lbl) + 48
    rr(d, [fx - wi // 2, 26, fx + wi // 2, 74], 12, fill=t["card"], outline=t["line"], width=1)
    d.text((fx - tw(d, inp, f_lbl) // 2, 38), inp, font=f_lbl, fill=t["text"])

    stages = [
        ("1", "规则引擎", "永远在线 · 零下载", ["连接词切分", "口述标点", "中英混排空格"], t["green"], "兜底保底"),
        ("2", "本地神经模型", "可选下载 · 完全离线", ["语义标点断句", "同音字纠错", "毫秒~亚秒级"], t["brand"], "质量跃升"),
        ("3", "Chrome 内置 AI", "可选 · Chromebook Plus", ["深度口语整理", "去除口癖", "Gemini Nano"], t["brand2"], "书面化"),
    ]
    y = 118
    bh = 96
    for n, name, meta, feats, col, tagline in stages:
        # 箭头(上一元素到此)
        d.line([(fx, y - 26), (fx, y - 6)], fill=t["text3"], width=3)
        ss_polygon(d, [(fx - 7, y - 12), (fx + 7, y - 12), (fx, y)], fill=t["text3"])
        # 卡片
        cw = 560
        x0 = fx - cw // 2
        rr(d, [x0, y, x0 + cw, y + bh], 14, fill=t["card"], outline=t["line"], width=1)
        # 左侧色条
        rr(d, [x0, y, x0 + 8, y + bh], 4, fill=col)
        # 序号圆
        rr(d, [x0 + 24, y + 18, x0 + 56, y + 50], 16, fill=col)
        d.text((x0 + 33, y + 24), n, font=f_n, fill="#ffffff" if t is THEMES["light"] else "#0b1220")
        # 标题 + meta
        f_t = F(24, True)
        d.text((x0 + 70, y + 14), name, font=f_t, fill=t["text"])
        d.text((x0 + 70 + tw(d, name, f_t) + 14, y + 22), meta, font=F(15), fill=t["text3"])
        # 特性(同一行)
        fx2 = x0 + 70
        fy = y + 58
        for ft in feats:
            wft = tw(d, ft, F(15)) + 22
            rr(d, [fx2, fy, fx2 + wft, fy + 27], 13, fill=t["card2"], outline=t["line"], width=1)
            d.text((fx2 + 11, fy + 5), ft, font=F(15), fill=t["text2"])
            fx2 += wft + 10
        y += bh + 32
    # 降级标注(右侧)
    y2 = 118
    for _, tag in [(1, ""), (2, "任一层不可用 → 自动降级"), (3, "")]:
        y2 += bh + 32
    d.text((fx + 300, 118 + bh + 40), "任一层不可用 → 自动降级,输入永不中断", font=F(15), fill=t["text3"])

    # 输出
    d.line([(fx, y - 26), (fx, y - 6)], fill=t["text3"], width=3)
    ss_polygon(d, [(fx - 7, y - 12), (fx + 7, y - 12), (fx, y)], fill=t["text3"])
    out = "标点完整 · 无口癖的书面文字 → 光标处"
    wo = tw(d, out, F(22, True)) + 56
    rr(d, [fx - wo // 2, y, fx + wo // 2, y + 58], 14, fill=t["greenbg"], outline=t["green"], width=2)
    d.text((fx - tw(d, out, F(22, True)) // 2, y + 16), out, font=F(22, True), fill=t["green"])
    img.save(path)
    print("pipeline →", path)

# ════════════════════════ 对比表 ════════════════════════
def make_compare(t, path):
    cols = ["", "CrostiVoice", "系统语音输入", "云端听写", "浏览器扩展"]
    rows = [
        ("中文断句",   ("win", "语义级·神经模型"), ("lose", "基本无标点"), ("part", "尚可·依赖厂商"), ("lose", "面向英文")),
        ("同音字纠错", ("win", "上下文纠错+词典"), ("lose", "无"), ("part", "部分内置"), ("lose", "无")),
        ("音频去向",   ("win", "不接触音频"), ("part", "Google 服务"), ("lose", "全程上传"), ("lose", "多数上云")),
        ("断网可用",   ("win", "是·模型离线"), ("lose", "否"), ("lose", "否"), ("lose", "多数否")),
        ("热词词典",   ("win", "JSON 导入导出"), ("lose", "无"), ("part", "多为会员功能"), ("lose", "罕见")),
        ("费用",       ("win", "免费·MIT"), ("win", "随系统免费"), ("lose", "订阅解锁"), ("part", "混杂")),
        ("账号/遥测",  ("win", "无"), ("part", "绑 Google"), ("lose", "须登录"), ("part", "看厂商")),
        ("源码可审计", ("win", "GitHub 公开"), ("lose", "闭源"), ("lose", "闭源"), ("lose", "多数闭源")),
    ]
    # 布局
    W = 1200
    pad = 26
    col0 = 190
    colw = (W - pad * 2 - col0) // 4
    head_h = 64
    row_h = 56
    H = pad * 2 + head_h + row_h * len(rows) + 44  # 底部留白给底注
    img = Image.new("RGB", (W, H), t["bg"])
    d = ImageDraw.Draw(img)
    x0, y0 = pad, pad

    # 表容器
    rr(d, [x0, y0, W - pad, H - pad], 16, fill=t["card"], outline=t["line"], width=1)

    # 表头
    f_h = F(19, True)
    hy = y0
    # CrostiVoice 列高亮
    cv_x = x0 + col0 + colw * 0
    rr(d, [cv_x, hy, cv_x + colw, hy + head_h + row_h * len(rows)], 0, fill=(21, 30, 48) if t is THEMES["dark"] else "#f0f5ff")
    # 重绘容器边(被填充盖住的部分)
    rr(d, [x0, y0, W - pad, H - pad], 16, outline=t["line"], width=1)
    hh = ["", "CrostiVoice", "系统语音", "云端听写", "浏览器扩展"]
    for i, h in enumerate(hh):
        cx = x0 + col0 + colw * (i - 1) if i > 0 else x0
        if i == 0: continue
        col = t["brand"] if i == 1 else t["text2"]
        d.text((cx + (colw - tw(d, h, f_h)) // 2, hy + 20), h, font=f_h, fill=col)
    d.line([(x0, hy + head_h), (W - pad, hy + head_h)], fill=t["line"], width=1)

    # 行
    f_c = F(16, True)
    f_v = F(15)
    TAGCOL = {"win": ("✓", t["green"]), "part": ("~", t["yellow"]), "lose": ("✕", t["red"])}
    for r, (cat, *cells) in enumerate(rows):
        ry = hy + head_h + r * row_h
        if r % 2 == 1:
            rr(d, [x0 + 1, ry, W - pad - 1, ry + row_h], 0, fill=t["card2"])
        # 类别
        d.text((x0 + 18, ry + row_h // 2 - 11), cat, font=f_c, fill=t["text2"])
        # 分隔线
        d.line([(x0, ry), (W - pad, ry)], fill=t["line"], width=1)
        for i, (tag, val) in enumerate(cells):
            cx = x0 + col0 + colw * i
            mark, col = TAGCOL[tag]
            # 图标
            mx = cx + 22
            my = ry + row_h // 2
            colbg = t["greenbg"] if tag == "win" else (t["yebg"] if tag == "part" else t["redbg"])
            rr(d, [mx - 11, my - 11, mx + 11, my + 11], 11, fill=colbg)
            fm_ = FD(14, True)
            d.text((mx - tw(d, mark, fm_) // 2, my - 8), mark, font=fm_, fill=col)
            d.text((mx + 20, my - 10), val, font=f_v, fill=t["text"] if tag == "win" else t["text2"])
    # 底注
    note = "完整 11 项对比 → pmparker.net/crostivoice/vs/"
    nf = F(14)
    nb = d.textbbox((0, 0), note, font=nf)
    d.text((W - pad - tw(d, note, nf), H - (nb[3] - nb[1]) - 8), note, font=nf, fill=t["text3"])
    img.save(path)
    print("compare →", path)

if __name__ == "__main__":
    light_too = "--light-only" not in sys.argv and True
    make_hero(THEMES["dark"], os.path.join(OUT, "hero-dark.png"))
    make_pipeline(THEMES["dark"], os.path.join(OUT, "pipeline.png"))
    make_compare(THEMES["dark"], os.path.join(OUT, "compare-dark.png"))
    if light_too:
        make_hero(THEMES["light"], os.path.join(OUT, "hero-light.png"))
        make_compare(THEMES["light"], os.path.join(OUT, "compare-light.png"))
    print("DONE")
