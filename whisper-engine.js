// CrostiVoice — Whisper engine: local speech-to-text via transformers.js.
// Mirrors the csc-engine's model management + CDN dual-source download, and
// provides a SpeechRecognition-compatible adapter for the offscreen pipeline.
//
// Audio path: getUserMedia → AudioContext(16kHz) → ScriptProcessor →
// energy VAD → chunk accumulation → Whisper pipeline → onresult(final).

import { pipeline, env } from "./vendor/transformers.web.min.js";

// 与 csc-engine 共享同一 transformers.js 实例;环境设置等价(幂等)。
env.allowLocalModels = false;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("./vendor/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).toString(),
  wasm: new URL("./vendor/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).toString(),
};
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const HF_ORIGIN = "https://huggingface.co";
const MIRROR_ORIGIN = "https://pmparker.net/crostivoice/models";
const REPO = "onnx-community/whisper-tiny";
const CACHE_NAME = "crostivoice-whisper-v1";

// customCache:离线加载(同 csc-engine;同一模块实例,幂等)
env.useCustomCache = true;
env.customCache = {
  match: async (url) => (await cachedResponse(String(url))) || undefined,
  put: async (url, response) => {
    await (await caches.open(CACHE_NAME)).put(String(url), response);
  },
};

const FILES = [
  "config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "generation_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];
const REMOTE = (f) => `${HF_ORIGIN}/${REPO}/resolve/main/${f}`;

let asrPipeline = null;
let loading = false;

export function isWhisperReady() {
  return !!asrPipeline;
}

async function cachedResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(url);
}

export async function isWhisperCached() {
  const cache = await caches.open(CACHE_NAME);
  for (const f of FILES) {
    if (!(await cache.match(REMOTE(f)))) return false;
  }
  return true;
}

export async function deleteWhisper() {
  asrPipeline = null;
  if ("caches" in self) await caches.delete(CACHE_NAME);
}

async function fetchWithFallback(canonicalUrl) {
  const path = canonicalUrl.startsWith(HF_ORIGIN) ? canonicalUrl.slice(HF_ORIGIN.length) : "";
  const candidates = path ? [MIRROR_ORIGIN + path, canonicalUrl] : [canonicalUrl];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("download failed");
}

async function downloadToCache(url, onProgress) {
  const res = await fetchWithFallback(url);
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

async function loadPipeline() {
  if (asrPipeline) return;
  asrPipeline = await pipeline("automatic-speech-recognition", REPO, {
    dtype: "q8",
    device: "wasm",
  });
}

export async function installWhisper(onProgress) {
  if (await isWhisperCached()) {
    if (onProgress) onProgress(1, 1, "cached");
  } else {
    const totalPlan = 9_500_000 + 29_500_000; // encoder + decoder_merged
    let done = 0;
    for (const f of FILES) {
      const url = REMOTE(f);
      const isModel = f.endsWith(".onnx");
      await downloadToCache(url, (loaded, total) => {
        if (onProgress && isModel) {
          onProgress(done + loaded, totalPlan, f.includes("encoder") ? "encoder" : "decoder");
        }
      });
      if (isModel) done += 29_500_000; // 粗略累计
      if (onProgress) onProgress(0, FILES.length, "files");
    }
  }
  await loadPipeline();
  return true;
}

export async function tryInitWhisper() {
  if (asrPipeline || loading) return !!asrPipeline;
  if (!(await isWhisperCached())) return false;
  loading = true;
  try {
    await loadPipeline();
    return true;
  } catch (err) {
    console.warn("[cv] whisper load failed:", err);
    asrPipeline = null;
    return false;
  } finally {
    loading = false;
  }
}

// ---------- WhisperSession: SpeechRecognition-compatible adapter ----------

const SILENCE_FRAMES = 4;        // 连续静音帧数(每帧 256ms)判定断句
const SILENCE_THRESHOLD = 0.004; // RMS 阈值
const MAX_CHUNK_S = 25;          // 最大分片时长(Whisper 上限 30s)
const FRAME_SIZE = 4096;         // 每帧采样数(16kHz 下约 256ms)

class WhisperSession {
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
    if (!asrPipeline) {
      throw new Error("Whisper model not loaded");
    }
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this._audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = this._audioCtx.createMediaStreamSource(this._stream);
    this._processor = this._audioCtx.createScriptProcessor(FRAME_SIZE, 1, 1);
    source.connect(this._processor);
    // 连 destination 使 processor 在部分环境下正常回调
    this._processor.connect(this._audioCtx.destination);
    this._processor.onaudioprocess = (e) => this._onAudio(e.inputBuffer.getChannelData(0));
  }

  stop() {
    // 优雅停止:冲刷缓冲区中已有的语音
    if (this._speaking || this._bufferLen > 0) {
      this._flushChunk();
    }
    this._cleanup();
    // 等待队列中的转写完成后发 onend
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
    // 能量检测
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
        // 说话中遇到静音:继续录一小段(保留语音尾部的轻声)
        this._buffer.push(new Float32Array(data));
        this._bufferLen += data.length;
        if (this._silenceCount >= SILENCE_FRAMES) {
          if (this.onspeechend) this.onspeechend();
          this._flushChunk();
        }
      }
      // 未说话时的静音:不录
    }

    // 超长强切断句
    if (this._bufferLen >= MAX_CHUNK_S * 16000) {
      this._flushChunk();
    }
  }

  _flushChunk() {
    if (this._bufferLen === 0) return;
    // 合并为一个 Float32Array
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
        const result = await asrPipeline(audio, {
          language: this._langBase(),
          task: "transcribe",
        });
        const text = (result?.text || "").trim();
        if (text && this.onresult) {
          // 构造 SpeechRecognition 兼容的 result 事件(isFinal=true)
          const results = { length: 1 };
          const item = { isFinal: true, length: 1 };
          item[0] = { transcript: text };
          results[0] = item;
          this.onresult({ resultIndex: 0, results });
        }
      } catch (err) {
        console.warn("[cv] whisper transcription failed:", err);
        // 不中断:丢弃这个分片,继续处理下一个
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

export { WhisperSession };
