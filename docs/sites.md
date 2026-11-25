# 站点清单

owner 全部为 `zrx-11`，分支 `main`。

## 口径：50 / 47 / 4 是三个不同的数，不能互换

| 口径 | 数 | 定义 | 用途 |
|---|---|---|---|
| 仓库总数 | **50** | `_work/site_repos.json` 全集。与本文六张分表逐行相加一致：AI 9 + 数学 17 + 化学与食品 3 + 计算机 7 + 通识 8 + 工具 6 = 50（2026-11-24 脚本核对，双向差集为空） | clone 与档位判定的分母 |
| 有可用数据 | **47** | 扫描时抓到 `交付说明.md`/`README.md` 或 `manifest.json` 的站，即第七节规模汇总的分母 | 规模汇总、抽取覆盖统计 |
| 无任何说明 | **4** | `SVM`、`MATLAB`、`AI-courses`、`meeting-129600years`（均在 50 行内） | **跳过不抽取，但逐站记入 `data/_report.json` 的 `failures`，不从 50 里抹掉** |
| 数据条目（书） | **131** | 50 仓里 `manifest.json` 的总份数，即 `data/sites/*.json` 与 `manifest.sites[]` 的上限 | 见 `schema.md` 第一节：一条 sites 记录 = 一本书 |

**`sites` 条目数 ≠ 仓库数，前者按书计。** 2026-11-25 对 50 个本地 clone 全量扫描〔K〕：131 份 manifest 分布在 **25 个站**，
另 **25 站没有 `manifest.json`**；14 个站是多书合集——`ai-architecture-handbook` 39、`math-basics-enlighten` 24、
`first-push-enlighten` 11、`chem-zhishu` 8、`ode-enlighten` 7、`taocp-enlighten` 6、`ai-ml-dl-rl-enlighten` 5、
`algorithm-enlighten` 4、`food-zhishu` 4、`MATH` 3、`analysis-handbook` 3、`ai-enlighten` 2、
`economics-principles-handbook` 2、`math-analysis` 2。所以下面六张表的「一行 = 一个仓库」，而抽取产出的「一条 = 一本书」，
两个数不要混用：仓库看 50，条目看 131（`totals.repos` 与 `totals.sites` 各管一头）。

四条约束：

1. **`data/manifest.json` 的 `totals.sites` 填实际产出的书条目数**——成功写出 `data/sites/….json` 的份数，上限 131，
   **不填 50、不填 47**；仓库总数另由 `totals.repos` 记（50）。`totals.sites + failures + slugCollisions 跳过量`
   不足 131 的差额即「未处理」，批 1 须在 `_report.json` 里显式列出，不许默认归入任何一档。
2. **47 目前在本表内复现不出来**：50 − 4 = 46；而分表里带任一规模数字的只有 40 行，另有 10 行六列全为 `—`
   （`llm-model-catalog`、`math-competition-derivation`、`shanghai-chem-lab`、`ACM-XCPC-Notes`、`economics-principles-handbook`、
   `AI-Study-Notes`、`AI-courses`、`CourseVault-OfflineCourseMap`、`ai-history-site`、`meeting-129600years`）。
   第七节的 47 是早期扫描手记值，本轮保留原样、不改成 46 也不改成 40，等批 1 `_report.json` 出实数后统一。
3. **`sites` 条目数 ≠ 仓库数，前者按书计**：本表一行是一个仓库，`manifest.sites[]` 一条是一本书，
   `disciplines[].repoCount` 按仓库、`siteCount` 按书，两组数并存，代码里不得共用一个变量名。
4. 四个数各管各的：拉取看 50，覆盖看 47（待实定），跳过看 4，条目看 131。**不得把 47 当作仓库总数写进文档、代码常量或进度分母。**

规模数字来自 2026-11-24 的一次扫描（抓每站 `交付说明.md` 或 `README.md` 的正则抽取）。标 ⚠️ 的是明显失真项，需要拉 `manifest.json` 复核。

