# 3D 空间与交互设计

## 一、为什么是房间，不是星图

力导向星图适合看拓扑，不适合"知识库"的空间感。房间式固定结构，用位置记忆辅助回忆——数学在左翼、AI 在正中、化学在东南，每次进来位置一致。

规则：**3D 只做导航，不做阅读**。点节点弹 2D 详情层，正文始终在平面里读。

## 二、空间结构

```
                    中央大厅
                   （全局星图）
                        │
        ┌───────┬───────┼───────┬───────┐
        │       │       │       │       │
      数学      AI     化学    计算机   通识
      (左翼)  (正厅)  (东南)  (西侧)  (北侧)
                                    │
                                  工具间
                                 (东北角)
```

- **中央大厅**：各学科入口 + 全局依赖星图（节点量级见第六节，展台改按书计后需重算）
- **走廊**：连接大厅与各房间，走廊地面铺该学科的站名
- **房间**：一间一学科，房间内**按书分展台**，展台上立章节节点
- **工具间**：`tools` 类站点，独立小房间，不作为主路径

2026-11-25 定稿实测〔X〕：50 个仓库里有 131 份 `manifest.json`（25 站无 manifest，14 站是多书合集，最多一站 39 本），
抽取器落进 `data/` 的是 **129 条书目 / 去重 96 本独书**——131 份里有 2 份是 `_archive/` 旧版（排除并记 `excludedManifests`）。
所以展台数量级是「**129 条、最多 49 条一房**」，**同一仓库的多本书的展台要排在同一处并按书名分列**，
靠 `repo` 归组、靠 `bookSlug` 区分，不能合并成一个展台——合并就没法解释为什么一个展台上挂着两套 `ch01`。

### 学科与站点归属

| 学科 | key | 站点 |
|---|---|---|
| 数学 | math | math-basics-enlighten、advanced-math-zhishu、math-analysis、analysis-handbook、math-physical-methods、MATH、complex-analysis-visual、probability-statistics、odes-from-scratch、ode-enlighten、ODE、gaokao-math、kaoyan-math-66000、math-competition-derivation、additive-combinatorics-enlighten、discrete-geometry-enlighten、combinatorial-optimization-game-theory |
| AI | ai | hello-ai-zhishu、ai-enlighten、ai-ml-dl-rl-enlighten、ai-architecture-handbook、transformer、neural-net-zero、agentic-design-patterns-handbook、llm-model-catalog、alpoge-remark-book |
| 化学与食品 | chem | chem-zhishu、food-zhishu、shanghai-chem-lab |
| 计算机 | cs | algorithm-enlighten、cpu-enlighten、taocp-enlighten、C-true、C-、sudoku-zhishu、ACM-XCPC-Notes |
| 通识 | general | first-push-enlighten、economics-principles-handbook、AI-Study-Notes、AI-courses、bws-bilingual-reader、CourseVault-OfflineCourseMap、ai-history-site、meeting-129600years |
| 工具 | tools | mathmap、exam-solver、show、pages-index、MATLAB、SVM |

归属以 `data/manifest.json` 的 `discipline` 为准，上表是**仓库级**初始分配，抽取器可按书覆盖：
一个仓库的多本书允许落到不同学科（实测 `food-zhishu` 的 4 份 manifest 里有两份是「无机及分析化学」题库〔K〕，
按书判应落 `chem`）。分片与房间归属都按书算，`repo` 只用于把同仓库的书在展台上排在一起。

## 三、节点层级

三层，逐层展开（量级取 2026-11-25 `data/manifest.json` 定稿实测〔X〕）：

1. **书**（展台，129 条 / 去重 96 本）：房间里的展台牌匾，牌匾上标仓库名 + 书名，唯一键 `repo + bookSlug`
2. **章节**（1,169 根）：展台上的立柱，高度按章节序号递增
3. **概念**（765 个）：立柱上的发光点，前置关系拉成细线

平均 **12.2 章/独书**（1,169 ÷ 96），按条目算是 9.1 章/条（1,169 ÷ 129，中位 7）；单本最多 39 章
（`algorithm-enlighten::clrs-companion`），最少 1 章（`chem-zhishu::equation-diagnosis`）。
之前按站点估的「约 650 章 / 415 概念」已失效〔X〕。

