# tools/

抽取与校验脚本。全部用标准库 + 可选依赖，不要引入重型框架。

## 运行依赖（2026-11-24 本机实测）

**Python 3 必需；Node 两处需要——数独一类站的正文求值、`selfcheck.py` 的浏览器探针；git 仅拉源码时需要。**

| 依赖 | 必需性 | 用途 | 缺失时 |
|---|---|---|---|
| Python 3（本机 3.12.10） | **必需** | 全部脚本，只用标准库，无第三方包 | 无法运行 |
| **Node 运行时** | **数独一类站 + `selfcheck.py`** | ① `ZS.*` 内联是 JS 字面量（无引号键、模板串、注释、尾逗号），`json.loads` 解不了，用 `new Function('return ' + 字面量)()` 求值；② 自检探针要 `playwright-core`（devDependency）驱动本机 Edge | ① 该站降为 `contentLevel: "stats-only"` 并记 `_report.json`，**不自动安装运行环境**；② 门槛跑不起来，直接判未完成 |
| git | 需要（仅 `clone_repos.sh`） | 按档位拉 `_work/repos/` 源码，供正文本地读盘 | 退回 raw 逐文件回读（`docs/schema.md` 第三节） |

本机 `node --version` 随 shell 而变：系统 PATH 是 **v24.18.0**（`D:\nodejs\node.exe`，2026-11-24 记录），
沙箱 shell 解析到的是 **v22.23.2**（批 2/3 的 `npm run build` 与自检探针即在此版本下跑通）。
`git --version` = **2.56.1.windows.1**。
抽取器只把 Node 当子进程求值用、不依赖任何 npm 包；求值脚本应随 `extract.py` 内联生成，勿把 `_work/sz_eval.js` 当正式实现。

## 计划中的脚本

