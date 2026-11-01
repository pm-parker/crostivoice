# Chrome Web Store Listing — CrostiVoice 语音输入

> Last Updated: 2026-11-01(发版 v0.11.0)

## Store Listing

**Extension Name** [REQUIRED]

CrostiVoice 语音输入

**Short Description** [REQUIRED]

点一下 Search+A 说话,自动断句加标点填入网页输入框。本地 AI 模型离线纠错,零遥测。

**Detailed Description** [REQUIRED]

CrostiVoice 是一个纯粹的网页语音输入工具,让你在任何网页里用说话代替打字。

在网页里点一下 Search+A 开始说话,屏幕下方实时显示识别文字;说完停顿一下,文字自动断句加标点填入光标所在的输入框——写邮件、填表单、聊微信、写文档都行。再按一下立即结束;右下角的浮动麦克风按钮同样点一下开始。说出的内容会自动断句加标点——由可选下载的本地神经网络模型离线完成(毫秒级,模型仅从 HuggingFace 下载一次并缓存在本机,推理不上传任何数据;设置页可查看状态、下载或删除):逗号、句号、问号、顿号的位置基于语义判断,支持中英混排。也可以切换为轻量规则引擎。口述「逗号」「句号」「问号」「换行」直接变成对应符号;中英混排自动加空格。在支持内置 AI 的设备上,还可以开启本地智能整理,结合多个识别候选重建最合理的句子,把口语自动转成标点正确、无口癖的书面文字。用户可在设置中维护个人词典(人名、术语自动纠正)、选择标点风格与简繁字形,并支持设置导入导出。支持简体中文、繁体中文、英语、日语、韩语。


使用步骤:
1. 安装后打开引导页,点击「授权麦克风」(只需一次)
2. 在任意网页点击一个输入框
3. 按 Search+A 说话,再按 Search+A 结束,文字自动输入
4. 口述「逗号」「句号」「换行」可以直接输入标点

隐私说明:语音识别由 Chrome 浏览器内置的语音服务完成;听写历史只保存在本机。本扩展不收集任何用户数据,无账号、无遥测。

**Category** [REQUIRED]

Productivity(生产力工具)

**Single Purpose** [REQUIRED]

在网页中用语音输入文字,自动断句加标点。

**Primary Language** [REQUIRED]

中文(简体)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready(几何麦克风 v3 渐变设计) | icons/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | screenshots/02-listening.jpg(听写浮层) |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | screenshots/01-settings.jpg(设置页/模型状态) |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | screenshots/03-dictionary.jpg(热词词典) |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

### Screenshot Notes

