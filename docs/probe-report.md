# 探路报告 · 批 1 前置

`tools/extract.py --probe` 对 3 个代表站的实测结论。日期 2026-11-24 22:25（+0800）。
**本报告只写实测值。** 未抓、未验的一律写「未探到」，不填 0、不写「无」。

## 〇、来源标记

后文每个数字后面的方括号是出处，全部可复现。

| 标记 | 出处 |
|---|---|
| 〔T〕 | `https://api.github.com/repos/zrx-11/{repo}/git/trees/main?recursive=1` |
| 〔M〕 | `https://raw.githubusercontent.com/zrx-11/{repo}/main/{manifest 路径}` |
| 〔H〕 | `https://raw.githubusercontent.com/zrx-11/{repo}/main/index.html` |
| 〔D〕 | `…/main/交付说明.md` 或 `…/main/README.md` |
| 〔P〕 | `tools/extract.py --probe` 控制台输出（留存于 `_work/probe-console.txt`、`_work/probe-raw.json`） |
| 〔N〕 | `_work/sz_eval.js`：用 Node `new Function` 求值 sudoku 内联 JS 字面量 |
| 〔S〕 | 单文件抽样核查（`…/main/{子目录}/chapters/ch01.md`） |
| 〔C〕 | **`_work/cache/` 缓存副本统计，未经主流程复核**——由 `_work/backfill_stats.py` 直接读缓存里的 `manifest.json` 响应体计数，`--probe` 主流程不产出这些数字，仅用于第八之二节 |
| 〔K〕 | 2026-11-25 对 `_work/repos/` 下 50 个本地 clone 的只读扫描（`git ls-tree` / `config` / `count-objects` / 文件枚举），结果留存 `_work/clone_tier_audit.txt` 与 `_work/clone_tier_audit.json`；同样**不经 `extract.py` 主流程**，仅用于第十节 |
| 〔X〕 | 2026-11-25 批 1 首跑 `python tools/extract.py --all --bodies --out-dir _work/data-dry` 的产出实测（**未写 `data/`**），产出与 `_report.json` 留在 `_work/data-dry/`，用于第十一节 |

响应体缓存于 `_work/cache/<sha1(url)>.bin`，26 个条目〔P.cacheDir〕。

## 一、方法与请求量

| 站 | trees 状态 | 树内 blob | truncated | raw 文件 | raw 字节 |
|---|---|---|---|---|---|
| hello-ai-zhishu | 200〔T〕 | 133〔T〕 | False〔T〕 | 5〔P.budget〕 | 765,701〔P.budget〕 |
| sudoku-zhishu | 200〔T〕 | 46〔T〕 | False〔T〕 | 11〔P.budget〕 | 588,526〔P.budget〕 |
| math-physical-methods | 200〔T〕 | 120〔T〕 | False〔T〕 | 5〔P.budget〕 | 2,031,369〔P.budget〕 |

合计 3 次 trees + 21 次 raw = 24 请求，3,385,596 字节〔P.budget 求和〕；另有 2 次 `.md` 抽样〔S〕。

代理与编码：所有请求经 `build_opener(ProxyHandler({}))` 发出〔extract.py:OPENER〕；
中文路径逐段编码生效，例
`…/main/01-Hello-AI%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%AF%BC%E8%AE%BA/manifest.json` → HTTP 200〔M〕。
开/关系统代理的对照实验未做（未探到本机是否实际配置了代理）。

编码实测：21 个抓取文件全部 `utf-8` 严格解码成功，U+FFFD 计数 0〔P.encoding / P.replacementChars〕。
三站 `index.html` 均声明 `<meta charset=utf-8>`〔P.metaCharset〕。
`sudoku` 的 `src/content/*.js` 亦为 utf-8，**不是** GBK〔P.encoding〕。

## 二、数据落点对照

| | hello-ai-zhishu | sudoku-zhishu | math-physical-methods |
|---|---|---|---|
| manifest 路径 | `01-Hello-AI人工智能导论/manifest.json`〔M〕 | `manifest.json`（根目录）〔M〕 | `01-数学物理方法/manifest.json`〔M〕 |
| manifest 体积 | 125,370B〔M〕 | 55,190B〔M〕 | 125,159B〔M〕 |
| 根目录另有 manifest | 未探到（树内 manifest.json 只此 1 个）〔T〕 | — | 未探到〔T〕 |
| index.html 体积 | 627,587B〔M〕 | 276,953B〔M〕 | 1,887,845B〔M〕 |
| 正文载体 | `chapters/*.md` + `concepts/*.md`〔T〕 | `index.html` 与 `src/content/lessons-*.js` 内联 JS〔H〕〔N〕 | `chapters/*.md` + `concepts/*.md`〔T〕 |
| 内联主容器变量名 | `BOOKS`〔H〕〔P〕 | `ZS.lessons` / `ZS.quizzes` / `ZS.CARDS` / `ZS.GLOSSARY` / `ZS.TECH_META` / `ZS.SEEDS` / `ZS.REFERENCES`〔H〕〔N〕 | `BOOKS`〔H〕〔P〕 |
| 内联容器体积 | 341,367B〔P〕 | 19,991 + 18,738 + 16,213 + 12,592 + …〔P〕 | 846,220B〔P〕 |
| 内联容器能否 `json.loads` | 能〔P.parse=json〕 | **不能**，JS 字面量〔P.parse=js-literal〕〔N〕 | 能〔P.parse=json〕 |
| `src/content/*.js` | 未探到（树内 .js 计数 0）〔T〕 | 5 个文件〔T〕 | 未探到〔T〕 |

