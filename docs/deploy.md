# 发布包说明（批 6 阶段 D）

只讲两件事：**产物长什么样、怎么把它交出去**。数据契约在 `docs/schema.md`，空间与交互在 `docs/design.md`。

本文件里的每个数字都是 2026-11-25 对当前 `dist/` 的实测（`python tools/selfcheck.py` 的 `distSize` 段），不是估算。

---

## 一、目录形态

```
dist/
├─ index.html                 2,888 B，入口，零外链
├─ manifest.json              55 KB，明文，首屏引导唯一必读的数据
├─ assets/         76 个 5.21 MiB   JS / CSS / 字体，全部构建产出，无 vendor 目录、无 CDN
│  ├─ index-*.js              403 KiB  主 entry：MiniSearch + KaTeX 0.16 + 阅读层 + 检索交互（首屏唯一必载 JS）
│  ├─ scene3d-*.js            563 KiB  Three.js 分包，触屏 / <768px 不加载
│  ├─ mermaid.core-*.js       650 KiB  mermaid 内核，第一个可见围栏才取
│  ├─ elk-*.js              1,483 KiB  flowchart 默认布局（最大单文件 1.45 MiB）
│  ├─ cose-bilkent-*.js       520 KiB  mindmap 布局
│  ├─ katex-*.js              256 KiB  mermaid 自带的 KaTeX 0.18 副本，只在 mermaid 闭包里，随它一起取
│  ├─ flowDiagram / sequenceDiagram / xychartDiagram / mindmap-definition / dagre / chunk-*
│  └─ KaTeX_*.{woff2,woff,ttf}        字体同源，随 CSS 的 url() 引用
├─ bodies/        129 个 2.77 MiB   正文，`<repo>--<slug>.json.gz`，进阅读页才取（判据 C1）
├─ sites/         129 个 0.86 MiB   单本结构，点书 / 检索命中才取
└─ dist/           11 个 0.95 MiB   两类分片：
   ├─ <area>.json.gz                结构分片 5 片（进分区取）
   └─ search-<area>.json.gz         检索分片 6 片（在该区发起搜索才取）
```

三条必须知道的形态约定：

1. **数据是预压的 `.json.gz`，不是 `.json`。** 构建插件 `zhishu:ship-data`（`vite.config.ts`）把 `data/` 里运行时真要取的族逐个 gzip 后落盘；
   客户端 `src/data.ts` 用 `DecompressionStream('gzip')` 还原。`manifest.json` 例外保持明文——引导链不能依赖解压能力。
2. **`data/` 源目录结构没动。** 落盘只改产物，`data/_report.json` 与 `data/raw/` 不进 `dist/`（实测运行期零请求，见 `docs/pitfalls.md`）。
3. **`dev` 与 `build` 两套形态，代码只有一处分支。** `vite.config.ts` 里 `publicDir: command === 'serve' ? 'data' : false`——
   dev 直接暴露明文 `data/`，`src/data.ts` 用 `import.meta.env.PROD` 决定要不要加 `.gz` 后缀。

## 二、最终体积

| 族 | 收敛前（本轮基线） | 收敛后 | 手段 |
|---|---|---|---|
| `assets/` | 7.00 MiB / 119 文件 | **5.21 MiB / 76 文件** | mermaid 白名单裁剪，剔 43 个分包 |
| `bodies/` | 7.42 MiB / 129 | **2.77 MiB / 129** | 预压（7.42→2.77，3.5×） |
| `sites/` | 3.72 MiB / 129 | **0.86 MiB / 129** | 预压 + 保留运行期取用 |
| `dist/`（结构 + 检索分片） | 4.61 MiB / 11 | **0.95 MiB / 11** | 预压 |
| `manifest.json` | 0.05 MiB / 1 | 0.05 MiB / 1 | 保持明文 |
| `index.html` | 0.003 MiB / 1 | 0.003 MiB / 1 | — |
| `_report.json` + `raw/` | 0.02 MiB / 1 | **0** | 运行期零请求，不再拷 |
| **合计** | **22.83 MiB / 391** | **9.85 MiB / 347** | **43.1%**，门槛 ≤60% 达标 |

