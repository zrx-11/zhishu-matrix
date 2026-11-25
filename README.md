# 知枢矩阵 · Zhishu Matrix

把 `zrx-11` 名下的知枢静态学习站（实测 50 个仓库、131 份 `manifest.json`、去重后 96 本独书 / 129 条书目）重构整合成一个 3D 知识空间。库内先检索，查不到再调 Agent 现场生成。

站本体形态：进大厅看全局拓扑 → 进房间看学科 → 点节点看章节 → 搜不到时现场生成。

## 当前状态

批 1 数据、批 2 空间、批 3 阅读层已落地；检索与生成层未开工。

| 阶段 | 状态 |
|---|---|
| 目录与规则骨架 | 完成 |
| 抽取器 `tools/extract.py` | 完成（50 仓 → 129 本书入 `data/`，`tools/verify_data.py` 四类校验全绿） |
| 3D 空间 | 完成（六区大厅 + 房间展台 + 小地图 + WASD + 走廊学科名，触屏/窄视口降级 2D SVG） |
| 阅读层 | 完成（正文按需加载、`contentLevel` 三档分流、KaTeX 双定界符、外链降级） |
| 检索层 | 待批 4 |
| 生成层 | 待批 5 |
| 打包与发布 | 待批 6 |

规模实测（2026-11-25，`data/manifest.json`，265 个文件 / 15.3MB）：
**独书 96 · 条目 129 · 章 1,169 · 概念 765 · 题 3,541 · 卡 4,100 · 术语 4,100**。

## 在 Qoder 里怎么开始

1. 用 Qoder CN 打开本文件夹作为工作区
2. `npm install` → `npm run dev`（127.0.0.1:5173），或 `npm run build` + `npm run preview`（4173）
3. 改了 `data/` 先跑数据门槛 `python tools/verify_data.py`；改了 `src/` 跑批 3 全量门槛
   `python tools/selfcheck.py`（39 项：数据校验 + tsc + build + 无头 Edge 探针 32 条，含 390px 溢出、
   零外部请求、按需加载、帧率、三档分流、走廊学科名留证）
4. 新建 Quest，选 Spec 驱动，第一句写：

```
先读 AGENTS.md 和 docs/，按其中约束执行。本轮只做 <批号/文件>。
```

## 目录

```
├─ AGENTS.md          主约束与索引
├─ docs/
│  ├─ schema.md       数据契约
│  ├─ design.md       3D 空间与交互
│  ├─ pitfalls.md     抓取与渲染踩坑
│  └─ sites.md        站点清单
├─ tools/             extract.py 抽取 · verify_data.py 数据校验 · selfcheck.py 交付门槛
├─ data/              只读产物，业务代码不写
│  ├─ manifest.json   合并索引
│  ├─ sites/          单书结构，129 份
│  ├─ bodies/         章节与概念正文，点开才取
│  └─ dist/           学科分片（tools 无 manifest，缺该分片）
└─ src/               前端：main / scene3d / svg2d / layout / render / panel / state / data / config
```

## 边界

- 库内内容来自已跑过知枢流水线的产物，可信
- AI 现场生成的内容标记「未经校验」，不参与依赖图与诊断
- 纯静态部署时生成结果存不住；本项目用 Qoder Sites Agent App 的数据库解决

## 数据来源

所有站点属于 `zrx-11` 名下的 GitHub 仓库，`main` 分支根目录。清单见 `docs/sites.md`。
