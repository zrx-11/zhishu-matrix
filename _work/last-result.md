# 结果：批 6 打包收敛（数据预压 + mermaid 白名单）+ 发布文档

## 状态

done — 自检 **74 项全绿**（`python tools/selfcheck.py`，91.8s，报告 `_work/selfcheck-report.json`，截图 `_work/shots-batch6/`）。
`dist/` 从本轮基线 **22.83 MiB / 391 文件** 收敛到 **9.85 MiB / 347 文件（43.1%）**，门槛 ≤60% 达标且留有余量。
数据门槛 `verify_data.py` 五类 23 项全绿；`check_offline.py` 违规 0 处；`tsc --noEmit` 零错；`npm run build` 成功。
任务书 10 条完成判据逐条过，无「接近完成」；**未新增、未删除、未放宽任何断言**（断言净增 3 条，见下）。
阶段 D 按要求**没有实际上传**，发布命令与配额核对落在 `docs/deploy.md`。

## 体积分族对比（阶段 A 基线 → 收敛后）

基线取本轮开工前的 `dist/`（`_work/measure-requests.json`，2026-11-25T07:28Z 实测 `distTotalBytes=23,935,228 / 391 文件`），
收敛后取当前 `dist/`（`selfcheck.py::dist_size_evidence()`），字节数直接来自文件系统。

| 族 | 收敛前 | 收敛后 | 差 | 手段 |
|---|---|---|---|---|
| `assets/` | 7,344,711 B · 7.00 MiB · 119 片 | 5,458,913 B · 5.21 MiB · 76 片 | **−1,885,798 B / −1.80 MiB / −43 片** | 阶段 C：mermaid 白名单裁剪 |
| `bodies/` | 7,783,777 B · 7.42 MiB · 129 | 2,908,840 B · 2.77 MiB · 129 | **−4,874,937 B / −4.65 MiB** | 阶段 B：构建期预压（文件数不变） |
| `sites/` | 3,896,325 B · 3.72 MiB · 129 | 904,073 B · 0.86 MiB · 129 | **−2,992,252 B / −2.85 MiB** | 阶段 B：预压，运行期仍按需取 |
| `dist/` 结构分片（5） | 4,248,945 B · 4.05 MiB | 806,913 B · 0.77 MiB | **−3,442,032 B / −3.28 MiB** | 阶段 B：预压 |
| `dist/` 检索分片（6） | 585,266 B · 0.56 MiB | 187,985 B · 0.18 MiB | **−397,281 B / −0.38 MiB** | 阶段 B：预压（最大 ai 片 93.7 KB） |
| `manifest.json` | 55,078 B · 1 | 55,078 B · 1 | 0 | 刻意保持明文（引导链不依赖解压） |
| `_report.json` | 18,238 B · 1 | **0** | −18,238 B | 实测运行期 0 请求，不再拷 |
| `raw/` | 0 B · 0 | 0 | — | 空目录，本就无内容 |
| `index.html` | 2,888 B · 1 | 2,888 B · 1 | 0 | — |
| **合计** | **23,935,228 B · 22.83 MiB · 391** | **10,324,690 B · 9.85 MiB · 347** | **−13,610,538 B（−56.9%）** | **占基线 43.1%** |

两条必须写清的事实（阶段 A 实测推翻了前置清单的假设，详见 pitfalls 34 与 decisions 批 6 首三行）：

1. **「16.7MB 数据拷贝是死重」不成立。** 无头 Edge 走完全路径逐族量请求：`sites/` 55 次 / 去重 54 本、
   结构分片 5 片全取、检索分片 6 片全取、`bodies/` 点开即取——**只有 `_report.json` 与 `raw/` 真是零请求，合计 18 KB**。
   纯靠「少拷」最多省 0.02 MiB，60% 门槛在只删不压的路线上数学上够不着。
2. 所以收敛的两根杠杆是 **换传输形态（预压，−11.17 MiB）** 与 **裁 `assets/`（mermaid 白名单，−1.80 MiB）**，
   功能一个没减。预压不改内容：产物 `.json.gz` 解压后与 `data/` 源**逐字节比对 270 个文件全等**，这条已进门槛。

