#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批 3 / 3.5 / 4 完成判据门槛：数据校验 + 离线体检 + 分包证据 + 类型检查 + 构建 + 浏览器自检，逐条打印，任一失败退出码非 0。

    python tools/selfcheck.py                 # 全跑
    python tools/selfcheck.py --skip-build    # 复用已有 dist/
    python tools/selfcheck.py --keep-server   # 跑完留着静态服务，方便手测

依赖：Python 3.10+ 标准库；Node + playwright-core（`npm i -D playwright-core`）+ 本机 Edge。
"""
from __future__ import annotations

import argparse
import gzip
import json
import html
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
DATA = ROOT / "data"
DIST = ROOT / "dist"

# 判据里的中文短语在正文里出现与否，决定探针取哪些样本：一次全库扫（7.4MB，秒级）
SAMPLE_KEYS = ("full", "concept", "weixin", "htmlBody", "mermaid", "degraded", "statsOnly")
# 判据 A3：按库里真实出现的图型各抽一种，≥5 类，缺的类型不硬造
DIAGRAM_KINDS = ("flowchart", "graph", "sequenceDiagram", "mindmap", "xychart-beta")
MERMAID_FENCE = re.compile(r"```mermaid[^\n]*\n(.*?)```", re.S)
SEARCH_PREFIX = "search-"
SEARCH_MAX_KB = 300
DISCIPLINES = ("math", "ai", "chem", "cs", "general", "tools")
MERMAID_IMPL_MARKERS = ("detectType", "getDiagramFromText", "mermaidAPI", "registerLayout", "addDirective")
# 批 6 阶段 C 白名单：库里 0 处使用的图型，其分包名一旦出现在 assets/ 即裁剪没生效
DROPPED_DIAGRAM_RE = re.compile(
    r"classDiagram|stateDiagram|erDiagram|gantt|pie|cynefin|usecase|architecture|gitGraph"
    r"|journey|requirements|sankey|quadrant|timeline-diagram|radar|treemap|packet|block-|kanban|ishikawa|venn"
)
# 批 6 完成判据：dist/ 总体积 ≤ 本轮开始前 22.83MiB 的 60%
DIST_MAX_MIB = 22.83 * 0.6
# 批 7 完成判据：渲染层升级后 dist 总量硬上限（改前实测 9.846MiB，留 2.15MiB 给光照资产）
RENDER_DIST_MAX_MIB = 12.0
# 批 8 完成判据：空间化重构（图集 + 建筑几何 + 拾取映射）后的硬上限，改前实测 9.883MiB
SPACE_DIST_MAX_MIB = 10.6
# 批 10 完成判据：门槛断言只增不减（批 9 收在 98 项，批 10 新增构图/补光/题签 10 条，实测 108 项）
SPACE_ASSERT_MIN = 108


def run(cmd: list[str], cwd: Path = ROOT) -> tuple[int, str]:
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    exe = shutil.which(cmd[0]) or cmd[0]  # Windows 下 npx / npm 是 .cmd，CreateProcess 认不全
    p = subprocess.run([exe, *cmd[1:]], cwd=str(cwd), capture_output=True, text=True, encoding="utf-8", env=env)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def pick_samples() -> dict:
    """从 data/bodies/ 里选真实样本，探针据此点开对应章节。"""
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    by_file = {s["file"]: s for s in manifest["sites"]}
    out: dict[str, dict] = {}
    for base, site in sorted(by_file.items()):
        p = DATA / "bodies" / base
        q = DATA / "sites" / base
        if not (p.exists() and q.exists()):
            continue
        bodies = json.loads(p.read_text(encoding="utf-8"))
        rec = json.loads(q.read_text(encoding="utf-8"))
        chapters = rec.get("chapters") or []
        cmap = bodies.get("chapters") or {}
        slug = site["bookSlug"]
        if site["contentLevel"] == "degraded" and "degraded" not in out and chapters:
            out["degraded"] = {"slug": slug, "file": base, "chapter": chapters[0]["id"]}
        for ch in chapters:
            body = (cmap.get(ch["id"]) or {}).get("body") or ""
            if not body.strip():
                continue
            if "weixin" not in out and "mp.weixin.qq.com" in body:
                out["weixin"] = {"slug": slug, "file": base, "chapter": ch["id"]}
            if "mermaid" not in out and "```mermaid" in body:
                out["mermaid"] = {"slug": slug, "file": base, "chapter": ch["id"]}
            if "htmlBody" not in out and (cmap.get(ch["id"]) or {}).get("bodyType") == "html" and len(body) > 600:
                # 与渲染后 innerText 比长度，得先去掉标签，否则永远达不到阈值
                plain = re.sub(r"<[^>]+>", " ", body)
                plain = re.sub(r"\s+", " ", html.unescape(plain)).strip()
                out["htmlBody"] = {"slug": slug, "file": base, "chapter": ch["id"], "chars": len(plain)}
            if (
                "full" not in out
                and site["contentLevel"] == "full"
                and "$" in body
                and len(body) > 3000
            ):
                out["full"] = {"slug": slug, "file": base, "chapter": ch["id"], "chars": len(body)}
        if "concept" not in out and site["contentLevel"] == "full":
            for cid, entry in (bodies.get("concepts") or {}).items():
                if (entry.get("body") or "").strip():
                    out["concept"] = {"slug": slug, "file": base, "concept": cid}
                    break
        if len(out) >= len(SAMPLE_KEYS):
            break
    fills = [s for s in by_file.values() if s["contentLevel"] == "full"]
    if "statsOnly" not in out and fills:
        out["statsOnly"] = {"slug": fills[0]["bookSlug"], "file": fills[0]["file"]}
    return out


def diagram_kind(src: str) -> str:
    first = next((l.strip() for l in src.splitlines() if l.strip()), "")
    return re.split(r"[\s;{]", first, 1)[0][:24] or "unknown"


def pick_diagram_samples() -> dict:
    """按图型各取一章（判据 A3）。库内实测 flowchart 818 / graph 55 / sequenceDiagram 6 / mindmap 2 / xychart-beta 1。"""
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    by_file = {s["file"]: s for s in manifest["sites"]}
    found: dict[str, dict] = {}
    for base in sorted(by_file):
        p = DATA / "bodies" / base
        if not p.exists():
            continue
        bodies = json.loads(p.read_text(encoding="utf-8"))
        for cid, entry in (bodies.get("chapters") or {}).items():
            body = (entry or {}).get("body") or ""
            if "```mermaid" not in body:
                continue
            for m in MERMAID_FENCE.finditer(body):
                kind = diagram_kind(m.group(1))
                if kind in DIAGRAM_KINDS and kind not in found:
                    found[kind] = {
                        "kind": kind,
                        "slug": by_file[base]["bookSlug"],
                        "file": base,
                        "chapter": cid,
                        "fences": len(MERMAID_FENCE.findall(body)),
                    }
        if len(found) >= len(DIAGRAM_KINDS):
            break
    return found


def pick_search_samples() -> dict:
    """检索样本：一本裸 bookSlug 跨仓重名的书（判据 C3「不吃重名 slug」）+ 每区一条命中词。"""
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    sites = manifest["sites"]
    dup: dict[str, list] = {}
    for s in sites:
        dup.setdefault(s["bookSlug"], []).append(s)
    dup_only = {k: v for k, v in dup.items() if len(v) > 1 and all(x.get("file") for x in v)}
    per_area = {}
    for area in DISCIPLINES:
        for s in sites:
            if s["discipline"] != area or not s.get("title"):
                continue
            rec_path = DATA / "sites" / s["file"]
            if not rec_path.exists():
                continue
            rec = json.loads(rec_path.read_text(encoding="utf-8"))
            ch = next((c for c in (rec.get("chapters") or []) if c.get("title")), None)
            if ch:
                per_area[area] = {
                    "area": area,
                    "file": s["file"],
                    "slug": s["bookSlug"],
                    "title": s["title"],
                    "query": re.sub(r"[：:（）()0-9第章\s]+", "", ch["title"])[:4] or s["title"][:4],
                    "chapter": ch["id"],
                    "books": sum(1 for x in sites if x["discipline"] == area),
                }
                break
    dup_sample = None
    for slug, group in sorted(dup_only.items()):
        titled = [g for g in group if g.get("title")]
        if len(titled) < 2:
            continue
        g = titled[0]
        dup_sample = {
            "slug": slug,
            "file": g["file"],
            "title": g["title"],
            "query": re.sub(r"[：:（）()\s]+", "", g["title"])[:8],
            "twins": sorted(x["file"] for x in titled),
        }
        break
    return {"dup": dup_sample, "areas": per_area, "dupSlugs": len(dup_only)}


STATIC_IMPORT = re.compile(r'(?:^|[;}\s])import\s*(?:\{[^}]*\}\s*from\s*)?"\./([^"]+\.js)"')
DYNAMIC_IMPORT = re.compile(r'import\s*\(\s*["\']\./([^"\']+\.js)["\']')


def bundle_evidence() -> dict:
    """构建期证据（判据 A1/A5、C1/C2）：主 entry 静态不含 mermaid、mermaid 独立分包、
    MiniSearch 打进 entry、检索分片随 publicDir 落到 dist/ 且单片 ≤300KB。"""
    out: dict = {"ok": False}
    index = DIST / "index.html"
    if not index.is_file():
        out["reason"] = "dist/index.html 缺失"
        return out
    m = re.search(r'<script[^>]+src="[^"]*/(index-[\w-]+\.js)"', index.read_text(encoding="utf-8"))
    entry = m.group(1) if m else None
    assets = DIST / "assets"
    out["entry"] = entry
    if not entry or not assets.is_dir():
        out["reason"] = "未找到 entry chunk"
        return out

    def read(name: str) -> str:
        p = assets / name
        return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""

    closure: set[str] = {entry}
    queue = [entry]
    dynamic: set[str] = set()
    out["entryDynamic"] = sorted(DYNAMIC_IMPORT.findall(read(entry)))
    while queue:
        src = read(queue.pop())
        for dep in STATIC_IMPORT.findall(src):
            if dep not in closure:
                closure.add(dep)
                queue.append(dep)
        dynamic.update(DYNAMIC_IMPORT.findall(src))

    mermaid_chunks = sorted(n for n in (assets.glob("*.js")) if re.search(r"mermaid|cytoscape|elk-|cynefin|diagram-", n.name))
    in_closure = sorted(n for n in closure if re.search(r"mermaid|cytoscape|elk-|diagram-", n))
    # mermaid 真身到底包含哪些 chunk：从 mermaid.core 沿静态+动态边闭包展开，再剔掉首屏必载的部分。
    # 探针按这份清单点名取证，比拿 chunk 名正则瞎猜可靠——哈希里能撞出 "c4"、"di" 之类的假阳性。
    mm_seen: set[str] = set()
    mm_stack = [n for n in closure if n.startswith("mermaid.core-")] or [p.name for p in assets.glob("mermaid.core-*.js")]
    while mm_stack:
        name = mm_stack.pop()
        # 首屏必载的（entry 及其静态闭包）是边界：mermaid 子包会反向 import 一个 entry 里的共享助手，
        # 不在此停住就会把 scene3d 之类全卷进「mermaid 分包」，取证失效。
        if name in mm_seen or name in closure:
            continue
        mm_seen.add(name)
        src = read(name)
        mm_stack.extend(STATIC_IMPORT.findall(src))
        mm_stack.extend(DYNAMIC_IMPORT.findall(src))
    out["mermaidSet"] = sorted(mm_seen)
    out["mermaidSetTotal"] = len(mm_seen)
    out["staticClosure"] = len(closure)
    out["mermaidInClosure"] = in_closure
    out["mermaidCore"] = [f"{p.name} {p.stat().st_size / 1024:.0f}KB" for p in assets.glob("mermaid.core-*.js")]
    out["mermaidChunkCount"] = len(mermaid_chunks)
    out["mermaidChunkKB"] = round(sum(p.stat().st_size for p in mermaid_chunks) / 1024)
    core = [p for p in assets.glob("mermaid.core-*.js")]
    core_src = core[0].read_text(encoding="utf-8", errors="replace") if core else ""
    entry_src = read(entry)
    # mermaid 实现体的函数名标记：entry 里出现即说明实现被打进了首屏（我自己的 CONFIG 字面量不算）
    out["entryMermaidImpl"] = [k for k in MERMAID_IMPL_MARKERS if k in entry_src]
    out["coreMermaidImpl"] = [k for k in MERMAID_IMPL_MARKERS if k in core_src]
    out["minisearchIn"] = sorted(p.name for p in assets.glob("*.js") if "autoVacuum" in read(p.name))
    out["minisearchMarker"] = "autoVacuum"

    shard_dir = DIST / "dist"
    shards = {}
    for area in DISCIPLINES:
        # 批 6 阶段 B 起产物落 .json.gz（构建期预压），明文只在 dev 态存在，两种都认
        for name in (f"{SEARCH_PREFIX}{area}.json.gz", f"{SEARCH_PREFIX}{area}.json"):
            p = shard_dir / name
            if p.is_file():
                shards[area] = round(p.stat().st_size / 1024, 1)
                break
        else:
            shards[area] = None
    out["searchShards"] = shards
    out["shardSuffix"] = "json.gz" if (shard_dir / f"{SEARCH_PREFIX}{DISCIPLINES[0]}.json.gz").is_file() else "json"
    # 批 6 阶段 C：白名单外的图型分包不得出现在产物里（出现即裁剪没生效）
    out["droppedLeftovers"] = sorted(
        p.name for p in assets.glob("*.js") if DROPPED_DIAGRAM_RE.search(p.name)
    )
    out["ok"] = (
        not in_closure
        and bool(core)
        and bool(dynamic & {p.name for p in core})
        and not out["entryMermaidImpl"]
        and len(out["coreMermaidImpl"]) >= 3
        and bool(out["mermaidSet"])
        and out["minisearchIn"] == [entry]
        and all(v is not None and v <= SEARCH_MAX_KB for v in shards.values())
        and not out["droppedLeftovers"]
    )
    return out


def dist_size_evidence() -> dict:
    """批 6 阶段 B/C 判据：dist/ 总体积 ≤ 本轮开始前的 60%，并给出分族数字。
    基线 22.83MiB / 391 文件（_work/measure-requests.json 的 distTotalBytes，本轮 build 前实测）。"""
    out: dict = {"baselineMiB": round(22.83, 2), "families": {}}
    if not DIST.is_dir():
        out["reason"] = "dist/ 不存在"
        return out
    tot = 0
    files = 0
    for p in DIST.rglob("*"):
        if not p.is_file():
            continue
        top = p.relative_to(DIST).as_posix().split("/")[0]
        fam = top if top in ("assets", "bodies", "sites", "dist") else ("other/" + top)
        out["families"][fam] = out["families"].get(fam, [0, 0])
        out["families"][fam][0] += 1
        out["families"][fam][1] += p.stat().st_size
        tot += p.stat().st_size
        files += 1
    for k, v in out["families"].items():
        out["families"][k] = [v[0], round(v[1] / 1048576, 2)]
    out["totalMiB"] = round(tot / 1048576, 2)
    out["totalFiles"] = files
    out["ratio"] = round(tot / 1048576 / 22.83, 3)
    # 收敛过的数据族不得再出现明文 .json 拷贝（.json.gz 才是本批形态），也不得再带 _report.json / raw/
    out["plainJsonData"] = sorted(
        p.relative_to(DIST).as_posix()
        for p in DIST.rglob("*.json")
        if p.relative_to(DIST).as_posix().split("/")[0] in ("bodies", "sites", "dist")
    )
    out["leftovers"] = [n for n in ("_report.json", "raw") if (DIST / n).exists()]
    out["ok"] = out["totalMiB"] <= DIST_MAX_MIB and not out["plainJsonData"] and not out["leftovers"]
    return out


def ship_integrity() -> dict:
    """批 6 契约（docs/schema.md 第八节）：产物里的 .json.gz 解压后必须与 data/ 源逐字节等价，
    预压只改传输形态，不许顺手改内容或字段。"""
    out: dict = {"checked": 0, "mismatch": [], "missing": []}
    for fam in ("bodies", "sites", "dist"):
        for gz in (DIST / fam).glob("*.json.gz"):
            src = DATA / fam / gz.name[: -len(".gz")]
            out["checked"] += 1
            if not src.is_file():
                out["missing"].append(f"{fam}/{src.name}")
                continue
            if gzip.decompress(gz.read_bytes()) != src.read_bytes():
                out["mismatch"].append(f"{fam}/{gz.name}")
    # 未压缩族：明文对明文
    for name in ("manifest.json",):
        a, b = DIST / name, DATA / name
        if a.is_file() and b.is_file():
            out["checked"] += 1
            if a.read_bytes() != b.read_bytes():
                out["mismatch"].append(name)
    # 产物不得凭空造源里没有的文件（tools 结构分片批 1 就没产过）
    out["orphan"] = sorted(
        p.relative_to(DIST).as_posix()
        for fam in ("bodies", "sites", "dist")
        for p in (DIST / fam).glob("*.json*")
        if not (DATA / fam / (p.name[: -len(".gz")] if p.name.endswith(".gz") else p.name)).is_file()
    )
    out["ok"] = not out["mismatch"] and not out["missing"] and not out["orphan"]
    return out


def offline_evidence() -> dict:
    """判据 B：统一调 tools/check_offline.py 扫产物远程 URL，违规即门槛不过。"""
    code, out = run([sys.executable, str(TOOLS / "check_offline.py"), "--json", str(ROOT / "_work" / "offline-report.json")])
    rep: dict = {"exit": code}
    try:
        rep.update(json.loads((ROOT / "_work" / "offline-report.json").read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        rep["stdout"] = out.strip()[-400:]
    rep["pass"] = code == 0 and rep.get("verdict") == "pass"
    return rep


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_a):  # 静音，请求由探针统计
        return


def serve(directory: Path) -> tuple[ThreadingHTTPServer, int, threading.Thread]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(Quiet, directory=str(directory)))
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port, t


def main() -> int:
    ap = argparse.ArgumentParser(description="批 3 完成判据自检门槛")
    ap.add_argument("--skip-build", action="store_true", help="不跑 tsc / vite build，复用现有 dist/")
    ap.add_argument("--keep-server", action="store_true", help="自检后保留静态服务（Ctrl+C 退出）")
    ap.add_argument("--fps", type=float, default=45.0, help="10 秒采样帧率下限（默认 45）")
    args = ap.parse_args()
    t0 = time.time()
    results: list[tuple[str, bool, str]] = []

    def record(name: str, ok: bool, info: str = "") -> None:
        results.append((name, ok, info))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {info}" if info else ""), flush=True)

    # 1) 数据门槛
    code, out = run([sys.executable, str(TOOLS / "verify_data.py")])
    record("tools/verify_data.py 五类校验全绿、退出码 0", code == 0, out.strip().splitlines()[-1] if out else f"exit {code}")
    if code != 0:
        print(out[-2000:])

    # 2) 类型检查 + 构建
    if args.skip_build:
        record("tsc --noEmit 零错（--skip-build 跳过）", DIST.exists(), f"复用 {DIST}")
        record("npm run build 成功（--skip-build 跳过）", DIST.exists(), f"复用 {DIST}")
    else:
        code, out = run(["npx", "tsc", "--noEmit"])
        record("tsc --noEmit 零错", code == 0, "" if code == 0 else out.strip()[-1200:])
        code, out = run(["npm", "run", "build"])
        record("npm run build 成功", code == 0 and DIST.joinpath("index.html").exists(),
               "" if code == 0 else out.strip()[-1200:])

    # 3) 离线体检（阶段 B：统一收进门槛，静态扫产物远程 URL）
    off = offline_evidence()
    cnt = off.get("counts") or {}
    record(
        "tools/check_offline.py 产物零运行时远程加载位点",
        off.get("pass") is True,
        f"违规 {len(off.get('violations') or [])} 处 · 白名单 xmlns {cnt.get('xmlns', 0)} / 保留域名 {cnt.get('reserved', 0)} / "
        f"字面量 {cnt.get('literal', 0)} / 数据 {cnt.get('data', 0)} · 文件 {off.get('filesScanned')}",
    )

    # 4) 分包与分片证据
    bun = bundle_evidence()
    record(
        "mermaid 独立分包且不在主 entry 静态图内",
        bool(bun.get("ok")),
        f"entry {bun.get('entry')} · 静态图 {bun.get('staticClosure')} 片 · 闭包内 mermaid {bun.get('mermaidInClosure') or '无'} · "
        f"entry 实现标记 {bun.get('entryMermaidImpl') or '无'}/{bun.get('coreMermaidImpl')} · "
        f"{bun.get('mermaidCore')} 另含 {bun.get('mermaidChunkCount')} 个图型子包共 {bun.get('mermaidChunkKB')}KB",
    )
    record(
        "MiniSearch 打进 entry（不另起分包、不引 CDN）",
        bun.get("minisearchIn") and bun.get("minisearchIn") == [bun.get("entry")],
        f"标记 {bun.get('minisearchMarker')} 仅出现于 {bun.get('minisearchIn')}",
    )
    shards = bun.get("searchShards") or {}
    record(
        f"检索分片六片齐且单片 ≤{SEARCH_MAX_KB}KB（{bun.get('shardSuffix')}，由 zhishu:ship-data 落进 dist/dist/）",
        all(v is not None and v <= SEARCH_MAX_KB for v in shards.values()) and len(shards) == 6,
        " / ".join(f"{k} {v}KB" for k, v in shards.items()),
    )
    dsz = dist_size_evidence()
    record(
        f"dist/ 总体积 ≤ 本轮开始前的 60%（基线 {dsz.get('baselineMiB')}MiB → ≤{DIST_MAX_MIB:.2f}MiB）",
        dsz.get("ok") is True,
        f"实测 {dsz.get('totalMiB')}MiB / {dsz.get('totalFiles')} 文件 · 占比 {dsz.get('ratio')} · 分族 "
        + json.dumps(dsz.get("families"), ensure_ascii=False)
        + (f" · 残留明文数据 {dsz.get('plainJsonData')} / {dsz.get('leftovers')}"
           if dsz.get("plainJsonData") or dsz.get("leftovers") else ""),
    )
    record(
        f"批 7 渲染层上限：dist/ 总体积 ≤ {RENDER_DIST_MAX_MIB}MiB",
        dsz.get("totalMiB") is not None and dsz["totalMiB"] <= RENDER_DIST_MAX_MIB,
        f"实测 {dsz.get('totalMiB')}MiB / {dsz.get('totalFiles')} 文件 · 分族 "
        + json.dumps(dsz.get("families"), ensure_ascii=False),
    )
    record(
        f"批 8 空间化上限：dist/ 总体积 ≤ {SPACE_DIST_MAX_MIB}MiB",
        dsz.get("totalMiB") is not None and dsz["totalMiB"] <= SPACE_DIST_MAX_MIB,
        f"实测 {dsz.get('totalMiB')}MiB（改前 9.883）· 增项是图集绘制 + 建筑几何 + 拾取映射表，零外部资产",
    )
    ship = ship_integrity()
    record(
        "产物 .json.gz 解压后与 data/ 源逐字节等价（预压不改内容）",
        ship.get("ok") is True,
        f"核对 {ship.get('checked')} 个文件 · 不一致 {ship.get('mismatch')[:3] or '无'} · "
        f"源缺 {ship.get('missing')[:3] or '无'} · 产物凭空多 {ship.get('orphan')[:3] or '无'}",
    )

    # 5) 浏览器自检
    samples = pick_samples()
    samples["diagrams"] = pick_diagram_samples()
    samples["search"] = pick_search_samples()
    samples["mermaidChunks"] = bun.get("mermaidSet") or []
    record("样本齐全（full / degraded / 概念 / 微信外链 / mermaid / 成品 HTML）",
           all(k in samples for k in SAMPLE_KEYS), json.dumps({k: v.get("slug") for k, v in samples.items() if k in SAMPLE_KEYS}, ensure_ascii=False))
    record(f"图型样本 ≥5 类（{'/'.join(DIAGRAM_KINDS)}）",
           len(samples["diagrams"]) >= 5, json.dumps({k: v["file"] for k, v in samples["diagrams"].items()}, ensure_ascii=False))
    record("检索样本含跨仓重名书目与逐区关键词", bool(samples["search"].get("dup")) and len(samples["search"]["areas"]) == 5,
           json.dumps({"dup": (samples["search"].get("dup") or {}).get("slug"),
                       "dupSlugs": samples["search"]["dupSlugs"],
                       "areas": {k: v["query"] for k, v in samples["search"]["areas"].items()},
                       "tools": "库内 0 本，无关键词可取，走空片容错断言"}, ensure_ascii=False))
    if not DIST.joinpath("index.html").exists():
        record("dist/index.html 存在", False, "先跑 npm run build")
    elif not all(k in samples for k in SAMPLE_KEYS) or len(samples["diagrams"]) < 5:
        record("探针未跑", False, "样本缺失，先补 pick_samples / pick_diagram_samples 判据")
    else:
        httpd, port, _ = serve(DIST)
        base = f"http://127.0.0.1:{port}"
        env = dict(os.environ, PROBE_BASE=base, ZHISHU_SAMPLES=json.dumps(samples, ensure_ascii=False),
                   PROBE_SHOTS="_work/shots-batch10", PYTHONIOENCODING="utf-8")
        node_exe = shutil.which("node") or "node"
        p = subprocess.run([node_exe, str(TOOLS / "selfcheck_probe.mjs")], cwd=str(ROOT),
                           capture_output=True, text=True, encoding="utf-8", env=env)
        httpd.shutdown()
        if p.returncode == 2 or not p.stdout.strip():
            record("探针完整跑完", False, (p.stderr or p.stdout)[-1500:])
        else:
            try:
                # 探针把完整报告写 _work/selfcheck-report.json，stdout 只给摘要
                rep = json.loads((ROOT / "_work" / "selfcheck-report.json").read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                record("探针报告可解析", False, (p.stdout or p.stderr)[-800:])
                rep = None
            if rep:
                rep["offline"] = off
                rep["bundle"] = bun
                rep["distSize"] = dsz
                rep["ship"] = ship
                (ROOT / "_work" / "selfcheck-report.json").write_text(
                    json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n"
                )
                for c in rep["checks"]:
                    record(c["name"], c["pass"], json.dumps(c["info"], ensure_ascii=False)[:260] if c["info"] not in (None, "") else "")
                for line in rep.get("log", []):
                    print("      ·", line)
                record(
                    f"批 10 门槛断言总数 ≥{SPACE_ASSERT_MIN}（批 9 收在 98 项，本批只增不减）",
                    len(rep["checks"]) >= SPACE_ASSERT_MIN,
                    f"探针断言 {len(rep['checks'])} 项 · 失败 {len(rep.get('failed') or [])} 项",
                )
                fps_vals = [c["info"] for c in rep["checks"] if c["name"].startswith("大厅 10 秒帧率")]
                record(f"10 秒采样帧率 ≥{args.fps:g}（1440×900）", all(isinstance(v, (int, float)) and v >= args.fps for v in fps_vals) and bool(fps_vals), str(fps_vals))
                record("零外部请求（含字体 / CDN / 微信）", not rep["requests"]["external"], str(rep["requests"]["external"][:3]))
                record("正文按需加载：全程 bodies 请求数 ≤ 打开过的本数", rep["requests"]["bodies"] <= 28,
                       f"bodies {rep['requests']['bodies']} 次 / 去重 {rep['requests'].get('bodyFiles')} 本 / 总请求 {rep['requests']['total']}")
                shard_req = rep["requests"].get("searchShards") or []
                record("检索分片实际请求数 ≤6 且逐区一片", len(shard_req) <= 6, f"{len(shard_req)} 片：{[s.split(':')[-1] for s in shard_req]}")
                if rep["failed"]:
                    print(f"\n未过 {len(rep['failed'])} 项：")
                    for f in rep["failed"]:
                        print("  -", f["name"], json.dumps(f["info"], ensure_ascii=False)[:200])

    bad = [r for r in results if not r[1]]
    rep_path = ROOT / "_work" / "selfcheck-report.json"
    try:
        merged = json.loads(rep_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        merged = {"checks": [], "log": [], "failed": []}
    merged["gate"] = [{"name": n, "pass": ok, "info": info} for n, ok, info in results]
    merged["failed"] = (merged.get("failed") or []) + [{"name": n, "info": info} for n, ok, info in bad]
    rep_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(f"\n{'=' * 68}\n自检 {len(results)} 项，通过 {len(results) - len(bad)}，失败 {len(bad)}，用时 {time.time() - t0:.1f}s")
    print("报告：_work/selfcheck-report.json（含 gate 门槛项 + 探针逐项 + offline + bundle + distSize）· 截图：_work/shots-batch10/")
    if bad and args.keep_server:
        print("--keep-server 已指定但自检未过，仍退出非 0")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
