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
| 2026-11-25 | 批 3 门槛脚本放哪 | 常驻 `tools/verify_data.py` + `tools/selfcheck.py`，不放 `_work/` 一次性探针 | 任务书要「可重跑」；`_work/` 被 gitignore，脚本进库才算交付 | 删两个文件即回退，不影响 `src/` |
| 2026-11-25 | verify_data 是否只读 | 只读 `data/`，另给 `--data-dir` 指变异副本 | 铁律 6 业务代码不写 data；没有 `--data-dir` 就无法反证「改坏必红」 | 去掉该参数 |
| 2026-11-25 | 校验脚本怎么证明自己在检查 | 造 6 个变异副本（改 totals、删 schemaVersion、抹 slug、截分片…）逐个跑，必红 | 全绿本身不等于有效，只有能测出坏数据才算门槛 | 删变异脚本，主脚本不受影响 |
| 2026-11-25 | 文档旧结论（三站口径 〔M〕）删还是留 | 保留原句并并列补全库实测〔X〕，不覆盖 | 〔M〕 是批 0 probe 的一手证据，删掉后文引用它的段落会断链 | 还原 design/pitfalls 被改的段落 |
| 2026-11-25 | 立柱光点的数据来源字段 | 弃 `chapters[].conceptIds`（15/1,169），改 `concepts[].chapterIds` 反绑（765/765） | 正查会让 98.7% 的立柱空着，视觉上等于功能没做 | `layout.ts::conceptsByChapter` 换回 conceptIds |
| 2026-11-25 | 正文请求时机 | `data.ts::loadBody` 单飞（inflight Map）+ 结果缓存，进入阅读页才 fetch | 129 个 bodies 共 7.4MB，预取违反 C1；并发重复点同一本会打两遍网络 | 去掉 inflight 只留缓存（会重复请求） |
| 2026-11-25 | KaTeX 报错时怎么处理 | `throwOnError:false` + `strict:false`，失败节点保留原始文本 | 判据明确「不吞内容」；默认抛错会让整段公式消失 | 改回 throwOnError:true |
| 2026-11-25 | Mermaid 批 3 渲不渲染 | 不渲染，显示围栏源码 + 标注「本地 vendor 渲染属批 6，不引 CDN」 | 855 章含 mermaid，接 CDN 违铁律；引 vendor 包体与批 6 打包冲突，本轮只做不骗人 | 批 6 换真渲染，判据同步改 |
| 2026-11-25 | 微信外链在库里 strip 还是渲染层 strip | 渲染层转纯文本 span + 「原文链接，已保留未加载」，`data/bodies/` 一字不动 | 用户已定决策 2：数据保真，只在展示层处理 | 改 `extract.py --link-policy strip` 重写正文（需重新入库） |
| 2026-11-25 | `stats-only` 库里 0 本，判据 C2 第三档怎么验 | 诊断接口 `openStatsOnlySample()` 在内存里覆写 `contentLevel` 走同一条 `openBook()` | 删分支等于承认档位不存在；改 `data/` 凑样本违反铁律「不为演示改数据」 | 删该方法（判据即失证） |
| 2026-11-25 | 阅读层用侧栏还是全屏 | 两者都做：侧栏 `panel` 常驻 + `viewMode='reader'` 全屏页，章节列表/正文/返回 | 桌面侧栏不遮空间视图，手机 390px 侧栏不可用，判据要求两侧都不溢出 | 只留侧栏（390 项会挂） |
| 2026-11-25 | InstancedMesh 怎么知道点的是哪根立柱 | 每类实例建 `instanceId → ref` 映射，`uv` 不用；点选阈值按屏幕距离 | InstancedMesh 只有一个 mesh，靠 `intersect.instanceId` 反查是唯一稳定路径 | 改回逐 mesh（1,169 个 draw call，帧率崩） |
| 2026-11-25 | WASD 与面板/输入框抢键 | `inputBusy = panelOpen() \|\| isTyping() \|\| miniBusy()` 时键盘直接返回 | 阅读层里有搜索/文本框，WASD 不判 busy 会打字打不进字 | 去掉守卫 |
| 2026-11-25 | 小地图循环与帧率采样打架 | `holdMinimap(true)` 在采样窗口挂起小地图 rAF，探针测完释放 | 两个 rAF 并行会把 `fps()` 采样算脏；小地图本身不需要在 10 秒窗口里跑 | 删 hold，帧率数字仍达标但不可信 |
| 2026-11-25 | 走廊地面名的可读性判据怎么定 | 六条逐一走到正对视角（`viewCorridor`）截一张，按投影包围盒宽高比 ≥3、宽 ≥120px 判可读 | 大厅视角 4/6 可辨，剩下的差异来自斜视角压缩，不是没渲染；要区分「没画」和「看不清」 | 改判据为只查 mesh 存在（会漏掉真不可读） |
| 2026-11-25 | 浏览器自检用什么驱动 | `playwright-core` + 本机 Edge 可执行路径，不下载 chromium | 不装浏览器省数百 MB 与网络；core 包只 10MB，`executablePath` 指到 msedge.exe 即可 | 换成 puppeteer / 内置 chromium |
| 2026-11-25 | 自检样本怎么给 | `pick_samples()` 每次全库扫一遍现选，报告里落 slug 与章节 id | 写死书名会在数据重跑后指向不存在的章节，误报成前端 bug | 换成写死常量 |
| 2026-11-25 | Windows 下 Python 调 npx | `shutil.which(cmd[0]) or cmd[0]`，env 注 `PYTHONIOENCODING=utf-8` | `npx` 实为 `npx.cmd`，CreateProcess 不认；不注 encoding 时子进程打中文直接 UnicodeEncodeError | 去掉 which 兜底（本机跑得起来，CI 起不来） |
| 2026-11-25 | 帧率判据在 headless 测到 165 说明什么 | 阈值保留 ≥45 的下限语义，另记 `triangles()` 负载（大厅 1,398 / 数学房 3,874）入报告 | 无头模式 rAF 不等合成器，数字不等于观感；真实证据是三角面远低于 15 万预算 | 把判据改成「≥60」会测出假失败 |
| 2026-11-25 | 待决策 1「Mermaid 何时真渲染」（用户定） | 提前到批 3.5 本批做真渲染，不等批 6 | 855 章含围栏、占 73%，是内容形态问题不是打磨问题 | 回退即把 `src/diagram.ts` 的渲染支换回 `render.ts` 的源码吐字支 |
| 2026-11-25 | 待决策 2「阅读层侧栏 vs 全屏」（用户定） | 双模式并存，不减状态机 | 桌面侧栏不遮空间视图、手机 390 侧栏不可用，两条都要 | 删 `viewMode='reader'` 分支（390 判据即失证） |
| 2026-11-25 | 待决策 3「check_offline 是否单列」（用户定） | 收进统一脚本：`tools/check_offline.py` 独立可跑，`selfcheck.py` 调用并入报告 | 静态扫描与运行期监听是同一铁律的两半，分列必然漏一头 | 从 `selfcheck.py` 摘掉 `offline_evidence()` 调用即回单列 |
| 2026-11-25 | mermaid 怎么「不进首屏」 | `import('mermaid')` 动态分包，不手放 `vendor/mermaid.min.js` | 铁律判据是运行时不发请求，打包成本地同源即满足；Vite 自动切出 core 671KB + 57 子包，首屏只多一次动态 import | 改回静态 `import mermaid` 并手工 vendor（entry 立刻涨 3MB+） |
| 2026-11-25 | 围栏什么时候渲染 | `IntersectionObserver` 可见才渲染（`rootMargin 160px`），未可见先出占位容器并保留源码 `<details>` | 882 个围栏一次性全渲会卡死主线程；源码留在容器里，失败与关图都不丢内容 | 改回 `hydrateDiagrams` 里直接 `renderInto()`（首屏长章必抖） |
| 2026-11-25 | 渲染失败怎么表现 | `data-diagram="error"` + 源码 `<pre>` + 一行原因 + 标题条改「已回退源码」，绝不空容器 | 判据要求「不空不白屏」；`renderDiagram()` 返回 `{svg,error,kind}` 不抛错，坏源码也能被探针喂 | 只标错不给源码（内容即丢失） |
| 2026-11-25 | 同章多围栏怎么避免重复加载 | 模块级 promise 缓存 + 串行渲染队列，失败时把缓存置空允许重试 | mermaid 复用同一批临时 DOM，并发 `render()` 会互相踩；缓存不重试会让一次网络抖动永久失败 | 改成每围栏各自 import（chunk 请求翻倍且渲染互踩） |
| 2026-11-25 | 图型样本抽哪些 | 按库里**实际出现**的 5 类各取一章（flowchart/graph/sequenceDiagram/mindmap/xychart-beta），不造 classDiagram、stateDiagram | 判据原写「classDiagram/stateDiagram」但库里 0 个，硬造等于自证假数据 | 手工塞一个 classDiagram 合成样本（违「不硬造」且不代表库里） |
| 2026-11-25 | SVG 安全消毒范围 | `sanitizeSvg` 保留 `<style>`（mermaid 靠它上色），剔 `script` / `on*` / 远程 URL 属性 | 剔掉 style 图会全白；mermaid `securityLevel:'strict'` 本就不注入脚本 | 连 style 一起剔（图不可看） |
| 2026-11-25 | 离线扫描判据口径 | 只有「资源加载位点上的远程 URL」判违规；xmlns 声明 / 代码块与 JSON 字面量内 / 保留域名进白名单计数 | 产物里 106 处字面量与 200 处数据 URL 都是被展示内容，按出现次数判会把 332 文件全判红 | 退回「grep 计数即红」（等于放弃这条门槛） |
| 2026-11-25 | 检索分片放哪 | `data/dist/search-<area>.json` 六片，复用已有 `dist/` 子目录 | 硬约束「不新增 `data/` 一级子目录」；与结构分片同目录不同前缀，`publicDir` 已把这条路径带进产物 | 新建 `data/search/`（属必须停的第 5 类） |
| 2026-11-25 | tools 区库里 0 本，出片还是不出 | 照样生成 0.3KB 空片（`counts` 全 0） | 任务书原话「tools 缺片沿用容错」，但空片让「分片取到 / 库里 0 本」这条路径可验，比缺片容错更接近真实故障面 | 改成缺片走 `generator:'missing'`（前端仍是两条支，只是少一条可验） |
| 2026-11-25 | 判据「六学科各命中一条」在库里不可满足 | 5 区命中 + tools 单独走「空片容错」断言，报告里写明原因，不改 `data/` 凑数 | tools 六个仓全无 manifest〔X〕；为过判据改数据直接违铁律 | 给 tools 编一本书（违铁律 6） |
| 2026-11-25 | 检索落点用什么键 | 一律带 `file`，`manifest.sites.find(s => s.file === hit.file)` | `bookSlug` 跨仓重名 31 个，按 slug 取会开错书；`file` 是抽取器给的唯一路径键 | 退回 slug 查表（重名书目必错） |
| 2026-11-25 | 中文怎么切词 | MiniSearch 自定义 `tokenize`：拉丁整词 + 中文单字与二字组合 | 默认按空白切，「自然数与数学归纳法」这种标题不加空格永远匹配不上 | 换 lunr/ES 等分词器（多引一个包，收益不省） |
| 2026-11-25 | 无结果态怎么验 | 探针用拉丁乱码 `zxqvkjz`，不用中文乱码 | 单字 + 二字 + `prefix` + `fuzzy 0.12` + `OR` 天然高召回，随手敲中文必命中，验不出 `none` | 调低 `searchOptions` 收窄召回（改产品行为迁就测试） |
| 2026-11-25 | 术语命中归到哪一组 | 有落点章归「章节」，无落点归「书」总览，不猜目标 | `terms[].c` 抽不到就是抽不到，铁律 7 禁止推测填充 | 猜最近章（会跳错内容） |
| 2026-11-25 | MiniSearch 打进哪个 chunk | 不加分包规则，让它自然进 entry，用 `autoVacuum` 串作指纹取证 | 检索层是首屏就要可用的能力，分包只多一次往返；指纹稳定不受压缩改名影响 | 加 `manualChunks` 把它拆出去（判据要跟着改） |
| 2026-11-25 | 判「首屏含 mermaid」的标记 | 用实现体函数名（`detectType` 等 5 个），core 至少命中 3、entry 必须 0 | `startOnLoad`/`securityLevel` 是我自己 CONFIG 的字面量，会被误判成 mermaid 进了首屏 | 用配置键判（首验即假红） |
| 2026-11-25 | 「mermaid 分包有没有被加载」怎么在浏览器里取证 | 由 `bundle_evidence()` 从构建产物算出 57 片名单，注入探针做集合判定 | chunk 名正则不成立：`scene3d-C4wo3fve.js` 的哈希里撞出 `c4` 被误判；名单还要在 entry 静态闭包处截断，否则 mermaid 子包反向 import entry 会把 scene3d 也卷进来 | 改回名字正则（哈希一漂就假阳/假阴） |
| 2026-11-25 | 检索返程落点何时记录 | 每次 `openFromSearch()` 都无条件重记；`enterRoom()` / `showHall()` 立即作废 | 「面板已开就不记」会让上一次的陈旧快照串进本次返回（实测返回落到 ai 区）；用户自己走位后落点本就该失效 | 恢复「只在面板关着时记」（返程位姿错） |
| 2026-11-25 | 390 搜索弹层溢出怎么修 | `#search-box` 及每条子项显式 `min-width:0`，长文本配 `overflow-wrap:anywhere` | grid/flex 项自动最小尺寸取 min-content，一条 40 字中文标题把盒子撑到 551px 而 `document.scrollWidth` 仍报 390 | 给盒子写死 `width:390px`（大屏就废了） |
| 2026-11-25 | 自检截图目录 | 本批落 `_work/shots-batch35/`（25 张），不覆盖批 3 的 `_work/shots-batch3/` | 两批证据要能各自回看对比；目录属 `_work/`（gitignore），不影响版本库 | 改回 `PROBE_SHOTS` 常量即切目录 |
| 2026-11-25 | 门槛怎么跑才算数 | 收尾一律完整 `python tools/selfcheck.py`，不带 `--skip-build` | 本批三处改动（空片文案、返程落点、390 CSS）都要重建才生效，`--skip-build` 复用旧 dist 直接验成 3 项失败 | 只在改探针本身时用 `--skip-build` 快速回环 |
| 2026-11-25 | 收敛前先量什么（批 6 阶段 A） | 用无头 Edge 跑「大厅 → 六分区 → 开 7 本书 → 五类图型 → 六区搜索」全路径，逐条记 data 族的请求数，结论落 `_work/measure-requests.json` | 前置清单说「16.7MB 数据拷贝是死重」是估计值；不测就删会先删出 bug 再发现删错（详见 pitfalls 34） | 重跑 `node _work/measure_data_requests.mjs`，脚本只读不改产物 |
| 2026-11-25 | 「拷贝收敛」够不着 60% 门槛怎么办 | 功能全留，改**传输形态**：构建期 gzip 预压 + 客户端 `DecompressionStream` 还原 | 实测四族全被运行期取到，纯删最多省 0.02 MiB；预压把 15.75 MiB 数据族压到 4.58 MiB，配合 mermaid 裁剪到 9.85 MiB（43.1%） | 关掉 `shipData` 的 `compress: true` 即回明文整拷（+11.17 MiB） |
| 2026-11-25 | `sites/` 3.72 MiB 删不删 | **留**（并预压到 0.86 MiB） | 实测运行期 55 次 / 去重 54 本请求，任务书给的条件是「若运行期零请求才可删」，前提不成立；把它并进学科分片会把 30KB 的单本取用变成整区 1MB 级取用 | 删 `SHIP` 里 `sites` 那行 + `bookRecord()` 回落到分片内取结构（阅读层会断，需同步改判据） |
| 2026-11-25 | `_report.json` / `raw/` 进不进产物 | 不进 | 实测运行期 0 次请求；它是抽取器的诊断件，前端不读 | `SHIP` 加一行即可恢复整拷 |
| 2026-11-25 | `manifest.json` 要不要也预压 | 不压，保持明文 | 它在首屏引导链上，压了就等于把「浏览器有没有解压能力」变成页面起不起得来的前置条件 | 改 `SHIP` 首行 `compress: true` + 文件名带 `.gz` |
| 2026-11-25 | dev 与 build 两套数据形态怎么对齐 | `publicDir: command === 'serve' ? 'data' : false` + `src/data.ts` 按 `import.meta.env.PROD` 决定 `.gz` 后缀 | 一刀切 `false` 会让 dev 每改一处正文都要重新构建；两处各一行分支，调用点不动 | 改回 `publicDir: 'data'` 即整拷（体积门槛随之失证） |
| 2026-11-25 | `.gz` 会不会被托管层透明解压 | 读侧两种都吃：`gunzip` 先验魔数 `1f 8b`，非魔数按明文走 | 托管层加 `Content-Encoding: gzip` 时浏览器已解压，再喂 `DecompressionStream` 必炸；只在系统边界做判定，内部数据不加防御性校验 | 删该分支即回到「只认预压」形态 |
| 2026-11-25 | 分片取不到时为何不报 404 | `getJson` 见 `content-type: text/html` 直接抛「拿到的是 HTML（产物缺这个文件）」 | SPA 回落把缺失文件伪装成 200 + HTML，`res.ok` 判不出来，`JSON.parse` 只给一句 `Unexpected token '<'`，把「缺文件」和「解压失败」混成同一种病 | 删该判定即回到 parse error 难排（deploy.md 4.1 随之失效） |
| 2026-11-25 | mermaid 白名单剔哪些 | 只留库里实际出现的 5 类（flowchart / graph / sequenceDiagram / mindmap / xychart-beta）及其布局依赖；`classDiagram`/`stateDiagram`/`er`/`gantt`/`pie`/`cynefin`/`usecase`/`architecture`/`gitGraph`/… 的 `import()` 换成必定失败的 `Promise.reject` | 57 片 5.1MB 里绝大部分库里 0 处使用；替换点是注册表里的动态 import，类型侦测仍在，未打包类型自然落进既有 `fail()` 回退支（源码 + 一行原因） | 删 `plugins` 里的 `mermaidWhitelist()` 即回全量分包（+1.8 MiB） |
| 2026-11-25 | `elk` 1.45 MiB 留不留 | **留** | mermaid 12 里 flowchart 默认布局就是 elk，实测围栏确实取它；把 flowchart 改成 dagre 是**视觉行为变更**，不属于打包收敛 | 改 `KEEP` 前需先在 `src/diagram.ts` 固定 dagre 布局并逐类复核出图形态 |
| 2026-11-25 | `swimlane` 布局包剔不剔 | 剔（120 KB） | 全库 882 个围栏无一处用 swimlane 图型，也没有 frontmatter 覆写布局；`getRegisteredLayoutAlgorithm` 会自行回落 dagre | 从 `drop.set('swimlanes', …)` 删该行 |
| 2026-11-25 | 白名单外图型怎么验（库里 0 个样本） | 探针注入一条 `classDiagram` 围栏，验「不出 SVG + 容器给源码 + 原因文本含 `未打包`」，不改 `data/` 也不新增图型样本 | 判据要的是回退行为成立；库里没有该类型就不能当内容样本混进 `图型样本 ≥5 类` 那条（铁律：不硬造） | 删 `selfcheck_probe.mjs` 里 `unbundled` 那一段（判据即失证） |
| 2026-11-25 | KaTeX 在产物里出现两份 | 记下不动：entry 里是本项目 `katex@0.16.47`，`assets/katex-*.js` 256 KiB 是 `mermaid@12.3.0` 自带的 `katex@0.18.11` | 两份版本不同、职责不同（前者渲染正文公式，后者供 mermaid 公式标签），合并要改依赖版本，属功能变更不属打包收敛 | 需要时在 `package.json` 加 overrides 统一版本，代价是 mermaid 公式标签需重测 |
| 2026-11-25 | 门槛脚本会不会被 `.gz` 瞎掉 | 三处跟着改：`check_offline.py` 解压后扫（并打印「透明解压 269 个」）、`bundle_evidence()` 两种后缀都认、探针路由 glob 从 `search-*.json` 改 `search-*` | 三处原本按明文 `.json` 认数据，不改就是静默降覆盖率 / 判据假红 / 验不到 loading 态（详见 pitfalls 35） | 逐处回退即回到只认明文 |
| 2026-11-25 | 预压后怎么保证「只是换了形态」 | 新增门槛项：产物 `.json.gz` 解压后与 `data/` 同名文件逐字节比对，另加 `manifest.json` 明文比对与「产物凭空多文件」检查 | 270 个文件实测全等；不比对就只能靠肉眼信 gzip 往返无损 | 删 `ship_integrity()` 调用即回退到不校验（会把契约写坏而无人知） |
| 2026-11-25 | 体积门槛落成什么形式 | `selfcheck.py` 新增 `dist_size_evidence()`：总量 ≤ 22.83 MiB × 60%，且产物内不得残留明文数据拷贝与 `_report.json` / `raw/` | 判据要求「≤60% 且给分族表」，写成断言 + 分族打印，数字从报告来不靠手写 | 改 `DIST_MAX_MIB` 常量即放宽（放宽即失证） |
| 2026-11-25 | 发布动作本批做不做 | **不做**：只出 `docs/deploy.md`，命令与配额核对写清楚 | 发布要账号、属远端写操作（必须停的第 3、4 类）；任务书也只要求「不实际上传」 | 按 deploy.md 第三节跑 `prepare_site` → `publish_site` |
| 2026-11-25 | 站点清单字段空摘要（前置 2）本批补不补 | **不补**，按原样如实记录：`chapters[].core` 78/1,169、`concepts[].brief` 100/765 非空 | 补齐要重跑抽取器，命中必须停的第 1 类；且禁止用正文反向编造摘要（铁律 7） | 后续单开一轮抽取增强：`extract.py` 抽 `core`/`brief` → 重跑 `build_search_index.py` |
| 2026-11-25 | 自检截图目录（批 6） | 改落 `_work/shots-batch6/`，不覆盖批 3.5 的 25 张 | 两批证据各自可回看对比；目录在 gitignore 内 | 改回 `PROBE_SHOTS` 常量即切目录 |

