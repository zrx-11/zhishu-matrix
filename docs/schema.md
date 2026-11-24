# 数据契约

`tools/extract.py` 产出这套结构，前端只读。改格式先改抽取器，不要手改 JSON。

## 一、单站文件 `data/sites/{repo}.json`

```json
{
  "repo": "hello-ai-zhishu",
  "title": "Hello, AI · 人工智能导论",
  "discipline": "ai",
  "homepage": "https://zrx-11.github.io/hello-ai-zhishu/",
  "contentLevel": "full",
  "stats": {
    "chapters": 20,
    "concepts": 50,
    "quizzes": 60,
    "cards": 70,
    "glossary": 110
  },
  "chapters": [],
  "concepts": [],
  "quizzes": [],
  "cards": [],
  "glossary": []
}
```

示例数字取 2026-11-24 probe 实测：`chapters` 为 **20**，`docs/sites.md` 原记 14 已按实测修正〔M〕。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| repo | string | 是 | GitHub 仓库名，唯一键 |
| title | string | 是 | 站点显示名 |
| discipline | enum | 是 | `math` / `ai` / `chem` / `cs` / `general` / `tools` |
| homepage | string | 否 | 已部署的 Pages 地址，无则空串 |
| contentLevel | enum | 是 | `full` / `degraded` / `stats-only`，正文分级，见第三节；由抽取器判定，禁止手改 |
| stats | object | 是 | 计数，抽不到填 0；与实际数组长度不一致时以数组长度为准 |
| chapters | array | 是 | 章节，可为空 |
| concepts | array | 是 | 概念，可为空 |
| quizzes | array | 是 | 题目，可为空 |
| cards | array | 是 | 抽认卡，可为空 |
| glossary | array | 是 | 术语，可为空 |

### chapters[]

```json
{
  "id": "ch01",
  "num": 1,
  "title": "什么是人工智能",
  "core": "一句话核心",
  "minutes": 30,
  "bodyType": "md",
  "body": "Markdown 正文，公式为 $...$",
  "conceptIds": ["c01"],
  "quizIds": ["q01"],
  "origin": {"repo": "hello-ai-zhishu", "path": "01-Hello-AI人工智能导论/chapters/ch01.md"},
  "bookSource": {"file": "hello-ai.pdf", "page": "6–15"}
}
```

字段来源与实测（2026-11-24 probe）：

- **`origin` 取代原 `source`**。实测 `manifest.json` 的 `chapters[].source` 已被占用为「原书出处」对象，
  统一 schema 不能同名，故抽取来源改叫 `origin{repo, path}`，原书出处原样承接为 `bookSource`〔M〕。
  `path` 是仓库内相对路径，含 manifest 所在目录段（hello-ai 是 `01-Hello-AI人工智能导论/…`），缺失时填空串。
- **`bookSource` 不规范化**：`page` 三站形态不一 —— hello-ai 是区间字符串 `"6–15"`、math-physical 该键缺失、
  sudoku 是整数 `0`〔M〕。原样存，前端按有无显示。
- **`bodyType`**：`md` | `html`。`contentLevel: full` 的站取 `.md` 原文，为 `md`；只有内联正文的站是 HTML 片段，为 `html`（见第三节）。
- **`body`** 保留原始 Markdown 与公式定界符原文，不做 HTML 转换，渲染在前端做。
- **`num`** 由 `id` 解析，不假定从 1 起：math-physical 首章 id 是 `ch00`〔M〕。
- **`core`** 覆盖率不一：hello-ai 20/20 有，math-physical 与 sudoku 均无〔M〕，缺失填 `""`，不得由标题臆造。
- **`minutes`** 是 int 或 **`null`，绝不是 0**：sudoku 的 `minutes` 本身就是 int（30/40/35…）可直接用；
  hello-ai 的 `hours` **全是字符串**，其中 11/20 是纯数字串（`"2"`、`"3"`）可 `× 60`，9/20 是区间串（`"1–2"`、`"2–3"`、`"3–4"`）
  **取不到单一数值 → `null`**，原样记入 `_report.json` 的 unmapped；math-physical 两键皆无 → `null`〔M〕。
  0 是合法时长值，用它占位等于谎报「这章 0 分钟」，禁止。

### concepts[]

```json
{
  "id": "c01",
  "title": "监督学习",
  "chapterIds": ["ch02"],
  "prerequisites": ["c03"],
  "brief": "一句话定义",
  "depth": "第一性原理推导正文，无则空串",
  "claims": [],
  "origin": {"repo": "hello-ai-zhishu", "path": "01-Hello-AI人工智能导论/concepts/c01.md"},
  "bookSource": {"file": "hello-ai.pdf", "page": "6"}
}
```

