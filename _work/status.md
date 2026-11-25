# 当前：批 3 阅读层 + 交付门槛完成，待进批 4 检索层

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| 阶段 A · 数据校验 | done | `tools/verify_data.py`：四类 18 项全绿、退出码 0；6 个变异副本反证「改坏必红」 | 无 |
| 阶段 B · 文档口径 | done | `README.md` 状态表 + 规模实测；`design.md` 三/四/五/六节按全库重算；`pitfalls.md` 已验证 16–23、待验证 2 铺开、排查顺序 11–16；`tools/README.md` 三脚本登记 | 无 |
| 阶段 C1 · 正文按需加载 | done | `src/data.ts::loadBody()` 单飞 + 缓存；自检实测全程 bodies 7 次 / 总请求 29，大厅与分区阶段零正文请求 | 无 |
| 阶段 C2 · bodyType 三档分流 | done | `src/render.ts` md/html 两支；`panel.ts` full/degraded/stats-only 三态；stats-only 用调用侧合成样本（库里实测 0 本） | 无 |
| 阶段 C3 · KaTeX 双定界符 | done | npm `katex@0.16.47` 打进 bundle，`$...$`/`\(...\)`/`$$...$$`/`\[...\]`，`throwOnError:false` 失败保原文；字体同源 `/assets/` | 无 |
| 阶段 C4 · 外链降级 | done | 渲染期把 13 处 `mp.weixin.qq.com` 转纯文本 + 标注，点击零请求；`data/bodies/` 未改 | 抽取期是否改用 `--link-policy strip`（属覆盖已跟踪 `data/`，须停） |
| 阶段 C5 · 阅读页 | done | 侧栏 + 全屏双模式、章节列表 / 正文 / 概念 / 返回栈 / 面包屑；关闭后相机位姿差 0.000 且选中态保留 | 侧栏与全屏是否长期并存（待决策 2） |
| 阶段 D1 · 小地图 | done | `#minimap` canvas 俯视：六区色点 + 129 书方块 + 当前相机位置与朝向；房间视图隐藏，采样期挂起 | 无 |
| 阶段 D2 · WASD 平移 | done | WASD/方向键平移 + QE 升降，不改朝向；`inputBusy()` 在面板/输入框/采样期让位 | 无 |
| 阶段 D3 · 走廊地面学科名 | done | 六条贴地文字（fog 560/1300、y=0.62、anisotropy 4、96px 阴影字）；正对视角六条全可读，截图留证 | 大厅视角 4/6 可辨是否需继续优化（当前判定不要求） |
| 交付门槛常驻化 | done | `tools/selfcheck.py` + `tools/selfcheck_probe.mjs`：39 项，本轮全绿 50.7s；报告 `_work/selfcheck-report.json`，截图 `_work/shots-batch3/` 14 张 | `check_offline.py` 是否单列（待决策 3） |
| 自检 11 条判据 | done | 逐条过，无「接近完成」；附加铁律项 390px 无溢出、触屏降级 2D、`data/` 只读 | 无 |
| Mermaid 真渲染 | pending | 本轮显式「源码 + 未渲染说明」（855 章含围栏） | 批 6 vendor 渲染 vs 抽取期预渲（待决策 1） |
| 批 4 · 检索层 | pending | MiniSearch（npm 打进 bundle）+ 分片加载 + 命中跳 `openChapter`/`openConcept` | 无 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」 | 无 |
| 批 6 · 打包发布 | pending | `check_offline.py` 静态扫描 + Sites 发布 | 无 |
| 远端 push | blocked | `git remote -v` 为空 | 无远端可推（属必须停的第 3 类，不自行创建） |
| 后台进程 | idle | 自检自带临时静态服务，跑完即关；dev/preview 无常驻 | 需要手测跑 `npm run dev` 或 `selfcheck.py --keep-server` |

## 下一步

进批 4 检索层：`MiniSearch` 走 npm 打进 bundle，索引按学科分片（`data/dist/` 现有 5 片，tools 缺片容错沿用）；
搜索命中直接调本轮的 `openChapter` / `openConcept`（已按 `file` 精确取书，检索层不必再处理 31 个跨仓重名 slug）。
门槛沿用 `python tools/selfcheck.py`，批 4 只往 `selfcheck_probe.mjs` 追加检索断言。