## 做了什么

**阶段 B · 数据落盘收敛**
- `vite.config.ts` 去掉 `publicDir: 'data'` 的整份拷贝：改为 `publicDir: command === 'serve' ? 'data' : false` +
  新增插件 `zhishu:ship-data`（`apply: 'build'`，`closeBundle` 阶段按 `SHIP` 白名单挑族、`gzipSync(level 9)` 预压、
  落 `<name>.json.gz`）。实测打印「数据落盘：270 个文件 15.80MiB → 4.64MiB（跳过 _report.json / raw/）」
- `src/data.ts` 读侧配合：`dataUrl()` 按 `import.meta.env.PROD` 决定是否加 `.gz`（dev 走明文 `publicDir`，两边调用点不动）；
  `getJson()` 对 `.gz` 用 `DecompressionStream('gzip')` 还原；`manifest.json` 走 `gzipped=false` 保持明文
- 边界两处（只在系统边界做校验，内部数据不加防御）：
  `gunzip()` 先验 gzip 魔数 `1f 8b`，非魔数按明文处理——托管层若对 `.gz` 加 `Content-Encoding: gzip`，浏览器已透明解压；
  `getJson()` 见 `content-type: text/html` 抛「拿到的是 HTML（产物缺这个文件，SPA 回落把 404 伪装成 200）」，
  不再让 `JSON.parse` 报 `Unexpected token '<'` 把两种病因混成一条
- `data/` 源目录**一字未动**（铁律 6）：结构没拆没并、字段没改、明文仍在原位，`.gz` 只存在于 `dist/`
- `sites/` 的取用改走 `data.ts::loadSiteRecord()`（原 `main.ts::bookRecord()` 内联 fetch），路径与前缀逻辑收进一处

**阶段 C · mermaid 白名单裁剪**
- 新增插件 `zhishu:mermaid-whitelist`（`enforce: 'pre'`）：读 `node_modules/mermaid/dist/mermaid.core.mjs` 的图型注册表，
  把 `KEEP_DIAGRAM_IDS`（`flowchart-v2` / `flowchart-elk` / `sequence` / `mindmap` / `xychart`）之外的图型，
  其动态 `import("./chunks/mermaid.core/xxx.mjs")` 整段换成 `Promise.reject(new Error("zhishu: 图类型 … 未打包"))`——
  Rollup 不再产出那些分包；另剔 `swimlanes` 布局包（全库 0 处使用，120 KB）
- **保留既有回退支**：类型侦测仍在，未打包图型走到 loader 即抛错，由 `src/diagram.ts` 的 `fail()` 接住 →
  `data-diagram="error"` + 源码 `<pre>` + 一行原因，容器不空
- 分包闭包 57 片 / 5.1 MiB → **14 片 / 3.19 MiB**；`elk`（1.45 MiB，flowchart 在 mermaid 12 的默认布局）与 `cose-bilkent`
  （mindmap）、`dagre`（兜底）实测被取，全部保留；**没有**用「把 flowchart 改成 dagre」这种改变出图形态的做法换体积
- 踩坑一条（pitfalls 33）：`IMPORT_RE` 交替支 `(?:\./chunks/mermaid\.core|\./)` 少写结尾 `/`，捕获组带上前导斜杠，
  查不到 drop 表 → 插件**静默空转**、构建照成功、分包一个没少；靠「无条件打印 + 拿真实源码单跑正则」定位。
  门槛侧补了产物断言（`droppedLeftovers`），不再依赖插件自述

**门槛跟着改（否则 `.gz` 一来脚本集体瞎掉，pitfalls 35）**
- `tools/check_offline.py`：`.json.gz` 透明解压后再扫，覆盖率不因压缩下降（实测「文件 288 个 / 同源数据 270 个 / 预压 .gz 解压扫描 269 个」），
  报告新增 `gzFiles`
