# 结果：批1 收尾 + 自动化回写协议 + 批2 3D 骨架

## 状态
done

## 做了什么
- `AGENTS.md`、`.qoder/rules/zhishu-rules.md`、`.lingma/rules/zhishu-rules.md`、`docs/pitfalls.md`：铁律 2 由「零 CDN」改为「渲染结果不得在运行时发起任何网络请求」+ 三类白名单（xmlns 声明 / 代码块内 URL / example·localhost 等保留域名），两份 rules 逐字节一致；两份 rules 另追加「自主决策授权」一节（五类必须停）
- `docs/pitfalls.md`：已验证 3 重写为链接分流并带 28 处实测；已验证 8 补 hello-ai「说明 14 章 / manifest 20 章（`ch01`–`ch14` + `t01`–`t06` 专题）」证据；新增已验证 14（kaoyan csv 是校对台账）、15（三档不拉 `*.html` 的代价）
- `docs/schema.md`、`docs/sites.md`、`docs/probe-report.md`：degraded 定义补「可做题、无或极少正文」、`bookSource` 保留原始形态、`_report.json` 必记字段表、`sitesUnique` 96 / 重复组 33、signature 去 title 的差值说明、`sites` 条目数 ≠ 仓库数
- `tools/extract.py`：写入显式 `newline="\n"`；`classify_links()` 白名单分流 + `--link-policy keep|strip` + `externalLinks`/`pendingSources`；signature 改「章节 id 序列 + 计数 + 正文哈希」
- `tools/clone_repos.sh`：三档保留清单加 `*.csv *.txt`、新增 `SPARSE_DROP` 目录级排除、git 调用统一 `-c http.sslVerify=true`
- `.gitignore`：`dist/` → `/dist/`（否则 `data/dist/` 永远进不了库）；`.gitattributes`：追加 `data/** text eol=lf`
- commit：`2f067ec` 代码文档 / `1bee302` 换行符 / `d60b318` data 265 文件 / `e2b32e2` 回写协议与授权
- `data/`：批 1 产物入库（sites 129 / bodies 129 / dist 5 / manifest / _report，15.3MB，最大单文件 ai.json 1.54MB）
- `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src/{main,scene3d,svg2d,layout,data,state,panel,config,types}.ts`、`src/styles.css`：批 2 骨架，六区 + 大厅、2D 降级、进出保态、静止停渲染
- `_work/decisions.md`（24 → 33 条）、`_work/last-result.md`、`_work/status.md`

## 自检
- [x] `src/` 与 `package.json` 建立，`npm run dev`（127.0.0.1:5173）与 `npm run build` + `preview`（4173）均可启动，`tsc --noEmit` 零错
- [x] 六区与大厅均可加载：`math 45 本 / ai 49 / chem 10 / cs 12 / general 13 / tools 0` 全部进入成功；tools 无分片按空分区容错，不白屏
- [x] 控制台零报错：生产页 `list_console_messages` 为空；开发页仅 vite debug 两行。修掉的真实缺陷：`createElement(' span'/'span n')` 抛 InvalidCharacterError 导致面板打不开、`setPointerCapture` 抛错导致 2D 点击失效、`THREE.Clock` 弃用告警
- [x] 10 秒采样平均帧率 ≥45：开发页 164.5（min 154.2）、生产页 165.1（min 164.7），采样源为渲染循环自身帧间隔，采样期持续注入交互（静止 3 秒会按铁律停循环）
- [x] 1440×900 与 390×844 均无横向滚动条：两种视口下 `documentElement.scrollWidth === clientWidth`（1440/1440、390/390），未用 `overflow-x:hidden` 掩盖
- [x] 站点节点可进入、可返回且状态不丢：射线拾取点展台进房间；选书开面板（实测「智能体设计模式…」26 章、badge full）；返回大厅相机位姿 drift=0，面板与 `selection` 均保留（sessionStorage 落盘）
- [x] 390 宽单指拖动可用：`pointer: coarse`/窄视口自动走 2D SVG（不加载 three），单指拖动平移生效（pan 由 0,0 → 43.1,−27.7），全程不依赖双指；单指点击打开详情
- [x] 零运行时外部请求：生产构建资源请求 4 条、全部同源，`foreign = []`（Three.js 由 npm 打进 581KB bundle，不走 CDN）

## 待决策
1. 批 2 骨架（`package.json`/`vite.config.ts`/`tsconfig.json`/`index.html`/`src/`/`dist/` 构建产物）目前未提交——任务书只列了阶段 1–2 的 commit。选项：A 单独提 `feat(scene): 批2 骨架`；B 等批 2 交互层做完一并提。
2. `dist/tools.json` 缺失（6 个工具站全无 manifest）。选项：A 只靠前端容错（现状）；B 重跑 `extract.py` 让抽取器为每个学科写空分片——但会覆盖已 git 跟踪的 `data/**`，属必须停的五类，需明确授权。
3. 真外链 13 条（全为 `mp.weixin.qq.com`）当前 `keep` 只记录、不改正文。选项：A 批 3 渲染层降级为纯文本（正文库保持原样）；B 抽取时 `--link-policy strip` 直接改正文。

## 下一步建议
先定第 1 项提交口径，随即进批 3 阅读层：正文按需加载 `data/bodies/`、`bodyType` 分流渲染、KaTeX 开 `$...$` 与 `\(...\)` 双定界符。