| 文件 | 作用 | 状态 |
|---|---|---|
| `extract.py` | 抓 50 仓 → 一份 manifest 一本书 → 判 `contentLevel` → 本地读 `.md`（degraded 走 Node 求值）→ 写 `sites/` + `bodies/` + `dist/` + `manifest.json` + `_report.json` | **已产出 `data/`**（批 1）：50 仓 → 129 条书目 / 96 独书。首跑实测见 `docs/probe-report.md` 十一节；`--all` / `--bodies` / `--out-dir` / `--dry-run` / `--limit` / `--link-policy` |
| **`clone_repos.sh`** | 按三档策略把站点源码拉到 `_work/repos/`，供正文本地读盘；`--dry-run` 只打印档位不联网 | 已登记并按实测复核（2026-11-25：`kaoyan-math-66000`、`CourseVault-OfflineCourseMap`、`ACM-XCPC-Notes` 三站归 three-big，`TIER3_ROOT` 暂空；路径改为脚本相对，`bash -n` 通过、dry-run 档位归属正确） |
| `probe.py` | 单站探路：打印该站 `index.html` 里内联数据的变量名与结构 | 已并入 `extract.py --probe`，不再单列 |
| `verify_data.py` | 校验产出：totals 与文件数、schemaVersion、必填字段、slug 唯一、检索分片 | **已生成**（批 3，批 4 扩到五类 23 项断言：新增 `check_search_shards()` 验 `data/dist/search-*.json` 六片齐、单片 ≤300KB、`counts` 与数组长度及 manifest 条数对账、字段齐全且 `file` 在 `data/sites/` 存在、术语 `c` 必须落在同书章节 id）。`data/` 实测全绿、退出码 0；另用 6 个变异副本验过「改坏必红」。跑法 `python tools/verify_data.py [--verbose] [--json] [--data-dir DIR]` |
| **`check_offline.py`** | 构建后静态扫描 `dist/` 产物里的远程引用，按铁律三类白名单分流后判违规 | **已生成**（批 3.5 B 阶段，决策 3 落地）。资源加载位点上的远程 URL 才算违规；`xmlns` / 代码块与 JSON 字面量内 URL / `example.*`·`localhost`·`127.0.0.1` 保留域名记白名单。跑法 `python tools/check_offline.py [--json OUT] [--root DIR]`，实测「违规 0 处 · 白名单 xmlns 6 / 保留域名 2 / 字面量 106 / 数据 200 · 文件 332」 |
| **`build_search_index.py`** | 生成批 4 检索分片 `data/dist/search-<area>.json`（六学科各一片） | **已生成**（批 4）。只读 `data/manifest.json` + `data/sites/*.json`，写 `data/dist/search-*.json`；字段 `slug/file/title/area` + `chapters[]/concepts[]/terms[]`，超 300KB 自动丢长描述只留标题（实测均无需降级，最大 ai 281.2KB）。tools 区库内 0 本，照样出空片（`counts` 全 0、0.3KB）走前端容错。跑法 `python tools/build_search_index.py [--out-dir DIR] [--max-kb N]` |
| **`selfcheck.py`** | 交付门槛：`verify_data` → `tsc --noEmit` → `vite build` → `check_offline` → 分包与分片取证 → 起本地静态服务 → 跑 `selfcheck_probe.mjs` → 逐条打印 71 项，任一失败退出码非 0 | **已生成**（批 3，批 3.5/4 扩项）。跑法 `python tools/selfcheck.py [--skip-build] [--keep-server] [--fps 45]`；报告落 `_work/selfcheck-report.json`（含 gate / 探针逐项 / offline / bundle 四块），截图落 `_work/shots-batch35/`。依赖 Node + `playwright-core` + 本机 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）；样本由 `pick_samples()` / `pick_diagram_samples()` / `pick_search_samples()` 从 `data/bodies/` 现选，不写死书名。**必须完整重跑**：`--skip-build` 复用旧 `dist/`，本批改动（检索文案、返程落点、CSS 溢出修复）不会被验证到 |
| `selfcheck_probe.mjs` | 上一条的浏览器探针（无头 Edge，桌面 1440×900 + 移动 390×844 两个 context），71 条断言 | 已生成（批 3，批 3.5/4 扩项）。经 `window.__zhishu` 诊断接口驱动，不吃 DOM 结构细节；`PROBE_BASE` / `ZHISHU_SAMPLES` 由 Python 侧注入。mermaid 分包取证不吃名字正则——chunk 名单由 `bundle_evidence()` 从构建产物算出后经 `samples.mermaidChunks` 注入 |

## 目录发现的两阶段策略（2026-11-24 定）

- **探路阶段（本轮 `--probe`）**：用 GitHub trees API，`?recursive=1`，一共 3 次请求就能拿到整棵树，
  靠它定位 manifest 所在子目录（如 `01-Hello-AI人工智能导论/manifest.json`）。
- **全量阶段（`--all`）**：**不用 trees API**。未授权限额 60 次/小时，47 站必爆。
  改为 raw 逐路径试探 + `docs/sites.md` 内置候选路径表（`extract.py` 的 `CANDIDATE_PATHS`）。
  代价：候选表没覆盖到的目录命名会退化，必须按 `contentLevel` 记进 `data/_report.json`。

## 仓库拉取三档策略（2026-11-24 定，`clone_repos.sh`）

仓库清单读 `_work/site_repos.json`（50 站），产物落 `_work/repos/`（`.gitignore` 已忽略）。一律禁止的是**无限制全量 clone**，
按大小与所需内容分三档：

| 档 | 适用 | 命令要点 | 检出内容 |
|---|---|---|---|
| 一档 | **< 50MB**（默认档，含未标注大小的站） | `git clone --depth 1 --single-branch` | 整仓，正文 `.md` 直接读本地 |
| 二档 | **50–100MB** | `git clone --depth 1 --single-branch --filter=blob:none --sparse` + `git sparse-checkout set /*` | 至少含**根目录**，需要子目录再 `sparse-checkout add` |
| 三档 | **> 100MB，或只需要根目录的站** | `--filter=blob:none --no-checkout` + `sparse-checkout init --no-cone` | 只取 `*.md *.json *.csv *.txt`：大仓按任意深度；仅根目录的加前导 `/`。**明确不含 `*.html`** |

