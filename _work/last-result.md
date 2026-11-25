# 结果：批 7 3D 空间渲染升级（颜色填充 → 有光照的空间）

## 状态

done — 自检 **88 项全绿**（`python tools/selfcheck.py`，98.8s，报告 `_work/selfcheck-report.json`，截图 `_work/shots-batch7/`）。
断言从 **74 → 88 条（净增 14）**，**未删除、未放宽任何一条**（旧 74 条原样在跑；新增的一条体积上限是「加记录」而不是改旧值）。

- `dist/` **9.846 → 9.883 MiB / 347 文件（+0.037 MiB，+0.4%）**，上限 12 MiB，占 82.4%。
- 帧率：大厅 10s **64.9**、数学区 5s **63**（headless d3d11，无 vsync 上限，真机按 1.4× 余量看）。
- 三角面最大视图（通识）**33,830 / 150,000 = 22.6%**，双口径已分列。
- 新增外部二进制资产 **0 个**（`dist/assets` 内 `.hdr/.glb/.gltf/.ktx2/.png/.jpg` 计数为 0），环境光照走 `PMREMGenerator` 程序化生成。
- `python tools/check_offline.py` 违规 **0**；`npx tsc --noEmit` 退出 0；`npm run build` 成功。
- 390 视口仍是 2D 降级：`mode=flat`、`scrollWidth=390`、`#three-root canvas` 不存在、运行期零外部请求。
- `data/` 一字未动、`docs/schema.md` 未改、交互（WASD / 小地图 / 检索 / 阅读层 / 走廊名）行为不变（返回位姿差 0.000）。
- **未 push、未重发线上站点**（发布由主控决定）。

## 改前 → 改后对比（阶段 A 基线 → 阶段 D 落点）

数字全部来自 `_work/shots-batch7/{before,after}-metrics.json`（同机位、同采样函数 `sampleLuminance`），
基线另存 `_work/b7-dist-before.json`、`_work/b7-baseline-selfcheck.txt`。

| 视图 | 三角面 改前 | 三角面 改后（主/阴影/整帧） | draw call 改前→后 | 整屏亮度 改前→后 | 地面带亮度 改前→后 |
|---|---|---|---|---|---|
| 大厅 | 1,398 | 1,398 / 144 / **1,412** | 40 → 53 | 0.08656 → 0.15323 | 0.11060 → 0.23377 |
| 数学 | 3,874 | 18,454 / 18,300 / **18,468** | 48 → 63 | 0.13117 → 0.10969 | 0.19120 → 0.16999 |
| AI | 6,150 | 21,154 / 20,992 / **21,168** | 52 → 67 | 0.16865 → 0.13069 | 0.28055 → 0.22458 |
| 化学 | 1,648 | 16,636 / 16,500 / **16,650** | 15 → 30 | 0.12728 → 0.12110 | 0.17326 → 0.18103 |
| 计算机 | 3,096 | 4,830 / 4,536 / **4,844** | 17 → 32 | 0.16565 → 0.14713 | 0.25094 → 0.23318 |
| 通识 | 3,450 | 33,816 / 33,468 / **33,830** | 18 → 33 | 0.15191 → 0.13399 | 0.21468 → 0.20350 |
| 工具 | 162 | 162 / 0 / **176** | 3 → 17 | 0.09968 → 0.08374 | 0.11459 → 0.13462 |

亮度不是「整体变亮」：大厅地面带翻倍（受光面抬起来），房间整屏反而略降——ACES 把天空带从 0.0824 压到 0.0333，
背景与受光面被分开处理，是 tone mapping 的必然结果。

**draw call 上涨的构成**（实测归因，不是猜）：`setPassEnabled('Bloom', false)` 一关就掉回 40 / 50——
**+13 全是 UnrealBloomPass 的 mip 下/上采样与合成（13 次全屏四边形提交）**，与场景件数无关；
场景自身只涨 **+2**（48 → 50：新增底座 `InstancedMesh` 一件、房间地面薄盘从透明 Basic 换成受光 Standard 后多一次提交）。
大厅场景件数 **0 增**（40 → 40）。所有可重复件仍是 `InstancedMesh` 合批，没有逐节点 Mesh。