`BOOKS` 的内部形状，两站一致〔H〕：

```
BOOKS = { "<slug>": { manifest, rendered, nav, quizCoverage } }
```

`rendered` 是按 id 索引的**渲染后 HTML**：hello-ai 98 个键、math-physical-methods 97 个键，
每站都含全部 `chNN` + 全部概念 id + `__path__`/`__graph__`/`__quiz_*__`/`__cards__`/`__glossary__`/
`__diagnosis__`/`__patterns__`/`__cheatsheet__` 等合成页〔H〕。

## 三、顶层字段对照（统一 schema ← 实际字段）

行数 = `docs/schema.md` 要求的字段。长度全部取数组实测长度〔M〕〔N〕。

| schema 字段 | hello-ai-zhishu | sudoku-zhishu | math-physical-methods |
|---|---|---|---|
| `repo` ← | 无此键，取路径段/`slug=hello-ai`〔M〕 | `slug=sudoku-zhishu`〔M〕 | `slug=math-physical-methods`〔M〕 |
| `title` | `title` = Hello, AI · 人工智能导论〔M〕 | `title` = 数独：从规则到链〔M〕 | `title` = 数学物理方法〔M〕 |
| `discipline` | manifest 未探到，需外部标注 | 同左 | 同左 |
| `chapters` | `chapters` 长度 **20**〔M〕 | `chapters` 长度 16〔M〕 + `ZS.lessons` 16〔N〕 | `chapters` 长度 **14**〔M〕 |
| `concepts` | `concepts` 长度 50〔M〕 | manifest 顶层未探到该数组；`ZS.TECH_META` 14 条〔N〕 | `concepts` 长度 61〔M〕 |
| `quizzes` | `quizzes` 长度 **60**〔M〕 | `quizzes` 长度 54〔M〕=`ZS.quizzes` 54〔N〕 | `quizzes` 长度 **100**〔M〕 |
| `cards` | **`flashcards`** 长度 70〔M〕 | **`flashcards`** 长度 34〔M〕=`ZS.CARDS` 34〔N〕 | **`flashcards`** 长度 120〔M〕 |
| `glossary` | `glossary` 长度 110〔M〕 | `glossary` 长度 43〔M〕=`ZS.GLOSSARY` 43〔N〕 | `glossary` 长度 63〔M〕 |
| 其余顶层键 | `slug,subtitle,book,audience,goal,learningPath(10),patterns,cheatsheet,companion`〔M〕 | `slug,subtitle,book,audience,goal,learningPath(16),site`〔M〕 | `slug,subtitle,companion,book,audience,goal,learningPath(15),patterns,cheatsheet,misconceptions(0),claims(0)`〔M〕 |

与 `docs/sites.md` 的偏差（该表数字取自说明文件正则扫描，2026-11-24）：

| 站 | sites.md | manifest 实测 | 结论 |
|---|---|---|---|
| hello-ai-zhishu | 章 14 | 20〔M〕 | sites.md 失真，应改 20 |
| math-physical-methods | 题 28 | 100〔M〕 | `交付说明.md` 里有「28 题 → 100 题」新旧对照行〔D〕，sites.md 抓的是旧列 |
| math-physical-methods | 卡 42 | 120〔M〕 | 同上 |
| math-physical-methods | 1,057KB 单文件 | index.html 1,887,845B〔M〕 | 站点已扩容 |
| math-physical-methods | 「正文只可能在内联数据里」 | 子目录下 87 个 `.md` 共 579,403B〔T〕 | 该判断不成立 |
| sudoku-zhishu | 16/54/34/43 | 16/54/34/43〔M〕 | 一致 |

## 四、元素字段对照

`chapters[]`〔M〕：

| | hello-ai | sudoku | math-physical |
|---|---|---|---|
| 键 | `id,title,file,difficulty,source,prerequisites,hours,part,core` | `id,title,difficulty,minutes,prerequisites,concepts,source` | `id,title,file,difficulty,source,prerequisites` |
| 正文指针 | `file` 20/20 有，值形如 `chapters/ch01.md` | `file` 未探到（0/16） | `file` 14/14 有，`chapters/ch00.md` 起 |
| 标题键 | `title` | `title` | `title`（三站一致，未见 `name`/`heading`） |
| 章节序号 | 键集合实测不含 `num`（`id` 已含 chNN）〔M〕 | 同左 | 同左；内联 `ZS.lessons` 有 `num`〔N〕 |

`concepts[]`〔M〕：hello-ai 键 `id,title,file,chapterIds,difficulty,source,prerequisites,short,depthFragment(部分)`；
math-physical 同构，但 `depthFragment` 只 5 个概念有、且**不带 `short`**。sudoku 顶层 concepts 数组未探到。

`quizzes[]`〔M〕〔N〕，三站同构度最高，但有 4 处必须转换：

| 项 | 实测 | schema 要求 |
|---|---|---|
| 题干键 | `question`（三站一致） | `stem` |
| 章节键 | `chapterId`〔M〕；sudoku 内联为 `lesson`〔N〕 | `chapterId` |
| `answer` 类型 | **int 索引**，三站全部为 int〔M〕 | 字符串 `"A"` |
| `options` 长度 | 4（hello-ai 60/60、sudoku 54/54）；3 或 4（math-physical：3 选项 77 题、4 选项 23 题）〔M〕 | 示例写 4 |
| `misconception` | manifest 层三站全部未探到该键〔M〕；sudoku 内联 `mis` 仅 1/54 题〔N〕 | 允许空串 |
| 其它键 | `type`（三站全 `single`）、`relatedConceptId`、`source`（hello-ai/sudoku 有）〔M〕 | 未定义 |

