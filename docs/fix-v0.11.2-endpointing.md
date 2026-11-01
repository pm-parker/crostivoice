# 听写中断与文字丢失:诊断与修复(v0.11.2)

> 2026-11-01。两个用户可见故障的完整根因链、修复设计与验证记录。

## 故障一:唤起后突然自己终止

**根因**:`offscreen.js` 用一个 1.6s 的 `SILENCE_MS` 计时器同时回答两个不同的问题——
"用户还没开口,等多久放弃"和"用户说完一句,隔多久断句上屏"。计时器在
`recognition.start()` 的瞬间就开跑,且只在 `onresult` 里重置;Chrome 中文识别的
首个 interim 结果通常要 1~3 秒才到。实测(真实 Chrome + 真实麦克风,事件探针):

```
t=213ms  start          t=1011ms soundstart/speechstart
t=409ms  audiostart     t=1788ms 起才陆续出 result
```

所以"按下快捷键 → 想 1.6 秒 → 开口"的用户,话音未落会话已被 `stop()`。

## 故障二:明明检测到了文字,最后没有回填

三跳链路,每一跳都丢字:

1. `stop()` 只读 `segments`(已 isFinal 的段落);最后一句还在 interim 时被掐,
   `segments` 为空 → `ASR_FINAL(text="")`。用户在浮层里明明看到了 interim。
2. `finishWithText("")`:`if (finalText && tab)` 直接短路 → 静默回 idle,无提示。
3. 焦点丢失时:content script 的 `navigator.clipboard.writeText` 在无
   `clipboardWrite` 权限的 content script 里**无限挂起**(实测:既不 resolve 也不
   reject)→ `.then`/`.catch` 都不执行 → 复制和提示都没有,文字彻底消失。
   另:`focusedEditable` 缓存的节点被 SPA 重渲染移除后,`isEditable()` 仍为 true,
   值写进孤儿节点,页面无任何变化(实测确认)。

## 修复设计

### 时钟:两个问题,两套时钟(Android endpointer 同款拆分)

| 时钟 | 语义 | 值 |
|---|---|---|
| `WAIT_FIRST_MS` | 尚无任何转写结果(用户在想措辞/首结果在路上) | 9s,VAD 事件(soundstart/speechstart)续期 |
| `GAP_MS` | 已有转写,最后一个 result 之后静默 → 断句上屏 | 1.6s(产品既有的"停顿自动断句") |
| `MAX_MS` | 绝对上限,防麦克风永久挂开 | 120s |

**关键实测约束**:Chrome 在 continuous 模式下**不触发** `soundend`/`speechend`
(探针日志:results 持续流入期间两者一个都没来)。所以任何以"声音还在"为由的
硬门(第一版修复里 `soundActive` 布尔门)都会把会话卡死到 `MAX_MS`——这本身
就是开发中实测抓到并推翻过的设计。结论:**只有 `onresult` 是可靠的活跃信号**,
VAD 事件只能用来延长等待首结果的窗口。

### 收尾:单一、幂等、冻结优先

所有结束路径(gap 超时/快捷键/VAD 空窗/硬上限)汇入同一个 `stop()`:

1. `finalizing || finalReported` 双守卫,每会话恰一次 `ASR_FINAL`;
2. 先同步冻结(cleanup:解绑 handler、`recognition.stop()`、清时钟)再快照,
   冻结与快照之间无 await,迟到的 final 不可能落进快照之后改写状态;
3. 冻结后把 `lastInterim` 追加进 `raw`——handler 已解绑,不存在重复计入;
4. 空文本走同一条路,由 SW 出提示。

### 不变量(健壮性来源,而非超时数值)

1. 任何一次听写结束:文字非空 → 必上屏,或落剪贴板+提示,或至少进历史;
2. 文字为空 → 必有可见提示("没有听到内容"),不允许静默 idle;
3. `stop()` 幂等,重入直接返回;
4. 插入前校验 `el.isConnected`,孤儿节点回退到 `activeElement`,再不行走剪贴板。

### 权限

`manifest.json` 增加 `clipboardWrite`:仅用于焦点丢失时把文字复制到剪贴板并提示。
配套在 content.js 里给剪贴板调用加 1.2s 超时竞争——反馈不能依赖剪贴板是否响应,
超时提示"已存入历史记录"(因为历史无条件落盘,这是实话)。

## 验证

- **确定性 harness**(`/tmp` 临时,18/18):无语音恰一次空 FINAL、重复 STOP 不重报、
  interim 兜底、final+尾部 interim 双保留、候选 alts 透传、VAD 触发但无转写由
  WAIT_FIRST 兜底、会话切换旧文字恰报一次新会话独立收尾。
- **真实浏览器端到端**(真麦克风,环境音被识别为「开始只需要压抑没心情。」):
  VAD 1.0s 触发 → results 1.8~3.3s 持续 → 最后一个 result 后 1.6s 自动收尾 →
  **interim 兜底生效**(全程无 isFinal)→ 文字落入 Bing 搜索框 + 历史。