**标「已实测」的三行是 2026-11-24 probe 拉过 `manifest.json` 与文件树的站**，数字以实抽数组长度为准（来源标记见 `docs/probe-report.md` 〇节）；其余 44 站仍是说明文件正则汇总值，未经校验。

## 一、AI

| 仓库 | 章 | 概念 | 题 | 卡 | 术语 | 备注 |
|---|---|---|---|---|---|---|
| hello-ai-zhishu | **20** | 50 | 60 | 70 | 110 | 已实测：章数原记 14 有误〔M〕；manifest 在 `01-Hello-AI人工智能导论/` 子目录；`index.html` 627,587B；子目录 86 个 `.md` 共 359,431B → `contentLevel: full` |
| ai-enlighten | 16 | — | 44 | — | — | 17MB |
| ai-ml-dl-rl-enlighten | — | — | 199 | — | — | 8.5MB |
| ai-architecture-handbook | 6 | 155 | 476 | 602 | 23 | 数字对 6 章偏大，待核 |
| transformer | 15 | — | — | — | — | 只有 README |
| neural-net-zero | 13 | 12 | 32 | — | 55 | |
| agentic-design-patterns-handbook | 26 | — | 58 | — | — | |
| llm-model-catalog | — | — | — | — | — | 目录型 |
| alpoge-remark-book | 20 | — | — | — | — | |

## 二、数学

| 仓库 | 章 | 概念 | 题 | 卡 | 术语 | 备注 |
|---|---|---|---|---|---|---|
| math-basics-enlighten | 81 | — | 212 | 301 | 220 | 24 本合集 |
| advanced-math-zhishu | 10 | 32 | 56 | 60 | 75 | |
| math-physical-methods | 14 | 61 | **100** | **120** | 63 | 已实测：题原记 28、卡原记 42 均偏低〔M〕；`index.html` 实为 1,887,845B（非 1,057KB）；87 个 `.md` 共 579,403B → `full`；首章 id 是 `ch00` |
| math-analysis | 21 | — | — | — | — | 只有 README |
| analysis-handbook | 12 | 5 | — | 60 | 88 | |
| MATH | 24 | 24 | 57 | 120 | 94 | |
| complex-analysis-visual | 12 | 49 | 101 | 98 | 64 | |
| probability-statistics | 4 | — | — | — | — | |
| odes-from-scratch | 1 | — | — | — | — | |
| ode-enlighten | 8 | — | — | — | — | |
| ODE | 1 | — | — | — | — | |
| gaokao-math | 8 | — | ⚠️20216 | — | — | 题数疑为题库总量或误抓 |
| kaoyan-math-66000 | — | — | ⚠️2650 | — | — | 仓库 38MB，66000 疑为标称题量 |
| math-competition-derivation | — | — | — | — | — | |
| additive-combinatorics-enlighten | 39 | — | 45 | — | — | |
| discrete-geometry-enlighten | 9 | — | 42 | — | — | |
| combinatorial-optimization-game-theory | 8 | — | 18 | 27 | 56 | |

## 三、化学与食品

| 仓库 | 章 | 概念 | 题 | 卡 | 术语 | 备注 |
|---|---|---|---|---|---|---|
| chem-zhishu | 13 | 3 | 130 | 13 | 87 | |
| food-zhishu | 12 | 6 | 412 | 24 | 75 | |
| shanghai-chem-lab | — | — | — | — | — | 实验类 |

## 四、计算机