`cards[]`：三站均 `id,chapterId,front,back,tags`〔M〕；math-physical 多一个 `_added`；sudoku 内联版键为 `front,back,lesson`〔N〕。
`glossary[]`：三站均 `term,def,chapterId`〔M〕，`chapterId` 为 **str**，schema 要 `chapterIds` 数组；
`glossary[].en` 三站均未探到〔M〕。

## 五、正文内联 vs 外链

**这是本轮最影响批 1 的结论。**

1. `BOOKS[slug].manifest` 与 `manifest.json` 文件**不完全相同**〔H〕〔M〕：顶层键一致，
   唯一差异是 `quizzes` 的 `id` —— 文件里是 `q01`，内联里是 `ch00-q01`（两站同样规律，各 60/100 条全部不同）〔H〕〔M〕。
   其余键值逐项相等〔S.diff 结果：仅 quizzes 一个键不等〕。
2. `rendered` 是**成品 HTML**，不能当 `body` 用：math-physical `ch01` 内 204 个 `katex` 类名节点、
   公式定界符（单/双）计数均为 0、`alttext` 计数 0〔H〕 → 原始 TeX 在渲染时已丢失，取不回来。铁律 1 要求 `body` 保留定界符原文交前端 KaTeX 渲染，故只能读 `.md`。
3. `chapters[].file` 是**相对 manifest 所在目录**的路径：`chapters/ch01.md` 在树中实际为
   `01-Hello-AI人工智能导论/chapters/ch01.md`，命中〔T〕〔S〕。批 1 必须先取 manifest 的目录段再拼接 `file`。
4. `.md` 原文形态〔S〕：`math-physical-methods/01-数学物理方法/chapters/ch01.md` 12,466B，
   单美元符 424 次、双美元符 16 次、`|---` 表格 4 处、被反引号包裹的公式 0 处 —— 公式已是标准定界符形态，
   pitfalls 已验证 1 的剥反引号步骤在样本章未触发（其余站点未探到）。
   `hello-ai/…/chapters/ch01.md` 7,374B，该章美元符计数 0（仅样本章实测，不代表全站其余章节）。
5. 抓取量估算：hello-ai 子目录下 86 个 `.md` 共 359,431B，math-physical 87 个共 579,403B〔T〕。
   两站需二次抓取约 80 文件/站；sudoku 正文在单个 `index.html` 内，1 个请求即可〔H〕〔N〕。

## 六、`prerequisites` 实测

| 站 | 层级 | 非空条数 | 平均前置数 |
|---|---|---|---|
| hello-ai-zhishu | `concepts[]` | 49 / 50〔M〕 | 0.98〔M〕 |
| hello-ai-zhishu | `chapters[]` | 19 / 20〔M〕 | 未逐条统计 |
| math-physical-methods | `concepts[]` | 58 / 61〔M〕 | 1.41〔M〕 |
| math-physical-methods | `chapters[]` | 13 / 14〔M〕 | 未逐条统计 |
| sudoku-zhishu | `chapters[]`（键名 `prerequisites`） | 15 / 16〔M〕 | 未逐条统计 |
| sudoku-zhishu | 内联 `ZS.lessons` 用键 **`prereq`**〔N〕 | 未探到非空计数 | 未探到 |

`docs/schema.md` 第 74 行「旧版知枢产物普遍缺失此字段」**在这三站不成立**，见第八节回填项。

## 七、能否用同一个解析器覆盖

**结论：能，但不是「一个函数」，而是一个入口适配层 + 两张映射表。三站不需要三套解析器。**

判据与实测对应关系：

| 判据 | 实测 | 对解析器的要求 |
|---|---|---|
| 入口是否统一 | 不统一：manifest 在根目录 / 在 `01-*` 子目录 / 根目录〔T〕 | 需要「递归找 manifest.json」这一条规则，trees 阶段已验证可行 |
| 结构化数据形状 | 高度统一：三站 manifest 都是 `chapters/concepts?/quizzes/flashcards/glossary` + `slug/book/learningPath`〔M〕 | **同一个 manifest 解析器**即可，差异全在字段别名表 |
| 字段命名 | `flashcards`→`cards`、`question`→`stem`、`answer:int`→字母、`chapterId:str`→`chapterIds:[]`、`prereq`↔`prerequisites`、`lesson`↔`chapterId`〔M〕〔N〕 | 一张字段别名表 + 三个类型转换器，无需分支 |
| 正文来源 | 两类：外链 `.md`（hello-ai、math-physical）/ 内联 JS（sudoku）〔T〕〔N〕 | 需要 **BodyResolver 两个实现**：`MdFileBody`（拼路径 + 抓 `.md`）与 `InlineJsBody`（JS 字面量求值） |
| 内联容器解析 | `BOOKS` 是纯 JSON，`ZS.*` 是 JS 字面量：无引号键 233/248 处、模板串 20–24 个、注释 10 处、尾逗号 46–48 处〔P.jsFeatures〕 | JSON 路径与 JS 路径必须分开；JS 侧建议 Node 子进程 `new Function` 求值，本轮已跑通〔N〕 |
| `source` 字段冲突 | manifest 的 `source` 已被占用为「原书出处」`{"file":"hello-ai.pdf","page":"6–15"}`〔M〕 | 统一 schema 的 `source{repo,path}` 不能同名，建议改叫 `origin`/`srcPath` |

批 1 主体解析器建议分层（覆盖判断的直接产物）：

