# 结果：批3.5 Mermaid 真渲染 + 批4 检索层 + 离线扫描统一

## 状态

done — 自检 71 项全绿（`python tools/selfcheck.py`，102.6s，报告 `_work/selfcheck-report.json`，截图 `_work/shots-batch35/` 25 张）
数据门槛 `python tools/verify_data.py` 五类 23 项断言全绿；离线扫描 `python tools/check_offline.py` 违规 0 处。
任务书 14 条完成判据逐条过，无「接近完成」。

## 做了什么

**阶段 A · Mermaid 真渲染（决策 1 落地：不等批 6）**
- `npm i mermaid@12.3.0`，`src/diagram.ts`（144 行，新）用**动态 `import('mermaid')`** 分包：
  entry `index-BOvDw5BJ.js` 428.26 kB 内静态闭包只有 1 片、实现标记（`detectType`/`getDiagramFromText`/
  `mermaidAPI`/`registerLayout`/`addDirective`）命中 **0**；`mermaid.core-DrMdr0z5.js` 671.86 kB 加它展开的
  **57 片 / 5,106KB** 只在阅读页第一个围栏可见时才取（A1、A5）
- `src/render.ts` 的 `lang === 'mermaid'` 分支从「直接吐源码」改成出**占位容器**：`data-diagram="pending"` +
  `<details class="diagram-src">` 保源码 + 标题条「本地渲染，滚动到此处自动出图」；
  `hydrateDiagrams()` 用 `IntersectionObserver(rootMargin 160px)` 登记成 `watching`，可见那一刻才渲染成 SVG，
  离开阅读页 `forgetDiagrams()` 摘观察器（A2）
- 失败支不空容器：语法错 / 不支持类型 / 分包取不到 → `data-diagram="error"` + 源码 `<pre>` + 一行原因，
  标题条改「渲染失败已回退源码」；`renderDiagram()` 返回 `{svg, error, kind}` 而不抛错，坏源码可直接喂探针（A2）
- 同章多围栏只加载一次模块（串行渲染队列 + 模块级 promise 缓存）：2 围栏章节滚完，chunk 数 17 → 17 不变（A2）
- 抽样按**库里实际出现的 5 种图型**各验一章，不硬造：`flowchart` 818 / `graph` 55 / `sequenceDiagram` 6 /
  `mindmap` 2 / `xychart-beta` 1 围栏（全库 855 章含围栏、882 个围栏、出自 77 本），五种全部本地出 SVG、
  远程引用 0 处（A3、A4）。库里没有 classDiagram / stateDiagram，未伪造
- 产出 SVG 过 `sanitizeSvg()`：留 `<style>`，剔 `script` / `on*` / 远程 URL 属性；`securityLevel:'strict'` +
  `htmlLabels:false`（A4）
- 帧率复核（mermaid 已进运行时的状态下测）：大厅 165.1fps、ai 区 164.4fps，三角面大厅 1,398 /
  数学区 3,874 / ai 区含图 6,082，均在 15 万预算内；大厅与 3D 分区阶段实测零 mermaid chunk、零请求（A5）

**阶段 B · 离线检查统一（决策 3 落地）**
- 新增 `tools/check_offline.py`（176 行）：静态扫 `dist/` 全部 332 个文件的远程 URL，按「资源加载位点 /
  `xmlns` 声明 / 代码块与 JSON 字面量内 / `example.*`·`localhost`·`127.0.0.1` 保留域名 / 纯数据」分类，
  **只有资源加载位点上的远程 URL 判违规**——沿用铁律三类白名单，不按字符串出现次数判
- `tools/selfcheck.py` 调它并把结果并入报告（`rep["offline"]`）：实测「违规 0 处 · 白名单 xmlns 6 /
  保留域名 2 / 字面量 106 / 数据 200 · 文件 332」，非零退出码即门槛不过

**阶段 C · 批 4 检索层**
- 新增 `tools/build_search_index.py`（156 行）→ `data/dist/search-<area>.json` 六片（C1）。
  字段 `slug/file/repo/title/area` + `chapters[]{id,title,core}` + `concepts[]{id,name,brief}` + `terms[]{t,d,c}`，
  超 300KB 才丢长描述；实测 `trim=full` 未触发降级，最大 ai 281.2KB（math 134.5 / chem 36.4 / cs 65.8 /
  general 53.3 / tools 0.3）。tools 区库里 0 本照样出空片，不新增 `data/` 一级子目录、不动已有 5 片结构分片
