#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线体检：静态扫描构建产物里出现的远程 URL，判定标准是「会不会真的发请求」。

    python tools/check_offline.py                     # 扫 dist/，打印结论
    python tools/check_offline.py --json out.json     # 另存机器可读报告
    python tools/check_offline.py --root build        # 换产物目录
    python tools/check_offline.py --all               # 连同源数据文件一起细列（默认只计数）

三类白名单（.qoder/rules/zhishu-rules.md 铁律 2）：
  1. xmlns 命名空间声明          → 浏览器不会去取这个地址
  2. 代码 / 数据字面量里的 URL    → 围栏代码块、<pre>、JSON 字符串、JS 字符串常量，属被展示或被引用的内容
  3. 保留域名                   → example.com/.org/.net、localhost、127.0.0.1、0.0.0.0

真违规只有一种：**资源加载位点上的远程 URL**——`src=` / `href=` / `url()` / `@import` /
`fetch(` / `new Worker(` / `importScripts(` 这类会驱动网络请求的位置。命中即退出码非 0。

产物里的数据分片以 `<name>.json.gz` 落盘（批 6 阶段 B 预压），扫描时先解压再比对，覆盖率与明文一致。
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RESERVED_HOSTS = {
    "example.com", "example.org", "example.net",
    "localhost", "127.0.0.1", "0.0.0.0", "::1", "localho.st",
}

# 资源加载位点：URL 左边出现这些片段，就说明它真的会被浏览器拿去请求
LOAD_PATTERNS = [
    r"(?:src|href|srcset|xlink:href|data|poster|action|background|codebase)\s*=\s*[\"']?\s*$",
    r"(?:src|href|srcset|xlink:href|data|poster|action)\s*[:=]\s*$",
    r"url\(\s*[\"']?$",
    r"@import(?:\s+once)?\s+(?:url\()?\s*[\"']?$",
    r"(?:fetch|importScripts|import|require|\.open|xhr\.open)\(\s*[\"'`]$",
    r"new\s+(?:Worker|EventSource|Image|Audio|WebSocket)\(\s*[\"'`]$",
    r"document\.write\(\s*[\"'`]?<\w+\s+src=[\"'`]?$",
    r"(?:protocol|baseURL|baseUrl|cdn|assetRoot)\s*[:=]\s*[\"'`]?$",
]
LOAD_RE = [re.compile(p, re.I) for p in LOAD_PATTERNS]
XMLNS_RE = re.compile(r"xmlns(?::[A-Za-z0-9._-]+)?\s*=\s*[\"']?\s*$")

# 协议相对 //host.tld/…：前一个字符限定为引号/括号/等号/尖括号/逗号/方括号/空白，
# 用零宽后顾把该字符留在匹配之外，避开 JS 行注释与 /* */ 的误报
HIT_RE = re.compile(
    r"""https?://([A-Za-z0-9_~%+.\-]+)"""
    r"""|(?:(?<=["'\(=>,<\[\s]))//([A-Za-z0-9_+.\-]+\.[A-Za-z]{2,})""",
    re.I,
)

# 只统计、不细列的同源数据（抽取产物，业务代码只读，URL 属内容而非加载位点）
DATA_PARTS = {"bodies", "sites", "dist", "raw"}
CODE_EXTS = {".js", ".mjs", ".css", ".html", ".htm", ".svg", ".xml"}
# 批 6 阶段 B：数据落盘预压成 `<name>.json.gz`，扫描前解压再逐字节扫，覆盖率不因压缩下降
GZ_SUFFIX = ".json.gz"


def read_text(path: Path) -> str:
    if path.name.endswith(".gz"):
        return gzip.decompress(path.read_bytes()).decode("utf-8", errors="replace")
    return path.read_text(encoding="utf-8", errors="replace")


def is_data_file(path: Path, parts: set) -> bool:
    name = path.name.lower()
    return name.endswith(".json") or name.endswith(GZ_SUFFIX) or bool(parts & DATA_PARTS)


def host_of(raw: str) -> str:
    h = raw.split("?")[0].split("#")[0].strip(".").lower()
    return h.rsplit("@")[-1]


def is_reserved(host: str) -> bool:
    if host in RESERVED_HOSTS:
        return True
    return any(host == f"www.{r}" or host.endswith("." + r) for r in RESERVED_HOSTS if "." in r)