- **`brief`** 对应数据里的 `short`〔M〕；**`depth`** 对应数据里的 **`depthFragment`**〔M〕，抽取时改名，不改内容。
- **`depth` 实测很稀**：hello-ai 10/50 概念非空、合计 210B；math-physical 5/61、合计 113B；sudoku 无 `concepts` 数组〔M〕。
  概念详情层的「深度推导」区块按有无 `depth` 显示，不得留空壳占位。
- **`claims` 实测全空**：hello-ai 与 sudoku 顶层无该键，math-physical 有 `claims: []`、`misconceptions: []` 但长度为 0〔M〕。
  字段保留（向后兼容本地旧批次产物），当前三站一律输出 `[]`。

**`prerequisites` 是硬约束**：抽不到就留 `[]`，禁止推测填充。

> 原契约写的「旧版知枢产物普遍缺失此字段」在 probe 三站**不成立**，已按实测改写〔M〕：
> `concepts[].prerequisites` hello-ai 49/50、math-physical 58/61 非空（平均前置 1.35 / 1.41）；
> `chapters[].prerequisites` 三站 19/20、13/14、15/16 非空；sudoku 内联版键名为 **`prereq`**〔N〕。
> 真实缺口在本地旧批次（`pitfalls.md` 已验证 7）与未探到的 44 站，不在已跑过知枢流水线的这批。
> 硬约束本身不变：抽不到留 `[]`，倒推诊断对无前置链的站降级显示。

### quizzes[]

```json
{
  "id": "q01",
  "chapterId": "ch01",
  "stem": "题干",
  "options": ["选项一", "选项二", "选项三", "选项四"],
  "answer": 1,
  "type": "single",
  "conceptId": "c01",
  "explain": "解析",
  "misconception": "选择该项的常见误解，无则空串"
}
```

**`answer` 是 int 索引，不是字母**：索引从 0 开始，对应 `options` 的原序，**前端不得重排选项**——
一排序，正确答案就指向别的选项了。实测三站 `quizzes[].answer` 全部为 int〔M〕，原契约写的 `"A"` 是错的。
字母只是显示层的事：渲染时按 `String.fromCharCode(65 + answer)` 现算。

- `stem` 对应数据里的 `question`〔M〕。
- `options` 长度实测：hello-ai 与 sudoku 全为 4，math-physical 有 3 选项题（同一站内 3/4 混合）〔M〕。所以 `answer` 只能按索引解释，不能按「A–D 恒定四个」假设。
- `type` 实测三站只有 `"single"`〔M〕，字段保留以备其余 44 站出现多选/判断。
- `conceptId` 对应数据里的 `relatedConceptId`，三站全覆盖（60/60、100/100、54/54）〔M〕，题目↔概念的边靠它。
- `misconception` 实测三站 **0 条**有值〔M〕，`explain` 全部有值〔M〕。误解字段先留契约位，诊断链不要用。
- `id` 有两套命名空间：`manifest.json` 里是 `q01`，`index.html` 内联副本里是 `ch00-q01`〔M〕〔N〕。统一以 **manifest 文件侧**为准，见 `pitfalls.md` 已验证 12。

### cards[]

```json
{"id": "k01", "front": "正面", "back": "背面", "chapterId": "ch01", "tags": ["标签"]}
```

实测 `flashcards[]` 键为 `id,chapterId,front,back,tags`〔M〕，映射到统一 schema 的 `cards[]`（改名 + 保留 `tags`）。
下划线前缀的内部键（math-physical 有 `_added`〔M〕）不进契约，抽取时丢弃并记入 `_report.json`。
sudoku 的内联版卡片键为 `front,back,lesson`〔N〕——`lesson` 即 `chapterId`，见第四节别名表。

### glossary[]

```json
{"term": "监督学习", "en": "", "def": "白话定义", "chapterIds": ["ch02"]}
```

实测三站术语表键均为 `term,def,chapterId`〔M〕：

- `chapterId` 是 **str**，统一 schema 要 `chapterIds` 数组 → 抽取时包成单元素数组。
- `en` 三站均未探到〔M〕，字段保留、一律输出空串，不得由 `term` 臆译。

## 二、合并索引 `data/manifest.json`

