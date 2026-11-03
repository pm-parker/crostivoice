// CrostiVoice onboarding — 授权麦克风 + 快捷键检测 + 使用指引。
// offscreen 文档与本页同源,授权一次即全局生效。

const result = document.getElementById("result");
const btn = document.getElementById("grant");
const stepMic = document.getElementById("step-mic");
const stepKey = document.getElementById("step-key");

function markStepDone(step, label) {
  if (!step) return;
  step.classList.add("done");
  const state = step.querySelector(".state");
  if (state) state.hidden = false;
  if (label) step.querySelector("h2 .state") && (step.querySelector("h2 .state").textContent = label);
}

btn.addEventListener("click", async () => {
  result.textContent = "";
  result.className = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Immediately release — we only needed the permission grant.
    stream.getTracks().forEach((t) => t.stop());
    await chrome.storage.local.set({ micGranted: true, micGrantedAt: Date.now() });
    result.textContent = "✓ 麦克风已就绪";
    result.className = "ok";
    btn.textContent = "已完成 ✓";
    btn.disabled = true;
    markStepDone(stepMic);
  } catch (err) {
    result.textContent =
      err.name === "NotAllowedError"
        ? "你拒绝了这个请求。请再试一次,并在弹窗中选择「允许」。"
        : `无法访问麦克风:${err.message}`;
    result.className = "err";
  }
});

// ---------- 快捷键绑定检测 ----------
// unpacked 安装不会自动应用建议键(实测:全新加载后 toggle-voice 为空),
// 这里主动检测并引导设置;已绑定则直接点亮步骤完成态。
const shortcutStatus = document.getElementById("shortcut-status");
const openBtn = document.getElementById("open-shortcuts");
const shortcutTip = document.getElementById("shortcut-tip");

async function checkShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    const toggle = cmds.find((c) => c.name === "toggle-voice");
    if (toggle && toggle.shortcut) {
      shortcutStatus.innerHTML = `✓ 已绑定 <kbd>${toggle.shortcut}</kbd> — 随时可用`;
      openBtn.hidden = true;
      shortcutTip.hidden = true;
      markStepDone(stepKey);
    } else {
      shortcutStatus.innerHTML =
        '尚未绑定(开发者模式安装不会自动应用建议键)。<b>点击下方按钮设为 Alt+A</b>,选「全局」后任意界面都能唤起。';
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