---

## 批 6 阶段 A 基线（实测，非估算）

采集：`node _work/measure_data_requests.mjs` → `_work/measure-requests.json`（无头 Edge，走「大厅 → 六分区 → 开 7 本书 → 五类图型各一章 → 六区各搜一次」，桌面 + 390 触屏双上下文）。时间戳 2026-11-25T07:28Z。

`dist/` 本轮开始前：**22.83 MiB / 391 文件**。分族与运行期请求：

| 族 | 源体积 | 文件数 | 运行期请求（distinct / 次数） | 判定 |
|---|---|---|---|---|
| `bodies/` | 7.42 MiB | 129 | 7 / 10（本轮样本） | 留，判据 C1 按需取 |
| `sites/` | 3.72 MiB | 129 | **54 / 55** | 留（「若零请求才可删」前提不成立） |
| `dist/` 结构分片 | 4.06 MiB | 5 | 5 / 6 | 留，进分区取 |
| `dist/` 检索分片 | 0.55 MiB | 6 | 6 / 7 | 留，发起搜索才取 |
| `manifest.json` | 0.05 MiB | 1 | 1 / 3 | 留，首屏引导 |
| `_report.json` | 0.017 MiB | 1 | **0 / 0** | 剔出产物 |
| `raw/` | 0 | 0 | 0 / 0 | 剔出产物 |
| `assets/` | 7.01 MiB | 119 | 16 / 18（首屏仅 entry + css） | 留，其中 mermaid 子树 5.1 MiB 可裁 |

