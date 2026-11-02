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
import {
  isWhisperReady,
  installWhisper,
  tryInitWhisper,
  deleteWhisper,
  isWhisperCached,
  WhisperSession,
} from "./whisper-engine.js";
import {
  isSenseVoiceReady,
  installSenseVoice,
  tryInitSenseVoice,
  deleteSenseVoice,
  isSenseVoiceCached,
  SenseVoiceSession,
} from "./sensevoice-engine.js";

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
// 优雅收尾窗口:gap 触发后先 recognition.stop()(规范:冲刷已收音频的
// pending final),在窗口内继续接收 final/interim——修复"尾字丢失"
//(实测:说完"事件"停顿,1.6s 计时器在 final 到达前冻结,"件"被截)。
// onend 或窗口到期即提交。
const GRACE_MS = 900;
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
let finishing = false; // 优雅收尾窗口进行中(gap 已触发,等识别器冲刷尾巴)
let graceTimer = null;
let graceSettle = null; // 窗口结束回调(onend 提前结束,否则到期结束)
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
  for (const t of [waitTimer, gapTimer, maxTimer, graceTimer]) if (t) clearTimeout(t);
  waitTimer = gapTimer = maxTimer = graceTimer = null;
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
let ngram1 = null; // Map<字, 频次>
let ngram2 = null; // Map<二元组, 频次>
let ngram3 = null; // Map<三元组, 频次>
let ngram4 = null; // Map<四元组, 频次>
let ngramTotal = 0; // 一元频次总和(归一化用)
let ngramLoading = null;

// 字级 n-gram 语言模型(LLM"下一 token 条件概率"的最小本地版):
// P(c|abc) → P(c|ab) → P(c|a) → P(c),逐级 stupid backoff(折扣 0.4)。
// 低阶必须用真实条件概率(除以低阶上下文频次),否则关键判别点
// (数字/树的)在高阶缺失时全落常数,LM 失去分辨力(实测踩坑)。
// vendor/ngram-zh.txt 由 tools/build_ngram_zh.py 构建;加载失败时
// LM 分量置零,融合退化为词典+上下文。
function ensureNgram() {
  if (ngram4 || ngramLoading) return ngramLoading;
  ngramLoading = (async () => {
    try {
      const res = await fetch(new URL("./vendor/ngram-zh.txt", import.meta.url));
      if (!res.ok) return;
      const m1 = new Map();
      const m2 = new Map();
      const m3 = new Map();
      const m4 = new Map();
      let total = 0;
      for (const line of (await res.text()).split("\n")) {
        if (line.length < 5 || line[1] !== "\t") continue;
        const tab = line.indexOf("\t", 2);
        if (tab < 0) continue;
        const gram = line.slice(2, tab);
        const cnt = +line.slice(tab + 1);
        if (!cnt) continue;
        if (line[0] === "1") {
          m1.set(gram, cnt);
          total += cnt;
        } else if (line[0] === "2") m2.set(gram, cnt);
        else if (line[0] === "3") m3.set(gram, cnt);
        else if (line[0] === "4") m4.set(gram, cnt);
      }
      if (m4.size > 100_000 && total > 0) {
        ngram1 = m1;
        ngram2 = m2;
        ngram3 = m3;
        ngram4 = m4;
        ngramTotal = total;
      }
    } catch {
      /* LM 是增益,不是依赖 */
    }
    return ngram4;
  })();
  return ngramLoading;
}

const BO = 0.4; // stupid backoff 折扣