章节与概念两层不变，只是它们挂在「书」而不是「仓库」下面。跨书引用与前端索引一律用三段键
`{repo}::{bookSlug}::{id}`——`ch01` 这类 id 在同一仓库的多本书之间必然重复〔K〕。
**立柱光点的挂载只能反查 `concepts[].chapterIds`**（765/765 可解析），不能用 `chapters[].conceptIds`
（非空仅 15/1,169）〔X〕，实现见 `src/layout.ts::conceptsByChapter()`，原因见 `pitfalls.md` 已验证 17。
概念数 415 是说明文件汇总值，未过抽取器校验；probe 里 sudoku 的 manifest **没有 `concepts` 数组**〔M〕，
这类展台上只有立柱没有光点，属真实形态，不做假点填充。`contentLevel: stats-only` 的书仍是节点，
只是点开后不渲染正文、只给原站入口。

题目、卡片、术语不独立成节点，收进章节详情里。否则要再加 **3,541 题 + 4,100 卡 + 4,100 术语 = 11,741 个节点**〔X〕，
1,934 个真节点会涨到上万，3D 里全部糊成一团。

## 四、连接的语义

只有一种线：`prerequisites` 前置关系。

- 同房间内的连线：本学科颜色，半透明
- 跨房间的连线：只在中央大厅的全局星图上显示，房间内隐藏
- 无 `prerequisites` 的节点：孤立点，不画线，不做假线
- 但「旧版产物普遍没有前置链」这个前提要修正：probe 三站实测普遍有——章节 19/20、13/14、15/16，概念 49/50、58/61〔M〕。
  全库铺开后再修正一次〔X〕：**概念 428/765、章节 372/1,169 带 `prerequisites`**——约六成概念、三成章节有链，
  孤立点是常态但不是全部，画图上既不能按「整片孤立」设计，也不能假设每节点都出线。

## 五、交互

| 操作 | 行为 |
|---|---|
| WASD / 方向键 | 平移 |
| 鼠标拖拽 | 转视角 |
| 滚轮 | 远近 |
| 点击站点牌匾 | 侧栏展开该站信息卡（章数、进度、`contentLevel` 标记、入口） |
| 点击章节立柱 | 弹详情层，渲染正文 |
| 点击概念光点 | 弹概念层，含前置链与深度推导（若有） |
| 右上小地图 | 2D 俯视，显示当前位置、视野扇形、已访问区域 |
| 顶部搜索框 | 转检索层，不离开 3D（`/` 与 `Ctrl+K` 都能唤起，见第十一节） |

详情层是 2D 面板，占屏幕 70%，可关闭。渲染路径按数据的 `bodyType` 与 `contentLevel` 分流，不是一条通道走到底：

| 情况 | 渲染 | 必须显示的提示 |
|---|---|---|
| `bodyType: "md"`（`contentLevel: full`） | markdown-it + KaTeX + Mermaid，公式走 `$...$` / `$$...$$`；Mermaid 围栏先出占位容器，可见才渲染（第十节） | 无 |
| `bodyType: "html"`（`contentLevel: degraded`，如 sudoku） | 正文是成品 HTML 片段，直接注入，**不过 markdown-it**；站内公式已是烤好的 KaTeX 节点，原始定界符取不回来〔N〕 | 顶部降级条：「正文为成品 HTML，公式不可还原」 |
| `contentLevel: stats-only` | 不渲染正文 | 只显示原站 Pages 入口，不留空面板 |

- 详情层底部给回溯条：`origin.path`（仓库内路径，用于对账）与 `bookSource`（原书出处，`page` 可能是区间字符串、整数或缺失〔M〕），三者按有无显示。
- 概念详情的「深度推导」区块按 `depth` 有无显示：全库 129 本实测非空 **82/765**〔X〕（三站口径 10/50、5/61〔M〕），
  不到两成，不能默认每页都有。
- 题目的 `answer` 是 int 索引〔M〕，前端按 `options` 原序渲染并现算字母，**不得重排选项**；`misconception`/`claims`
  实测全库恒空（`claims` 非空 **0/765**〔X〕），误解与断言区块无数据时整块不出现。
