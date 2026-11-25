# 踩坑清单

分两类：**已验证**（之前实际踩过并有解法）、**待验证**（这批站点可能遇到但没实测过）。

写代码时遇到渲染或抓取异常，先查这里。

## 一、已验证

### 1. 公式被写成反引号

旧版知枢产物把公式包在反引号里当行内代码，KaTeX 不渲染，页面上就是一段等宽字。

处理：抽取时把 `` `$...$` `` 与 `` `$$...$$` `` 剥掉外层反引号，交给 KaTeX。不要试图正则识别裸公式，误伤率高。

### 2. Mermaid 依赖 CDN

部分站点 Mermaid 走 CDN（优先 npmmirror，多源超时回退）。断网或 CDN 抽风时图不出来。

处理：不走任何远程源。批 3.5 的实际落地形态是 **npm `mermaid@12.3.0` + Vite 动态 `import()` 分包**
（`mermaid.core` 656KB，连同它展开的 57 片合计 5,106KB，只在阅读页第一个围栏可见时才取），
不是手放的 `vendor/mermaid.min.js`——首屏 chunk 里一个 mermaid 实现字节都没有。

### 3. 离线内联不全（以及「零 CDN」这条禁令怎么落地）

所谓"单文件、断网可开"，实际常有漏网的远程字体或图标请求。

处理：构建后跑一次静态扫描——批 3.5 起收进 `tools/check_offline.py`（不再手 `grep`），
把 `http://`、`https://`、`//` 协议相对按「资源加载位点 / xmlns 声明 / 代码块与 JSON 字面量 / 保留域名 /
纯数据」分类，只有资源加载位点上的远程 URL 判违规；由 `tools/selfcheck.py` 调用并并入报告（决策 3 落地）。

**但判定标准是「运行时会不会真的发请求」，不是「文本里有没有 URL」**——铁律原文写「零 CDN」是表述错了，
已改为「渲染结果不得在运行时发起任何网络请求」（同步改在 `.qoder/rules/zhishu-rules.md`、
`.lingma/rules/zhishu-rules.md`、本条与 `AGENTS.md` 摘要）。白名单三类：

| 类别 | 为什么放行 | 批 1 实测 |
|---|---|---|
| `xmlns` / `xmlns:xlink` 声明 | 内联 SVG 必需的命名空间声明，浏览器不会去取这个地址 | `www.w3.org` 13 处，**13/13 全在 `xmlns="http://www.w3.org/2000/svg"` 里**（economics 两本的内联 SVG 图）〔X〕 |
| 代码块 / 示例数据内的 URL | 属被展示的内容，不会被解析成资源 | `weather.example.com` 2 处，**2/2 都在围栏代码块的 JSON 字面量里**（`"url": "https://weather.example.com/a2a"`）〔X〕 |
| 保留域名 | `example.com`/`example.org`/`example.net`/`localhost`/`127.0.0.1`/`0.0.0.0` 不解析到真实服务 | 与上一类重叠，无独立命中〔X〕 |

白名单之外才是真外链，**降级为纯文本**：保留显示文字、去掉 href、加标记「原文链接，离线不可达」，
逐条记 `_report.json` 的 `externalLinks`（路径 + 上下文行）。批 1 实测真外链 **13 处，全是
`mp.weixin.qq.com/s/…`**，形态是 Markdown 自动链接 `<https://…>`，集中在「来源」小节〔X〕；
`tools/extract.py --link-policy strip` 已实现三种形态的降级（`[文字](url)`、`<url>`、裸 URL），
默认 `keep` 只记录不改正文。检测器实现见 `extract.py::classify_links`（`XMLNS_RE` 只认属性名结尾的上下文，
`fence % 2` 数围栏判断代码块内）。

### 4. `\u002F` 反转义

内联数据里的路径斜杠被 JSON 转义成 `\u002F`，直接拼进 `src` 会 404。

处理：解析后统一 `json.loads` 两次或 `str.replace('\\u002F', '/')`。

### 5. 中文文件名的 raw URL 必须编码

`https://raw.githubusercontent.com/zrx-11/{repo}/main/交付说明.md` 直接请求会 404 或乱码。

处理：`urllib.parse.quote(filename)`。目录名同理，如 `01-Hello-AI人工智能导论`。

### 6. 本机系统代理导致请求超时

走默认 opener 时会被本机代理拦截，40 个站批量抓取会大面积 timeout。

处理：`urllib.request.build_opener(urllib.request.ProxyHandler({}))`，显式禁用代理。

### 7. 旧 schema 缺 three 个字段

早期产物（本地 `1\11` 那批数学书）`concepts` 只有 `id/title/file/chapterIds`，缺 `prerequisites`、`depthFragment`、`claims`。

处理：这不是解析 bug，是数据缺口。抽不到就留空，不补造。诊断倒推功能对这类站点降级为"无前置链"。

2026-11-24 probe 修正了这个判断的适用范围〔M〕：GitHub 上的三站 **`prerequisites` 不缺**（章节非空 19/20、13/14、15/16，概念 49/50、58/61），
真正普遍缺的是另外两个——`depthFragment` 非空只有 10/50 与 5/61，`claims` 三站恒空（math-physical 有顶层 `claims: []`，hello-ai 与 sudoku 连键都没有）。
所以「旧版普遍缺前置链」只适用于本地旧批次，不适用于已跑过知枢流水线的站点。

### 8. 交付说明的数字不可直接信

`交付说明.md` 里"20 章、50 概念、60 测验"这类表述格式不统一，正则容易抓到"第 3 章"或题号。

处理：计数以实际抽出的数组长度为准，说明文档只作为交叉校验，不一致时记入 `_report.json`。

