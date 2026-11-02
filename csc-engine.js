// CrostiVoice — CSC engine: Chinese spelling correction (macbert4csc, int8).
// Single forward pass per utterance (~0.4s on CPU). Downloaded on demand,
// persisted in Cache API — same lifecycle as the punctuation model.

import {
  AutoTokenizer,
  AutoModelForMaskedLM,
  env,
} from "./vendor/transformers.web.min.js";

const V = (f) => new URL(`./vendor/${f}`, import.meta.url).toString();
env.allowLocalModels = false;
// wasm 是扩展自带文件(chrome-extension://),Cache API 按规范只接受 http(s)
// 请求,transformers.js 的 wasm 预缓存必然抛 "Request scheme 'chrome-extension'
// is unsupported"(实测复现)。本地文件无需缓存,关掉预加载路径,wasm 由 ORT
// 直接从扩展 URL 加载。
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: V("ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: V("ort-wasm-simd-threaded.asyncify.wasm"),
};
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const CACHE_NAME = "crostivoice-csc-v1";
const REPO = "Xenova/macbert4csc-base-chinese";
// remote file → cache key
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
  "onnx/model_quantized.onnx",
];
// 下载源:自建 CDN 优先(国内无翻墙可达),HuggingFace 兜底。
// Cache key 始终用 HuggingFace 规范 URL —— 已下载用户零迁移零重下。
const HF_ORIGIN = "https://huggingface.co";
const MIRROR_ORIGIN = "https://pmparker.net/crostivoice/models";

const REMOTE = (f) => `${HF_ORIGIN}/${REPO}/resolve/main/${f}`;