对照发布侧硬性配额（本站实测值 → 配额）：

| 项 | 本站 | 配额 |
|---|---|---|
| 单目录文件数 | 最多 129（`bodies/`、`sites/`） | 10,000 |
| 最大单文件 | 1.45 MiB（`assets/elk-*.js`） | 50 MiB |
| Web 静态原始体积 | 9.85 MiB | 450 MiB |
| Worker 产物 | 本站无 Worker | 50 MiB |

结论：体积与文件数都不构成发布障碍，无需再分片或降清晰度。

### 2.1 批 7–12 的逐批漂移

上表是批 6 的收口数，之后六批都在改渲染与空间，体积按 `python tools/selfcheck.py` 的 `distSize` 记账：

| 批 | `dist/` 合计 | 文件数 | 本批自设上限 | 说明 |
|---|---|---|---|---|
| 6 收口 | 9.85 MiB | 347 | — | 数据预压 + mermaid 白名单 |
| 7（PBR/灯光/图集） | 9.883 MiB | 347 | 10.6 MiB | 程序化纹理全在 canvas 里现算，零外部资产 |
| 8（阅览室 + 书脊图集） | 9.903 MiB | 347 | 10.6 MiB | +20 KiB，来自图集题签绘制与壳体几何 |
| 9（全端 3D + 光照修复） | 9.901 MiB | 347 | 10.6 MiB | −2 KiB：删 `src/svg2d.ts`（398 行 / 15,497 B） |
| 10（构图反算 + 大厅补光 + 题签收窄） | **9.912 MiB** | **347** | 10.6 MiB | +11 KiB：藻井环 8 扇几何、镜头挤压与机位反算、`subjectBox`/`hallLightProbe` 采样探针；零新增资产 |
| 11（第一人称漫游） | 9.93 MiB | 347 | 10.6 MiB | +18 KiB：`src/walk.ts` OBB 碰撞与滑动解算、漫游态材质对与石板地面、准星/摇杆两层 DOM 与 CSS；`walk.ts` 与 scene3d 同在一个动态 chunk，零新增资产、零新增分包 |
| 12（中央索引台 + 展柜） | **9.96 MiB** | **347** | 10.6 MiB | +30 KiB：`architecture.ts` 的 `buildAtrium`（八角台体 + 灯带环 + 台面圆盘 + 六座柜体/罩/15 根书脊，174 行）、`atlas.ts` 的 `indexDeskTexture`（1024² 台面方位图，66 行）、`config.ts` 的 `ATRIUM` 常量与 `scene3d.ts` 的装配/拾取/照明/HUD。零新增资产（台面图运行时现算、书脊复用批 8 图集第 0 页）、零新增分包、文件数仍 347 |

批 12 与批 11 一样是纯代码增量：几何全在 `GeoBuilder` 现建、纹理全在 canvas 现画（台面那张 1024² 不进产物，运行时生成），文件数 347 第六次保持不变。批 10 的 +11 KiB 全是代码：藻井环环带几何、竖屏镜头挤压（改投影矩阵后重算逆矩阵）、构图反算与采样探针，文件数仍 347——第五批零资产。批 9 删掉一整个视图模块却只省 2 KiB，是因为 svg2d 与 scene3d/atlas 同在 entry 的静态闭包里，
本批新增的构图解（`aspectRamp` / `fovForAspect` / `hallPose`）、画质档 `qualityTier`、
`frameCheck` 分组点集与 `spineProbe().px` / `sampleLuminance` 采样窗这些诊断读数落在同一批 chunk 上抵掉了。
文件数 347 不变 = 没有新增资产、没有新增分包，这条比总量更能说明「本批没往产物里添东西」。
逐文件的归因没做，只记净值。

## 三、部署步骤（按 Qoder Sites，本批不实际执行）

发布要账号，属人工步骤，本批只把路径写清楚。站点服务在**域名根**，所以 Vite 不需要 `base` 前缀。

