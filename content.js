// CrostiVoice — content script: focus tracking, text insertion, floating UI.
// UI lives in a shadow root so page styles can't leak in.

(() => {
  if (window.__crostivoiceLoaded) return;
  window.__crostivoiceLoaded = true;

  // ---------- 孤儿脚本防护 ----------
  // 扩展被移除/重装后,已打开页面里的旧内容脚本不会随之消失——它的
  // chrome.runtime 指向已失效的扩展,任何调用都静默失败(实测:移除重装
  // 后点浮标毫无反应,用户无从得知要刷新页面)。这里把失败变成可见提示。
  function showStaleHint() {
    if (document.getElementById("crostivoice-stale")) return;
    const t = document.createElement("div");
    t.id = "crostivoice-stale";
    t.style.cssText =
      "position:fixed;left:50%;bottom:64px;transform:translateX(-50%);" +
      "background:#1f2937;color:#fff;padding:10px 18px;border-radius:10px;" +
      "font:13px/1.6 system-ui,sans-serif;z-index:2147483647;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35)";
    t.textContent = "CrostiVoice 已更新:请刷新本页面(F5)后继续使用语音输入";
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  function sendToExtension(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === "function") {
        p.catch((e) => {
          if (String(e?.message || e).includes("invalidated")) showStaleHint();
        });
      }
    } catch (e) {
      if (String(e?.message || e).includes("invalidated")) showStaleHint();
    }
  }
  window.__crostivoiceSend = sendToExtension;

  // ---------- focus tracking ----------

  let focusedEditable = null;

  // 页面上下文词袋:标题(权重2)+ 焦点输入框已有文字(权重3),
  // CJK 连续段 2-8 字 / 拉丁词元 2-20 位,取加权 top 20。
  function contextTerms() {
    const bag = new Map();
    const add = (text, weight) => {
      if (!text) return;
      const t = String(text).slice(0, 3000);
      for (const m of t.matchAll(/[\u4e00-\u9fff]{2,8}|[A-Za-z][A-Za-z0-9_-]{1,19}/g)) {
        const term = m[0];
        bag.set(term, (bag.get(term) || 0) + weight);
      }
    };
    try {
      add(document.title, 2);
      const el = focusedEditable || document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) add(el.value, 3);
      else if (el && el.isContentEditable) add(el.textContent, 3);
    } catch {
      /* 上下文是增益,不是依赖 */
    }
    return [...bag.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term]) => term);
  }

  function isEditable(el) {
    if (!el) return false;
    if (el instanceof HTMLInputElement) return !["checkbox", "radio", "file", "button", "submit", "reset", "hidden", "image"].includes(el.type);
    if (el instanceof HTMLTextAreaElement) return true;
    if (el.isContentEditable) return true;
    const host = el.closest?.("[contenteditable='true']");
    return !!host;
  }

  document.addEventListener(
    "focusin",
    () => {
      if (isEditable(document.activeElement)) focusedEditable = document.activeElement;
    },
    true
  );
  // ---------- text insertion (React/Angular-safe) ----------

  function fireInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function insertAtCursor(el, text) {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
      fireInput(el);
    } else {
      // contenteditable — execCommand keeps the page's undo stack (Google Docs etc.)
      const sel = document.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
      }
      if (!document.execCommand("insertText", false, text)) {
        // fallback for pages that block execCommand
        document.execCommand("insertText", false, text);
      }
    }
  }

  // ---------- floating UI (shadow DOM) ----------

  const host = document.createElement("div");
  host.id = "crostivoice-host";
  host.style.cssText = "position:fixed;z-index:2147483647;inset:auto 0 24px 0;display:flex;justify-content:center;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host, *:not(style) { all: initial; }
    style { display: none !important; }
    .pill, .hint {
      pointer-events: auto;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .pill {
      display: flex; align-items: center; gap: 10px;
      max-width: min(560px, 86vw);
      background: #1d2939; color: #ffffff; border-radius: 999px;
      border: 1px solid rgba(255,255,255,.22);
      padding: 10px 18px; font-size: 14px; line-height: 1.45;
      box-shadow: 0 8px 28px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.35);
      animation: rise .16s ease-out;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5252; flex: none; animation: pulse 1.1s infinite; }
    .txt { color: #ffffff; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; min-width: 40px; }
    .txt:empty::before { content: "聆听中…"; color: #b8c0cc; }
    @keyframes pulse { 50% { opacity: .35; } }
    @keyframes spin { to { transform: rotate(1turn); } }
    @keyframes rise { from { transform: translateY(8px); opacity: 0; } }
    .hint {
      background: #7a2b0e; color: #ffffff; border: 1px solid rgba(255,255,255,.2); border-radius: 10px;
      padding: 10px 16px; font-size: 13px; animation: rise .16s ease-out;
      pointer-events: auto;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .spin {
      width: 14px; height: 14px; flex: none; border-radius: 50%;
      border: 2px solid #475467; border-top-color: #fff; animation: spin .8s linear infinite;
    }
  `;
  shadow.appendChild(style);

  const surface = document.createElement("div");
  shadow.appendChild(surface);

  function mount(node) {
    surface.replaceChildren(node);
    if (!host.isConnected) document.documentElement.appendChild(host);
  }
  function unmount() {
    surface.replaceChildren();
    host.remove();
  }

  let hideTimer = null;
  function showHint(message) {
    clearTimeout(hideTimer);
    const el = document.createElement("div");
    el.className = "hint";
    el.textContent = message;
    mount(el);
    hideTimer = setTimeout(unmount, 4200);
  }

  function showListening() {
    clearTimeout(hideTimer);
    const el = document.createElement("div");
    el.className = "pill";
    const dot = document.createElement("span");
    dot.className = "dot";
    const txt = document.createElement("span");
    txt.className = "txt";
    el.append(dot, txt);
    el._txt = txt;
    mount(el);
  }
  function updateLiveText(text) {
    const txt = surface.querySelector(".txt");
    if (txt) txt.textContent = text;
  }
  function showProcessing() {
    clearTimeout(hideTimer);
    const el = document.createElement("div");
    el.className = "pill";
    const spin = document.createElement("span");
    spin.className = "spin";
    const label = document.createElement("span");
    label.textContent = "处理中…";
    el.append(spin, label);
    mount(el);
  }

  // ---------- floating mic button (shortcut-independent fallback) ----------

  const fabHost = document.createElement("div");
  fabHost.id = "crostivoice-fab";
  fabHost.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;";
  const fabShadow = fabHost.attachShadow({ mode: "closed" });

  const fabStyle = document.createElement("style");
  fabStyle.textContent = `
    *:not(style) { all: initial; }
    style { display: none !important; }
    button {
      width: 46px; height: 46px; border-radius: 50%;
      border: none; cursor: pointer;
      background: #175cd3; color: #fff;
      font-size: 20px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 14px rgba(23,92,211,.45);
      opacity: .55; transition: opacity .15s, transform .15s, background .15s;
    }
    button:hover { opacity: 1; transform: scale(1.06); }
    button.listening { background: #e5484d; opacity: 1; animation: pulse 1.1s infinite; }
    button.processing { background: #7a5af8; opacity: 1; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 8px rgba(229,72,77,.18); } }
  `;
  fabShadow.appendChild(fabStyle);

  const fabBtn = document.createElement("button");
  fabBtn.title = "CrostiVoice:点一下开始说话,停顿自动上屏,再点结束";
  fabBtn.textContent = "🎙";
  fabShadow.appendChild(fabBtn);

  // 点按切换(与键盘行为一致;配合静音自动结束,无长按系统冲突)
  fabBtn.addEventListener("click", () => {
    sendToExtension({ type: "POPUP_ACTION", mode: "dictate" });
  });
  fabBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  async function mountFab() {
    const { floatButton = true } = await chrome.storage.local.get("floatButton");
    if (floatButton && !fabHost.isConnected && document.body) {
      document.body.appendChild(fabHost);
    } else if (!floatButton) {
      fabHost.remove();
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "floatButton" in changes) mountFab();
  });
  mountFab();

  function setFabState(state) {
    fabBtn.classList.toggle("listening", state === "listening");
    fabBtn.classList.toggle("processing", state === "processing");
  }

  // ---------- keyboard trigger: tap Search+A to toggle ----------

  document.addEventListener(
    "keydown",
    (e) => {
      // tap Search+A (Search key = Meta in web pages): no hold needed —
      // holding Search triggers the ChromeOS Assistant and steals focus.
      if (e.code === "KeyA" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (e.repeat) return;
        sendToExtension({ type: "POPUP_ACTION", mode: "dictate" });
      }
    },
    true
  );

  // ---------- message handling ----------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case "GET_CONTEXT": {
        sendResponse({
          ok: true,
          canInsert: isEditable(document.activeElement) || !!focusedEditable,
          // No host_permissions by design: the page's own URL is the only
          // reliable source (tabs.Tab.url is redacted without them).
          url: location.href,
          // 页面上下文词袋(搜索引擎"会话消歧"的本地版):标题 + 焦点输入框
          // 已有文字中的多字词,喂给识别器偏置与候选融合。只在本机使用,
          // 不上传。CJK 取 2-8 字连续段,拉丁取 2-20 位词元。
          context: contextTerms(),
        });
        break;
      }
      case "VOICE_STATE": {
        if (message.state === "listening") showListening();
        else if (message.state === "processing") showProcessing();
        else unmount();
        setFabState(message.state);
        break;
      }
      case "ASR_TEXT": {
        if (message.isFinal) showListening();
        updateLiveText(message.text);
        break;
      }
      case "INSERT_TEXT": {
        // focusedEditable may reference a node the page has since re-rendered
        // away (SPA route change, virtual-DOM swap). Writing into a detached
        // node updates nothing on screen and fails silently, so verify the
        // node is still in the document and fall back to live focus otherwise.
        let el = focusedEditable;
        if (el && !el.isConnected) el = null;
        if (!el) el = document.activeElement;
        if (isEditable(el)) {
          // 组织规则会按句插入分段符;单行输入框(搜索框等)不支持换行,
          // 多余的 \n 会被当成空格或直接吞掉,统一压成一个空格。
          const text =
            el instanceof HTMLTextAreaElement || el.isContentEditable
              ? message.text
              : message.text.replace(/\n+/g, " ").trim();
          insertAtCursor(el, text);
        } else {
          // No focused input — don't lose the user's speech. clipboard.writeText
          // can HANG forever in a content script without clipboardWrite (no
          // rejection, no resolution), so race it: feedback must not depend on
          // the clipboard settling. History (written by the service worker) is
          // the honest fallback message.
          const t = message.text;
          Promise.race([
            navigator.clipboard.writeText(t).then(() => "copied"),
            new Promise((r) => setTimeout(() => r("no-clipboard"), 1200)),
          ])
            .then((outcome) => {
              if (outcome === "copied") showHint("焦点不在输入框,文字已复制到剪贴板 📋");
              else showHint("焦点不在输入框,文字已存入历史记录");
            })
            .catch(() => showHint("焦点不在输入框,文字已存入历史记录"));
        }
        break;
      }
      case "VOICE_HINT": {
        showHint(message.message);
        break;
      }
    }
    sendResponse?.({ ok: true });
    return false;
  });
})();