| 仓库 | 章 | 概念 | 题 | 卡 | 术语 | 备注 |
|---|---|---|---|---|---|---|
| algorithm-enlighten | 17 | 7 | 37 | — | 47 | |
| cpu-enlighten | 38 | — | — | 223 | 193 | |
| taocp-enlighten | — | — | 78 | — | — | |
| C-true | 20 | — | — | — | — | |
| C- | — | — | 300 | — | — | |
| sudoku-zhishu | 16 | **0** | 54 | 34 | 43 | 已实测：manifest **无 `concepts` 数组**〔M〕；正文不在 `src/content/*.js`（那是构建输入），在 `index.html` 的 `ZS.lessons` 等内联字面量里〔N〕 → `degraded` |
| ACM-XCPC-Notes | — | — | — | — | — | 481MB，不 clone |

## 五、通识

| 仓库 | 章 | 概念 | 题 | 卡 | 术语 | 备注 |
|---|---|---|---|---|---|---|
| first-push-enlighten | 145 | — | — | 526 | 165 | 章数疑含全部条目 |
| economics-principles-handbook | — | — | — | — | — | |
| AI-Study-Notes | — | — | — | — | — | 笔记型 |
| AI-courses | — | — | — | — | — | 无说明文件 |
| bws-bilingual-reader | 9 | — | — | — | — | 双语阅读器 |
| CourseVault-OfflineCourseMap | — | — | — | — | — | 课程地图 |
| ai-history-site | — | — | — | — | — | |
| meeting-129600years | — | — | — | — | — | 无说明文件 |

## 六、工具

| 仓库 | 说明 |
|---|---|
| mathmap | 数学地图 |
| exam-solver | 解题器，180 题 |
| show | 展示类 |
| pages-index | Pages 总览入口 |
| MATLAB | 无说明文件 |
| SVM | 无说明文件 |

## 七、合计

47 个站有可用说明文件，实抽约：

| 项 | 数量 |
|---|---|
| 章 | 648 |
| 概念 | 415 |
| 题 | ~2,700（剔除 ⚠️ 两项） |
| 卡 | 2,200 |
| 术语 | 1,458 |

上表是说明文件汇总值。probe 已实测的偏差：章 +6（hello-ai 14→20）、题 +72、卡 +78（math-physical 28→100、42→120）〔M〕。
实抽总数一律以 `data/manifest.json` 的 `totals` 为准，本表只作交叉校验。

## 八、抽取时注意

1. `hello-ai-zhishu` 的 manifest 在子目录 `01-Hello-AI人工智能导论/`，不在根目录；math-physical 同理在 `01-数学物理方法/`〔T〕。`chapters[].file` 是相对该目录的，拼路径要先取目录段。
2. **字段名 `source` 已被数据占用**：manifest 里的 `source` 是原书出处对象（`{"file":"hello-ai.pdf","page":"6–15"}`〔M〕），统一 schema 的抽取来源字段因此改叫 `origin`，出处保留为 `bookSource`，见 `schema.md` 第一节与第四节。
3. **`quizzes[].answer` 是 int 索引**（索引从 0 起、对应 `options` 原序），不是字母〔M〕。
4. `math-physical-methods` 的 1.8MB 单文件里，内联 `BOOKS[slug].rendered` 是成品 HTML、公式不可还原；正文只能回读该站 87 个 `.md`〔H〕。`math-basics-enlighten` 是否同形未探到。
5. `sudoku-zhishu` 走 **Node 求值分支**：`ZS.*` 是 JS 字面量（无引号键 233/248 处、模板串、注释、尾逗号），`json.loads` 解不了，抽取器因此依赖 Node 运行时〔P〕〔N〕。Node 不可用时该站降为 `stats-only`，不自动装环境。
6. `ACM-XCPC-Notes` 481MB，只抓根目录 JSON，不抓内容。
7. 无说明文件的 4 个站（SVM、MATLAB、AI-courses、meeting-129600years）先跳过，记入 `_report.json`，按 `contentLevel: "stats-only"` 或直接进 `failures`。
8. 三站的 `contentLevel` 初判：hello-ai `full`、math-physical `full`、sudoku `degraded`〔M〕〔T〕。其余 44 站待批 1 实跑后回填，不要照抄这三行的规模数字。