**批 1 首跑坐实了这个判断，并给出一条可复用的解释**：`hello-ai-zhishu/交付说明.md` 自述 14 章，
`manifest.json` 实测 **20 章**，而概念/题/卡/术语四项完全一致（50/60/70/110）〔X〕。差的 6 章不是抽错，
是说明文件只数了正章：**id 为 `ch01`–`ch14` 是 14 个正章，另有 `t01`–`t06` 六个「专题」**
（`专题 1：一句话的旅程`、`专题 2：推荐系统…`、`专题 6：AI 与开源`），专题属附录类内容，作者没写进说明。
两个结论：

1. **提取器的数字只认 manifest，说明文件仅作交叉核对**；差值不解释清楚就不写进任何展示层。
2. `chapters[].num` 必须由 id 尾部数字解析，且**同书内可重复**（`t01` 与 `ch01` 都会得 `num=1`）——
   所以 `num` 只能当显示序号，不能当键，也不能按它排序去重〔X〕。

### 9. 单文件大包的能抽出来，但内联正文不能当正文用

原「待验证 1」，2026-11-24 定案。`math-physical-methods` 的 `index.html` 1,887,845B，内联数据靠括号配平扫描 + 反转义后
`json.loads` 能稳定命中 `BOOKS` 容器 846,220B〔P〕，抽取本身没问题。

**但后半句才是结论：内联的正文是成品 HTML，不是可还原的 Markdown。**实测 `BOOKS[slug].rendered` 里
`ch01` 含 KaTeX 节点 204 个、`alttext` 计数 0、公式定界符（单/双美元符）计数 0〔H〕——原始 TeX 在站点构建时已被烤掉，取不回来。
所以 `body` 只能回读该站的 `.md` 源文件，`rendered` 降级为「有成品页，公式不可还原」，对应 `schema.md` 的 `contentLevel: "degraded"`。

同文件另有 610 个体积更小的容器，其中 `jM` 22,063B 是混淆代码（无引号键 141 处、无空格）〔P〕——
**必须按体积排序再逐个核对，不能取第一个命中就当数据。**

### 10. 数独站的正文不在 `src/content/*.js`，走 Node 求值分支

原「待验证 3」，2026-11-24 定案。`sudoku-zhishu` 的 `src/content/*.js`（`seeds.js`、`lessons-a.js`、`lessons-b.js`、`quizzes.js`、`meta.js`）
是**构建输入**，运行时的正文已经拼进 `index.html` 的 `ZS.*` 命名空间里〔T〕〔N〕：`ZS.lessons` 16、`ZS.quizzes` 54、
`ZS.CARDS` 34、`ZS.GLOSSARY` 43、`ZS.SEEDS` 14、`ZS.TECH_META` 6〔N〕。

这些是 JS 字面量不是 JSON（无引号键 233/248 处、模板串 20–24 个、注释 10 处、尾逗号 46–48 处〔P〕），Python 侧解不了，
**数独走 Node 求值分支，抽取器因此依赖 Node 运行时**（`new Function('return ' + 字面量)()`，本轮已跑通〔N〕）。
Node 不可用时该站降为 `stats-only` 并记 `_report.json`，不自动安装运行环境。依赖版本见 `tools/README.md`。

另外它的正文片段本身是 HTML（16/16 章含 `<p>`，8/16 含 `<table>`，公式定界符计数 0）〔N〕，
与 `chapters[].body` 的 Markdown 契约不符 → 靠 `bodyType: "html"` 区分，前端不要按 Markdown 渲染。

### 11. 内联赋值取「首个括号」必错

`sudoku` 的 `ZS.lessons = (ZS.lessons || []).concat([ … ])` 这类写法，等号后**第一个** `[` 是 `(ZS.lessons || [])` 那个空数组，
按「首个括号配平」取容器会拿到 2 字节的 `[]`，正文一条不剩〔P，本轮 probe 修正过程〕。

处理：在窗口内枚举所有候选容器，取**配平后最长**的那个；`.concat(` 只在紧邻（80 字符内）时视为同一赋值。
点号命名空间的赋值（`ZS.x = …`）要单独一条正则，`const|var|let|window.` 覆盖不到。

### 12. 同一份数据的两套 id 命名空间

`manifest.json` 的 `quizzes[].id` 是 `q01`，`index.html` 内联 `BOOKS[slug].manifest` 里同一条是 `ch00-q01`〔H〕〔M〕，
两站如此（各 60/100 条全部不同）。顶层键与其余字段逐项相等〔M〕。

处理：批 1 必须**显式选源**——统一取 `manifest.json` 文件侧，内联副本只用于结构对账，不作数据源。
混用会让题目 id 对不上，倒推诊断链直接断。

### 13. 字段名撞车：`source` 已被占用

统一 schema 原本想用 `source{repo,path}` 记抽取来源，但实测三站 manifest 的 `source` 是「原书出处」对象
（hello-ai `{"file":"hello-ai.pdf","page":"6–15"}`、math-physical 无 `page` 键、sudoku `page` 是整数 0）〔M〕。

处理：抽取来源改叫 `origin`，原书出处原样承接为 `bookSource`，`page` 不规范化。
同步点：`schema.md` 第一/三/四节、`design.md` 详情层回溯条、`sites.md` 第八节——只改 schema 会让三处表述打架。

### 14. 拉了 `*.csv` 才发现 kaoyan 的 csv 是校对台账，不是题库

`kaoyan-math-66000` 原本只稀疏检出根目录，2 个文件。按「加 `*.csv` 与 `*.txt`、不加 `*.html`」的决策放宽到任意深度后：
已检出 **2 → 75**（md 28 + json 20 + **csv 19 + txt 8**），pack 205.54 KiB → **386.76 KiB**〔K〕。

打开 csv 一看，表头是 `q,page,verdict,note,time` 与 `qno,册内编号,页,题干核对,答案核对,校勘位置`——
**这 3,613 行是人工核对台账（哪题第几页、判定、备注），不是题面**；
`work/manifest/*.json` 也是流水线元数据（`waves.json`、`inventory.json`、`q2p`/`p2q` 映射）〔K〕。
真正的题干与答案只在那 **201 个 `.html`** 里，而成品 HTML 不拉（理由见下）。