```json
{
  "generatedAt": "ISO8601",
  "generator": "tools/extract.py",
  "schemaVersion": 2,
  "totals": {"sites": 47, "chapters": 648, "concepts": 415, "quizzes": 2700, "cards": 2200, "glossary": 1458},
  "contentLevels": {"full": 0, "degraded": 0, "stats-only": 0},
  "disciplines": [
    {"key": "math", "title": "数学", "siteCount": 12}
  ],
  "sites": [
    {"repo": "hello-ai-zhishu", "title": "Hello, AI", "discipline": "ai", "file": "sites/hello-ai-zhishu.json", "contentLevel": "full", "stats": {}}
  ],
  "failures": [
    {"repo": "SVM", "reason": "无说明文件，无 manifest.json"}
  ]
}
```

`totals` 由抽取器实算，不写死；`contentLevels` 是三档分级的站数汇总，同样实算，`full + degraded + stats-only` 必须等于 `totals.sites`。

**schemaVersion 1 → 2 的变更**（2026-11-24，依据 `docs/probe-report.md` 第八节回填）：

1. 章节与概念的 `source{repo,path}` 更名 `origin{repo,path}`，原书出处新增 `bookSource`；
2. 新增站点级 `contentLevel` 与索引级 `contentLevels`；
3. 新增 `chapters[].bodyType`（`md` / `html`）；
4. `quizzes[].answer` 由字母改 **int 索引**（实测三站均为 int）；
5. `concepts[].depth` 明确对应数据字段 `depthFragment`，`concepts[].claims` 保留但实测恒空；
6. 新增 `chapters[].minutes`（int 或 `null`，禁止用 0 占位）与 `quizzes[].conceptId`（← `relatedConceptId`）。

`data/manifest.json` 的空壳一并标 `schemaVersion: 2`：版本号描述结构契约，不描述数据完整度，
空数组也是 v2 结构；留 1 会让读取方走错分支。

## 三、抽取优先级与正文分级

对每个仓库按顺序尝试，命中即停：

1. 根目录 `manifest.json` —— 实测 sudoku 命中〔T〕
2. 各子目录下的 `manifest.json`（如 `hello-ai-zhishu/01-Hello-AI人工智能导论/manifest.json`）—— 实测 hello-ai、math-physical 命中〔T〕
3. `index.html` 内联数据常量 —— 实测形态比原设想具体：两站是 `BOOKS = { "<slug>": { manifest, rendered, nav, quizCoverage } }`（纯 JSON），
   sudoku 是 `ZS.lessons` / `ZS.quizzes` / `ZS.CARDS` / `ZS.GLOSSARY` 的 JS 字面量（无引号键、模板串、注释、尾逗号）〔P〕〔N〕
4. `交付说明.md` / `README.md` 的文本描述（只能拿到计数，拿不到正文）

优先级 3 的两站内联数据**不能直接当正文**：`BOOKS[slug].manifest` 是 manifest 的另一份拷贝，
`BOOKS[slug].rendered` 是渲染完的成品 HTML —— 公式在生成时已烤成 KaTeX 节点，原始定界符取不回来〔H〕。
只有 sudoku 的 `ZS.lessons[].body` 是可读的正文，且是 HTML 片段而非 Markdown〔N〕。

### contentLevel 三档

| 级别 | 判定条件 | 正文形态 | 实测样本 |
|---|---|---|---|
| `full` | manifest 解析成功 **且** `chapters[].file` 指向的 `.md` 源文件在树中存在 → 回读 Markdown | `bodyType: "md"`，公式定界符原文完整 | hello-ai（20 章全有 `file`）、math-physical（14 章全有 `file`）〔M〕〔T〕 |
| `degraded` | manifest 解析成功，但无 `.md` 源文件可回读，只有内联 `rendered` / `ZS.*` 正文 | `bodyType: "html"`，**公式不可还原**，页面须标「正文为成品 HTML，公式不可还原」 | sudoku（`chapters[].file` 0/16）〔M〕 |
| `stats-only` | 只有计数（优先级 4，或 manifest 解析失败） | 无正文，点节点跳原站 Pages | 未探到（本轮三站均在 `full`/`degraded`） |

判定权在抽取器，结果写进 `data/sites/{repo}.json` 与 `_report.json`，前端只读。
`degraded` / `stats-only` 的站照常进 3D 拓扑与检索，但**不得伪装成正文可读**，也不得用 AI 现场生成填空（生成内容另标「AI 现场生成 · 未经校验」，不进依赖图）。

### 正文回读策略

`full` 站的正文靠二次抓取 `.md`，与结构数据的抓取是分开的两件事：

