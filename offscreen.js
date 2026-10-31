// CrostiVoice — offscreen document: speech recognition + smart punctuation
// + user dictionary + punctuation style + alternatives collection.
// Offscreen docs may only use chrome.runtime messaging (no other chrome.* APIs).

import {
  isEngineReady,
  punctuate as nnPunctuate,
  installModel,
  tryInitFromCache,
  deleteModel,
  isModelCached,
} from "./punct-engine.js";
import {
  isCscReady,
  correct as cscCorrect,
  installCsc,
  tryInitCsc,
  deleteCsc,
  isCscCached,
} from "./csc-engine.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SILENCE_MS = 1600; // auto-finish after this much silence
let recognition = null;
let active = false;
let segments = []; // finalized chunks: { primary, alts: string[] }
let dictRules = []; // [[RegExp, replacement], ...]
let punctStyle = "cn"; // 'cn' | 'en'
let engineChoice = "nn"; // 'nn' (neural, local CT-Transformer) | 'rules'
let nnLoading = false;
let silenceTimer = null;

function report(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => {});
}

// Offscreen documents have NO chrome.storage — report through the SW,
// which persists it for the options page.
//
// Throttling matters: a 100MB download fires hundreds of progress events and
// each one would become a storage read-modify-write in the SW. Those complete
// out of order, so a stale "downloading 40%" can overwrite the final "ready".
// We therefore (a) coalesce progress to ~4/s and (b) stamp every message with
// a monotonically increasing sequence the SW uses to drop stale writes.
let statusSeq = 0;
let lastProgressAt = 0;
let pendingProgress = null;
let progressTimer = null;

function sendStatus(patch) {
  return chrome.runtime.sendMessage({ type: "MODEL_STATUS", patch, seq: ++statusSeq }).catch(() => {});
}

function reportModelStatus(patch) {
  const isProgress =
    patch.phase === "downloading" || patch.cscPhase === "downloading";
  if (!isProgress) {
    // terminal/edge states go out immediately and flush any pending progress
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    pendingProgress = null;
    return sendStatus(patch);
  }
  // progress: coalesce
  pendingProgress = { ...(pendingProgress || {}), ...patch };
  const now = Date.now();
  const since = now - lastProgressAt;
  if (since >= 250) {
    lastProgressAt = now;
    sendStatus(pendingProgress);
    pendingProgress = null;
  } else if (!progressTimer) {
    progressTimer = setTimeout(() => {
      progressTimer = null;
      lastProgressAt = Date.now();
      if (pendingProgress) {
        sendStatus(pendingProgress);
        pendingProgress = null;
      }
    }, 250 - since);
  }
}

// normalize stale states persisted by a previous browser session:
// a "downloading"/"loading" phase can't survive a restart — resolve it
// against the actual cache so the settings page shows the truth.
async function normalizeStaleModelStatus() {
  try {
    const { modelStatus } = await chrome.storage.local.get("modelStatus");
    if (!modelStatus) return;
    const patch = {};
    if (
      (modelStatus.phase === "downloading" || modelStatus.phase === "loading") &&
      (await isModelCached())
    ) {
      patch.phase = "ready";
    } else if (modelStatus.phase === "downloading" || modelStatus.phase === "loading") {
      patch.phase = "not-installed";
    }
    if (
      (modelStatus.cscPhase === "downloading" || modelStatus.cscPhase === "loading") &&
      (await isCscCached())
    ) {
      patch.cscPhase = "ready";
    } else if (modelStatus.cscPhase === "downloading" || modelStatus.cscPhase === "loading") {
      patch.cscPhase = "not-installed";
    }
    if (Object.keys(patch).length) {
      console.log("[cv] normalizing stale model status:", patch);
      await reportModelStatus(patch);
    }
  } catch {
    /* best effort */
  }
}