```bash
# 0) 本地验收（必须全绿，判据见第五节）
npm ci
python tools/selfcheck.py          # 自带临时静态服务与 Edge 探针，跑完即关
python tools/verify_data.py
python tools/check_offline.py

# 1) 产出发布包
npm run build                      # 先 tsc --noEmit 再 vite build，dist/ 被 emptyOutDir 重建

# 2) 交给 Sites（Git Bash 环境；PowerShell-only 不支持）
#    prepare_site：webDirectory 必须是指向 dist 的相对目录，且不能是 "."（项目根会被拒）
sites prepare_site --input '{"projectRoot":".","webDirectory":"dist"}'
#    → 记下返回的 actionId / deploymentId（不可变快照，改内容就重跑一次拿新 id）
sites get_publish_status --input '{"actionId":"<上一步返回>"}'   # 确认 ready 且 canPublish
sites publish_site   --input '{"actionId":"<上一步返回>"}'
sites get_publish_status --input '{"actionId":"<同一个 actionId>"}'  # 必须读到 published: true
```

`prepare_site` 只上传快照，**不会远程构建**（官方文档原话：不跑构建命令、不解析 import、不做迁移），
所以第 1 步的 `dist/` 必须自己保证是最新且完整的。`_work/`、`node_modules/`、`data/` 都不属于 `webDirectory`，不会上传。

发布后的自检顺序：打开首页看大厅 → 进数学区（取 `dist/math.json.gz`）→ 点一本书开正文（取 `dist/sites/*.json.gz` + `dist/bodies/*.json.gz`）
→ 滚到 mermaid 围栏（此刻才拉 `mermaid.core`）→ 区内搜索（拉 `dist/search-<area>.json.gz`）。
Network 面板这五步应全是同源、无 4xx、无跨域请求。

## 四、排错

### 4.1 分片 404 / 取不到

症状与判定：

- 大厅有走廊、进分区却没立柱 → `dist/<area>.json.gz` 缺或 404。
- 搜索框提示「索引加载中」后变「没有命中」且书目数 0 → `dist/search-<area>.json.gz` 缺。
- 面板显示「正文取不到」条 → `dist/bodies/<file>.json.gz` 缺。

代码侧行为（`src/data.ts`）：结构 / 检索分片失败**降级为空而不抛错**（立柱为空、提示「区库里 0 本」），正文与 `sites/` 失败**走可见的降级条**。
两者都不是崩溃，所以别只看有没有白屏，要看 Network 的状态码。

坑：托管层若开了 **SPA 回落**，取不到的文件会以 `200 + text/html` 返回而不是 404。
`src/data.ts` 已对响应 `content-type` 做判定，命中即抛「拿到的是 HTML（产物缺这个文件）」而不是让 `JSON.parse` 报「Unexpected token '<'」。
命令行核对：

```bash
curl -sI https://<站点域名>/dist/search-cs.json.gz | grep -iE '^(HTTP|content-type|content-encoding)'
# 期望：200 + content-type 为 application/octet-stream / application/gzip（不是 text/html）
```

### 4.2 `.gz` 被透明解压

若托管层对 `.gz` 加了 `Content-Encoding: gzip`，浏览器会自动解压，`res.arrayBuffer()` 拿到的已是明文 JSON，再走 `DecompressionStream` 必炸。
`src/data.ts::gunzip` 先看前两字节是不是 gzip 魔数 `1f 8b`：不是就按明文处理。两种托管形态都能读，但**不要因此关掉预压**——
数据族 15.75 MiB 压成 4.58 MiB，关掉就退回那 11.17 MiB。

### 4.3 字体不显示 / 公式变成衬线 fallback

`assets/KaTeX_*.{woff2,woff,ttf}` 由 CSS 里的 `url(/assets/…)` 同源引用。三种情形：

1. 站点不在域名根（自定义子路径）→ 构建时必须带前缀：`npx vite build --base=/子路径/`。
   `src/data.ts` 的 `PREFIX` 取 `import.meta.env.BASE_URL`，数据与字体都会跟着走；漏掉 `--base` 的表现是资源全 404、公式退化。
