# 当前：批 9 全端统一 3D + 移动端适配 + 光照修复完成（117 项全绿，dist 9.901 MiB），待进批 5 生成层；发布仍未执行

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| A1 · 改前基线取证 | done | 基线 = 批 8 落点（`dist` 9.903 MiB / 347 文件、110 项全绿、探针 91 条）；批 8 的 26 张 `after-*` 同机位复制为本批 30 张 `before-*` + `before-metrics.json` | 无 |
| A2 · 删 2D 降级 | done | `src/svg2d.ts` 398 行整段删除，另去 `MatrixFlat` / `prefersFlatView()` / `?flat=1` / `main.ts` 的 `'flat'` 分支 / `els.flat` / `index.html` 的 `#svg-root` / SVG 专用 CSS 16 行；`tsc --noEmit` 退出 0 | 无 |
| A3 · 全端走 3D 实测 | done | 1440、390 竖屏、触摸 UA 三种环境 `mode === 'three'`，390 `scrollWidth=390`、WebGL 画布存在、`scene3d-D7ZsDihQ.js` 已加载、整帧 mean 0.04412（非全黑）、控制台与页面异常 0 条 | 无 |
| B1 · 竖屏构图 | done | `fovForAspect()` 56→76 + `aspectRamp()`；`roomEye()` 横屏沿用 `side*0.3`、竖屏 `side*0.5−1.5`；`hallPose()` 按水平视野解距离，390 大厅 20/20 结构点入画；阅览室 `face/ceiling/floor` 各 4/4 + `shelves 1/3`；`setFov()` 补 `updateProjectionMatrix()`（批 8 遗留 bug） | 完整盒子构图与「点得中」在 20° 水平半角下不可兼得，已定为不追 |
| B2 · 画质档 | done | `config.ts:qualityTier()` 一处两档：窄屏 dpr ≤1.5、关阴影、光尘 220、bloom 关、帧缓冲 0.72；`scene3d` / `spacekit` 只读结果。390 大厅 165.2 / 阅览室 146.2 fps，桌面大厅 77.5 / 六区 70.3–87.4 | headless rAF 饱和，降档收益需真机帧时曲线复核 |
| B3 · 触摸手势 | done | OrbitControls 单指旋转 / 双指缩放；拾取沿用批 8 `faceIndex → (book, chapter)` 反查，无第二次射线；`tapVerdict()` 触屏 8px / 鼠标 6px。实测轻点 i=48 → ch05 正文 3,221 字、`px=39`；滑动 moved 17 → `action:'drag'` 且阅读层仍 closed | 无 |
| C1+C2 · 顶面与墙面 | done | 撤掉自下而上的补光（2.7× 帧时只换 p95 +0.015）；走 HemisphereLight 地面色 `0x10131a→0x3c4352`、强度 `0.36→0.52` + 墙/天花/横梁 `emissive + emissiveMap`（0.11/0.22/0.16）、天花单独出材质、墙基色 `#2f2620→#3d3026`；走廊顶带 p95 0.03496 → 0.04202，不是白墙 | 观感仍是截图级判读 |
| C3 · 书脊题签 | done | 图集每格加暗色题签底板、字色 `#f7e9c9→#f7f2e4`、`measureText` 实宽自适应截断；反差 min math 16.59 / ai 15.21 / chem 16.35 / cs 15.63 / general 16.24（门槛线 4.5） | 无 |
| D1 · 门槛断言 | done | 探针 91 → **98 条**（新增 9、反写 5、删除 0），`SPACE_ASSERT_MIN 89 → 98`；bloom 判据加高光簇窗（阈值未降）；新增 `spineProbe().px` 诊断与 ≥36 门槛；**117 项全绿、0 失败** | 无 |
| D2 · 文档 | done | `docs/design.md` 第七节重写「移动端 3D 适配（批 9）」7.1–7.4；`docs/deploy.md` 2.1 逐批漂移表 + §4.5 整段改写（白屏查 WebGL 与 DPR）；`docs/pitfalls.md` 已验证 **62–68** + 排查 **37–41**；铁律第 4 条三份同步；`README.md` / `AGENTS.md` 批次表 | 无 |
| D3 · 体积记账 | done | 9.903 → **9.901 MiB / 347 文件**（−2 KiB）；svg2d 在 entry 静态闭包内，本批诊断与构图代码落在同批 chunk，净值近零；上限 10.6 MiB 占 93.4% | 无 |
| E · after 取证 | done | `after-*.png` **28 张**（大厅 / 六区 / 走廊 / 15 张书脊特写 / 阅读层 / 390 四张）+ `after-metrics.json`，`errors: []` | 无 |
| 其它门槛 | done | `check_offline.py` 违规 0；零外部资产计数 0；外部请求 0（81 请求全本地）；WASD 位移 14.2 / 朝向点积 1；检索返程位姿漂移 0 | 无 |
| 铁律核对 | done | `data/` 一字未动、`docs/schema.md` 未改、目录结构未动；AI 生成内容仍未接入（批 5） | 无 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」，不进依赖图与诊断链；工具间区 0 本的空书架正等这一批补源 | 建议门槛加「生成内容不出现在检索结果与图示队列」 |
| 6.1 · Sites 发布 | blocked | 产物就绪，命令与配额核对见 `docs/deploy.md` 第三节；**本批按要求未 push、未重发线上站点** | 发布由主控决定；重发须先本地 `npm run build` 出新鲜 `dist/` |
| 远端 push | blocked | `git remote -v` 为空 | 无远端可推（第 3 类必须停）；本批只 commit |
| 后台进程 | idle | 自检自带临时静态服务，跑完即关；取证用的临时端口已释放 | 手测走 `npm run preview`（`.gz` 形态）或 `npm run dev`（明文） |

## 下一步

1. **批 5 生成层**：Agent App + 数据库落库；查不到才生成，显著标「AI 现场生成 · 未经校验」，不进依赖图与诊断链。
   生成结果在阅览室里的落点建议是「工具间那三排空架」，与库内内容物理隔离。
2. 竖屏书架浏览的手势语义：现在一次只读得到正面一排（`shelves 1/3`），可加「上下滑动换排」或双指细调景别，
   判据用 `frameCheck().groups.shelves.in` 与可命中书脊数一起看，别再把两侧墙顶点塞回判据。
3. 真机（非 headless）帧时与观感复核：画质档的收益目前只有开关断言，没有帧时曲线。
4. 6.1 发布仍待人工：`docs/deploy.md` 第三节路径，重发前必须新鲜 `dist/`（当前 `dist/` 即批 9 落点构建）。
