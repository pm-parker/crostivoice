// CrostiVoice — SenseVoice engine: Chinese-optimized local ASR via raw ORT.
//
// 管线严格对齐 sherpa-onnx offline-recognizer-sense-voice-impl.h(2026-11
// 从模型 metadata 与官方源码逐项核实):
//   音频[-1,1] → kaldi fbank 80(hamming/25ms/10ms/preemph0.97/去直流/
//     low20/high=nyquist/snip_edges=true,无 energy,功率谱不归一)
//   → LFR 堆叠(窗 7 步 6 → 560 维,尾部复制)→ CMVN((x+neg_mean)*inv_stddev,
//     560 维常量来自模型 metadata,80 值 ×7 重复)
//   → 模型输入 x[1,T,560]f32 / x_length[1]i32 / language[1]i32 / text_norm[1]i32
//     (lang: auto=0 zh=3 en=4 yue=7 ja=11 ko=12;text_norm: with_itn=14)
//   → logits[1,T',25055] → CTC 贪心(blank=0)→ 丢弃前 4 个 token
//     (模型回显 <|zh|><|NEUTRAL|><|Speech|><|withitn|>)→ 文本
// tokens.txt 每行 "token id"(空格分隔,id 显式给出,勿按行号猜)。

import * as ort from "./vendor/ort.mjs";

const V = (f) => new URL(`./vendor/${f}`, import.meta.url).toString();
ort.env.wasm.wasmPaths = {
  mjs: V("ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: V("ort-wasm-simd-threaded.asyncify.wasm"),
};
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const HF_ORIGIN = "https://huggingface.co";
const MIRROR_ORIGIN = "https://pmparker.net/crostivoice/models/sherpa-onnx";
const MIRROR_PATH = "/sense-voice";
const CACHE_NAME = "crostivoice-sensevoice-v1";

const FILES = ["model.int8.onnx", "tokens.txt"];
const CANONICAL = (f) => `${HF_ORIGIN}/sherpa-onnx/sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/${f}`;
const DOWNLOAD = (f) => `${MIRROR_ORIGIN}${MIRROR_PATH}/${f}`;

// 模型 metadata 提取的常量(见文件头注释)
const SAMPLE_RATE = 16000;
const FRAME_LEN = 400;      // 25ms
const FRAME_SHIFT = 160;    // 10ms
const FFT_SIZE = 512;
const NUM_MEL_BINS = 80;
const LOW_FREQ = 20;
const HIGH_FREQ = 8000;     // high_freq=0 → nyquist(sherpa InitFeatConfig)
const PREEMPH = 0.97;
const LFR_WINDOW = 7;
const LFR_SHIFT = 6;
const FEAT_DIM = NUM_MEL_BINS * LFR_WINDOW; // 560
const LANG_IDS = { auto: 0, zh: 3, en: 4, yue: 7, ja: 11, ko: 12 };
const TEXT_NORM_WITH_ITN = 14;
const VOCAB = 25055;

let session = null;
let idToToken = null; // Map<int, string>

export function isSenseVoiceReady() {
  return !!session && !!idToToken;
}

async function cachedResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(url);
}

export async function isSenseVoiceCached() {
  const cache = await caches.open(CACHE_NAME);
  for (const f of FILES) {
    if (!(await cache.match(CANONICAL(f)))) return false;
  }
  return true;
}

export async function deleteSenseVoice() {
  session = null;
  idToToken = null;
  if ("caches" in self) await caches.delete(CACHE_NAME);
}

async function downloadToCache(canonicalUrl, downloadUrl, onProgress) {
  let lastErr = null;
  for (const url of [downloadUrl, canonicalUrl]) {
    try {
      const res = await fetch(url);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
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
        canonicalUrl,
        new Response(new Blob(chunks), { headers: res.headers })
      );
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("download failed");
}

// tokens.txt:每行 "token id"(如 "<|zh|> 24884"),id 显式给出
function parseTokens(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sp = trimmed.lastIndexOf(" ");
    if (sp < 0) continue;
    const token = trimmed.slice(0, sp);
    const id = parseInt(trimmed.slice(sp + 1), 10);
    if (Number.isInteger(id)) map.set(id, token);
  }
  return map;
}