- `tools/selfcheck.py`：`bundle_evidence()` 分片体积 `.json.gz`/`.json` 两种后缀都认并记 `shardSuffix`；
  新增 `droppedLeftovers`（白名单外分包名出现在 `assets/` 即不过）；
  **新增两条断言**——`dist_size_evidence()`（总体积 ≤ 基线 60% + 分族数字 + 产物内不得残留明文数据拷贝 / `_report.json` / `raw/`）
  与 `ship_integrity()`（270 个文件与 `data/` 源逐字节等价 + 无孤儿文件）；截图目录切 `_work/shots-batch6/`
- `tools/selfcheck_probe.mjs`：路由 glob 从 `**/dist/search-*.json` 改 `**/dist/search-*`（旧写法匹配不到 `.json.gz`，
  loading 态断言会静默失效）；**新增一条断言**「白名单外图型不打包且回退源码 + 一行原因」

**阶段 D · 发布包与文档**
- `docs/deploy.md`（新）：目录形态与逐文件体积、分族收敛对比表、对 Sites 配额的核对
  （单目录最多 129 文件 / 限 10,000；最大单文件 1.45 MiB / 限 50 MiB；总量 9.85 MiB / 限 450 MiB；无 Worker）、
  部署命令序列（`prepare_site --webDirectory "dist"` → `get_publish_status` → `publish_site`，`webDirectory: "."` 会被拒、
  远端不跑构建所以必须先本地 `npm run build`）、五类排错（4.1 分片取不到 / 4.2 `.gz` 被透明解压 / 4.3 字体与 `--base` 前缀 /
  4.4 mermaid 不出图 / 4.5 手机仍是 3D）与第五节发布前门槛对照表
- `docs/pitfalls.md`：已验证 33–38 六条（插件静默空转、收敛前提实测推翻、`.gz` 让门槛脚本瞎掉、
  透明解压与 SPA 回落、5 类≠5 个分包、`publicDir` 一刀切废掉 dev）+ 排查顺序 23–27 五条
- `docs/schema.md`：新增第八节「产物落盘形态」——四条契约（一一对应不改字段、只剔零请求族、后缀即形态信号、读侧两种形态都吃）
- `docs/design.md` / `docs/sites.md` 未动（本批不涉设计与站点清单）；`README.md` 状态表、体积实测、门槛项数、目录树同步；
  `agents.md` 批次表拆成「6 打包收敛 完成 / 6.1 发布 待执行」并加 `deploy.md` 索引

## 自检（任务书 10 条逐条）

- [x] `dist/` 总体积 ≤ 本轮开始前的 60%，且给出分族对比表 — **9.85 MiB / 43.1%**（门槛值 13.70 MiB），
  上表逐族「前 / 后 / 差 / 手段」四列齐全；门槛项 PASS 且把分族 JSON 打进报告 `distSize`
- [x] 一本 `full` 的书仍能打开，正文按需加载没被误删 — `full 正文渲染且 KaTeX 生效` PASS（`food-math`，
  KaTeX 116 处、3,533 字）；`正文按需加载：全程 bodies 请求数 ≤ 打开过的本数` PASS，实测 **bodies 16 次 / 去重 11 本**，
  且全部是 `.json.gz`；129 个 bodies 文件一个没少（文件数前后均 129）
- [x] 某个区的 3D 立柱与光点照常建立 — `数学区章节立柱与概念光点已建` PASS：**books 45 / 立柱 265 / 光点 398**，
  分区帧率 165.2、三角面 3,874；结构分片 `dist/math.json.gz` 实取到（40.3 KB 片）
- [x] 检索照常：六区各命中一条且落点正确 — math 23 / ai 20 / chem 15 / cs 22 / general 19 条命中全落本区，
  三类分组、`file` 精确落点（重名 31 个里取对那本）、返程位姿漂移 0；
  **tools 区库里 0 本无关键词可取**，走空片容错断言（分片取到、`counts.books=0`、专属文案）——不为过判据改 `data/`
