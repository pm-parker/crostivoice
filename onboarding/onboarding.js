// CrostiVoice onboarding — grant mic permission once for the extension origin.
// The offscreen document shares this origin, so it can use the mic without prompts.

const result = document.getElementById("result");
const btn = document.getElementById("grant");

btn.addEventListener("click", async () => {
  result.textContent = "";
  result.className = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Immediately release — we only needed the permission grant.
    stream.getTracks().forEach((t) => t.stop());
    await chrome.storage.local.set({ micGranted: true, micGrantedAt: Date.now() });
    result.textContent = "✓ 麦克风已就绪!继续完成下面的快捷键设置。";
    result.className = "ok";
    btn.textContent = "已完成 ✓";
    btn.disabled = true;
  } catch (err) {
    result.textContent =
      err.name === "NotAllowedError"
        ? "你拒绝了这个请求。请再试一次,并在弹窗中选择「允许」。"
        : `无法访问麦克风:${err.message}`;
    result.className = "err";
  }
});

// ---------- 快捷键绑定检测 ----------
// unpacked 安装不会自动应用 manifest 的建议键(实测:全新加载后
// toggle-voice 为空,Alt+A 无效,用户以为"唤不起语音")。onboarding
// 主动检测并引导设置;已绑定则直接确认。
const shortcutStatus = document.getElementById("shortcut-status");
const openBtn = document.getElementById("open-shortcuts");

async function checkShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    const toggle = cmds.find((c) => c.name === "toggle-voice");
    if (toggle && toggle.shortcut) {
      shortcutStatus.innerHTML = `✓ 快捷键已绑定:<b><kbd>${toggle.shortcut}</kbd></b> — 随时可用`;
      openBtn.hidden = true;
      document.getElementById("shortcut-tip").hidden = true;
    } else {
      shortcutStatus.innerHTML =
        '⚠ 尚未绑定快捷键(开发者模式安装不会自动应用建议键)。<b>点击下方按钮设为 Alt+A</b>,选「全局」后任意界面都能唤起。';
      openBtn.hidden = false;
    }
  } catch {
    shortcutStatus.textContent = "无法检测快捷键状态,请到 chrome://extensions/shortcuts 手动确认。";
  }
}
checkShortcut();
// 每次回到此页重新检测(用户可能从设置页返回)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkShortcut();
});

openBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