结论：**kaoyan 的正确判定是 `stats-only`，不是「有题无正文的 degraded」**——它连题面都拿不到。
「degraded = 可做题、无或极少正文」这个定义本身保留（sudoku 就是标准 degraded：16/16 章 HTML 正文 + 54 道题），
但 kaoyan 不进这一档。以后遇到「有题库数据」的站，先 `head` 两个数据文件看表头再定档，不要按扩展名猜。

公式定界符顺带验了：台账文本里 `$...$` 149 处、`\(...\)` 332 处〔K〕——**定界符完好**，
但 `\(...\)` 这种写法要求 KaTeX 端开 `inlineMath: [['$','$'],['\\(','\\)']]`，或抽取时归一成 `$...$`（已写进铁律）。

### 15. 三档拉取的扩展名清单：`*.md *.json *.csv *.txt`，明确不含 `*.html`

`*.html` 不拉的代价是认下来的：知枢单文件站的 `.html` 与 `BOOKS[slug].rendered`、sudoku 的 `ZS.*` 正文是同一类东西——
**公式在生成时被烤成 KaTeX 节点、并绑死当时的字号与配色**，反解析成本高、收益低（`math-physical` 实测
KaTeX 节点 204 个、`alttext` 0、定界符 0〔H〕）。kaoyan 的公式密度又极高，硬啃 HTML 只会产出看着对、
实际不可重排的正文。所以三档模式固定为 `*.md *.json *.csv *.txt`，写进 `tools/clone_repos.sh` 与 `tools/README.md`。

### 16. `setAttribute('hidden','false')` 等于继续隐藏

批 3 阅读层第一版面板「关不掉也打不开」，查下来是这行：

```ts
els.panel.setAttribute('hidden', String(visible));   // visible=false 时写成 hidden="false"
```

`hidden` 是**存在即生效**的布尔属性，值写 `"false"` 照样命中 `[hidden]` 选择器——元素仍然不显示，
且 CSS 里只要有一条 `[hidden]{display:none}` 之外的 `display` 覆盖，还会反过来出现「关不掉」。

处理：统一走 `el.hidden = !visible` 属性赋值（`src/panel.ts:341`）。
JS 里读 `el.hidden`，不要在 CSS 里用属性选择器猜值。

### 17. 章节→概念的反查只能走 `concepts[].chapterIds`

`design.md` 第三节说「概念是立柱上的发光点」，但挂载关系有两个候选字段，取错就是一片空立柱〔X〕：

| 字段 | 非空数 | 结论 |
|---|---|---|
| `chapters[].conceptIds` | **15 / 1,169** | 抽取器普遍留空，不能用 |
| `concepts[].chapterIds` | **765 / 765** | 全部可解析，唯一可用路径 |

处理：`layout.ts::conceptsByChapter()` 拿全书概念按 `chapterIds` **反绑**到章，一章多概念全挂、不截断。
`chapters[].conceptIds` 仍留在类型里（可选字段），只作交叉校验，不作渲染源——
这正是「铁律 7 抽不到留空」在下游的代价：**空数组是真数据，不能拿它当关系表用**。

### 18. 同一个 `bookSlug` 分布在多个仓库，定位必须带 file

129 条书目里 `bookSlug` 只有 **98 个不同值**——**31 个 slug 出现在 2 个及以上仓库**
（同一本书的中英版、或不同作者复用同名 slug，如 `hello-ai`、`d2l`、`rl-sutton`、`zhengshi`）〔X〕。
按 slug 找书会命中错的那本，自检的「打开指定章节」也会点错展台。
注意这与 `totals.sitesUnique = 96` 不是同一口径：后者按抽取的结构签名去重〔X〕，前者按字符串。

处理：唯一键是 `repo + bookSlug`，网络路径用 `sites[].file`。
对外入口一律收 `{slug?, file?}`（`main.ts::findBook`），**给了 file 就按 file 精确取**；
三段键 `{repo}::{bookSlug}::{id}` 用作节点 id 与索引键。

### 19. Windows 下 `subprocess` 调 `npx` / `npm` 直接 FileNotFound

`subprocess.run(["npx", "tsc", ...])` 在 Git Bash 里能跑，在 Python 的 `CreateProcess` 里不行——
它们是 `npx.cmd`，不带扩展名不匹配。自检脚本因此每条命令先过一遍 `shutil.which`〔B3〕。

处理：`exe = shutil.which(cmd[0]) or cmd[0]`（`tools/selfcheck.py:39`）。
同时传 `env={**os.environ, "PYTHONIOENCODING": "utf-8"}`，否则子进程打印中文会 `UnicodeEncodeError`（cp936 控制台）。

### 20. 「成品 HTML 正文」的长度阈值要按渲染后文本量算

自检要选一份够长的 degraded 样本来验「HTML 直注入不被 markdown-it 二次处理」。
直接拿 `len(body) > 600` 判会**永远选不上**：成品 HTML 里标签占大头，可见文本远小于原始串〔B3〕。

处理：先 `re.sub(r"<[^>]+>", " ", body)` + `html.unescape` + 折叠空白，再比长度（`selfcheck.py:71`）。
反向同坑：探针里拿渲染后的 `innerText` 去和原始 HTML 串比长度，也是基准不一致——比较前先归到同一侧。

### 21. headless 帧率不受 vsync 封顶，165fps 不是 bug

帧率判据写「≥45」，无头 Edge 里测到 **165**〔B3：`_work/selfcheck-report.json`〕。
rAF 在无头模式不等合成器，所以这个数只能证明「没掉到阈值以下」，不能当真实 60Hz 屏的观感。