// 文本的字级 LM 对数似然(自然对数)。无表时返回 0。
function lmScore(text) {
  if (!ngram4 || text.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < text.length; i++) {
    let p = 0;
    if (i >= 3) {
      const ctx = ngram3.get(text.slice(i - 3, i));
      if (ctx) {
        const hit = ngram4.get(text.slice(i - 3, i + 1));
        if (hit) p = hit / ctx;
      }
    }
    if (!p && i >= 2) {
      const ctx = ngram2.get(text.slice(i - 2, i));
      if (ctx) {
        const hit = ngram3.get(text.slice(i - 2, i + 1));
        if (hit) p = BO * (hit / ctx);
      }
    }
    if (!p) {
      // 2-gram:P(c|a) = 0.16 × cnt(ac)/cnt(a)
      const a = text[i - 1];
      const ca = ngram1.get(a);
      const hit = ngram2.get(a + text[i]);
      if (ca && hit) p = BO * BO * (hit / ca);
    }
    if (!p) {
      // 一元:P(c) = 0.064 × cnt(c)/total
      const c = ngram1.get(text[i]);
      p = BO * BO * BO * ((c || 0) / ngramTotal || 1e-7);
    }
    total += Math.log(Math.max(p, 1e-8));
  }
  return total;
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

// ---------- candidate fusion:段级格架 Viterbi 重排 ----------
// LLM 的核心洞察在此的最小本地版:不逐段独立选词,而是把每段候选排成
// 格架,对"整条路径"做序列级联合评分——前文的选择通过字级 n-gram 条件
// 概率影响后文的选择(口音/念错的同音候选,由上下文概率定胜负)。
//
// 路径总分 = LM 对数似然(自然对数) + W_DICT·词典分 + W_CTX·上下文分
//   词典(用户意图)权重最高:±2/条 × 3.0 → 压过典型 LM 波动
//   上下文(会话消歧)次之:+1/条 × 1.5
//   LM 是统计兜底,决定同音/近音候选的取舍
// beam 宽 8,路径数 3^N 指数爆炸时按当前总分剪枝。
// 最优路径须比"全主候选路径"高出 MARGIN 才生效(保守换选)。
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

const W_DICT = 3.0;
const W_CTX = 1.5;
const PATH_MARGIN = 1.5; // 最优路径需显著优于默认路径(自然对数单位)
const BEAM_WIDTH = 8;

function pathScore(lm, dict, ctx) {
  return lm + W_DICT * dict + W_CTX * ctx;
}

// 段级格架束搜索:segments = [{primary, alts}] → 每段选一个候选,
// 全局最优路径的选词结果。LM 只在 n-gram 表就绪时参与,否则退化为
// 逐段词典/上下文比较(与旧行为一致)。
function fuseCandidates(list) {
  const useLM = !!ngram4;
  if (!useLM) {
    // 无 LM:退化为"每段独立取 dict/ctx 严格更优者"(v0.12 行为)
    return list.map((seg) => {
      let primary = seg.primary;
      let pd = dictScore(primary);
      let pc = contextVote(primary);
      for (const alt of seg.alts || []) {
        const ad = dictScore(alt);
        const ac = contextVote(alt);
        if (ad > pd || (ad === pd && ac > pc)) {
          primary = alt;
          pd = ad;
          pc = ac;
        }
      }
      return primary === seg.primary ? seg : { ...seg, primary };
    });
  }
  // 束搜索:路径携带每段的选择(choices),天然可逆——不做文本对齐
  let paths = [{ text: "", lm: 0, dict: 0, ctx: 0, choices: [] }];
  for (const seg of list) {
    const cands = [...new Set([seg.primary, ...(seg.alts || [])].filter(Boolean))];
    if (cands.length === 0) continue;
    const next = [];
    for (const p of paths) {
      for (let ci = 0; ci < cands.length; ci++) {
        const c = cands[ci];
        // LM 增量:前段末 3 字作为本段的条件上下文(跨段 n-gram)
        const tail = p.text.slice(-3);
        const lm = p.lm + lmScore(tail + c) - lmScore(tail);
        next.push({
          text: p.text + c,
          lm,
          dict: p.dict + dictScore(c),
          ctx: p.ctx + contextVote(c),
          choices: [...p.choices, ci],
        });
      }
    }
    next.sort((a, b) => pathScore(b.lm, b.dict, b.ctx) - pathScore(a.lm, a.dict, a.ctx));
    paths = next.slice(0, BEAM_WIDTH);
  }
  // 最优路径 vs 默认路径(全 primary),需显著优势才换选
  const best = paths[0];
  const joined = list.map((s) => s.primary).join("");
  const deflm = lmScore(joined);
  const defdict = list.reduce((a, s) => a + dictScore(s.primary), 0);
  const defctx = list.reduce((a, s) => a + contextVote(s.primary), 0);
  if (pathScore(best.lm, best.dict, best.ctx) <= pathScore(deflm, defdict, defctx) + PATH_MARGIN) {
    return list;
  }
  // 反解:choices 存的是每段在去重候选表里的下标,按段还原
  return list.map((seg, i) => {
    const cands = [...new Set([seg.primary, ...(seg.alts || [])].filter(Boolean))];
    const chosen = cands[best.choices[i]] ?? seg.primary;
    return chosen === seg.primary ? seg : { ...seg, primary: chosen };
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

async function start({ lang, dictionary, punctStyle: style, engine, context, recogEngine }) {
  if (!SR) {
    report({ type: "ASR_ERROR", code: "unsupported", message: "此浏览器不支持语音识别" });
    return;
  }
  segments = [];
  lastInterim = "";
  firstResultSeen = false;
  finalizing = false;
  finalReported = false;
  finishing = false;
  graceSettle = null;
  setDictionary(dictionary);
  pageContext = (Array.isArray(context) ? context : [])
    .map((t) => String(t))
    .filter((t) => t.length >= 2 && t.length <= 20)
    .slice(0, 20);
  ensureNgram(); // 懒加载一次,失败容忍
  if (style) punctStyle = style;
  if (engine) engineChoice = engine;
  ensureNnEngine(); // from cache only — never downloads implicitly
  ensureCscEngine();

  sessionLang = lang || "zh-CN";
  // ---------- 识别引擎决策 ----------
  // auto:本地包 available → processLocally(免翻墙/零上传);否则云端。
  // local:强制本地(实验,失败显式报错)。桌面 Linux 实测:包可安装但
  // 会话报 language-not-supported——auto 模式遇到此错误自动回落云端并
  // 记住(本浏览器生命周期内不再尝试)。
  recogMode = recogEngine === "server" || recogEngine === "local" || recogEngine === "whisper" || recogEngine === "sensevoice" ? recogEngine : "auto";
  let useLocal = false;
  if (recogMode === "local") {
    localLangTag = String(lang || "zh-CN"); // 强制本地:直接用用户语言
    useLocal = true;
  } else if (recogMode === "auto" && !localEngineBroken && typeof SR.available === "function") {
    const want = String(lang || "zh-CN");
    for (const tag of [want, want.split(/[-_]/)[0]]) {
      try {
        if ((await SR.available({ langs: [tag], processLocally: true })) === "available") {
          localLangTag = tag;
          useLocal = true;
          break;
        }
      } catch {
        /* API 不可用 → 云端 */
      }
    }
  }
  // 本地引擎(whisper/sensevoice)须模型就绪才可用;未就绪(用户没下载/
  // 缓存丢失/加载失败)时优雅回落云端识别并提示——"唤不起语音"永远不该
  // 发生(实测:选了 SenseVoice 未下载模型时,会话瞬间报 audio-capture)。
  if (recogMode === "whisper") {
    await ensureWhisperEngine();
    if (isWhisperReady()) {
      startWhisperRecognition();
      return;
    }
    report({ type: "ASR_HINT", message: "Whisper 模型未就绪,本次使用云端识别" });
  } else if (recogMode === "sensevoice") {
    await ensureSenseVoiceEngine();
    if (isSenseVoiceReady()) {
      startSenseVoiceRecognition();
      return;
    }
    report({ type: "ASR_HINT", message: "SenseVoice 模型未就绪,本次使用云端识别" });
  }
  startRecognition(useLocal);
}

async function ensureWhisperEngine() {
  if (isWhisperReady()) return;
  try { await tryInitWhisper(); } catch { /* best effort */ }
}

async function ensureSenseVoiceEngine() {
  if (isSenseVoiceReady()) return;
  try { await tryInitSenseVoice(); } catch { /* best effort */ }
}

function startSenseVoiceRecognition() {
  sessionUseLocal = false;
  recognition = new SenseVoiceSession();
  recognition.lang = sessionLang || "zh-CN";
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) {
        const primary = r[0].transcript;
        if (primary && primary.trim()) segments.push({ primary, alts: [] });
        lastInterim = "";
      }
    }
    const finalPart = punctuate(segments.map((s) => s.primary));
    const live = finalPart.trim();
    if (live || segments.length) report({ type: "ASR_INTERIM", text: live });
    noteTranscriptActivity();
  };
  recognition.onerror = (event) => {
    report({ type: "ASR_ERROR", code: event.error || "sensevoice-error", message: event.message });
    cleanup();
  };
  recognition.onend = () => { /* 计时器管理在 offscreen 层 */ };
  recognition.onspeechstart = () => { armWaitTimer(); };
  recognition.onspeechend = () => { rearmGapTimer(); };

  try {
    recognition.start();
    active = true;
    clearClocks();
    armWaitTimer();
    maxTimer = setTimeout(() => {
      maxTimer = null;
      if (active) stop();
    }, MAX_MS);
  } catch (err) {
    report({ type: "ASR_ERROR", code: "start-failed", message: String(err) });
  }
}

function startWhisperRecognition() {
  sessionUseLocal = false; // 走 Whisper(非 SR)
  recognition = new WhisperSession();
  recognition.lang = sessionLang || "zh-CN";
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) {
        const primary = r[0].transcript;
        if (primary && primary.trim()) segments.push({ primary, alts: [] });
        lastInterim = "";
      }
    }
    const finalPart = punctuate(segments.map((s) => s.primary));
    const live = finalPart.trim();
    if (live || segments.length) report({ type: "ASR_INTERIM", text: live });
    noteTranscriptActivity();
  };
  recognition.onerror = (event) => {
    report({ type: "ASR_ERROR", code: event.error || "whisper-error", message: event.message });
    cleanup();
  };
  recognition.onend = () => {
    // Whisper 会话结束(onend 由 stop/abort 触发,不停计时器)
  };
  recognition.onspeechstart = () => { armWaitTimer(); };
  recognition.onspeechend = () => { rearmGapTimer(); };

  try {
    recognition.start();
    active = true;
    clearClocks();
    armWaitTimer();
    maxTimer = setTimeout(() => {
      maxTimer = null;
      if (active) stop();
    }, MAX_MS);
  } catch (err) {
    report({ type: "ASR_ERROR", code: "start-failed", message: String(err) });
  }
}

