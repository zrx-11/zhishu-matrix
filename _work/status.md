# 当前：批 2 启动（3D 场景骨架）

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| 批 1 抽取器主体 | done | `tools/extract.py`（--all / --bodies / --link-policy） | 无 |
| 批 1 数据产出 | done | `data/` 265 文件：sites 129 / bodies 129 / dist 5 / manifest / _report | 无 |
| 三个 commit | done | 2f067ec 代码文档、1bee302 gitattributes、d60b318 data | 无 |
| 回写协议 | done | `_work/{last-result,status,decisions}.md` + rules 授权节 | 无 |
| 三档拉取复核 | done | `_work/clone_tier_audit.txt/.json`；CourseVault 已重拉并排除 vendor | 无 |
| 批 2 · 3D 骨架 | doing | `src/` + `package.json`，六区 + 大厅 | 无 |
| 批 3 阅读层 | pending | 正文渲染（KaTeX / bodyType 分流） | 真外链是否入库时就 strip |
| 批 4 检索层 | pending | MiniSearch + 分片 | 无 |
| 批 5 生成层 | pending | Agent App + 落库 | 无 |
| 批 6 打包发布 | pending | Sites 发布 + 离线自检 | 无 |
| 远端 push | blocked | 当前 `git remote -v` 为空 | 等用户建远端后再 push（属必须停的一类） |

## 下一步

阶段 3：Vite + TS + Three.js 建六区与大厅骨架，逐条过完成判据（帧率、双视口无横向滚动、进出站点状态保持、390 单指拖拽）。
