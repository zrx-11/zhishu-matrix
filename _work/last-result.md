# 结果：批 9 全端统一 3D（删 2D 降级）+ 移动端适配 + 光照修复

## 状态

done — 自检 **117 项全绿**（`python tools/selfcheck.py`，129.0s，报告 `_work/selfcheck-report.json`，
截图 `_work/shots-batch9/`：`before-*.png` 30 张 + `after-*.png` 28 张 + 两份 metrics）。
其中探针断言 **98 条 / 失败 0**（门槛常量 `SPACE_ASSERT_MIN` 89 → **98**），门槛项 19 条。
断言账：批 8 的 91 → 98，**新增 9 条 390 段断言、把 5 条绑 2D 的断言反写成 3D 语义、删除 0 条**；
反写的五条逐条留了「旧判据 → 新口径」注释并进 `_work/decisions.md`，没有一条是靠放宽阈值变绿的。

- 阶段 A 交付：`src/svg2d.ts` **398 行整段删除**（另有 `MatrixFlat`、`prefersFlatView()`、`?flat=1`、
  `main.ts` 的 `'flat'` 分支、`els.flat`、`index.html` 的 `#svg-root`、SVG 专用 CSS 16 行）。
  `npx tsc --noEmit` 退出 0，`npm run build` 成功，1440 / 390 竖屏 / 触摸 UA 三种环境都 `mode === 'three'`。
- `dist/` **9.903 → 9.901 MiB / 347 文件（−2 KiB）**，上限 10.6 MiB（占 93.4%）；文件数三批未变 = 零新增资产。
  entry `index-Dg60W3aL.js` 427,102 B，`scene3d-D7ZsDihQ.js` 635,145 B。
- `tools/check_offline.py` 违规 **0**（字面量 46 / xmlns 6 / 保留域名 2 / 数据 174）；
  控制台错误 0、页面异常 0、外部请求 0（81 个请求全本地，17 次正文取回）。
- 几何预算一字未动（本批不碰建模）：逐区三角面 / draw 与批 8 完全相同——math 6,158 / 26、ai 8,494 / 26、
  chem 2,666 / 25、cs 3,636 / 25、general 4,204 / 25、tools 994 / 23，大厅 1,852 / 63。
- 交互无回归：WASD 位移 14.286 / 朝向漂移 0、检索返程位姿差 0、`data/` 与 `docs/schema.md` 一字未改。
- **未 push、未重发线上**（按要求；`git remote -v` 亦为空）。

## 三条「探针确证项」实测数字

1. **390 真走 3D**（不是「没报错」而是画面上有东西）：`mode=three`、`#three-root canvas` 存在、
   `#svg-root` 不存在、分包 `scene3d-D7ZsDihQ.js` 已加载、整帧亮度 mean **0.04412** / p95 **0.07846**（非全黑）、
   `fov 76`、`scrollWidth === 390`（大厅 / 阅览室 / 含公式的阅读层三处各一条）。
2. **触摸命中**：候选点 i=48 → `complex-analysis-visual.json` / `ch05`，`spineProbe().px = 39`、
   `faceIndex` 反查与实时射线一致（`mapped=true`，math 区 265 格）；`touchscreen.tap` 之后
   `readerState = {mode:'chapter', open:true, book:'visual-complex-analysis', level:'full'}`、正文 3,221 字、
   面包屑「math / 复分析：可视化方法 / 第 5 章：微分学的进一步的几何研究」——**点到的那一本那一章**。
   ≥8px 滑动那条：`lastTap = {moved:17, slop:8, kind:'touch', action:'drag'}` 且 `readerState()` 滑动前后同为
   `{mode:'closed', open:false, book:null}`——**一根手指划过书脊不会开书**。
3. **窄屏帧率**：390×844（deviceScaleFactor 2）大厅 **165.2**、阅览室 **146.2**（门槛线 30）；
   桌面 1440×900 大厅 10s **77.5**、六区 **74.7 / 76.8 / 70.3 / 80.6 / 73.4 / 87.4**（线 45）。
   窄屏档 `quality()` 逐项：`{name:mobile, dprCap:1.5, pixelRatio:1.5, shadows:false, bloom:false,
   bloomScale:0.5, renderScale:0.72, dustBudget:220, viewport:{390,716,aspect 0.545}, fov:76}`。
   **窄屏成效靠这组开关断言，不靠 fps**——headless rAF 在四个档位组合下都饱和在 165.1–165.2 / 140.7，
   帧率证不了降档真的生效（已验证 64）。