```
extract.py
  └─ locate_manifest(repo)      候选路径表（不用 trees API）
  └─ parse_manifest(json)       唯一入口，产出 5 类数组
  └─ FieldMap                   flashcards→cards / question→stem / answer int→letter / chapterId→chapterIds[]
  └─ BodyResolver
       ├─ MdFiles(base_dir)     file 字段 → raw 抓 .md，body 存原始 Markdown
       └─ InlineJs(html)        ZS.* 求值，取 body（注意：sudoku 的 body 是 HTML，不是 Markdown）
  └─ _report.json               contentLevel / 计数差异 / 未探到项
```

**`sudoku` 是否需要单独适配：需要，但只缺一个 `InlineJs` 分支，不需要独立解析器。**
`docs/pitfalls.md` 待验证 3 就此可以定案。

**`docs/pitfalls.md` 待验证 1 定案**：1.8MB 单文件的内联数据能稳定抽出——括号配平扫描 + `json.loads`
命中 `BOOKS` 846,220B〔P〕；同文件另有 610 个体积更小的容器，其中 `jM` 22,063B 为混淆代码（无引号键 141 处、无空格）〔P〕，
说明**必须保留体积排序与人工核对**，不能只取第一个命中。

## 八、待回填 `docs/` 的条目（2026-11-24 已全部回填；补测数字另见八之二）

1. `schema.md`：`chapters[].source` 与统一 schema 的 `source{repo,path}` 命名冲突，实际数据里 `source` 是原书出处对象〔M〕。
2. `schema.md`：`quizzes[].answer` 实测三站全为 int 索引，不是 `"A"`〔M〕。
3. `schema.md`：`glossary[].chapterId` 实测是 str，且三站均无 `en`〔M〕。
4. `schema.md` 第 74 行：「普遍缺失 `prerequisites`」在这三站不成立（49/50、58/61 非空）〔M〕。
5. `schema.md` 三、抽取优先级：优先级 3 的内联数据在两站是 `BOOKS[slug].rendered`（成品 HTML）
   与 `BOOKS[slug].manifest`，不是可直接当正文的 Markdown〔H〕。
6. `sites.md`：hello-ai 章数 20；math-physical 题 100、卡 120、index.html 1,887,845B、且有 87 个 `.md`〔T〕〔M〕。
7. `pitfalls.md` 待验证 1、待验证 3 → 移入「已验证」，写法见第七节〔P〕〔N〕。
8. 新坑：内联赋值 `(ZS.x || []).concat([ … ])` 的首个 `[` 是空数组，按「首个括号」取容器必错——
   要取窗口内**配平后最长**的那个〔P，本轮 probe 修正过程〕。
9. 新坑：`manifest.json` 与 `BOOKS[slug].manifest` 的 `quizzes[].id` 不同名空间（`q01` ↔ `ch00-q01`），批 1 必须显式选源〔H〕〔M〕。

## 八之二、回填补测（缓存副本统计 · 与主流程分区呈现）

**来源声明（适用于本节每一个数字）**：本节每个数字后的 **〔C〕= 来源：`_work/cache/` 缓存副本统计，未经主流程复核**。
由一次性脚本 `_work/backfill_stats.py` 直接读缓存里的 `manifest.json` 响应体计数得出；
缓存副本是 2026-11-24 22:25 那次 `--probe` 抓下的原样响应（未改写），但 `tools/extract.py --probe` 主流程只打印容器与顶层字段，
不做这些逐条计数，因此统计口径与前八节不同，单列一节、不并入第八节的回填清单。复现命令：`python _work/backfill_stats.py`
（本次输出留存 `_work/backfill-stats.txt`）。

| 项 | hello-ai-zhishu | math-physical-methods | sudoku-zhishu | 来源 |
|---|---|---|---|---|
| 顶层数组长度 | chapters 20 · concepts 50 · quizzes 60 · flashcards 70 · glossary 110 · learningPath 10 | 14 · 61 · 100 · 120 · 63 · 15 | 16 · **无 `concepts` 键** · 54 · 34 · 43 · 16 | 〔C〕 |
| `chapters[].file` 覆盖 | 20/20 | 14/14 | **0/16** | 〔C〕 |
| `concepts[].file` 覆盖 | 50/50 | 61/61 | 不适用（无数组） | 〔C〕 |
| `chapters[].core` | 20/20 | 0/14 | 0/16 | 〔C〕 |
| `chapters[].prerequisites` 非空 | 19/20 | 13/14 | 15/16 | 〔C〕 |
| `concepts[].prerequisites` 非空 | 49/50 | 58/61 | 未探到（无数组） | 〔C〕 |
| `depthFragment` 出现 / 非空 / 合计字符 | 10 / 10 / 210 | 5 / 5 / 113 | 0 / 0 / 0 | 〔C〕 |
| 顶层 `claims` / `misconceptions` | 键不存在 / 键不存在 | `[]` 长度 0 / `[]` 长度 0 | 键不存在 / 键不存在 | 〔C〕 |
| `quizzes[].type` | 仅 `single` | 仅 `single` | 仅 `single` | 〔C〕 |
| `quizzes[].answer` 类型 / 值域 | int / 0–2 | int / 0–2 | int / 0–2 | 〔C〕 |
| `options` 长度集合 | `{4}` | **`{3,4}` 混合** | `{4}` | 〔C〕 |
| `explain` 非空 / `misconception` 非空 | 60/60 · **0/60** | 100/100 · **0/100** | 54/54 · **0/54** | 〔C〕 |
| `relatedConceptId` 覆盖 | 60/60 | 100/100 | 54/54 | 〔C〕 |
| `chapters[].id` 前两个 | `ch01`,`ch02` | **`ch00`,`ch01`** | `ch01`,`ch02` | 〔C〕 |
| `difficulty` 取值 | 1 / 2 / 3 | 1 / 2 / 3 | 1 / 2 / 3 | 〔C〕 |
| 时长字段 | `hours` 20/20 **全 str**（11 纯数字串 + 9 区间串 `"1–2"`） | 无 `hours` 无 `minutes` | `minutes` 16/16 int | 〔C〕 |
| `chapters[].source` 键 / `page` 类型 | `file`,`page` / str | 仅 `file` / 键不存在 | `file`,`page` / int | 〔C〕 |
| `glossary[0]` 键 | `chapterId,def,term` | 同左 | 同左 | 〔C〕 |
| `flashcards[0]` 键 | `back,chapterId,front,id,tags` | 同左（多一个 `_added`） | 同左 | 〔C〕 |
| `patterns` / `cheatsheet` | `{"file":"patterns.md"}` / `{"file":"cheatsheet.md"}` | 同左 | 两键均为 `null` | 〔C〕 |

