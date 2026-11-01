#!/usr/bin/env python3
"""构建中文词频表 vendor/freq-zh60k.txt(供候选重排的本地统计信号)。

数据来源:jieba 内置词典 dict.txt(MIT License,https://github.com/fxsjy/jieba)
格式:`词 词频 词性`。本脚本按词频降序取前 6 万条,只保留词,
文件按频率从高到低排列,行号即名次(offscreen.js 加载时以行号为 rank)。

可重复构建:python3 tools/build_freq_zh.py
"""
import urllib.request

SRC = "https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt"
OUT = "vendor/freq-zh60k.txt"
TOP = 60000

def main():
    print(f"下载 {SRC} ...")
    with urllib.request.urlopen(SRC, timeout=60) as r:
        raw = r.read().decode("utf-8")
    entries = []
    for line in raw.splitlines():
        parts = line.split(" ")
        if len(parts) >= 2 and parts[1].isdigit():
            word = parts[0]
            # 只保留 2 字及以上、纯 CJK 的词(单字与符号对重排无增益)
            if len(word) >= 2 and all("\u4e00" <= c <= "\u9fff" for c in word):
                entries.append((int(parts[1]), word))
    entries.sort(key=lambda e: -e[0])
    top = entries[:TOP]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# CrostiVoice 中文词频表(候选重排用)\n")
        f.write("# 来源: jieba dict.txt (MIT License) https://github.com/fxsjy/jieba\n")
        f.write("# 按词频降序;行号即名次。由 tools/build_freq_zh.py 生成。\n")
        for _, w in top:
            f.write(w + "\n")
    print(f"完成: {OUT}({len(top)} 条,总条目 {len(entries)})")

if __name__ == "__main__":
    main()
