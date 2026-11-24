# 站点清单

owner 全部为 `zrx-11`，分支 `main`。

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
