# 结果：批3 阅读层 + 数据校验门槛 + 批2 交互三项 + 文档口径重算

## 状态
done — 自检 39 项全绿（`python tools/selfcheck.py`，50.7s，报告 `_work/selfcheck-report.json`）

## 做了什么

**阶段 A · 数据门槛**
- 新增 `tools/verify_data.py`（356 行）：四类 18 项断言——totals 与 `sites/`/`bodies/`/`dist/` 实际文件数、
  `schemaVersion` 全为 2、必填字段（`slug`/`title`/`chapters`/`totals`）不缺不为 null、`repo+bookSlug` 唯一。
  全绿退出码 0；另造 6 个变异副本（改 totals、删 schemaVersion、抹 slug、截分片等）逐个跑必红，证明脚本在真检查
- 脚本只读 `data/`，`--data-dir` 指向变异副本，不落库任何写操作

**阶段 B · 文档口径重算**
- `README.md`：状态表改成实际（批 1/2/3 done、批 4/5/6 pending），补规模实测「独书 96 · 条目 129 · 章 1,169 ·
  概念 765 · 题 3,541 · 卡 4,100 · 术语 4,100 · 265 文件 / 15.3MB」，「怎么开始」换成可执行三步（含 selfcheck）
- `docs/design.md`：第三节规模假设按实测重写（12.2 章/独书，旧「650 章/415 概念」标失效）；
  第三节补「光点只能反查 `concepts[].chapterIds`」；第四节前置链补全库口径（概念 428/765、章 372/1,169）；
  第五节详情层三档分流表 + `depth` 82/765、`claims` 0/765；第六节性能落实测（大厅 1,398 面 / 数学房 3,874 面、
  10s 采样 165fps、15 万面预算）
- `docs/pitfalls.md`：已验证新增 16–23 共八条（`hidden` 布尔属性、概念挂载字段取错、`bookSlug` 跨仓重名 31 个、
  Windows 下 `npx` 是 `.cmd`、成品 HTML 长度基准、headless 帧率不受 vsync 封顶、地面标签可读性四因、
  `stats-only` 库里 0 本只能造调用侧样本）；待验证 2 由「三站」升级为「全库铺开已定案大半」并列出七项实测；
  排查顺序补 11–16 六条前端项
- `tools/README.md`：`extract.py` 状态去掉「未写 data/」的过期表述，登记 `verify_data.py` / `selfcheck.py` /
  `selfcheck_probe.mjs`，Node 依赖行由「只有数独需要」改为「数独 + 自检探针」

**阶段 C · 阅读层**
- 新增 `src/render.ts`（218 行）：markdown-it + KaTeX（npm `katex@0.16.47` 打进 bundle，非 CDN）
  双定界符 `$...$` / `\(...\)` / `$$...$$` / `\[...\]`，`throwOnError:false` 解析失败保留原文；
  `bodyType:"html"` 直注入不过 markdown-it；微信外链渲染期转纯文本 span + 「原文链接，已保留未加载」
- `src/data.ts`：`loadBody()` 点开才取，inflight 去重 + Map 缓存，129 个 bodies（7.4MB）零预取
- `src/panel.ts`（391 行）：书籍总览 / 章节正文 / 概念详情三态 + 面包屑 + 返回栈；
  `full` / `degraded`（降级条「正文为成品 HTML，公式不可还原」+ 题目数）/ `stats-only`（只给计数与来源）三档分流，
  都不白屏；Mermaid 围栏本轮显式为「源码 + 未渲染说明」
- `src/layout.ts`：`conceptsByChapter()` 按 `chapterIds` 反绑（765/765 可解析），弃 15/1,169 的 `conceptIds`
- `src/main.ts`：3D 光点→概念正文、章节立柱→直接进该章、`openStatsOnlySample()` 内存覆写档位
- `src/styles.css`：+260 行阅读层与小地图样式；390px 下含公式正文 `scrollWidth === 390`

**阶段 D · 批 2 交互三项**
- 小地图：`index.html` 加 `#minimap` canvas，`main.ts::drawMinimap()` 画六区色点 + 129 书目方块 + 当前相机位姿与朝向，
  标题随大厅/房间切换；房间视图隐藏
- WASD/方向键平移（QE 升降）不改朝向，`inputBusy()` 在面板打开、输入框聚焦、帧率采样期让位
- 走廊地面学科名：六条 `PlaneGeometry` 贴地，文字基线沿走廊走向，`Fog(560,1300)` + `y=0.62` + `anisotropy 4` +
  96px 阴影字；`viewCorridor()` / `corridorScreenBox()` 供逐条取证截图

