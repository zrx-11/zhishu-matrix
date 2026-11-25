# 数据契约

`tools/extract.py` 产出这套结构，前端只读。改格式先改抽取器，不要手改 JSON。

来源标记沿用 `docs/probe-report.md` 〇节的图例：〔M〕manifest 原文、〔T〕trees API、〔H〕index.html、
〔N〕Node 求值、〔P〕probe 输出、〔C〕缓存副本统计、〔K〕50 仓 clone 扫描。
新增 **〔X〕= 批 1 首跑 `tools/extract.py --all --bodies` 的产出实测**（写在 `_work/data-dry/`，未入 `data/`）。

## 一、单书文件 `data/sites/{...}.json`

**一条 `sites` 记录 = 一本书，不是一个仓库。** 2026-11-25 对 50 个本地 clone 全量扫描：
仓库 50 个，`manifest.json` 却有 **131 份**，分布在 **25 个站**里（另 25 站没有 `manifest.json`）；
14 个站是多书合集——`ai-architecture-handbook` 39 份、`math-basics-enlighten` 24 份、`first-push-enlighten` 11 份、
`chem-zhishu` 8 份、`ode-enlighten` 7 份、`taocp-enlighten` 6 份、`ai-ml-dl-rl-enlighten` 5 份、`algorithm-enlighten`
与 `food-zhishu` 各 4 份、`MATH` 与 `analysis-handbook` 各 3 份、`ai-enlighten`、`economics-principles-handbook`、
`math-analysis` 各 2 份。所以一个仓库一份文件装不下，改成下面这个形态〔K〕。

### 文件名规则

| 情况 | 文件名 | 说明 |
|---|---|---|
| 单书仓库（该 repo 只有 1 份 `manifest.json`） | `data/sites/{repo}.json` | **保持原样，不加后缀**，存量命名不重排 |
| 多书仓库（2 份及以上） | `data/sites/{repo}--{slug}.json` | `slug` 见下节；`{repo}` 与 `{slug}` 之间是**两个连字符** |

### `slug` 取值（顺序固定，不可自行发挥）

1. **优先取 manifest 内的书标识**：实测字段是顶层 `slug`〔M〕（hello-ai 是 `hello-ai`、math-physical 是
   `math-physical-methods`、sudoku 是 `sudoku-zhishu`——注意 slug 与仓库名不保证相同）。
2. 该键缺失或为空 → **用 manifest 所在目录名**（如 `01-高等数学-食品专业版`）。
3. 两者都为空 → **用序号** `b01`、`b02`…（按目录名排序后的位次）。

**同一 repo 下 slug 冲突必须报错**：文件名会撞，静默覆盖等于丢一整本书。处置是记入 `data/_report.json` 的
`slugCollisions` 并**跳过该本**（不覆盖已写出的文件），批 1 人工改名后重跑。目录名带中文与空格，写文件前逐段
清洗（保留中日韩与字母数字，其余转 `-`），清洗后同名同样算冲突。