- **边界**:孤儿节点不写入;死标签页时历史 3→4;焦点丢失时 hint 1s 内出现
  (加权限前:无限挂起,零反馈);正常聚焦插入回归通过。

## 权限架构修正(beta.2,2026-11-02)

扩展页曾报 `Optional permission 'https://*.hf.co/*' is redundant with the required
permissions`。排查结论:HF 可选权限从 v0.10.0 起就是死代码——`host_permissions:
["http://*/*","https://*/*"]` 与 content_scripts 全站注入都覆盖它,Chrome 在加载时
直接丢弃(the "will be omitted" warning),运行时授权门从未执行过 request 分支。

实测钉死的三条权限语义(为后人留档):

1. `content_scripts.matches` 授予**跨域 fetch**能力(扩展上下文):删除
   host_permissions 后,SW 对 `huggingface.co/.../resolve/main/model.int8.onnx`
   的 fetch 沿 302 链一路到 `us.aws.cdn.hf.co` 仍然 200(HF 端点 CORS 开放)。
2. `content_scripts.matches` **不授予** `tabs` API 的 URL 可见性:无 host_permissions
   时 `tabs.query()` 的 `tab.url` 全部为 undefined——听写历史的 host 字段因此改为
   content script 在 `GET_CONTEXT` 里上报 `location.href`。
3. `permissions.contains()` 不把 content_scripts matches 计入已授权集合。

处置:删除 `optional_host_permissions` 与 `ensureModelPermission` 授权门,模型下载
直连。若未来 HF 收紧 CORS 导致下载失败,恢复路径是:manifest 加回
`optional_host_permissions`(仅 HF 四域)并恢复授权门——那时它们不再与
host_permissions 冗余(已删),警告不会复现。

## 内置 AI 调用合规(beta.3,2026-11-02)

扩展页报 `No output language was specified in a LanguageModel API request...`
(来源:options 页的裸 `LanguageModel.availability()`,以及开启深度整理后
maybePolish 的裸 `create()`)。

对照实验(在带 LanguageModel 的 Chrome 里)钉死三条:

1. 裸调用 → 精确复现该警告;
2. 声明 `en` 调用 → 无语言警告,路径干净;
3. **声明 `zh` → API 直接拒绝**("Unsupported LanguageModel API languages
   were specified, and the request was aborted")——中文无法走声明路径,
   跳过不是选择而是强制。

处置:

- 三处调用(options 探测、availability、create)统一携带
  `expectedInputs/expectedOutputs` 声明,且两处选项严格一致(官方要求);
- 白名单语言(en/ja/es/de/fr,与 Chrome 149 的 attest 列表同步,常量
  `LM_SUPPORTED_OUTPUT`)使用英文系统提示词——中文提示词自身语言即 zh,
  无法被诚实声明,故中文路径保留常量、暂不可达;
- 中文/韩文等未 attest 语言:零 API 调用,设置页静态说明 + 每浏览器会话
  一次的听写提示(复用 pendingPolishHint 机制),本地标点/纠错不受影响;
- Chrome 白名单加入 zh 后:更新 `LM_SUPPORTED_OUTPUT`(background.js 与
  options.js 两处)并恢复中文系统提示词路径即可。

## wasm 预缓存告警修复(v0.11.3,2026-11-02)

扩展页报 `Failed to cache ort-wasm-simd-threaded.asyncify.wasm: TypeError:
Failed to execute 'put' on 'Cache': Request scheme 'chrome-extension' is
unsupported`(来源:offscreen.html,堆栈指向 vendor/transformers.web.min.js)。

机制:csc-engine 把 transformers.js 的 `env.backends.onnx.wasm.wasmPaths` 指向
扩展自带文件(chrome-extension:// 协议)。transformers.js v4.3.2 的 wasm 预加载
器(`KM→sk`)会尝试把 wasm 存入 Cache API,但 Cache API 规范只接受 http(s)
请求——`cache.put()` 必然抛 TypeError。加载本身不受影响(fetch 成功),纯告警。

复现方法(在可读控制台的 options 页):`import(csc-engine.js)` 后用
transformers 加载任意小模型触发 InferenceSession 创建 → 警告逐字复现。

处置:`env.useWasmCache = false`(csc-engine.js)——跳过预加载路径,wasm 由
ORT 直接从扩展 URL 加载;本地文件无需缓存。实测同步骤复现零告警、模型加载
与会话创建正常。模型文件(http/https)的缓存不受影响(`useBrowserCache`
保持默认,且纠错模型用的是自管的 crostivoice-csc-v1 缓存)。

## 未做(明确的非目标)

- 逐句提交、会话保活(Gboard/Apple 听写模型):会牺牲神经标点的跨句上下文,
  并在 React 页面反复触发 input 事件。留给真机验证后的 v2 决策。
- `SpeechRecognitionPhrase` 热词、`start(track)` + 自建 VAD:规范已支持,属
  架构升级,见 Web Speech API 2026-10 草案。
