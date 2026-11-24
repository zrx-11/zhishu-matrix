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