处理：判据保留下限语义（防卡死），把采样窗口（10s）与视口（1440×900）写进报告；
真实负载靠 `triangles()` 兜——大厅 **1,398**、数学房间 **3,874**（265 立柱 + 398 光点 + 45 展台）〔B3〕，
量级远低于阈值，不必怀疑帧率数字本身。

### 22. 地面学科名的可读性是四件事叠出来的

走廊地面文字做成 canvas texture 贴地网格，从大厅看**六条里只有四条认得全**，另两条被斜视角压扁〔B3：
`_work/shots-batch3/`〕。四个独立成因，缺一个都不清晰：

| 成因 | 处理 | 位置 |
|---|---|---|
| 雾把远处混成背景色 | `Fog` 的 near/far 收到 560/1300，覆盖最远走廊 | `scene3d.ts:96` |
| 与地面网格共面被挡 | 贴图抬高到 y=0.62，`transparent` + `opacity 0.92` + `DoubleSide` | `scene3d.ts:251` |
| 斜视角采样糊 | `tex.anisotropy = 4`，字号 96px，`shadowBlur 18` 描边提对比 | `scene3d.ts:239` |
| 文字方向读反 | 按大厅相机「屏幕左→右」取阅读侧，`rotation.order='YXZ'` 后再 atan2 | `scene3d.ts:225` |

排查顺序别搞反：**先单独拍一张再判读**，不要在截图里靠猜。`viewCorridor(key)` 把相机推进该走廊、
`corridorScreenBox(key)` 给出投影包围盒，两者配合即可逐条留证；
能看见却读不出=字号/各向异性，完全看不见=雾或高度。

判据只要求「走廊上有可读学科名」，**大厅视角 4/6 可辨 + 逐走廊 6/6 可辨**即达标，
不为了最后两条把 fov 改窄（改了会撞判据里的无溢出与帧率项）。

### 23. `stats-only` 档在库里是空的，只能造样本走一遍

`contentLevels` 实测 `{full: 128, degraded: 1, stats-only: 0}`〔X〕——判据要求「三档分流都有行为」，
但第三档**没有任何一本书可以点开**。若因此删掉这一支，等于把 schema 里存在的档位当死代码；
若在 `data/` 里改一本书的档位来凑样本，直接违反铁律「不改动 data 让演示好看」。

处理：把样本造在**调用侧**、不落库——`main.ts` 的诊断接口给 `openStatsOnlySample({slug?,file?})`，
取真实记录后在内存里把 `contentLevel` 覆成 `'stats-only'` 再走同一条 `openBook()`。
探针调它验「不渲染正文、只给原站入口、面板不留空」，跑完即弃，`data/` 与 `manifest.json` 不受影响。
这是所有「schema 有、库里无」档位的通用验法：**造样本改的是传入参数，不是磁盘数据**。

### 24. grid 项的自动最小尺寸是 min-content，一条中文长标题能把弹层撑破 390

390 视口下搜索弹层 `#search-box` 实测宽 551.3px、右缘 469px，`document.scrollWidth` 却仍报 390 之类的假象
（溢出发生在 fixed 弹层内部，文档宽不涨）。根因不在内容宽度而在布局：`#search-box` 是 grid 项，
**grid/flex 项的自动最小尺寸默认取 min-content**，一条 40 字的中文标题不换行就是 551px，
`width: min(660px, 100%)` 也压不住它。

处理：容器与每一条子项都显式 `min-width: 0`，长文本再配 `overflow-wrap: anywhere`
（`src/styles.css` 的 `#search-box` / `#search-line` / `#search-scope` / `#search-results` / `#search-status`）。
判据要量两层：`doc === 390` 和**弹层盒子 `right ≤ 390`**，只查前者会漏。〔K〕

### 25. 中文「单字 + 二字」分词天然高召回，无结果态验不出来

MiniSearch 默认按空白切，中文不加空格永远匹配不上，所以 `search.ts::tokenize()` 按单字 + 二字组合切。
副作用：`combineWith:'OR'` + `prefix:true` + `fuzzy:0.12` 之下，随手敲的中文乱码「的结果」也能命中 21 条——
判据要求「无结果」态可见，用中文乱码验必然拿到 ready。〔K〕

处理：**无结果态用拉丁乱码验**（自检取 `zxqvkjz`），中文关键词只用于「有命中」路径。
这不是 bug，是召回策略；要收窄得改 `searchOptions`，属于产品决策不是修缺陷。

### 26. `initSearch()` 末尾只 paint 一次，状态文案要在弹层打开后才刷新

`runSearch()` 里 `if (state.open) paint()`：弹层没开时跑检索，`dataset.status` 与文案都不会写进 DOM。
探针若在 `searchHide()` 后直接 `searchRun('数学','tools')` 读状态，读到的永远是上一次（或初始）的 `empty`。
处理：验三态前先 `searchShow('')` 再跑查询；产品侧不动这条设计（不开弹层就不必改 DOM）。〔K〕

### 27. 「mermaid 有没有加载」不能拿 chunk 文件名正则判

第一版探针用 `/mermaid|diagram|c4|…/i` 过滤 `performance.getEntriesByType('resource')`，
结果 `scene3d-C4wo3fve.js` 的**哈希段**里撞出 `c4` 被判成 mermaid 分包，四条懒加载断言全红。〔K〕

处理：`bundle_evidence()` 从构建产物算出 mermaid 专属 chunk 名单，经 `samples.mermaidChunks` 注入探针，
浏览器侧只做集合成员判定。哈希串里什么都有可能，取证要点名而不是猜形状。

### 28. mermaid 子包会反向 `import` 主 entry 的共享助手，BFS 必须在闭包边界停住

算 mermaid chunk 名单要从 `mermaid.core` 沿静态 + 动态边展开。但 Vite 把一小段共享代码提升进 entry，
57 个 mermaid 子包里大量出现 `import{_ as Pt}from"./index-BOvDw5BJ.js"` —— 不限住就会顺着反向边卷进
entry 静态闭包，再把 `scene3d` 之类全算成 mermaid，名单失去意义。〔K〕