// Load neural engines FROM CACHE ONLY (never trigger a download).
// Explicit downloads happen only via MODEL_INSTALL / CSC_INSTALL
// (user clicked the download button in settings).
async function ensureNnEngine() {
  if (engineChoice !== "nn" || isEngineReady() || nnLoading) return;
  nnLoading = true;
  try {
    const ok = await tryInitFromCache();
    reportModelStatus({ phase: ok ? "ready" : "not-installed" });
  } catch {
    reportModelStatus({ phase: "not-installed" });
  } finally {
    nnLoading = false;
  }
}

let cscLoading = false;
async function ensureCscEngine() {
  if (isCscReady() || cscLoading) return;
  cscLoading = true;
  try {
    const ok = await tryInitCsc();
    reportModelStatus({ cscPhase: ok ? "ready" : "not-installed" });
  } catch {
    reportModelStatus({ cscPhase: "not-installed" });
  } finally {
    cscLoading = false;
  }
}

function resetSilenceTimer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (active) {
    silenceTimer = setTimeout(() => {
      // user paused speaking (or never started) — auto-finish
      stop();
    }, SILENCE_MS);
  }
}

// ---------- user dictionary ----------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setDictionary(list) {
  dictRules = (Array.isArray(list) ? list : [])
    .filter((e) => e && e.from && e.to)
    .map((e) => [new RegExp(escapeRe(e.from), "g"), e.to]);
}

function applyDict(s) {
  for (const [re, to] of dictRules) s = s.replace(re, to);
  return s;
}

// ---------- smart punctuation ----------

// spoken punctuation commands → symbols (中文识别常把「逗号」转成文字)
const SPOKEN_PUNCT = [
  [/[,\uFF0C]?逗号/g, ","],
  [/[,\uFF0C]?顿号/g, "\u3001"],
  [/[\u3002.]?句号/g, "\u3002"],
  [/[?\uFF1F]?问号/g, "?"],
  [/[!\uFF01]?(感叹号|叹号)/g, "!"],
  [/[:\uFF1A]?冒号/g, ":"],
  [/[;\uFF1B]?分号/g, ";"],
  [/(换行|另起一行)/g, "\n"],
];

// sentence-starting connectives → the PREVIOUS chunk likely ends with a comma
const CONNECTORS =
  /^(然后|接着|其次|最后|另外|此外|而且|并且|但是|但|可是|不过|所以|因此|那么|因为|如果|虽然|其实|当然|总之|比如|例如|换句话说)/;

// connectives used to split punctuation-less runs INSIDE a long segment
const INLINE_CONNECTORS =
  /(然后|接着|但是|可是|不过|所以|因此|因为|而且|并且|最后|另外|此外|其次|总之|其实|比如|例如|那么|如果|虽然|当然)/g;

// Chrome zh-CN often returns one long punctuation-less chunk per pause;
// insert breaks before connectives inside such chunks.
function splitLongSegment(seg) {
  if (seg.length <= 15) return seg;
  return seg.replace(INLINE_CONNECTORS, (m, _g, off, s) => {
    const before = s.slice(0, off).trimEnd();
    if (before.length < 4) return m; // sentence-initial connective
    if (/[。!?;:,、\n]$/.test(before)) return m; // already punctuated
    return (before.length >= 12 ? "。" : ",") + m;
  });
}

// utterance-final tone words → sentence is complete
const TONE_END = /(吗|吧|呢|啊|呀|嘛|哦|啦|么|而已|好了|得啦)$/;

// question-shaped endings → '?'
const QUESTION_END = /(怎么样|怎么办|为什么|什么|多少|几|谁|哪里|哪儿|哪个|几点)$/;

const END_PUNCT_OK = /[。!?;:,、…\u2014)\u201d\u300d\u300f\n.]$/;

function normalize(seg) {
  let s = applyDict(seg.trim());
  for (const [re, rep] of SPOKEN_PUNCT) s = s.replace(re, rep);
  // collapse stray whitespace before punctuation ("code ," → "code,")
  s = s.replace(/\s+([,、。?!:;])/g, "$1");
  return s.trim();
}