零请求族合计 **0.02 MiB**——即：靠「少拷」最多到 22.81 MiB（100.08% → 99.9%），60% 门槛在只删不压的路线上不可达。
可选路线只有三条：删功能（判据必红，排除）、裁 `assets/`（1.8 MiB 上限，不够）、**压数据**（唯一够得着的杠杆）。
故本批按「功能全留 + 预压 + mermaid 白名单」走，落点 9.85 MiB / 43.1%。

`neverRequested` 合计 12.76 MiB / 302 文件（按本轮样本路径），其中 122 本 bodies、75 份 sites 属「样本没点到但运行期会点到」，
不是死重——这条是判据 B1「不能误删按需正文」的直接依据，别按样本命中率删文件。

---

## 批 7 阶段 A · 改前基线（实测，HEAD `096d428`，非估算）

产物：`dist/` **9.846 MiB / 347 文件**，其中 `assets/` 5,458,913 B / 76 文件；门槛 **74 项全绿**（`_work/b7-baseline-selfcheck.txt`）。
截图与逐项指标：`_work/shots-batch7/before-metrics.json` + `before-*.png` 9 张（hall / 六区 / reader / mobile390）。

亮度三带取自同一机位：整屏 full、地面横带 ground（y 0.18–0.52）、上半天空带 sky（y 0.66–0.96）。

| 视图 | 三角面 | draw call | 立柱 | 光点 | 运行时材质 | full | ground | sky |
|---|---|---|---|---|---|---|---|---|
| 大厅 | 1,398 | 40 | — | — | Basic 14 / Sprite 7 | 0.08656 | 0.11060 | 0.08034 |
| 数学 | 3,874 | 48 | 265 | 398 | Basic 3 / Sprite 45 | 0.13117 | 0.19120 | 0.08243 |
| AI | 6,150 | 52 | 450 | 462 | Basic 3 / Sprite 49 | 0.16865 | 0.28055 | 0.08494 |
| 化学 | 1,648 | 15 | 103 | 26 | Basic 4 / Sprite 10 | 0.12728 | 0.17326 | 0.08332 |
| 计算机 | 3,096 | 17 | 170 | 103 | Basic 4 / Sprite 12 | 0.16565 | 0.25094 | 0.08611 |
| 通识 | 3,450 | 18 | 181 | 129 | Basic 4 / Sprite 13 | 0.15191 | 0.21468 | 0.08928 |
| 工具 | 162 | 3 | 0 | 0 | Basic 2 / Sprite 1 | 0.09968 | 0.11459 | 0.08027 |

改前几何全是源码里的 `BoxGeometry(1.6,1,1.6)` 立柱 + `OctahedronGeometry(0.9)` 光点（`census.builtColumnGeometry` 这条字段本批才加，
所以改前 JSON 里是空数组，不是「没有几何」）。

帧率：headless 无 vsync 上限，数学区 5s 采样 **165 fps**（不是真机 60，只能用作相对比较）。
灯光：**零光源**——`census.lights` 为空对象、`env` 无字段、`post.present=false`、`shadowPass=0`。全部亮度都来自自发光色填充。

## 批 7 材质处置表（判据 1，逐条）

改前 11 个 `MeshBasicMaterial` 站点，全部来自 `git show HEAD:src/scene3d.ts`：

| # | 改前站点 | 原材质 | 处置 | 理由 |
|---|---|---|---|---|
| 1 | L132 大厅地面圆盘 | Basic(FLOOR) | **→ Standard** + canvas 地面贴图，`receiveShadow` | 地面是阴影唯一落点，不受光就没有「空间」 |
| 2 | L138 `GridHelper` 网格线 | LineBasic | **删除**，网格画进地面贴图 | 线框叠在 PBR 地面上会浮空；程序化贴图自带细/粗两档格线与暗角 |
| 3 | L144 六区信标 | Basic(white)+instanceColor | **→ Standard**，`castShadow`+`receiveShadow` | 大厅主视觉件，需要明暗与投影 |
| 4 | L155 区环（入口标记） | Basic(color,0.4) | **保留 Basic** | 它是「入口标记」，亮度必须与相机朝向、阴影无关；受光后转到背阴面就消失 |
| 5 | L251 走廊名地面带 | Basic(map) | **保留 Basic** | CanvasTexture 文字标签，加法混合会糊掉笔画；受光会让字随视角忽明忽暗 |
| 6 | L348 房间展台方板 | Basic(white) | **→ Standard** | 承光面，立柱阴影落在这里 |
| 7 | L366 章节立柱 | Basic(white) | **→ Standard** | 本批主角 |
| 8 | L394 概念光点（八面体） | Basic(white) | **→ 面片实例 + canvas 渐变 + Additive**，材质仍是 Basic | 发光件本就不该受光；几何从实体八面体换成 billboard 面片 |
| 9 | L458 房间地面薄盘 | Basic(color,0.09) | **→ Standard** + canvas 学科色盘贴图，`receiveShadow` | 同上，房间地面要接住影子 |
| 10 | L475 空房间环（工具区） | Basic(color,0.32) | **保留 Basic** | 与 #4 同族，是标记不是实体 |
| 11 | L926 dispose 里的类型断言 | — | 随之改（走廊带仍是 Basic，断言成立） | 不是渲染站点 |

净结果：大厅 `Standard 2 / Basic 12 / Sprite 7`（12 个 Basic 全是标签与标记件），
房间受光材质 **4**（地面、展台、底座、立柱，`MeshStandardMaterial: 4`）。断言「受光材质 ≥4」即此。

改后的亮度不是「整体变亮」这么粗：大厅 ground 0.1106 → **0.2338**（受光面抬起来），
但天空带 0.0803 → **0.0661**；房间 full 反而从 0.1312 降到 0.1097，因为 ACES 把天空带从 0.0824 压到 0.0333——
背景与地面被分别处理，这是 tone mapping 的必然结果，不是漏光。

## 批 7 灯光标定（阶段 B）

标定网格（`tools/tune_batch7.mjs`，主光 × 半球光 × 地面 albedo 倍率），大厅整屏 mean：

| key | hemi | groundAlbedo | 大厅 mean | 判定 |
|---|---|---|---|---|
| 1.05 | 0.42 | 26 | 0.42 | 洗白，比改前亮 4 倍，弃 |
| 1.05 | 0.42 | 15 | 0.155 | 可 |
| 1.5 | 0.42 | 15 | 0.150 | 阴影更硬，取 |

最终值：Hemisphere `0x9fb4de/0x141a24` **0.42**；Directional `0xfff1dc` **1.5**，`castShadow`，mapSize **2048**，
bias −0.0009、normalBias 0.35；六区 PointLight `900 / distance 240 / decay 2` 挂在 y=46；
房间内 top **700**（学科色，distance = span×2.4）+ rim **392**（冷白，y=18）。
ACESFilmic，exposure 1.0，雾 `520–1250`（改前 480–1180，只微调一档）。

**主光俯角是这节的关键**：初版把主光架到 `half*1.5` 高（约 60° 俯角），影子全压在柱子自己背后——
实测关阴影与开阴影的大厅地面带亮度差只有 **1.6e-4**，等于没投影。降到 `half*0.8`（约 38°）后
房间中段 Δmean **0.0072**、整屏 Δp95 **0.055**，截图里影子拖到展台上（`dbg-hall-key150.png`）。

## 批 7 几何与光点（阶段 C）

| 区 | 立柱形态 | 底座形态 | 顶点签名（`geometry.type:shape:vertexCount`） |
|---|---|---|---|
| 数学 | `cylinder`（12 段带盖圆柱） | `disc` | `CylinderGeometry:cylinder:76` |
| AI | `hexPrism`（六棱柱带盖） | `step` | `CylinderGeometry:hexPrism:40` |
| 化学 | `coneTower`（Lathe 车削锥塔） | `ring` | `LatheGeometry:coneTower:88` |
| 计算机 | `boxPillar`（方柱） | `disc` | `BoxGeometry:boxPillar:24` |
| 通识 | `stackedDrum`（叠鼓 Lathe） | `step` | `LatheGeometry:stackedDrum:108` |
| 工具 | `ringColumn`（空房间，未建） | `ring` | — |

- 单靠 `geometry.type` 分不开数学与 AI（都是 CylinderGeometry），所以签名带形态名与顶点数（76 vs 40）。
- **高度映射**：`base = 3.4 + (11.2−3.4)·√min(1, 章数/24)`，再乘同书内的错落系数 `0.86–1.0`，
  夹在 `[COLUMN_H_MIN 3.4, COLUMN_H_MAX 11.2]`。取 √ 是让 8 章的书也有可读高度，线性会把小书压成平地。
- **立柱粗细**：几何单位半径 0.6–1.0，展台半径 ~10，实例缩放 `x/z = COLUMN_GIRTH = 2.2`。
  1.0 时截图上是一根针（`dbg-math-key105.png`），2.2 才读得出「柱子」（`dbg-math-close.png`）。
- **概念光点**：一张 64² canvas 径向渐变（alpha 台阶 0.92/0.5/0.14/0.03/0）共用贴图 + `PlaneGeometry(1,1)` 实例，
  Additive、`depthWrite:false`；半径 4.3 环 + 三层错落；尺寸 `1.5 + 1.15·√min(1, 题量/100)`；
  颜色 = 学科色向 `#f4f7ff` 插值 0.3。总量 math 398 / ai 462 / 全区 ≤600，不做粒子海。
