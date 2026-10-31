// CrostiVoice — local punctuation engine (CT-Transformer int8, runs on ORT wasm)
// Model is downloaded ON DEMAND from HuggingFace (with user permission) and
// persisted in the Cache API — the extension itself stays small.
//
// Model interface (from sherpa-onnx):
//   inputs:  "inputs" (int32 [1,N] token ids)  "text_lengths" (int32 [1])
//   outputs: "logits" ([1,N,6]) → argmax = punct class per token
//   punct classes: 0:<unk> 1:_ (none) 2:, 3:。 4:? 5:、

import * as ort from "./vendor/ort.mjs";

const V = (f) => new URL(`./vendor/${f}`, import.meta.url).toString();
// force the CPU asyncify variant — no WebGPU/jsep files needed
ort.env.wasm.wasmPaths = {
  mjs: V("ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: V("ort-wasm-simd-threaded.asyncify.wasm"),
};
// CPU only — small model, single request at a time
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const CACHE_NAME = "crostivoice-punct-v1";
const MODEL_URL =
  "https://huggingface.co/ranger810/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/resolve/main/model.int8.onnx";
const TOKENS_URL =
  "https://huggingface.co/ranger810/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/resolve/main/tokens.json";

const PUNCT = ["", "", "\uFF0C", "\u3002", "\uFF1F", "\u3001"]; // 1 = none
const ID_DOT = 3;
const ID_QUEST = 4;
const ID_COMMA = 2;
const SEGMENT = 20;

let session = null;
let token2id = null;

export function isEngineReady() {
  return !!session && !!token2id;
}

// ---------- cache helpers ----------

async function cachedResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(url);
}

async function putInCache(url, response) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(url, response);
}

export async function isModelCached() {
  return !!(await cachedResponse(MODEL_URL)) && !!(await cachedResponse(TOKENS_URL));
}

export async function deleteModel() {
  session = null;
  token2id = null;
  if ("caches" in self) await caches.delete(CACHE_NAME);
}

// streaming download with progress → Cache API
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
  const blob = new Blob(chunks);
  await putInCache(url, new Response(blob, { headers: res.headers }));
}

// ---------- init ----------

async function loadEngineFromCache() {
  const [modelRes, tokensRes] = await Promise.all([
    cachedResponse(MODEL_URL),
    cachedResponse(TOKENS_URL),
  ]);
  if (!modelRes || !tokensRes) throw new Error("model not in cache");
  const tokens = await tokensRes.json();
  token2id = new Map();
  for (let i = 0; i < tokens.length; i++) token2id.set(tokens[i], i);
  const buf = await modelRes.arrayBuffer();
  session = await ort.InferenceSession.create(buf, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

// download (if needed) then load. Reports progress as 0..100.
export async function installModel(onProgress) {
  if (await isModelCached()) {
    // already on disk — report completion, not 0% (0% made the UI look stuck)
    if (onProgress) onProgress(1, 1, "cached");
  } else {
    const totalPlan = 75_000_000 + 4_000_000; // model + tokens
    let done = 0;
    await downloadToCache(MODEL_URL, (loaded, total) => {
      if (onProgress) onProgress(loaded, total || 75_000_000, "model");
      done = loaded;
    });
    if (onProgress) onProgress(done + 4_000_000, totalPlan, "tokens");
    await downloadToCache(TOKENS_URL, () => {});
  }
  await loadEngineFromCache();
  return true;
}

// try to start from cache alone (no network)
export async function tryInitFromCache() {
  if (session) return true;
  if (!(await isModelCached())) return false;
  try {
    await loadEngineFromCache();
    return true;
  } catch (err) {
    console.warn("[cv] engine load from cache failed:", err);
    session = null;
    return false;
  }
}

// ---------- inference (sherpa algorithm port) ----------

const isCJK = (c) => c.codePointAt(0) > 0x2e7f;

function tokenize(text) {
  const ids = [];
  const words = [];
  let cur = "";
  let curCJK = null;
  for (const c of text) {
    if (c === " ") {
      if (cur) words.push(cur);
      cur = "";
      curCJK = null;
      continue;
    }
    const cjk = isCJK(c);
    if (cur === "") {
      cur = c;
      curCJK = cjk;
    } else if (cjk === curCJK && !cjk) {
      cur += c;
    } else {
      words.push(cur);
      cur = c;
      curCJK = cjk;
    }
  }
  if (cur) words.push(cur);

  const unkId = token2id.get("<unk>") ?? 0;
  for (const w of words) {
    if (isCJK(w[0])) {
      for (const c of w) ids.push(token2id.get(c) ?? unkId);
    } else {
      ids.push(token2id.get(w) ?? unkId);
    }
  }
  return { ids, words };
}

async function infer(ids) {
  const inputs = new ort.Tensor("int32", Int32Array.from(ids), [1, ids.length]);
  const lengths = new ort.Tensor("int32", Int32Array.from([ids.length]), [1]);
  const out = await session.run({ inputs, text_lengths: lengths });
  const dims = out.logits.dims;
  const data = out.logits.data;
  const C = dims[2];
  const labels = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = data[i * C + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    labels[i] = best;
  }
  return labels;
}

async function predictLabels(ids) {
  const numSegments = Math.ceil(ids.length / SEGMENT);
  const labels = [];
  let last = -1;
  for (let i = 0; i < numSegments; i++) {
    let start = i * SEGMENT;
    const end = Math.min(start + SEGMENT, ids.length);
    if (last !== -1) start = last;
    const seg = ids.slice(start, end);
    if (!seg.length) break;
    const out = await infer(seg);

    let dotIndex = -1;
    let commaIndex = -1;
    for (let k = out.length - 1; k > 1; k--) {
      if (out[k] === ID_DOT || out[k] === ID_QUEST) {
        dotIndex = k;
        break;
      }
      if (commaIndex === -1 && out[k] === ID_COMMA) commaIndex = k;
    }
    if (dotIndex === -1 && seg.length >= 200 && commaIndex !== -1) {
      dotIndex = commaIndex;
      out[dotIndex] = ID_DOT;
    }
    if (dotIndex === -1) {
      if (last === -1) last = start;
      if (i === numSegments - 1) dotIndex = seg.length - 1;
    } else {
      last = start + dotIndex + 1;
    }
    if (dotIndex !== -1) {
      for (let k = 0; k <= dotIndex; k++) labels[start + k] = out[k];
    }
  }
  return labels;
}

export async function punctuate(text) {
  if (!session) throw new Error("engine not initialized");
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return text;
  const { ids, words } = tokenize(clean);
  if (!ids.length) return text;

  const labels = await predictLabels(ids);

  const idTokens = [];
  for (const w of words) {
    if (isCJK(w[0])) for (const c of w) idTokens.push(c);
    else idTokens.push(w);
  }

  let out = "";
  for (let i = 0; i < idTokens.length; i++) {
    const t = idTokens[i];
    const prev = idTokens[i - 1];
    if (out && prev && !isCJK(prev[0]) && !isCJK(t[0])) out += " ";
    out += t;
    const p = labels[i];
    if (p >= 2 && p <= 5) out += PUNCT[p];
  }
  return out;
}
