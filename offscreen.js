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

// ---------- timing ----------
// Two different questions need two different clocks (the same split Android's
// endpointer exposes as POSSIBLY_COMPLETE vs COMPLETE silence):
//   WAIT_FIRST_MS — the shortcut was pressed but no transcript has arrived
//            yet. Deliberately generous: a slow start (the user thinking, or
//            the recognizer's first interim still in flight) must never kill
//            the session. The old code reused one 1.6 s timer here, so a user
//            who paused before the first word lost the whole session. VAD
//            events (soundstart/speechstart) re-arm this clock for extra
//            grace, but only a real transcript switches to the gap clock.
//   GAP_MS — transcript already flowed and the last result is this old:
//            the "停顿自动断句上屏" boundary.
//   MAX_MS — absolute cap so a wedged microphone can never record forever.
// NOTE: Chrome in continuous mode does not reliably fire soundend/speechend,
// so nothing may gate on those events (measured: they never arrive while
// results keep streaming). Only onresult is a trustworthy activity signal.
const WAIT_FIRST_MS = 9000;
const GAP_MS = 1600;
const MAX_MS = 120000;

let recognition = null;
let active = false;
let segments = []; // finalized chunks: { primary, alts: string[] }
let lastInterim = ""; // newest non-final transcript — never dropped on finish
let firstResultSeen = false; // a real transcript arrived (arming is over)
let waitTimer = null; // first-transcript ceiling (re-armed by VAD events)
let gapTimer = null;
let maxTimer = null;
let finalizing = false;
let finalReported = false; // one ASR_FINAL per session, however stop() is reached
let punctStyle = "cn"; // 'cn' | 'en'
let engineChoice = "nn"; // 'nn' (neural, local CT-Transformer) | 'rules'
let nnLoading = false;

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

// ---------- session clocks ----------

function clearClocks() {
  for (const t of [waitTimer, gapTimer, maxTimer]) if (t) clearTimeout(t);
  waitTimer = gapTimer = maxTimer = null;
}

// Ceiling for "still waiting for the first transcript". Re-armed when the VAD
// reports sound/speech so that a late first interim is not punished.
function armWaitTimer() {
  if (!active || firstResultSeen) return;
  if (waitTimer) clearTimeout(waitTimer);
  waitTimer = setTimeout(() => {
    waitTimer = null;
    if (active && !firstResultSeen) {
      // Nothing transcribed. stop() reports an empty ASR_FINAL, which is the
      // one path that surfaces the "没听到内容" hint and returns to idle.
      stop();
    }
  }, WAIT_FIRST_MS);
}

// Only meaningful once a transcript exists: this is the sentence gap.
function rearmGapTimer() {
  if (!active || !firstResultSeen) return;
  if (gapTimer) clearTimeout(gapTimer);
  gapTimer = setTimeout(() => {
    gapTimer = null;
    if (active) stop();
  }, GAP_MS);
}

// Transcript activity: retire the first-wait clock, restart the gap clock.
function noteTranscriptActivity() {
  if (!firstResultSeen) {
    firstResultSeen = true;
    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
  }
  rearmGapTimer();
}

// ---------- user dictionary ----------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let dictRules = []; // [[RegExp, replacement], ...] — post-hoc 替换
let dictPairs = []; // [[from, to]] — 候选融合打分用纯字符串
let pageContext = []; // 页面上下文词袋(标题/输入框已有文字),识别偏置 + 融合信号
let freqRank = null; // Map<词, 名次>,来自 vendor/freq-zh60k.txt(懒加载,失败容忍)
let freqLoading = null;

// 中文词频表:候选重排的统计基础信号(IME 词频解码的本地版)。
// jieba dict.txt(MIT)按频降序前 6 万词,行号即名次。加载失败(网络/文件
// 缺失)时 freq 分量置零,融合退化为词典+上下文,不影响主流程。
function ensureFreqTable() {
  if (freqRank || freqLoading) return freqLoading;
  freqLoading = (async () => {
    try {
      const res = await fetch(new URL("./vendor/freq-zh60k.txt", import.meta.url));
      if (!res.ok) return;
      const lines = (await res.text()).split("\n");
      const map = new Map();
      for (let i = 0; i < lines.length; i++) {
        const w = lines[i].trim();
        if (!w || w.startsWith("#")) continue;
        map.set(w, map.size + 1); // 名次 = 表内序号
      }
      if (map.size > 1000) freqRank = map;
    } catch {
      /* 统计信号是增益,不是依赖 */
    }
    return freqRank;
  })();
  return freqLoading;
}

function setDictionary(list) {
  const entries = (Array.isArray(list) ? list : []).filter((e) => e && e.from && e.to);
  dictRules = entries.map((e) => [new RegExp(escapeRe(e.from), "g"), e.to]);
  dictPairs = entries.map((e) => [String(e.from), String(e.to)]);
}

function applyDict(s) {
  for (const [re, to] of dictRules) s = s.replace(re, to);
  return s;
}

