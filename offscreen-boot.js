// CrostiVoice — offscreen 启动引导(外置文件:内联脚本会被 MV3 CSP 拒执行)。
//
// 职责:
// 1. 消息缓冲——重模块图(transformers.js + ORT,456KB+)冷加载可达数秒,
//    先注册轻量监听器把消息入队,offscreen.js 加载完成后经 self.__cvSetListener
//    挂载真处理器并回放队列。消息零丢失,首次唤起不竞态。
// 2. 启动自检——offscreen 文档没有可见控制台,模块加载失败(语法错误/
//    import 404/顶层异常)完全静默;失败显式上报 SW 落盘(OFFSCREEN_BOOT_FAIL)。

let realListener = null;
const queue = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (realListener) return realListener(message, sender, sendResponse);
  queue.push([message, sender, sendResponse]);
  return true; // 模块加载期间保持消息通道打开
});

self.__cvSetListener = (fn) => {
  realListener = fn;
  const pending = queue.splice(0);
  for (const [m, s, sr] of pending) {
    try {
      fn(m, s, sr);
    } catch (err) {
      console.warn("[cv] 回放缓存消息失败:", err);
    }
  }
};

try {
  await import("./offscreen.js");
} catch (e) {
  try {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_BOOT_FAIL",
      error: String(e?.stack || e).slice(0, 800),
    });
  } catch {
    /* 上报通道也挂了就无能为力 */
  }
}