function hasCJK(s) {
  return /[\u4e00-\u9fff]/.test(s);
}

function punctuate(primaries) {
  const parts = primaries.map(normalize).filter(Boolean).map(splitLongSegment);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let seg = parts[i];
    const next = parts[i + 1];
    const prev = out[out.length - 1];
    const startsSentence = !prev || /[.。!?…\n]$/.test(prev);
    if (startsSentence && /^[a-z]/.test(seg)) {
      seg = seg[0].toUpperCase() + seg.slice(1);
    }
    if (!END_PUNCT_OK.test(seg)) {
      const asciiEnd = /[A-Za-z0-9]$/.test(seg) && !hasCJK(seg);
      if (next && CONNECTORS.test(next)) {
        seg += ",";
      } else if (TONE_END.test(seg) || QUESTION_END.test(seg)) {
        seg += /吗$|怎么样$|怎么办$|多少$/.test(seg) || QUESTION_END.test(seg) ? "?" : "。";
        if (asciiEnd) seg = seg.replace(/。$/, ".").replace(/？$/, "?");
      } else if (next && seg.length <= 10) {
        seg += ",";
      } else {
        seg += asciiEnd ? "." : "。";
      }
    }
    out.push(seg);
  }
  let text = "";
  for (const seg of out) {
    if (text && /[A-Za-z0-9.]$/.test(text) && /^[A-Za-z0-9]/.test(seg)) text += " ";
    text += seg;
  }
  return text;
}

// render full-width CJK punctuation as half-width for code-friendly contexts
function renderStyle(text) {
  if (punctStyle !== "en") return text;
  return text
    .replace(/\u3002/g, ".")
    .replace(/\uFF1F/g, "?")
    .replace(/\uFF01/g, "!")
    .replace(/\u3001/g, ",")
    .replace(/\uFF1A/g, ":")
    .replace(/\uFF1B/g, ";")
    .replace(/,(?=\S)/g, ", ")
    .replace(/([.?!])(?=[^\s\n])/g, "$1 ");
}

// ---------- recognition ----------

function start({ lang, dictionary, punctStyle: style, engine }) {
  if (!SR) {
    report({ type: "ASR_ERROR", code: "unsupported", message: "此浏览器不支持语音识别" });
    return;
  }
  segments = [];
  setDictionary(dictionary);
  if (style) punctStyle = style;
  if (engine) engineChoice = engine;
  ensureNnEngine(); // from cache only — never downloads implicitly
  ensureCscEngine();
  recognition = new SR();
  recognition.lang = lang || "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3; // candidates for AI re-ranking

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) {
        const alts = [];
        for (let j = 1; j < r.length; j++) alts.push(r[j].transcript);
        segments.push({ primary: r[0].transcript, alts });
      } else {
        interim += r[0].transcript;
      }
    }
    const finalPart = punctuate(segments.map((s) => s.primary));
    const live = (finalPart + interim).trim();
    if (live || segments.length) report({ type: "ASR_INTERIM", text: live });
    resetSilenceTimer(); // speech activity (final or interim) postpones auto-finish
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    report({ type: "ASR_ERROR", code: event.error });
    cleanup();
  };

  recognition.onend = () => {
    // Chrome stops on silence even in continuous mode — restart while held.
    if (active && recognition) {
      try {
        recognition.start();
      } catch {
        /* already starting */
      }
    }
  };

  try {
    recognition.start();
    active = true;
    resetSilenceTimer(); // if the user never speaks, auto-finish too
  } catch (err) {
    report({ type: "ASR_ERROR", code: "start-failed", message: String(err) });
  }
}

function cleanup() {
  active = false;
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  if (recognition) {
    try {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.stop();
    } catch {
      /* noop */
    }
    recognition = null;
  }
}

// neural path: dict-corrected, punctuation-free text → model adds punctuation
// + a smoothing pass: a period followed shortly by another mark was a segment
//   boundary artifact → demote it to a comma
function smoothPeriods(text) {
  return text.replace(/\u3002(?=[^\u3002\uFF0C\u3001\uFF1F]{1,3}[\uFF0C\u3001\uFF1F\u3002])/g, "\uFF0C");
}