// ---------- candidate fusion (local: dictionary > context > frequency) ----------
// 识别器每句最多给 3 个候选,默认取第一个。三级信号按优先级比较:
//   词典(用户意图,±2/条)> 页面上下文(+1/条,搜索引擎"会话消歧"的本地版)
//   > 词频覆盖(IME 式统计信号,需显著优势才换)。
// 平票不动、无信号时空操作 —— 不引入概率性改写。
function dictScore(text) {
  let s = 0;
  for (const [from, to] of dictPairs) {
    if (text.includes(from)) s -= 2; // 命中"已知错形"
    if (text.includes(to)) s += 2; // 命中"目标词"
  }
  return s;
}

function contextVote(text) {
  let s = 0;
  for (const t of pageContext) {
    if (t && t.length >= 2 && text.includes(t)) s += 1;
  }
  return s;
}

// 贪心最长匹配的词频覆盖分:覆盖率主导 + 长词加权(输入法式打分)。
// 值域约 [0,3],仅在候选间相对比较时有意义。
function freqScore(text) {
  if (!freqRank || !text) return 0;
  const n = text.length;
  let i = 0;
  let covered = 0;
  let bonus = 0;
  while (i < n) {
    let len = Math.min(12, n - i);
    let hit = 0;
    for (; len >= 2; len--) {
      if (freqRank.has(text.slice(i, i + len))) {
        hit = len;
        break;
      }
    }
    if (hit) {
      covered += hit;
      bonus += 1 + Math.log2(hit);
      i += hit;
    } else {
      i += 1;
    }
  }
  return (covered / n) * 2 + (covered > 0 ? bonus / covered : 0);
}

function candidateScore(text) {
  return { dict: dictScore(text), ctx: contextVote(text), freq: freqScore(text) };
}

// 频率分量需要显著优势才允许单独触发换选(统计噪声防护)
const FREQ_MARGIN = 0.35;

function betterCandidate(alt, primary) {
  const a = candidateScore(alt);
  const p = candidateScore(primary);
  if (a.dict !== p.dict) return a.dict > p.dict;
  if (a.ctx !== p.ctx) return a.ctx > p.ctx;
  return a.freq > p.freq + FREQ_MARGIN;
}

function fuseCandidates(list) {
  return list.map((seg) => {
    if (!seg.alts || seg.alts.length === 0) return seg;
    let best = seg.primary;
    for (const alt of seg.alts) {
      if (betterCandidate(alt, best)) best = alt;
    }
    return best === seg.primary ? seg : { ...seg, primary: best };
  });
}

// ---------- local text organization ----------
// 口癖清理 + 分段(纯本地、保守规则):
// - 只删无歧义的语气填充词(嗯/呃/噢/喔/诶/唉,可叠用,须独立成词——
//   前为句首或标点,后随可选的逗号/句号)。刻意不碰"那个/这个/就是":
//   它们可作指示词或连词,机械删除会改坏句子;
// - 分段:当前段满 3 句且 ≥60 字,或超长(≥120 字)时在句号后断段;
// - 单行输入框(搜索框等)不支持换行,由 content script 剥掉分段符。
const FILLER_RE = /(^|[。!?,;、\n])\s*(?:嗯|呃|噢|喔|诶|唉){1,3}\s*[,，。]?\s*/g;

function defill(text) {
  // 保留边界标点,丢弃填充词及其自带的逗号/句号
  return text.replace(FILLER_RE, (m, boundary) => boundary);
}

function reflow(text) {
  if (!/[。!?…]/.test(text)) return text;
  // 以小句(含逗号边界)为计数单位,断段只落在小句之后;段尾若是逗号,
  // 升格为句号——段落边界本来就意味着句子完结。
  const clauses = text.split(/(?<=[。!?…,;、\n])/).filter((s) => s.trim());
  if (clauses.length <= 3) return text;
  let out = "";
  let cl = 0;
  let chars = 0;
  for (const c of clauses) {
    if (c.includes("\n")) {
      // 用户口述的换行:分段计数重新开始
      out += c;
      cl = 0;
      chars = 0;
      continue;
    }
    const endsSentence = /[。!?…]/.test(c.slice(-1));
    if (!endsSentence && !/[,,;]\s*$/.test(c)) {
      out += c; // 不在断点上的小句(如顿号中间):只累计
      cl += 1;
      chars += c.length;
      continue;
    }
    cl += 1;
    chars += c.length;
    const atBreak = (cl >= 3 && chars >= 60) || chars >= 120;
    if (atBreak) {
      out += c.replace(/[,]\s*$/, "。") + "\n";
      cl = 0;
      chars = 0;
    } else {
      out += c;
    }
  }
  return out.replace(/\n+$/, "");
}

