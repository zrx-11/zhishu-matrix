# 知枢矩阵 · Zhishu Matrix

把 `zrx-11` 名下的知枢静态学习站（实测 50 个仓库、131 份 `manifest.json`、去重后 96 本独书 / 129 条书目）重构整合成一个 3D 知识空间。库内先检索，查不到再调 Agent 现场生成。

站本体形态：进大厅看全局拓扑 → 进房间看学科 → 点节点看章节 → 搜不到时现场生成。

## 当前状态

批 1 数据、批 2 空间、批 3 阅读层、批 3.5 图示真渲染、批 4 检索层、批 6 打包收敛、批 7 渲染层、批 8 空间化、批 9 全端 3D、批 10 构图反算与补光做工已落地；生成层待批 5，发布动作待人工执行。

| 阶段 | 状态 |
|---|---|
| 目录与规则骨架 | 完成 |
| 抽取器 `tools/extract.py` | 完成（50 仓 → 129 本书入 `data/`，`tools/verify_data.py` 五类 23 项校验全绿） |
| 3D 空间 | 完成（六区大厅 + 阅览室 + 小地图 + WASD + 走廊学科名；批 9 起全端只有一条 3D 路径，2D 降级视图已删除） |
| 移动端 3D | 完成（批 9：`qualityTier()` 一处两档降画质（窄屏 dpr ≤1.5、关阴影关 bloom、光尘 220、帧缓冲 0.72），fov 与机位按 aspect 自适应，单指旋转 / 双指缩放 / ≥8px 判拖拽；批 10 竖屏构图反算（fov 56→76 + 水平挤压 Kx 1.55 + 机位 span 142→260/pitch 38°→64°）：大厅主体竖向 66.2%/横向 83.4%、六门全在画、纯黑 1.2%、底部 UI 净空 12.6%，阅览室竖向 92.9%、后墙/侧墙各 2/4，390 实测大厅 116.7 / 数学区 110.8 fps，`docs/design.md` 第七、十四节） |
| 空间结构 | 完成（批 8：圆盘阵列改阅览室——四墙天花地板 + 三面书架墙，一章一书脊、书名烤进图集，拾取走 faceIndex 区间映射，HTML 浮标归零。零外部资产，`docs/design.md` 第十三节；批 10 题签收窄到 0.625 露烫金线/菱形，图集参数 + 渲染实测双证） |
| 渲染层 | 完成（批 7：PBR 材质 + 半球/投影方向/逐区学科点光 + PMREM 程序化环境光 + Bloom；六区立柱 6 种几何、概念光点精灵化。零外部资产，`docs/design.md` 第十二节。批 9 C1 补光照：顶面法线朝下打不动，改走 HemisphereLight 地面色 + 墙/天花/横梁的 `emissive/emissiveMap` 反弹。批 10 大厅补光：藻井环 8 扇环带 + 梁 emissive、地面乘子 1.9、hemisphere 0.52→0.8——梁/板差 26.4、门洞内外差 64.9/255、整帧 p5 0.0196；题签收窄到 0.625 脊宽，字口反差 min 15.21） |
| 阅读层 | 完成（正文按需加载、`contentLevel` 三档分流、KaTeX 双定界符、外链降级、侧栏 + 全屏双模式） |
| 图示（Mermaid） | 完成（882 个围栏 / 855 章动态分包渲染，可见才加载，失败回退源码；5 类图型本地出 SVG 零远程） |
| 检索层 | 完成（六片 `search-<area>.json` + MiniSearch 分片懒加载，`/` 与 `Ctrl+K`，按 `file` 精确落点，返回复原位姿） |
| 生成层 | 待批 5 |
| 打包收敛 | 完成（`dist/` 22.83 → 9.85 MiB：数据预压 `.json.gz` + mermaid 白名单裁剪，详见 `docs/deploy.md`）；批 7 渲染层 +0.037 MiB → 9.88 MiB，批 8 空间化 +0.023 MiB → 9.903 MiB，批 9 删 2D 视图 −2 KiB → 9.901 MiB，批 10 藻井环/镜头挤压/采样探针 +11 KiB → **9.912 MiB**（上限 10.6，文件数 347 四批未变） |
| 发布 | 未执行（需账号，属人工步骤；`docs/deploy.md` 第三节写了命令路径） |

