#!/usr/bin/env python3
"""构建中文词频表 vendor/freq-zh60k.txt(供候选重排的本地统计信号)。

来源(均为开放许可):
  1. jieba 内置词典 dict.txt(MIT License)按词频降序前 6 万
  2. THUOCL IT/财经词表(清华开放中文词库,免费商用,需注明出处)
     ——补充技术/金融领域词,排序在 jieba 之后(在表即有效,名次靠后只影响权重)

格式:按上述顺序每行一个词,行号即名次(offscreen.js 加载时以行号为 rank)。
可重复构建:python3 tools/build_freq_zh.py
"""
import urllib.request

JIEBA = "https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt"
THUOCL = [
    "https://raw.githubusercontent.com/thunlp/THUOCL/master/data/THUOCL_IT.txt",
    "https://raw.githubusercontent.com/thunlp/THUOCL/master/data/THUOCL_caijing.txt",
]
OUT = "vendor/freq-zh60k.txt"
TOP = 60000

def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")

def main():
    print(f"下载 {JIEBA} ...")
    entries = []
    for line in fetch(JIEBA).splitlines():
        parts = line.split(" ")
        if len(parts) >= 2 and parts[1].isdigit():
            word = parts[0]
            if len(word) >= 2 and all("\u4e00" <= c <= "\u9fff" for c in word):
                entries.append((int(parts[1]), word))
    entries.sort(key=lambda e: -e[0])
    words = [w for _, w in entries[:TOP]]
    seen = set(words)

    added = 0
    for url in THUOCL:
        print(f"下载 {url} ...")
        for line in fetch(url).splitlines():
            parts = line.split("\t")
            if not parts or not parts[0]:
                continue
            w = parts[0].strip()
            if len(w) >= 2 and w not in seen and all("\u4e00" <= c <= "\u9fff" for c in w):
                words.append(w)
                seen.add(w)
                added += 1

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# CrostiVoice 中文词频表(候选重排用)\n")
        f.write("# 来源1: jieba dict.txt (MIT) https://github.com/fxsjy/jieba — 按词频降序前 6 万\n")
        f.write("# 来源2: THUOCL IT/财经词表(清华大学开放中文词库,需注明出处)\n")
        f.write("#          https://github.com/thunlp/THUOCL — 领域补充词,排序在后\n")
        f.write("# 由 tools/build_freq_zh.py 生成,行号即名次。\n")
        for w in words:
            f.write(w + "\n")
    print(f"完成: {OUT}(jieba {min(len(words)-added, TOP)} + THUOCL 补充 {added} = {len(words)} 条)")

if __name__ == "__main__":
    main()