- [x] 五种图型本地出 SVG，未打包图型回退源码 — 五类逐条 `state:done / svg:true / 远程引用 0`；
  同章 2 围栏 chunk 数 10 → 10 只载一次；坏语法仍回退（源码 21 字 + 原因 106 字）；
  新断言实测未打包类型原因 `zhishu: 图类型 "classDiagram" 未打包（只保留 flowchart / graph / sequenceDiagram / mindmap / xychart-beta）`
- [x] `python tools/selfcheck.py` 全绿，且没靠删断言达标 — **74 项全绿**（上批 71 → 本批 74：新增体积门槛、
  预压等价性、白名单外图型回退三条）；无一条删除或放宽，`SEARCH_MAX_KB=300`、帧率 ≥45、60% 阈值原样
- [x] `python tools/check_offline.py` 0 违规 — 「违规 0 处 · 白名单 xmlns 6 / 保留域名 2 / 字面量 47 / 数据 174 · 文件 288」；
  字面量与数据计数比上批（106 / 200）低，原因是**产物里真的少了 43 个分包和 `_report.json`**，不是扫描范围缩小：
  269 个 `.gz` 解压后照扫，`data` 类命中 174 处全部来自解压后的 JSON 内容
- [x] `python tools/verify_data.py` 全绿 — 五类 23 项，退出码 0（校验对象是 `data/` 明文源，本批未触碰）
- [x] `tsc --noEmit` 零错 + `npm run build` 成功 — 均 PASS；构建含 `zhishu:ship-data` 与 `zhishu:mermaid-whitelist` 两插件
- [x] `docs/deploy.md` 存在且数字与真实 `dist/` 一致 — 表内每个字节数、每片体积、配额核对均取自本次实测
  （`distSize` / `bundle` / `offline` 三块报告），无估算值

## 待决策

1. **发布动作本身**（唯一没做的事，属必须停的第 3、4 类）— 需账号且为远端写操作。
   路径与命令已写进 `docs/deploy.md` 第三节，产物已就绪（347 文件 / 9.85 MiB，`webDirectory: "dist"`）。
   另需人工确认一件事：**Sites 托管层对 `.gz` 是否加 `Content-Encoding`**，文档没有记载（我查遍
   `sites-building/hosting/management` 三份 SKILL 与 references，零命中）。两种情况客户端都能读，
   但上线后应按 deploy.md 4.1/4.2 的 `curl -sI` 实测一次，把结论回写进文档。
2. **`katex` 在产物里有两份**（新发现，本批未动）— 本项目直依赖 `katex@0.16.47` 烤进 entry，
   `mermaid@12.3.0` 自带 `katex@0.18.11` 是 `assets/katex-*.js`（256 KiB，只在 mermaid 闭包里）。
   合并要加 `overrides` 统一版本并回归 mermaid 的公式标签，属功能变更不属打包收敛。
   选项：A 保持两份（现状，代价 256 KiB 且只在有图时取）；B 统一版本后回归测试。
3. **检索摘要字段仍大面积为空**（前置 2，按要求本批不处理，如实记录）— `chapters[].core` 78/1,169、
   `concepts[].brief` 100/765 非空。补齐要重跑抽取器（第 1 类停），用正文反推摘要违铁律 7。
   建议单排一次抽取增强轮，不在批 5 里顺手做。

## 下一步建议

进批 5 生成层：库里查不到再现场生成。入口位仍在 `src/search.ts` 的 `none` 态与 `src/panel.ts` 的 `stats-only` 支。
三条硬约束别忘了——生成内容标「AI 现场生成 · 未经校验」、带 `source: 'ai-generated'` 落库、
**不写进 `data/dist/search-*.json`、不进依赖图、不与库内内容混排**；门槛建议加一条
「生成内容不出现在检索结果与图示队列」。

批 5 之后收尾一次跑全部门槛；发布（6.1）之前务必 `npm run build` 出**新鲜** `dist/`——
`prepare_site` 只上传快照、远端不跑构建，旧产物会原样上线。交付与收尾一律完整重跑，
别用 `--skip-build`（复用旧 `dist/` 会把已修的改动验成失败，pitfalls 31）。
