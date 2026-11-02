// CrostiVoice — SenseVoice engine: Chinese-optimized local ASR via raw ORT.
// Replaces Whisper-tiny: 10x faster (non-autoregressive), better Chinese quality,
// built-in punctuation. Uses our existing ONNX Runtime (no sherpa-onnx needed).
//
// Architecture: mel spectrogram (JS) → single ONNX forward pass → CTC decode.
// Model: SenseVoice-Small int8 (228MB) from sherpa-onnx/FunASR.

import * as ort from "./vendor/ort.mjs";

// Reuse ORT env from punct-engine (same module instance)
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
// 实际下载走镜像(Canonical URL 作 Cache key,同 HF 双源模式)
const DOWNLOAD = (f) => `${MIRROR_ORIGIN}${MIRROR_PATH}/${f}`;

let session = null;
let tokenList = null; // string[] indexed by token ID

export function isSenseVoiceReady() {
  return !!session && !!tokenList;
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
  tokenList = null;
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

async function loadFromCache() {
  if (session) return;
  const [modelRes, tokensRes] = await Promise.all([
    cachedResponse(CANONICAL("model.int8.onnx")),
    cachedResponse(CANONICAL("tokens.txt")),
  ]);
  if (!modelRes || !tokensRes) throw new Error("model not in cache");

  // tokens.txt: 每行 "token_id token_text" 或 "token_text"(sherpa-onnx 格式:每行一个 token,行号即 ID)
  const tokensText = await tokensRes.text();
  tokenList = tokensText.split("\n").map((l) => l.trim());

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
let loading = false;

// ---------- Mel Spectrogram (kaldi fbank, 80-dim, 16kHz) ----------

const SAMPLE_RATE = 16000;
const FRAME_MS = 25;       // 窗口 25ms
const FRAME_SHIFT_MS = 10; // 帧移 10ms
const NUM_MEL_BINS = 80;
const LOW_FREQ = 20;
// high_freq = -400 → nyquist + (-400) = 8000 - 400 = 7600
const HIGH_FREQ = 7600;
const FFT_SIZE = 512;      // 2^9 ≥ 400 samples (25ms × 16kHz)
const PREEMPHASIS = 0.97;

function createMelFilterbank(numBins, fftSize, sampleRate, lowFreq, highFreq) {
  const numFftBins = fftSize / 2 + 1;
  const nyquist = sampleRate / 2;
  const hzToMel = (hz) => 1127 * Math.log(1 + hz / 700);
  const melToHz = (mel) => 700 * (Math.exp(mel / 1127) - 1);

  const melLow = hzToMel(lowFreq);
  const melHigh = hzToMel(Math.min(highFreq, nyquist));
  const melPoints = new Float64Array(numBins + 2);
  for (let i = 0; i < numBins + 2; i++) {
    melPoints[i] = melToHz(melLow + (melHigh - melLow) * i / (numBins + 1));
  }
  const binPoints = new Int32Array(numBins + 2);
  for (let i = 0; i < numBins + 2; i++) {
    binPoints[i] = Math.floor((fftSize + 1) * melPoints[i] / sampleRate);
  }

  const filters = [];
  for (let i = 0; i < numBins; i++) {
    const filter = new Float64Array(numFftBins);
    for (let j = binPoints[i]; j < binPoints[i + 1]; j++) {
      if (binPoints[i + 1] !== binPoints[i]) {
        filter[j] = (j - binPoints[i]) / (binPoints[i + 1] - binPoints[i]);
      }
    }
    for (let j = binPoints[i + 1]; j < binPoints[i + 2]; j++) {
      if (binPoints[i + 2] !== binPoints[i + 1]) {
        filter[j] = (binPoints[i + 2] - j) / (binPoints[i + 2] - binPoints[i + 1]);
      }
    }
    filters.push(filter);
  }
  return filters;
}

const MEL_FILTERS = createMelFilterbank(NUM_MEL_BINS, FFT_SIZE, SAMPLE_RATE, LOW_FREQ, HIGH_FREQ);
const FRAME_LEN = Math.round(SAMPLE_RATE * FRAME_MS / 1000); // 400
const FRAME_SHIFT = Math.round(SAMPLE_RATE * FRAME_SHIFT_MS / 1000); // 160

function computeFbank(audio) {
  // 预加重
  const preemph = new Float32Array(audio.length);
  preemph[0] = audio[0];
  for (let i = 1; i < audio.length; i++) {
    preemph[i] = audio[i] - PREEMPHASIS * audio[i - 1];
  }

  // 分帧(snip_edges=false:用反射填充)
  const numFrames = Math.ceil((preemph.length - FRAME_LEN) / FRAME_SHIFT) + 1;
  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    const start = i * FRAME_SHIFT;
    const frame = new Float64Array(FRAME_LEN);
    for (let j = 0; j < FRAME_LEN; j++) {
      const idx = start + j;
      if (idx < preemph.length) frame[j] = preemph[idx];
      else if (idx < preemph.length + FRAME_LEN) {
        frame[j] = preemph[2 * preemph.length - idx - 1]; // 反射
      } else frame[j] = 0;
    }
    // 汉明窗
    for (let j = 0; j < FRAME_LEN; j++) {
      frame[j] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * j / (FRAME_LEN - 1));
    }
    frames.push(frame);
  }

  // FFT + mel filterbank + log
  const numFftBins = FFT_SIZE / 2 + 1;
  const features = new Float32Array(numFrames * NUM_MEL_BINS);
  const power = new Float64Array(numFftBins);

  for (let f = 0; f < numFrames; f++) {
    // 实数 FFT(简化:直接用嵌套循环,帧短所以可接受)
    // 实际用递归 FFT 会更快,但 25ms 帧(400点)计算量不大
    for (let k = 0; k < numFftBins; k++) {
      let re = 0, im = 0;
      const omega = 2 * Math.PI * k / FFT_SIZE;
      for (let n = 0; n < FRAME_LEN; n++) {
        re += frames[f][n] * Math.cos(omega * n);
        im -= frames[f][n] * Math.sin(omega * n);
      }
      power[k] = re * re + im * im;
    }

    for (let m = 0; m < NUM_MEL_BINS; m++) {
      let sum = 0;
      const filter = MEL_FILTERS[m];
      for (let k = 0; k < numFftBins; k++) sum += filter[k] * power[k];
      // log(加 epsilon 防零)
      features[f * NUM_MEL_BINS + m] = Math.log(sum + 1e-10);
    }
  }

  // CMVN(倒谱均值归一化)— kaldi 标准操作
  // 逐维减去均值
  for (let m = 0; m < NUM_MEL_BINS; m++) {
    let mean = 0;
    for (let f = 0; f < numFrames; f++) mean += features[f * NUM_MEL_BINS + m];
    mean /= numFrames;
    for (let f = 0; f < numFrames; f++) {
      features[f * NUM_MEL_BINS + m] -= mean;
    }
  }

  return { features, numFrames };
}

