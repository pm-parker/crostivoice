// CrostiVoice options page — v0.9 redesigned

const $ = (id) => document.getElementById(id);
const svg = (path) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

// ---------- toast ----------

let toastTimer = null;
function toast(message, kind = "success") {
  const el = $("toast");
  el.className = "show";
  el.innerHTML =
    (kind === "success"
      ? svg(ICONS.check)
      : kind === "error"
        ? svg(ICONS.alert)
        : svg('<circle cx="12" cy="12" r="10"/>')) + `<span>${message}</span>`;
  el.style.color = "var(--cv-text-inverse)";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), kind === "error" ? 4500 : 2800);
}

// ---------- dictionary ----------

function parseDictionary(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.split(/\s*(?:->|=>|=|→)\s*/);
      return m.length >= 2 && m[0] && m[1] ? { from: m[0], to: m.slice(1).join("=") } : null;
    })
    .filter(Boolean);
}

function getDictionary() {
  return chrome.storage.local.get("dictionary").then((r) => r.dictionary || []);
}

function saveDictionary(list) {
  return chrome.storage.local.set({ dictionary: list });
}

function renderDictList(list) {
  const ul = $("dict-list");
  const empty = $("dict-empty");
  const count = $("dict-count");
  ul.replaceChildren();
  empty.style.display = list.length ? "none" : "";
  count.hidden = !list.length;
  count.textContent = `共 ${list.length} 条词条`;
  for (const [i, e] of list.entries()) {
    const chip = document.createElement("div");
    chip.className = "dict-chip";
    const pair = document.createElement("span");
    pair.className = "pair";
    pair.textContent = e.from;
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    const to = document.createElement("span");
    to.textContent = e.to;
    pair.append(arrow, to);
    const del = document.createElement("button");
    del.className = "ghost-danger";
    del.title = "删除词条";
    del.setAttribute("aria-label", `删除 ${e.from}`);
    del.innerHTML = svg(ICONS.x);
    del.addEventListener("click", async () => {
      const next = list.filter((_, j) => j !== i);
      await saveDictionary(next);
      renderDictList(next);
    });
    chip.append(pair, del);
    ul.appendChild(chip);
  }
}

async function addDictEntry() {
  const from = $("dict-from").value.trim();
  const to = $("dict-to").value.trim();
  const err = $("dict-err");
  if (!from || !to) return;
  const list = await getDictionary();
  if (list.some((e) => e.from === from)) {
    err.textContent = `「${from}」已存在`;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const next = [...list, { from, to }];
  await saveDictionary(next);
  renderDictList(next);
  $("dict-from").value = "";
  $("dict-to").value = "";
  $("dict-from").focus();
}

$("dict-add-btn").addEventListener("click", addDictEntry);
[$("dict-from"), $("dict-to")].forEach((inp) =>
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDictEntry();
  })
);

// ---------- scrollspy ----------