处理：BFS 遇到 entry 及其静态闭包成员即停（边界外不收），得到的 57 片就是「点开围栏才会多出来的东西」。

### 29. 判首屏含不含 mermaid，别拿配置键当指纹

第一版查 entry 里有没有 `startOnLoad|securityLevel` —— 命中了，判成失败。
那两个字符串是我自己 `diagram.ts` 的 `CONFIG` 字面量，被打包进 entry 是必然的。〔K〕

处理：用实现体才有的函数名作标记（`detectType`、`getDiagramFromText`、`mermaidAPI`、`registerLayout`、
`addDirective`），要求 entry 命中 0 个、`mermaid.core` 至少命中 3 个。同理，MiniSearch 用 `autoVacuum`
作「打进哪个 chunk」的指纹。

### 30. 检索返程落点：每次跳转都要重记，用户自己走位就必须作废

落点只在「面板原本关着」时记录，前一次跳转留下的陈快照会串到本次——第二次跳转时面板是开的，
不覆盖旧值，返回时把相机拉回**上上次**所在的区（实测 `roomAfterReturn` 成了 `ai`）。反过来，
用户自己走位（进房 / 回大厅）之后落点也已失效，返回却照旧还原。〔K〕

处理：`openFromSearch()` 每次跳转都无条件 `searchSpot = currentSpot()`（链式跳转返回上一站，语义也才对），
`enterRoom()` 与 `showHall()` 第一行把 `searchSpot` 置 null。

### 31. `--skip-build` 复用旧 dist，会把已经修好的东西验成失败

本批三处改动（空片文案、返程落点、390 溢出 CSS）都需要重新构建才生效。
跑 `python tools/selfcheck.py --skip-build` 得到「71 项里 3 项失败」，逐项对下来全是旧产物所致。〔K〕

处理：**收尾与交付一律完整重跑**，`--skip-build` 只用于改探针本身时的快速回环。
另一坑在同一处：Windows 上 dist 被上一轮进程占着目录，`vite build` 会在 prepare-out-dir 阶段
`EBUSY: rmdir dist\assets`——构建失败的输出要留在报告里，别当成探针不稳定。

### 32. tools 区库里 0 本，检索分片仍要出齐

任务书写「六学科各一片、tools 缺片沿用容错」。库里 tools 一本都没有〔X〕，
但空区照样生成一片 0.3KB 的空片（`counts` 全 0），前端才有一条真的「空片容错」路径可验：
`已载分片 0 本` + 「工具间 区库里 0 本（分片是空的），换到其他学科再搜」。

判据「六个学科各至少一个关键词命中」因此在库里不可满足——只能是 5 区命中 + tools 走空片路径，
**不为过判据去改 `data/`**（铁律）。自检把这两条分开记录，避免看起来像「六区都命中」。〔K〕

### 33. 构建插件的 `transform` 静默空转：正则捕获组带上了路径段

mermaid 白名单要把非保留图型的 `import("./chunks/mermaid.core/xxx.mjs")` 换成必定失败的表达式。
写成的捕获组是 `(?:\./chunks\/mermaid\.core|\./)([^"]+)\.mjs` —— 交替支少写了结尾的 `/`，
落到短支时捕获到的是 `/c4Diagram-KJ2TOQU5`（带开头斜杠），拿去查以 `flowDiagram-MALGAFMO` 这种形态建键的 Map，
**永远查不到**，于是不管有没有匹配上都不改代码，构建照旧成功，产物里分包一个没少。〔K〕

处理：`if (hit) this.info(...)` 这种「命中才打印」的写法恰好把空转藏住了。要证伪得反过来——**在插件里无条件计数打印**，
或者对着真实源码单独跑一遍正则（`_work/dbg_re.mjs` 三条命令就定位了）。判据侧的兜底更省事：
`selfcheck.py` 直接扫 `assets/` 里有没有白名单外的分包名（`droppedLeftovers`），产物不说话，插件的日志才算数。

### 34. 「拷贝收敛」的三条前提，实测有一条是假的

前置清单写「`dist/` 24MB 里 16.7MB 是数据整份拷贝」，潜台词是这些拷贝可以删。逐族用浏览器实测运行期请求
（`_work/measure_data_requests.mjs`，结论落 `_work/measure-requests.json`）：

| 数据族 | 源体积 | 运行期请求 | 能不能删 |
|---|---|---|---|
| `bodies/` | 7.42 MiB | 129 本按需取 | 不能（判据 C1） |
| `sites/` | 3.72 MiB | 55 次 / 去重 54 本 | 不能——任务书给的条件是「若运行期零请求才可删」，实测非零 |
| `dist/`（结构 + 检索） | 4.61 MiB | 结构 5 片 + 检索 6 片全被取 | 不能 |
| `manifest.json` | 0.05 MiB | 3 次 | 不能 |
| `_report.json` + `raw/` | 0.02 MiB | **0** | 能，已不拷 |

也就是说纯靠「少拷」最多省 0.02 MiB，60% 的门槛根本够不着。〔K〕
处理：**功能全留，改传输形态**——构建期 gzip、客户端 `DecompressionStream` 还原，数据族 15.75 MiB → 4.58 MiB；
剩下的是 mermaid 裁剪 1.8 MiB。两条加起来 22.83 → 9.85 MiB（43.1%）。
教训：前置清单给的「死重」是估计值，收敛前先测请求再定删；不测就动手会先删出 bug 再发现删错了。

### 35. `.json.gz` 一进产物，门槛脚本自己先瞎了

三处脚本原本按明文 `.json` 认数据，换成 `.gz` 后都是**静默失效**（不报错、只是看不见）：