### 这三条影响后续批次，不是可选参考（数字出处同表，均 〔C〕）

1. **`misconception` 三站 0 条（0/60、0/100、0/54）→ 诊断链只能做前置链倒推**。
   原设计的「选项常见误解提示」在库内**无数据支撑**，批 3 只能二选一：砍掉该提示，或走 AI 现场生成
   （按铁律标「AI 现场生成 · 未经校验」、不进诊断链）。能做的只有
   **「答错 → 沿 `prerequisites` 倒推根因」**，这条链数据实测是通的（`explain` 全覆盖 + 前置链非空 19/20、13/14、15/16）。
   `quizzes[].misconception` 字段先留契约位，前端按有无显示。
2. **`options` 长度 3/4 混合（math-physical 同站内就有 3 选项题）→ 判题组件按数组长度渲染**。
   不得写死四项网格、不得假定 `options[3]` 存在、不得用「D 选项」当占位。
   `answer` 是 0 基索引，配合原序渲染才成立——已写进 `schema.md` 第一节「前端不得重排选项」。
3. **`depthFragment` 覆盖率 10/50、5/61，合计仅 210B / 113B（平均约 21 / 23 字符）→ 深度推导只作点缀入口**。
   「第一性原理推导」不能作为主路径：批 3 的概念详情层不给它独立版面或默认展开，有就一行折叠，没有整块不出现；
   批 2 的 3D 也不按「每个概念都有深度片段」设计发光层级。

### 顺带确定的两件事（数字 〔C〕）

- **`minutes` 的单位归一不能机械化**：hello-ai 的 `hours` 全是字符串，9/20 是区间串（`"1–2"`、`"2–3"`、`"3–4"`），
  取不到单一数值 → 一律 `null` 并把原值记 `_report.json`，**不得静默变 0**（已写进 `schema.md` 第四节别名表与第五节容错）。
- **附录类文件只有两站有**：`patterns.md` / `cheatsheet.md` 以 `{"file": …}` 形式挂在顶层，sudoku 两键为 `null`；
  批 3 若要收录附录页，按顶层键有无判断，不要假定三档站点结构一致。

本节未探到的项（同样只有缓存副本可查，主流程未覆盖）：`glossary[].en`（三站键不存在）、`concepts[].claims` 的任何非空样本、
`quizzes[].type` 的非 `single` 取值、其余 44 站的以上全部指标。

## 九、遗留风险

1. **全量阶段的 trees 缺失**：本轮靠 trees 才拿到 manifest 所在子目录。改用候选路径表后，
   未收录 `01-*` 命名的站会退化为「只抓到根目录说明文件」，`_report.json` 需按 `contentLevel` 标注。
2. **请求量**：三站 24 请求；按 hello-ai/math-physical 各约 80 个 `.md` 外推，47 站的二次抓取量级在
   2,000–3,800 请求。raw 无 60/小时限制，但需要并发上限与断点续抓；本轮未压测（未探到 raw 实际限速阈值）。
   策略已定案并写进 `schema.md` 第三节与 `tools/README.md`：**raw 回读、3 并发限速、统一走 `_work/cache/`、
   `_work/state/fetch-state.json` 断点续传**，限速阈值仍待批 1 实压。
3. **sudoku 正文是 HTML 片段**（`<p>`/`<table>`/模板串，16/16 章含 `<p>`，8/16 含 `<table>`，美元符计数 0）〔N〕，
   与 `chapters[].body`「Markdown 正文」的契约不符 → 已对齐：新增 `bodyType: md | html` 与
   `contentLevel: degraded`，前端按 `bodyType` 分流渲染（`schema.md` 第一、三节，`design.md` 第五节）。
4. 其余 44 站的结构差异范围仍未探到：本轮只证明了三站同构，不能外推到 v1.0–v1.9 全谱。
5. 本轮 probe 未写 `data/`、未写 `docs/`（除本报告）；`data/manifest.json` 保持空壳原状〔S 校验：文件未改动〕。
   **后续更新（2026-11-24 回填环节，与 `--probe` 运行无关）**：① 依第八节人工回填
   `schema.md` / `design.md` / `sites.md` / `pitfalls.md` / `tools/README.md`；② `data/manifest.json`
   只改了一个字段——`schemaVersion` 1 → 2（版本号描述结构契约而非数据完整度，留 1 会让读取方走错分支），
   空壳状态与其余字段未动，`data/sites/` 仍为空；③ `tools/extract.py` 未改动，批 1 主体落地时须按
   `schema.md` 第二节输出 v2 字段（`origin`/`bookSource`/`contentLevel`/`bodyType`/int `answer`），
   否则 `verify_data.py` 与前端读取分支会错位。