`*.html` 不拉是认过代价的：知枢的 `.html` 与 `BOOKS[slug].rendered`、sudoku 的 `ZS.*` 正文同源，
公式被烤成 KaTeX 节点并绑死字号配色，反解析成本高、收益低（详见 `docs/pitfalls.md` 已验证 15）。

点名归属（2026-11-25 实测复核后）：**`ACM-XCPC-Notes`（481MB）、`kaoyan-math-66000`、
`CourseVault-OfflineCourseMap` 三站全部走 three-big**（任意深度取 `*.md *.json *.csv *.txt`）——
`kaoyan` 虽只 38MB，但按「只需根目录」归三档时只落地 2 个文件，放宽后是 75 个，所以根目录规则对它不成立；
`TIER3_ROOT` 目前为空，仅作为「确实只需根目录」的备用档。`ai-enlighten` 17MB 走一档，未标注大小的站默认一档。

**硬约束（写进脚本 `FORCE_FULL`）**：`hello-ai-zhishu` 的正文在 `01-Hello-AI人工智能导论/` 子目录，
**任何稀疏规则都不得把它排除**——该站强制一档整仓浅克隆（实测树内 133 文件，成本可忽略）。
同类风险站：manifest 在子目录的都必须在检出规则里保住那个子目录，否则 `full` 站会被误判成 `stats-only`。

脚本侧约定：已存在则 `SKIP` 不覆盖；单站失败记 `FAIL` 后继续，不中断；`--dry-run` 只打印档位与命令，
不发起网络请求、不改写 `_work/_clone_report.txt`。

> **与正文回读口径的关系（待你确认后统一）**：`docs/schema.md` 第三节目前写的是「`.md` 走 raw 回读 + 3 并发 + 缓存 + 断点续传」。
> 已克隆到本地的站其实可直接读盘（零请求、零限速），raw 应退为「未克隆/克隆失败站」的兜底路径。
> 本轮只登记拉取策略，未改 §三 的主备顺序。

### 旧进程已拉部分的档位复核（2026-11-24 记）

**`tools/clone_repos.sh` 是本轮重写的，与 22:53 起在后台跑的旧版不是同一套逻辑**，已落地的克隆必须逐站复核后才可用于批 1：

| 差异点 | 旧版 | 新版 |
|---|---|---|
| 分支 | 只有两分支：白名单（`ACM-XCPC-Notes`、`CourseVault-OfflineCourseMap`）稀疏，其余一律 `--depth 1` 整仓 | 四档判定（一档 / 二档 / 三档大仓 / 三档仅根目录） |
| 大小阈值 | **50MB、100MB 阈值完全没生效** | 按阈值分档 |
| 子目录保护 | 无 `FORCE_FULL`，`sparse-checkout set '/*'` 会把子目录正文全排除 | `hello-ai-zhishu` 一类正文在子目录的站强制一档 |
| 报告文件 | 每次运行 `> _clone_report.txt` **清空历史** | 同样追加式写入，但 `--dry-run` 不碰报告 |

实测状态（2026-11-24 23:12–23:18 只读采集，未发起网络请求、未删改任何目录）：
`_work/repos/` 已有 **35 个仓库目录**（本轮观测从 11 增至 35，进程仍在写）；`_work/_clone_report.txt`
当前只剩 **1 条 OK、21 条 SKIP、0 条 FAIL/ROOT**，另有 **179 行 git `unable to read sha1 file` 错误**——
说明旧版已跑过第二个 pass 并截断了首轮记录。报错集中在 `kaoyan-math-66000` 的 `work/manifest/*` 与
`01-tixing-6000`、`02-gaoshu-15000` 等分册路径，**该站本地对象库不完整，产物不可用于抽取**。
另两点异常：`kaoyan-math-66000` 是 35 站中唯一 `core.sparseCheckout=true` 的，但它不在旧版白名单里，来源待查；
`ACM-XCPC-Notes`、`CourseVault-OfflineCourseMap` **尚未克隆**。

