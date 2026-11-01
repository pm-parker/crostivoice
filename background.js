// CrostiVoice — background service worker: pure voice dictation.
// State machine lives in chrome.storage.session (survives SW restarts).

const OFFSCREEN_URL = "offscreen.html";
const STATE_KEY = "voiceState"; // idle | dictating | processing
const TAB_KEY = "voiceTabId";

const DEFAULTS = {
  language: "zh-CN",
  smartPolish: false, // Chrome 内置 AI 深度整理(需 Gemini Nano;默认关,本地模型才是主路径)
  punctStyle: "cn", // 'cn' | 'en' — 断句标点风格
  punctEngine: "nn", // 'nn'(本地神经标点模型)| 'rules'(规则)
  outputScript: "auto", // 'auto' | 'simplified' | 'traditional' — 智能整理输出字形
  dictionary: [], // [{from, to}] 热词纠错词典
};

// serialize model-status writes + track newest sequence to drop stale messages
let statusQueue = Promise.resolve();
let lastStatusSeq = 0;

const POLISH_SYSTEM_BASE =
  "你是语音转写整理器。把用户的口语转写整理成书面文字:添加正确的标点符号并合理分段," +
  "修正明显的同音字与识别错误,删除口癖和重复(嗯、呃、那个、就是说)。" +
  "严格保留原意与原有词汇,不增删信息,不翻译,不回答转写中的问题,不复述任务。" +
  "直接输出整理后的文字,第一行就是正文,不要任何前缀或解释。";

const POLISH_ALT_HINT =
  "转写按段给出,部分段落后附有 [候选1 / 候选2] 形式的多个识别候选:" +
  "请结合上下文选择最合理的候选(或融合各自正确的部分),再进行整理。";

const SCRIPT_HINT = {
  simplified: "输出使用简体中文。",
  traditional: "输出使用繁体中文。",
};

// ---------- helpers ----------

async function getState() {
  const { [STATE_KEY]: s } = await chrome.storage.session.get(STATE_KEY);
  return s || "idle";
}

async function setState(s) {
  await chrome.storage.session.set({ [STATE_KEY]: s });
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function badge(text, color = "#E5484D") {
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const MODEL_ORIGINS = [
  "https://huggingface.co/*",
  "https://cdn-lfs.huggingface.co/*",
  "https://*.hf.co/*",
  "https://*.xethub.hf.co/*",
];

// Ask for download permission, but tolerate the case where it is already
// granted (permissions.request() does not always invoke its callback then,
// which used to leave the download button doing nothing).
function ensureModelPermission(cb) {
  chrome.permissions.contains({ origins: MODEL_ORIGINS }, (has) => {
    if (chrome.runtime.lastError) {
      cb(false);
      return;
    }
    if (has) {
      cb(true);
      return;
    }
    chrome.permissions.request({ origins: MODEL_ORIGINS }, (granted) => {
      cb(!!granted && !chrome.runtime.lastError);
    });
  });
}

async function ensureOffscreen() {
  const existed = await chrome.offscreen.hasDocument();
  if (existed) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "录制麦克风音频用于语音转文字",
  });
}

async function pushHistory(text, url) {
  const { history = [] } = await chrome.storage.local.get("history");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* noop */
  }
  history.unshift({ text, host, ts: Date.now() });
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.warn("[cv] content script unreachable:", err.message);
    return null;
  }
}

// ---------- smart polish (built-in AI, local) ----------