let sessionLang = "zh-CN"; // 本会话用户设置的识别语言
let recogMode = "auto"; // auto | server | local(每会话)
let localEngineBroken = false; // 本地引擎在本浏览器确认不可用(如桌面 Linux)
let localLangTag = ""; // 探测通过的本地语言标签
let sessionUseLocal = false; // 当前会话实际是否走本地

function startRecognition(useLocal) {
  sessionUseLocal = useLocal;
  recognition = new SR();
  recognition.lang = useLocal && localLangTag ? localLangTag : sessionLang || "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3; // candidates for local fusion (and AI re-ranking if ever revived)
  if (useLocal) {
    try {
      recognition.processLocally = true; // 端上识别:零网络
    } catch {
      /* 旧浏览器无此属性 → 赋值无害 */
    }
  }

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
    // 本地引擎不被平台支持(实测桌面 Linux):auto 模式自动回落云端
    if (sessionUseLocal && event.error === "language-not-supported") {
      if (recogMode === "auto") {
        localEngineBroken = true;
        console.warn("[cv] 本地识别不受支持,回落云端");
        clearClocks();
        try { recognition.onresult = recognition.onerror = recognition.onend = null; recognition.abort(); } catch { /* noop */ }
        recognition = null;
        startRecognition(false);
        return;
      }
      report({ type: "ASR_ERROR", code: "local-unsupported", message: "此设备的本地识别不支持当前语言" });
      cleanup();
      return;
    }
    report({ type: "ASR_ERROR", code: event.error });
    cleanup();
  };

  recognition.onend = () => {
    // 优雅收尾中:识别器确认结束,冲刷的 pending final 已在手,提前提交
    if (finishing) {
      if (graceSettle) graceSettle();
      return;
    }
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
      recognition.onspeechstart = recognition.onspeechend = null;
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

// 结束入口:所有路径(gap/快捷键/超时)先走优雅收尾——recognition.stop()
// 按规范冲刷已收音频的 pending final,GRACE_MS 窗口内继续接收尾字,
// onend 或到期后提交。修复"尾字丢失"(实测:说完"事件"停顿,1.6s 计时
// 器在 final 到达前冻结,"件"被截)。
function stop(force = false) {
  if (finalizing || finalReported) return;
  // 强制路径(会话切换):跳过宽限窗立即提交,旧会话文字不能丢
  if (force || !recognition || !active) {
    finalizeNow();
    return;
  }
  if (finishing) return;
  finishing = true;
  let settled = false;
  graceSettle = () => {
    if (settled) return;
    settled = true;
    graceSettle = null;
    finalizeNow();
  };
  try {
    recognition.stop(); // 冲刷尾巴;onend 提前结束等待
  } catch {
    /* 已停止 */
  }
  graceTimer = setTimeout(graceSettle, GRACE_MS);
}

async function finalizeNow() {
  if (finalizing || finalReported) return; // idempotent per session
  finalizing = true;
  finalReported = true; // close the window before any await
  finishing = false;

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
    // 会话切换:旧会话(收尾中或活跃)强制立即提交,再开新会话
    if (active || finishing) stop(true);
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
   else if (message?.type === "WHISPER_INSTALL_REQ") {
    (async () => {
      try {
        await ensureOffscreen();
        const res = await chrome.runtime.sendMessage({ type: "WHISPER_INSTALL" });
        sendResponse(res || { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  } else if (message?.type === "WHISPER_DELETE_REQ") {
    (async () => {
      try {
        await ensureOffscreen();
        const res = await chrome.runtime.sendMessage({ type: "WHISPER_DELETE" });
        sendResponse(res || { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  } else if (message?.type === "SENSEVOICE_INSTALL") {
    (async () => {
      try {
        reportModelStatus({ svPhase: "downloading", svPct: 0 });
        await installSenseVoice(async (loaded, total, stage) => {
          const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          reportModelStatus({ svPhase: "downloading", svPct: pct, svStage: stage });
        });
        await reportModelStatus({ svPhase: "ready", svPct: 100 });
        sendResponse({ ok: true });
      } catch (err) {
        await reportModelStatus({ svPhase: "error", message: String(err.message || err).slice(0, 120) });
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  } else if (message?.type === "SENSEVOICE_DELETE") {
    (async () => {
      await deleteSenseVoice();
      reportModelStatus({ svPhase: "not-installed", svPct: 0 });
      sendResponse({ ok: true });
    })();
    return true;
  } else if (message?.type === "WHISPER_INSTALL") {
    (async () => {
      try {
        reportModelStatus({ whPhase: "downloading", whPct: 0 });
        await installWhisper(async (loaded, total, stage) => {
          const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          reportModelStatus({ whPhase: "downloading", whPct: pct, whStage: stage });
        });
        await reportModelStatus({ whPhase: "ready", whPct: 100 });
        sendResponse({ ok: true });
      } catch (err) {
        await reportModelStatus({ whPhase: "error", message: String(err.message || err).slice(0, 120) });
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  } else if (message?.type === "WHISPER_DELETE") {
    (async () => {
      await deleteWhisper();
      reportModelStatus({ whPhase: "not-installed", whPct: 0 });
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