复核方法（每站一遍，全部只读）：

| 步 | 命令 | 判据 |
|---|---|---|
| 1 | `find _work/repos -maxdepth 1 -type d` | 已落地清单；目录数会随后台进程变，记录时间戳 |
| 2 | `git -C _work/repos/<r> config --get core.sparseCheckout` | `true` = 稀疏；空或 `false` = 整仓 |
| 3 | `git -C _work/repos/<r> fsck --no-progress` 或看 `_clone_report.txt` 有无该站 `error:` | 有 `unable to read sha1 file` = 对象库损坏，**必须删除重拉** |
| 4 | **体积不以本地 pack 为准**：稀疏克隆的 pack 只含已取 blob（实测 `kaoyan-math-66000` pack 仅 3.74MiB，而仓库标注 38MB） | 用 `docs/sites.md` 标注的 MB 值判档；无标注的按未探到处理，先查再定 |
| 5 | 结果写 `_work/clone_tier_audit.txt`（新文件，不覆盖 `_clone_report.txt`） | 每站一行：`repo 实际形态 应属档 处置` |

阈值照上文三档：< 50MB 一档；50–100MB 二档；> 100MB 或只需根目录 三档。

处置口径：整仓误拉的**大仓**（> 100MB）删除重拉三档；中仓误整仓的按二档 `sparse-checkout set /*` 收敛；
对象库损坏的（第 3 步命中）一律删除重拉，不接受半份数据；正文在子目录的站必须是一档、或稀疏规则显式含该子目录。

#### 复核已执行（2026-11-25 09:15，50 站全量，只读 + 一次稀疏放宽）

明细见 `_work/clone_tier_audit.txt`（人读表）与 `_work/clone_tier_audit.json`（机读），汇总结论已写入
`docs/probe-report.md` 第十节。要点：

- 50 仓树内合计条目 15,422、`.md` 3,703、`.json` 1,457；**`manifest.json` 共 131 份，只有 25 个站有**（根目录 2 / 一级 100 / 二级 29）——
  所以抽取单元改成「一份 manifest = 一本书」，见 `docs/schema.md` 第一节。
- `kaoyan-math-66000`：两次放宽都做了。`'*.md' '*.json'` 让已检出从 2 → 48（pack 35.26 → 205.54 KiB）；
  再按新清单加 `'*.csv' '*.txt'`，已检出 **48 → 75**（md 28 + json 20 + **csv 19 + txt 8**），
  pack **386.76 KiB**，`git fsck` 无输出〔K〕。**但档位结论要翻**：19 个 csv 共 3,613 行的表头是
  `q,page,verdict,note,time` 与 `qno,册内编号,页,题干核对,答案核对,校勘位置`——**校对台账，不是题面**；
  json 全是流水线元数据（`waves.json`、`inventory.json`、`q2p`/`p2q`），题面只在 201 个 `.html` 里。
  所以该站判 **`stats-only`**（不是原先预判的 degraded），见 `docs/pitfalls.md` 已验证 14。
  定界符顺带验完：台账文本 `$...$` 149 处、`\(...\)` 332 处〔K〕，完好。
- `ACM-XCPC-Notes`：**无需重拉**。树内 `.md` 只有 1（`README.md`）、`.json` 只有 1（`assets/data.json`，在一级子目录），
  any-depth 规则两个都已落地；该站 481MB 的主体是 cpp 1,482 / pdf 282 / ppt 279 / doc 180，**没有知枢正文**，判 stats-only 候选。
