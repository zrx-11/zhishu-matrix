# 结果：批1 收尾 + 自动化回写协议（阶段 1–2）

## 状态
done

## 做了什么
- `AGENTS.md`：铁律摘要第 2 条改为「渲染结果不得在运行时发起任何网络请求」+ 白名单例外
- `.qoder/rules/zhishu-rules.md`、`.lingma/rules/zhishu-rules.md`：渲染节改写为白名单版（两份逐字节一致），追加「自主决策授权」一节
- `docs/pitfalls.md`：已验证 3 重写为链接分流三判据（含 28 处实测），已验证 8 补 hello-ai 14/20 与 `t01`–`t06` 专题证据，新增已验证 14/15
- `docs/schema.md`、`docs/probe-report.md`、`tools/README.md`：sitesUnique 96 / 重复组 33、signature 去 title 的差值说明、三档排除 vendor 目录、CourseVault 第三次验证结论、degraded 定义与 `_report.json` 必记字段
- `tools/extract.py`：写入显式 `newline="\n"`、`classify_links()` 白名单分流、`--link-policy`、signature 改「章节 id + 计数 + 正文哈希」、`pendingSources`
- `tools/clone_repos.sh`：三档保留清单加 `*.csv *.txt`、新增 `SPARSE_DROP` 目录级排除
- `.gitignore`：`dist/` → `/dist/`；`.gitattributes`：追加 `data/** text eol=lf`
- `data/`：265 文件 15.3MB 入库

## 自检
- [x] 三个 commit 按序完成（2f067ec / 1bee302 / d60b318）
- [x] 两份 rules 文件内容逐字节一致
- [x] `data/` 全部 JSON 可解析、0 CRLF、0 BOM，最大单文件 ai.json 1.54MB
- [x] 对账：`sites 129 + excludedManifests 2 = 131 份 manifest`；`repos 50 = 25 + failures 25`
- [ ] 阶段 3 的 3D 骨架六条判据（进行中）

## 待决策
无

## 下一步建议
按阶段 3 建 `src/` 骨架并用浏览器实测六条判据。
