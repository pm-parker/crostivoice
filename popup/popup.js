// CrostiVoice popup

const $ = (id) => document.getElementById(id);

async function refresh() {
  const { state, settings } = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  const status = $("status");
  const btnD = $("btn-dictate");
  if (state === "dictating") {
    status.innerHTML = "状态:<b>听写中</b> — 再按一次结束并填入";
    btnD.textContent = "⏹ 立即结束";
  } else if (state === "processing") {
    status.innerHTML = "状态:<b>处理中…</b>";
    btnD.disabled = true;
  } else {
    status.textContent = `就绪 · 语言 ${settings.language}`;
    btnD.disabled = false;
  }

  // built-in AI readiness (download progress from the background warm-up)
  const { aiDownload } = await chrome.storage.session.get("aiDownload");
  if (aiDownload === "downloading" || aiDownload === "starting") {
    status.textContent += " · AI 模型下载中…";
  } else if (aiDownload === "ready") {
    status.textContent += " · ✨AI 就绪";
  }

  // Warn when the shortcut is not bound — this is the #1 "no response" cause.
  const cmds = await chrome.commands.getAll();
  const unbound = cmds.filter((c) => c.name === "toggle-voice" && !c.shortcut);
  const warn = $("key-warn");
  warn.hidden = unbound.length === 0;
  if (unbound.length) {
    $("key-warn-text").textContent = "提示:主交互「按住 Search+A 说话」不需要绑定。点按模式(Alt+A)未绑定,如需请到快捷键页设置。";
  }

  const { micGranted } = await chrome.storage.local.get("micGranted");
  $("mic-warn").hidden = !!micGranted;

  const { history = [] } = await chrome.storage.local.get("history");
  const ul = $("hist");
  ul.replaceChildren();
  if (!history.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "还没有记录。点右下角麦克风或按 Search+A 试试!";
    ul.appendChild(li);
  } else {
    for (const h of history.slice(0, 8)) {
      const li = document.createElement("li");
      const t = document.createElement("div");
      t.className = "t";
      t.textContent = h.text;
      const m = document.createElement("div");
      m.className = "m";
      m.textContent = `${h.mode === "ask" ? "指令" : "听写"} · ${h.host || ""} · ${new Date(h.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
      li.append(t, m);
      ul.appendChild(li);
    }
  }
}

$("btn-dictate").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "POPUP_ACTION", mode: "dictate" });
  refresh();
});
$("grant-mic").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("../onboarding/onboarding.html") });
  window.close();
});
$("open-options").addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.runtime.openOptionsPage();
});
$("open-shortcuts").addEventListener("click", async (e) => {
  e.preventDefault();
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
$("open-shortcuts2").addEventListener("click", async () => {
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
refresh();
