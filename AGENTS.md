# 知枢矩阵 · Zhishu Matrix

把 zrx-11 名下的 40+ 个知枢静态学习站，重构整合成一个统一的 3D 知识空间：
进大厅看全局拓扑，进房间看学科，点节点看具体章节；库内查得到就直接展示，查不到再调 Agent 现场生成。

## 铁律（每次对话都必须遵守）

完整版在 `.qoder/rules/zhishu-rules.md` 与 `.lingma/rules/zhishu-rules.md`。此处只列摘要：

1. 公式一律 KaTeX，行内 `$...$`，独立 `$$...$$`，禁止反引号包裹
2. 渲染结果不得在运行时发起任何网络请求；运行时资源全部本地化到 `vendor/`（xmlns 声明、代码块内 URL、example.com/localhost 等保留域名三类白名单除外）
3. 390px 视口 `scrollWidth === 390`，无横向滚动
4. 3D 在触屏或宽度 < 768px 时自动降级 2D SVG，不得白屏
5. AI 生成内容必须标「AI 现场生成 · 未经校验」，不进依赖图、不进诊断链
6. `data/` 由抽取器产出，业务代码只读不写
7. `prerequisites` 抽不到留空数组，禁止推测填充

## 技术栈（默认，可在 Spec 中调整）

| 层 | 选型 |
|---|---|
| 构建 | Vite + TypeScript |
| 3D | Three.js（vendor） |
| 2D 降级 | SVG + 原生 DOM |
| 检索 | MiniSearch（vendor） |
| 渲染 | markdown-it + KaTeX + Mermaid（全 vendor） |
| 存储 | Qoder Sites Agent App（数据库） |

## 按需读取

| 场景 | 先读 |
|---|---|
| 改数据结构、写解析器 | `docs/schema.md` |
| 做 3D、布局、交互 | `docs/design.md` |
| 处理抓取失败、渲染异常 | `docs/pitfalls.md` |
| 需要仓库清单与规模 | `docs/sites.md` |

## Spec 规则

若 `docs/` 下已有对应设计文档，以文件为准，不要另起 Spec 覆盖；Spec 只列本次任务对现有文档的增量。

## 目录

```
zhishu-matrix/
├─ AGENTS.md              本文件
├─ README.md              项目说明与当前状态
├─ docs/
│  ├─ schema.md           数据契约
│  ├─ design.md           3D 空间与交互设计
│  ├─ pitfalls.md         抓取与渲染踩坑
│  └─ sites.md            40 站清单
├─ tools/
│  ├─ README.md           脚本说明
│  └─ extract.py          抽取器（待批 1 生成）
├─ data/
│  ├─ manifest.json       合并索引
│  └─ sites/              单站数据，一文件一站
└─ src/                   前端（待生成）
```

## 批次

| 批 | 交付 | 状态 |
|---|---|---|
| 1 | 抽取器 + 统一 schema + 合并索引 | 完成 |
| 2 | 3D 房间式空间 + 小地图 + 移动端降级 | 完成 |
| 3 | 阅读层（正文、公式、题目、卡片） | 完成 |
| 3.5 | Mermaid 真渲染（动态分包、可见才渲染）+ `check_offline.py` 收进门槛 | 完成 |
| 4 | 检索层（MiniSearch + 分片加载） | 完成 |
| 5 | 生成层（Agent App + 数据库落库） | 待开工 |
| 6 | 打磨 + 打包 + Sites 发布 | 待开工 |