- AI 现场生成的内容属另一条通道，标「AI 现场生成 · 未经校验」，不与库内正文混排。

## 六、性能

| 手段 | 做法 |
|---|---|
| 合批 | 节点用 `InstancedMesh`，一个材质一批 |
| LOD | 距离 > 30 单位时，概念点隐藏，只留章节立柱 |
| 分片 | 进房间才加载该学科分片，大厅只加载 manifest |
| 纹理 | 文字用 CanvasTexture 生成，缓存复用 |
| 帧控 | 静止 3 秒后停渲染循环，交互时恢复 |

目标：桌面端 60fps；大厅全部节点不超过 15 万三角面。

节点量级按 `data/manifest.json` 定稿实测重算〔X〕，**一屏只渲染一个视图**（大厅 6 个分区灯塔，或一个房间），
所以预算按「最坏单房间」摊，不是按全库摊：

| 分区 | 书 | 章 | 概念 | 占 15 万预算 |
|---|---|---|---|---|
| ai | 49 | 450 | 320 | 最坏房间 |
| math | 45 | 265 | 308 | |
| general | 13 | 181 | 50 | |
| cs | 12 | 170 | 65 | |
| chem | 10 | 103 | 22 | |
| tools | 0 | 0 | 0 | 6 仓全无 manifest，空房间 |
| 大厅 | 6 个分区灯塔 + 6 条走廊 | — | — | 与房间无关的常数 |

- **单展台预算** = 150,000 ÷ 49（ai 房最多书数）≈ **3,060 三角面**。
- **章节环预算** = 3,060 ÷ 12.2 章/书 ≈ **250 面/章**；这是按独书均值算的，
  不是原「650 ÷ 96 ≈ 6.8 章/书」——旧口径会让每章的几何预算虚高一倍，落到 39 章的
  `clrs-companion` 上就爆。按最坏单本 39 章反推，同一展台只剩 **78 面/章**。
  两个数一起定尺度：**环上每章用低段数几何**（八面体 8 面、方柱 12 面一档），
  不用 UV 细分的球与圆环，把余量留给牌匾与前置线。
- 实测骨架（`InstancedMesh` 合批后）真数由 `__zhishu.triangles()` 读 `renderer.info.render.triangles`〔X〕：
  大厅 **1,398 面**、数学区（45 本 / 265 立柱 / 398 光点）**3,874 面**，占 15 万预算 **≤2.6%**——
  比原估的「约 2.8 万面」低一个数量级，因为六棱柱与方柱都是单段几何 + 合批，一次 draw call 提交全部实例。
  预算余量留给批 6 的牌匾纹理与前置线，不必再压段数。
  注意 headless 采样没有 vsync 上限，`fps()` 会报 165 而非 60，帧率达标以「单帧 ≈6ms」为准看，不是那个 165。
- 展台排布：同仓库的多本书排在相邻格位（`layoutRoom` 先按 `repo` 再按 `bookSlug` 排序），
  **不合并基座**——合并就没法解释同一展台上两套 `ch01`，且 129 本摊到六区后单区最多 49 本，方格阵一屏放得下。
- 文字仍是 CanvasTexture（含新增的走廊地面学科名，每区一张、6 张共 12 面），贴图缓存复用、不逐帧重建。

## 七、移动端降级

触发条件：`matchMedia('(pointer: coarse)').matches` 或 `innerWidth < 768`。

降级形态：2D SVG 依赖图。

- 顶部学科页签，切换房间
- 下方力导向或分层布局的 SVG 图，节点可点
- 点节点同样弹详情层，全文可读
- 不加载 Three.js（用动态 `import()` 判断后才引入）

这一点是硬要求：评委会用手机点开链接，3D 白屏等于零分。

## 八、视觉

- 底色：深墨 `#12141a`，房间地面更暗一档
- 强调：数学靛蓝 `#4a6cf7`、AI 青 `#25c2a0`、化学朱砂 `#e05a47`、计算机琥珀 `#e0a83a`、通识灰蓝 `#8b95a8`
- 字体：正文思源宋体（vendor），界面思源黑体
- 光：~~单方向主光 + 环境光，不用实时阴影（性能）~~ → **批 7 已废止**，改为「半球光 + 投影方向光 + 逐区学科点光 + PMREM 环境光 + Bloom」，
  实时阴影开着但只烘一次，见第十二节