- **朝向在 CPU 侧**：每帧用相机四元数重写实例矩阵。不走顶点着色器 billboard，
  因为 `InstancedMesh.raycast` 读的是实例矩阵——着色器里转了，点就拾取不到了（正文打不开）。

## 批 7 后期与口径（阶段 D）

- EffectComposer：`RenderPass → UnrealBloomPass → OutputPass`，延迟到真正进 3D 才建（2D 降级不碰 three）。
- **Bloom 首值 → 终值**：`(strength 0.9, radius 0.4, threshold 0.5)` → **`(0.55, 0.55, 0.55)`**。
  中间扫过 `(0.62,0.45,0.5)` / `(0.7,0.35,0.45)` / `(0.55,0.6,0.6)`；0.9 强度时地面暗角被辉光糊平、区名重新发白，
  0.35 档又几乎看不出光晕，取中档。
- **bloom 内部分辨率 = 0.65×**（`setSize(w·pr·0.65, h·pr·0.65)`，且在 `composer.setSize` 之后调用，composer 不会再改它）：
  帧率代价从 ~11% 降下来，肉眼级差异只在高光边缘。
- **阴影只烘一次**：`shadowMap.autoUpdate=false`，视图/位姿变化时置 `needsUpdate=true`（场景静态，只有相机在动），
  省 ~11% 帧时。代价是 `renderer.info` 每帧不再含阴影 pass，所以三角面必须**分两口径报**：
  `mainPass`（主渲染）/ `shadowPass`（投影体提交）/ `perFrame`（实际整帧）。
  大厅 1,398 + 144 → 1,412；数学 18,454 + 18,300 → 18,468；最大的是通识 33,830，预算 150,000 的 22.6%。
  `shadowPass` 与 `mainPass` 数量级相同是因为立柱既进主渲染也进阴影图，不是画了两遍主画面。
  draw call 的涨幅实测归因：`setPassEnabled('Bloom', false)` 一关，大厅 53 → 40、数学 63 → 50——**+13 全是 bloom 的
  mip 下/上采样与合成**，场景自身只 +2（新增底座实例件 + 房间地面薄盘换成受光 Standard），大厅场景件数 0 增。
- DPR 上限 2（实测 headless 为 1），resize 时 composer + bloom 一起改尺寸。
- 地面网格程序化：1024² canvas，40 格细线 + 每 4 格粗线 + 径向暗角（0.21 → 0.06 → 0.78 黑）。

## 批 7 体积增量（判据 8）

| 族 | 改前 | 改后 | 增量 |
|---|---|---|---|
| `assets/` | 5,458,913 B / 76 | 5,497,444 B / 76 | **+38,531 B**（scene3d 分包 579.63 → 599.7 kB，新增 spacekit 与灯光/几何/后期代码） |
| `bodies/` `sites/` `dist/` `manifest.json` `index.html` | 不变 | 不变 | 0 |
| **合计** | **9.846 MiB / 347** | **9.883 MiB / 347** | **+0.037 MiB（+0.4%）** |

上限 12 MiB，落点 9.883 MiB（82.4%）。新增外部二进制资产 **0 个**（`dist/assets` 里 `.hdr/.glb/.gltf/.ktx2/.png/.jpg` 计数为 0），
env 光照来自 `PMREMGenerator.fromEquirectangular` 吃一张 512×256 的程序化 canvas 渐变，用完即弃源贴图。

## 批 7 决策行

| 日期 | 问题 | 选择 | 理由 | 可回退方式 |
|---|---|---|---|---|
| 2026-11-25 | three r186 已删除 `PCFSoftShadowMap`，任务书要求用它 | 照旧赋值 + census 记 `shadow.requested`，断言按「有效类型含 PCF 且 requested 为 Soft」 | 赋值不报错（只是 warn 归一成 PCFShadowMap），删掉反而不满足任务书；warn 不进「控制台零报错」口径（探针只收 `type==='error'`） | 改回 `PCFShadowMap` 一行；断言同步 |
| 2026-11-25 | 阴影 A/B 在大厅只有 1.6e-4 亮度差，门槛会贴边抖动 | 把阴影亮度对照挪到数学区，大厅只留 bloom 对照 | 大厅只有 6 个信标投影（144 面），房间有 265 根立柱；房间 Δ 0.0084 是阈值的 4 倍，稳 | 挪回大厅需同时把阈值降到 1e-4（不建议） |
| 2026-11-25 | 主光架高后影子看不见 | 俯角从 ~60° 降到 ~38°（`half*0.8`），key 强度 1.05 → 1.5 | 亮度差从 1.6e-4 涨到 7.2e-3，截图可见长影；整屏亮度仍比洗白档低 63% | `focusShadow()` 一行位置公式 + `spacekit.ts` 一行强度 |
| 2026-11-25 | 立柱在截图里是针 | 实例 x/z 缩放 2.2（几何不改） | 一处常量，形态签名与顶点数不变，拾取盒同步放大 | `COLUMN_GIRTH = 1` |
| 2026-11-25 | 光点要不要用 GPU billboard（顶点着色器） | CPU 每帧重写实例矩阵 | `InstancedMesh.raycast` 读实例矩阵，GPU 方案会让 398 个光点点不中 | 换回着色器需同时改拾取射线 |
| 2026-11-25 | bloom 全分辨率吃帧 | 内部分辨率 0.65× | 省 ~11% 帧时，大厅 53 → 66 fps；高光边缘差异肉眼在 1440×900 不可辨 | `BLOOM_SCALE = 1` |
| 2026-11-25 | 阴影每帧重画太贵 | `autoUpdate=false` + 位姿变化时 `needsUpdate` | 场景静态，省 ~11% 帧时；代价是三角面必须分口径上报（已写进 census 与文档） | `shadowMap.autoUpdate = true` 一行 |
| 2026-11-25 | 现有 74 项门槛与新增上限冲突（dist 13.70 vs 12） | 不动旧项，**新增**一条「批 7 渲染层上限 12 MiB」 | 任务书要求「一条不许删、不许放宽，只许新增」；改旧值就是放宽 | 删掉新增记录行 |
| 2026-11-25 | 截图目录换名会丢历史 | 新建 `_work/shots-batch7/`，旧 `shots-batch6` 原样保留 | 只改 `PROBE_SHOTS` 常量，git 跟踪文件没动 | 改回常量名 |

## 批 8 阶段 A · 改前基线（实测，HEAD `d60f3ae`，非估算）

同机位、同 1440×900、dpr 1、`?flat=0`，采样 8–10 秒：

| 视图 | 帧率 | 三角面（整帧） | draw call | 说明 |
|---|---|---|---|---|
| 大厅俯视 | 72.1 | 1,852 | 63 | 六团圆盘阵列 + 浮空 HTML 标签 |
| 数学区 | 36.6 | 18,468 | 63 | 立柱 265 + 光点 398 |
| AI 区 | 33.4 | 33,000 上下 | 60+ | 章数最多的一区 |

改前「标签」口径实测：`sprites: 6`（区名）+ `domFloating: 40`（走廊名 + 书脊名浮层），
判据要求 0，所以阶段 D 是**迁移**而不是优化。

## 批 8 借鉴清单（只借思路与算法，零资产拷贝）

| 技术点 | 出处 | 借到什么 | 本项目改成什么 |
|---|---|---|---|
| 书脊纹理分层 | `codex-library/components/Scene.tsx:61–137` `createSpineTexture` | 底色 → 横向渐变压两侧 → 上下深色带 → 金色凸线 + 落影 → 菱形花饰 → 竖排书名的**层序** | 每本书不再单独 `new CanvasTexture`（`Scene.tsx:1121` 是 `useMemo` 一本一张），改成**一区一张图集**：`src/atlas.ts:drawSpineCell` 画进格子里，格 1:5 与书脊世界尺寸同纵横比 |
| 一本书 = 一个 6 材质盒 | `Scene.tsx:1128–1155`（`material-0…5`，注释还标了面序 0=+x…5=−z） | 「正面书脊 / 侧面封皮 / 上下纸口」三种材质的**语义分区** | 语义保留、实现换掉：`architecture.ts:emitSpine` 六面里正面用章格 UV、顶面用铜牌带、其余四面共用页底皮革色条；450 本书合并成 1–3 个 Mesh（判据 6 的 ≤3 draw call） |
| 房间 = 木地板 + 三面木护墙 + 顶光 | `Scene.tsx:869–930` `Room()`（28×16 地板、8 高墙、`woodPanel`） | 房间是**有围合的室内**而不是悬浮展台；墙用同一张程序化木纹贴不同色 | 尺寸按 1 单位 ≈ 25cm 重定标（`ROOM_HEIGHT 15`、边长按书量算），墙/天花只朝内单面片——外面看进去即「开盖娃娃屋」，俯视截图仍是室内 |
| 书架分层与逐层排书 | `Scene.tsx:988–1010` `BookcaseShelf` + `1649–1678` `Bookcase`（`SHELVES` 按 num 排 y） | 「一排书架 = 若干层，层内按序排书」的层级 | 层与书位由 `layout.ts:planRoom` 一次算完（行/层/槽三级），书位宽度按该书章数归一化：章多的书整排更宽，`SPINE_W_MIN/MAX 0.42–0.72` |
| 程序化贴图缓存 | `codex-library/lib/textures.ts` `buildTextureCache()`（一次性建全部 canvas 贴图，`Scene.tsx:1685` 注入） | 贴图集中构建 + 复用，避免每帧/每件现画 | `atlas.ts` 只在 `enterRoom` 建本区图集，`clearRoom()` 里 `dispose()`；区名牌匾/走廊铭牌按区缓存于 `plaqueTex`，切区不重建 |
| 贴花偏移 | `neonplan3d/.../neonplan3d-3d.js`（打包产物，按文件引用）`polygonOffset:-2 + depthWrite:false + flipY=false` 的贴花材质 | 铭牌/牌匾这种「贴在几何表面上」的片用 polygonOffset 防 z-fighting | 本项目牌匾走 `depthWrite:false` + 离开表面 0.4 单位外偏，不用 offset（片数少，不需要）；`flipY=false` 这条**没借**——CanvasTexture 默认 flipY=true，图集 UV 按「v 取反」算，改了会整体上下颠倒 |
| 房间预设与配色 | `shelfie/src/lib/roomPresets.ts:23` `wallColor(id)`（按 id 取墙色） | 一区一种墙面/线脚语言，靠 id 而不是随机 | `config.ts:SHELF_KINDS / PLAQUE_KINDS` 两张显式表：六区六种檐口 + 六种牌匾形制，几何签名进 census 供断言 |
| 悬停信息不常驻 | `3dGraph/src/a11y/index.js`（键盘可达 + 焦点才出说明） | 「要读信息才出现」的交互取向 | 全场景只留**一个** `.hover-tip` DOM 元素，停手 120ms 才出现（`TIP_DELAY_MS`），随指针移动；不是每节点挂标签 |

