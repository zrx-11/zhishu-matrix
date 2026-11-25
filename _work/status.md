# 当前：批 3.5 Mermaid 真渲染 + 批 4 检索层完成，待进批 5 生成层

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| A1 · mermaid 分包 | done | `npm i mermaid@12.3.0`；`src/diagram.ts` 动态 `import()`。entry `index-BOvDw5BJ.js` 428.26 kB / 静态闭包 1 片 / 实现标记 0；`mermaid.core` 671.86 kB + 57 片共 5,106KB 只在看围栏时取 | 5.1MB 分包的发布形态（全带 vs 按图型白名单裁剪） |
| A2 · 渲染逻辑 | done | 占位容器 `pending` → `IntersectionObserver` 登记 `watching` → 可见才 `mermaid.render()` → `done`；失败 `error` 回退源码 + 一行原因，容器不空；模块级 promise 缓存 + 串行队列，同章 2 围栏 chunk 数 17→17 | 无 |
| A3 · 图型覆盖 | done | 库里实际 5 类各验一章：flowchart 818 / graph 55 / sequenceDiagram 6 / mindmap 2 / xychart-beta 1（855 章含围栏、882 围栏、77 本）；未硬造 classDiagram / stateDiagram | 无 |
| A4 · 产物零远程 | done | `sanitizeSvg` 留 `<style>` 剔 `script`/`on*`/远程 URL；五类图远程引用逐条 0；`securityLevel:'strict'` + `htmlLabels:false` | 无 |
| A5 · 性能 | done | mermaid 进运行时后大厅 165.1 / 分区 164.4fps；三角面 1,398 / 3,874 / 6,082（预算 15 万）；大厅与 3D 分区阶段零 mermaid chunk 零请求 | 无 |
| B · 离线扫描统一 | done | 新增 `tools/check_offline.py`（176 行），`selfcheck.py` 调用并入报告 `offline` 块；实测违规 0 / 文件 332 / 白名单 xmlns 6·保留域名 2·字面量 106·数据 200 | 无 |
| C1 · 检索分片 | done | 新增 `tools/build_search_index.py`（156 行）→ `data/dist/search-<area>.json` 六片：134.5 / 281.2 / 36.4 / 65.8 / 53.3 / 0.3 KB，`trim=full` 未降级；tools 出空片 | 摘要字段大面积为空（core 78/1,169、brief 100/765），补齐要重跑抽取器 |
| C2 · 前端索引 | done | MiniSearch 打进 entry（`autoVacuum` 指纹仅命中 entry）；大厅用 manifest 级 129 条轻索引，进区才取分片，inflight 去重 + 缺片容错；中文单字 + 二字切词 | 中文高召回（乱码中文也命中）是否要收窄 `searchOptions` |
| C3 · 搜索交互 | done | `/` 与 `Ctrl+K` 双快捷键、三组分类（章节/概念/书，各 ≤10 总 ≤24）、五态文案、390 弹层宽 370 且 `doc=390` | 无 |
| C4 · 返程落点 | done | `searchSpot` 快照区 + 位姿 + 平移 + 选中书目；每次跳转重记、`enterRoom`/`showHall` 作废；实测返回 `math→math`、位姿漂移 0.000 | 无 |
| 数据校验扩项 | done | `verify_data.py` 四类 18 项 → 五类 23 项（新增 `check_search_shards()` 六片齐 / ≤300KB / counts 三方对账 / `file` 存在 / 术语落点合法）；全绿退出码 0 | 无 |
| 自检扩项 | done | `selfcheck.py` + `selfcheck_probe.mjs` 39 → **71 项全绿**（102.6s）；新增分包取证 `bundle_evidence()`、图型与检索样本、mermaid 懒加载五证、检索分组/三态/重名/返程/390；截图 `_work/shots-batch35/` 25 张 | 无 |
| 文档 | done | `README.md` 状态表与目录；`docs/design.md` 第十节图示渲染、第十一节检索层；`docs/schema.md` 第七节检索分片契约；`docs/pitfalls.md` 已验证 24–32 + 排查顺序 17–22；`tools/README.md` 四脚本登记；`agents.md` 批次表加状态列 | 无 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」，不进分片不进依赖图 | 入口位已留（检索 `none` 态与 `stats-only` 支） |
| 批 6 · 打包发布 | pending | `dist/` 24MB 里 16.7MB 是 `publicDir` 拷进来的数据，发布前收敛；Sites 发布 | 见待决策 1、3 |
| 远端 push | blocked | `git remote -v` 为空 | 无远端可推（属必须停的第 3 类，不自行创建） |
| 后台进程 | idle | 自检自带临时静态服务，跑完即关；dev/preview 无常驻 | 手测跑 `npm run dev` 或 `selfcheck.py --keep-server` |

## 下一步

进批 5 生成层：库里查不到再现场生成，结果标「AI 现场生成 · 未经校验」、带 `source: 'ai-generated'` 落库，
**不写进 `data/dist/search-*.json`、不进依赖图、不与库内内容混排**。
门槛继续 `python tools/selfcheck.py`（建议加一条「生成内容不出现在检索结果与图示队列」）。
交付与收尾一律完整重跑，勿用 `--skip-build`（复用旧 `dist/` 会把已修的改动验成失败，pitfalls 31）。