- 深浅色：深色为默认，浅色主题保留但房间配色需重算对比度

## 九、不做的事

- 不做第一人称视角（晕动、操作成本高）
- 不做房间之间的自由飞行（只需走廊固定路径）
- 不做多人/联机
- 不在 3D 里渲染正文
- 不为旧数据的缺失字段造视觉填充

## 十、图示渲染（Mermaid，批 3.5 落地）

库里 **855 章含围栏 / 882 个围栏 / 出自 77 本书**〔X〕，占比 73%，所以图不是边角功能。
实际出现的图型只有 5 种，抽样就按这 5 种各取一章，**库里没有的（classDiagram、stateDiagram）不硬造**：

| 图型 | 围栏数 | 取证书目 |
|---|---|---|
| `flowchart` | 818 | `MATH--bronstein-handbook` ch01 |
| `graph` | 55 | `additive-combinatorics-enlighten` |
| `sequenceDiagram` | 6 | `agentic-design-patterns-handbook` |
| `mindmap` | 2 | `algorithm-enlighten--grokking-algorithms` |
| `xychart-beta` | 1 | `algorithm-enlighten--hello-algo` |

渲染时机是**可见才渲染**，三步走（实现 `src/diagram.ts`，接线 `src/render.ts` 的 mermaid 支）：