## 批 8 决策行

| 日期 | 问题 | 选择 | 理由 | 可回退方式 |
|---|---|---|---|---|
| 2026-11-25 | 书脊要不要一本一个 Mesh（参照实现就是这么写的） | 图集 + 合并几何，每区 1–3 个 Mesh | 判据 6 硬性 ≤3 draw call；AI 区 450 本按参照写法要 450 次提交 | `buildSpines` 返回逐本几何，改回 InstancedMesh 即可 |
| 2026-11-25 | 图集一页多大、一格多大 | 首版 1024²/格 32×160 → **终版 2048²/格 64×320**，页数与每页格数不变（192） | 32px 格在特写里被放大十几倍，书名糊成竖纹，判据 5「三张特写读得出书名」过不了；只提像素密度，`CELLS_PER_PAGE` 仍是 192、draw call 不变。显存 3 页 ≈50MB，只发生在桌面 3D 路径（手机走 2D SVG） | `config.ts` 三个常量改回 1024/32/160 |
| 2026-11-25 | 提分辨率后格内像素常量要逐处翻倍 | 画格内部固定用 32×160 逻辑坐标，落笔时 `g.scale(CELL_SX, CELL_SY)` 整体放大 | 字号、金线、铜牌带一次到位，ATLAS_SIZE 再变也不用改；只有铜牌带 UV 与色块边长两个常量需要按倍率算 | 去掉 scale，常量写死真实像素 |
| 2026-11-25 | 合并几何后怎么拾取（Raycaster 只给 faceIndex） | 建几何时就写 `triSpine[]`（逐三角 → `plan.spines` 下标），点击时 `triSpine[faceIndex]` O(1) 取 | 判据要求「不做线性搜索」；`find()` 一遍 450 条是每帧一次点击的 450 倍工作量。非索引几何 faceIndex 就是三角序号，天然可作下标 | 旧的逐书 `InstancedMesh` 拾取已删，不留两套 |
| 2026-11-25 | 走廊/区名标签迁走后怎么读名 | 区名进**门楣牌匾**贴图、走廊名进**地面铭牌**贴图，另加一个 120ms 延迟的单例 DOM tooltip | 判据 4 要「HTML 浮空标签 = 0」，但完全去掉文字又读不出区名；贴图是几何的一部分，不算浮层 | `roleHide('lintelPlaque', true)` 可临时关掉验证 |
| 2026-11-25 | 房间墙与天花做成双面还是单面 | 只朝内单面片 | 双面则俯视看不见室内（判据 1 要「截图看出是室内」），单面从外面看穿、从里面看是实墙，一个几何两用 | `side: THREE.DoubleSide` 一行，但俯视截图会变成六个黑盒 |
| 2026-11-25 | 进区默认机位压在哪 | 从 `side*0.92` 高俯视降到 `side*0.42`（齐檐口） | 高机位下半幅画面是格栅梁，读不出「阅览室」；压到梁下才看得见书架与地面 | `enterRoomCamera` 两行 |
| 2026-11-25 | 大厅俯视被雾吃掉七成（改前 72fps 但画面近黑） | 雾按视图切换：大厅 (420,1500)、进区 (210,620)；默认机位从 (0,330,380) 收到 (0,232,264) | 批 7 的六团大色块能扛雾，批 8 的 26 单位体量扛不住；机位是产品默认值不是测量控制量，metrics 里 `pose()` 两次都记 | `HALL_FOG` / `HALL_POSE` 两个常量 |
| 2026-11-25 | 六盏区灯挂在场景根，进区后每个片元多算 6 盏点光 | 把 `rig.zones` 挂到 `hall` 组下（进区即随 `hall.visible=false` 退出光照） | 房间帧率 36.6 → 49.5，判据 9 的 ≥45 才过；对照实测 shadowsOff 58.3 / bloomOff 55.2 / roomLightsOff 50.5 | 改回 `scene.add(...rig.zones)`，帧率立刻回去 |
| 2026-11-25 | 区灯该放在房间中心还是屋顶上方 | 提到 `ROOM_HEIGHT + 16` | 放中心时盒子的六面法线全部背灯，俯视是六个黑盒；提到屋顶上方才有彩色光池，六区身份靠颜色区分 | `spacekit.ts:buildLightRig` 一行 |
| 2026-11-25 | 书脊特写怎么保证「映射表 = 真射线」 | `focusSpine` 之后跑 `probePick(screen)`，把 `hit.chapterId` 与映射表的 `chapterId` 一起进 metrics | 只断言 faceIndex 映射会自证；真射线拾取是用户实际点到的东西，两者一致才算「点书脊开章」 | metrics 里 `spineProbes[].hit` 字段 |
| 2026-11-25 | `focusSpine(i, dist)` 传 0.55 为什么画面不动 | 不改代码：`controls.minDistance = 3.2` 会把距离夹回来，特写一律按 3.2 拍 | 判据只要求「读得出书名」，3.2 下书脊约 100×430 px，够读 | 想更近要同时降 minDistance，会伤及正常操作手感 |
| 2026-11-25 | 切区时共享贴图（木纹/皮革色条）要不要一起 dispose | 只 dispose 本区图集页与合并几何；`sharedTextures` 与 PMREM env 常驻 | 共享贴图跨区复用，逐区重建会让切区耗时翻倍；判据 7 要的是「本区图集 + 合并几何」释放，census 里 `spines.cells` 回 0 即证 | `clearRoom()` 里加一行即可全放 |
| 2026-11-25 | 工具间 0 本书，要不要造点书位把画面填满 | 不造：空房间 + HUD 说明「6 个仓库无 manifest，待批 5 生成层补源」 | 铁律「data/ 只读、不为了让演示好看改数据」；批 7 实测该区 columns 也是 0，不是本批回归 | 批 5 落库后自然有书 |
| 2026-11-25 | 走廊地面铭牌在取证机位下始终读不出（六条全糊） | 走廊壳体材质从 `DoubleSide` 改回 `FrontSide`，机位改成侧面平视 | 双面的顶面从上方照样可见 → 大厅俯视是六条封闭暗管盖，铭牌被顶面挡住。改单面后背面剔除，俯视直接看进管内。取证锚点改用 `mesh.position` 实测世界坐标、按文字基线朝向 `flip` 选观察者所在侧（原先按 `spec.at*0.62` 猜，点落在相机脚下，投影盒 263×678 竖比横大） | 材质 `side` 一行；`viewCorridor` 的位姿是取证用，不影响游玩 |
| 2026-11-25 | 书架墙正中出现一块随灯高等高移动的过曝带 | 两盏室内点光从房间中轴线挪到 `x = ±side·0.34`，强度沿用批 7 的 210/74 | 三条路都实测过：bloom 阈值 0.6→1.0 几乎不变（不是辉光）；书脊换哑光材质反而 0.64→0.79 更曝（垂足是漫反射本身）；灯降到 ≤50 能压掉光斑但特写亮度掉到 0.02（判据 5 读不出书名）。挪侧后方后侧墙虽仍是垂足面但近乎侧视，光斑被投影拉散，远墙只吃斜射（hot mean 0.16 / brightRatio 0） | `addRoomLights` 两行坐标 |
| 2026-11-25 | 室内帧缓冲要不要与大厅同档 | 房间 `renderScale = 0.85`、大厅 1.0，并把该值加进 `census()` | 室内机位贴得近、像素量大（判据 9 的 ≥45 在此最紧），0.85 档肉眼无损；门槛要能读到当前值才不会「改了没断言」 | `ROOM_RENDER_SCALE` 一个常量；census 多一个只读字段 |
| 2026-11-25 | `roleHide` 能不能用来证明光尘不遮书脊 | 不能：书脊与光尘两档可见性由 `applyLod()` 每帧按距离重写，roleHide 的赋值下一帧就被覆盖（实测 n=2、像素与三角面均无变化） | 归因换成「逐条 `focusSpine` 后跑真实射线，命中必须是自己」——这既验映射也验遮挡（已验证 58） | 若要 roleHide 生效需在 `applyLod` 里加白名单开关，本批没做 |
| 2026-11-25 | 门槛断言里「书脊三角 = 格数×12」写在哪 | 写进 `selfcheck_probe.mjs`（映射表长度、页 mesh 数、图集页数三条），而不是只在取证脚本里打印 | 判据 11 要「断言项 >88 且只增不减」；批 7 的 `columns / builtColumnGeometry / columnKindsDistinct` 三条随立柱一起作废，用批 8 的空间断言补上并净增 | 断言只读 census，代码回退即红，不会误绿 |
| 2026-11-25 | 三面书架在转角重叠一个进深，端头书种进邻墙（3D 穿模 / 2D 点击命中错书） | 书架两端各让出 `corner = SHELF_DEPTH + 0.2`，并把 `side` 的 `+3` 余量换成 `+2*corner` | 只砍 `tierLen` 不加 `side` 会白丢两面墙各一个进深的容量，超载区被贪心摊得更密；把余量整体挪给转角最省改动 | 实测房间边长：数学 20 → 20 不变、AI 23 → 26；每面书排短 3.0 单位，六区书脊格数与图集页数一字未改 |
| 2026-11-25 | 2D 降级里 `locator('svg g[data-slug]').first().click()` 卡死（可见、有节点、命中链正常） | 探针改成按 `elementFromPoint` 自筛「中心能命中本体」的书位，再 `touchscreen.tap(x, y)` | 平面投影把同墙 6 层压成一条线，首个书位中心被后画的邻层盖住，Playwright 的动作性检查永远过不去；指点头本来就是降级路径的真实交互 | 断言顺带变强：不只验开正文，还验开的是点到的那本（已验证 61） |
| 2026-11-25 | 章数标注 `<text>` 参与命中、替邻书接单 | 标注组加 `pointer-events: none` | 两位数宽约 0.9 世界单位，比书位（0.42–0.72）还宽，纯装饰的文本不该吃点击 | 2D 命中链从此只出现书位自身的 rect |
| 2026-11-25 | 库里 0 本的工具间要不要建书架（判据 2 说「每区 ≥3 排」，可该区一本书都没有） | 建：`buildShelves(plan)` 挪到 0 本早退之前，架子属建筑、书属数据 | 铁律禁的是伪造**书位**，不是禁家具；空盒子读起来不像阅览室，而三排空架正好把「这里还缺源」讲清楚 | tools 区 `shelves.rows 0 → 3`、`spines.cells 0`（一根脊都不造）、主口径 994 面 / 23 draw，2D 同步画三排架 |

## 批 9（全端统一 3D + 移动端适配 + 光照修复）· 2026-11-26

阶段 A 基线（= 批 8 收口实测，本批所有「改前」都取这一档）：`dist/` 9.903 MiB / 347 文件；大厅 1440×900 84.4 / 95.4 fps（10s 采样 8s 两次）；
390×844 走 `mode=flat` 的 2D SVG，不加载 `scene3d-*.js`；阅览室机位 `side*0.3` + 常量 fov 56；书脊图集 1024²/32×160 首版后已在批 8 提到 2048²；
门槛 89 项断言、`python tools/selfcheck.py` 116 项全绿。