2. 上传时 `webDirectory` 指错（指到项目根）→ `assets/` 整个不存在，`index.html` 里的 `<script type="module" src="/assets/index-*.js">` 404，页面白屏。
   `prepare_site` 会拒绝 `webDirectory: "."`，但指到别的相对目录它不会拦。
3. 老浏览器没有 `DecompressionStream`（Chrome < 80 / Safari < 16.4 / Firefox < 113）→ 数据读不出，`gunzip` 抛「当前浏览器不支持 DecompressionStream」。
   这是有意保留的显式失败，`manifest.json` 走明文所以首屏仍能起。字体侧无需处理：woff2 失败时 CSS 里配了 woff / ttf 逐级回落。

### 4.4 mermaid 不出图

- 图是源码 + 一行原因，标题条写「已回退源码」→ 正常。库里实际只有 5 类图型（flowchart / graph / sequenceDiagram / mindmap / xychart-beta），
  白名单外的类型（classDiagram 等）不打包，走的就是这条回退支，内容不丢。
- 5 类之内的也不出图 → 看 Network 有没有取 `mermaid.core-*.js`。没取 = 分包缺文件或 `assets/` 上传不完整；取了但失败 = 看 `.diagram-err` 文本，
  自检门槛会打印原因。
- 围栏一直停在「等待渲染」→ 视口没滚到位。渲染由 `IntersectionObserver` 触发，可见才渲，未可见只登记，这是设计不是卡住。

### 4.5 手机上白屏 / 卡死（批 9 起：移动端同样是 3D）

**没有降级视图了。** 批 8 及以前靠 `matchMedia('(pointer: coarse)')` 或宽度 < 768px 命中即改渲 2D SVG、
连 `scene3d-*.js` 都不加载；批 9 把这条路径整段删掉（`src/svg2d.ts` 398 行、`MatrixFlat`、`?flat=1`、`#svg-root`），
全端只有一条 3D 路径。窄屏不再换视图，只降画质：`qualityTier()` 一处给两档，
`desktop` = dpr ≤2 / 阴影 2048 / 光尘不限 / bloom 0.65× / 帧缓冲 0.85，
`mobile` = dpr ≤1.5 / 关阴影 / 光尘 220 / 关 bloom / 帧缓冲 0.72；机位与 fov 另按 aspect 自适应（`docs/design.md` 第七节）。
所以「手机上看到的是 3D」现在是**预期行为**，不是异常。

白屏按这个顺序查：

1. **WebGL 能不能建上下文**：控制台若有 `THREE.WebGLRenderer: Error creating WebGL context` 即不支持或被禁用。
   系统 WebView / 老版本微信内置浏览器关掉硬件加速时会出现。`window.__zhishu.mode` 停在 `null` 就是这一步没过去。
2. **是不是卡在画质档之外**：`window.__zhishu.quality()` 打 `name / dprCap / pixelRatio / shadows / bloom / renderScale`。
   dpr 明显高于 1.5 说明窄屏判据没命中（`window.innerWidth` 被托管层的 viewport 改写挤掉了），先核对 `index.html` 的
   `<meta name="viewport">` 是否还是原样——托管层会往 `</body>` 前注入水印脚本，改 viewport 的注入同样在这条链上。
3. **是不是一帧都没出**：`window.__zhishu.fps()` 为 0 且 `running()` 为 true → 看 `census().room` 与 `frameCheck()`，
   多数是该区的图集/几何没建起来（数据文件 404，见 4.2），不是渲染器问题。
4. **只是慢不是白屏**：`fps()` 在 390×844 实测大厅 165、数学区 146（门槛线 30）。掉到 30 以下先确认 bloom 与阴影确实关了。

阅读层不受影响：正文仍是 HTML + KaTeX，窄屏下 `scrollWidth === 390` 由门槛单独把一条。

## 五、验收判据（发布前门槛）

`python tools/selfcheck.py` 一条命令覆盖，跑完打表。本批相关的五条：

