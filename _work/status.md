# 当前：批 2 · 3D 场景骨架完成，待进批 3 阅读层

| 步骤 | 状态 | 产出 | 待决策 |
|------|------|------|--------|
| 阶段 1 · 三个 commit | done | `2f067ec` 代码文档、`1bee302` gitattributes、`d60b318` data 265 文件 | 无 |
| 阶段 2 · 回写协议 + 授权 | done | `e2b32e2`；`_work/{last-result,status,decisions}.md`、两份 rules 追加授权节 | 无 |
| 铁律 2 表述修正 | done | 四处同步：两份 rules、`pitfalls` 已验证 3、`AGENTS.md` 摘要 | 无 |
| kaoyan 数据源 | done | 拉齐 csv 19 / txt 8（pack 386.76 KiB）→ 判定 stats-only（csv 是校对台账，非题库） | 台账里 `\(...\)` 332 处，是否入正文 |
| CourseVault 重拉（三档第三次验证） | done | 1 → 1,186 文件 / pack 1.05 MiB；排除 vendor 后 1,046 文件 / 1.37MB | 是否为其写课程目录适配器 |
| 批 2 · 3D 骨架 | done | `src/` 9 个模块 + 6 个配置/入口文件；六区大厅、2D 降级、进出保态；六条判据全过 | 是否提交（待决策 1） |
| 批 2 · 交互细节 | pending | 小地图 2D 俯视、WASD 平移、走廊地面学科名 | 无 |
| 批 3 · 阅读层 | pending | `data/bodies/` 按需加载、`bodyType` 分流、KaTeX 双定界符、Mermaid 本地 vendor | 外链 strip 时机（待决策 3） |
| 批 4 · 检索层 | pending | MiniSearch（vendor）+ 分片加载 | 无 |
| 批 5 · 生成层 | pending | Agent App + 落库，标「AI 现场生成 · 未经校验」 | 无 |
| 批 6 · 打包发布 | pending | 离线自检脚本 `check_offline.py` + Sites 发布 | 无 |
| 远端 push | blocked | `git remote -v` 为空 | 等远端建好再 push（属必须停的第 3 类） |
| 后台进程 | running | vite dev `127.0.0.1:5173`、preview `127.0.0.1:4173` | 需要时可直接打开验收 |

## 下一步

定批 2 骨架的提交口径后进入批 3：正文按需加载与 `bodyType` 分流渲染，KaTeX 同时开 `$...$` 与 `\(...\)`，Mermaid 走本地 vendor，并把 `check_offline.py` 的扫描规则按新铁律（白名单三类）实现。