| 日期 | 问题 | 选择 | 理由 | 可回退方式 |
|------|------|------|------|------------|
| 2026-11-26 | 移动端到底留不留 2D 降级视图 | 整段删除（`src/svg2d.ts` 398 行 / 15,497 B、`MatrixFlat`、`prefersFlatView()`、`?flat=1`、`main.ts` 的 `'flat'` 分支、`els.flat`、`index.html` 的 `#svg-root`、SVG 专用 CSS） | 任务书阶段 A 钉死；批 8 之后 2D 与 3D 共用同一套 `layout.ts` 空间账，双路径只剩重复维护与「两套判据互相打脸」；铁律第 4 条同步改写（见下） | `git revert` 本批 `feat(view)` 提交即整套回来，`layout.ts` 未改契约 |
| 2026-11-26 | 删分支后 `selfcheck_probe.mjs` 里 5 条绑 2D 的断言怎么处理 | **反写成 3D 语义、逐条留档**，不删 | 断言总数是「只增不减」的门槛量（`SPACE_ASSERT_MIN`），删一条就少一条；而「降级视图无 WebGL 画布」这类判据描述的是已不存在的支路，留着会永远红 | 五条都在 `selfcheck_probe.mjs` 手机段，逐条注释写了「旧判据 → 新口径」 |
| 2026-11-26 | 反写后的判据怎么写才不会「删了 X 所以 X 不存在」式空判据 | 每条都配正向证据：`mode === 'three'` + `#three-root canvas` 存在 + `sampleLuminance` 整帧 mean > 阈值（非全黑）+ `frameCheck()` 有结构点 | `querySelector('#svg-root') === null` 恒绿，证不了 3D 在跑（已验证 62） | 判据信息体里把四项都打出来，红了能直接看是哪一项 |
| 2026-11-26 | 新增哪 9 条断言 | 390 走 3D（挂载/构图/帧率/scrollWidth/触摸开书/滑动不误开/搜索/零外部请求/画质档开关） | 任务书 D1 点名四类（390 帧率、DPR ≤1.5、触摸拖拽不误开、竖屏构图两条、书脊反差），画质档是 64 那条踩坑换来的必需项 | `SPACE_ASSERT_MIN 89 → 98`，回退只需降回 89 |
| 2026-11-26 | 竖屏构图判据的口径怎么写 | 分组：大厅 20 点（六体量 + 六门洞 + 天花八角）要求 20/20；阅览室把 `back`（后墙四角）与 `sidewall` 降级为**参考量**，判据落在 `face/ceiling/floor` 三段各 4/4 + `shelves ≥1` | 窄屏水平半角 atan(tan38°×0.462) ≈ 20.3°，「两侧墙全进画」与「书脊点得中」物理上不可兼得；把不可能满足的项写进判据等于制造永久红灯（已验证 68） | `frameCheck()` 的 room 分支点集一处；旧口径的 19 点仍在 `back/sidewall` 里可读 |
| 2026-11-26 | 「装全了但点不中」用什么量兜 | 新增诊断 `spineProbe().px`（脊面上下沿各投一次取屏幕像素高），门槛取 ≥36 | 反差、构图账都测不出「指头能不能点中」；实测 math 39–51、ai 23–33，娃娃屋距离下只剩 20 上下 | `SpineProbe.px` 一个只读字段 |
| 2026-11-26 | `ROOM_FOV_MIN` 取 52 还是 56 | 56（= 批 8 常量） | 52 也能装下三面墙，但 `need` 随 tan 涨，机位被推到门外 13 单位 → 娃娃屋 + 书脊点不中；56 时 `need` 落在门墙内侧，与批 8 同形 | `config.ts` 一个常量 |
| 2026-11-26 | 竖屏阅览室机位怎么给 | `dist = side*0.5 − 1.5`（门墙内侧 1.5 单位），与横屏 `side*0.3` 之间按 `aspectRamp` 线性插值 | 站门口看进去：书墙中段 + 天花梁下 + 地面都在画，书脊 39–51px 可点；桌面端 `aspectRamp = 0` 一字不动，回归面只在窄屏 | `roomEye()` 一个函数 |
| 2026-11-26 | fov 改了画面不动（批 8 遗留 bug） | `setFov()` 补 `camera.updateProjectionMatrix()` | 只改 `fov` 不刷新投影矩阵，下一帧仍用旧矩阵——自适应整条链会静默失效，`frameCheck` 读数却「正常」 | 删该行即复现 |
| 2026-11-26 | 画质降档的开关放哪 | 全部集中进 `config.ts:qualityTier()`，`scene3d` / `spacekit` 只读结果 | 任务书 B2 硬要求「开关集中一处」；三档散在各 build 函数里时，改一档要动五处、门槛读不到当前值 | 两档常量对象 `DESKTOP_TIER` / `MOBILE_TIER` |
| 2026-11-26 | 窄屏成效用什么证明 | **不用 fps**（headless rAF 在 390 饱和在 ~165，四个档位组合实测 165.1–165.2 / 140.7 一模一样），改由 `quality()` 逐项读开关；fps ≥30 只当回归底线 | 已验证 64；`setPassEnabled('Bloom', true)` 在未建 bloom 的档上是空操作且返回值没人读 | 断言信息体打全 `quality()` |
| 2026-11-26 | 触摸位移容忍与判定 | `TAP_SLOP_TOUCH = 8` / `TAP_SLOP_MOUSE = 6` 分开，位移取整段序列离起点的**最大值**，`≥ slop` 即判拖拽 | 任务书 B3 钉 8px；首末两点距离会被「出去再回来」的弧骗过（已验证 63） | 两个常量 + `tapVerdict()` |
| 2026-11-26 | chapter 命中要不要补发 `onPickBook` | 不补发，只发 `onPickChapter` | 两条链各调一次 `bookRecord`（未缓存 = 两次并发 fetch），谁后回来谁定 `mode`，晚到的 `openBook` 把 chapter 打回 overview——390「点书脊开正文」就是这么炸的（已验证 67）；`pickChapter` 本身已做 `setSelection + openBook + openChapter` | `scene3d.ts:handleClick` 删一行即恢复双发 |
| 2026-11-26 | 顶面（藻井/檐口/门洞上沿/天花）打不亮，加不加灯 | 先加了一盏自下而上的 `DirectionalLight`（upFill），**实测后撤掉**：大厅同机位 8s 采样 62.1 → 165.2 fps（2.7× 帧时），收益只有整帧 p95 0.06497 → 0.08002 | 顶面法线朝下，方向光 `dot(N,L)` 被 clamp 成 0，加灯是「再买一倍的帧时买几个百分点」；已验证 65 | 撤灯即回；`buildLightRig` 注释里留了这两组数字 |
| 2026-11-26 | 顶面最后走哪条路 | `HemisphereLight` ground 色 `0x10131a → 0x2a2f3a → 0x3c4352`、强度 `0.36 → 0.52`，墙/天花/横梁各配 `emissive + emissiveMap`（暖白 `0xffe9c9`，0.11 / 0.22 / 0.16），天花单独出材质（`#6b5638/#7c6a4d`），墙基色 `#2f2620 → #3d3026` | 杠杆实测（走廊顶带 p95）：基色 0.0048 / 关阴影 0.0098 / hemi×5 0.0215 / roomPoint×4.3 0.0911，但整帧代价 0.072 → 0.235 会把书脊反差顶掉；emissive 是「把反弹烤进表面」，零逐片元成本。只抬反照率没用（1.7× 只动几个百分点，ACES toe 段压掉了） | 材质与灯参数各一处；走廊顶带 0.03496 → 0.04202 可复核 |
| 2026-11-26 | C3 书脊字口弱怎么修 | 图集每格加**暗色题签底板**（书名烤在题签上），字色 `#f7e9c9` 提到 `#f7f2e4`，并按 `measureText` 宽度自适应截断（原来按字数硬截 12） | 判据要「3m 外读得出书名」且反差可量化；底板把字/背景对比度提到 min 15.21（math 16.59 / ai 15.21 / chem 16.35 / cs 15.63 / general 16.24），门槛线 4.5 | `atlas.ts` 题签绘制 + `SPINE_TITLE_MAX` |
| 2026-11-26 | bloom 判据的采样窗 | 保留整帧 Δmean，另加**高光簇窗** `[0.26,0.24,0.44,0.48]` 要求 Δmean 与 Δp95 双 >1e-3，并加护栏「簇窗均值 > 整帧 1.5×」 | 整帧 p95 落在暗部平台（0.06069 = 15.5/255 一档），关 bloom 时它本来就只降 1/255，门槛会随机翻脸（一度 base 与 noBloom 同为 0.06069）；簇窗是 10×7 网格扫出来的 Δmean 最大格，实测 Δmean 0.00623 / Δp95 0.02970、5 轮极差 0.00000 | 阈值一字未降（1e-3），只是换了更对症的统计量；`BLOOM_CLUSTER` 一个常量 |
| 2026-11-26 | 390 取证脚本的触摸开书怎么稳定 | 先遍历 60 个采样格筛「屏幕点在视口内、不被左下角小地图压住、且 `faceIndex` 反查 = 实时射线」的书脊，再 `touchscreen.tap` | 直接取 `spineProbe(0)` 会拿到 x=424（视口外），tap 落空 → `lastTap: null`、阅读层不开，看起来像功能坏了其实是取证点选错 | `tools/shots_batch9.mjs` 手机段 |
| 2026-11-26 | 「before」截图从哪来 | 复制批 8 的 `after-*` 同机位图（30 张）作 `before-*`，本批 `after-*` 28 张 | 批 8 的机位口径与脚本一致（大厅 showHall 默认位、进区由布局决定、走廊 `viewCorridor`），同机位才可比；批 8 的 mobile 组本来就是 2D 视图，正是阶段 A 的改前形态 | `_work/shots-batch9/` 两族文件，`before-metrics.json` / `after-metrics.json` 并排 |
| 2026-11-26 | `PROBE_SHOTS` 与门槛页脚 | `selfcheck.py` 的 `PROBE_SHOTS` 指 `_work/shots-batch9`，页脚打印同步改掉（原来还写着 shots-batch8） | 页脚与实际目录不一致会让人去翻旧目录、以为本批没出图 | 两处字符串 |
| 2026-11-26 | 铁律第 4 条原文「3D 在触屏或宽度 < 768px 时自动降级 2D SVG，不得白屏」 | 改为「全端只有一条 3D 路径（批 9 起删除 2D 降级视图）：触屏或宽度 < 768px 靠画质降档保帧率，不得白屏」，`agents.md` 摘要与 `.qoder` / `.lingma` 两份全文一起改 | 旧条文与本批实现直接冲突，留着会让下一批按条文把 2D 加回来；「不得白屏」这个目标原样保留，只换实现口径 | 三份文件各一行，`git revert` 即回旧文 |
| 2026-11-26 | 体积记账（D3） | 记净值不猜归因：`dist/` 9.903 → **9.901 MiB**（−2 KiB）、347 文件不变 | 删 398 行源码没换来可见收益——svg2d 在 entry 静态闭包里，本批新增的构图解 / 画质档 / `frameCheck` 点集 / `px` 与采样窗诊断落在同一批 chunk；文件数不变比总量更能说明「没往产物里添东西」 | `docs/deploy.md` 2.1 表 + 说明段 |
| 2026-11-26 | 提交怎么切成 feat(view) / feat(light) / docs / chore(work) | 按**文件**分组，不按行拆 `scene3d.ts`：`feat(view)` 拿 svg2d 删除 + index/main/state/styles/config/scene3d + 取证脚本，`feat(light)` 拿 `atlas.ts`（题签底板重绘）+ `spacekit.ts`（材质与光参配合）+ `docs/design.md` 7.4 光照段，docs 提交拿三份铁律 + README + AGENTS + deploy/pitfalls，chore 拿门槛与 _work 记录 | `scene3d.ts` 的 27 个 hunk 里机位/手势/画质档与灯光参数交错在同一批 build 路径上，按 hunk 拆需要临时改写工作区文件（第 1 类禁动作），且中间提交会失去可编译性；两条 feat 的**内容边界**在提交说明里各自写清，C1/C2 的 scene3d 行随 feat(view) 落库并在那条说明里点名 | 未 push，任意一条 `git revert` 单独可退；文件分组不改内容，重排只需 soft reset 再分组 |