**体积增量构成**（判据 8）：

| 族 | 改前 | 改后 | 增量 |
|---|---|---|---|
| `assets/` | 5,458,913 B · 76 片 | 5,497,444 B · 76 片 | **+38,531 B**（scene3d 分包 579.63 → 599.7 kB；新增 `src/spacekit.ts` 灯光/几何/后期套件） |
| `bodies/` `sites/` `dist/` `manifest.json` `index.html` | 2,908,840 / 904,073 / 994,898 / 55,078 / 2,888 B | 不变 | 0 |
| **合计** | **10,324,690 B · 9.846 MiB · 347** | **10,363,221 B · 9.883 MiB · 347** | **+38,531 B（+0.37%）** |

文件数 347 → 347：**没有新增任何外部资产文件**。

## 做了什么

**阶段 B · 材质与光照**
- 新增 `src/spacekit.ts`（约 330 行）：程序化渲染套件——`columnGeometry/podiumGeometry`（6 种立柱 + 3 种底座，
  Lathe/Cylinder/Box 代码生成）、`groundTexture/discTexture/glowTexture`（canvas 程序化贴图）、
  `buildLightRig`（半球 + 投影方向 + 逐区点光）、`buildEnvironment`（canvas 全景渐变 → `PMREMGenerator`，源贴图用完即弃）、
  `buildPostChain`（RenderPass → UnrealBloomPass → OutputPass）。
- 11 处 `MeshBasicMaterial` 逐条处置（表在 `_work/decisions.md`）：地面/信标/展台/底座/立柱/房间地面 → Standard；
  区环、走廊名地面带、空房间环、概念光点保留 Basic（发光与标记件，亮度必须与相机朝向无关）；`GridHelper` 删除，网格画进地面贴图。
- 灯光：Hemisphere 0.42 + Directional 1.5（`castShadow`、mapSize 2048、bias −0.0009、normalBias 0.35）
  + 6 盏学科色 PointLight（900 / distance 240 / decay 2）+ 房间内 top 700 / rim 392。
  强度不是拍的：标定网格跑过 3 档（1.05/0.42/26 洗白到 0.42、1.05/0.42/15、1.5/0.42/15），取第三档。
- **主光俯角是本批最值钱的一次修正**：初版架到 60°，关/开阴影的亮度差只有 1.6e-4（等于没投影）；
  降到 38° 后房间中段差涨到 7.2e-3，截图里影子拖到展台上。

**阶段 C · 几何差异化**
- 六区各一种立柱形态（`cylinder/hexPrism/coneTower/boxPillar/stackedDrum/ringColumn`），底座三种（`disc/step/ring`）。
  取证签名 `geometry.type:shape:vertexCount`——单看 type 分不开数学与 AI（同为 CylinderGeometry），顶点数 76 vs 40 才分得开。
- 高度按章数：`base = 3.4 + 7.8·√min(1, 章数/24)`，同书内乘 0.86–1.0 错落系数，夹在 `[3.4, 11.2]`（`src/layout.ts`）。
- 立柱实例 `COLUMN_GIRTH = 2.2`：几何单位半径 0.6–1.0 对展台半径 10 就是根针，2.2 才读得出柱子（近景 `dbg-math-close.png`）。
- 概念光点精灵化：一张 64² canvas 径向渐变共用贴图 + `PlaneGeometry` 面片实例（Additive、`depthWrite:false`），
  半径 `1.5 + 1.15·√min(1, 题量/100)`，绕柱 4.3 环三层错落，颜色 = 学科色向 `#f4f7ff` 插值 0.3；
  总量 math 398 / ai 462（≤600，不是粒子海）。朝向在 CPU 侧按相机四元数重写实例矩阵——
  `InstancedMesh.raycast` 读实例矩阵，着色器 billboard 会让光点点不中。