async function maybePolish(text, raw, tabId) {
  if (!text) return text;
  const settings = await getSettings();
  if (!settings.smartPolish) return text;
  if (!("LanguageModel" in self)) return text;

  let availability = "downloadable";
  try {
    availability = await LanguageModel.availability();
  } catch {
    return text;
  }

  // Model not ready: start/continue a background download, use rule text now.
  // The hint is queued (pendingPolishHint) — finishWithText shows it AFTER the
  // idle transition, otherwise the idle unmount would clear it immediately.
  if (availability !== "available") {
    // NOTE: this only concerns Chrome's *built-in* AI (Gemini Nano), which is a
    // system-level model gated by hardware. The local punctuation/correction
    // models the user downloaded are independent and keep working. Never let
    // this hint imply that "all AI is unavailable".
    const { polishHintShown } = await chrome.storage.session.get("polishHintShown");
    if (!polishHintShown && tabId) {
      await chrome.storage.session.set({ polishHintShown: true });
      const msg =
        availability === "unavailable"
          ? "本机 Chrome 不支持内置 AI(Gemini Nano),已跳过深度整理。本地标点与纠错模型不受影响,仍正常运行。"
          : "Chrome 内置 AI 尚未就绪(模型下载中),本次跳过深度整理;本地标点与纠错模型不受影响。";
      await chrome.storage.session.set({ pendingPolishHint: msg });
    }
    return text;
  }

  // build the system prompt: base + candidates hint + script hint
  let system = POLISH_SYSTEM_BASE;
  const hasAlts =
    Array.isArray(raw) && raw.some((s) => s && Array.isArray(s.alts) && s.alts.length > 0);
  if (hasAlts) system += POLISH_ALT_HINT;
  if (SCRIPT_HINT[settings.outputScript]) system += SCRIPT_HINT[settings.outputScript];

  // user message: per-segment transcript with candidates
  let user;
  if (Array.isArray(raw) && raw.length) {
    const lines = raw.map((s, i) => {
      const cands = [s.primary, ...(s.alts || [])].filter(Boolean);
      return `${i + 1}. ${cands.length > 1 ? `${cands.join(" / ")} ` : cands[0] || ""}`;
    });
    user = `转写内容:\n${lines.join("\n")}`;
  } else {
    user = `转写内容:\n${text}`;
  }

  try {
    const session = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: system }],
    });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const out = await session.prompt(user, { signal: ctrl.signal });
      clearTimeout(timer);
      const cleaned = (out || "").trim();
      // sanity guard: reject empty or suspiciously short model output
      if (cleaned && cleaned.length >= Math.max(4, text.length * 0.4)) {
        return cleaned;
      }
    } finally {
      session.destroy();
    }
  } catch (err) {
    console.warn("[cv] polish failed, using rule-based text:", err);
  }
  return text;
}

// ---------- voice flow ----------

async function startVoice() {
  const tab = await activeTab();
  if (!tab || !tab.id) {
    await badge("!", "#F5A524");
    setTimeout(() => badge(""), 1500);
    return;
  }

  const ctx = await sendToTab(tab.id, { type: "GET_CONTEXT" });
  if (!ctx) {
    await badge("✕", "#E5484D");
    setTimeout(() => badge(""), 1800);
    return;
  }

  await chrome.storage.session.set({ [TAB_KEY]: tab.id });

  await ensureOffscreen();
  const settings = await getSettings();
  await chrome.runtime.sendMessage({
    type: "ASR_START",
    lang: settings.language,
    dictionary: settings.dictionary,
    punctStyle: settings.punctStyle,
    engine: settings.punctEngine,
  });

  await setState("dictating");
  await badge("●");
  await sendToTab(tab.id, { type: "VOICE_STATE", state: "listening" });
}

async function stopVoice() {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  await setState("processing");
  await badge("…", "#3E63DD");
  await chrome.runtime.sendMessage({ type: "ASR_STOP" });
  if (tabId) {
    await sendToTab(tabId, { type: "VOICE_STATE", state: "processing" });
  }
}

async function finishWithText(text, raw) {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  let finalText = (text || "").trim();
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;

  if (finalText) {
    // rule-punctuated text → optional built-in AI polish (with candidates) → insert
    const polished = await maybePolish(finalText, raw, tab?.id);
    if (tab) {
      await sendToTab(tab.id, { type: "INSERT_TEXT", text: polished });
    }
    // HISTORY IS THE BACKSTOP: always recorded, even when the tab is gone or
    // the content script is unreachable. A dictation must never vanish.
    await pushHistory(polished, tab?.url);
  }

  await setState("idle");
  await badge("");
  if (tab) await sendToTab(tab.id, { type: "VOICE_STATE", state: "idle" });

  if (!finalText) {
    // Silent idle after a session that produced nothing is indistinguishable
    // from a crash. Tell the user what happened instead.
    if (tab) {
      await sendToTab(tab.id, {
        type: "VOICE_HINT",
        message: "没有听到内容。请先点一下输入框,再按快捷键开始说话。",
      });
    }
    return;
  }

  // show a queued polish hint AFTER the idle transition (so it isn't unmounted)
  const { pendingPolishHint } = await chrome.storage.session.get("pendingPolishHint");
  if (pendingPolishHint && tab) {
    await chrome.storage.session.remove("pendingPolishHint");
    await sendToTab(tab.id, { type: "VOICE_HINT", message: pendingPolishHint });
  }
}