## 批 10（竖屏构图反算 + 大厅补光 + 题签做工）· 2026-11-26

阶段 A 基线（= 批 9 收口）：`dist/` 9.90 MiB / 347 文件；门槛 98 项探针断言 + 19 项 gate 项全绿；
390 大厅主体竖向 ~33%（上下死黑带）、阅览室后墙/侧墙 0/4、0/4；桌面大厅藻井梁/板同明度、门洞内外同明度；
书脊题签占脊宽 100%（远看是「蓝盒子上贴黑胶带」）。

| 日期 | 问题 | 选择 | 理由 | 可回退方式 |
|------|------|------|------|------------|
| 2026-11-26 | 竖屏「装得下」但主体只占画面三分之一，怎么治 | 三自由度一起解：fov 56→76、水平挤压 `Kx = 1+0.55·ramp`、机位 `span 142→260 / pitch 38°→64°`，全部按 `aspectRamp(aspect)` 插值 | 批 9 的判据是「20 点全入画」，对「贴边缩小」免疫（已验证 69）；退机位求装全只会退进纯黑（已验证 71）。挤压水平视野不动垂直视野，桌面 ramp=0 完全退化为基线 | `config.ts` 的 `HALL_PORTRAIT` / `ROOM_LENS_MAX` + `scene3d.hallPose()` 一处 |
| 2026-11-26 | 镜头挤压后射线拾取会不会错位 | `setFov(fov, lens)` 里 `projectionMatrix.elements[0] /= Kx`，同一函数里立刻 `projectionMatrixInverse.copy(projectionMatrix).invert()` | Raycaster 与 `Vector3.project()` 共用同一对矩阵；只改一个会「看得见点不中」。`lensKx` 进 `quality()` 可读 | 一个函数；Kx=1 即原样 |
| 2026-11-26 | 竖屏主体占屏比用什么口径 | `subjectBox()`：大厅 88 点（八角壳 16 + 六门 24 + 六走廊端点 24 + 六门签 24）、阅览室 16 点，投影包络的 NDC 跨度 /2 即占屏比；门槛 竖 ≥50%/≥55%、横 ≥75% | 占屏比与机型无关、可复算；截图只能看不能卡线（已验证 69）。NDC 含视锥外的点取 raw，不先裁边——裁边会把「贴边放大」读成 100% | 探针只读 `subjectBox()`，代码回退即红 |
| 2026-11-26 | 底部 UI 净空怎么量 | DOM 三件套（`#minimap` + `#roombar` + `#hud`）取可见者并集带的顶边 → 带高 ≤22% 视口；与主体屏幕矩形求交 ≤10% 主体面积 | 小地图 `pointer-events:none` 不挡点击，但视觉上压住主体就叫「看不清」；只看 CSS 高度不量重叠会漏掉「浮在主体上」 | 探针内 DOM 读取，无产品代码改动 |
| 2026-11-26 | 大厅「梁/板、门内外」的明度差在哪测 | 藻井环 r=40.8 的梁轴（y 21.775）4 点 vs 扇板轴（y 21.15）4 点；门内 r=38 vs 门外 r=50 地面各 6 点；每点 3×3 邻域均值 | 世界坐标固定，与帧率、机位无关、可复算；`probeWorldPoints` 读回 0–255 定门槛单位（差 ≥8 / ≥10） | `scene3d.hallLightProbe()` 一处 |
| 2026-11-26 | 藻井环的几何与材质 | 8 扇 × 4 面环带（内径 38 / 外径 43.6 / 顶 21.15 / 底 20.75），独立 mesh + `cofferTexture()`；梁改深木 `#332416` + emissive `0x1c130b @ 0.7`，宽度 0.85→1.6、从环面凸出 0.6 | 梁/板差要 ≥8/255；只靠一盏「真吊灯」照不亮顶面法线朝下的面（已验证 65），发光材质是零逐片元成本的那条路；环带+1 draw，三角面 +32 | `architecture.ts COFFER` + `scene3d` 材质两处，删掉即回批 9 平顶 |
| 2026-11-26 | 不能整屏提亮，用什么兜底 | hemisphere 强度 0.52→0.8、地面色 0x3c4352 保留；地面材质乘子 1.9 | 批 9 的 0.52 在俯冲机位下地面与六体量整片 ≤0.02（暗像素 57%）；整帧 p5 卡 ≤0.03 防止「提亮换断言」——实测 0.0196 | `spacekit.buildLightRig` + 地面材质各一处 |
| 2026-11-26 | 帧率代价怎么记 | 桌面大厅 10s 采样 61.3 fps（批 9 同法 93.3），仍 ≥45；三角面 1902→1916、draw 63→64（藻井环+总览采样点） | 掉帧来自「地面提亮 + 藻井环让 bloom 高光簇变大」；补光是为了修「看得见」而不是省帧，门槛有余量就不回退；数字全部进 decisions 与 last-result | 见上两行回退方式 |
| 2026-11-26 | 题签宽度收到多少、怎么证明 | `SPINE_PLATE_RECT.w 32→20`（0.625），露出烫金线/菱形/上下暗带；双证：图集参数 0.625 + 渲染实测跨脊扫描中位比 0.5968 | 100% 宽是三米外「黑胶带」的根因（已验证 70）；只写参数不测渲染会「改了没画上」，只测渲染会被单条金线带偏，双证互锁 | 常量一处 + 探针一条 |
| 2026-11-26 | 题签实测第一版读出 0.77（比参数大 23%） | 采样点从书脊中心平面挪到正面（中心 + depth/2 + 0.03），中位比立刻回 0.597–0.617，与 0.625 吻合 | `edge()` 原先投影在中心平面，透视下比正面窄 ~25%，分母偏小（0.625/0.75≈0.83）；书脊 depth 1.7、特写距离 3.4 正好把误差放大 | 探针内 `faceOut` 一行，回退即重现 0.77 |
| 2026-11-26 | 题签中线扫到金线时阈值被抬高怎么办 | 阈值锚在扫描线亮度 p10（题签底色）+0.045 固定余量，不再用 p90 自适应分位 | 横贯书脊的金线把 p90 抬到 0.45，thresh→0.15，皮革 0.11–0.19 被误判为暗，七条线里冒出一条 0.70 假值；固定余量下五区七线全部 0.595–0.618 | 一个表达式 |
| 2026-11-26 | 字口反差的断言线从 4.5 提到 12 | 新增一条 ≥12（有书的五区），旧 ≥4.5 那条保留不动 | 题签收窄后字色没变、底更暗，实测 min 15.21（ai）仍有 3.2 倍余量；AAA 线把「将来调色收窄」的误改拦住 | 多条断言并存，SPACE_ASSERT_MIN 已含 |
| 2026-11-26 | 题签特写取证为什么两次截出同一张图 | 不改产品：`enterRoom(k)` 对「已经在该区」是相机 no-op，复位的正确做法是 `showHall()` → `enterRoom(k)` | 探针 `room-math.png` 曾在 spinePicks 之后重进 math 时实际拍到的是最后一条书脊特写（md5 与 focusSpine(2) 截图相同才发现）；取证脚本据此改成进区只发生一次、需要复位时先回大厅 | 取证脚本机位序列 |
| 2026-11-26 | 390 触屏开书断言第一次重跑仍落 overview（第 1 层原因） | 探针在点击后等 `readerState().mode === 'chapter'` 再读，断言谓词不变 | 只在 `open === true` 就读会命中「overview 面板先出、openChapter 还在异步载入」的读时竞态 | `selfcheck_probe.mjs` 一处 waitForFunction |
| 2026-11-26 | 加了等待仍失败，第二次重跑把真根因揪出来（第 2 层原因） | 探针改为「按当前位姿重选靶 + 按取整后的屏幕坐标验拾取」：`Math.round(screen)` 后 `probePick` 必须是同一章的 chapter 带才点；不再复用拖拽前选的 `spineTap.i` | 浏览器/CDP 把触摸点按整数 CSS 像素投递（实测小数 237.33→237、421.53→422）；书脊中心恰好压章节带边界，0.3px 小数就从 chapter 滑到铜牌/封面带 → 开了书但停在 overview。另外 `enterRoom(k)` 对同区是按设计不重置机位的（判据 C5 靠房间相机返程），拖拽后必须重新选靶。定点复现：书脊 48 整数点 `book`、书脊 53 整数点 `chapter`，点击后 200ms 进 chapter | `selfcheck_probe.mjs` 的选靶循环一处；产品代码零改动 |
| 2026-11-26 | 新增断言放哪、总数怎么记账 | 十条按 A/B/C 分组进 `selfcheck_probe.mjs`（A1/A2/A3/A4/A5 + B1/B2/B3 + C1/C2）；`SPACE_ASSERT_MIN 98 → 108`，gate 标签改「批 10」 | 任务书 D 要求「98 条全保留、新增 10 条」；断言只增不减是仓库既有门槛量 | 降回 98 即还原 |
| 2026-11-26 | 取证目录与页脚 | `PROBE_SHOTS="_work/shots-batch10"`；页脚打印同步改；`tools/shots_batch10.mjs` 负责 before/after 两族 | before 一律复制 shots-batch9 同机位 after（大厅/走廊/数学区/spine 0-中-末/390 三景）；after 六类各 ≥8 张 | 两处字符串 + 新脚本 |

## 批 11（第一人称漫游）· 2026-11-26

阶段 A 基线（= 批 10 收口）：`dist/` 9.912 MiB / 347 文件；门槛 108 项探针断言 + 19 项 gate 全绿；
相机只有轨道一种（WASD = 平移、滚轮 = 远近、拖拽 = 绕心旋转），空间是「看得到走不进去」的娃娃屋视角。