**自检常驻化**
- 新增 `tools/selfcheck.py`（189 行）+ `tools/selfcheck_probe.mjs`（449 行）：verify_data → `tsc --noEmit` →
  `vite build` → 起本地服务 → 无头 Edge（`playwright-core`，桌面 1440×900 + 移动 390×844）跑 32 条断言，
  逐条打印，任一失败退出码非 0；样本由 `pick_samples()` 每次从 `data/bodies/` 现选
- 证据：`_work/shots-batch3/` 14 张（六条走廊 + 大厅 + 房间 + 四种阅读层状态 + 390 阅读页）

## 自检（任务书 11 条逐条）

- [x] `verify_data.py` 四类全绿、退出码 0 — 实测输出「结论：全绿」；6 个变异副本必红
- [x] README 状态表与 design 规模数字按实测更新，无「待批 1/2」残留 — 全库重算 96/129/1,169/765/3,541/4,100/4,100
- [x] 任意一本任意一章可打开，正文来自 `data/bodies/`，实测 3 种以上形态 —
  full `food-math`(md, 3,735 字) / concept `bronstein-handbook`(1,171 字) / degraded `sudoku-zhishu`(html, 784 字)
  / stats-only 合成样本；全程 bodies 请求 7 次 / 总请求 29 次
- [x] `$...$` 与 `\(...\)` 都渲染，KaTeX 来自 bundle 非 CDN — 实测 `katex:116`、`display:2`、`raw:0`；
  字体请求 `/assets/KaTeX_Main-Regular-B22Nviop.woff2` 同源；合成样本走查 `\(...\)`、`\[...\]`、`<details>` 均渲染且内容不丢
- [x] degraded 与 stats-only 不显示空正文、不白屏 — degraded 609 字总览 + 784 字正文 + 题目数；
  stats-only 95 字「仅计数，无正文 / 8 章 8 概念 19 题 40 卡 + 来源」
- [x] 微信外链纯文本、点击零请求 — `anchors:0`、`spans:2`、`newRequests:0`；库里 13 处 / 11 章
- [x] 小地图、WASD、走廊学科名三项可用 — 小地图 ink 像素 2,309 + 六区已标；WASD 位移 44.3 且朝向点积 1.000；
  六条走廊名正对视角宽高比 8.5–13.1、宽 421–926px 全部可读
- [x] 10 秒采样帧率 ≥45 — 大厅 165、数学房 164.9；三角面 1,398 / 3,874 远低于 15 万预算
- [x] 控制台零报错、页面异常零条 — `consoleErrors:[]`、`pageErrors:[]`、`requestfailed:[]`
- [x] 运行时零外部请求 — 桌面与移动两 context `external:[]`（Three/KaTeX/markdown-it 全打进 bundle）
- [x] `tsc --noEmit` 零错、`npm run build` 成功 — 均 PASS

附加铁律项：390px `scrollWidth === 390`（大厅 390/390/390，阅读层含公式仍 390/390/390）、
触屏自动降级 2D SVG 且未加载 Three.js、`data/` 未被业务代码写入。

## 待决策

1. **Mermaid 何时真渲染** — 本轮显式画成「源码 + 未渲染说明」（855 章含围栏，占比 73%）。
   选项：A 批 6 引 `mermaid` vendor 并做懒渲染（首屏包体会涨，需重测帧率）；B 抽取期预渲染成 SVG 入 `bodies/`
   （要重跑抽取器，属必须停的第 1 类）。
2. **阅读层与 3D 的收口** — 现在侧栏 + 全屏阅读双模式并存。选项：A 保留（桌面快读 / 手机全读）；
   B 桌面只留全屏阅读页，减一条状态机。
3. **`check_offline.py` 是否还单列** — 运行期请求监听已由 `selfcheck.py` 覆盖，静态扫描（构建产物里搜远程 URL）
   仍是批 6 需要的另一半。选项：A 批 6 只补静态扫描；B 把两类都收进 `check_offline.py`，selfcheck 调它。

## 下一步建议

进批 4 检索层：`MiniSearch` 走 npm 打进 bundle，索引按学科分片（`data/dist/*.json` 已有 5 片，tools 缺片容错沿用），
搜索命中直接跳 `openChapter`/`openConcept`——这两个入口本轮已带 `file` 精确取书，检索层不需要再处理 slug 重名。
门槛沿用 `python tools/selfcheck.py`，批 4 只需往 `selfcheck_probe.mjs` 追加检索断言。
