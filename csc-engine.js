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
const REMOTE = (f) => `https://huggingface.co/${REPO}/resolve/main/${f}`;

let tokenizer = null;
let model = null;

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
  const res = await fetch(url);
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
    // intercept fetch: serve from Cache API when we have the file (offline),
    // otherwise pass through (first download)
    const origFetch = self.fetch;
    self.fetch = async (url, opts) => {
      const hit = await cachedResponse(String(url));
      if (hit) return hit;
      return origFetch(url, opts);
    };
    try {
      tokenizer = await AutoTokenizer.from_pretrained(REPO);
      model = await AutoModelForMaskedLM.from_pretrained(REPO, { dtype: "q8" });
    } finally {
      self.fetch = origFetch;
    }
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
export async function correct(text) {
  if (!isCscReady()) return text;
  const inputs = tokenizer(text, { truncation: true, max_length: 120 });
  const { logits } = await model(inputs);
  const ids = inputs.input_ids.data;
  const dims = logits.dims;
  const VV = dims[2];
  const data = logits.data;
  const out = [];
  for (let i = 1; i < ids.length - 1; i++) {
    let best = 0;
    let bestV = -Infinity;
    for (let v = 0; v < VV; v++) {
      const val = data[i * VV + v];
      if (val > bestV) {
        bestV = val;
        best = v;
      }
    }
    out.push(best);
  }
  const decoded = tokenizer.decode(out, { skip_special_tokens: true });
  // decode adds spaces between CJK chars — remove those only
  return decoded.replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "");
}