## 改前 → 改后对比（before = 批 8 落点，同机位、同采样函数）

| 项 | 改前（批 8） | 改后（批 9） |
|---|---|---|
| 390 视图 | `mode=flat`：2D SVG 194 节点、无 WebGL 画布、**不加载 scene3d 分包** | `mode=three`：WebGL 画布 + `scene3d-D7ZsDihQ.js` + 构图 20/20 入画 |
| fov / 机位 | 常量 fov 56，阅览室 `dist = side*0.3` | `fovForAspect()` 56 → 76；横屏 `aspectRamp=0` 与批 8 逐字相同，竖屏 `side*0.5 − 1.5`（站门口看进去） |
| 竖屏阅览室构图 | 无口径（2D 是平面投影） | `face 4/4`、`ceiling 4/4`、`floor 4/4`、`shelves 1/3`；`back 0/4`、`sidewall 0/4` 降为参考量 |
| 触摸手势 | `elementFromPoint` 自筛 + tap（2D 书位） | OrbitControls 单指旋转 / 双指缩放 + `tapVerdict()` 触屏 8px / 鼠标 6px，拾取仍走 `faceIndex` 反查，无第二次射线 |
| 顶面与墙面 | 藻井 / 檐口 / 门洞上沿近黑，走廊顶带 p95 **0.03496** | HemisphereLight 地面色 `0x10131a → 0x3c4352`、强度 `0.36 → 0.52` + 墙 / 天花 / 横梁 `emissive + emissiveMap`（0.11 / 0.22 / 0.16）；顶带 p95 **0.04202** |
| 书脊题签 | 图集无题签底板，`before-spine-*.png` 字口发虚 | 暗题签底板 + 字色 `#f7e9c9 → #f7f2e4` + `measureText` 自适应截断；反差 min math **16.59** / ai **15.21** / chem **16.35** / cs **15.63** / general **16.24**（门槛线 4.5） |
| 画质档 | 无（桌面一套参数打天下） | `config.ts:qualityTier()` 一处两档，`scene3d` / `spacekit` 只读结果 |
| 桌面帧率 | 大厅 84.4（8s） | 82.1（8s）／77.5（10s 门槛口径），六区 ±1 fps 内持平 |
| 几何 | — | 逐区三角面与 draw **完全相同**（本批不动建模） |
| 体积 | 9.903 MiB / 347 | **9.901 MiB / 347** |

## 收尾查出的问题（都是实测逼出来的，不是门槛放宽）

1. **390 点书脊开的是「本书总览」而不是章节**——根因不在机位：`handleClick` 的 chapter 分支同时补发
   `onPickBook` + `onPickChapter`，而 `bookRecord()` 不缓存 in-flight promise，两条链各发一次 fetch，
   谁后回来谁定 `mode`，晚到的 `openBook` 把面板打回 overview。删掉重复钩子（顺带省一次 JSON 请求）。已验证 67。
2. **bloom 判据一度 Δp95 = 0**：整帧 p95 落在暗部平台（0.06069 = 15.5/255 一档），关 bloom 时本来就只降 1/255。
   改为整帧 Δmean + **高光簇窗** `[0.26,0.24,0.44,0.48]` 的 Δmean 与 Δp95 双判 + 护栏「簇窗 > 整帧 1.5×」，
   阈值 1e-3 一字未降。实测簇 mean 0.06101 → 0.05385、p95 0.3076 → 0.27978。已验证 66。
3. **`spineProbe().px` 首版少算一半**（只投中心→上沿再折半），读数 22 而截图上明显 ~45 CSS px；
   改为脊面上下沿各投影取差。
4. **竖屏构图判据自相矛盾**：要求 19 点全入画 → 水平半角 20.3° 下机位被逼到门外 13 单位（娃娃屋剖面）
   → 书脊 20px、指头落进铜牌带。判据分组，可点性交给 `px ≥ 36` 单独一条。已验证 68。
