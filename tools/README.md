# tools/

抽取与校验脚本。全部用标准库 + 可选依赖，不要引入重型框架。

## 依赖（2026-11-24 本机实测）

| 依赖 | 用途 | 缺失时 |
|---|---|---|
| Python 3.12 标准库 | 全部脚本，无第三方包 | 必需 |
| **Node 运行时** | 只有 `sudoku` 一类站需要：`ZS.*` 内联是 JS 字面量（无引号键、模板串、注释、尾逗号），`json.loads` 解不了，用 `new Function('return ' + 字面量)()` 求值 | 该站降为 `contentLevel: "stats-only"` 并记 `_report.json`，**不自动安装运行环境** |

本机 `node --version` = **v24.18.0**，`where node` = `D:\nodejs\node.exe`（2026-11-24 实测）。
Node 只作子进程求值用，抽取器不依赖任何 npm 包；求值脚本随 `extract.py` 内联生成，勿把 `_work/sz_eval.js` 当正式实现。

## 计划中的脚本

| 文件 | 作用 | 状态 |
|---|---|---|
| `extract.py` | 抓 40 站 → 统一 schema → 判 `contentLevel` → 回读正文 → 写 `data/sites/*.json` + `data/manifest.json` + 6 个分片 | 只交付 `--probe`，全量与正文回读待批 1 主体 |
| `probe.py` | 单站探路：打印该站 `index.html` 里内联数据的变量名与结构 | 已并入 `extract.py --probe`，不再单列 |
| `verify_data.py` | 校验产出：字段完整性、计数一致性、分片大小 | 待生成 |
| `check_offline.py` | 构建后扫描 `dist/` 里的远程引用 | 待生成 |

## 目录发现的两阶段策略（2026-11-24 定）

- **探路阶段（本轮 `--probe`）**：用 GitHub trees API，`?recursive=1`，一共 3 次请求就能拿到整棵树，
  靠它定位 manifest 所在子目录（如 `01-Hello-AI人工智能导论/manifest.json`）。
- **全量阶段（`--all`）**：**不用 trees API**。未授权限额 60 次/小时，47 站必爆。
  改为 raw 逐路径试探 + `docs/sites.md` 内置候选路径表（`extract.py` 的 `CANDIDATE_PATHS`）。
  代价：候选表没覆盖到的目录命名会退化，必须按 `contentLevel` 记进 `data/_report.json`。

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
python tools/extract.py --all              # 全量抓取（批 1 主体，未实现）
python tools/extract.py --repo hello-ai-zhishu   # 单站重抓（批 1 主体，未实现）
python tools/extract.py --all --bodies     # 回读 .md 正文（批 1 主体，未实现）
python tools/extract.py --bodies --concurrency 3 --resume   # 限速 + 断点续传（未实现）
python tools/verify_data.py                # 校验产出：含 contentLevel 与数组长度一致性
```

探路结论见 `docs/probe-report.md`。