// ---------- SenseVoice 推理 ----------

// SenseVoice 特殊 token 前缀(4 个)<|zh|><|NEUTRAL|><|Speech|><|withitn|> 或 <|noitn|>
// 从 sherpa-onnx 源码:模型输入需要 language + emotion + event + itn 标记
const TOKEN_ZH = "<|zh|>";
const TOKEN_NEUTRAL = "<|NEUTRAL|>";
const TOKEN_SPEECH = "<|Speech|>";
const TOKEN_WITHITN = "<|withitn|>";

async function transcribe(audioFloat32, lang = "zh", useITN = true) {
  if (!session || !tokenList) throw new Error("SenseVoice not loaded");

  const { features, numFrames } = computeFbank(audioFloat32);
  if (numFrames === 0) return { text: "" };

  // 构造输入 [1, numFrames, 80]
  const speech = new ort.Tensor("float32", features, [1, numFrames, NUM_MEL_BINS]);
  const speechLengths = new ort.Tensor("int32", new Int32Array([numFrames]), [1]);

  // SenseVoice 需要 4 个特殊 token 作为 prompt 前缀
  const langToken = lang.startsWith("zh") ? TOKEN_ZH :
    lang.startsWith("en") ? "<|en|>" :
    lang.startsWith("ja") ? "<|ja|>" :
    lang.startsWith("ko") ? "<|ko|>" :
    lang.startsWith("yue") ? "<|yue|>" : TOKEN_ZH;
  const itnToken = useITN ? TOKEN_WITHITN : "<|noitn|>";

  // 查 special token ID
  const langId = tokenList.indexOf(langToken);
  const emotionId = tokenList.indexOf(TOKEN_NEUTRAL);
  const eventId = tokenList.indexOf(TOKEN_SPEECH);
  const itnId = tokenList.indexOf(itnToken);

  // prompt = [langId, emotionId, eventId, itnId]
  const promptIds = [langId, emotionId, eventId, itnId].filter((id) => id >= 0);
  const prompt = new ort.Tensor("int32", new Int32Array(promptIds), [1, promptIds.length]);

  // 运行模型(输入名从模型签名获取)
  const inputNames = session.inputNames;
  const feeds = {};
  for (const name of inputNames) {
    if (name.includes("speech_lengths")) feeds[name] = speechLengths;
    else if (name.includes("prompt") || name.includes("text")) feeds[name] = prompt;
    else feeds[name] = speech;
  }

  const output = await session.run(feeds);

  // 获取输出(通常是 decoder_out 或 ctc_logits)
  const outNames = session.outputNames;
  const logits = output[outNames[0]]; // Tensor
  if (!logits) throw new Error("no output");

  // CTC 贪心解码
  // logits.dims = [1, num_tokens, vocab_size]
  const dims = logits.dims;
  const data = logits.data;
  const vocabSize = dims[dims.length - 1];
  const numTokens = dims[1];

  const tokenIds = [];
  let prevId = -1;
  for (let t = 0; t < numTokens; t++) {
    const offset = t * vocabSize;
    let bestId = 0;
    let bestVal = -Infinity;
    for (let v = 0; v < vocabSize; v++) {
      const val = data[offset + v];
      if (val > bestVal) { bestVal = val; bestId = v; }
    }
    // CTC collapse:跳过 blank 和重复
    if (bestId !== 0 && bestId !== prevId) {
      tokenIds.push(bestId);
    }
    prevId = bestId;
  }

  // token ID → 文本
  let text = "";
  for (const id of tokenIds) {
    const tok = tokenList[id] || "";
    // 跳过特殊标记(尖括号包裹的)
    if (tok.startsWith("<|") && tok.endsWith("|>")) continue;
    if (tok === "<blank>" || tok === "<s>" || tok === "</s>") continue;
    text += tok;
  }

  return { text: text.trim() };
}

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
    return l.split(/[-_]/)[0];
  }
}

export { SenseVoiceSession };
