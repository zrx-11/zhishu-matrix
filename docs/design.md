# 3D 空间与交互设计

## 一、为什么是房间，不是星图

力导向星图适合看拓扑，不适合"知识库"的空间感。房间式固定结构，用位置记忆辅助回忆——数学在左翼、AI 在正中、化学在东南，每次进来位置一致。

规则：**3D 只做导航，不做阅读**。点节点弹 2D 详情层，正文始终在平面里读。

## 二、空间结构

```
                    中央大厅
                   （全局星图）
                        │
        ┌───────┬───────┼───────┬───────┐
        │       │       │       │       │
      数学      AI     化学    计算机   通识
      (左翼)  (正厅)  (东南)  (西侧)  (北侧)
                                    │
                                  工具间
                                 (东北角)
```

- **中央大厅**：40 站入口 + 全局依赖星图（3800 节点的整体拓扑，缩略尺寸）
- **走廊**：连接大厅与各房间，走廊地面铺该学科的站名
- **房间**：一间一学科，房间内按站点分展台，展台上立章节节点
- **工具间**：`tools` 类站点，独立小房间，不作为主路径

### 学科与站点归属

| 学科 | key | 站点 |
|---|---|---|
| 数学 | math | math-basics-enlighten、advanced-math-zhishu、math-analysis、analysis-handbook、math-physical-methods、MATH、complex-analysis-visual、probability-statistics、odes-from-scratch、ode-enlighten、ODE、gaokao-math、kaoyan-math-66000、math-competition-derivation、additive-combinatorics-enlighten、discrete-geometry-enlighten、combinatorial-optimization-game-theory |
| AI | ai | hello-ai-zhishu、ai-enlighten、ai-ml-dl-rl-enlighten、ai-architecture-handbook、transformer、neural-net-zero、agentic-design-patterns-handbook、llm-model-catalog、alpoge-remark-book |
| 化学与食品 | chem | chem-zhishu、food-zhishu、shanghai-chem-lab |
| 计算机 | cs | algorithm-enlighten、cpu-enlighten、taocp-enlighten、C-true、C-、sudoku-zhishu、ACM-XCPC-Notes |
| 通识 | general | first-push-enlighten、economics-principles-handbook、AI-Study-Notes、AI-courses、bws-bilingual-reader、CourseVault-OfflineCourseMap、ai-history-site、meeting-129600years |
| 工具 | tools | mathmap、exam-solver、show、pages-index、MATLAB、SVM |

归属以 `data/manifest.json` 的 `discipline` 为准，上表是初始分配，抽取器可覆盖。

## 三、节点层级

三层，逐层展开：

1. **站点**（40 个）：房间里的展台牌匾
2. **章节**（约 650）：展台上的立柱，高度按章节序号递增
3. **概念**（约 415）：立柱上的发光点，前置关系拉成细线

概念数 415 是说明文件汇总值，未过抽取器校验；probe 里 sudoku 的 manifest **没有 `concepts` 数组**〔M〕，
这类站在房间内只有立柱没有光点，属真实形态，不做假点填充。`contentLevel: stats-only` 的站仍是节点，
只是点开后不渲染正文、只给原站入口。

题目、卡片、术语不独立成节点，收进章节详情里。否则 3800 个节点会涨到上万，3D 里全部糊成一团。

## 四、连接的语义

只有一种线：`prerequisites` 前置关系。

- 同房间内的连线：本学科颜色，半透明
- 跨房间的连线：只在中央大厅的全局星图上显示，房间内隐藏
- 无 `prerequisites` 的节点：孤立点，不画线，不做假线
- 但「旧版产物普遍没有前置链」这个前提要修正：probe 三站实测普遍有——章节 19/20、13/14、15/16，概念 49/50、58/61〔M〕。
  孤立点主要出现在未探到的其余站点与本地旧批次数据上，画图上不能按「整片都是孤立点」来设计

## 五、交互