| 日期 | 问题 | 选择 | 理由 | 可回退方式 |
|------|------|------|------|------------|
| 2026-11-26 | 漫游是新建视图类还是并进 Scene3D | 并进 `Scene3D`：`camMode: 'orbit' \| 'walk'` 一个开关 + `setWalk()/toggleWalk()`，不新建渲染路径 | 批 9 的铁律是「全端只有一条 3D 路径」，第二条渲染管线会把所有既有断言置于回归风险；且漫游要复用同一批 mesh、图集、faceIndex 表与阅读面板 | `main.ts` 的 `btn-walk` 与 `KeyF` 两处入口删掉即回到纯轨道；场景代码零迁移 |
| 2026-11-26 | 眼高取多少才不是魔法数 | `WALK.eye = 1.65`（世界尺度 1 单位 ≈ 25 cm，即 1.65 m 人眼高）、`stand = 1.85` 只作竖直通带上界 | 房间 side 20 / height 15、书架五层总高 ≈11.6；取 1.65 正好平视最下一排书脊（首层板 0.42 + 书高 ≈1.6 → 书心 1.2），取 5 或 8 会把书架顶压到头上变成娃娃屋 | `config.ts` 一处常量；门槛断言读 `walk().eye` 与 `±0.1` |
| 2026-11-26 | 碰撞体用 AABB 还是 OBB | **只绕 Y 的 OBB**（`src/walk.ts`）：一次 2×2 旋转把点换进盒子本地系做 AABB，解完换回 | 六个区绕 Y 转了 `π/2 − angle`，墙与书架在世界空间全是斜的；AABB 包斜墙会把门洞糊住、贴墙走撞在假墙角。绕 Y 单轴旋转的 OBB 成本 = 两次乘加 | 新文件；接不上就把 `colliders` 传空数组，行为退回「无碰撞漫游」 |
| 2026-11-26 | 盒子长轴对哪根本地轴、yaw 怎么取 | 长轴 = **本地 z**，`本地 z → 世界 (sin yaw, cos yaw)`；走廊墙 `yaw = π/2 − a`、八角厅边墙 `yaw = −a`、房内墙 `yaw = room.rotation.y` | 取 `yaw = +a` 时八角厅六面墙被转成**径向鳍**：实墙那面整面漏人（实测 −135° 一路走到 130 单位），门口反倒提前 5 单位撞鳍（已验证 72）。同一份几何里出现两种方向约定，必须从一个向量反推 yaw | `hallBlockers` / `corridorBlockers` 各一行 |
| 2026-11-26 | 膨胀盒最小穿透推出去会把人翻到墙外 | 推向按 **`prev`（本帧起点）从哪一面进盒** 决定：`prev` 在 x 外/z 内就推 x 面并取 `sign(plx)`；两轴都外才退回最小穿透轴 | 0.6 厚的墙斜着撞上去时，「当前在哪一侧」判据会把人推到墙**外侧**——实测厅角 190° 方向被抛到 63 单位开外，人从八角厅漏出去（已验证 73）。碰撞方向必须由运动历史给，不能由当前位置给 | `resolveSlide` 的 `prev` 参数（不传即原行为） |
| 2026-11-26 | 正好首尾相接的盒子转角漏人 | 段与段在顶点**搭接 1.2**（大厅）、房内四墙转角**搭接 0.6** | 两个相邻膨胀盒在角上留一个楔形缺口，沿径向走会被最小穿透轴推出到墙外（实测 23° 方向翻到 128 单位）。搭接只增 `hz`，不加盒子、不加 draw | 两处常量 |
| 2026-11-26 | 外墙要不要给高度 | **不设顶**：`y1 = 1e6`；书架反过来给真顶（末层 `boardY + pitch + 1.8`） | 任务书 B 要求「不能靠跳过盒顶绕墙」；书架是能贴着走的实体，无顶会允许从架顶绕进墙里 | `OPEN_TOP` 一处 + `roomBlockers` 的 `top` 一行 |
| 2026-11-26 | 碰撞盒尺寸从哪来 | 全部复用 `layout` / `architecture` 的既有数（`side / WALL_T / SHELF_DEPTH / row.length / boardY / ROOM_DOOR`），正门墙按 `dw = min(w, side−2)/2` 拆两段，门楣不做碰撞体 | 「看得见穿模、算不出碰撞」是最难查的一类假绿：另立一套尺寸 = 断言与画面各说各话。门楣算进去等于把 7.2×9.2 的门封一半 | 尺寸改动即同时改 `buildRoomShell`，两边不可能漂（同一批常量） |
| 2026-11-26 | 走廊通没通、墙挡没挡，怎么判而不抽查 | 新增 `walkMarch(dx,dz,dist,use)` 逐步推进（0.12/步），记 `travelled / blockedAt / stopKinds / minGap`；门槛**扫满 72 个方位**（大厅）+ 六条走廊 + 房内四向 | 首末两点距离会骗人（批 10 已验证 63 同族）；四向抽样正好放过「只有斜向漏」的 bug——本批那个 yaw 反向错误就是扫 72 方位才揪出来的 | 只读诊断方法，删掉不影响产品 |
| 2026-11-26 | 漫游态拾取要不要重写射线 | 不重写：`ndc = (0, 0)` 走批 8 同一张 `faceIndex → (book, chapter)` 三角形角色表（`spinePick`） | 任务书 C 明令「不得有第二套拾取实现」；俯瞰态能点中的书脊，漫游态站在它前面也必须点中同一章，两套实现必然漂 | 一个入口函数换参，回退即改回俯瞰坐标 |
| 2026-11-26 | pitch 上限取多少 | 夹 **±70°**（`WALK.pitchMax`），yaw 不设限；灵敏度 `lookPerPx = 0.0052`（90° 需拖 302px ≈ 一屏宽半圈） | 取 70° 而不是 90°，从根上不可能出现万向锁翻转；不强制 PointerLock（那会在页面外冒失焦、且浏览器要用户手势授权） | `config.ts` 两个常量 |
| 2026-11-26 | 触屏左右分区要不要画线 | **不画**：分屏线 `x = window.innerWidth / 2`（390 即 195px）只写在 `docs/design.md` 15.5 | 画出来就是一条 DOM 浮标，直接违反批 8 铁律「空间节点不用 HTML 浮标标注」；摇杆本身在指头落点出现，用户不需要一条常驻分隔线 | 判据在 `scene3d` 指针处理里，一行 `ev.clientX < innerWidth/2` |
| 2026-11-26 | 轻点怎么和转头区分（判序） | **先位移后时长**：`moved < slop`（触屏 8px、鼠标 6px）先过，再过 `duration < WALK.tapMaxMs = 700ms`；不满足即把记账 `lastTap.action` 翻成 `drag`。触屏样本坐标：左摇杆 (90,620)→(90,520)、右转头 (300,420)→(144,504)、轻点 (195,420)、长按 (195,420) 静止 900ms | 顺序反了会把「按住不动盯书脊看」误判成点击开书；位移先判还能顺带把「拖过头再回来」也挡住。实测长按 900ms → `{moved:0, slop:8, action:'drag'}` 且正文未开 | `WALK.tapMaxMs` + `tapVerdict` 一处 |
| 2026-11-26 | 摇杆几何与死区 | 底盘 96px / 把手 40px / 行程 48px / 死区 `stickDead = 0.18`（行程的 ~1/4），半透明，指落点出现、松指归中隐藏，`pointer-events: none` | 底盘 96 与既有触屏按钮 ≥44 目标线同源；死区太小会把手指抖动当走路，太大起步肉。390 实测摇杆实时盒 (42, 572, 96×96)（底边 668）与学科条顶边 771 相隔 103px 不相压 | `.stick` CSS + `WALK.stick*` 两常量 |
| 2026-11-26 | 漫游时大厅地面是「平面方案图」糊成的横条纹 | 漫游态换一套地面/材质：`applyWalkSurfaces(true)` 把俯瞰 `ground`（10.8 texel/单位）换成程序化石板（`repeat 14`，37.6 texel/单位），墙/天花/藻井/走廊壳/体量走 `Texture.clone()` 克隆 + `emissive 0xffe9c9 @ 0.11–0.17` | 贴图密度要按**真正会用这张图最近的相机**判，不按总览判（已验证 74）；`Texture.clone()` 共享 `source`，只多一份 UV 变换，不额外上传显存；emissive 是零逐片元成本，比再加一盏灯便宜 | `walkMatPairs` 记账、退出原样换回；关函数即回俯瞰材质 |
| 2026-11-26 | 漫游要不要跟一盏手持灯 | **不加灯**：只做材质自发光 | 批 7 的教训（已验证 65）是「顶面法线朝下的面吃不到方向光」，加 PointLight 要重排灯 census 并让阴影贴图每帧更新（`shadow.autoUpdate = false` 会被打断）；emissive 克隆一次到位、灯数不变 | 灯账本 `census().lights` 保持 `Hemisphere 1 / Directional 1 / Point 7` |
| 2026-11-26 | 近景读数怎么截图取证 | 亮度读数一律走 `window.__zhishu.sampleLuminance()`（renderOnce + `gl.readPixels`），不用 `drawImage` | WebGL canvas 没开 `preserveDrawingBuffer`，`drawImage` 读回来是全黑（已验证 75）——八张近景图第一次判成「dark 100%」就是这个 | 探针侧，无产品改动 |
| 2026-11-26 | 「摇杆不压学科条」跑绿了但读数是全零盒 | 判据挪到按下之后取**实时盒**（`stickLive.box`，并加 `w === 96` 与 `overlapWithRoombar === false`）；进漫游那条断言改判「摇杆未落点不出现（hidden）」 | 摇杆是指落点才生成的浮层，静止时 `hidden` 且盒退化成 0×0 落在原点——`0 <= 771` 恒真，这条断言其实在判空气（已验证 77，与批 10 的 62「删分支后残留选择器恒绿」同族）。凡新增 DOM 几何判据，先看报告里那行的原始读数是不是全零/`null` | 两条 `check()` 的谓词与标签 |
| 2026-11-26 | 断言总数怎么记 | 新增 **18 条**（桌面 13：A 组 3 / B 组 6 / C 组 2 / E 组 1 / F 组 1；390 侧 5：D 组）进 `selfcheck_probe.mjs`；`SPACE_ASSERT_MIN 108 → 126`，gate 标签与页脚改「批 11 / `_work/shots-batch11/`」 | 任务书只要求 ≥9，按「只增不减」把实际条数写进门槛；九条必给实测数字的断言全部带读数 | 降回 108 即还原 |
| 2026-11-26 | 体积与帧率代价 | `dist/` 9.912 → **9.93 MiB**（+18 KiB，文件数 347 未变、零新增资产）；漫游态桌面 10s 均值 **57.1 ≥45** | `walk.ts` 与 scene3d 同在动态 chunk，不产生新分包；碰撞解算是每帧常数级 32/13 个盒子，成本在贴图与阴影上不在物理上 | `deploy.md` 2.1 一行 |

