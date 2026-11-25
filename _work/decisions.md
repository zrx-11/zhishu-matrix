# 决策日志

追加写。每做一场自主决定就记一行；命中铁律「必须停」的五类除外（那些是用户拍的板，也记下来，标「用户定」）。

| 日期 | 问题 | 选择 | 理由 | 可回退方式 |
|------|------|------|------|------------|
| 2026-11-24 | 探路阶段是否用 GitHub trees API | 探路用 trees（3 次请求），全量禁用 | 未授权限额 60 次/小时，47 站必爆 | 改 `extract.py::repo_tree` 的 method 分支 |
| 2026-11-24 | 内联容器取哪个 | 取窗口内「配平后最长」的容器，不取首个括号 | `ZS.x = (ZS.x\|\|[]).concat([...])` 首个 `[` 是空数组 | 还原 `best_container` → `first_container_after` |
| 2026-11-24 | sudoku 内联 JS 字面量怎么解 | Node 子进程 `new Function` 求值，抽取器依赖 Node 运行时 | 无引号键/模板串/尾逗号，`json.loads` 解不了；本机 Node v24.18.0 可用 | Node 缺失时该站降 stats-only，不改主流程 |
| 2026-11-25 | 50 仓装了 131 份 manifest，契约怎么改 | A 方案：一条 `sites` 记录 = 一本书 | 一 repo 一文件装不下多书合集（最多 39 本） | `git revert` schema 第二节 + 抽取器 books 循环 |
| 2026-11-25 | 单书仓库文件名 | 仍用 `data/sites/{repo}.json`，只有多书仓库用 `{repo}--{slug}.json` | 不做无谓的全量改名 | `site_filename()` 的 single 分支 |
| 2026-11-25 | `slug` 从哪来 | manifest 顶层 `slug` → manifest 所在目录名 → `b01` 序号；同仓冲突跳过后者并记 `slugCollisions` | 冲突继续写会静默丢一整本书 | `extract.py::extract_book` 的 slug 段 |
| 2026-11-25 | `quizzes[].answer` 形态 | 按 `type` 分流：single→int、blank→str、multi→list[int]；解析不出填 null 并记 `_report.json` | 131 份 manifest 全量实测三形态占比 3,298/157/86，「全是 int」是三站错觉 | 回滚 schema 第一节 quizzes 表 + `map_quiz` 分支 |
| 2026-11-25 | `chapters[].minutes` 遇到区间串 `"1–2"` | 填 `null` + 记 unmapped，绝不用 0 占位 | 0 是合法时长，占位等于谎报「这章 0 分钟」 | `to_minutes()` 返回 0 即可回退（不建议） |
| 2026-11-25 | `source` 字段被原书出处占用 | 抽取来源改 `origin`，出处保留 `bookSource`，`page` 不做类型归一 | 数据侧 `source` 语义固定，硬改会丢页码信息 | 三处文档 + `book_source()` |
| 2026-11-25 | 跨仓同书怎么去重 | signature = 章节 id 序列 + 五类计数 + 正文哈希，**不含 title** | 聚合仓会改名（hello-ai → 「AI 导论：Hello, AI」），含 title 时漏判 7 组：26 组/独书 103 → 33 组/独书 96 | `book["signature"]` 的入参改回含 title |
| 2026-11-25 | 归档副本 manifest 算不算一本书 | 排除 `_archive`/`_backup`/`archive`/`backup`/`旧版`/`deprecated`，记 `excludedManifests` | chem-zhishu 的 `_archive/04-…旧版40题` 会撞 slug 并造出假题库 | `EXCLUDED_MANIFEST_PARTS` 置空 |
| 2026-11-25 | 无 manifest 但有大量 .md/.json 的 25 站 | 记 `failures` + `pendingSources`，不硬套 manifest 解析器 | 结构不同构（exam-solver 350 md 无知枢字段、CourseVault 1,159 json 是课程目录） | `run_all` 的 no-manifest 分支 |
| 2026-11-25 | 正文主路径 | 本地 clone 读盘优先，raw 兜底（3 并发 + `_work/cache/` + `_work/state/` 断点） | 50 仓已在本地，零请求零限速；raw 只补未克隆/被稀疏挡掉的 | `attach_bodies` 的 fetcher 传 None |
| 2026-11-25 | 三档拉取的扩展名清单 | `*.md *.json *.csv *.txt`，**不含 `*.html`** | 成品 HTML 公式烤成 KaTeX 节点并绑死字号配色，反解析成本高；实测 `$...$` 149 / `\(...\)` 332 只在台账里完好 | `SPARSE_KEEP` 数组 |
| 2026-11-25 | 稀疏克隆要不要排除 vendor 目录 | 加 `!/**/static_shared/**`、`!/**/node_modules/**`、`!/**/vendor/**` | CourseVault 放宽后 126 个文件占 31.2MB/32.5MB（95.8%）是 MathJax i18n 重复包 | `SPARSE_DROP` 置空数组 |
| 2026-11-25 | kaoyan 的 contentLevel | 判 **stats-only**（原预判 degraded 被否） | csv 表头是 `q,page,verdict,note,time` 的校对台账，题面只在 201 个不拉的 html 里 | `pendingSources` + 适配器落地后改判 |
| 2026-11-25 | 铁律「零 CDN」表述 | 改为「渲染结果不得在运行时发起任何网络请求」+ 三类白名单（xmlns / 代码块内 URL / 保留域名），四处同步 | 28 处实测外链里 13 处是 `xmlns="…w3.org…"`、2 处是代码块内 `example.com`，原判会误伤内联 SVG | 两份 rules + pitfalls 已验证 3 + AGENTS 摘要 一起 revert |
| 2026-11-25 | 真外链怎么处理 | 默认 `--link-policy keep` 只记录；`strip` 才降级为纯文本加「原文链接，离线不可达」 | 先留证据链，批 3 再决定是否入库时就改写 | CLI 默认值 |
| 2026-11-25 | 产出文件换行符 | 全部写入显式 `newline="\n"`，UTF-8 无 BOM | Windows 默认 `\n`→`\r\n`，会让 git 在提交时静默改文件、diff 全是噪声 | 去掉 newline 参数（不建议） |
| 2026-11-25 | `.gitignore` 的 `dist/` 吃掉 `data/dist/` | 改成 `/dist/`（只忽略根目录构建产物）；`.qoderignore` 保留 `dist/` 让索引不吃分片 | 学科分片是产出物，必须能进版本库 | 改回 `dist/` |
| 2026-11-25 | `.gitattributes` 是否锁 data 换行 | 追加 `data/** text eol=lf` | 防别人在 Windows 重跑后 diff 漂回 CRLF | 删该行 |
| 2026-11-25 | `_work/` 被 gitignore，但回写协议文件要进库 | `git add -f _work/{last-result,status,decisions}.md` 强制纳入跟踪 | 协议文件是自动化接口的一部分，必须可见可追溯；入仓后 gitignore 不再影响其修改 | `git rm --cached` 三个文件 |
| 2026-11-25 | `data/` 15.3MB 是否走 LFS 或拆分 | 直接进版本库，不拆不用 LFS | 最大单文件 1.54MB，265 文件，仓库体量可接受；LFS 要远端配置，属越权动作 | 后续如需再迁 LFS |
| 2026-11-25 | 3D 技术栈取 npm 还是手填 vendor | `npm i three` 由 Vite 打进 bundle，运行期零远程请求 | 铁律判据是「运行时不发请求」，打包满足即可；npmmirror 可达 | 改回 `vendor/three.module.js` 手工引用 |
| 2026-11-25 | 390px 与「单指拖动」怎么共存 | 触屏/窄视口按铁律降级 2D SVG，单指拖动 = 平移 SVG 视图（不依赖双指） | 同时满足铁律 4 与批 2 判据第 6 条 | 改 `isMobile()` 分支 |
| 2026-11-25 | 批 2 视口判据怎么在不可 resize 的受控浏览器里实测 | 在同源页面注入 1440×900 与 390×844 两个 iframe，媒体查询按 iframe 自身视口生效，读其 `documentElement.scrollWidth` | 工具集无 setViewport；iframe 是真视口而不是伪造宽度，且 `?flat=0/1` 可强制模式 | 删掉 iframe，人工改窗口尺寸复测 |
| 2026-11-25 | 帧率测在哪一侧 | 采样应用自身渲染循环的 `fps()`（每 200ms 一次，10.4s），并用合成 pointermove 保持循环醒着 | 铁律的静止 3 秒停渲染会让裸 rAF 计数失真；用户在交互时才是真体验 | 改回裸 rAF 计数（会测到 0） |
| 2026-11-25 | 点书时保存哪台相机 | 存「当前视图」的相机：在房间存 roomCameras，在大厅才存 hallCamera | 早先无条件写 hallCamera，导致返回大厅位姿被房间位姿污染（表现为「相机没变」） | 还原 `pickBook` 一行 |
| 2026-11-25 | tools 分区无 `dist/tools.json` | 前端容错：`loadShard` 失败返回空分片，enterRoom 走「0 本」提示分支 | 6 个工具站全无 manifest，抽取器不产出该分片；重跑抽取会覆盖已跟踪的 `data/`，属必须停的五类，故只改前端 | 恢复 loadShard 抛错 |
| 2026-11-25 | 2D 视图 `setPointerCapture` 抛错 | try/catch 包住 capture/release | 合成事件 pointerId 无效会抛 NotFoundError，早先让 onUp 直接退出、点击不生效 | 去掉 try/catch（会退回点不动） |
| 2026-11-25 | `THREE.Clock` 弃用告警 | 换 `performance.now()` 手算 dt | 控制台要求零报错，警告也一并清掉；Timer 类在不同版本导出名不稳 | 换回 THREE.Clock |
| 2026-11-25 | 详情面板创建元素报 InvalidCharacterError | 修掉 `createElement(' span')` / `('span n')` 两处带空格类名 | 类名不能塞进 tag 参数，异常发生在 `panel.hidden=false` 之前，面板永远打不开 | 无（bug 修复） |
| 2026-11-25 | Three.js 取 npm 还是手填 vendor | npm 装 three 0.187.0，由 Vite 打进 bundle（构建产物 581KB） | 实测生产包资源请求 4 条、全部同源，foreign=0，满足铁律 2 的「运行时不发请求」 | 改回手工 `vendor/three.module.js` |