- `CourseVault-OfflineCourseMap`：**已重拉（三档判定的第三次验证）**。根目录规则下工作树只有 1 个文件、pack 201.97 KiB；
  放宽到 `*.md *.json *.csv *.txt` 后 → **1,186 个文件、工作树 32,524,990B、pack 1.05 MiB**，
  所以 root-only **确实是错的判定**（体积没停在「本来就这么小」）〔K〕。
  但收益里 **126 个文件占 31,175,207B（95.8%）是 `notes/<课程>/static_shared/mathjax/hi.*.json` 这种
  MathJax i18n 重复包**，不是课程数据；真数据是每门课的 `content_map.json`（32,595B）与
  `video_galleries/**/data.json`（59,843B）〔K〕。
  因此三档规则加了目录级排除（非 cone 的 `!` 前缀）：`!/**/static_shared/**`、`!/**/node_modules/**`、`!/**/vendor/**`，
  排除后 **1,046 个文件 / 1,372,900B**〔K〕。该站仍无 `manifest.json`，所以是 stats-only + `pendingSources`，
  要收录得写课程目录适配器。
- `*.html` 不进三档清单，是认过代价的决定：成品 HTML 的公式绑死字号与配色，反解析成本高、收益低
  （`docs/pitfalls.md` 已验证 15）。代价就是 kaoyan 这类「数据只在 html」的站只能 `stats-only`。
- 环境提醒：本机 `git config --global http.sslVerify` = **false**（仓库级同值）。旧脚本逐次 `-c http.sslVerify=true` 是对的，
  手动跑 git 时会看到「TLS certificate verification has been disabled」告警；**`extract.py` 若调 git 必须显式带 `-c http.sslVerify=true`**，
  本轮未改动任何 git 配置。

## 正文分级与回读（2026-11-24 定）

契约定义在 `docs/schema.md` 第三节，这里只写脚本侧怎么执行：

| `contentLevel` | 判定条件 | 抽取动作 |
|---|---|---|
| `full` | manifest 解析成功 **且** `chapters[].file` 指向的 `.md` 在文件树里存在 | 回读 `.md`，`bodyType: "md"`，正文存 Markdown 原文 |
| `degraded` | manifest 解析成功但无可回读的 `.md`，只有内联 `rendered` / `ZS.*` | 取内联正文，`bodyType: "html"`，如实标降级 |
| `stats-only` | 只有计数，或解析/求值失败 | 不写正文，`_report.json` 记卡在哪一步 |

回读 `.md` **走 raw，不计 API 限额**（限额只打在 `api.github.com`，尤其 trees），但必须限速：

- 并发上限 **3**，超出排队；失败退避重试 2 次，沿用本轮的 `TIMEOUT = 20` / `RETRIES = 2`
- 一律走 `_work/cache/`，键仍是 `sha1(url)`，与结构抓取共用同一份缓存，不另建目录
- **断点续传**：`_work/state/fetch-state.json` 记 `{url: {ok, bytes, at}}`，重跑跳过 `ok: true` 的条目；
  中断后不清空、不从头再来；已入库的正文不允许被更差的结果覆盖
- 单站回读失败只降该站等级、记 `_report.json`，不中断整体
- 量级参考：实测 hello-ai 86 个 `.md` 359,431B、math-physical 87 个 579,403B〔T〕；契约只取 `chapters`+`concepts`
  指向的文件，约 70–75 个/站。47 站全量二次抓取量级 2,000–3,800 请求，raw 的实际限速阈值本轮未压测

## 约束

- 抓取必须禁用系统代理：`OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))`
  （传空 dict，不是 `None`）
- 中文文件名与目录必须 `urllib.parse.quote` 编码，逐段编码后再拼 `/`
- 单站失败不中断，记入 `data/_report.json`
- 不写死站名清单，从 `docs/sites.md` 或内置列表读取，便于增删
- 输出必须是 UTF-8 无 BOM
- 响应缓存 `_work/cache/<sha1(url)>.bin` + `.meta.json`，缓存名用 URL 哈希而非裸站名；
  `_work/` 已在 `.gitignore`，`--no-cache` 强制重抓