5. **画质档 A/B 是空操作**：`setPassEnabled('Bloom', true)` 在没建 bloom 的档上返回 false 且没人读返回值。
   改成断言 `quality()` 的开关本身，fps ≥30 只留作回归底线。已验证 64。
6. **顶面补光实测不划算**：自下而上的 `DirectionalLight` 让同机位 8s 采样 62.1 → 165.2 fps（2.7× 帧时）
   只换来顶带 p95 0.06497 → 0.08002，撤灯改走 emissive 烘焙。已验证 65。
7. **删分支后的残留引用**：探针里 5 条绑 2D 的断言、`selfcheck.py` 页脚还打印 `shots-batch8`、
   `docs/deploy.md` 排错段还在教人查 `mode=flat`——全部改掉并各记一条踩坑（已验证 62）。

## 落点文件

- 删除 `src/svg2d.ts`（398 行）。
- `src/config.ts`（+90）：`qualityTier()` 两档常量、`fovForAspect()` / `aspectRamp()` / `PORTRAIT_ASPECT`、
  `ROOM_FOV_MIN = 56`、`SPINE_TITLE_MAX`；`src/scene3d.ts`（+394）：`roomEye()` / `hallPose()` 自适应、
  `frameCheck()` 点集分组、`spineProbe().px`、`tapVerdict()`、材质 `emissive/emissiveMap`、`setFov()` 补
  `updateProjectionMatrix()`（批 8 遗留 bug，不刷新矩阵整条自适应链静默失效）；`src/atlas.ts`（+95）：题签底板重绘；
  `src/spacekit.ts`（±8）；`src/main.ts`（−189 净）/ `src/state.ts`（−8）/ `src/styles.css` / `index.html` 去 2D 残留。
- 门槛：`tools/selfcheck_probe.mjs`（+276：新增 9 条、反写 5 条、bloom 簇窗、书脊 px）；
  `tools/selfcheck.py`：`SPACE_ASSERT_MIN = 98`、`PROBE_SHOTS = _work/shots-batch9`、页脚目录名。
- 取证：新增 `tools/shots_batch9.mjs`（同机位 before/after，含 390 组触摸开书与搜索）。
- 文档：`docs/design.md` 第七节整节重写为「移动端 3D 适配（批 9）」（7.1 画质档 / 7.2 构图自适应 /
  7.3 手势 / 7.4 光照与题签可读性）；`docs/deploy.md` 新增 2.1 逐批体积漂移表 + §4.5 整段改写
  （「移动端同样是 3D，白屏查 WebGL 支持与 DPR」）；`docs/pitfalls.md` 已验证 **62–68**（7 条）+ 排查 **37–41**（5 条）；
  铁律第 4 条三份（`agents.md` 摘要 + `.qoder` / `.lingma` 全文）改为「全端只有一条 3D 路径」；`README.md` 状态表与批次行。
- `_work/`：`decisions.md` 批 9 节 21 行决策、`last-result.md`（本文件）、`status.md`、`shots-batch9/`（该目录被 `.gitignore` 忽略，与批 8 同规矩，只入库文本记录）。

## 遗留

- **真机帧率与观感仍未测**：headless d3d11 无 vsync 上限，余量按 1.4× 看；且 headless rAF 饱和使窄屏 fps
  断言只能当回归底线，不能证明降档收益——收益要靠真机帧时曲线复核。
- 竖屏阅览室 `back 0/4`、`sidewall 0/4`：画面是「正面书墙 + 天花 + 地面」的纵深感，不是完整盒子。
  要完整盒子就得接受书脊点不中，两者在 20° 水平半角下不可兼得；后续可加双指细调景别（捏远捏近）而不是改判据。
- bloom 在窄屏是关的，高光簇 p95 从 0.3076 掉到 0.27978 档，观感仍是截图级判读。
- 「按层分页浏览书架」这条批 8 遗留随 2D 删除自动消失，但窄屏一次只读得到正面一排（`shelves 1/3`），
  真正顺手的竖屏书架浏览还需要「上下滑动换排」的手势语义。
- 批 5 生成层、6.1 Sites 发布仍未开工 / 未执行。