const navLinks = [...document.querySelectorAll("nav.anchor a")];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
const spy = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        navLinks.forEach((a) =>
          a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`)
        );
      }
    }
  },
  { rootMargin: "-30% 0px -60% 0px" }
);
sections.forEach((s) => s && spy.observe(s));

// ---------- model cards ----------

const PHASE = {
  "not-installed": { cls: "gray", text: "未安装" },
  loading: { cls: "gray", text: "加载中…" },
  downloading: { cls: "blue", text: "下载中" },
  ready: { cls: "green", text: "已就绪" },
  error: { cls: "red", text: "出错" },
};

function setBadge(prefix, phase, extra) {
  const badge = $(`${prefix}-badge`);
  const text = $(`${prefix}-badge-text`);
  const p = PHASE[phase] || PHASE["not-installed"];
  badge.className = `badge ${p.cls}`;
  text.textContent = p.text + (extra ? ` ${extra}` : "");
}

function setCardUI(prefix, phase, pct, err) {
  const badge = $(`${prefix}-badge`);
  const badgeText = $(`${prefix}-badge-text`);
  const bar = $(`${prefix}-progress`);
  const barWrap = $(`${prefix}-progress-wrap`);
  const row = $(`${prefix}-progress-row`);
  const num = $(`${prefix}-progress-num`);
  const errEl = $(`${prefix}-err`);
  const dl = $(`${prefix}-download`);
  const del = $(`${prefix}-delete`);
  const p = PHASE[phase] || PHASE["not-installed"];
  badge.className = `badge ${p.cls}`;
  badgeText.textContent = p.text;
  dl.hidden = phase !== "not-installed" && phase !== "error";
  if (phase === "error") {
    dl.innerHTML =
      svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>') +
      "重试";
  } else {
    dl.innerHTML =
      svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>') +
      "下载模型";
  }
  del.hidden = phase !== "ready";
  errEl.hidden = !err;
  if (err) errEl.textContent = err;
  if (phase === "downloading") {
    badgeText.textContent = `下载中 ${pct ?? 0}%`;
    barWrap.hidden = false;
    row.hidden = false;
    num.textContent = `${pct ?? 0}%`;
    bar.style.width = `${Math.max(4, pct ?? 4)}%`;
    bar.classList.remove("done");
  } else {
    barWrap.hidden = true;
    row.hidden = true;
  }
}

function applyModelStatus(status) {
  const pm = status.phase || "not-installed";
  setCardUI("pm", pm, status.pct, pm === "error" ? status.message : null);
  const csc = status.cscPhase || "not-installed";
  setCardUI("csc", csc, status.cscPct, csc === "error" ? status.message : null);
  // rule-engine note when neural punct is off/not installed
  $("row-punct-style").classList.toggle(
    "dep-off",
    ($("pe-rules").checked || pm !== "ready") && false
  );
}

async function refreshModelStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "MODEL_STATUS_REQ" });
    const st = res?.status || {};
    applyModelStatus({
      phase: res?.ready ? "ready" : st.phase || "not-installed",
      pct: st.pct,
      message: st.message,
      cscPhase: res?.cscReady ? "ready" : st.cscPhase || "not-installed",
      cscPct: st.cscPct,
    });
  } catch (e) {
    setCardUI("pm", "error", 0, e.message);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "modelStatus" in changes) {
    const st = changes.modelStatus.newValue || {};
    applyModelStatus({
      phase: st.phase || "not-installed",
      pct: st.pct,
      message: st.message,
      cscPhase: st.cscPhase || "not-installed",
      cscPct: st.cscPct,
    });
  }
});

async function requestAndInstall(prefix, msgType) {
  const btn = $(`${prefix}-download`);
  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = "准备下载…";
  // immediate feedback — the permission prompt may take a moment
  setBadge(prefix, "loading");

  let settled = false;
  const guard = setTimeout(() => {
    if (settled) return;
    settled = true;
    btn.dataset.busy = "";
    btn.disabled = false;
    btn.innerHTML = label;
    refreshModelStatus();
  }, 15000);

  try {
    const res = await chrome.runtime.sendMessage({ type: msgType });
    if (!settled && res && res.ok === false) {
      toast(`下载失败:${res.error || "未知错误"}`, "error");
    }
  } catch (e) {
    toast(`下载失败:${e.message || e}`, "error");
  } finally {
    clearTimeout(guard);
    settled = true;
    btn.dataset.busy = "";
    btn.disabled = false;
    btn.innerHTML = label;
    refreshModelStatus();
  }
}

$("pm-download").addEventListener("click", () => requestAndInstall("pm", "MODEL_INSTALL_REQ"));
$("csc-download").addEventListener("click", () => requestAndInstall("csc", "CSC_INSTALL_REQ"));

// two-step delete confirm (button morphs, 3s timeout)
function armTwoStep(btn, onConfirm) {
  if (btn.dataset.armed === "1") {
    clearTimeout(+btn.dataset.timer);
    btn.dataset.armed = "";
    btn.classList.remove("solid-danger");
    btn.innerHTML = ICONS_DELETE;
    onConfirm();
    return;
  }
  btn.dataset.armed = "1";
  btn.dataset.label = btn.innerHTML;
  btn.classList.add("solid-danger");
  btn.textContent = "确认删除";
  btn.dataset.timer = String(
    setTimeout(() => {
      btn.dataset.armed = "";
      btn.classList.remove("solid-danger");
      btn.innerHTML = ICONS_DELETE;
    }, 3000)
  );
}
const ICONS_DELETE =
  svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>') +
  "删除";
$("pm-delete").addEventListener("click", (e) =>
  armTwoStep(e.currentTarget, async () => {
    await chrome.runtime.sendMessage({ type: "MODEL_DELETE_REQ" }).catch(() => {});
    refreshModelStatus();
    toast("标点模型已删除");
  })
);
$("csc-delete").addEventListener("click", (e) =>
  armTwoStep(e.currentTarget, async () => {
    await chrome.runtime.sendMessage({ type: "CSC_DELETE_REQ" }).catch(() => {});
    refreshModelStatus();
    toast("纠错模型已删除");
  })
);

// ---------- load / save ----------

async function isLocalModelsReady() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "MODEL_STATUS_REQ" });
    return !!(res?.ready || res?.cscReady);
  } catch {
    return false;
  }
}

async function refreshBuiltinNote() {
  const note = $("builtin-note");
  if (!note) return;
  const localReady = await isLocalModelsReady();
  const localPart = localReady
    ? "本地标点/纠错模型已就绪并生效。"
    : "本地模型未安装,可在上方下载。";
  // Chrome 内置 AI 只 attest [en/ja/es/de/fr] 输出(与 background.js 的
  // LM_SUPPORTED_OUTPUT 同步维护)。未 attest 语言直接静态说明,绝不调用
  // API——裸调用 availability() 正是扩展页 output-language 错误的来源。
  const { language } = await chrome.storage.local.get("language");
  const base = String(language || "zh-CN").toLowerCase().split(/[-_]/)[0];
  if (!["en", "ja", "es", "de", "fr"].includes(base)) {
    note.textContent = `当前识别语言(${base === "zh" ? "中文" : base})暂不在 Chrome 内置 AI 的输出支持列表(英/日/西/德/法),深度整理自动跳过。${localPart}`;
    return;
  }
  if ("LanguageModel" in self) {
    try {
      const a = await LanguageModel.availability({
        expectedInputs: [{ type: "text", languages: ["en", base] }],
        expectedOutputs: [{ type: "text", languages: [base] }],
      });
      note.textContent =
        a === "available"
          ? `Chrome 内置 AI 可用,深度整理将自动生效。${localPart}`
          : a === "downloadable" || a === "downloading"
            ? `Chrome 内置 AI 模型待下载(由 Chrome 自行管理)。${localPart}`
            : `本机 Chrome 不提供内置 AI(Gemini Nano,需 Chromebook Plus 级硬件),因此不启用深度整理。${localPart}`;
    } catch {
      note.textContent = `无法检测 Chrome 内置 AI。${localPart}`;
    }
  } else {
    note.textContent = `此浏览器版本不提供 Chrome 内置 AI。${localPart}`;
  }
}

async function load() {
  const { settings } = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  $("language").value = settings.language;
  $("recog-engine").value = settings.recogEngine || "auto";
  const { floatButton = true } = await chrome.storage.local.get("floatButton");
  $("float-button").checked = !!floatButton;
  $("smart-polish").checked = settings.smartPolish === true;
  document.querySelector(`input[name="punct"][value="${settings.punctStyle || "cn"}"]`).checked = true;
  document.querySelector(`input[name="pengine"][value="${settings.punctEngine || "nn"}"]`).checked = true;
  document.querySelector(
    `input[name="script"][value="${settings.outputScript || "auto"}"]`
  ).checked = true;
  renderDictList(await getDictionary());

  // version chip
  const manifest = chrome.runtime.getManifest();
  $("ver-chip").textContent = `v${manifest.version}`;
  $("ver-chip-about").textContent = `v${manifest.version}`;
  refreshModelStatus();
  refreshBuiltinNote();
  refreshRecogLocal();
}

// ---------- 本地识别语言包(端上识别,SpeechRecognition.install) ----------
// install() 需要真实的用户手势(transient activation),因此探测与安装
// 都在设置页本地直接调用——不经过 service worker 中转(消息往返会丢手势)。
let rlBusy = false;
async function refreshRecogLocal() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const badge = $("rl-badge");
  const text = $("rl-badge-text");
  const btn = $("rl-install");
  const note = $("rl-note");
  badge.className = "badge gray";
  if (!SR || typeof SR.available !== "function" || typeof SR.install !== "function") {
    text.textContent = "此浏览器不支持";
    note.textContent = "需要 Chrome 149+(当前浏览器没有端上识别 API)";
    return;
  }
  const { language } = await chrome.storage.local.get("language");
  const lang = String(language || "zh-CN");
  let status;
  try {
    status = await SR.available({ langs: [lang], processLocally: true });
  } catch {
    status = "unavailable";
  }
  const map = {
    available: ["已安装 · 可离线识别", "green"],
    downloading: ["下载中…", "blue"],
    downloadable: ["未安装(约几十 MB,装后免翻墙)", "gray"],
    unavailable: ["此设备/语言不支持", "gray"],
  };
  const [label, color] = map[status] || [status, "gray"];
  text.textContent = label;
  badge.className = `badge ${color}`;
  btn.hidden = status !== "downloadable";
  note.textContent =
    status === "available"
      ? "设备端上识别包已就绪;「自动」引擎将优先使用它(免翻墙、零上传)"
      : "设备端上识别包,下载后无需网络即可识别(支持与否取决于设备/系统)";

  // Whisper 模型状态(独立于 SODA 包)
  try {
    const stRes = await chrome.runtime.sendMessage({ type: "MODEL_STATUS_REQ" });
    const svStatus = stRes?.status?.svPhase;
    const whStatus = stRes?.status?.whPhase;
    const whBadge = $("rl-badge");
    const whText = $("rl-badge-text");
    const whBtn = $("rl-install");
    // 优先显示 SenseVoice 状态(推荐引擎),Whisper 为备选
    if (svStatus === "ready") {
      note.textContent += "\n✅ SenseVoice 本地识别模型已就绪(引擎选「SenseVoice 本地」即可免翻墙使用)";
    } else if (svStatus === "downloading") {
      note.textContent += `\n⏬ SenseVoice 模型下载中… ${stRes?.status?.svPct || 0}%`;
    } else if (whStatus === "ready") {
      note.textContent += "\n✅ Whisper 本地识别模型已就绪(引擎选「Whisper 本地」即可免翻墙使用)";
    } else if (whStatus === "downloading") {
      note.textContent += `\n⏬ Whisper 模型下载中… ${whRes?.status?.whPct || 0}%`;
    } else {
      // SODA 不支持时,Whisper 是替代方案 → 显示下载按钮
      if (status === "unavailable") {
        note.textContent += "\n推荐引擎:SenseVoice 本地(228MB,中文质量优、速度 10 倍于 Whisper、自带标点)";
        if (whBtn) {
          whBtn.hidden = false;
          whBtn.textContent = "下载 SenseVoice 模型";
          whBtn.onclick = async () => {
            if (rlBusy) return;
            rlBusy = true; whBtn.disabled = true;
            whBtn.textContent = "下载中…";
            try {
              await chrome.runtime.sendMessage({ type: "SENSEVOICE_INSTALL_REQ" });
              toast("SenseVoice 模型已下载");
            } catch (e) {
              toast("下载失败:" + String(e.message || e).slice(0, 60));
            }
            whBtn.textContent = "下载 SenseVoice 模型";
            whBtn.disabled = false; rlBusy = false;
            setTimeout(refreshRecogLocal, 800);
          };
        }
      }
    }
  } catch { /* best effort */ }
  btn.onclick = async () => {
    if (rlBusy) return;
    rlBusy = true;
    btn.disabled = true;
    text.textContent = "下载中…";
    badge.className = "badge blue";
    try {
      const ok = await SR.install({ langs: [lang], processLocally: true });
      text.textContent = ok ? "已安装" : "安装未完成";
      if (!ok) badge.className = "badge gray";
    } catch (e) {
      text.textContent = "安装失败:" + String(e.message || e).slice(0, 60);
      badge.className = "badge red";
    }
    btn.disabled = false;
    rlBusy = false;
    setTimeout(refreshRecogLocal, 800);
  };
}

function collectSettings() {
  return {
    language: $("language").value,
    floatButton: $("float-button").checked,
    recogEngine: $("recog-engine").value,
    smartPolish: $("smart-polish").checked,
    punctStyle: document.querySelector("input[name='punct']:checked").value,
    punctEngine: document.querySelector("input[name='pengine']:checked").value,
    outputScript: document.querySelector("input[name='script']:checked").value,
  };
}

$("save").addEventListener("click", async () => {
  const btn = $("save");
  const label = $("save-label");
  btn.disabled = true;
  label.textContent = "保存中…";
  await chrome.storage.local.set(collectSettings());
  label.textContent = "✓ 已保存";
  toast("设置已保存");
  setTimeout(() => {
    label.textContent = "保存设置";
    btn.disabled = false;
  }, 1400);
});

$("clear-history").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  if (b.dataset.armed !== "1") {
    b.dataset.armed = "1";
    b.textContent = "确认清空";
    b.dataset.timer = String(
      setTimeout(() => {
        b.dataset.armed = "";
        b.textContent = "清空历史";
      }, 3000)
    );
    return;
  }
  clearTimeout(+b.dataset.timer);
  b.dataset.armed = "";
  b.textContent = "清空历史";
  await chrome.storage.local.set({ history: [] });
  toast("历史记录已清空");
});

$("export-settings").addEventListener("click", async () => {
  const KEYS = [
    "language",
      "recogEngine",
    "smartPolish",
    "floatButton",
    "punctStyle",
    "punctEngine",
    "outputScript",
    "dictionary",
  ];
  const data = await chrome.storage.local.get(KEYS);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "crostivoice-settings.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("设置已导出");
});

$("import-settings").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const KEYS = [
      "language",
      "recogEngine",
      "smartPolish",
      "floatButton",
      "punctStyle",
      "punctEngine",
      "outputScript",
      "dictionary",
    ];
    const picked = {};
    let count = 0;
    for (const k of KEYS) if (k in data) (picked[k] = data[k]), count++;
    if (!count) throw new Error("文件中没有可识别的设置");
    await chrome.storage.local.set(picked);
    await load();
    renderDictList(picked.dictionary || []);
    toast(`已导入 ${count} 项设置`);
  } catch (err) {
    toast("导入失败:" + (err.message || err), "error");
  }
  e.target.value = "";
});

$("lnk-shortcuts").addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

load();
// second pass: engine load from cache (triggered by MODEL_CHECK) takes a
// moment — refresh again so badges settle on the final state.
setTimeout(() => {
  refreshModelStatus();
  refreshBuiltinNote();
}, 1200);
setTimeout(() => {
  refreshModelStatus();
  refreshBuiltinNote();
}, 3000);
