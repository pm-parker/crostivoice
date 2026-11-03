# Chrome Web Store Listing — CrostiVoice 语音输入

> Last Updated: 2026-11-02(发版 v0.11.3)

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
| 0.18.4 | 2026-11-03 | **Popup(工具栏弹窗)暗色/亮色主题修复**。旧样式大量硬编码颜色只在亮色下正确:暗色下状态说明(#667085)、历史记录时间戳(#98a2b3)、状态 <b>(#175cd3 品牌蓝)、kbd 键帽、footer 文字全部沿用亮色值(暗底深字,对比度不可读);警告框(#fff4ed 米色底)在暗色下突兀刺眼;「设置」链接未配色。重写:设计令牌与设置页同源(两处一致维护),全部颜色走 CSS 变量、@media 暗色成对定义;警告框改 warn/danger 语义令牌;hover 态/标题链接补齐;元素 ID 语义化(warn-mic/warn-key)并同步 popup.js;验证:亮/暗令牌逐项取值断言 + dictating 分支 <b> 颜色 ✓。 |
| 0.18.3 | 2026-11-03 | 识别引擎选择按用户偏好换回下拉框(beta.13 曾改为三选分段控件)。保留全部实质改进:三个净化选项(自动/SenseVoice 本地/Chrome 云端,旧值 local/whisper 读取时归一)、随选中项动态切换的引擎说明。 |
| 0.18.2 | 2026-11-03 | **引导页(onboarding)重写**。旧页五个同权重灰盒堆叠、③步骤一坨混排文字、无完成态反馈。新版:① 与设置页统一的设计语言(同色板/暗色模式/kbd 样式);② 三步骤卡片带序号圆点与**完成态**(授权成功/快捷键绑定后序号变绿✓,状态即时点亮);③ 「开始听写」重构为三行键位表(Search+A / Alt+A / 浮动麦克风各配一句话说明);④ 两个提示盒(更新必读/ChromeOS)降级为底部可折叠脚注,新增「想完全离线?」引导到 SenseVoice;⑤ 页面标题从「麦克风授权」更名「开始使用」(名实相符)。onboarding.js 保留全部检测逻辑(快捷键绑定检测/visibilitychange 复检),新增步骤完成态联动;全部脚本外置(MV3 CSP)。 |
| 0.18.1 | 2026-11-03 | **设置页「语音输入」区重构(减熵)**。① 识别引擎从 5 项下拉改为 3 选项分段控件(互斥选项 ≤5 个应全部可见,参照表单最佳实践):自动 / SenseVoice 本地 / Chrome 云端——砍掉 local(SODA,设备普遍不可用)与 whisper(已被取代)两个死选项,存储旧值读取时自动归一到自动;② 引擎说明随选中项动态切换(此前 5 项下拉配一句静态说明,信息错位);③ 「本地识别语言包」更名「SenseVoice 离线模型」,文案直说核心价值(免翻墙、零上传、自带标点),SODA 探测细节退居内部逻辑;④ 引擎选择独占一行(row-col 布局),与语言/浮钮形成清晰层级。 |
| 0.18.0 | 2026-11-03 | **「自动」引擎改为环境感知(用户定义的语义:云端可达→云端,不可达→本地)**。此前 auto 是死板顺序(SODA 探测失败即固定云端,装了 SenseVoice 也不用)。现在:① 听写前探测谷歌云端可达性(generate_204,no-cors,2.5s 超时,结果缓存 60s)——可达走云端(质量优先),不可达且 SenseVoice 就绪自动落本地并 toast 告知;② 会话中途云端断线(network 错误)时 auto 无缝转本地继续(每会话一次防循环,缓存标记不可达);③ 设置页自动选项文案更新为「自动(云端优先,断网自动转本地)」。隐私注记:自动模式在云端可达时音频仍上传谷歌——需要零上传时显式选「SenseVoice 本地」。 |
| 0.17.9 | 2026-11-03 | **修复「点击下载无效」的真正根因:按钮 onclick 被 SODA 安装处理器覆盖**。设置页 refreshRecogLocal 里,SenseVoice 接管按钮(unavailable 分支)之后 30 行,旧代码无条件把同一按钮的 onclick 重挂为 SODA 安装——SODA 不可用的设备上用户每次点击都在尝试安装谷歌 SODA 包,秒现「安装未完成」然后回落(beta.2 以来所有"点击无效/一闪"反馈的共同根因;此前 zombie/超时等修复均真实但非主因)。修复:SODA 处理器仅在按钮未被 SenseVoice 接管时挂载;refreshRecogLocal 末尾统一按 sv 真实状态收尾徽章(就绪分支此前只改 note 不改徽章,完成瞬间有竞态残留"本地引擎未安装")。新增 ?soda=<status> URL 参数供 E2E 强制模拟探测结果(本机即以真实 .click() 验证:?soda=unavailable → 蓝 1%→100% → 绿「就绪(可离线)」+✅note 全程正确)。 |
| 0.17.8 | 2026-11-03 | 初始状态显示去吓人化 + 版本 Beta 标识。① SODA 探测「此设备/语言不支持」不再作为徽章初始显示(多数设备常态,连续多轮被用户误读为下载失败)——SenseVoice 未就绪时显示中性「本地引擎未安装」,SODA 细节移入说明文字;下载中/就绪/失败仍由实时徽章接管。② 设置页版本 chip 显示 Beta 序号(v0.17.8-beta.10,beta.json 维护,正式版删 label 自动回退),便于真机测试对版本。 |
| 0.17.7 | 2026-11-03 | **状态徽章与反馈修复(用户实测把 SODA 探测徽章误读为下载失败)**。① 徽章现反映有效本地识别能力:SenseVoice 下载中→「SenseVoice 下载中 X%」(蓝),就绪→「SenseVoice 就绪(可离线)」(绿),失败→红;SODA 的「此设备/语言不支持」只作为无 SenseVoice 时的回退显示——此前无论下载成功与否徽章永远显示 SODA 探测结果,用户一律以为失败。② 点击立即反馈:按钮「准备中…」+ note「正在启动下载引擎…」(僵尸文档重建 8s+ 模块冷加载期间此前零反馈)。③ 僵尸重建窗口:安装类消息从半程(45s)提前到 8s。④ SW 启动/安装即预热 offscreen(消除首次操作冷启动,实测点击后 2s 即开始下载)。⑤ 修 MB 单位重复。E2E:徽章全程 [下载中 0%→99%]→[就绪(可离线)],32s 完成 {ok:true,loaded:true}。 |
| 0.17.6 | 2026-11-03 | **SenseVoice 下载可靠性加固(用户 ChromeOS 实测"一点就闪退回不支持")+ 僵尸状态自愈**。① 根因之一:自 v0.15 起 normalizeStaleModelStatus 在 offscreen 里调 chrome.storage——offscreen 文档没有该 API,函数一直是静默死代码;僵尸 downloading 状态(固定扩展 ID 后 storage 跨重装保留)会把设置页按钮永久隐藏/禁用。自愈移至 SW:进度写入盖时间戳,MODEL_STATUS_REQ 时 >90s 无写入的 downloading 按缓存齐/缺自动归位 ready/not-installed。② 安装不再硬卡会话创建:229MB int8 模型的 ORT 会话(需 ~1GB WASM 堆)在低内存设备可能失败——下载完成即算成功(cached 态),会话首次听写时再建,失败自动回落云端,安装路径零 OOM 风险。③ 安装类消息超时 25s→90s(冷启动模块加载+僵尸文档重建最坏 25s,原超时会误杀);错误信息人话映射(端口中断=内存不足/重启提示,连接失败=重启浏览器提示)。④ 下载进度带 MB 数;失败原因持久显示在设置页(此前 toast 一闪即逝,用户只看到"此设备/语言不支持")。⑤ MODEL_CHECK 补 sv/wh 缓存位。E2E:注入僵尸 downloading → 自愈 not-installed/ready ✓;全链路下载 62s MB 级进度 ✓。 |
| 0.17.5 | 2026-11-03 | **SenseVoice 推理管线重写(与 sherpa-onnx 逐项对齐)+ 下载实时进度**。v0.17 首版引擎的输入管线是凭推测写的,真模型签名完全不同(实测:输入名 x/x_length/language/text_norm,特征维 560 而非 80)。本次从模型 ONNX metadata(手工解析 protobuf)提取全部精确参数并按 sherpa-onnx 源码逐行对齐:kaldi fbank 80(hamming/25ms/10ms/preemph0.97/去直流/low20/high=nyquist/snip_edges/功率谱不归一,预计算三角函数表)→ LFR 堆叠(窗7步6,尾部复制)→ CMVN((x+neg_mean)×inv_stddev,560 维常量嵌入)→ language/itn 整型标量(zh=3/with_itn=14)→ CTC 贪心(blank=0)→ 丢弃前导 4 个 prompt 回显 token;tokens.txt 按「token id」逐行解析(旧版按行号猜,全错)。**正确性验证**:sherpa 官方中文测试音频(开放时间…)完整管线输出「开放时间早上9点至下午5点。」——标点与数字正则化全对,与官方一致;推理 3.4s/5.6s 音频(单线程 WASM)。另:设置页新增下载实时进度(modelStatus 变更即时刷新,下载几分钟不再"纹丝不动像没反应");下载按钮显示已下载/总MB、失败可重试、就绪后明确引导选引擎。测试音频(zh/en/ja/ko/yue wav)已上架模型 CDN。 |
| 0.17.4 | 2026-11-03 | **修复 v0.17.3 的真正元凶:offscreen 内联脚本被 MV3 CSP 拒执行**。beta.5 把启动自检+消息缓冲写成 offscreen.html 的内联 script 标签——MV3 扩展页面默认 CSP(script-src 'self')禁止一切内联脚本,被静默拒执行 → 监听器永不注册 → 依然"唤不起语音"(用户实测 SW 控制台报 Could not establish connection)。修复:引导逻辑全部移入外置 offscreen-boot.js;极简对照扩展验证外置脚本后 offscreen 立即正常(同机同浏览器,E2E:MODEL_CHECK 120ms / ASR_START 3ms)。连带:MODEL/CSC/MODEL_STATUS 六处裸 sendMessage 全部改走 sendToOffscreen 重试;快捷键/浮标唤起入口加 try/catch,失败时页面提示"重载扩展后重试"而非静默 uncaught;构建自检新增"扩展 HTML 禁止内联 script"(先剥 HTML 注释再查,注释里的标签字样会误报)。 |
| 0.17.3 | 2026-11-03 | **修复 v0.16 以来"唤不起语音"的总根因 + 三道构建防线**。总根因:build.sh 打包清单硬编码,**whisper-engine.js 与 sensevoice-engine.js 从未进过任何发布包**——offscreen.js import 不存在的文件 → 模块图永远不加载 → 消息监听器不注册 → 所有唤起静默失败(v0.16.0-beta.1~v0.17.2 五个包全坏)。连带修复:① beta.2 正则编辑弄丢 listener 链一个 `}`(offscreen.js:1074 游离 else 语法错误);② WHISPER_INSTALL/DELETE_REQ 路由错放 offscreen.js(与 SENSEVOICE 同病);③ offscreen.html 启动自检——模块加载失败显式上报 SW 落盘(offscreen 无控制台,失败完全静默是坏包连发的帮凶);④ 消息缓冲监听器——重模块(transformers.js+ORT,456KB+)冷加载数秒期间消息先入队、加载完回放,首次唤起不再竞态;⑤ SW→offscreen 发送带重试 + 僵尸文档自愈(扩展重载后旧 offscreen 文档残留、JS 已死但 hasDocument 为真,Chromium 已知坑,超时半程强制 closeDocument 重建)。三道构建防线:ESM 语法门禁(node --check 对含 import 的 .js 静默跳过、exit 0——v0.17.0-beta.2~v0.17.2 的语法错误因此漏检,构建时统一复制 .mjs 强制检查)、zip 内静态 import 全量解析自检、根目录 .js 全量打包。 |
| 0.17.2 | 2026-11-03 | **重装体验修复(用户实测:移除旧版装新版后「唤不起语音」)** 三管齐下:① manifest 固定扩展 key → 解压安装的扩展 ID 恒为 nkmdmopeoejggghndaogmaopkhpkoped(实测不同路径加载同 ID),重装不再丢快捷键/麦克风授权/设置;② onboarding 新增快捷键绑定检测——unpacked 安装不会自动应用 manifest 建议键(实测全新加载后 toggle-voice 为空,Alt+A 无效),现在会明确警告并一键跳转 chrome://extensions/shortcuts;③ 内容脚本孤儿防护——扩展移除/重装后旧页面的内容脚本调用静默失败(实测:点浮标毫无反应),现在显示「已更新,请刷新页面」提示。另:本地引擎(whisper/sensevoice)模型未就绪时优雅回落云端并提示,不再硬报 audio-capture 瞬间结束。 |
| 0.17.1 | 2026-11-03 | **修复 CSC 纠错引擎三处实测缺陷**(真实浏览器 + 量化模型端到端验证,19 用例全过):① 吃字——孤立语气词被整体吞掉(「嗯」→空、「一丁」→「一」、「嗯。」→「。」),根因是 decode(skip_special_tokens) 会静默丢弃模型预测的特殊 token;现改为按字对齐合并,输出保留原文骨架、只替换汉字,长度不齐(emoji/[UNK] 等不可对齐)整体放弃纠错保原文。② 格式破坏——decode 在 CJK 与数字/标点间插空格(「第3章」→「第 3 章」)、词表全小写导致英文大写被小写(「A型血」→「a型血」);按字对齐后原文空格/大小写/标点/数字原样保留。③ 代词过度纠错——「他」被改成「她」的置信度最高 0.935,而真纠错「因该→应该」仅 0.881,概率分不开;新增 softmax 置信度门槛 0.96(保住 门→们 0.999 / 汽→气 0.994,挡住全部观测到的 他→她),错改比漏改更伤信任,代价是低置信纠错被保守放弃(设计取舍,已记录)。另:CSC 空输入崩溃补最后防线(token 级守卫 + decode 包裹,`token_ids must be a non-empty array` 不可能再抛出);模型镜像 CORS 补 `Access-Control-Allow-Headers: Range`。含 0.15~0.17 血统:自适应引擎(SODA 探测回落)、Whisper/SenseVoice 本地识别引擎(SenseVoice-Small int8,中文专优,10x 实时,CDN 双源下载)。 |
| 0.14.0 | 2026-11-02 | LLM 式序列级重排(纯本地,零新增权限):候选融合从"逐段独立投票"升级为**段级格架束搜索**——每段候选排成格架,对整条路径做联合评分,前文选择通过条件概率影响后文选择(口音/同音错由上下文概率定胜负)。新增**字级 n-gram 语言模型**(chinese-c4 CC BY 4.0 + 中文维基 CC BY-SA,120M 字符语料,t2s 归一,14MB 表):路径总分 = LM 对数似然 + 3.0×词典 + 1.5×上下文,束宽 8,最优路径须显著优于默认路径(1.5 对数单位)才换选;LM 表加载失败自动退化为词典+上下文模式。实测用户案例("数字人民币…币安…黑客攻击事件"被识别成"树的人民币…必安…")在新 LM 下正确路径胜出 10.2 对数单位。移除 v0.13.0 的词频表(被 LM 完全取代)。模型下载改双源:自建 CDN(pmparker.net,国内无翻墙可达,Cloudflare 缓存,与 HuggingFace 逐字节一致)优先、HuggingFace 兜底,已下载用户零迁移;修复 transformers.js v4 离线加载缺陷(旧 monkey-patch fetch 无效,改用官方 env.customCache 钩子,无翻墙也能完整离线使用)。 |
| 0.13.0 | 2026-11-02 | 借鉴输入法与搜索引擎的本地重排架构(纯本地,零新增权限):① 页面上下文自动偏置(搜索引擎"会话消歧"本地版)——输入框已有文字与页面标题的领域词自动喂给识别器偏置并参与候选投票,在相关页面说相关词汇识别自动变准,零配置;② 词频重排(IME 词频解码本地版)——内置 jieba 开源词频表(MIT,6 万词,494KB),候选按"词典(用户意图)> 上下文 > 词频覆盖(贪心最长匹配)"三级信号比较,频率分量需 0.35 显著边际才单独触发换选,平票不动;词表加载失败自动退化为词典+上下文模式。 |
| 0.12.0 | 2026-11-02 | 识别与组织质量提升(纯本地三件套):① 识别器级热词偏置——词典目标词直接喂给 Chrome 语音识别器(`recognition.phrases`,Chrome 156+),解码阶段就偏向领域词汇,专有名词/术语识别质变,旧浏览器自动跳过;② 候选融合——识别器每句的多个候选按词典契合度投票(命中目标词 +2/命中已知错形 -2),严格更优才换,平票与无词典时空操作;③ 本地组织规则——句首/独立口癖(嗯/呃/噢/喔/诶/唉,可叠用)自动清除(刻意不动"那个/这个/就是"等可作实义词的词),3 小句且满 60 字自动分段、段尾逗号升格句号,单行输入框自动把分段符压成空格。 |
| 0.11.3 | 2026-11-02 | 修复扩展页 "Failed to cache ort-wasm-simd-threaded.asyncify.wasm" 警告:纠错引擎的 wasm 是扩展自带文件(chrome-extension:// 协议),而 Cache API 按规范只接受 http(s) 请求,transformers.js 的 wasm 预缓存必然失败并告警;现已关闭 wasm 预缓存(`env.useWasmCache = false`),wasm 由 ORT 直接从扩展包加载,功能不受影响(实测:模型加载与会话创建正常,警告消失)。 |
| 0.11.2 | 2026-11-01 | 可靠性修复(听写中断/文字丢失):① 待机与断句拆分为两套时钟——按下快捷键后 9 秒内没出转写才结束(原 1.6 秒在用户开口前就把会话掐死,是"唤起后突然终止"的根因);② 收尾时把尚未定稿的实时转写一并上屏(原实现只取已定稿段落,是"看到了字却没回填"的根因);③ 每次收尾只上报一次、收尾期间再按快捷键不会重复插入;④ 空结果给出"没有听到内容"提示,不再静默结束;⑤ 历史记录无条件落盘,标签页关闭也不丢字;⑥ 插入前校验焦点元素仍在页面内,SPA 重渲染不再把字写进已移除的节点;⑦ 新增 clipboardWrite 权限:焦点丢失时自动复制到剪贴板(原实现无权限时剪贴板调用会挂起,文字彻底消失);⑧ 权限架构修正(beta.2):删除与 content_scripts 全站注入天然冗余的 optional_host_permissions 与运行时授权门(HuggingFace 模型端点 CORS 开放,实测零授权全链路可达),消除扩展页的 "redundant with required permissions" 警告;听写历史的 host 字段改由内容脚本上报(无主机权限时 tabs API 不返回 URL);⑨ 内置 AI 调用合规(beta.3):所有 LanguageModel 调用携带 expectedInputs/expectedOutputs 语言声明,消除扩展页的 "No output language was specified" 警告;中文等未 attest 语言(Chrome 当前仅支持英/日/西/德/法输出,声明中文会被 API 直接拒绝——实测确认)自动跳过深度整理并在设置页与听写时明确说明,本地标点与纠错不受影响。 |
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

- **2026-11-01**: v0.10.1 已提交 Chrome Web Store 审核(开发者后台)。状态:审核中。
- **2026-11-02**: v0.11.2 / v0.11.3 正式版已先后发布(tag `v0.11.2`、`v0.11.3`,累计 8 项缺陷修复,控制台错误清零,经三个 beta 迭代用户真机验证)。**商店暂不动作**(用户决定):等 v0.10.1 审核结果;若通过,以 **0.11.3** 作为更新提交(新增 clipboardWrite 权限会触发存量用户重新授权,理由见权限表);若被拒,直接重提 0.11.3。

## Publishing Readiness

- [ ] 128×128 图标 ✅
- [x] 3 张 1280×800 截图 ✅
- [x] 隐私政策 URL ✅ https://pmparker.net/crostivoice/privacy/
- [ ] 打包 ZIP 排除 `.git/`、`tools/`、`testpage/`、`CHROMEWEBSTORE.md`
- [ ] 单一用途声明与权限理由复核 ✅