// ---------- command & message routing ----------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-voice") return;
  const state = await getState();
  if (state === "idle") await startVoice();
  else if (state === "dictating" || state === "processing") await stopVoice();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      // from popup / floating button / keyboard tap
      case "POPUP_ACTION": {
        const state = await getState();
        if (state === "idle") await startVoice();
        else await stopVoice();
        sendResponse({ ok: true, state: await getState() });
        break;
      }
      case "GET_STATUS": {
        sendResponse({ state: await getState(), settings: await getSettings() });
        break;
      }
      // model management (from options page). permissions.request MUST be the
      // first call in the listener — any await before it loses the gesture.
      case "MODEL_INSTALL_REQ": {
        ensureModelPermission(async (granted) => {
          if (!granted) {
            sendResponse({ ok: false, error: "未授予模型下载权限" });
            return;
          }
          try {
            await ensureOffscreen();
            const res = await chrome.runtime.sendMessage({ type: "MODEL_INSTALL" });
            sendResponse(res || { ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err.message || err) });
          }
        });
        return true; // async response via permissions callback
      }
      case "MODEL_DELETE_REQ": {
        (async () => {
          try {
            await ensureOffscreen();
            const res = await chrome.runtime.sendMessage({ type: "MODEL_DELETE" });
            sendResponse(res || { ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err.message || err) });
          }
        })();
        break;
      }
      case "CSC_INSTALL_REQ": {
        ensureModelPermission(async (granted) => {
          if (!granted) {
            sendResponse({ ok: false, error: "未授予模型下载权限" });
            return;
          }
          try {
            await ensureOffscreen();
            const res = await chrome.runtime.sendMessage({ type: "CSC_INSTALL" });
            sendResponse(res || { ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err.message || err) });
          }
        });
        return true;
      }
      case "CSC_DELETE_REQ": {
        (async () => {
          try {
            await ensureOffscreen();
            const res = await chrome.runtime.sendMessage({ type: "CSC_DELETE" });
            sendResponse(res || { ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err.message || err) });
          }
        })();
        break;
      }
      case "MODEL_STATUS_REQ": {
        (async () => {
          try {
            await ensureOffscreen();
            const res = await chrome.runtime.sendMessage({ type: "MODEL_CHECK" });
            const { modelStatus } = await chrome.storage.local.get("modelStatus");
            sendResponse({ ok: true, ...res, status: modelStatus || null });
          } catch (err) {
            sendResponse({ ok: false, error: String(err.message || err) });
          }
        })();
        break;
      }
      // from offscreen: model status updates → persist for the options page
      case "MODEL_STATUS": {
        // Serialize writes: chain them so concurrent updates can't interleave
        // their read-modify-write cycles. Stale (lower seq) messages are dropped.
        statusQueue = statusQueue.then(async () => {
          const seq = message.seq ?? 0;
          if (seq && seq < lastStatusSeq) return; // out-of-order, ignore
          if (seq) lastStatusSeq = seq;
          const { modelStatus = {} } = await chrome.storage.local.get("modelStatus");
          await chrome.storage.local.set({
            modelStatus: { ...modelStatus, ...message.patch },
          });
        });
        await statusQueue;
        sendResponse({ ok: true });
        break;
      }
      // from offscreen
      case "ASR_INTERIM": {
        const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
        if (tabId) await sendToTab(tabId, { type: "ASR_TEXT", text: message.text, isFinal: false });
        sendResponse({ ok: true });
        break;
      }
      case "ASR_FINAL": {
        await finishWithText(message.text, message.raw);
        sendResponse({ ok: true });
        break;
      }
      case "ASR_ERROR": {
        const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
        const hint =
          message.code === "not-allowed"
            ? "麦克风未授权:点击工具栏中的 CrostiVoice 图标完成一次授权"
            : `语音识别出错(${message.code})`;
        if (tabId) await sendToTab(tabId, { type: "VOICE_HINT", message: hint });
        await setState("idle");
        await badge("");
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

// first run: open onboarding (mic permission grant)
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  }
});