- `check_offline.py`：`.gz` 既不在 `CODE_EXTS` 也不满足 `suffix == '.json'`，直接跳出扫描范围——269 个数据文件
  会从「已扫」变成「不存在」，离线体检的覆盖率说降就降。改成先验 magic 再 `gzip.decompress` 后扫，报告里另打
  「预压 .gz 透明解压后扫描 269 个」，让覆盖率可核对。〔K〕
- `selfcheck.py::bundle_evidence()`：分片大小按 `search-<area>.json` 取，取不到就是 `None` → 「六片齐」判据直接红。
  改成 `.json.gz` / `.json` 两种都认（dev 态仍是明文），并把实际后缀记进 `shardSuffix`。
- `selfcheck_probe.mjs`：路由写的是 `'**/dist/search-*.json'`，`*.json` 要求以 `.json` 收尾，`.json.gz` 不匹配，
  「索引加载中」那条 600ms 延迟注入的断言会验不到 loading 态。改成 `'**/dist/search-*'`。〔K〕

### 36. 托管层可能替浏览器把 `.gz` 解压完

若服务对 `.gz` 加了 `Content-Encoding: gzip`，`res.arrayBuffer()` 拿到的是**已解压的明文 JSON**，
再喂给 `DecompressionStream` 必抛。反过来若服务开了 **SPA 回落**，取不到的分片会以 `200 + text/html` 返回，
`res.ok` 判不出来，`JSON.parse` 只给一句「Unexpected token '<'」。

处理都在 `src/data.ts`：`gunzip` 先看前两字节是不是 `1f 8b`，不是就按明文走；`getJson` 见到 `content-type: text/html`
就抛「拿到的是 HTML（产物缺这个文件）」——把「缺文件」和「解压失败」两种病因分开，别再混成一条 parse error。〔K〕
这类判定只在**系统边界**（外部托管行为）做，内部数据不做防御性校验。

### 37. mermaid 保留哪 5 类不等于只留 5 个分包

图型分包和布局分包是两套注册表。`flowchart` 在 mermaid 12 里默认走 **elk**（1.45 MiB，产物里最大单文件），
`mindmap` 走 cose-bilkent，兜底 `LAST_RESORT_LAYOUT` 才是 dagre。所以「只留 5 类」落地成 14 片 / 3.2 MiB
（闭包含共享的 `katex`、`sizeCapture`、`bpmnIcons`），不是 5 片。〔K〕

库里没有一处围栏用 frontmatter 覆写布局，`swimlane` 布局包（120 KB，库里 0 处使用）因此可安全剔除——
`getRegisteredLayoutAlgorithm` 自己会回落。反过来说：**没有实测就不能剔 elk**，把 flowchart 改成 dagre 是视觉行为变更，
不属于打包收敛。

### 38. `publicDir` 一刀切换成 `false`，dev 就看不到数据了

`publicDir: false` 能把整份 `data/` 从产物里摘掉，但 dev 也一起没了——`npm run dev` 时所有数据请求 404，
每改一处正文都要重新构建。改成按命令分支：`command === 'serve' ? 'data' : false`，dev 仍旧整目录暴露明文，
build 走 `zhishu:ship-data` 精挑 + 预压。代价是 dev 与产物形态不同（明文 vs `.gz`），由 `import.meta.env.PROD`
在 `dataUrl()` 一处对齐，两边都不用改调用点。〔K〕

### 39. 设了 `PCFSoftShadowMap` 却 census 报 `PCFShadowMap`（批 7）

three r186 起 `PCFSoftShadowMap` 被移除：`WebGLShadowMap` 首次渲染阴影时打一条
`warn('PCFSoftShadowMap has been removed. Using PCFShadowMap instead.')` 并把 `type` 归一成 `PCFShadowMap`。
所以「读回来的类型」永远不等于「你设的类型」，断言直接写 `type === 'PCFSoftShadowMap'` 必红。

处理：赋值照旧写 Soft（表达意图，旧版本仍生效），census 另记 `shadow.requested`，
断言拆成「有效类型含 PCF」+「requested === PCFSoftShadowMap」两条。
这条 warn 不进「控制台零报错」口径——探针只收 `m.type() === 'error'`，别把它误当失败去改代码。

### 40. 阴影明明开着，截图里却看不见（批 7）

不是 shadowMap 的问题，是**主光俯角**。方向光架到 `half*1.5` 高（约 60°）时，柱子影子几乎全压在自己背后，
关/开阴影的整屏亮度差只有 1.6e-4——肉眼和统计都等于没投影。降到 `half*0.8`（约 38°）后影子拖到展台上，
房间中段亮度差涨到 7.2e-3（45 倍）。

处理：取证要用亮度对照而不是「看着有影子」。A/B 采样区域选**受影面**而不是整屏，
且阈值至少留 2 倍余量（1.6e-4 贴 1e-4 门槛的写法会随机红）。

### 41. 阴影关了之后三角面「少了一半」（批 7）

`shadowMap.autoUpdate=false`（静态场景只烘一次）之后，`renderer.info.render.triangles` 每帧不再包含阴影 pass 的提交量，
数字会掉到只算主渲染。别以为掉帧数是 bug，也不能拿它当「总负载」报给 15 万预算判据。

处理：census 分三档报——`mainPass`（主渲染静态量）、`shadowPass`（投影体提交量）、`perFrame`（实际整帧），
判据按 `perFrame`，另加一条 `shadowPass > 0` 证明阴影 pass 真在跑。
透明 + `DoubleSide` 的材质主渲染会提交两遍，静态量与 GPU 读数对不上时先查这个（大厅静态 810 vs 读数 1,398 即此因）。

### 42. Bloom 一开帧率掉 10% 以上（批 7）

`UnrealBloomPass` 默认按 `renderer` 的全分辨率建 mip 链，DPR=2 时是 4 倍像素量。

