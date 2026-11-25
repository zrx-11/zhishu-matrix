# 当前：批 6 打包收敛 + 发布文档完成，待进批 5 生成层（发布属人工步骤）

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| A1 · dist 体积基线 | done | `_work/measure-requests.json`：开工前 **22.83 MiB / 391 文件**；分族 `assets` 7.00 / `bodies` 7.42 / `sites` 3.72 / `dist` 4.61 / `manifest` 0.05 / `_report` 0.02 MiB，逐族字节进 `_work/last-result.md` 对比表 | 无 |
| A2 · 运行期请求实测 | done | 无头 Edge 走「大厅 → 六分区 → 开 7 本书 → 五类图型 → 六区搜索」双上下文（桌面 + 390）：`bodies` 10 次 / `sites` **55 次（去重 54 本）** / 结构分片 6 / 检索分片 7 / `manifest` 3；**只有 `_report.json` 与 `raw/` 是 0 请求（18 KB）** | 无 |
| A3 · 收敛候选判定 | done | 前置清单「16.7MB 数据是死重」**被实测推翻**：纯靠少拷最多省 0.02 MiB，60% 门槛数学上够不着；两根真杠杆 = 预压（−11.17 MiB）与 `assets` 裁剪（−1.80 MiB）。结论与字节表写进 `_work/decisions.md`「批 6 阶段 A 基线」节 | 无 |
| B1 · 数据落盘收敛 | done | `vite.config.ts` 去 `publicDir` 整拷 → `command==='serve'?'data':false` + 新插件 `zhishu:ship-data`（`closeBundle` 按族挑、`gzipSync(9)`、落 `.json.gz`）；实测「270 个文件 15.80MiB → 4.64MiB（跳过 `_report.json`/`raw/`）」；`data/` 源目录一字未动 | 无 |
| B2 · 读侧适配 | done | `src/data.ts`：`dataUrl()` 按 `import.meta.env.PROD` 加 `.gz`、`getJson()` 走 `DecompressionStream`、`manifest.json` 保持明文；`sites/` 取用收进新 `loadSiteRecord()`；边界两处——`gunzip` 验 gzip 魔数（托管层透明解压也能读）、`content-type: text/html` 判「产物缺文件」（SPA 回落把 404 伪装成 200） | 上线后 `curl -sI` 实测一次 `Content-Encoding`，结论回写 `docs/deploy.md` 4.2 |
| B3 · 门槛跟着改 | done | `check_offline.py` 透明解压 `.gz` 后扫（269 个，覆盖率不因压缩下降，报告加 `gzFiles`）；`bundle_evidence()` 分片两后缀都认 + 记 `shardSuffix`；探针路由 `**/dist/search-*.json` → `**/dist/search-*`（旧写法匹配不到 `.gz`，loading 态会静默失效） | 无 |
| C1 · mermaid 白名单 | done | 新插件 `zhishu:mermaid-whitelist`：读 `mermaid.core.mjs` 注册表，把 5 类之外图型的动态 `import()` 换成 `Promise.reject(new Error('zhishu: 图类型 … 未打包'))`，另剔 `swimlanes` 布局（全库 0 处使用）；分包闭包 **57 片 / 5.1 MiB → 14 片 / 3.19 MiB**，`assets` 少 43 片 | 无 |
| C2 · 回退支复核 | done | 未打包类型走既有 `diagram.ts::fail()`：`data-diagram="error"` + 源码 + 一行原因；探针**新增断言**实测原因 `zhishu: 图类型 "classDiagram" 未打包（…）`、`svg:false`、容器不空；坏语法回退与同章多围栏只载一次（chunk 10→10）照常绿 | 无 |
| C3 · 保留项的取证 | done | `elk`（1.45 MiB，flowchart 在 mermaid 12 的默认布局，实测被取）、`cose-bilkent`（mindmap）、`dagre`（兜底）全留；**没有**用「flowchart 改 dagre」这种改变出图形态的做法换体积 | 无 |
| D1 · 发布包 | done | `dist/` **9.85 MiB / 347 文件 / 43.1%**（门槛 ≤13.70 MiB），最大单文件 1.45 MiB、单目录最多 129 文件；对 Sites 配额逐条核对（50 MiB/文件、10,000/目录、450 MiB 总量、无 Worker）；不打包 zip，目录即发布物 | 无 |
| D2 · `docs/deploy.md` | done | 新增：目录形态与逐片体积、分族收敛对比表、配额核对、`prepare_site(webDirectory:"dist")→get_publish_status→publish_site` 命令序列（远端不跑构建，须先本地 `npm run build`）、五类排错（分片取不到 / `.gz` 透明解压 / 字体与 `--base` / mermaid 不出图 / 手机仍是 3D）、发布前门槛对照表 | 无 |
| D3 · 未上传 | done | 按要求**没有实际发布**（需账号、属远端写操作，第 3、4 类必须停），路径写进文档第三节 | 发布动作本身待人工 |
| 门槛新增（不删不放宽） | done | `selfcheck.py` 加 `dist_size_evidence()`（≤60% + 分族 JSON + 产物不得残留明文数据拷贝 / `_report.json` / `raw/`）与 `ship_integrity()`（**270 个 `.gz` 解压后与 `data/` 源逐字节等价** + 无孤儿文件）、`droppedLeftovers`（白名单外分包出现即不过）；断言 71 → **74 条** | 无 |
| 自检 | done | `python tools/selfcheck.py` **74 项全绿**（91.8s）；`verify_data.py` 五类 23 项全绿；`check_offline.py` 违规 0（xmlns 6 / 保留域名 2 / 字面量 47 / 数据 174，文件 288）；`tsc --noEmit` 零错；截图 `_work/shots-batch6/` | 无 |
| 文档 | done | `docs/deploy.md` 新；`docs/pitfalls.md` 已验证 33–38 + 排查顺序 23–27；`docs/schema.md` 第八节产物落盘形态（四条契约）；`README.md` 状态/体积/门槛项数/目录树；`agents.md` 批次表拆 6 与 6.1 + `deploy.md` 索引 | 无 |
| 前置 2 · 检索摘要空字段 | 不处理（如实记录） | `chapters[].core` 78/1,169、`concepts[].brief` 100/765 非空；补齐需重跑抽取器（第 1 类必须停），反推摘要违铁律 7 | 建议单排一次抽取增强轮 |
| 新发现 · KaTeX 两份 | 未动 | 本项目 `katex@0.16.47` 烤进 entry；`mermaid@12.3.0` 自带 `katex@0.18.11` 是 `assets/katex-*.js` 256 KiB，只在 mermaid 闭包里。统一版本属功能变更，不在打包收敛范围 | 保持两份 vs 加 overrides 后回归 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」，不进分片不进依赖图；入口位在检索 `none` 态与 `stats-only` 支 | 建议门槛加「生成内容不出现在检索结果与图示队列」 |
| 6.1 · Sites 发布 | blocked | 产物已就绪，命令与核对见 `docs/deploy.md` 第三节 | 需账号（第 3、4 类必须停），人工执行 |
| 远端 push | blocked | `git remote -v` 为空 | 无远端可推（第 3 类，不自行创建）；本批只 commit |
| 后台进程 | idle | 自检自带临时静态服务，跑完即关；dev/preview 无常驻 | 手测跑 `npm run dev`（明文）或 `npm run preview`（`.gz`），两种形态同一份调用点 |

## 下一步

进批 5 生成层（本批按任务书没有顺手实现）。发布（6.1）留给人工：`npm run build` 出**新鲜** `dist/` 再走
`prepare_site`——远端不跑构建，旧产物会原样上线。
门槛继续 `python tools/selfcheck.py`（现 74 项）；交付与收尾一律完整重跑，勿用 `--skip-build`
（复用旧 `dist/` 会把已修的改动验成失败，pitfalls 31）。