1. markdown-it 遇到 ```` ```mermaid ```` 出占位容器：`data-diagram="pending"` + 标题条 +
   `<details class="diagram-src">` 把源码原样留着（源码永不丢，失败即回退给它）。
2. `hydrateDiagrams(root)` 用 `IntersectionObserver`（`rootMargin 160px`、`threshold 0.01`）登记成
   `watching`；进可见那一刻才 `import('mermaid')` → `mermaid.render()` → `sanitizeSvg()` → `done`。
   模块级 promise 缓存，**同章多围栏只加载一次分包**；渲染走串行队列，mermaid 复用同一批临时 DOM，
   并发 render 会互相踩。
3. 失败（语法错 / 不支持类型 / 分包取不到）→ `data-diagram="error"`，容器里给源码 `<pre>` +
   一行原因，标题条改成「渲染失败已回退源码」，**不留空容器**。
   `renderDiagram()` 对外返回 `{svg, error, kind}` 而不是抛错，探针可直接喂坏源码。

约束与代价：

- `securityLevel:'strict'` + `htmlLabels:false` + `theme:'dark'`，产出 SVG 里的 `style` 保留、
  `script` / `on*` / 远程 URL 属性剔掉；实测 5 类图产出 SVG 的远程引用 **0 处**，
  分包合计 57 片 / 5,106KB 全部同源，大厅与分区阶段零 mermaid 请求。
- mermaid 是 `import('mermaid')` 动态分包：主 entry `index-*.js` 418KB 里一个实现字节都没有，
  首屏静态闭包只有 1 片。代价是首次点开围栏要多取一批分包（`mermaid.core` 656KB / gzip 165KB，
  再加所用图型的子包与共享 chunk），所以占位条写明「滚动到此处自动出图」。
- 阅读层收起（`forgetDiagrams`）会把 `watching` 的围栏从观察器摘掉，离开阅读页不会触发加载。
- 性能复核：mermaid 已进运行时后，大厅 165.1fps / 分区 164.4fps，三角面 6,082，仍在 15 万预算内。

## 十一、检索层（批 4 落地）

**索引来源**：`tools/build_search_index.py` 读 `data/manifest.json` + `data/sites/*.json`，
产出 `data/dist/search-<area>.json` 六片（不新增 `data/` 一级子目录，复用已有 `dist/`）。
字段 `slug` / `file` / `title` / `area` + `chapters[]{id,title,core}` + `concepts[]{id,name,brief}` +
`terms[]{t,d,c}`，超 300KB 才降级丢长描述。实测〔X〕：

| 区 | 书 | 章 | 概念 | 术语 | 片大小 |
|---|---|---|---|---|---|
| math | 45 | 265 | 308 | 1,122 | 134.5KB |
| ai | 49 | 450 | 320 | 1,787 | 281.2KB |
| chem | 10 | 103 | 22 | 290 | 36.4KB |
| cs | 12 | 170 | 65 | 515 | 65.8KB |
| general | 13 | 181 | 50 | 386 | 53.3KB |
| tools | 0 | 0 | 0 | 0 | 0.3KB（空片） |

单片全部 ≤300KB，六片齐（tools 出空片而不是缺片）。

**加载策略**：大厅与分区视图只用 manifest 级轻索引（129 条书目，用已加载的 manifest 现建，不发额外请求）；
用户在某学科内发起搜索才取该区 `search-<area>.json` 建 MiniSearch，取过就缓存、inflight 去重、缺片容错。
实测首屏 0 片、桌面全流程只请求 6 片（每区一片，`查一区拉一片`）。MiniSearch 打进 entry，不另起分包。

**交互**：`/` 或 `Ctrl+K` 唤起（焦点在输入区时 `/` 不抢），↑↓ 选择、Enter 打开、Esc 收起；
结果分「章节 / 概念 / 书」三组，每组最多 10 条、总 24 条，每条标落点书名与区，术语命中按落点归类
（有章进「章节」组，无章落书总览，不猜目标）。四态各有文案：`empty` / `loading` / `ready` / `none` /
`error`，空片区单独说「库里 0 本，换到其他学科再搜」，不白屏也不空弹层。
390 视口下弹层宽 370px、结果行 `text-overflow: ellipsis`，文档 `scrollWidth === 390`。

**精确落点**：命中带 `file`，`openFromSearch()` 用 `manifest.sites.find(s => s.file === hit.file)` 取书，
再走已有 `openChapter` / `openConcept`——绕开 **31 个跨仓重名 `bookSlug`**（判据实测拿
`agentic-design-patterns` 两份镜像验证，按 file 精确取到点的那本）。
跳转前把「所在区 + 相机位姿 / 2D 平移 + 选中书目」快照进 `searchSpot`，点返回按快照复原（位姿漂移实测 0.000）；
用户自己走位（进房、回大厅）即作废快照，避免串到下一次返回。跳转只开阅读层、不动 3D 视图与 `currentRoom`。

**召回口径**：中文按「单字 + 二字组合」切词（MiniSearch 默认按空白切，中文不加空格必然匹配不上），
配 `combineWith:'OR'` + `prefix` + `fuzzy 0.12`，召回偏宽——随手敲的中文乱码也能命中，
所以「无结果」态要用拉丁乱码验（`pitfalls.md` 已验证 25）。boost 给 `label 5 / book 1.5 / text 1`：
标题命中优先于正文，符合「我知道叫什么但想不起在哪」的主用法。

## 十二、渲染层（批 7 落地）

批 2–6 的画面是「颜色填充」：11 处 `MeshBasicMaterial`、零光源、无阴影、无后期。批 7 把它换成有光照的空间，
硬约束是**零外部资产**——不落地任何 `.hdr/.glb/.gltf/.ktx2/图片贴图`，环境光也必须程序化生成。

### 12.1 管线

`WebGLRenderer`（ACESFilmic，exposure 1.0，DPR ≤2）→ `EffectComposer`：`RenderPass → UnrealBloomPass → OutputPass`。
composer 延迟到真正进 3D 视图才建，2D 降级路径不 `import three`（判据：390 视口仍零 three 请求）。

| 件 | 参数 | 为什么 |
|---|---|---|
| HemisphereLight | `0x9fb4de / 0x141a24`，0.42 | 天空-地面双向环境项，比纯 AmbientLight 有层次 |
| DirectionalLight（主光） | `0xfff1dc`，1.5，`castShadow`，mapSize 2048，bias −0.0009，normalBias 0.35 | 唯一的投影灯；俯角 ~38°（`half*0.8`）才拖得出影子，60° 时影子压在柱后看不见 |
| PointLight × 6（大厅逐区） | 学科色，intensity 900，distance 240，decay 2，y=46 | 区的归属靠色光而不是色块；带距离衰减，不会互相糊成一片 |
| PointLight × 2（房间内） | top 学科色 700（distance = span×2.4）+ rim 冷白 392 @ y=18 | rim 挂高是为了不在地面留热点（y=7 时地面有一块过曝） |
| `scene.environment` | `PMREMGenerator.fromEquirectangular` 吃 512×256 canvas 渐变，用完即弃源贴图 | envMapIntensity 0.3–0.5，给金属感与高光走向；零外部文件 |
| UnrealBloomPass | strength 0.55 / radius 0.55 / threshold 0.55，内部分辨率 0.65× | 首值 0.9/0.4/0.5 会把地面暗角糊平，0.35 档又看不出光晕 |
| 雾 | `Fog(BG, 520, 1250)` | 保留，只从 480/1180 微挪一档 |

**阴影只烘一次**：场景静态、只有相机动，所以 `shadowMap.autoUpdate=false`，位姿变化时置 `needsUpdate=true`，省 ~11% 帧时。
**Bloom 内部分辨率 0.65×**：`composer.setSize()` 之后再 `pass.setSize(w·pr·0.65, h·pr·0.65)`（composer 不会替它重算），再省 ~11%。
两者合计把大厅从 ~53fps 抬回 66fps（headless 采样）。

### 12.2 几何

- 立柱 6 种形态，一区一种：数学 `cylinder`、AI `hexPrism`、化学 `coneTower`、计算机 `boxPillar`、通识 `stackedDrum`、工具 `ringColumn`（空房间未建）。
  Lathe/Cylinder/Box 全部代码生成，无外部模型。取证签名 `geometry.type:shape:vertexCount`——单看 type 分不开数学与 AI（都是 CylinderGeometry）。
- 立柱高度 = 章数映射：`base = 3.4 + 7.8·√min(1, 章数/24)`，同书内再乘 0.86–1.0 错落系数，夹在 `[3.4, 11.2]`。√ 让 8 章的书也读得出高度。
- 立柱粗细靠实例缩放 `COLUMN_GIRTH = 2.2`（几何单位半径 0.6–1.0 对展台半径 10 就是根针）。
- 底座 3 种形态（`disc/step/ring`）与立柱同族，一房一种。
- 概念光点：一张 64² canvas 径向渐变共用贴图 + `PlaneGeometry` 面片实例，Additive、`depthWrite:false`；
  半径随题量 `1.5 + 1.15·√min(1, 题量/100)`，颜色 = 学科色向 `#f4f7ff` 插值 0.3，绕柱 4.3 环三层错落。
  总量 math 398 / ai 462，全区 ≤600——**不做粒子海**。
  朝向每帧在 CPU 侧按相机四元数重写实例矩阵：`InstancedMesh.raycast` 读的就是实例矩阵，塞进顶点着色器会让光点点不中。
- 地面：1024² canvas 程序化贴图（40 格细线 + 每 4 格粗线 + 径向暗角），替代原 `GridHelper` 线框。

### 12.3 预算口径

`shadowMap.autoUpdate=false` 后 `renderer.info` 每帧不含阴影 pass，所以三角面**分两口径**报（`census.triangles`）：

| 视图 | mainPass | shadowPass | perFrame | draw call | 占 15 万 |
|---|---|---|---|---|---|
| 大厅 | 1,398 | 144 | 1,412 | 53 | 0.9% |
| 数学 | 18,454 | 18,300 | 18,468 | 63 | 12.3% |
| AI | 21,154 | 20,992 | 21,168 | 67 | 14.1% |
| 通识 | 33,816 | 33,468 | 33,830 | 33 | 22.6% |
| 计算机 | 4,830 | 4,536 | 4,844 | 32 | 3.2% |
| 化学 | 16,636 | 16,500 | 16,650 | 30 | 11.1% |

`shadowPass` 与 `mainPass` 同量级是因为投影体既进主渲染也进阴影图，不是主画面画了两遍；判据按 `perFrame ≤150,000`。
帧率实测：大厅 10s **64.9**、数学区 5s **63**（headless d3d11，真机更低，余量按 1.4× 看）。
体积：dist 9.846 → **9.883 MiB**（+0.037 MiB，全在 `assets/` 的 JS 分包 +38.5 kB），上限 12 MiB。
