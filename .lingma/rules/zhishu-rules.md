---
name: zhishu-rules
description: 知枢矩阵项目的强制约束，所有任务都必须遵守
---

# 知枢矩阵 · 铁律

## 渲染

- 公式一律 KaTeX：行内 `$...$`，独立 `$$...$$`。禁止用反引号包裹公式，禁止用图片代替公式。
- **渲染结果不得在运行时发起任何网络请求**（原「零 CDN」表述已废止——它会把 XML 命名空间声明误判成违规）。
  判定标准是「会不会真的发请求」，以下三类白名单不算违规：
  1. `xmlns` / `xmlns:xlink` 命名空间声明（内联 SVG 必需，浏览器不会去取这个地址）；
  2. 代码块或示例数据内的 URL（围栏代码块、`<pre>`、JSON 字面量里的字符串，属被展示的内容）；
  3. 保留域名：`example.com`、`example.org`、`example.net`、`localhost`、`127.0.0.1`、`0.0.0.0`（IANA 保留，不解析到真实服务）。
- 白名单之外才算违规：运行时资源（脚本、样式、字体、图片、接口）一律本地化到 `vendor/`，不引用任何远程源。
  正文里的**真外链**（如公众号文章）降级成纯文本——保留显示文字、去掉可点击的 href、加标记「原文链接，离线不可达」，
  并逐条记入 `data/_report.json` 的 `externalLinks`（路径 + 上下文一行）。抽取器用
  `tools/extract.py --link-policy strip` 执行，`keep` 只记录不改正文。
- 知枢产物里大量行内公式写成 `\(...\)`：KaTeX 需同时开启该定界符，或抽取时统一转成 `$...$`，两种都要保留原文。
- Mermaid 图用本地 vendor 渲染，不用 CDN。

## 移动端

- 390px 视口下 `document.documentElement.scrollWidth` 必须等于 390，无横向滚动。
- 表格在窄视口不得溢出容器，需要横向滚动时用独立的滚动容器。
- 触屏设备（`matchMedia('(pointer: coarse)')`）或宽度 < 768px 时，3D 场景自动渲染 2D SVG 版本，不得白屏或卡死。

## 数据

- `data/manifest.json` 与 `data/sites/*.json` 由 `tools/extract.py` 产出，业务代码只读不写。要改格式就改抽取器，不要手改 JSON。
- `concepts[].prerequisites` 抽不到时留空数组，禁止推测或编造前置关系。
- 抽取失败必须记录到 `data/_report.json`，不得静默跳过。

## AI 生成内容

- 必须显著标记「AI 现场生成 · 未经校验」。
- 不加入依赖图，不进入诊断链，不与库内内容混排而不加区分。
- 生成结果写入数据库，字段含 `source: 'ai-generated'`。

## 交付

- 每个批次结束前自检：公式渲染、390px 无溢出、控制台无错误。
- 不改动 `data/` 原始数据来「让演示好看」。

## 自主决策授权

仅以下五类必须停下等确认：
1. 删除或覆盖已 git 跟踪的文件
2. 改 schema 字段名、删字段、改字段类型
3. push / force push / 任何远端写操作
4. 花 Credits 或调付费 API
5. 改目录结构（拆解或合并 data/ 的一级子目录）

其余一律自行决定，按「最小改动 + 可回退」原则选，写进 _work/decisions.md，不停。