| 判据 | 实测 |
|---|---|
| `dist/` 总体积 ≤ 本轮基线 22.83 MiB 的 60% | 9.85 MiB（43.1%），且产物内不再有明文数据拷贝、无 `_report.json` / `raw/` ；批 12 收口涨到 **9.96 MiB（43.6%）**，逐批增量见 2.1 |
| `.json.gz` 解压后与 `data/` 源逐字节等价 | 核对 270 个文件，不一致 / 源缺 / 产物凭空多 均为 0 |
| 白名单外图型分包不得出现在 `assets/` | `droppedLeftovers` 为空 |
| 检索分片六片齐且单片 ≤300KB（`.json.gz` 形态） | 最大 ai 93.7KB |
| 产物零运行时远程加载位点 | 违规 0（`.gz` 会被透明解压后一并扫描，覆盖率不因压缩下降） |

另有两条行为判据由探针实测，收敛数据族后仍全绿：`full` 档书目能开且正文按 `.json.gz` 按需取（全程 16 次 bodies 请求 / 去重 11 本）、
3D 分区立柱与光点照常建立（math 区 265 柱 / 398 点）。白名单外图型的回退也在探针里点名验：
注入一条 `classDiagram` 围栏，取到的原因文本是 `zhishu: 图类型 "classDiagram" 未打包（只保留 …）`，容器给源码不出 SVG。

---

## 六、上线实测（2026-11-25 首次发布）

**站点** `https://zhishu-matrix-9hy96msjm5u.qoder.zone`，快照 9.85 MiB / 347 文件，`published: true`。

访问策略先落到 `private`，外部请求全部 401；改 `public`（`update_access_policy` + `confirmPublic`）后才可外访。这是发布链路里唯一需要额外一步的地方。

三条此前无法在本地确认、这次有了实测答案：

1. **`.json.gz` 不带 `Content-Encoding`。** 托管层返回 `200 + application/octet-stream`，不做透明解压。也就是说 4.2 描述的两种情形落在「不加头」这一支，客户端的 gzip 魔数判定 + `DecompressionStream` 是唯一生效路径——这条现在是那个分支，不是兜底。
2. **托管层会往 `index.html` 尾部注入水印脚本。** 本地 2,888 B 的入口上线后 59,730 B，注入内容是一段内联的水印徽章（shadow DOM，右下角，可关，点击才跳 `qoder.cn`），**不产生远程加载**，也不包裹原有 script。`check_offline.py` 扫的是本地 `dist/`，这笔注入不在它的覆盖范围内，只能靠本节记录。
3. **端到端五步全通。** 单次会话 19 个请求、非 2xx 为零、外部域名为零、控制台与页面报错为零：

| 步骤 | 线上实测 |
|---|---|
| 大厅 | `mode=three`，129 站 / 1,169 章 / 765 概念，六条走廊名 |
| 数学区（取 `dist/math.json.gz`） | 45 书 / 265 立柱 / 398 光点，三角面 3,874 |
| 开正文（取 `sites/` + `bodies/` 的 `.gz`） | `food-math` ch01：116 处 KaTeX、3,533 字，`raw` 回退 0 |
| mermaid 围栏（首次可见才取分包） | `flowchart` 出 SVG 20,102 B，`state=done`，无回退原因 |
| cs 区检索（取 `dist/search-cs.json.gz`） | 「算法」21 命中，章节 / 概念 / 书三类齐全 |
| 390 触屏 | `mode=flat`，`scrollWidth` 390（批 8 及以前的线上实况；批 9 删掉降级路径后同一格变成 `mode=three`） |

验证脚本 `_work/probe-online.mjs`（`node _work/probe-online.mjs`，可用 `PROBE_BASE` 换站点），原始结果 `_work/probe-online.json`，截图 `_work/shots-online/` 六张。

发布后仍无云端 CDN、无外部字体、无第三方脚本（水印除外）。

## 七、再次发布的固定流程

改完内容后重发，`dist/` 必须是新的：

