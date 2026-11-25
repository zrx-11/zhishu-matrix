# 当前：批 7 3D 渲染层完成（88 项全绿，dist 9.883 MiB），待进批 5 生成层；发布仍未执行

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| A1 · 改前基线取证 | done | HEAD `096d428`：`dist` 9.846 MiB / 347 文件、`assets` 5,458,913 B / 76 片、门槛 **74 项全绿**；逐视图三角面/draw call/亮度三带/光点数进 `_work/shots-batch7/before-metrics.json` + `before-*.png` 9 张，表进 `_work/decisions.md`「批 7 阶段 A」节 | 无 |
| A2 · 硬约束核对 | done | 零外部资产：`dist/assets` 内 `.hdr/.glb/.gltf/.ktx2/.png/.jpg` 计数 **0**，env 走 `PMREMGenerator` + 程序化 canvas；`data/` 一字未动、`docs/schema.md` 未改、交互行为不变（返回位姿差 0.000） | 无 |
| B1 · 材质与光照 | done | 新 `src/spacekit.ts`（灯光套件 / PMREM 环境 / 后期链 / 程序化贴图 / 立柱与底座几何）；11 处 Basic 逐条处置（6 处转 Standard、4 处保留为标记与发光件、`GridHelper` 删除并入地面贴图）；灯 3 类 8 盏（半球 + 投影方向 + 6 学科点光，distance/decay 齐）；`scene.environment` 由 PMREM 生成、源贴图用完即弃 | 无 |
| B2 · 亮度标定 | done | 标定网格三档（洗白 0.42 → 0.155 → 取 key 1.5 / hemi 0.42 / groundAlbedo 15 / exposure 1.0），房间 top 1000→700、rim 420→392 且抬到 y=18 消地面热点；脚本 `tools/tune_batch7.mjs` 留档 | 真机亮度未看 |
| C1 · 几何差异化 | done | 六区立柱 6 形态（cylinder/hexPrism/coneTower/boxPillar/stackedDrum/ringColumn）+ 底座 3 形态，全代码生成；签名 `type:shape:vertexCount`（数学 76 vs AI 40 才分得开）；高度 = 章数映射 `3.4+7.8·√min(1,章/24)` × 0.86–1.0 错落；`COLUMN_GIRTH=2.2` 把针换成柱 | 无 |
| C2 · 概念光点精灵化 | done | 一张 64² canvas 径向渐变共用贴图 + 面片实例（Additive、`depthWrite:false`），尺寸随题量 `1.5+1.15·√t`、颜色学科色插白 0.3、绕柱 4.3 环三层错落；math 398 / ai 462（≤600）；**CPU 侧 billboard**（`InstancedMesh.raycast` 读实例矩阵，着色器方案会让光点点不中） | 无 |
| D1 · 后期与氛围 | done | `RenderPass → UnrealBloomPass → OutputPass`，延迟建链（2D 路径不碰 three）；bloom 首值 (0.9,0.4,0.5) 扫三档定 **(0.55,0.55,0.55)**、内部分辨率 0.65×；雾 520–1250；DPR ≤2 且 `composer.setPixelRatio` 显式设；resize 同步改 composer + bloom | 无 |
| D2 · 帧时回收 | done | 阴影只烘一次（`autoUpdate=false` + 位姿变化 `needsUpdate`）省 ~11%、bloom 0.65× 省 ~11%；大厅 ~53 → **64.9fps**、数学区 **63fps**、AI 区 88.7 | 真机帧率未测（headless 无 vsync 上限） |
| E1 · 门槛断言 | done | 探针新增 **14 条**（灯 3 类 / `castShadow` / PCF 有效类型 + `requested=Soft` / mapSize ≥1024 / 点光 ≥6 带衰减 / PMREM 指纹 / 后期链 + bloom 参数 / 雾 + DPR / bloom A/B 亮度差 / 阴影双口径 / 受光材质 ≥4 / 立柱形态 ≥3 且跨区签名不同 / 光点 billboard + 贴图 + 数量 / 阴影 A/B / `dist ≤12 MiB` 新记录）；74 → **88 项全绿**，未删未放宽 | 无 |
| E2 · 文档 | done | `docs/design.md` 新增第十二节「渲染层（批 7 落地）」并在第八节标注旧「不用实时阴影」废止；`docs/pitfalls.md` 已验证 **39–45**（7 条）+ 排查顺序 **28–30**（3 条）；`README.md`/`agents.md` 批次表与门槛项数同步 | 无 |
| E3 · after 截图 | done | `after-*.png` 9 张与 before 同机位（机位由视图与布局决定，不受材质灯光影响）+ `after-metrics.json`；标定对照 `dbg-*.png` 4 张留档 | 视觉判读只到统计 + 截图级，「好不好看」未肉眼验收 |
| 体积 | done | 9.846 → **9.883 MiB / 347 文件（+38,531 B，全在 `assets/` JS 分包）**，上限 12 MiB 占 82.4%；文件数不变即零新增资产 | 无 |
| 其它门槛 | done | `check_offline.py` 违规 0；`tsc --noEmit` 退出 0；`npm run build` 成功；390 视口 `mode=flat`、`scrollWidth=390`、无 `#three-root canvas`、零外部请求 | 无 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」，不进依赖图与诊断链 | 建议门槛加「生成内容不出现在检索结果与图示队列」 |
| 6.1 · Sites 发布 | blocked | 产物就绪，命令与配额核对见 `docs/deploy.md` 第三节；**本批按要求未 push、未重发线上站点** | 发布由主控决定；重发须先本地 `npm run build` 出新鲜 `dist/` |
| 远端 push | blocked | `git remote -v` 为空 | 无远端可推（第 3 类必须停）；本批只 commit |
| 后台进程 | idle | 自检自带临时静态服务，跑完即关 | 手测走 `npm run preview`（`.gz` 形态）或 `npm run dev`（明文） |

## 下一步

进批 5 生成层（本批按任务书没有顺手实现）。发布（6.1）留给人工。
门槛继续 `python tools/selfcheck.py`（现 **88 项**）；收尾与交付一律完整重跑，勿用 `--skip-build`（pitfalls 31）。
若真机帧率不达标，回退顺序：`BLOOM_SCALE` 0.65 → 0.5 → 关 bloom，再考虑 `mapSize` 2048 → 1024（每档独立可回退，见 `_work/last-result.md` 待决策 1）。