## 十、50 站本地 clone 复核（2026-11-25）

**本节数字全部标 〔K〕**：来源是 `_work/repos/` 下 50 个本地 clone 的只读扫描
（`git -c core.quotepath=false ls-tree -r --name-only HEAD` + `git config --get core.sparseCheckout` +
`git count-objects -vH` + 工作树文件枚举），采集于 2026-11-25 09:15，**不经 `extract.py` 主流程、未发起网络请求、未写 `data/`**。
明细表：`_work/clone_tier_audit.txt`（人读）与 `_work/clone_tier_audit.json`（机读）。

### 一、总量与分布

| 项 | 实测 |
|---|---|
| 已克隆仓库 | 50 / 50（后台旧脚本跑完，最后一轮 13 OK / 36 SKIP / 0 FAIL）〔K〕 |
| 树内条目合计 | 15,422 |
| `.md` 合计 | 3,703 |
| `.json` 合计 | 1,457 |
| **`manifest.json` 总份数** | **131** |
| 有 `manifest.json` 的仓库 | **25 / 50**（另 25 站没有） |
| manifest 层级分布 | 根目录 2 · 一级子目录 100 · 二级子目录 29 |
| 多书合集仓库 | 14 个（39 / 24 / 11 / 8 / 7 / 6 / 5 / 4 / 4 / 3 / 3 / 2 / 2 / 2 份） |

**这一条推翻了本次重构的地基假设**：原 `schema.md` 写「一 repo = 一站 = 一份 `data/sites/{repo}.json`、
`repo` 为唯一键」，但 50 个仓库里装着 131 本书，且 `ch01`、`q01` 这类 id 在每本书里都从头开始〔K〕。
已按「一书一条 `sites[]`」改定契约，见 `schema.md` 第一、二节与本节第四节。

### 二、contentLevel 候选分布（按仓库粗判，未解 manifest 内容）

| 初判 | 站数 | 判据 | 名单 |
|---|---|---|---|
| full 候选 | 24 | 有 manifest 且树内 `.md` ≥ 10 | MATH、additive-combinatorics-enlighten、advanced-math-zhishu、agentic-design-patterns-handbook、ai-architecture-handbook、ai-enlighten、ai-ml-dl-rl-enlighten、algorithm-enlighten、analysis-handbook、chem-zhishu、combinatorial-optimization-game-theory、complex-analysis-visual、cpu-enlighten、discrete-geometry-enlighten、economics-principles-handbook、first-push-enlighten、food-zhishu、hello-ai-zhishu、math-analysis、math-basics-enlighten、math-physical-methods、neural-net-zero、ode-enlighten、taocp-enlighten |
| 待判 | 1 | 有 manifest 但 `.md` 极少 | sudoku-zhishu（树内 `.md` 仅 2）→ 已知 `degraded`〔M〕 |
| degraded / 无 manifest 候选 | 5 | 无 manifest 但有成量 `.md`/`.json` | AI-Study-Notes（md 104、json 0）、exam-solver（md 350、json 0）、CourseVault-OfflineCourseMap（md 20、json 1,159）、kaoyan-math-66000（md 28、json 20）、bws-bilingual-reader |
| stats-only 候选 | 20 | 无 manifest 且 `.md`/`.json` 都稀缺 | ACM-XCPC-Notes、AI-courses、C-、C-true、MATLAB、ODE、SVM、ai-history-site、alpoge-remark-book、gaokao-math、llm-model-catalog、math-competition-derivation、mathmap、meeting-129600years、odes-from-scratch、pages-index、probability-statistics、shanghai-chem-lab、show、transformer |

这四处比例都远超「三站样本」能外推的范围：**一半的站没有 manifest**，原计划靠优先级 1/2 拿结构的站只占一半。
`exam-solver` 与 `AI-Study-Notes` 有大量 Markdown 却没有知枢结构，属另一类数据源，批 1 不硬套解析器。

### 三、三档拉取策略的复核结果（本轮唯一的一次网络动作在下表第二行）

| 站 | 复核前 | 复核后 | 结论 |
|---|---|---|---|
| `ACM-XCPC-Notes` | 稀疏 `*.md`/`*.json` 任意深度，已检出 2 文件，pack 688.81 KiB | **未重拉** | 树内 `.md` 只有 1（README.md）、`.json` 只有 1（assets/data.json，在一级子目录）——any-depth 规则两个都拿到了，根目录规则反而会漏掉 `assets/data.json`。该站 481MB 主体是 cpp 1,482 / pdf 282 / ppt 279 / doc 180，**没有知枢正文**，归 stats-only 候选 |
| `kaoyan-math-66000` | 稀疏 `/*.md`/`/*.json` 仅根目录，已检出 2 文件，pack 35.26 KiB | **已放宽到任意深度**：检出 2 → **48**（树内 md 28 + json 20，全到），pack 35.26 KiB → **205.54 KiB** | 原 three-root 档位**是错的**，已改 three-big。但它的考研题主数据在 `.csv` 19 个 / `.html` 201 个 / `.txt` 8 个里〔K〕，`*.md`+`*.json` 覆盖不到 → 三档的扩展名清单要不要加 `*.csv`，待批 1 定 |
| `CourseVault-OfflineCourseMap` | 稀疏 `/*.md`/`/*.json`，已检出 **1** 文件，pack 201.97 KiB | **待重拉**（本轮未执行，需批准） | 树内 md 20 + json **1,159**，根目录规则挡掉了 1,178 个 → 档位错误，已归 three-big。这是课程目录型数据，不是知枢结构，拉不拉取决于批 4 检索要不要收录 |

