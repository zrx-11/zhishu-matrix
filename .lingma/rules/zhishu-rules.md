---
name: zhishu-rules
description: 知枢矩阵项目的强制约束，所有任务都必须遵守
---

# 知枢矩阵 · 铁律

## 渲染

- 公式一律 KaTeX：行内 `$...$`，独立 `$$...$$`。禁止用反引号包裹公式，禁止用图片代替公式。
- 依赖全部本地化到 `vendor/`。禁止任何 CDN 引用（KaTeX、Mermaid、字体、图标都不例外）。
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