- **走 raw，不计 API 限额**：`raw.githubusercontent.com` 无 60 次/小时的授权限额；GitHub trees API 只在探路阶段用，全量阶段禁用（见 `tools/README.md`）。
- **3 并发限速**：并发上限 3，请求间隔与失败退避由抽取器控，不打满 raw 的边缘节点。
- **一律走 `_work/cache/`**：按 `sha1(url)` 落盘，重复抓同一文件不重发请求；`--no-cache` 才强制重抓。
- **断点续传**：已成功回读的路径记在 `_work/state/`，中断后重跑只补未完成的，不从头再来。
- **路径拼接**：`chapters[].file` 是相对 manifest 所在目录的，须先取目录段再拼（hello-ai 是 `01-Hello-AI人工智能导论/chapters/ch01.md`）〔M〕〔T〕。
- **量级**：实测 hello-ai 子目录 86 个 `.md` 共 359,431B、math-physical 87 个共 579,403B〔T〕；契约层只需回读 `chapters` + `concepts` 指向的文件，约 70–75 个/站。

## 四、字段别名与类型转换

三站 manifest 的结构高度同构，差异集中在键名与类型，故**一个解析器 + 一张别名表**即可覆盖（判据见 `probe-report.md` 第七节）。

| 统一 schema | 数据里的键 | 转换 | 实测 |
|---|---|---|---|
| `chapters[].core` | `core` | 缺失填 `""` | hello-ai 20/20、math-physical 0/14、sudoku 0/16〔M〕 |
| `chapters[].num` | `id` | 取 id 尾部数字，不假定起点 | 首章 id `ch01` / `ch00` / `ch01`〔M〕 |
| `chapters[].conceptIds` | `concepts` | 重命名 | sudoku 16/16 用 `concepts`〔M〕 |
| `chapters[].minutes` | `hours` / `minutes` | sudoku 直接用；hello-ai `hours` 是 str，纯数字串 `× 60`，区间串与非数值一律 `null` | `hours` 20/20 为 str（11 纯数字 + 9 区间）、sudoku `minutes` 16/16 为 int、math-physical 两者皆无〔M〕 |
| `concepts[].brief` | `short` | 重命名 | 两站均有 concepts〔M〕 |
| `concepts[].depth` | `depthFragment` | 重命名，内容不动 | 非空 10/50、5/61〔M〕 |
| `concepts[].prerequisites` | `prereq` | 重命名 | sudoku 内联版用 `prereq`〔N〕 |
| `cards[]` | `flashcards` | 数组改名 | 三站顶层均为 `flashcards`〔M〕 |
| `quizzes[].stem` | `question` | 重命名 | 三站〔M〕 |
| `quizzes[].conceptId` | `relatedConceptId` | 重命名 | 60/60、100/100、54/54〔M〕 |
| `glossary[].chapterIds` | `chapterId`: str | 包成单元素数组 | 三站均为 str〔M〕 |
| `origin` + `bookSource` | `source`（原书出处） | 拆开：仓库路径新建 `origin`，出处对象保留 `bookSource` | 三站 `source` 均为对象〔M〕 |

别名表未覆盖的键名一律记入 `_report.json`，不猜、不静默丢弃。

## 五、容错

- 任一站点解析失败不中断整体，记录到 `data/_report.json`
- 字段类型不符（如 `chapters` 是对象而非数组）时尝试转换，转换失败按空处理
- **空值的两种写法不能混**：文本字段缺失填 `""`，数值与可空字段缺失填 `null`，**不得用 `0` 占位**；
  原始值存在但解析不出合法数值（如 `hours: "1–2"`）同样填 `null`，并把原值记入 `_report.json` 的 unmapped，不得静默变 0
- 计数与实际数组长度不一致时，以数组长度为准，差异记入 `_report.json`
- `contentLevel` 判定不出来时按最低档 `stats-only` 落库，并在 `_report.json` 写明卡在哪一步——宁可少给正文，不可标成 `full` 却给不出可读正文
- 内联正文依赖 Node 求值的站（sudoku），Node 不可用时降为 `stats-only` 并在 `_report.json` 记原因，不自动安装运行环境
- 回读 `.md` 中断后靠 `_work/state/` 续跑，已入库的正文不覆盖为更差的结果

## 六、分片

前端不加载整个库。按 `discipline` 切成 6 个分片，进房间时只加载该分片：

```
data/dist/math.json     # 数学房间全部站点合并
data/dist/ai.json
data/dist/chem.json
data/dist/cs.json
data/dist/general.json
data/dist/tools.json
```

分片由 `tools/extract.py` 一并生成，单个分片目标 < 2MB。

`full` 站回读正文后体积会明显上涨：实测两站子目录内全部 `.md` 分别 359,431B 与 579,403B〔T〕，
契约只取 `chapters`/`concepts` 指向的文件，量级仍在这个数附近。批 1 出全量数据后需重算 2MB 目标是否成立，
不成立就改成「按站再切一层」，而不是砍正文。