`git fsck` 对 `kaoyan-math-66000` 无输出（对象库完好），上一轮观测到的 179 行 `unable to read sha1 file`
是被旧脚本第二次 pass 的 `> _clone_report.txt` 覆盖掉了——**旧版每跑一次就清空历史**，这点已写进 `tools/README.md`。

**第三次验证已执行（2026-11-25 09:5x，CourseVault）〔K〕**：根目录规则下工作树 1 个文件、pack 201.97 KiB；
放宽到 `*.md *.json *.csv *.txt` 后 **1,186 个文件 / 工作树 32,524,990B / pack 1.05 MiB** ——
体积没有停在「本来就这么小」，说明 **root-only 判定确实是错的**。但其中 **126 个文件占 31,175,207B（95.8%）**
是 `notes/<课程>/static_shared/mathjax/hi.*.json` 这类 MathJax i18n 重复包，真数据是每门课的
`content_map.json`（32,595B）与 `video_galleries/**/data.json`（59,843B）。
据此给三档加了目录级排除（非 cone 的 `!` 前缀：`static_shared`、`node_modules`、`vendor`），
排除后 **1,046 个文件 / 1,372,900B**。该站没有 `manifest.json`，所以结论仍是 `stats-only` + 待适配器，
不是「拉到 json 就能抽」。

### 四、契约影响（已落到文档，未落到代码）

1. `schema.md` 第一节：`sites` 条目 = 一本书；文件名单书站仍叫 `data/sites/{repo}.json`、多书站叫
   `{repo}--{slug}.json`；`slug` 取值顺序定死（manifest 顶层 `slug` → manifest 所在目录名 → `b01` 序号），
   同仓库冲突**必须报错并记 `_report.json` 的 `slugCollisions`**，不得静默覆盖。
2. `schema.md` 第二节：`totals` 拆 `repos`（50）与 `sites`（实际产出的书条目数，上限 131）；`contentLevels`
   与 `disciplines[].siteCount` 按书计，另加 `repoCount` 按仓库计。
3. `schema.md` 第一、六节：`ch*.json` 的 id 只在书内唯一 → 跨书键一律 `{repo}::{bookSlug}::{id}`；
   正文不进 discipline 结构分片，另存 `data/bodies/{repo}--{bookSlug}.json` 按需加载。
4. `design.md` 第二、三、六节：展台由「按站点」改为**按书**分列，章节/概念两层不变；节点量级按 131 展台重算。
5. `sites.md` 顶部：口径从三个数变四个数——仓库 50、有可用数据 47（待实定）、无说明 4、**数据条目 131**，
   并写明「`sites` 条目数 ≠ 仓库数，前者按书计」。

### 五、本节未探到 / 环境注意

- 131 份 manifest 的**内部结构是否都同构**未验：只解析了三站〔M〕，其余 128 份的键名、数组形态、`file` 字段有无均未读——
  这是批 1 的第一道关，别名表八成要加行。
- 本地 clone 的 `.md` 计数是**树内全量**，不等于 `chapters[].file` 指向的文件都存在，两者差多少要批 1 实测。
- 稀疏克隆的 pack 只含已取 blob，**不能用来判仓库大小**（`kaoyan-math-66000` pack 3.74MiB 而仓库标注 38MB）。
- 本机 `git config --global http.sslVerify` = **false**（仓库级同值），旧脚本靠 `-c http.sslVerify=true` 逐次覆盖；
  本轮我执行 `sparse-checkout set` 时未加该参数，git 直接告警「TLS certificate verification has been disabled」。
  **未改任何 git 配置**；批 1 若由 `extract.py` 调 git，需显式带 `-c http.sslVerify=true`。

## 十一、批 1 实测（2026-11-25 09:30 首跑 / 09:53 定稿写 `data/`，〔X〕）

命令：首跑 `python tools/extract.py --all --bodies --out-dir _work/data-dry`（验证用，不碰 `data/`）；
定稿 `python tools/extract.py --all --bodies`（**已写入 `data/`**，265 个 JSON：
`sites/129 + bodies/129 + dist/5 + manifest.json + _report.json + 原有骨架`）。
交付自检：全部 JSON 可解析、**0 个 CRLF、0 个 BOM**（写入统一 `newline="\n"` + UTF-8）、
5 个分片全部 < 2MB、对账 `sites 129 + excludedManifests 2 = 131 份 manifest`、`repos 50 = 有 manifest 25 站 + failures 25 站`。
主路径全部本地读盘：raw 兜底 **0 次**、未克隆站 **0 个**。

| 项 | 实测 |
|---|---|
| 仓库 / 书条目 / 去重后独书 | 50 · **129** · **96** |
| 章 / 概念 / 题 / 卡 / 术语 | 1,169 · 765 · 3,541 · 4,100 · 4,100 |
| contentLevels | `full` 128 · `degraded` 1 · `stats-only` 0 |
| failures | 25（全部是「无 manifest.json」的站，按站记，不占 `sites[]`） |
| 排除的归档 manifest | 2（`chem-zhishu/_archive/03-…旧版`、`04-…旧版40题`） |
| slug 冲突 | 0（排除 `_archive` 之后） |
| 跨仓重复组 | 33（初版含 title 的算法是 26 组，改键后补出 7 组镜像） |
| 结构分片体积 | ai 1,637 KiB · math 1,124 · general 574 · cs 502 · chem 477 —— 全部 < 2MB |
| 正文体积 | 7.4 MiB / 129 本 |
| 章正文命中 | `.md` **1,153 / 1,169** 章；sudoku 另经 Node 拿到 **16/16** 章 HTML |