**阶段 D · 后期与氛围**
- EffectComposer 延迟到真进 3D 才建（2D 降级不碰 three）；`composer.setPixelRatio(renderer.getPixelRatio())` 显式设，
  否则 DPR>1 的机器上后期链按 1 渲染会糊；resize 时 composer + bloom 一起改尺寸。
- Bloom 首值 `(0.9, 0.4, 0.5)` → 扫过 `(0.62,0.45,0.5)` / `(0.7,0.35,0.45)` / `(0.55,0.6,0.6)` → 终值 **`(0.55, 0.55, 0.55)`**。
  0.9 档把地面暗角糊平、区名重新发白；0.35 档几乎看不出光晕。
- 两项帧时回收：`shadowMap.autoUpdate=false`（静态场景只烘一次，位姿变化时 `needsUpdate`）省 ~11%；
  bloom 内部分辨率 0.65×（`composer.setSize` 之后再 `pass.setSize`）省 ~11%。大厅从 ~53fps 回到 64.9。
- 雾保留并微调一档（480/1180 → 520/1250）；地面网格程序化（1024² canvas，40 格细线 + 每 4 格粗线 + 径向暗角）。

**阶段 E · 门槛与文档**
- 探针新增 **14 条**断言：灯 ≥3 且方向光 `castShadow` / 有效类型含 PCF 且 `requested=PCFSoftShadowMap` / mapSize ≥1024；
  逐区点光 ≥6 且带 distance+decay；PMREM 环境指纹（renderTargetTexture + halfFloat + pmrem 标记）；
  后期链含 RenderPass/UnrealBloomPass/OutputPass 且 bloom 参数非空；雾在 + DPR ≤2；
  bloom A/B 亮度差；阴影双口径（`shadowPass>0` 且 `perFrame ≤150,000`）；房间受光材质 ≥4；
  立柱形态 ≥3 且数学/AI 签名不同（跨区再验一次）；光点 billboard + `canvas:` 贴图 + 数量 ≤600；
  阴影 A/B 落在数学区地面带；`dist ≤12 MiB` 新记录行。
- `docs/design.md` 新增第十二节「渲染层（批 7 落地）」，并在第八节把「单方向主光 + 环境光，不用实时阴影」标为已废止；
  `docs/pitfalls.md` 新增已验证 **39–45（7 条）**与排查顺序 **28–30（3 条）**。
- `tools/tune_batch7.mjs`（标定取证脚本，保留）；`tools/shots_batch7.mjs` 同机位双套截图；
  截图目录从 `shots-batch6` 换成新建的 `shots-batch7`，旧目录一字未动。