- `tools/verify_data.py` 升到五类 23 项：新增 `check_search_shards()` 验六片齐、单片 ≤300KB、`counts` 与数组
  长度及 `manifest.sites` 条数三方对账、`file` 在 `data/sites/` 真存在、`terms[].c` 必须落在同书章节 id
- 新增 `src/search.ts`（496 行）：MiniSearch 走 npm 打进 entry（用 `autoVacuum` 作指纹，命中仅 entry 一片）；
  大厅/分区只用 manifest 级 129 条轻索引，进学科搜索才取该区 `search-<area>.json` 建索引，inflight 去重、
  缺片容错（C2）。中文按「单字 + 二字组合」切词——MiniSearch 默认按空白切，中文不加空格必然匹配不上
- 交互（C3）：`/` 与 `Ctrl+K` 都能唤起并聚焦输入框、Esc 收起；结果分「章节 / 概念 / 书」三组各 ≤10 条、
  总 ≤24 条，带落点书名与区；`empty/loading/ready/none/error` 五态各有文案，空片区专说「库里 0 本」；
  390 视口弹层宽 370px、结果行 `ellipsis`、`scrollWidth === 390`
- 精确落点：命中带 `file`，`openFromSearch()` 按 `manifest.sites.find(s => s.file === hit.file)` 取书再走
  `openChapter`/`openConcept`——绕开 **31 个跨仓重名 `bookSlug`**（拿 `agentic-design-patterns` 两份镜像实测，
  15 条命中里精确取到点的那本）
- 返程落点（C4）：`searchSpot` 存「所在区 + 相机位姿 / 2D 平移 + 选中书目」，`openFromSearch()` 每次跳转都重记，
  `enterRoom()` / `showHall()` 立即作废；实测返回后 `math → math`、**位姿漂移 0.000**、选中书目复原
- `index.html` + 搜索弹层 DOM、`src/styles.css` +242 行（含 390 溢出修复）、`src/types.ts` +57 行检索契约类型

**自检扩项（39 → 71 项）**
- `tools/selfcheck.py`：新增 `bundle_evidence()`（分包闭包 + mermaid 实现标记 + minisearch 指纹 + 分片体积）、
  `offline_evidence()`、`pick_diagram_samples()`（按库里实际图型取书）、`pick_search_samples()`
  （31 个重名 slug + 逐区关键词 + 空片区），门槛项从 5 条增至 8 条
- `tools/selfcheck_probe.mjs`：+438 行、71 条断言。新增图型懒加载五证（大厅零 chunk / 分区零 chunk /
  重载后零 chunk / 占位容器无 SVG / 可见那一刻才加载分包）、五类图逐条出 SVG + 零远程、多围栏只载一次、
  坏语法回退源码、mermaid 进运行时后帧率与三角面复测；检索侧新增分片懒加载、三类分组、五态文案、
  重名按 file 取书、C4 返程复原、390 弹层可用与无溢出、触屏点结果开正文

## 自检（任务书 14 条逐条）

- [x] 主 entry chunk 不含 mermaid，mermaid 独立 chunk 且懒加载（给 dist 文件名与体积）—
  entry `index-BOvDw5BJ.js` 428.26 kB / 静态闭包 1 片 / 实现标记 0；`mermaid.core-DrMdr0z5.js` 671.86 kB
  及其 57 片共 5,106KB；实测「大厅零 chunk 零请求」「3D 分区零 chunk」「重载后零 chunk」
- [x] 至少 5 种不同类型图渲染成 SVG，失败类型回退源码且不空容器 —
  `flowchart/graph/sequenceDiagram/mindmap/xychart-beta` 五种 `state:done`、`svg:true`；
  坏语法容器 `data-diagram="error"`、源码 `<pre>` 21 字 + 原因 106 字、`svg:false` 不空不白屏
- [x] 阅读页 mermaid 渲染后零外部请求 — 五类图「远程引用」逐条 0；桌面与移动两 context `external:[]`
- [x] 大厅与分区帧率 ≥45，三角面仍在 15 万内 — mermaid 已进运行时后大厅 165.1 / 分区 164.4fps，
  三角面 1,398 / 3,874 / 6,082
- [x] `tools/check_offline.py` 可跑，`selfcheck.py` 已调用并并入报告 — 门槛 PASS「违规 0 处 …文件 332」，
  报告含 `offline` 块
