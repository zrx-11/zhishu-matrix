# 当前：批 8 空间化完成（110 项全绿，dist 9.903 MiB），待进批 5 生成层；发布仍未执行

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| A1 · 改前基线取证 | done | HEAD `d60f3ae`：`dist` 9.883 MiB / 347 文件、门槛 **88 项全绿**；六区 + 大厅的三角面/draw/亮度/光点数进 `_work/shots-batch8/before-metrics.json` + `before-*.png` 9 张 | 无 |
| A2 · 借鉴清单 | done | 只取思路与算法（书房式分区、书脊即条目、图集烘字、合并几何 + 面区间拾取），**零资产拷贝**；判据/硬约束十条逐条落到断言，表进 `_work/decisions.md`「批 8 阶段 A」节 | 无 |
| B1 · 阅览室 + 八角厅 + 走廊 | done | 新 `src/architecture.ts`：`buildRoomShell`（4 面朝内墙 + 藻井 7 梁 + 4 踢脚 + 4 挂线 + 7.2×9.2 门洞 + 门楣牌匾）、`buildHall`（八边壳 8 墙 / 6 门洞 / 16 梁 / 地面总览图合并几何 / 吊灯）、`buildCorridor`（侧墙 + 顶 + 地三面朝内，改回 `FrontSide`）；机位按房间自身轴摆（`rotation.y = π/2 − angle`） | 无 |
| B2 · 逐视图氛围 | done | 雾与帧缩放从「场景常量」改成「视图参数」：`HALL_FOG 420/1500`、`ROOM_FOG 210/620`、`ROOM_RENDER_SCALE 0.85`（大厅 1.0），并把 `renderScale` 暴露进 `census()` | 真机（非 headless）观感未看 |
| C1 · 书架墙布置账 | done | `src/layout.ts` 重写：章数 → 脊宽（0.42–0.72 归一）→ 书位宽 → 三面墙 × 3–6 层贪心分层；`planRoom` 纯数学不碰 three，输出 room-local 坐标与基向量。收尾补转角让位（`corner = SHELF_DEPTH + 0.2`）与 0 本区也建三排空架 | 窄视口按层分页浏览（现投影压层）留后续批 |
| C2 · 书脊图集 + 合并几何 | done | 新 `src/atlas.ts`：`2048²` 图集、格 `64×320` 竖排标题、192 格/页、≤3 页；`buildSpines` 每脊 6 面 12 三角，**非索引**合并，一页图集 = 一个 Mesh = 一个 draw call（math 2 mesh / ai 3 mesh / chem·cs·general 各 1） | 无 |
| C3 · 拾取重做 | done | 构建期给每个三角落 `triRole / triSlot / triChapter / triSpine` 四张等长表，点击时 `faceIndex` O(1) 取书与章；批 7 的 `InstancedMesh` 立柱拾取整段删除，未留第二套实现 | 无 |
| D1 · 标签迁移 | done | 区名 → 门楣牌匾纹理、走廊名 → 地面铭牌纹理、章名 → 书脊图集纹理；实测 `labels.sprites 0 / domFloating 0 / spineTitles = 书数`（math 45、ai 49） | 无 |
| D2 · 延迟 tooltip | done | 悬停 120ms 才浮一条 `.hover-tip`，移开 `pointerleave` 立即收起；三条延时行为各自成断言 | 无 |
| D3 · 光尘不遮书脊 | done | 概念光点从展台圆盘搬到书架前沿（math 398 / ai 462 颗，共用 64² 径向渐变贴图 + CPU 侧 billboard）；判据用「怼到脊前跑真实射线」——6 条样本全中即证明尘粒没抢命中 | 无 |
| E1 · 门槛断言 | done | 探针静态名单 70 → 84（新增 18、删除 3 条随立柱作废、`受光材质 ≥4` 仅改措辞），实跑 **91 条**（>88，常量 `SPACE_ASSERT_MIN = 89`）；新体积上限 `SPACE_DIST_MAX_MIB = 10.6`；**110 项全绿、0 失败** | 无 |
| E2 · 文档 | done | `docs/design.md` 第十三节「空间结构（批 8 落地）」（ anatomy 表 / 逐区书脊表 / 释放 / 光尘 / 增量表）；`docs/pitfalls.md` 已验证 **46–61**（16 条）+ 排查顺序 **31–36**（6 条）；`README.md` + `AGENTS.md` 批次表与门槛项数同步，AGENTS 增补第 8 条铁律摘要 | 无 |
| E3 · after 取证 | done | 同机位 `after-*.png` **26 张**（含六区特写书脊 18 张、走廊、2D 降级）+ `after-metrics.json`；`errors: []` | 「好不好看」仍是统计 + 截图级判读 |
| 体积 | done | 9.883 → **9.903 MiB / 347 文件（+20 KiB）**，全在 `assets/` 的建筑与图集代码，零新增资产文件；上限 10.6 MiB 占 93.4% | 无 |
| 其它门槛 | done | `check_offline.py` 违规 0；`tsc --noEmit` 退出 0；`npm run build` 成功；390 视口 `mode=flat`、`scrollWidth=390`、无 WebGL 画布、SVG 194 节点、指头点书位开正文且开的是点到的那本；零外部请求；控制台/页面异常 0 条；WASD 位移 14.37 / 朝向漂移 0；检索返程位姿差 0.000 | 无 |
| 铁律核对 | done | `data/` 一字未动、`docs/schema.md` 契约未改、目录结构未动；零外部资产计数 0 | 无 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」，不进依赖图与诊断链；工具间区 0 本的空书架正等这一批补源 | 建议门槛加「生成内容不出现在检索结果与图示队列」 |
| 6.1 · Sites 发布 | blocked | 产物就绪，命令与配额核对见 `docs/deploy.md` 第三节；**本批按要求未 push、未重发线上站点** | 发布由主控决定；重发须先本地 `npm run build` 出新鲜 `dist/` |
| 远端 push | blocked | `git remote -v` 为空 | 无远端可推（第 3 类必须停）；本批只 commit |
| 后台进程 | idle | 自检自带临时静态服务，跑完即关；取证用的 4199 静态服务已停 | 手测走 `npm run preview`（`.gz` 形态）或 `npm run dev`（明文） |

## 下一步

1. **批 5 生成层**：Agent App + 数据库落库；查不到才生成，显著标「AI 现场生成 · 未经校验」，不进依赖图与诊断链。
   生成结果在阅览室里的落点建议是「工具间那三排空架」，与库内内容物理隔离。
2. 窄视口移动端书架浏览：2D 平面投影把同墙多层压成一条线，可点书位每区只剩 7–8 个，
   要么按层分页、要么改成立面（侧视）布局——判据是探针能点到的书位数接近书位总数。
3. 6.1 发布仍待人工：`docs/deploy.md` 第三节路径，重发前必须新鲜 `dist/`（当前 `dist/` 即批 8 落点构建）。