截图应展示:① 网页文本框旁的实时听写浮层;② Ask 结果卡片与三个操作按钮;③ 弹出窗口中的历史记录。需在浅色和深色主题各截一组。

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| offscreen | permissions | 在后台持续采集语音并实时转写。Chrome 扩展的后台页面无法访问麦克风,必须使用 offscreen 文档承载音频采集,这是语音输入功能的核心。 |
| storage | permissions | 在本机保存用户设置(识别语言)与最近听写历史。不上传任何数据。 |
| clipboardWrite | permissions | 唯一用途:听写结束时若焦点已不在输入框(页面重渲染/误点别处),把识别文字复制到剪贴板并提示用户,避免说的话凭空丢失。扩展从不读取剪贴板。 |
| http://*/* 与 https://*/*(content_scripts.matches) | content scripts | 语音输入的产品本质是在任意网页的输入框里说话替换打字,内容脚本必须注入所有 http/https 页面。仅用于:注入浮动按钮、监听触发快捷键、把识别文字写入当前聚焦的输入框。不读取页面内容,不发网络请求。 |
| http://*/* | host_permissions | 语音输入功能需要向用户访问的任意网页注入输入组件:在光标处插入转写文字、在页面内显示实时听写浮层与麦克风按钮。仅对用户正在使用的标签页生效。 |
| https://*/* | host_permissions | 同上——用户访问的网站大多数为 https,需要注入输入组件与浮层。 |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | 否 | — | — | — |
| Audio / 语音数据 | 不由扩展收集 | 语音经 Chrome 内置语音服务识别(浏览器行为) | 语音转文字 | 无 |
| User activity(听写历史) | 仅本机存储 | 否 | 用户回看 | 无 |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the item's single purpose
- [x] Data is NOT used to credit money transfer tools
- [x] 我声明理解并同意遵守 Chrome Web Store 个人信息数据处理政策

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.11.2 | 2026-11-01 | 可靠性修复(听写中断/文字丢失):① 待机与断句拆分为两套时钟——按下快捷键后 9 秒内没出转写才结束(原 1.6 秒在用户开口前就把会话掐死,是"唤起后突然终止"的根因);② 收尾时把尚未定稿的实时转写一并上屏(原实现只取已定稿段落,是"看到了字却没回填"的根因);③ 每次收尾只上报一次、收尾期间再按快捷键不会重复插入;④ 空结果给出"没有听到内容"提示,不再静默结束;⑤ 历史记录无条件落盘,标签页关闭也不丢字;⑥ 插入前校验焦点元素仍在页面内,SPA 重渲染不再把字写进已移除的节点;⑦ 新增 clipboardWrite 权限:焦点丢失时自动复制到剪贴板(原实现无权限时剪贴板调用会挂起,文字彻底消失);⑧ 权限架构修正(beta.2):删除与 content_scripts 全站注入天然冗余的 optional_host_permissions 与运行时授权门(HuggingFace 模型端点 CORS 开放,实测零授权全链路可达),消除扩展页的 "redundant with required permissions" 警告;听写历史的 host 字段改由内容脚本上报(无主机权限时 tabs API 不返回 URL)。 |
| 0.8.0 | 2026-11-01 | 新增可选的本地语义纠错引擎(macbert4csc int8,101MB):同音字自动纠正(如「一至→一致」「害帕→害怕」),约 0.4 秒/句离线运行;设置页统一管理两个本地模型(状态/进度/下载/删除)。 |
| 0.7.1 | 2026-11-01 | 标点模型改为按需下载(扩展瘦身至 25MB):设置页新增模型状态显示、下载按钮与进度条,下载需明确授权并完全离线使用。 |
| 0.7.0 | 2026-11-01 | 内置本地神经标点引擎(CT-Transformer int8,74MB,离线运行,毫秒级):标点断句质量大幅提升,含中英混排;规则引擎保留为回退选项。 |
| 0.6.0 | 2026-11-01 | 长段智能切分:识别出的无标点长句在「然后/但是/因为」等连接词处自动断句补标点;内置 AI 状态透明化:模型后台预热下载(含进度显示)、不可用/下载中时提示用户而非静默降级。 |
| 0.5.1 | 2026-11-01 | 交互修复:改为点按触发 + 静音自动结束(长按搜索键会触发 ChromeOS Assistant 导致录音反复中断)。 |
| 0.5.0 | 2026-11-01 | 新增热词词典(自动纠错)、标点风格(中文/英文)、输出字形(简/繁)、识别候选融合整理、设置导入导出。 |
| 0.4.0 | 2026-10-31 | 新增智能整理(实验):设备支持时用 Chrome 内置 AI 在本地把口语整理成书面文字(标点分段/修同音字/删口癖),不可用自动降级为规则断句。 |
| 0.3.0 | 2026-10-31 | 移除 AI 指令功能,专注纯语音输入;新增智能断句引擎(自动标点、口述标点指令、中英混排空格)。 |
| 0.2.0 | 2026-10-31 | 交互升级为按住说话(push-to-talk):网页内按住 Search+A 录音、松开自动填入;浮动麦克风改为按住说话;Alt+A 保留为点按兜底模式。 |
| 0.1.3 | 2026-10-31 | 简化为唯一快捷键 Search+A(按下开始/再按结束并直接填入);浮动麦克风单击=听写、双击=AI 指令;修复 Shadow DOM 样式文本泄漏。 |
| 0.1.2 | 2026-10-31 | 修复浮动按钮 CSS 文本显示在页面上的问题。 |
| 0.1.1 | 2026-10-31 | 快捷键改为 ChromeOS 搜索键组合(Search+A);新增网页内浮动麦克风按钮(单击智能触发听写或 AI 指令,不依赖快捷键);设置页可开关浮动按钮。 |
| 0.1.0 | 2026-10-31 | 首个版本:快捷键按住说话语音输入、智能断句标点、网页内浮动麦克风按钮、实时转写浮层、网页内文字插入、语音指令 + AI 处理(内置 AI / OpenAI 兼容 API)、听写历史、麦克风授权引导。 |

## 提交记录

- **2026-11-01**: v0.10.1 已提交 Chrome Web Store 审核(开发者后台)。状态:审核中。审核通过后此表记录上架 URL。

## Publishing Readiness

- [ ] 128×128 图标 ✅
- [x] 3 张 1280×800 截图 ✅
- [x] 隐私政策 URL ✅ https://pmparker.net/crostivoice/privacy/
- [ ] 打包 ZIP 排除 `.git/`、`tools/`、`testpage/`、`CHROMEWEBSTORE.md`
- [ ] 单一用途声明与权限理由复核 ✅