### 首跑推翻/补齐了六处文档假设（已同步改入 schema.md）

1. **`quizzes[].type` 有三种**：`single` 3,298 · `blank` 157 · `multi` 86 —— 第八之二节按三站得出的「只有 single」是样本错觉。
   因此 `answer` 不可能是单一 int：`single`→int 索引、`blank`→**答案文本 str**（如 `"3/11"`、`"费马"`、`"θ"`）、
   `multi`→**索引数组 list[int]**（如 `[0,1]`）。归一后 `answer=null` **0 条**。
2. **`options` 长度还有 2 与 0**：4 项 3,120 · 3 项 225 · 2 项 47 · 0 项 157（填空）。判题组件按数组长度渲染这条更硬了。
3. **同一本书会被多个仓库收录**：定稿跑 **33 组**重复（66 本带 `duplicateGroup`），`ai-architecture-handbook` 是聚合仓——
   它把 `math-basics-enlighten` 的 24 本、`neural-net-zero` 各 1 本，以及**改了名的 hello-ai**（「AI 导论：Hello, AI」）原样重收〔X〕。
   查重键因此**不含 title**（章节 id 序列 + 计数 + 正文哈希）：含 title 的初版算法只有 26 组 / 独书 103，
   去掉 title 后是 33 组 / 独书 96，差的 7 组全是「同内容不同名」的镜像。新增 `totals.sitesUnique` 与
   `duplicateGroup`/`mirroredFrom` 规则（schema 第二节）。
4. **`_archive/` 里的旧版 manifest 会撞 slug 并造出假条目**：不排除就会多出一本「旧版 40 题」题库。
   新增 `excludedManifests`（schema 第二节）。
5. **概念正文之前没被回读**：`map_chapter` 登记了 `.md` 而 `map_concept` 漏了，实测 `concepts[].file` 覆盖率
   hello-ai 50/50、math-physical 61/61〔M〕——已补，正文文件数因此从 128 → 129 本含正文（含 sudoku）。
6. **`minutes` 的 null 是 18 条**：hello-ai 9 章区间串 + `ai-architecture-handbook` 里那份 hello-ai 副本 9 章〔X〕，
   没有一条被写成 0。

### 两个尾巴的结论（2026-11-25 复核后已定性，不是数据错）

- **远程引用是「铁律表述错」而不是数据错**：首跑扫描 129 个正文文件得到 28 处 URL，逐条看上下文分流结果正好对上——
  `www.w3.org` **13 处全在 `xmlns="http://www.w3.org/2000/svg"` 属性里**（economics 两本的内联 SVG），
  `weather.example.com` **2 处全在围栏代码块的 JSON 字面量里**，两者属白名单放行；
  剩下 **13 处 `mp.weixin.qq.com/s/…` 是真外链**，形态是 Markdown 自动链接、集中在「来源」小节〔X〕。
  铁律原文「零 CDN」已改写为「渲染结果不得在运行时发起任何网络请求」+ 三类白名单
  （`xmlns` 声明 / 代码块内 URL / `example.*`·`localhost`·`127.0.0.1` 等保留域名），
  同步改在 `.qoder/rules/zhishu-rules.md`、`.lingma/rules/zhishu-rules.md`、`docs/pitfalls.md` 已验证 3 与 `AGENTS.md` 摘要四处。
  真外链按铁律降级为纯文本并逐条记 `_report.json` 的 `externalLinks`，抽取端由 `--link-policy strip` 执行
  （实测 3 种形态都能降级：`[文字](url)`、`<url>`、裸 URL；默认 `keep` 只记录）。
- **`kaoyan-math-66000` 按「加 `*.csv` 与 `*.txt`、不加 `*.html`」重取后，预判被否**：已检出 2 → 75 个文件
  （md 28 + json 20 + **csv 19 + txt 8**），pack 205.54 KiB → 386.76 KiB〔K〕。
  但 19 个 csv 共 3,613 行的表头是 `q,page,verdict,note,time`、`qno,册内编号,页,题干核对,答案核对,校勘位置`——
  **是人工校对台账，不是题面**；json 也全是流水线元数据（`waves.json`、`inventory.json`、`q2p`/`p2q`）。
  题面只在 201 个 `.html` 里，而不拉 HTML 是既定取舍（成品 HTML 公式绑死字号颜色，反解析成本高）。
  所以 kaoyan 正确判定是 **`stats-only`**，不是「有题无正文的 degraded」；
  degraded 的定义仍是「可做题、无或极少正文」，标准样本是 sudoku（16/16 章内联 HTML + 54 题〔X〕）。
  顺带验到定界符完好：台账里 `$...$` 149 处、`\(...\)` **332 处**〔K〕——后者要求 KaTeX 端开 `inlineMath`
  或抽取时归一，已写进铁律与 `schema.md` 第一节。
- **正文里的公式密度**（保留原测）：129 本正文中 **22 本含美元定界符**、**6 本含 HTML 标签**〔X〕——
  多数书的 `.md` 不用行内公式，用的集中在数学类；`glossary[].def` 的定界符完好（实测样本形如 `$x+iy$` 的释义原文〔X〕）。

### 未做（留批 1 后续）

`data/` 正式写入、25 个无 manifest 站的优先级 3/4 抽取、`patterns.md`/`cheatsheet.md` 附录页、
`prerequisites` 的跨书引用解析、`quizIds`/`conceptIds` 反向索引、`verify_data.py` 校验脚本、`--limit` 之外的并发化。

