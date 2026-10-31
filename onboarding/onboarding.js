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
    result.textContent = "✓ 麦克风已就绪!现在可以关闭此页,点一下 Search+A 开始说话。";
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