```bash
npm run build
qodercn sites prepare_site --input '{"actionId":"<新 UUID>","projectRoot":".","webDirectory":"dist"}'
# descriptorStatus 为 pending 时，用同一 actionId + 完全相同的入参再跑一次
qodercn sites get_publish_status --input '{"actionId":"<同一个>"}'   # 需 canPublish: true
qodercn sites publish_site      --input '{"actionId":"<同一个>"}'
qodercn sites get_publish_status --input '{"actionId":"<同一个>"}'   # 需 published: true
```

同目录已有绑定，重发**不要**再传 `createNewSite`；内容变了必须换新 `actionId`（旧的快照不可变）。

## 八、第二次发布（批 8 上线，2026-11-25）

快照 **9.903 MiB / 347 文件**，`actionId` `bae90e4a-f301-48cb-9d6f-ff41a56b38dd`，`publishOperationId` `01a2133f-f7a0-7c38-b909-659ae308cd02`，读到 `published: true` / `operation.committed: true` / `readiness: publication_completed`。

流程修正一条：第七节写的「`descriptorStatus` 为 pending 时用同一 `actionId` 重试一次」，这次**重试一次仍是 pending**，没有第二次就翻成 `written`。真正的判据不是 `descriptorStatus`，而是 `get_publish_status` 里的 `artifactReady` 与 `canPublish`——那次返回直接是 `artifactReady: true` / `dependenciesReady: true` / `preparation.state: ready` / `operation.state: succeeded`，随后 `publish_site` 一次成功。所以下次重发卡在 pending 时，不要反复跑 `prepare_site`（它只会上传/复用冻结 ZIP），直接去查发布状态。

另一条：`access_mode` 在重发后**保持 public**，不需要再跑 `update_access_policy`。策略是绑在站点上的，不随快照回落到 private——第一节记录的「发布后必先转 public」只在首次建站时成立。

线上核对（不是看返回码，是看内容对不对）：

| 项 | 实测 |
|---|---|
| `index.html` | 59,930 B（本地 2,888 B + 托管层注入的水印脚本），引用 `/assets/index-u5Xo0vrr.js` |
| `/assets/index-u5Xo0vrr.js`、`/assets/scene3d-aJ6DEk3x.js` | 200 + `application/javascript` |
| `/dist/math.json.gz`、`/dist/search-cs.json.gz` | 200 + `application/octet-stream`（仍不带 `Content-Encoding`） |
| `/bodies/*.json.gz` | 200；注意正文文件名形如 `food-zhishu--inorganic-analytical-chem.json.gz`（`<repo>--<slug>`，**一本一个文件**，不按章拆），拼 `--ch01` 会 404 |
| `/manifest.json` | 200 + `application/json` |

## 九、第三次发布（批 9 + 批 10 上线，2026-11-26）

快照 **9.91 MiB / 347 文件**，`actionId` `63e68b14-168b-48d0-b0e3-5a33f00104b6`，`publishOperationId` `01a216c4-c26e-7e6e-94d2-4895f9b3c98e`，终态 `published: true` / `committed: true`。

这一次把批 9（删 2D 降级视图）与批 10（竖屏构图反算、大厅补光、书脊题签收窄）两批一起发。

流程上补一条第八节没写到的状态：`prepare_site` 返回 `descriptorStatus: pending` 之后，**第一次 `get_publish_status` 可能仍是 `preparation.state: verifying`**，此时 `artifactReady: false`、`canPublish: false`、`publishBlockedReason: sites_deployment_not_ready`、`retryAfterMs: 5000`。这不是失败，按 `retryAfterMs` 等一轮（实测约 20 秒）再查就成了 `artifactReady: true` / `canPublish: true`。判据永远是 `artifactReady` 与 `canPublish`，不是 `descriptorStatus`。

`access_mode` 依旧保持 `public`，未再调 `update_access_policy`。

线上核验：

| 项 | 实测 |
|---|---|
| `index.html` | 59,889 B，引用 `/assets/index-B5yD6PoN.js` |
| HTML 中的 `#svg-root` | **不存在**（2D 容器已随批 9 删除） |
| `/assets/index-B5yD6PoN.js`、`/dist/math.json.gz`、`/dist/search-ai.json.gz`、`/manifest.json` | 全部 200，内容类型与第八节一致 |