| 操作 | 行为 |
|---|---|
| WASD / 方向键 | 平移 |
| 鼠标拖拽 | 转视角 |
| 滚轮 | 远近 |
| 点击站点牌匾 | 侧栏展开该站信息卡（章数、进度、`contentLevel` 标记、入口） |
| 点击章节立柱 | 弹详情层，渲染正文 |
| 点击概念光点 | 弹概念层，含前置链与深度推导（若有） |
| 右上小地图 | 2D 俯视，显示当前位置、视野扇形、已访问区域 |
| 顶部搜索框 | 转检索层，不离开 3D |

详情层是 2D 面板，占屏幕 70%，可关闭。渲染路径按数据的 `bodyType` 与 `contentLevel` 分流，不是一条通道走到底：

| 情况 | 渲染 | 必须显示的提示 |
|---|---|---|
| `bodyType: "md"`（`contentLevel: full`） | markdown-it + KaTeX + Mermaid，公式走 `$...$` / `$$...$$` | 无 |
| `bodyType: "html"`（`contentLevel: degraded`，如 sudoku） | 正文是成品 HTML 片段，直接注入，**不过 markdown-it**；站内公式已是烤好的 KaTeX 节点，原始定界符取不回来〔N〕 | 顶部降级条：「正文为成品 HTML，公式不可还原」 |
| `contentLevel: stats-only` | 不渲染正文 | 只显示原站 Pages 入口，不留空面板 |

- 详情层底部给回溯条：`origin.path`（仓库内路径，用于对账）与 `bookSource`（原书出处，`page` 可能是区间字符串、整数或缺失〔M〕），三者按有无显示。
- 概念详情的「深度推导」区块按 `depth` 有无显示：实测非空概念只有 10/50 与 5/61〔M〕，不能默认每页都有。
- 题目的 `answer` 是 int 索引〔M〕，前端按 `options` 原序渲染并现算字母，**不得重排选项**；`misconception` 实测三站皆空〔M〕，误解区块无数据时整块不出现。
- AI 现场生成的内容属另一条通道，标「AI 现场生成 · 未经校验」，不与库内正文混排。

## 六、性能

| 手段 | 做法 |
|---|---|
| 合批 | 节点用 `InstancedMesh`，一个材质一批 |
| LOD | 距离 > 30 单位时，概念点隐藏，只留章节立柱 |
| 分片 | 进房间才加载该学科分片，大厅只加载 manifest |
| 纹理 | 文字用 CanvasTexture 生成，缓存复用 |
| 帧控 | 静止 3 秒后停渲染循环，交互时恢复 |

目标：桌面端 60fps；40 站全节点在大厅不超过 15 万三角面。

## 七、移动端降级

触发条件：`matchMedia('(pointer: coarse)').matches` 或 `innerWidth < 768`。

降级形态：2D SVG 依赖图。

- 顶部学科页签，切换房间
- 下方力导向或分层布局的 SVG 图，节点可点
- 点节点同样弹详情层，全文可读
- 不加载 Three.js（用动态 `import()` 判断后才引入）

这一点是硬要求：评委会用手机点开链接，3D 白屏等于零分。

## 八、视觉

- 底色：深墨 `#12141a`，房间地面更暗一档
- 强调：数学靛蓝 `#4a6cf7`、AI 青 `#25c2a0`、化学朱砂 `#e05a47`、计算机琥珀 `#e0a83a`、通识灰蓝 `#8b95a8`
- 字体：正文思源宋体（vendor），界面思源黑体
- 光：单方向主光 + 环境光，不用实时阴影（性能）
- 深浅色：深色为默认，浅色主题保留但房间配色需重算对比度

## 九、不做的事

- 不做第一人称视角（晕动、操作成本高）
- 不做房间之间的自由飞行（只需走廊固定路径）
- 不做多人/联机
- 不在 3D 里渲染正文
- 不为旧数据的缺失字段造视觉填充