async function stop() {
  // deep copy segments before cleanup for the final message
  const raw = segments.map((s) => ({ primary: s.primary, alts: [...(s.alts || [])] }));
  let text;
  if (engineChoice === "nn" && isEngineReady()) {
    // neural path: dict-corrected, punctuation-free text → model adds punctuation
    try {
      const joined = raw
        .map((s) => applyDict(s.primary.trim()))
        .filter(Boolean)
        .join(" ")
        // strip any punctuation the recognizer emitted — the model re-adds it
        .replace(/[\u3002\uFF0C\uFF1F\uFF01\uFF1A\uFF1B\u3001,_.?!;:]+/g, "");
      let t = await nnPunctuate(joined);
      // semantic spelling correction (same-sound mistakes), ~0.4s when installed
      if (isCscReady()) {
        try {
          t = await cscCorrect(t);
        } catch (err) {
          console.warn("[cv] csc skipped:", err);
        }
      }
      text = renderStyle(smoothPeriods(t)).trim();
    } catch (err) {
      console.warn("[cv] neural punct failed, using rules:", err);
      text = renderStyle(punctuate(segments.map((s) => s.primary))).trim();
    }
  } else {
    // rule path (instant, no model)
    text = renderStyle(punctuate(segments.map((s) => s.primary))).trim();
  }
  cleanup();
  report({ type: "ASR_FINAL", text, raw });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASR_START") {
    if (active) stop();
    start(message);
    sendResponse({ ok: true });
  } else if (message?.type === "ASR_STOP") {
    stop();
    sendResponse({ ok: true });
  } else if (message?.type === "MODEL_INSTALL") {
    (async () => {
      try {
        reportModelStatus({ phase: "downloading", pct: 0 });
        await installModel(async (loaded, total, stage) => {
          const pct = Math.min(100, Math.round((loaded / (total || 1)) * 100));
          reportModelStatus({ phase: "downloading", pct, stage });
        });
        await reportModelStatus({ phase: "ready", pct: 100 });
        sendResponse({ ok: true });
      } catch (err) {
        await reportModelStatus({ phase: "error", message: String(err.message || err).slice(0, 120) });
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true; // async response
  } else if (message?.type === "MODEL_DELETE") {
    (async () => {
      await deleteModel();
      reportModelStatus({ phase: "not-installed", pct: 0 });
      sendResponse({ ok: true });
    })();
    return true;
  } else if (message?.type === "CSC_INSTALL") {
    (async () => {
      try {
        await reportModelStatus({ cscPhase: "downloading", cscPct: 0 });
        await installCsc(async (loaded, total, stage) => {
          const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          await reportModelStatus({ cscPhase: "downloading", cscPct: pct, cscStage: stage });
        });
        await reportModelStatus({ cscPhase: "ready", cscPct: 100 });
        sendResponse({ ok: true });
      } catch (err) {
        await reportModelStatus({ cscPhase: "error", message: String(err.message || err).slice(0, 120) });
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  } else if (message?.type === "CSC_DELETE") {
    (async () => {
      await deleteCsc();
      await reportModelStatus({ cscPhase: "not-installed", cscPct: 0 });
      sendResponse({ ok: true });
    })();
    return true;
  } else if (message?.type === "MODEL_CHECK") {
    (async () => {
      // opportunistically load from cache so status flips to "ready"
      if (!isEngineReady() && (await isModelCached())) {
        ensureNnEngine();
      }
      if (!isCscReady() && (await isCscCached())) {
        ensureCscEngine();
      }
      await normalizeStaleModelStatus();
      sendResponse({
        ok: true,
        cached: await isModelCached(),
        ready: isEngineReady(),
        cscCached: await isCscCached(),
        cscReady: isCscReady(),
      });
    })();
    return true;
  }
  return false; // sync responses only
});
