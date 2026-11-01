# CrostiVoice 🎙

<a name="zh-cn"></a>

**ChromeOS 语音输入扩展** — 点一下快捷键说话,智能断句、同音字纠错,文字自动上屏。

![Release](https://img.shields.io/github/v/release/pm-parker/crostivoice) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-ChromeOS%20%7C%20Chrome%20116%2B-blue) ![Manifest](https://img.shields.io/badge/Manifest-V3-orange)

[官网(中文)](https://pmparker.net/crostivoice/) · [Website (EN)](https://pmparker.net/crostivoice/en/) · [为什么不用云端方案?](https://pmparker.net/crostivoice/vs/) · [开发手记](https://pmparker.net/blog/crostivoice-voice-typing.html) · [English](#english)

<img src="screenshots/02-listening.jpg" alt="CrostiVoice 实时听写:邮件正文自动断句上屏,右下角浮动麦克风" width="100%">

---

## 为什么做这个

ChromeOS 上打中文依赖系统拼音,长句输入慢、纠错繁琐。CrostiVoice 把「说话」变成第一输入方式:点一下 `Search+A`,说完停顿,整理好的文字直接出现在光标里。

核心能力**全部本地运行**:

- **神经标点断句** — 内置 CT-Transformer 模型(74MB,可选下载),毫秒级,标点位置由语义决定
- **同音字纠错** — 内置 macbert4csc 模型(101MB,可选下载),「一至→一致」「害帕→害怕」自动纠正
- **热词词典** — 人名、术语、品牌名的专属纠错表,JSON 导入导出
- **中英混排** — 自动加空格、英文句首大写;支持简中/繁中/英/日/韩
- **规则引擎兜底** — 不下载模型也能用,所有层级自动降级,输入永不中断

不收集任何数据,无账号,无遥测。([隐私政策](https://pmparker.net/crostivoice/privacy/) · [PRIVACY.md](PRIVACY.md))

## 工作原理:三层文本管线

语音识别只是原料。你说出的话经过三层处理,按成本从低到高叠放,任何一层不可用自动降级到下一层:

```
识别结果(无标点长串)
   │
   ▼
① 规则引擎 ── 永远在线:连接词切分、语气词断句、口述标点、中英混排空格
   │
   ▼
② 本地神经模型 ── 可选下载:语义标点断句 + 同音字纠错,离线推理
   │
   ▼
③ Chrome 内置 AI ── 可选开启:深度口语整理,需 Chromebook Plus(Gemini Nano)
   │
   ▼
标点完整、无口癖的书面文字 → 光标处
```

## 安装

### 方式一:下载 Release(推荐)

1. 从 [Releases](https://github.com/pm-parker/crostivoice/releases) 下载 `CrostiVoice_vX.X.X.zip` 并解压
2. Chrome 打开 `chrome://extensions`,开启右上角「开发者模式」
3. 「加载已解压的扩展程序」→ 选择解压出的文件夹
4. 引导页弹出后点击「授权麦克风」(只需一次)

> 装完即可用(规则引擎兜底);想要语义级断句与纠错,再到设置页下载两个模型(74MB + 101MB,仅一次,之后完全离线)。

### 方式二:从源码

```bash
git clone https://github.com/pm-parker/crostivoice.git
# Chrome → chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择仓库目录
```

## 使用

| 操作 | 效果 |
|---|---|
| **点一下** `Search+A` | 开始说话,浮层实时显示识别文字 |
| **说完停顿 ~1.5 秒** | 自动断句加标点,填入光标所在输入框 |
| **说完立刻再点一下** | 不等停顿,立即上屏 |
| 右下角 🎙 浮动按钮 | 同样点一下开始(不依赖快捷键) |

> ⚠️ ChromeOS 注意:**不要长按**搜索键(会触发系统 Assistant)。支持**点按**。
>
> 快捷键可在 `chrome://extensions/shortcuts` 修改;也提供 `Alt+A` 点按模式。

### 进阶

- **热词词典**:设置 → 我的词典,添加 `错词 -> 正确写法`,识别自动纠正
- **标点风格**:中文 `,。?` / 英文 `, . ?`(写代码注释友好)
- **简繁输出** / **深度整理**(需 Chromebook Plus 的内置 AI,可选)
- **数据迁移**:设置 → 数据,配置与词典导出为 JSON,换设备一次带入

## 为什么不用系统输入法 / 云端方案?

| 维度 | CrostiVoice | 系统语音输入 | 云端听写 |
|---|---|---|---|
| 音频去向 | **不接触音频**(识别走 Chrome 内置服务) | Google 语音服务 | **全程上传**厂商服务器 |
| 中文断句 | **语义级**,神经模型 | 基本无标点 | 尚可,依赖厂商 |
| 断网可用 | **是**(模型离线) | 否 | 否 |
| 费用/账号 | **免费,无账号** | 免费,绑 Google 账号 | 订阅解锁,须登录 |

完整 11 项对比(含同音字纠错、热词、简繁、延迟、源码审计)见 **[对比页 →](https://pmparker.net/crostivoice/vs/)**

## 常见问题

**我的语音会上传到你的服务器吗?**
不会——CrostiVoice 根本没有服务器。识别由 Chrome 内置语音服务完成,扩展不接触原始音频;断句与纠错模型在本机推理;历史与词典只存本地。[源码公开](https://github.com/pm-parker/crostivoice),可审计。

**必须下载 175MB 的 AI 模型才能用吗?**
不必须。装完即可用(规则引擎);模型是可选升级,下载一次后完全离线,可随时删除。

**为什么是「点一下」而不是「按住说话」?**
ChromeOS 把「长按搜索键」保留给系统 Assistant,扩展拿不到这个事件。实测点按反而更顺手:边想边说,停顿即上屏。

更多问题见 **[官网 FAQ →](https://pmparker.net/crostivoice/#faq)**

## 隐私

零遥测 · 零上传 · 零账号。语音识别由 Chrome 浏览器内置服务完成;文字整理由本机模型离线推理;历史(最近 50 条)与词典仅存本机,可随时清空或导出。详见 [隐私政策](https://pmparker.net/crostivoice/privacy/)。

## 系统要求

- ChromeOS / Chrome 116+(本地 AI 需要 Chrome 121+)
- 麦克风权限

## 技术栈

Manifest V3 · Web Speech API · ONNX Runtime Web (WASM) · Transformers.js · Shadow DOM

```
manifest.json      MV3 清单
background.js      Service Worker:状态机、快捷键路由、模型管理
offscreen.js       Offscreen 文档:语音识别 + 智能断句管线
punct-engine.js    本地神经标点引擎(CT-Transformer int8)
csc-engine.js      本地语义纠错引擎(macbert4csc int8)
content.js         内容脚本:焦点跟踪、文字注入、Shadow DOM 浮层
options/           设置页(Linear 风格,双主题)
vendor/            ONNX Runtime Web 运行时(模型按需下载)
```

## 文档与链接

| 资源 | 链接 |
|---|---|
| 官网(中文) | https://pmparker.net/crostivoice/ |
| Website (English) | https://pmparker.net/crostivoice/en/ |
| 方案对比 | https://pmparker.net/crostivoice/vs/ |
| 隐私政策 | https://pmparker.net/crostivoice/privacy/ |
| 开发手记(完整踩坑记录) | https://pmparker.net/blog/crostivoice-voice-typing.html |
| 问题反馈 | https://github.com/pm-parker/crostivoice/issues |

## 致谢

- [rime-ice 雾凇拼音](https://github.com/iDvel/rime-ice) 与 [rime-ice-installer](https://github.com/manateelazycat/rime-ice-installer) — 词库与配置理念
- [Talvio](https://github.com/ishangautam7/Talvio) — 产品形态启发
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) / 阿里达摩院 CT-Transformer — 标点模型
- [shibing624/macbert4csc](https://github.com/shibing624/pycorrector) — 纠错模型
- [Transformers.js](https://github.com/huggingface/transformers.js) — 浏览器推理运行时

## License

MIT

---

<a name="english"></a>

# CrostiVoice (English)

**Voice dictation for ChromeOS** — tap a shortcut, speak, and properly punctuated text lands at your cursor.

![Release](https://img.shields.io/github/v/release/pm-parker/crostivoice) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-ChromeOS%20%7C%20Chrome%20116%2B-blue)

[Website](https://pmparker.net/crostivoice/en/) · [中文官网](https://pmparker.net/crostivoice/) · [Why not cloud-based?](https://pmparker.net/crostivoice/vs/) · [Dev notes](https://pmparker.net/blog/crostivoice-voice-typing.html) · [简体中文](#zh-cn)

## Why CrostiVoice

Typing Chinese on ChromeOS means pinyin for everything — slow for long sentences, tedious to correct. CrostiVoice makes **speaking** the primary input method: tap `Search+A`, talk, pause, and clean text lands at your cursor.

Everything runs **on-device**:

- **Neural punctuation** — CT-Transformer model (74MB, optional download), millisecond inference
- **Homophone correction** — macbert4csc (101MB, optional) fixes sound-alike mistakes from context
- **Personal dictionary** — names & jargon, JSON import/export
- **Mixed CN/EN** — auto-spacing, sentence capitalization; zh-Hans/zh-Hant/EN/JA/KO
- **Rule engine fallback** — works with zero downloads, graceful degradation

No telemetry, no accounts, offline-first. ([Privacy policy](https://pmparker.net/crostivoice/privacy/))

<a href="url"><img src="screenshots/02-listening.jpg" alt="CrostiVoice dictation in action" width="100%"></a>

## How it works: a three-layer pipeline

```
raw recognition (one long unpunctuated string)
   ▼
① rule engine ── always on: conjunction splits, spoken punctuation, spacing
   ▼
② on-device models ── optional: semantic punctuation + homophone correction
   ▼
③ Chrome built-in AI ── opt-in: deep cleanup (Chromebook Plus / Gemini Nano)
   ▼
punctuated, written-style Chinese → at your cursor
```

## Install

Download from [Releases](https://github.com/pm-parker/crostivoice/releases), unzip, then `chrome://extensions` → Developer mode → **Load unpacked**. Grant microphone access on the welcome page (once).

> Works out of the box (rule engine). For semantic-level punctuation & correction, download the two models in settings (74MB + 101MB, one-time, fully offline afterwards).

## Use

| Action | Result |
|---|---|
| **Tap** `Search+A` | Start speaking; live transcript in the overlay |
| **Pause ~1.5s** | Text is punctuated and inserted at your cursor |
| **Tap again immediately** | Insert right away, no waiting |
| Floating 🎙 button | Same, no keyboard needed |

> ⚠️ Don't **long-press** the Search key — that's reserved for the system Assistant. Tap, don't hold. Shortcut customizable at `chrome://extensions/shortcuts`; `Alt+A` tap-mode also available.

## Privacy

Zero telemetry · zero uploads · zero accounts. Recognition via Chrome's built-in speech service (the extension never touches raw audio); text processing runs on-device; history (last 50) and dictionary stay local — clear or export anytime. Full policy: [pmparker.net/crostivoice/privacy/](https://pmparker.net/crostivoice/privacy/)

## Requirements

ChromeOS or desktop Chrome 116+ (local AI needs 121+), microphone access.

## Links

| Resource | URL |
|---|---|
| Website (EN) | https://pmparker.net/crostivoice/en/ |
| 中文官网 | https://pmparker.net/crostivoice/ |
| Comparison | https://pmparker.net/crostivoice/vs/ |
| Privacy policy | https://pmparker.net/crostivoice/privacy/ |
| Issues | https://github.com/pm-parker/crostivoice/issues |

## Acknowledgements

- [rime-ice](https://github.com/iDvel/rime-ice) — lexicon & configuration philosophy
- [Talvio](https://github.com/ishangautam7/Talvio) — product inspiration
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) / Alibaba CT-Transformer — punctuation model
- [shibing624/macbert4csc](https://github.com/shibing624/pycorrector) — correction model
- [Transformers.js](https://github.com/huggingface/transformers.js) — in-browser inference

## License

MIT
