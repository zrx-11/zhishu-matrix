# 踩坑清单

分两类：**已验证**（之前实际踩过并有解法）、**待验证**（这批站点可能遇到但没实测过）。

写代码时遇到渲染或抓取异常，先查这里。

## 一、已验证

### 1. 公式被写成反引号

旧版知枢产物把公式包在反引号里当行内代码，KaTeX 不渲染，页面上就是一段等宽字。

处理：抽取时把 `` `$...$` `` 与 `` `$$...$$` `` 剥掉外层反引号，交给 KaTeX。不要试图正则识别裸公式，误伤率高。

### 2. Mermaid 依赖 CDN

部分站点 Mermaid 走 CDN（优先 npmmirror，多源超时回退）。断网或 CDN 抽风时图不出来。

处理：全部 vendor 本地化，`vendor/mermaid.min.js`，不走任何远程源。

### 3. 离线内联不全（以及「零 CDN」这条禁令怎么落地）

所谓"单文件、断网可开"，实际常有漏网的远程字体或图标请求。

处理：构建后跑一次静态扫描，`grep` 出 `http://`、`https://`、`//cdn`，除白名单外必须为零。

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



## 二、待验证

编号保留原样，已定案的两条只留指针，免得旧引用（含 `probe-report.md` 第七、八节）对不上。

### 1. ~~1MB 单文件站点的内联数据能否稳定抽出~~ → 已定案

见「一、已验证」第 9 条。结论两半：数据抽得出（`BOOKS` 容器 846,220B 配平命中〔P〕）；
但内联正文是成品 HTML，KaTeX 节点 204 个、`alttext` 0、定界符 0，**原始 TeX 不可还原**〔H〕——正文一律回读 `.md`。

### 2. 40 站的版本差异范围（仍未定案，范围已缩小）

已知跨度 v1.0–v1.9。三站实测：章节字段名统一是 `title`，未出现 `name` / `heading`；原猜的 `DATA` / `__DATA__` 也未出现〔P〕。待铺开验证的是：

- 数据变量名：实测 `BOOKS`（多文件包与单文件大包均是）〔P〕、`ZS.*` 命名空间（sudoku）〔N〕
- 正文载体：外链 `.md` 还是内联字面量 —— 直接决定 `contentLevel` 落在 `full` 还是 `degraded`
- `depthFragment` 的有无与长度：三站非空 10/50、5/61、0〔M〕

批 1 逐站按这三项记 `_report.json`；只要有一站跳出上表，`schema.md` 第四节的别名表就要加行。

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
10. 站点标着 `full` 却读不到正文 → 查 `.md` 回读是否命中、路径有没有漏 manifest 的目录段（见已验证 12 与 `schema.md` 第三节）