```json
{
  "repo": "hello-ai-zhishu",
  "bookSlug": "hello-ai",
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
`homepage` 是**仓库级**属性，同一 repo 的多本书共用；书的独立部署地址若 manifest 里有（如 sudoku 顶层 `site.entry`）另存入 `bookHomepage`。

### 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| repo | string | 是 | GitHub 仓库名；**不再唯一**，唯一键是 `repo + bookSlug` |
| bookSlug | string | 是 | 书名标识，取值顺序见上节；单书仓库也要填（取 manifest 的 `slug`，无则用目录名/序号） |
| title | string | 是 | 该书记显示名（不是仓库名） |
| discipline | enum | 是 | `math` / `ai` / `chem` / `cs` / `general` / `tools` |
| homepage | string | 否 | 仓库的 Pages 地址，无则空串 |
| contentLevel | enum | 是 | `full` / `degraded` / `stats-only`，**逐本判定**，同一仓库内可以不同；见第三节 |
| stats | object | 是 | 计数，抽不到填 0；与实际数组长度不一致时以数组长度为准 |
| chapters | array | 是 | 章节，可为空 |
| concepts | array | 是 | 概念，可为空 |
| quizzes | array | 是 | 题目，可为空 |
| cards | array | 是 | 抽认卡，可为空 |
| glossary | array | 是 | 术语，可为空 |

### 抽取器附带的元数据字段（非展示用，前端可忽略）

| 字段 | 类型 | 说明 |
|---|---|---|
| manifestPath | string | 该书 `manifest.json` 在仓库内的相对路径，回溯与重跑定位用 |
| file | string | **只出现在 `data/manifest.json` 的 `sites[].file`**，写单书文件时被弹出，不进 `data/sites/*.json` |
| bodyCount | object | `{chapters, concepts}` 实际读到正文的条目数，`full` 判定的依据〔X〕 |
| signature | string | 书名 + 章节 id 序列 + 计数 的 sha1 前 12 位，跨仓查重用 |
| duplicateGroup | string | 仅同签名组出现，值即 `signature`；配 `mirroredFrom` 标 canonical |
| sourceKeys | object | 五类数组在源数据里实际命中的键名（如 `cards ← flashcards`），别名表回归对照 |

这些字段是**产出侧的记录**，不参与渲染契约；改名要同步 `verify_data.py` 与 `_report.json`。

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
- **`bookSource` 保留原始形态、不做类型归一**：`page` 三站形态不一 —— hello-ai 是区间字符串 `"6–15"`（en-dash，即上方示例）、
  math-physical 该键缺失、sudoku 是整数 `0`〔M〕。**不转数字、不补区间符、不填默认值**，原样存，前端按有无显示。
- **`bodyType`**：`md` | `html`。`contentLevel: full` 的站取 `.md` 原文，为 `md`；只有内联正文的站是 HTML 片段，为 `html`（见第三节）。
- **`body`** 保留原始 Markdown 与公式定界符原文，不做 HTML 转换，渲染在前端做。
  定界符两种形态都要保住：`$...$` 与 `\(...\)`（`kaoyan` 台账文本里前者 149 处、后者 332 处〔K〕）——
  抽取端不改写，KaTeX 端 `inlineMath` 两项都开，见铁律渲染节。
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

**`answer` 的形态由 `type` 决定，索引一律 0 基、对应 `options` 原序，前端不得重排选项**——一排序，
正确答案就指向别的选项了。131 份 manifest 全量实测（批 1 首跑，3,541 题）〔X〕：

| `type` | 题数 | `options` | `answer` | 说明 |
|---|---|---|---|---|
| `single` | 3,298 | 2 / 3 / 4 项混合 | **int 索引** | 主形态；字母只在显示层现算 `String.fromCharCode(65 + answer)` |
| `blank` | 157 | 空数组 | **str 答案文本**（如 `"3/11"`、`"费马"`、`"θ"`） | 填空题，无选项可索引；保留字符串原形，别把 `"03"` 变 3 |
| `multi` | 86 | 4 项 | **list[int]** 索引数组（如 `[0,1,2]`） | 多选题，判题要集合相等而非单值比较 |

`answer` 为 `null` 的情况批 1 首跑是 **0 条**——解析不出时按 `null` 落库并记 `_report.json`，但实测全部可归一。
原契约写的 `"answer": "A"` 与「三站全为 int」都是样本错觉：`type` 实测有三种而非只有 `single`〔X〕。

- `options` 长度实测分布：4 项 3,120 · 3 项 225 · 2 项 47 · 0 项 157（填空）〔X〕。判题组件必须按数组长度渲染。
- `stem` 对应数据里的 `question`〔M〕。
- `conceptId` 对应数据里的 `relatedConceptId`，三站全覆盖（60/60、100/100、54/54）〔M〕，题目↔概念的边靠它。
- `misconception` 实测三站 **0 条**有值〔M〕，`explain` 全部有值〔M〕。**批 3 的「选项常见误解提示」无库内数据支撑，
  只能砍掉或改走 AI 现场生成（另标「AI 现场生成 · 未经校验」、不进诊断链）；诊断链的唯一可用路径是
  「答错 → 沿 `prerequisites` 倒推根因」**——依据见 `probe-report.md` 八之二。
- `id` 有两套命名空间：`manifest.json` 里是 `q01`，`index.html` 内联副本里是 `ch00-q01`〔M〕〔N〕。统一以 **manifest 文件侧**为准，见 `pitfalls.md` 已验证 12。

**`id` 只在书内唯一**：`ch01`、`c01`、`q01` 这种 id 在同一仓库的多本书之间**必然重复**（实测每个子目录的
manifest 都从 `ch01` 起〔K〕）。所以跨书引用与前端索引一律用三段键 `{repo}::{bookSlug}::{id}`，
`origin.path` 必须带子目录段，否则 24 本的 `math-basics-enlighten` 会把章节 id 全部撞在一起。

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
  "totals": {"repos": 50, "sites": 131, "chapters": 648, "concepts": 415, "quizzes": 2700, "cards": 2200, "glossary": 1458},
  "contentLevels": {"full": 0, "degraded": 0, "stats-only": 0},
  "disciplines": [
    {"key": "math", "title": "数学", "repoCount": 17, "siteCount": 62}
  ],
  "sites": [
    {"repo": "hello-ai-zhishu", "bookSlug": "hello-ai", "title": "Hello, AI", "discipline": "ai", "file": "sites/hello-ai-zhishu.json", "contentLevel": "full", "stats": {}},
    {"repo": "chem-zhishu", "bookSlug": "01-零基础入门", "title": "零基础入门化学", "discipline": "chem", "file": "sites/chem-zhishu--01-零基础入门.json", "contentLevel": "full", "stats": {}}
  ],
  "failures": [
    {"repo": "SVM", "bookSlug": null, "reason": "无说明文件，无 manifest.json"}
  ],
  "slugCollisions": [
    {"repo": "example", "slug": "b01", "paths": ["01-X/manifest.json", "02-Y/manifest.json"], "action": "skipped"}
  ]
}
```

**`totals` 拆两个字段，含义不同，不可互相顶替**：

| 字段 | 含义 | 取值 |
|---|---|---|
| `totals.repos` | **仓库总数** | 50（`_work/site_repos.json` 全集，含跳过的站） |
| `totals.sites` | **实际产出的书条目数** | 等于成功写出的 `data/sites/*.json` 份数，上限是实测的 131 份 manifest〔K〕，**不填 50、不填 47**；批 1 首跑实测 **129**〔X〕 |
| `totals.sitesUnique` | **去重后的独书数** | 同一本书会被多个仓库收录，见下节；定稿跑 129 条里只有 **96** 本是独书〔X〕 |

**跨仓库重复必须显式处理，不能当两本书用**。定稿实测：131 份 manifest 里有 **33 组内容同书**（66 本带 `duplicateGroup`）〔X〕——
`ai-architecture-handbook` 是聚合仓，把 `math-basics-enlighten` 的 24 本、`agentic-design-patterns-handbook` 与
`neural-net-zero` 各 1 本原样重收了一份（signature 由 书名 + 章节 id 序列 + 计数 取 sha1）。规则：

- 抽取器给每本算 `signature` = sha1(**章节 id 序列 + 五类计数 + 正文哈希**)，同组的都写 `duplicateGroup` 字段，
  **签名里不含 `title`**：聚合仓常给书改名——`ai-architecture-handbook` 把 hello-ai 叫「AI 导论：Hello, AI」，
  章节 id 与计数完全一致，含 title 的旧算法会漏判（103/26 组 → 96/33 组，就是改键后的差值）〔X〕。
  条目全部保留（前端要按仓库入口进原书），但 `totals.sitesUnique` 与 3D 大厅的展台数一律用去重后的数；
- **canonical 归属**：同组里优先「书名与该仓库主题一致」的那条（`math-basics-enlighten` 为 canonical，
  `ai-architecture-handbook` 里的副本标 `mirroredFrom`），无法判定时取章节数多者；
- 依赖图的节点用 canonical，避免同一知识点在星图上出现两个点；检索层可以去重展示但计数要说明。

**归档副本不算一本书**：路径含 `_archive`、`_backup`、`旧版` 的 `manifest.json` 一律排除并记
`_report.json` 的 `excludedManifests`〔X〕（实测 `chem-zhishu` 有 2 份 `_archive/` 旧版，
不排除就会撞 slug 并产出假的「题库」条目）。

`contentLevels` 三档是**按书计**的条数汇总，`full + degraded + stats-only` 必须等于 `totals.sites`；
`disciplines[].siteCount` 同样按书计，另加按仓库计的 `repoCount`，两者并存（实测 50 仓 = 131 本，
一个学科内两数可差数倍〔K〕）。`failures[]` 一条 = 一个失败单元，无 manifest 的仓库级失败 `bookSlug` 填 `null`，
某本书解析失败则填该书 slug——**`totals.sites + failures + slugCollisions 跳过量` 不足 131 的差额即「未处理」，批 1 要显式列出**。

`schemaVersion` 仍为 **2**：v2 尚未产出任何数据文件，本次是把 v2 定稿（`sites` 语义由「站」改「书」、
`totals` 拆 `repos`/`sites`、新增 `slugCollisions`），不另升 v3。升版只在有消费方之后发生。

**schemaVersion 1 → 2 的变更**（2026-11-24 起，依据 `docs/probe-report.md` 第八节与八之二节回填）：

1. 章节与概念的 `source{repo,path}` 更名 `origin{repo,path}`，原书出处新增 `bookSource`；
2. 新增站点级 `contentLevel` 与索引级 `contentLevels`；
3. 新增 `chapters[].bodyType`（`md` / `html`）；
4. `quizzes[].answer` 由字母改 **int 索引**（实测三站均为 int）；
5. `concepts[].depth` 明确对应数据字段 `depthFragment`，`concepts[].claims` 保留但实测恒空；
6. 新增 `chapters[].minutes`（int 或 `null`，禁止用 0 占位）与 `quizzes[].conceptId`（← `relatedConceptId`）；
7. 2026-11-25 定稿：`sites` 条目 = 一本书而非一个仓库，新增 `bookSlug` 与 `totals.repos`，`id` 键空间降为书内唯一。

`data/manifest.json` 的空壳一并标 `schemaVersion: 2`：版本号描述结构契约，不描述数据完整度，
空数组也是 v2 结构；留 1 会让读取方走错分支。

## 三、抽取优先级与正文分级

**抽取单元是「一份 manifest = 一本书」**，不是仓库。对每份 manifest 按顺序尝试，命中即停：

1. 根目录 `manifest.json` —— 实测 50 站里只有 2 个站在根目录（`neural-net-zero`、`sudoku-zhishu`）〔K〕
2. 子目录下的 `manifest.json` —— 实测 **100 份在一级子目录、29 份在二级**（如 `math-analysis/book/01-数学分析上册/manifest.json`）〔K〕；
   候选路径表必须覆盖两层，只试一层会白漏 29 本
3. `index.html` 内联数据常量 —— 实测形态比原设想具体：两站是 `BOOKS = { "<slug>": { manifest, rendered, nav, quizCoverage } }`（纯 JSON），
   sudoku 是 `ZS.lessons` / `ZS.quizzes` / `ZS.CARDS` / `ZS.GLOSSARY` 的 JS 字面量（无引号键、模板串、注释、尾逗号）〔P〕〔N〕
4. `交付说明.md` / `README.md` 的文本描述（只能拿到计数，拿不到正文）

**实测 50 站里有 25 站根本没有 `manifest.json`**〔K〕，只能落到优先级 3 或 4。其中
`AI-Study-Notes`（104 个 `.md`、0 个 `.json`）与 `exam-solver`（350 个 `.md`、0 个 `.json`）有大量 Markdown 却不是知枢结构，
`CourseVault-OfflineCourseMap` 有 1,159 个 `.json` 却是课程目录——**结构不同构，不得硬套 manifest 解析器**，按 `stats-only` 落库并记原因。

优先级 3 的两站内联数据**不能直接当正文**：`BOOKS[slug].manifest` 是 manifest 的另一份拷贝，
`BOOKS[slug].rendered` 是渲染完的成品 HTML —— 公式在生成时已烤成 KaTeX 节点，原始定界符取不回来〔H〕。
只有 sudoku 的 `ZS.lessons[].body` 是可读的正文，且是 HTML 片段而非 Markdown〔N〕。

### contentLevel 三档

| 级别 | 判定条件 | 正文形态 | 实测样本 |
|---|---|---|---|
| `full` | manifest 解析成功 **且** `chapters[].file` 指向的 `.md` 源文件存在 → 读 Markdown | `bodyType: "md"`，公式定界符原文完整 | hello-ai（20 章全有 `file`）、math-physical（14 章全有 `file`）〔M〕〔T〕；50 站按树内文件粗判 **24 站为 full 候选**〔K〕 |
| `degraded` | manifest 解析成功，但无 `.md` 源文件可回读，只有内联 `rendered` / `ZS.*` 正文——**语义是「可做题、无或极少可读正文」** | `bodyType: "html"`，**公式不可还原**，页面须标「正文为成品 HTML，公式不可还原」 | sudoku（`chapters[].file` 0/16，但 16/16 章有内联 HTML 正文 + 54 道题）〔M〕〔X〕 |
| `stats-only` | 只有计数（优先级 4、无 manifest，或 manifest 解析失败） | 无正文，点节点跳原站 Pages | 实测 **20 站连 manifest 与成量 `.md` 都没有**；含 `ACM-XCPC-Notes`——481MB、3,153 条目，`.md` 只有 1 个、`.json` 只有 1 个，正文实为 135 个 `.html` 与 40 个 `.txt`〔K〕 |

判定权在抽取器，结果**逐本**写进 `data/sites/….json` 与 `_report.json`，前端只读；同一仓库内各书的 `contentLevel` 可以不同。
`degraded` / `stats-only` 的书照常进 3D 拓扑与检索，但**不得伪装成正文可读**，也不得用 AI 现场生成填空（生成内容另标「AI 现场生成 · 未经校验」，不进依赖图）。

批 1 首跑按书计的实测分布（129 条）〔X〕：**`full` 128 · `degraded` 1 · `stats-only` 0**——
唯一 degraded 是 sudoku；那 25 个没有 `manifest.json` 的站**不进 `sites[]`，而是整体落 `failures`**
（`contentLevel: stats-only` 写在 failure 记录里），所以索引里的 `contentLevels` 之和等于 `totals.sites` 而不含失败站。
章正文实际读到 **1,153 / 1,169** 章，`full` 判定用「真读到正文」而不是「manifest 声明了 `file`」〔X〕。

**别把「有数据文件」当成 `degraded`**：`kaoyan-math-66000` 一度被预判为「有题无正文 → degraded」，
把 `*.csv`/`*.txt` 拉下来才发现它的 19 个 csv（3,613 行）是 `q,page,verdict,note,time` 式的**校对台账**、
json 是流水线元数据，题面只在 201 个 `.html` 里而不拉——**所以它是 `stats-only`**〔K〕。
定档前先开两个数据文件看表头，别按扩展名猜（详见 `pitfalls.md` 已验证 14）。

### `_report.json` 必记字段

抽取器的判定过程要可复核，`data/_report.json` 至少含：

| 键 | 内容 |
|---|---|
| `totals` / `contentLevels` | 与 `manifest.json` 一致，用于对账 |
| `slugCollisions` | `{repo, slug, paths[], action}`，冲突跳过的书 |
| `excludedManifests` | `{repo, path}`，`_archive`/`_backup`/`旧版`/`deprecated` 路径下的 manifest（排除规则在 `extract.py` 顶部 `EXCLUDED_MANIFEST_PARTS`） |
| `duplicates` | `{signature, books[]}` 跨仓同书分组（定稿跑 33 组，66 本带 `duplicateGroup`） |
| `unmappedAndNotes` | `minutes` 取不到单一数值、编码异常、内联求值结果等逐条说明 |
| `links` / `externalLinks` | 白名单命中分类计数 + 真外链逐条（`origin` 路径、行号、上下文 160 字），`--link-policy` 记 keep/strip |
| `pendingSources` | 无 manifest 但有结构化文件的站，列出 `csv/txt/json/html/md` 计数与「需专用适配器」 |
| `rawFallback` | 兜底抓取次数、缓存命中、失败清单 |



### 正文来源与回读策略

**主路径是本地 clone，raw 是兜底**（2026-11-25 定：50 仓已按 `tools/README.md` 的三档策略克隆到 `_work/repos/`）：

- **本地优先**：`full` 书的正文直接读 `_work/repos/{repo}/{manifest 所在目录}/{chapters[].file}`，零请求、零限速、不需要断点续传。
- **raw 兜底**：仓库未克隆、克隆失败，或稀疏规则把正文目录挡掉时（实测 `CourseVault-OfflineCourseMap` 树内 1,179 个 `.md`/`.json` 只落地 1 个〔K〕），
  才退回 `raw.githubusercontent.com` 逐文件抓。raw 无 60 次/小时限额；trees API 全量阶段禁用。
- **兜底限速**：raw 路径 **3 并发**、走 `_work/cache/<sha1(url)>.bin`、断点记 `_work/state/fetch-state.json`；
  已成功的不重抓，已入库的正文不被更差结果覆盖。
- **路径拼接**：`chapters[].file` 是相对 manifest 所在目录的，须先取目录段再拼（hello-ai 是 `01-Hello-AI人工智能导论/chapters/ch01.md`）〔M〕〔T〕。
- **量级**：50 仓树内合计 `.md` 3,703 个、`.json` 1,457 个〔K〕；契约层只取 `chapters` + `concepts` 指向的文件。
  实测 hello-ai 子目录 86 个 `.md` 共 359,431B、math-physical 87 个共 579,403B〔T〕，即每本约 70–90 个文件。

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

分片由 `tools/extract.py` 一并生成，单个分片目标 < 2MB。**分片条目是书，不是仓库**：
实测最多 131 本落在 25 个站里〔K〕，一个学科房间可能同时挂几十本，`disciplines[].siteCount` 按书计即为此。

体积上「2MB」这个目标在**结构分片**里成立，靠的是把正文摘出去。批 1 首跑实测〔X〕：

| 分片 | 体积 | 内容 |
|---|---|---|
| `ai.json` | 1,637 KiB | 结构，无正文 |
| `math.json` | 1,124 KiB | 结构，无正文 |
| `general.json` | 574 KiB | 结构，无正文 |
| `cs.json` | 502 KiB | 结构，无正文 |
| `chem.json` | 477 KiB | 结构，无正文 |
| `bodies/*.json` | 合计 7.4 MiB（129 本） | 正文，点开才加载 |

所以定死的结构是：**结构进 discipline 分片，正文另存 `data/bodies/`**。之前按两本外推的「47–76MB」估算不成立——
实测每本正文平均只有约 60 KiB（章正文 1,153 条 + 概念正文），比 hello-ai/math-physical 的单本 360–580 KB 小一个量级，
因为多数书只回读 `chapters[].file` 指向的那几个 `.md`，不是子目录里全部 `.md`〔X〕。
上限保持「结构分片 < 2MB、单本正文 < 1MB」，超线继续细分片，**不许靠砍正文把数字做小**。