- [x] `data/dist/search-<area>.json` 六片生成、单片 ≤300KB — 134.5 / 281.2 / 36.4 / 65.8 / 53.3 / 0.3 KB，
  `verify_data.py` 对账全绿（tools 出空片而非缺片）
- [x] 六个学科各至少一个关键词命中、跳转落点正确 — math 23 / ai 20 / chem 15 / cs 22 / general 19 条命中且
  全部落在本区；**tools 区库里 0 本，无关键词可命中**，改走「空片容错」断言（分片取到、`counts.books=0`、
  文案「工具间 区库里 0 本（分片是空的），换到其他学科再搜」）——不为过判据改 `data/`
- [x] 首屏不加载全部六片索引（实测请求证据）— 首屏检索分片请求 0；「查一区拉一片」`loadedBefore→loadedAfter`
  每区 +1，桌面全流程实际请求 6 片、每区一片
- [x] 空查询 / 无结果 / 加载中三态可见 — `empty` / `none` / `loading` 各有专属文案且 `results.hidden=true`，
  不白屏（无结果态用拉丁乱码 `zxqvkjz` 验，中文乱码会被高召回命中，见 pitfalls 25）
- [x] 390 视口搜索面板无横向溢出 — `doc:390`、弹层 `left 10 / right 380 / w 370`、结果行 `ellipsis`；
  触屏点结果开正文 5,970 字且收起后仍 390
- [x] 控制台零报错、页面异常零条 — `consoleErrors:[]`、`pageErrors:[]`
- [x] 运行时零外部请求 — 桌面 + 移动两 context 均 `external:[]`（Three/KaTeX/markdown-it/MiniSearch/mermaid 全本地）
- [x] `tsc --noEmit` 零错、`npm run build` 成功 — 均 PASS（构建 21.2s）
- [x] `tools/selfcheck.py` 全绿，新增断言覆盖本批 — 71 项全绿、退出码 0

附加铁律项：390px `scrollWidth === 390`（大厅 / 含公式阅读层 / 搜索弹层三处都量）、触屏自动降级 2D 且未加载
Three.js、公式仍全走 KaTeX、`data/` 未被业务代码写入（新增的 6 片是 `build_search_index.py` 产出）。

## 待决策

1. **`dist/` 24MB 里 16.7MB 是数据拷贝** — `publicDir: 'data'` 把 `bodies/`(7.8MB)、`sites/`(4.1MB)、
   `dist/`(4.7MB) 整份复制进构建产物，代码与分包只占 `dist/assets` 7.3MB。发布前必须收敛。
   选项：A 批 6 只放结构分片 + 检索分片进产物，正文走按需资源目录；
   B 换 `base` + 分片外置到 Sites Storage。（本轮不动，属批 6 打包范围）
2. **检索摘要字段大面积为空** — `chapters[].core` 仅 78/1,169、`concepts[].brief` 仅 100/765 非空〔X〕，
   检索实际靠「标题 + 术语释义」命中。补齐要重跑抽取器（属必须停的第 1 类改动 + 违「不重跑抽取器」硬约束），
   用正文现编摘要违铁律 7「抽不到留空、禁止推测」。建议批 5 之后单独排一次抽取增强，本轮如实记录。
3. **mermaid 首屏外 5.1MB 分包的发布形态** — 本地/自托管没问题（实测同源、零远程），
   但 Sites 发布时这 57 片要不要一起上、是否按需只保留库里实际用到的 5 种图型子包（可省 ~4MB）。
   选项：A 全量带上，兼容性最好；B 按 `MERMAID_KINDS` 白名单裁剪并加缺失回退（已有回退源码支）。

## 下一步建议

进批 5 生成层：查不到再现场生成——`src/search.ts` 的 `none` 态与 `src/panel.ts` 的 `stats-only` 支
已留出入口位（「换到其他学科再搜」文案处），生成结果按铁律标「AI 现场生成 · 未经校验」、
写入 Sites Agent App 数据库带 `source: 'ai-generated'`、**不进检索分片也不进依赖图**。
门槛继续用 `python tools/selfcheck.py`（生成层建议往探针里加「生成内容不出现在检索结果与图示队列」一条）。
另注意：交付与收尾一律完整重跑，别用 `--skip-build`——它复用旧 `dist/`，会把已修的改动验成失败（pitfalls 31）。