规模实测（2026-11-25，`data/manifest.json`，265 个文件 / 15.3MB）：
**独书 96 · 条目 129 · 章 1,169 · 概念 765 · 题 3,541 · 卡 4,100 · 术语 4,100**。
检索分片实测（`data/dist/search-*.json` 六片）：books 129 · chapters 1,169 · concepts 765 · terms 4,100 全量入索引，
单片最大 ai 281.2KB（阈值 300KB），tools 区库里 0 本出 0.3KB 空片。
产物实测（`dist/`，2026-11-26）：**9.912 MiB / 347 文件**（批 6 基线 22.83 MiB / 391 的 43.4%；批 7 渲染层净增 38.5 KB、批 8 空间化净增 23 KB、批 9 删 2D 视图净减 2 KB、批 10 补光与构图净增 11 KB，四批都零新增资产文件），最大单文件 1.45 MiB，
数据族以 `.json.gz` 预压落盘 —— 分族数字与部署路径见 `docs/deploy.md`。

## 在 Qoder 里怎么开始

1. 用 Qoder CN 打开本文件夹作为工作区
2. `npm install` → `npm run dev`（127.0.0.1:5173），或 `npm run build` + `npm run preview`（4173）
3. 改了 `data/` 先跑数据门槛 `python tools/verify_data.py`；改了检索分片先 `python tools/build_search_index.py`；
   改了 `src/` 跑全量门槛 `python tools/selfcheck.py`（110 项：数据校验 + tsc + build + 离线静态扫描 +
   分包取证 + 产物体积收敛 + 无头 Edge 探针，含 390px 溢出、零外部请求、按需加载、mermaid 懒加载与白名单外图型回退、
   帧率、三态检索、检索返程位姿、光照/环境/后期链与三角面双口径、六区房间建筑账与书脊图集/拾取映射）。**收尾与交付必须完整重跑**，`--skip-build` 复用旧 `dist/` 会把已修的改动验成失败
4. 新建 Quest，选 Spec 驱动，第一句写：

```
先读 AGENTS.md 和 docs/，按其中约束执行。本轮只做 <批号/文件>。
```

## 目录

```
├─ AGENTS.md          主约束与索引
├─ docs/
│  ├─ schema.md       数据契约
│  ├─ design.md       3D 空间与交互（第十节图示渲染、第十一节检索层、第十二节材质光照、第十三节空间结构）
│  ├─ deploy.md       发布包形态、实测体积、部署命令与排错
│  ├─ pitfalls.md     抓取与渲染踩坑
│  └─ sites.md        站点清单
├─ tools/             extract.py 抽取 · build_search_index.py 检索分片 · verify_data.py 数据校验
│                     check_offline.py 离线静态扫描 · selfcheck.py 交付门槛
├─ data/              只读产物，业务代码不写
│  ├─ manifest.json   合并索引
│  ├─ sites/          单书结构，129 份
│  ├─ bodies/         章节与概念正文，点开才取
│  └─ dist/           学科结构分片 5 片 + 检索分片 search-<area>.json 六片
├─ dist/              构建产物：明文 data/ 换成预压 .json.gz，只拷运行期真要取的族
└─ src/               前端：main / scene3d / architecture / spacekit / atlas / layout /
                      render / diagram / panel / search / state / data / config
                      （批 9 删除 svg2d.ts，2D 降级视图不再存在）
```

## 边界

- 库内内容来自已跑过知枢流水线的产物，可信
- AI 现场生成的内容标记「未经校验」，不参与依赖图与诊断
- 纯静态部署时生成结果存不住；本项目用 Qoder Sites Agent App 的数据库解决

## 数据来源

所有站点属于 `zrx-11` 名下的 GitHub 仓库，`main` 分支根目录。清单见 `docs/sites.md`。
