#!/usr/bin/env bash
# 批 1 源码拉取：zrx-11 名下站点按「三档策略」clone 到 _work/repos/。
#
# 档位规则（口径与 docs/pitfalls.md 待验证 4、docs/sites.md 第八节一致）：
#   一档 < 50MB                ：git clone --depth 1 --single-branch，整仓浅克隆，正文 .md 直接读本地
#   二档 50–100MB              ：加 --filter=blob:none --sparse，至少含根目录，按需再 git sparse-checkout add
#   三档 > 100MB 或只需根目录  ：稀疏检出，只取 *.md 与 *.json（大仓按任意深度；只需根目录的按 /*.md /*.json）
#
# 硬约束：hello-ai-zhishu 的正文在 01-Hello-AI人工智能导论/ 子目录，
#         任何稀疏规则都不得把它排除掉 —— 该站强制走一档整仓浅克隆（实测树内 133 文件）。
# 未标注大小的站点按一档处理（多数为小仓）；clone 失败不中断，记 FAIL 后继续，批 1 可退回 raw 逐文件。
# 产物目录 _work/ 已在 .gitignore；本脚本默认不覆盖已存在的克隆。
#
# 用法：
#   bash tools/clone_repos.sh --dry-run    # 只打印每站将执行的档位与命令，不联网
#   bash tools/clone_repos.sh              # 实际拉取
#   OWNER=zrx-11 bash tools/clone_repos.sh # 换 owner（默认 zrx-11）
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/_work"
REPOS_DIR="$WORK/repos"
LIST="$WORK/site_repos.json"
REPORT="$WORK/_clone_report.txt"
OWNER="${OWNER:-zrx-11}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# 档位归属：一档为默认，下面只列非默认的站
# 2026-11-24 用 _work/clone_tier_audit.txt（50 站 ls-tree 实测）复核后调整：
#   kaoyan-math-66000   树内 868 条目含 md 28 + json 20，根目录规则只落地 2 个 → 改 three-big（实测放宽后 48 个全到，pack 35.26KiB→205.54KiB）
#   CourseVault-OfflineCourseMap 树内 md 20 + json 1,159，根目录规则只落地 1 个 → 归 three-big，待重拉
#   ACM-XCPC-Notes      481MB 走三档；树内 .md 仅 1（README.md）+ .json 仅 1（assets/data.json，在一级子目录），
#                       所以只有 any-depth 规则才能两个都拿到，归 three-big；正文实为 135 个 .html 与 40 个 .txt，非知枢结构
TIER2=""                                        # 50–100MB：blob:none + sparse（含根目录）
TIER3_BIG="ACM-XCPC-Notes kaoyan-math-66000 CourseVault-OfflineCourseMap"  # 稀疏取任意深度的 *.md *.json
TIER3_ROOT=""                                   # 只需根目录：稀疏取 /*.md /*.json（当前无站归属）
FORCE_FULL="hello-ai-zhishu"                   # 硬约束：正文在子目录，禁止稀疏

tier_of() {
  local r="$1"
  case " $FORCE_FULL " in *" $r "*) echo "one(forced)"; return;; esac
  case " $TIER3_BIG " in *" $r "*) echo "three-big"; return;; esac
  case " $TIER3_ROOT " in *" $r "*) echo "three-root"; return;; esac
  case " $TIER2 " in *" $r "*) echo "two"; return;; esac
  echo "one"
}

[ -d "$REPOS_DIR" ] || { echo "缺目录 $REPOS_DIR，先 mkdir -p" | tee "$REPORT"; exit 1; }
[ -f "$LIST" ] || { echo "缺仓库清单 $LIST" | tee "$REPORT"; exit 1; }
cd "$REPOS_DIR" || exit 1

REPOS=$(python -c "import json,sys;print(' '.join(json.load(open(sys.argv[1],encoding='utf-8'))))" "$LIST")
[ "$DRY" = 1 ] || : > "$REPORT"

run() {  # run <repo> <描述> <git 命令...>
  local r="$1"; shift
  local desc="$1"; shift
  if [ "$DRY" = 1 ]; then
    printf 'DRY   %-34s %s\n' "$r" "$desc"
    return 0
  fi
  if [ -d "$r/.git" ]; then
    echo "SKIP  $r (已存在)" | tee -a "$REPORT"
    return 0
  fi
  if git -c http.sslVerify=true "$@" "https://github.com/$OWNER/$r.git" "$r" 2>>"$REPORT"; then
    echo "OK    $r ($desc)" | tee -a "$REPORT"
  else
    echo "FAIL  $r ($desc)" | tee -a "$REPORT"
  fi
}

for r in $REPOS; do
  tier=$(tier_of "$r")
  url="https://github.com/$OWNER/$r.git"
  case "$tier" in
    one|one\(forced\))
      run "$r" "一档 depth=1 整仓" clone --quiet --depth 1 --single-branch
      ;;
    two)
      run "$r" "二档 blob:none+sparse" clone --quiet --depth 1 --single-branch --filter=blob:none --sparse
      [ "$DRY" = 1 ] || git -C "$r" sparse-checkout set /* 2>>"$REPORT"
      ;;
    three-big)
      run "$r" "三档大仓 稀疏 *.md *.json" clone --quiet --depth 1 --single-branch --filter=blob:none --no-checkout
      if [ "$DRY" = 0 ]; then
        git -C "$r" sparse-checkout init --no-cone 2>>"$REPORT"
        git -C "$r" sparse-checkout set '*.md' '*.json' 2>>"$REPORT"
        git -C "$r" checkout HEAD -- . 2>>"$REPORT"
      fi
      ;;
    three-root)
      run "$r" "三档仅根目录 /*.md /*.json" clone --quiet --depth 1 --single-branch --filter=blob:none --no-checkout
      if [ "$DRY" = 0 ]; then
        git -C "$r" sparse-checkout init --no-cone 2>>"$REPORT"
        git -C "$r" sparse-checkout set '/*.md' '/*.json' 2>>"$REPORT"
        git -C "$r" checkout HEAD -- . 2>>"$REPORT"
      fi
      ;;
  esac
done

if [ "$DRY" = 1 ]; then
  echo "--- dry-run：未发起任何网络请求，报告文件未改写 ---"
  exit 0
fi

echo "--- summary ---" | tee -a "$REPORT"
for tag in OK ROOT SKIP FAIL; do
  grep -c "^$tag" "$REPORT" | xargs echo "$tag:" | tee -a "$REPORT"
done