async function fetchWithFallback(canonicalUrl) {
  const candidates = canonicalUrl.startsWith(HF_ORIGIN)
    ? [MIRROR_ORIGIN + "/" + REPO + "/resolve/main/" + canonicalUrl.split("/resolve/main/")[1], canonicalUrl]
    : [canonicalUrl];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} (${new URL(url).hostname})`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("download failed");
}

let tokenizer = null;
let model = null;

// transformers.js v4 在模块加载时捕获 fetch 引用,monkey-patch self.fetch
// 对它无效(实测:离线加载会直连 HuggingFace 挂起)。官方数据源钩子是
// env.customCache(match/put)——在离线加载时把 HuggingFace URL 映射到
// 我们预先下载好的 Cache API 条目。
env.useCustomCache = true;
env.customCache = {
  match: async (url) => (await cachedResponse(String(url))) || undefined,
  put: async (url, response) => {
    await (await caches.open(CACHE_NAME)).put(String(url), response);
  },
};

export function isCscReady() {
  return !!tokenizer && !!model;
}

async function cachedResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(url);
}

export async function isCscCached() {
  const cache = await caches.open(CACHE_NAME);
  for (const f of FILES) {
    if (!(await cache.match(REMOTE(f)))) return false;
  }
  return true;
}

export async function deleteCsc() {
  tokenizer = null;
  model = null;
  if ("caches" in self) await caches.delete(CACHE_NAME);
}

async function downloadToCache(url, onProgress) {
  const res = await fetchWithFallback(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(loaded, total);
  }
  await (await caches.open(CACHE_NAME)).put(
    url,
    new Response(new Blob(chunks), { headers: res.headers })
  );
}

async function loadFromCachePublic() {
  if (isCscReady()) return;
  try {
    // 模型文件已由 installCsc 预下载进 Cache API(规范 URL 为键),
    // transformers.js 经 env.customCache 读它们(见上方注释),不再联网。
    tokenizer = await AutoTokenizer.from_pretrained(REPO);
    model = await AutoModelForMaskedLM.from_pretrained(REPO, { dtype: "q8" });
  } catch (err) {
    tokenizer = null;
    model = null;
    throw err;
  }
}

export async function installCsc(onProgress) {
  if (await isCscCached()) {
    if (onProgress) onProgress(1, 1, "cached");
  } else {
    let done = 0;
    for (const f of FILES) {
      const url = REMOTE(f);
      await downloadToCache(url, (loaded, total) => {
        if (onProgress) onProgress(loaded, total || 1, f);
      });
      done++;
      if (onProgress) onProgress(done, FILES.length, "files");
    }
  }
  await loadFromCachePublic();
  return true;
}

export async function tryInitCsc() {
  if (isCscReady()) return true;
  if (!(await isCscCached())) return false;
  try {
    await loadFromCachePublic();
    return true;
  } catch (err) {
    console.warn("[cv] csc load failed:", err);
    tokenizer = null;
    model = null;
    return false;
  }
}

// token-level argmax correction (macbert4csc inference = replace every token
// with the model's prediction; correct tokens map to themselves)
//
// v0.17.1 重写输出管线(浏览器实测暴露三问题,见 docs/quality-local.md):
//  1. decode(skip_special_tokens) 会把模型预测的特殊 token 静默丢掉 →
//     孤立语气词被整体吃掉("嗯"→"","一丁"→"一")。
//  2. decode 在 CJK 与数字/标点间插空格("第3章"→"第 3 章"),ASCII 大写被
//     lowercase(词表全小写,"A型血"→"a型血")。
//  3. 代词过度纠错:他→她 p 可达 0.935,而真纠错 因→应 仅 0.881 —— 概率
//     分不开,只能保守:置信度门槛 0.96(挡住全部观测到的 他→她,保住
//     门→们 0.999 / 汽→气 0.994)。错改比漏改更伤信任。
// 方案:按字对齐合并 —— 输出保留原文骨架(空格/大小写/标点原样),只在
// 对应位置是"高置信汉字→汉字"替换时才换字。长度不齐(含 emoji/[UNK] 等
// 不可对齐字符)整体放弃纠错,原文安全返回。
export async function correct(text) {
  if (!isCscReady()) return text;
  const raw = String(text || "");
  // 纯 ASCII/标点/空文本经 tokenizer 后 token_ids 为空数组,模型直接抛
  // "token_ids must be a non-empty array of integers"(实测)。这类文本
  // 本就不需要同音纠错,直接原样返回。
  const clean = raw.replace(/[\s\u3002\uFF0C\uFF1F\uFF01\uFF1A\uFF1B\u3001,_.?!;:~'"()[\]{}<>@#$%^&*+=/\\|-]/g, "");
  if (!clean) return text;
  if (!/[\u4e00-\u9fff]/.test(clean)) return text; // 无汉字 → 纠错无意义
  const inputs = tokenizer(raw, { truncation: true, max_length: 120 });
  // 守卫(token 级):分词后无内容 token(仅 [CLS][SEP])→ 原样返回。
  // 不依赖输入级启发式猜测 tokenizer 会丢弃哪些字符。
  const ids = inputs.input_ids?.data;
  if (!ids || ids.length < 3) return raw;
  const { logits } = await model(inputs);
  const dims = logits.dims;
  const VV = dims[2];
  const data = logits.data;
  const out = [];
  const probs = []; // 每位置 argmax 的 softmax 概率(置信度门槛用)
  for (let i = 1; i < ids.length - 1; i++) {
    const off = i * VV;
    let best = 0;
    let bestV = -Infinity;
    for (let v = 0; v < VV; v++) {
      const val = data[off + v];
      if (val > bestV) {
        bestV = val;
        best = v;
      }
    }
    // p = exp(max)/Σexp(x) = 1/Σexp(x-max)(bestV 即行最大值)
    let sum = 0;
    for (let v = 0; v < VV; v++) sum += Math.exp(data[off + v] - bestV);
    out.push(best);
    probs.push(1 / sum);
  }
  // 守卫(输出级):预测序列为空 → decode 必抛 token_ids 错,原样返回
  if (!out.length) return raw;
  let decoded;
  try {
    decoded = tokenizer.decode(out, { skip_special_tokens: true });
  } catch {
    return raw; // "token_ids must be a non-empty array" 的最后防线
  }
  // 按字对齐:decode 的空格是插入物,双方都剥掉空格后逐码点对齐。
  // 长度不齐(emoji/[UNK] 被丢弃、模型输出增生)→ 放弃纠错保原文。
  const dChars = [...decoded].filter((c) => !/\s/.test(c));
  let di = 0;
  const rNoSp = [...raw].filter((c) => !/\s/.test(c));
  if (dChars.length !== rNoSp.length) return raw;
  // 合并:原文骨架 + 仅替换「高置信 汉字→汉字」的位置。标点/大小写/
  // 数字/空格全部保持原样 —— 模型对它们没有发言权。
  let result = "";
  for (const ch of raw) {
    if (/\s/.test(ch)) {
      result += ch;
      continue;
    }
    const d = dChars[di];
    const p = probs[di];
    di++;
    if (d && d !== ch && /[\u4e00-\u9fff]/.test(d) && p >= 0.96) {
      result += d;
    } else {
      result += ch;
    }
  }
  return result;
}