def classify(text: str, match: re.Match, is_data: bool) -> tuple[str, str, int]:
    """返回 (类别, host, 命中偏移)。类别：load / data-loadable / xmlns / reserved / literal / data"""
    off = match.start(1) if match.group(1) else match.start(2)
    host = host_of(match.group(1) or match.group(2))
    ctx = text[max(0, match.start() - 80): match.start()]
    if is_reserved(host):
        return "reserved", host, off
    if XMLNS_RE.search(ctx):
        return "xmlns", host, off
    if any(p.search(ctx) for p in LOAD_RE):
        return ("data-loadable" if is_data else "load"), host, off
    return ("data" if is_data else "literal"), host, off


def scan_file(path: Path, is_data: bool, all_detail: bool):
    try:
        text = read_text(path)
    except OSError as exc:  # 二进制或读不动，直接跳过内容扫描
        return {"file": str(path), "skipped": str(exc), "hits": [], "counts": {}}
    counts: dict[str, int] = {}
    detail: list[dict] = []
    for match in HIT_RE.finditer(text):
        kind, host, off = classify(text, match, is_data)
        counts[kind] = counts.get(kind, 0) + 1
        if kind in ("load", "data-loadable") or all_detail:
            line = text.count("\n", 0, off) + 1
            ctx = re.sub(r"\s+", " ", text[max(0, off - 60): off + 70]).strip()
            detail.append({"kind": kind, "host": host, "line": line, "context": ctx[:150]})
    return {"file": str(path), "hits": detail, "counts": counts, "bytes": len(text)}


def main() -> int:
    ap = argparse.ArgumentParser(description="构建产物远程 URL 静态扫描")
    ap.add_argument("--root", default=str(ROOT / "dist"), help="产物目录，默认 dist/")
    ap.add_argument("--json", default="", help="把机器可读报告写到该路径")
    ap.add_argument("--all", action="store_true", help="连白名单命中一起逐条列出（默认只列违规）")
    ap.add_argument("--max-detail", type=int, default=40, help="违规明细最多列几条")
    args = ap.parse_args()

    base = Path(args.root)
    if not base.is_dir():
        print(f"产物目录不存在：{base}（先跑 npm run build）", file=sys.stderr)
        return 3

    totals: dict[str, int] = {}
    violations: list[dict] = []
    files_scanned = 0
    data_files = 0
    gz_files = 0
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(base).as_posix()
        parts = set(rel.split("/")[:-1])
        is_data = is_data_file(path, parts)
        if not is_data and path.suffix.lower() not in CODE_EXTS:
            continue
        files_scanned += 1
        data_files += 1 if is_data else 0
        gz_files += 1 if path.name.endswith(".gz") else 0
        res = scan_file(path, is_data, args.all)
        for kind, n in res["counts"].items():
            totals[kind] = totals.get(kind, 0) + n
        for hit in res["hits"]:
            if hit["kind"] in ("load", "data-loadable"):
                violations.append({"file": rel, **hit})

    verdict = "pass" if not violations else "fail"
    print(
        f"扫描 {base}：文件 {files_scanned} 个（其中同源数据 {data_files} 个，"
        f"预压 .gz 透明解压后扫描 {gz_files} 个）"
    )
    order = ["load", "data-loadable", "xmlns", "reserved", "literal", "data"]
    for kind in order:
        if kind in totals:
            note = {
                "load": "资源加载位点的远程 URL —— 违规",
                "data-loadable": "数据里带加载位点形态，由渲染期 sanitize 兜住（运行期请求由自检实测）",
                "xmlns": "白名单 1：命名空间声明",
                "reserved": "白名单 3：保留域名",
                "literal": "白名单 2：代码/字符串常量里的 URL（未出现在加载位点）",
                "data": "白名单 2：抽取产物 JSON 字面量（数据内容，不是引用资源）",
            }[kind]
            print(f"  {kind:14s} {totals[kind]:6d}  {note}")
    if violations:
        print(f"\n违规 {len(violations)} 处：")
        for v in violations[: args.max_detail]:
            print(f"  [{v['kind']}] {v['file']}:{v['line']} {v['host']}")
            print(f"      {v['context']}")
        if len(violations) > args.max_detail:
            print(f"      …另 {len(violations) - args.max_detail} 处，见 --json 报告")
    else:
        print("\n结论：产物中没有任何会在运行时发请求的远程加载位点。")

    if args.json:
        Path(args.json).write_text(json.dumps({
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "root": str(base),
            "filesScanned": files_scanned,
            "dataFiles": data_files,
            "gzFiles": gz_files,
            "counts": totals,
            "violations": violations,
            "verdict": verdict,
        }, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        print(f"报告：{args.json}")
    return 0 if verdict == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
