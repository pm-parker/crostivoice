#!/usr/bin/env python3
"""构建字级 n-gram 语言模型表 vendor/ngram-zh.txt(候选路径重排的统计信号)。

设计:LLM 的核心机制是"下一 token 的条件概率";本表是其最小可行本地版——
字级 1/2/3/4-gram 条件概率,stupid backoff。用于段级格架 Viterbi 重排。

语料(按语体适配选择,口说/新闻/网络文体优先):
  1. chinese-c4(shjwudp/chinese-c4,CC BY 4.0)——简体中文网络文本,主语料
  2. 中文维基百科(HF wikimedia/wikipedia)——百科补充,繁转简后合并

要点(踩坑修正,见 docs/quality-local.md):
  - 必须 t2s 归一(zh 维基繁简混写,简体计数被繁体分流)
  - 必须含一元频次:2-gram 回退需要 P(c|a)=cnt(ab)/cnt(a),
    否则低阶全落常数,关键判别点(数字/树的)打分相同
  - 维基单用会导致语体错配(百科文体里"数字"频率远低于口说)

产物格式(TSV,四段):<阶><TAB>n-gram<TAB>频次
可重复构建:python3 tools/build_ngram_zh.py
"""
import collections
import os
import re
import urllib.request

C4_PARQUET = "https://huggingface.co/datasets/shjwudp/chinese-c4/resolve/refs%2Fconvert%2Fparquet/default/partial-train/0000.parquet"
WIKI_PARQUET = "https://huggingface.co/datasets/wikimedia/wikipedia/resolve/refs%2Fconvert%2Fparquet/20231101.zh/train/0000.parquet"
OUT = "vendor/ngram-zh.txt"
MAX_CHARS = 120_000_000   # 统计字符上限(两语料合计;统计饱和即止)
TOP = {1: 12_000, 2: 80_000, 3: 300_000, 4: 450_000}
CLEAN = re.compile(r"[^\u4e00-\u9fff]+")

def fetch(url, path):
    if not os.path.exists(path):
        urllib.request.urlretrieve(url, path)

def iter_runs(paths, t2s):
    import pyarrow.parquet as pq
    for path in paths:
        pf = pq.ParquetFile(path)
        for batch in pf.iter_batches(batch_size=2000, columns=["text"]):
            for col in batch.column(0).to_pylist():
                if not col:
                    continue
                for run in CLEAN.split(t2s.convert(col)):
                    yield run

def main():
    from opencc import OpenCC
    t2s = OpenCC("t2s")
    c4 = "/tmp/opencode/c4-zh-0.parquet"
    wiki = "/tmp/opencode/wiki-zh-0000.parquet"
    print("下载/复用语料 ...")
    fetch(C4_PARQUET, c4)
    if not os.path.exists(wiki):
        pass  # 维基可缺省:C4 不可得时的备源
    paths = [c4] + ([wiki] if os.path.exists(wiki) else [])

    counts = {1: collections.Counter(), 2: collections.Counter(), 3: collections.Counter(), 4: collections.Counter()}
    chars = 0
    for run in iter_runs(paths, t2s):
        if len(run) < 2:
            counts[1][run] += 1
            continue
        if len(run) >= 4:
            chars += len(run)
            c1, c2, c3, c4c = counts[1], counts[2], counts[3], counts[4]
            for i in range(len(run) - 3):
                c4c[run[i:i+4]] += 1
                c3[run[i:i+3]] += 1
                c2[run[i:i+2]] += 1
                c1[run[i]] += 1
            c3[run[-3:]] += 1
            c2[run[-3:-1]] += 1
            c2[run[-2:]] += 1
            c1[run[-1]] += 1
            c1[run[-2]] += 1
            c1[run[-3]] += 1
        if chars > MAX_CHARS:
            break
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# CrostiVoice 字级 n-gram 语言模型表(候选路径重排用)\n")
        f.write("# 语料: chinese-c4 (CC BY 4.0) + 中文维基百科 (CC BY-SA 4.0),t2s 归一\n")
        f.write("# 格式: <阶><TAB>n-gram<TAB>频次;由 tools/build_ngram_zh.py 生成\n")
        for n in (1, 2, 3, 4):
            for gram, cnt in counts[n].most_common(TOP[n]):
                f.write(f"{n}\t{gram}\t{cnt}\n")
    print(f"完成: {OUT}(语料 {chars/1e6:.0f}M 字符,一二三四元各留 {TOP[1]//1000}k/{TOP[2]//1000}k/{TOP[3]//1000}k/{TOP[4]//1000}k)")

if __name__ == "__main__":
    main()