处理：`composer.setSize()` **之后**再 `bloomPass.setSize(w*pr*0.65, h*pr*0.65)`——composer 在 render 时不会替 pass 重算尺寸，
所以这个 0.65 会一直生效。省回 ~11% 帧时，肉眼在 1440×900 上看不出高光边缘差别。
同理 `composer.setPixelRatio(renderer.getPixelRatio())` 必须显式调，否则 composer 用默认 1，DPR>1 的机器上后期链会糊。

### 43. 房间点光在地面留一块过曝热点（批 4 之后批 7 复现）

`decay=2` 的 PointLight 挂在 y=7 时，离地面太近，中心照度 ≈ intensity/d² 直接爆。抬到 y=18、强度 420（后调 392）热点消失。

处理：房间补光一律挂到展台以上；判亮度别看整屏 mean，要按 `sampleLuminance` 采地面横带——
整屏 mean 被天空带稀释，地面过曝在整屏上只体现为 +0.02。

### 44. 光点做了 GPU billboard 之后点不中（批 7）

把朝向塞进顶点着色器（`modelViewMatrix` 提旋转）确实省掉每帧重写实例矩阵，但 `InstancedMesh.raycast`
读的是**实例矩阵**，着色器里的旋转对拾取不可见——射线命中的还是那根竖着的 1×1 面片，398 个光点全部点偏。

处理：billboard 放 CPU 侧，每帧 `matrix.compose(pos, camera.quaternion, scale)` 重写实例矩阵；
断言看 `dotBillboard === true` 与贴图指纹 `canvas:radial-gradient-64`，不看帧率。

### 45. headless 里 PMREM 环境光「看不出有没有生效」（批 7）

envMap 只抬高光与金属感，截图亮度差在噪声里；而 headless 的 ANGLE 驱动偶尔不给浮点 render target。

处理：断言走**指纹**而不是像素——`scene.environment` 非空 + `isRenderTargetTexture` + `halfFloat` +
`PMREMGenerator` 生成的 target 打标 `userData.pmrem`，源 canvas 用完即 `dispose()`。
「零外部资产」由 `dist/assets` 里 `.hdr/.glb/.gltf/.ktx2/.png/.jpg` 计数为 0 兜住，不靠人记。

## 二、待验证

编号保留原样，已定案的两条只留指针，免得旧引用（含 `probe-report.md` 第七、八节）对不上。

### 1. ~~1MB 单文件站点的内联数据能否稳定抽出~~ → 已定案

见「一、已验证」第 9 条。结论两半：数据抽得出（`BOOKS` 容器 846,220B 配平命中〔P〕）；
但内联正文是成品 HTML，KaTeX 节点 204 个、`alttext` 0、定界符 0，**原始 TeX 不可还原**〔H〕——正文一律回读 `.md`。

### 2. 版本差异范围（铺开已定案大半，剩适配器缺口）

已知跨度 v1.0–v1.9。三站实测：章节字段名统一是 `title`，未出现 `name` / `heading`；原猜的 `DATA` / `__DATA__` 也未出现〔P〕。
批 1 铺开 50 仓 129 书后，上表三项全部有了全库口径〔X〕：