async function loadFromCache() {
  if (session) return;
  const [modelRes, tokensRes] = await Promise.all([
    cachedResponse(CANONICAL("model.int8.onnx")),
    cachedResponse(CANONICAL("tokens.txt")),
  ]);
  if (!modelRes || !tokensRes) throw new Error("model not in cache");

  idToToken = parseTokens(await tokensRes.text());

  const buf = await modelRes.arrayBuffer();
  session = await ort.InferenceSession.create(buf, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

export async function installSenseVoice(onProgress) {
  if (await isSenseVoiceCached()) {
    if (onProgress) onProgress(1, 1, "cached");
  } else {
    for (const f of FILES) {
      const isModel = f.endsWith(".onnx");
      await downloadToCache(CANONICAL(f), DOWNLOAD(f), (loaded, total) => {
        if (onProgress && isModel) onProgress(loaded, total, "model");
      });
    }
  }
  await loadFromCache();
  return true;
}

let loading = false;
export async function tryInitSenseVoice() {
  if (session || loading) return !!session;
  if (!(await isSenseVoiceCached())) return false;
  loading = true;
  try {
    await loadFromCache();
    return true;
  } catch (err) {
    console.warn("[cv] sensevoice load failed:", err);
    session = null;
    return false;
  } finally {
    loading = false;
  }
}

// ---------- kaldi fbank 80(sherpa InitFeatConfig:hamming/high=nyquist/snip_edges) ----------

const MEL_TABLE = buildMelTable();
const COS_TABLE = buildTwiddle(FRAME_LEN); // [k][n] 预计算,复用跨帧
const SIN_TABLE = buildTwiddleSin(FRAME_LEN);

function melOf(freq) {
  return 1127 * Math.log(1 + freq / 700);
}

// kaldi MelBanks:80 个三角滤波器,mel 均匀取 82 个点,按 fft bin 的 mel 值线性加权
function buildMelTable() {
  const numFftBins = FFT_SIZE / 2 + 1;
  const fftBinWidth = SAMPLE_RATE / FFT_SIZE; // 31.25
  const melLow = melOf(LOW_FREQ);
  const melHigh = melOf(HIGH_FREQ);
  const melDelta = (melHigh - melLow) / (NUM_MEL_BINS + 1);
  const table = [];
  for (let b = 0; b < NUM_MEL_BINS; b++) {
    const left = melLow + b * melDelta;
    const center = melLow + (b + 1) * melDelta;
    const right = melLow + (b + 2) * melDelta;
    const weights = new Float32Array(numFftBins);
    for (let k = 0; k < numFftBins; k++) {
      const mel = melOf(k * fftBinWidth);
      if (mel > left && mel < right) {
        weights[k] =
          mel <= center
            ? (mel - left) / (center - left)
            : (right - mel) / (right - center);
      }
    }
    table.push(weights);
  }
  return table;
}

function buildTwiddle(len) {
  const t = [];
  for (let k = 0; k < FFT_SIZE / 2 + 1; k++) {
    const row = new Float32Array(len);
    for (let n = 0; n < len; n++) row[n] = Math.cos((2 * Math.PI * k * n) / FFT_SIZE);
    t.push(row);
  }
  return t;
}
function buildTwiddleSin() {
  const t = [];
  for (let k = 0; k < FFT_SIZE / 2 + 1; k++) {
    const row = new Float32Array(FRAME_LEN);
    for (let n = 0; n < FRAME_LEN; n++) row[n] = Math.sin((2 * Math.PI * k * n) / FFT_SIZE);
    t.push(row);
  }
  return t;
}

// snip_edges=true 的帧数
function numFramesSnip(nSamples) {
  if (nSamples < FRAME_LEN) return 0;
  return 1 + Math.floor((nSamples - FRAME_LEN) / FRAME_SHIFT);
}

function computeFbank80(audio) {
  const T = numFramesSnip(audio.length);
  if (T === 0) return { frames: new Float32Array(0), T: 0 };
  const numFftBins = FFT_SIZE / 2 + 1;
  const out = new Float32Array(T * NUM_MEL_BINS);
  const power = new Float64Array(numFftBins);
  const win = new Float64Array(FRAME_LEN);
  const LOG_EPS = 1.1920929e-7; // FLT_EPSILON,与 kaldi 一致
  for (let t = 0; t < T; t++) {
    const start = t * FRAME_SHIFT;
    // 帧拷贝 + 去直流
    let mean = 0;
    for (let j = 0; j < FRAME_LEN; j++) { win[j] = audio[start + j]; mean += win[j]; }
    mean /= FRAME_LEN;
    // 预加重(kaldi:从尾到头;首样本自减)
    for (let j = FRAME_LEN - 1; j > 0; j--) win[j] -= PREEMPH * win[j - 1];
    win[0] -= PREEMPH * win[0];
    for (let j = 0; j < FRAME_LEN; j++) win[j] -= mean;
    // hamming 窗(sherpa InitFeatConfig 指定)
    for (let j = 0; j < FRAME_LEN; j++) {
      win[j] *= 0.54 - 0.46 * Math.cos((2 * Math.PI * j) / (FRAME_LEN - 1));
    }
    // 功率谱(实数 DFT,kaldi 不做 fft 归一化)
    for (let k = 0; k < numFftBins; k++) {
      const cos = COS_TABLE[k], sin = SIN_TABLE[k];
      let re = 0, im = 0;
      for (let n = 0; n < FRAME_LEN; n++) {
        re += win[n] * cos[n];
        im -= win[n] * sin[n];
      }
      power[k] = re * re + im * im;
    }
    // mel 滤波 + 自然对数
    for (let b = 0; b < NUM_MEL_BINS; b++) {
      const w = MEL_TABLE[b];
      let s = 0;
      for (let k = 0; k < numFftBins; k++) s += w[k] * power[k];
      out[t * NUM_MEL_BINS + b] = Math.log(Math.max(s, LOG_EPS));
    }
  }
  return { frames: out, T };
}

// LFR(sherpa lfr.cc):窗 7 步 6,出帧数 = floor((T-7)/6)+1,尾部复制
function applyLfr(frames, T) {
  if (T < LFR_WINDOW) T = LFR_WINDOW; // 极短音频:复制末帧补足
  const outT = Math.floor((T - LFR_WINDOW) / LFR_SHIFT) + 1;
  const out = new Float32Array(outT * FEAT_DIM);
  for (let i = 0; i < outT; i++) {
    const base = i * LFR_SHIFT;
    for (let j = 0; j < LFR_WINDOW; j++) {
      const t = Math.min(base + j, T - 1);
      out.set(
        frames.subarray(t * NUM_MEL_BINS, (t + 1) * NUM_MEL_BINS),
        i * FEAT_DIM + j * NUM_MEL_BINS
      );
    }
  }
  return { out, outT };
}

// ---------- CMVN 常量(模型 metadata,80 值 ×7 重复) ----------
const NEG_MEAN_80 = [-8.311879,-8.600912,-9.615928,-10.43595,-11.21292,-11.88333,-12.36243,-12.63706,-12.8818,-12.83066,-12.89103,-12.95666,-13.19763,-13.40598,-13.49113,-13.5546,-13.55639,-13.51915,-13.68284,-13.53289,-13.42107,-13.65519,-13.50713,-13.75251,-13.76715,-13.87408,-13.73109,-13.70412,-13.56073,-13.53488,-13.54895,-13.56228,-13.59408,-13.62047,-13.64198,-13.66109,-13.62669,-13.58297,-13.57387,-13.4739,-13.53063,-13.48348,-13.61047,-13.64716,-13.71546,-13.79184,-13.90614,-14.03098,-14.18205,-14.35881,-14.48419,-14.60172,-14.70591,-14.83362,-14.92122,-15.00622,-15.05122,-15.03119,-14.99028,-14.92302,-14.86927,-14.82691,-14.7972,-14.76909,-14.71356,-14.61277,-14.51696,-14.42252,-14.36405,-14.30451,-14.23161,-14.19851,-14.16633,-14.15649,-14.10504,-13.99518,-13.79562,-13.3996,-12.7767,-11.71208];
const INV_STD_80 = [0.155775,0.154484,0.1527379,0.1518718,0.1506028,0.1489256,0.147067,0.1447061,0.1436307,0.1443568,0.1451849,0.1455157,0.1452821,0.1445717,0.1439195,0.1435867,0.1436018,0.1438781,0.1442086,0.1448844,0.1454756,0.145663,0.146268,0.1467386,0.1472724,0.147664,0.1480913,0.1483739,0.1488841,0.1493636,0.1497088,0.1500379,0.1502916,0.1505389,0.1506787,0.1507102,0.1505992,0.1505445,0.1505938,0.1508133,0.1509569,0.1512396,0.1514625,0.1516195,0.1516156,0.1515561,0.1514966,0.1513976,0.1512612,0.151076,0.1510596,0.1510431,0.151077,0.1511168,0.1511917,0.151023,0.1508045,0.1505885,0.1503493,0.1502373,0.1501726,0.1500762,0.1500065,0.1499782,0.150057,0.1502658,0.150469,0.1505335,0.1505505,0.1505328,0.1504275,0.1502438,0.1499674,0.1497118,0.1494661,0.1493102,0.1493681,0.1495501,0.1499738,0.1509654];

function applyCmvn(lfr) {
  const n = lfr.length;
  for (let i = 0; i < n; i++) {
    const m = i % NUM_MEL_BINS;
    lfr[i] = (lfr[i] + NEG_MEAN_80[m]) * INV_STD_80[m];
  }
  return lfr;
}

// ---------- 推理 ----------

async function transcribe(audioFloat32, lang = "zh", useITN = true) {
  if (!session || !idToToken) throw new Error("SenseVoice not loaded");

  const { frames, T } = computeFbank80(audioFloat32);
  if (T === 0) return { text: "" };
  const { out, outT } = applyLfr(frames, T);
  applyCmvn(out);

  const x = new ort.Tensor("float32", out, [1, outT, FEAT_DIM]);
  const xLen = new ort.Tensor("int32", new Int32Array([outT]), [1]);
  const langId = LANG_IDS[lang] ?? LANG_IDS.zh;
  const language = new ort.Tensor("int32", new Int32Array([langId]), [1]);
  const textNorm = new ort.Tensor(
    "int32",
    new Int32Array([useITN ? TEXT_NORM_WITH_ITN : TEXT_NORM_WITH_ITN + 1]),
    [1]
  );

  const feeds = {};
  for (const name of session.inputNames) {
    if (name === "x") feeds.x = x;
    else if (name === "x_length") feeds.x_length = xLen;
    else if (name === "language") feeds.language = language;
    else if (name === "text_norm") feeds.text_norm = textNorm;
  }

  const t0 = Date.now();
  const output = await session.run(feeds);
  const runMs = Date.now() - t0;
  const logits = output[session.outputNames[0]];
  const dims = logits.dims; // [1, T', vocab]
  const data = logits.data;
  const steps = dims[1];
  const vocab = dims[2];

  // CTC 贪心:blank=0(模型 metadata 未给,sherpa 默认),去重
  const ids = [];
  let prev = -1;
  for (let t = 0; t < steps; t++) {
    const off = t * vocab;
    let best = 0;
    let bestV = -Infinity;
    for (let v = 0; v < vocab; v++) {
      const val = data[off + v];
      if (val > bestV) { bestV = val; best = v; }
    }
    if (best !== 0 && best !== prev) ids.push(best);
    prev = best;
  }

  // 前导 4 个 token 是模型内部 prompt 回显(<|zh|><|NEUTRAL|><|Speech|><|withitn|>),丢弃
  const textIds = ids.slice(4);
  let text = "";
  for (const id of textIds) {
    const tok = idToToken.get(id) ?? "";
    if (tok.startsWith("<|") && tok.endsWith("|>")) continue;
    if (tok === "<unk>" || tok === "<s>" || tok === "</s>" || tok === "<blank>") continue;
    text += tok;
  }
  return { text: text.trim(), runMs, frames: T, lfrFrames: outT };
}

export { transcribe };

// ---------- SenseVoiceSession: SpeechRecognition-compatible adapter ----------

const SILENCE_FRAMES = 4;
const SILENCE_THRESHOLD = 0.004;
const MAX_CHUNK_S = 25;
const FRAME_SIZE = 4096;

class SenseVoiceSession {
  constructor() {
    this.lang = "";
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.onspeechstart = null;
    this.onspeechend = null;
    this._stream = null;
    this._audioCtx = null;
    this._processor = null;
    this._buffer = [];
    this._bufferLen = 0;
    this._silenceCount = 0;
    this._speaking = false;
    this._transcribing = false;
    this._queue = [];
    this._stopped = false;
  }

  start() {
    this._startAsync().catch((e) => {
      if (this.onerror) this.onerror({ error: "audio-capture", message: String(e.message || e) });
    });
  }

  async _startAsync() {
    if (!session) throw new Error("SenseVoice model not loaded");
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this._audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = this._audioCtx.createMediaStreamSource(this._stream);
    this._processor = this._audioCtx.createScriptProcessor(FRAME_SIZE, 1, 1);
    source.connect(this._processor);
    this._processor.connect(this._audioCtx.destination);
    this._processor.onaudioprocess = (e) => this._onAudio(e.inputBuffer.getChannelData(0));
  }

  stop() {
    if (this._speaking || this._bufferLen > 0) this._flushChunk();
    this._cleanup();
    this._drainQueue().finally(() => {
      if (this.onend) this.onend();
    });
  }

  abort() {
    this._cleanup();
    if (this.onend) this.onend();
  }

  _cleanup() {
    this._stopped = true;
    if (this._processor) {
      this._processor.onaudioprocess = null;
      this._processor.disconnect();
      this._processor = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
  }

  _onAudio(data) {
    if (this._stopped) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    if (rms > SILENCE_THRESHOLD) {
      this._silenceCount = 0;
      if (!this._speaking) {
        this._speaking = true;
        if (this.onspeechstart) this.onspeechstart();
      }
      this._buffer.push(new Float32Array(data));
      this._bufferLen += data.length;
    } else {
      this._silenceCount++;
      if (this._speaking) {
        this._buffer.push(new Float32Array(data));
        this._bufferLen += data.length;
        if (this._silenceCount >= SILENCE_FRAMES) {
          if (this.onspeechend) this.onspeechend();
          this._flushChunk();
        }
      }
    }
    if (this._bufferLen >= MAX_CHUNK_S * SAMPLE_RATE) this._flushChunk();
  }

  _flushChunk() {
    if (this._bufferLen === 0) return;
    const merged = new Float32Array(this._bufferLen);
    let off = 0;
    for (const chunk of this._buffer) {
      merged.set(chunk, off);
      off += chunk.length;
    }
    this._buffer = [];
    this._bufferLen = 0;
    this._speaking = false;
    this._silenceCount = 0;
    this._queue.push(merged);
    this._drainQueue();
  }

  async _drainQueue() {
    while (this._queue.length > 0 && !this._transcribing) {
      this._transcribing = true;
      const audio = this._queue.shift();
      try {
        const lang = this._langBase();
        const result = await transcribe(audio, lang, true);
        const text = result.text;
        if (text && this.onresult) {
          const results = { length: 1 };
          const item = { isFinal: true, length: 1 };
          item[0] = { transcript: text };
          results[0] = item;
          this.onresult({ resultIndex: 0, results });
        }
      } catch (err) {
        console.warn("[cv] sensevoice transcription failed:", err);
      } finally {
        this._transcribing = false;
      }
    }
  }

  _langBase() {
    const l = (this.lang || "zh-CN").toLowerCase();
    if (l.startsWith("zh")) return "zh";
    if (l.startsWith("en")) return "en";
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("ko")) return "ko";
    if (l.startsWith("yue")) return "yue";
    return l.split(/[-_]/)[0];
  }
}

export { SenseVoiceSession };