function organize(text) {
  return reflow(defill(text));
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

function start({ lang, dictionary, punctStyle: style, engine, context }) {
  if (!SR) {
    report({ type: "ASR_ERROR", code: "unsupported", message: "此浏览器不支持语音识别" });
    return;
  }
  segments = [];
  lastInterim = "";
  firstResultSeen = false;
  finalizing = false;
  finalReported = false;
  setDictionary(dictionary);
  pageContext = (Array.isArray(context) ? context : [])
    .map((t) => String(t))
    .filter((t) => t.length >= 2 && t.length <= 20)
    .slice(0, 20);
  ensureFreqTable(); // 懒加载一次,失败容忍
  if (style) punctStyle = style;
  if (engine) engineChoice = engine;
  ensureNnEngine(); // from cache only — never downloads implicitly
  ensureCscEngine();
  recognition = new SR();
  recognition.lang = lang || "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3; // candidates for local fusion (and AI re-ranking if ever revived)

  // 识别器级热词偏置(Chrome 156+/SpeechRecognitionPhrase):词典目标词 +
  // 页面上下文词喂给识别器,让解码阶段就偏向领域词汇——比"识别错了再替换"
  // 更根本。旧浏览器无此 API 时静默跳过,post-hoc 替换与候选融合不受影响。
  try {
    if ("SpeechRecognitionPhrase" in self && recognition.phrases) {
      const targets = [...new Set([...dictPairs.map(([, to]) => to), ...pageContext])]
        .filter((t) => t.length >= 2 && t.length <= 20)
        .slice(0, 120);
      for (const t of targets) {
        recognition.phrases.push(new SpeechRecognitionPhrase(t));
      }
    }
  } catch {
    /* 偏置失败不影响识别主流程 */
  }

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) {
        const alts = [];
        for (let j = 1; j < r.length; j++) alts.push(r[j].transcript);
        const primary = r[0].transcript;
        if (primary && primary.trim()) segments.push({ primary, alts });
        lastInterim = ""; // this chunk is committed; stale partial no longer applies
      } else {
        interim += r[0].transcript;
      }
    }
    if (interim) lastInterim = interim;
    const finalPart = punctuate(segments.map((s) => s.primary));
    const live = (finalPart + lastInterim).trim();
    if (live || segments.length) report({ type: "ASR_INTERIM", text: live });
    noteTranscriptActivity();
  };

  // Chrome only reports speech/silence transitions through these events. A
  // final result usually arrives after speechend, so the end event must not
  // finish the session — it only (re)arms the gap clock.
  recognition.onspeechstart = () => {
    armWaitTimer(); // VAD says the user started: grant a fresh wait window
  };
  // Chrome in continuous mode never fires the sound/speech *end* events while
  // results stream (measured), so these only ever re-arm clocks — nothing
  // gates on a "still loud" flag.
  recognition.onsoundstart = () => {
    armWaitTimer();
  };
  recognition.onsoundend = () => {
    rearmGapTimer();
  };
  recognition.onspeechend = () => {
    rearmGapTimer();
  };
  recognition.onaudioend = () => {
    rearmGapTimer();
  };

  recognition.onerror = (event) => {
    // no-speech/aborted are routine: Chrome fires them on silence and on
    // stop(). Only real failures are surfaced to the user.
    if (event.error === "no-speech" || event.error === "aborted") return;
    report({ type: "ASR_ERROR", code: event.error });
    cleanup();
  };

  recognition.onend = () => {
    // Chrome stops on its own after a pause even in continuous mode. Restarting
    // is normal; the arming/gap clocks — not onend — decide when we are done.
    if (active && !finalizing && recognition) {
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
    clearClocks();
    armWaitTimer(); // "did a transcript ever arrive" ceiling
    maxTimer = setTimeout(() => {
      maxTimer = null;
      if (active) stop();
    }, MAX_MS);
  } catch (err) {
    report({ type: "ASR_ERROR", code: "start-failed", message: String(err) });
  }
}

// Freeze the session. Runs synchronously so that no result can land between
// "we decided to finish" and "the text is snapshotted": everything this session
// produced is captured here, once.
function cleanup() {
  active = false;
  clearClocks();
  if (recognition) {
    try {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.onspeechstart = recognition.onsoundstart = recognition.onsoundend = null;
      recognition.onspeechend = recognition.onaudioend = null;
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
  if (finalizing || finalReported) return; // idempotent per session
  finalizing = true;
  finalReported = true; // close the window before any await

  // Freeze first, snapshot second. No await in between, so the last result can
  // not slip in after the snapshot and get lost.
  const interimLeft = lastInterim.trim();
  // 候选融合:词典投票选出更优主候选(平票不动、无词典空操作)
  const raw = fuseCandidates(segments).map((s) => ({ primary: s.primary, alts: [...(s.alts || [])] }));
  cleanup();

  // A partial transcript is still the user's speech. Handlers are detached,
  // so no late final can double-count it: commit it rather than drop it.
  // This is what made text vanish mid-dictation when the pause timer fired
  // before Chrome finalized the last sentence.
  if (interimLeft) {
    raw.push({ primary: interimLeft, alts: [] });
  }

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
      text = renderStyle(punctuate(raw.map((s) => s.primary))).trim();
    }
  } else {
    // rule path (instant, no model)
    text = renderStyle(punctuate(raw.map((s) => s.primary))).trim();
  }
  // 本地组织:口癖清理 + 分段(保守规则,详见 organize 注释)
  text = organize(text);
  finalizing = false;
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