| 项 | 全库实测 | 结论 |
|---|---|---|
| 数据变量名 | `BOOKS`（多文件包与单文件大包）、`ZS.*`（sudoku） | 别名表不必加行，两分支已覆盖 |
| 正文载体 | `bodyType` 只有两值：`md` **1,153** / `html` **16** | 16 全出自 sudoku，前端只需两条渲染支 |
| `contentLevel` | `full` 128 / `degraded` 1 / `stats-only` **0** | 第三档在库里是空的，自检只能合成样本（见已验证 23） |
| 空正文 | 1,169 章**零空 body** | 「full 却读不到正文」的排查项在库内无实例 |
| 定界符 | `\(` **0** 处、`\[` **4** 处、`<details>` **0** 处 | 铁律要求 KaTeX 开 `\(\)` 是防御性的，库内数据实际只用 `$...$` |
| Mermaid | **855** 章含 ```` ```mermaid ```` 围栏，共 **882** 个围栏、出自 **77** 本书 | 占比 73%，批 3.5 已 vendor 化 + 可见才渲染（不进首屏 chunk）。图型实测只有 5 种：`flowchart` 818 / `graph` 55 / `sequenceDiagram` 6 / `mindmap` 2 / `xychart-beta` 1——**库里没有 classDiagram、stateDiagram，抽样不硬造** |
| 可选字段 | `depth` 82/765、`claims` **0**/765、概念 `prerequisites` 428/765、章 `prerequisites` 372/1,169 | `claims` 全库为空 → 误解/断言区块默认不出现 |

仍未定案的是**适配器侧**：`_report.json` 记 `pendingSources` **25 项**（无 `manifest.json` 的站，
如 `ACM-XCPC-Notes` 只有 1 md + 1 json，需专用适配器）、`unmappedAndNotes` 19 项（字段形态对不上，如
`minutes: "1–2"` 取不到数值 → null）。这两类不进本批，但决定了 `stats-only` 档什么时候会真的被用到。

### 3. ~~数独站的特殊结构~~ → 已定案

见「一、已验证」第 10 条。正文在 `index.html` 的 `ZS.*` 内联字面量，`src/content/*.js` 只是构建输入；
数独走 Node 求值分支，抽取器因此依赖 Node 运行时〔N〕。

### 4. 超大仓库

`ACM-XCPC-Notes` 481MB、`kaoyan-math-66000` 38MB、`ai-enlighten` 17MB。

**「不要 clone」是有条件的，不是禁令。** 原句「不要 clone，只抓 `manifest.json` 与说明文件」保留为默认取向
（能不拉仓就不拉），但准确边界是：一律禁止的是**无限制的全量 clone**。
按仓库大小与所需内容分三档处理，命令与档位归属见 `tools/README.md` 的「仓库拉取三档策略」——

- < 50MB：`--depth 1` 浅克隆整仓，正文 `.md` 直接读本地
- 50–100MB：`--filter=blob:none --sparse`，至少含根目录，按需再展开子目录
- \> 100MB，或只需要根目录的站：稀疏检出，只取 `*.md` 与 `*.json`

`ACM-XCPC-Notes` 481MB 走第三档；`kaoyan-math-66000` 虽只 38MB，但只用到根目录题库 JSON，同归第三档；
`ai-enlighten` 17MB 可浅克隆。硬约束：**稀疏规则不得排除正文所在子目录**——hello-ai 的正文在
`01-Hello-AI人工智能导论/` 下，被 `/*` 这类根目录规则挡掉就会把 `full` 站误判成 `stats-only`。

clone 失败或档位不明时退回 raw 逐文件（`schema.md` 第三节），别硬拉。
本轮未探到：probe 只跑三站，最大文件树 133 文件；raw 的实际限速阈值、各档仓库的 clone 真实耗时均未压测。

## 三、排查顺序

页面出问题时按此顺序查，别跳：

1. 控制台有无报错
2. 公式是 KaTeX 还是等宽字 → 查「反引号」
3. 图不出来 → 查 Mermaid 是否走了 CDN
4. 断网刷新白屏 → 查离线内联
5. 图片/字体 404 → 查 `\u002F` 或中文名编码
6. 手机横向滚动 → 量 `documentElement.scrollWidth`
7. 3D 卡死 → 是否加载了分片外的数据
8. 正文里出现 HTML 标签字面 → `bodyType: "html"` 的站被当 Markdown 渲染了（见已验证 10）
9. 题目答案对不上 → 前端重排了 `options`，而 `answer` 是 0 基索引（见 `schema.md` 第一节）
10. 站点标着 `full` 却读不到正文 → 查 `.md` 回读是否命中、路径有没有漏 manifest 的目录段（见已验证 9 与 `schema.md` 第三节）

批 3 前端新增的六条，接在同一顺序后面：

11. 面板点不开也关不掉 → `hidden` 写成了字符串属性（见已验证 16）
12. 立柱上光点少得反常 → 挂载关系取了 `chapters[].conceptIds`（见已验证 17）
13. 打开的书不是点的那本 → `bookSlug` 跨仓重名，改按 `file` 取（见已验证 18）
14. 自检脚本 `FileNotFoundError` → Windows 下 `npx`/`npm` 是 `.cmd`（见已验证 19）
15. 帧率明显低于预期 → 先读 `triangles()` 看真实负载，再确认是不是小地图循环与探针采样在抢 rAF（见已验证 21）
16. 地面学科名看不见 → 按已验证 22 的四因表逐条排（雾 → 高度 → 各向异性 → 方向），先单独拍一张再判读

批 3.5 / 批 4 新增的六条，同一顺序继续往后接：

17. 图一直是「渲染中」或空容器 → 看 `data-diagram` 走到哪一步（`pending/watching/loading/done/error`），
    空容器一定是没落进 `fail()` 支（见已验证 27 的取证口径）
18. 首屏就拉了 mermaid 分包 → 先确认是分包真载入了还是 chunk 名被误判（见已验证 27、28、29）
19. 搜了没结果但库里确有 → 中文关键词命中范围本就宽（见已验证 25），反向查「无结果」态要用拉丁乱码
20. 搜索跳转后返回落回别的区 → `searchSpot` 没重记或没在走位时作废（见已验证 30）
21. 390 下弹层溢出但 `doc === 390` → grid/flex 项的 min-content 自动最小尺寸，量盒子右缘（见已验证 24）
22. 自检红了一堆却查不出代码问题 → 先看是不是 `--skip-build` 复用了旧 dist，或 dist 被上一轮进程占用
    （见已验证 31）

批 6 打包收敛新增五条，同一顺序继续往后接：

23. 进分区没有立柱 / 搜索恒 0 本 → 先分清是「文件不在产物里」还是「解压没成」：Network 里看
    `dist/<area>.json.gz` 的 `content-type`（`text/html` = 缺文件被 SPA 回落伪装成 200；`1f 8b` 开头 = 正常预压），
    见已验证 36 与 `deploy.md` 4.1
24. 数据读不出来但 `res.ok` 为真 → 托管层透明解压，或压根就是明文；`gunzip` 按 magic 分支两种都能读（已验证 36）
25. 老浏览器（无 `DecompressionStream`）白屏 → 不会白屏：`manifest.json` 保持明文，首屏能起，
    数据读取抛的是具名错误。要真支持这批浏览器只能回退不预压（多 11 MiB）（已验证 34）
26. 改了构建插件产物却没变、日志也没动 → 捕获组或键形态对不上导致 `transform` 空转；
    临时改成立功也打印，或拿真实源码单跑正则（见已验证 33）
27. mermaid 图型不出图却显示源码 + 「未打包」 → 这是设计：白名单外类型走 `fail()` 回退支，内容不丢（见已验证 37）；
    白名单内的 5 类也这样，才是分包真的缺了

批 7 渲染层新增三条，同一顺序继续往后接：

28. 阴影断言必红但画面没错 → 先看 census 的 `shadow.requested` 与 `shadowPass`：requested 是 Soft 而有效类型是 PCF 属正常
    （已验证 39），`shadowPass=0` 才是真没投影；再确认主光俯角（已验证 40）
29. 帧率比批 6 低一档 → 依次关 bloom 内部分辨率（已验证 42）、恢复阴影烘一次（已验证 41）、看 DPR 是否被 composer 忽略，
    三步各有独立 A/B 数字，别一起改
30. 立柱像一根针 / 光点糊成一团 → 先量比例再改几何：立柱单位半径 0.6–1.0 对展台半径 10 必须靠实例缩放（`COLUMN_GIRTH`），
    光点尺寸上限压到 `1.5+1.15·√t` 并把环半径推到 4.3，否则会与柱体重叠
