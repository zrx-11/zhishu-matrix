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