- `--probe` 零写入 `data/` 与 `docs/`，只打印
- 取内联容器时**不取「首个括号」**：像 `ZS.lessons = (ZS.lessons || []).concat([…])` 会先撞上 2 字节的空数组，
  要取窗口内配平后最长的那个（见 `docs/pitfalls.md` 已验证 11）
- 字段映射走别名表（`docs/schema.md` 第四节），表外的键名记 `_report.json`，不猜、不静默丢弃
- 数据源固定 `manifest.json` 文件侧，内联副本只作对账：两边 `quizzes[].id` 命名空间不同（`q01` ↔ `ch00-q01`）
- `contentLevel` 由抽取器判定并写库，宁低不高；判定不出按 `stats-only`
- 统一 schema 的抽取来源字段叫 `origin`，不叫 `source`——数据里的 `source` 是原书出处，保留为 `bookSource`

## 用法（预期）

```bash
python tools/extract.py --probe            # 只探 3 个代表站，打印结构差异
python tools/extract.py --probe --json     # 同一结果以 JSON 打到 stdout
python tools/extract.py --probe --no-cache # 忽略缓存重抓
python tools/extract.py --all --bodies --out-dir _work/data-dry   # 全量抽取（验证用，不碰 data/）
python tools/extract.py --all --bodies --link-policy strip        # 真外链降级为纯文本（默认 keep 只记录）
python tools/extract.py --all --dry-run    # 只算不写，看条目与分级
python tools/extract.py --all --limit 12   # 试跑前 12 本
python tools/extract.py --all --repo hello-ai-zhishu --bodies     # 单仓重抽
python tools/extract.py --all              # 正式产出到 data/（批 1 定稿后再跑）
bash tools/clone_repos.sh --dry-run        # 只打印每站档位与命令，不联网、不写报告
bash tools/clone_repos.sh                  # 按三档拉取到 _work/repos/
python tools/verify_data.py                # 校验产出：五类 23 项断言（含 contentLevel、数组长度、检索分片）
python tools/build_search_index.py         # 生成批 4 检索分片 data/dist/search-<area>.json（只读 sites/manifest，不碰 bodies）
python tools/check_offline.py --json _work/offline-report.json   # 构建后静态扫描 dist/ 远程引用
python tools/selfcheck.py                  # 交付门槛全跑（含 build，别加 --skip-build）
```

检索分片约定：`build_search_index.py` 是 `data/dist/search-*.json` 的唯一生产者，业务代码只读；
要改字段就改这个脚本，再跑 `verify_data.py` 对账，不手改 JSON，也不重跑 `extract.py`（批 4 硬约束：
`data/bodies`、`data/sites`、`data/dist/` 已有的 5 片结构分文件一律不动，也不新增 `data/` 一级子目录）。

抽取器约定：主路径读 `_work/repos/`，读不到才走 raw（3 并发 + `_work/cache/` + `_work/state/fetch-state.json` 断点）；
调 git 一律带 `-c http.sslVerify=true`（本机全局该值为 false）；`_archive`/`_backup`/`旧版`/`deprecated` 路径的 manifest 排除并记
`_report.json` 的 `excludedManifests`；同仓库 slug 冲突跳过后者并记 `slugCollisions`，不静默覆盖。
正文 URL 由 `classify_links()` 按铁律白名单分流（`xmlns` 属性 / 围栏代码块内 / `example.*`·`localhost`·`127.0.0.1` 保留域名），
命中记 `links.allowed`，未命中逐条记 `externalLinks`（origin 路径 + 行号 + 160 字上下文）；
无 manifest 但有结构化文件的站记 `pendingSources`（含 csv/txt/json/html/md 计数），不当作成功产出。

探路结论见 `docs/probe-report.md`。