## 自检（任务书 13 条逐条）

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| 1 | 全部 `MeshBasicMaterial` 逐条处置并列成表 | ✅ | `_work/decisions.md`「批 7 材质处置表」11 行；改后大厅 Basic 12 全是标签/标记件，房间 Standard 4 |
| 2 | 灯光 ≥3 类，方向光投影实际生效 | ✅ | census `lights {Hemisphere 1, Directional 1, Point 6}`、`directionalCastShadow=true`；阴影 A/B 数学区地面带 0.16999 → 0.17836（Δ7.2e-3），截图 `after-room-math.png` 可见长影 |
| 3 | envMap 来自 PMREM、零外部文件 | ✅ | census `env present/renderTarget/halfFloat/pmrem 全 true`；`dist/assets` 内二进制资产 0 个 |
| 4 | Bloom 生效（pass 链 + 亮度差证据） | ✅ | `post [RenderPass, UnrealBloomPass, OutputPass]`、bloom 参数非空；大厅整屏 0.15168 → 关 bloom 0.13145（Δ0.020，p95 Δ0.051） |
| 5 | 六区立柱 ≥3 种几何形态，高度随章数 | ✅ | 签名 5 种不同（Cylinder×2 靠顶点数分、Lathe×2、Box×1）；`layout.ts` 章数 → 高度公式，数学区 265 根高低错落可见 |
| 6 | 概念光点精灵化 | ✅ | `dotBillboard=true`、贴图 `canvas:radial-gradient-64`、面片实例；math 398 / ai 462 |
| 7 | 大厅 ≥45fps、math ≥45fps、三角面 ≤150k（双口径说明） | ✅ | 64.9 / 63；最大 33,830（22.6%），`mainPass/shadowPass/perFrame` 三档分列并在 design 12.3 解释口径 |
| 8 | `dist ≤12 MiB`，增量构成表 | ✅ | 9.883 MiB（82.4%），+0.037 MiB 全在 `assets/` JS 分包；表见上 |
| 9 | `python tools/selfcheck.py` 全绿、断言数 >74 | ✅ | **88 项全绿 / 失败 0 / 98.8s**（74 → 88，未删未放宽） |
| 10 | `python tools/check_offline.py` 0 违规 | ✅ | 违规 0（xmlns 6 / 保留域名 2 / 字面量 47 / 数据 174 全在白名单） |
| 11 | `tsc --noEmit` 零错、`npm run build` 成功 | ✅ | 退出码 0；build 17.5s 成功 |
| 12 | `docs/design.md` 与 `docs/pitfalls.md` 已更新 | ✅ | design 新增第十二节 + 第八节废止标注；pitfalls 已验证 39–45、排查 28–30 |
| 13 | before / after 截图各 ≥8 张、同机位 | ✅ | 各 9 张 PNG（hall / 六区 / reader / mobile390）+ 两份 metrics JSON，机位由视图与布局决定、不受材质灯光影响 |

## 待决策

1. **真机帧率未测**：headless ANGLE d3d11 无 vsync 上限，报出来的 64.9/63 只能做同机相对比较。
   真机（尤其集显笔记本）在通识区 33,830 面 + bloom 上的表现需要人眼看一次。
   若掉到 45 以下，最省的回退顺序是：`BLOOM_SCALE` 0.65 → 0.5 → 关 bloom，再考虑 `shadowMap.mapSize` 2048 → 1024。
2. **视觉判读只到「统计 + 截图」级**：亮度 A/B、几何签名、灯单都是机器证据；
   「好不好看」没有肉眼确认过（`dbg-*.png` 是我自己拍的对照，不是验收）。建议主控看一次 `after-hall.png` 与 `after-room-ai.png`。
3. **`PCFSoftShadowMap` 在 r186 已被移除**：本批按任务书仍赋值 Soft（census 记 `requested`），实际跑 PCF。
   若将来升 three 版本把 deprecated 常量删净，这一行会抛 `ReferenceError`——届时改成 PCFShadowMap 即可，断言已拆成两条不会连带红。
4. **房间地面薄盘仍是半透明受光件**：`transparent` 材质在阴影下偶有自阴影噪点（本批未复现，但 normalBias 0.35 是按消除它来调的）。

## 下一步建议

1. **批 5 生成层**（唯一未开工批次）：Agent App + 落库，标「AI 现场生成 · 未经校验」，不进依赖图与诊断链。
   建议门槛新增「生成内容不出现在检索结果与图示队列」。
2. **6.1 Sites 发布**：产物就绪，但**本批按要求没有 push、没有重发**。发布需要新鲜 `dist/`（远端不跑构建），
   路径与命令在 `docs/deploy.md` 第三节；线上站点是否用批 7 产物重发，由主控决定。
3. 收尾一律完整重跑 `python tools/selfcheck.py`，勿用 `--skip-build`（复用旧 `dist/` 会把已修的改动验成失败，pitfalls 31）。
4. 若要做「光照随时间/主题变化」这类后续增强，先量帧时预算：本批大厅 draw call 53、三角面 1,412，
   余量主要在被通识区吃掉的面上（33,830 / 150,000），加灯比加面便宜。
