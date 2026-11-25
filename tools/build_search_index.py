#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批 4 检索层索引构建器：按学科切 `data/dist/search-<area>.json` 六片。

    python tools/build_search_index.py                 # 生成六片并打印体量
    python tools/build_search_index.py --max-kb 300    # 单片体量上限（默认 300KB）
    python tools/build_search_index.py --data-dir X --out-dir Y   # 对副本试跑，不落库

数据来源只读：`data/manifest.json` 给归属与书目，`data/sites/*.json` 给章节 / 概念 / 术语。
不重跑抽取器、不改 `data/` 已有文件，新增的只有 `search-<area>.json` 这一类文件。

体量递减三档，超上限就逐档降级（任务书 C1「超了就只留章节标题与概念名，丢掉长描述」）：
  full    章节 id + 标题 + core 摘要、概念 id + 名称 + brief 摘要、术语 + 释义
  notitle 章节 id + 标题、概念 id + 名称、术语只留词面
  noTerms 章节 id + 标题、概念 id + 名称（术语整块丢掉，保底不超上限）
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AREAS = ["math", "ai", "chem", "cs", "general", "tools"]
DESC_MAX = 120
TIERS = ("full", "titles-only", "no-terms")


def clip(text: str, limit: int = DESC_MAX) -> str:
    flat = " ".join(str(text or "").split())
    return flat[: limit - 1] + "…" if len(flat) > limit else flat


def load_books(data_dir: Path):
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    by_area: dict[str, list[dict]] = {a: [] for a in AREAS}
    missing = []
    for site in sorted(manifest["sites"], key=lambda s: (s["discipline"], s["file"])):
        area = site["discipline"]
        path = data_dir / "sites" / site["file"]
        if not path.exists():
            missing.append(site["file"])
            continue
        rec = json.loads(path.read_text(encoding="utf-8"))
        by_area.setdefault(area, []).append({
            "slug": rec.get("bookSlug") or site["bookSlug"],
            "file": site["file"],
            "repo": rec.get("repo") or site["repo"],
            "title": clip(rec.get("title") or site["title"], 90),
            "area": area,
            "chapters": [
                {"id": c.get("id"), "title": clip(c.get("title"), 90), "core": clip(c.get("core"))}
                for c in (rec.get("chapters") or [])
                if c.get("id")
            ],
            "concepts": [
                {"id": c.get("id"), "name": clip(c.get("title"), 90), "brief": clip(c.get("brief"))}
                for c in (rec.get("concepts") or [])
                if c.get("id")
            ],
            "terms": [
                {
                    "t": clip(g.get("term"), 60),
                    "d": clip(g.get("def")),
                    # 命中术语后直接跳的那一章；抽不到就只落到书总览，不猜
                    "c": (g.get("chapterIds") or [""])[0],
                }
                for g in (rec.get("glossary") or [])
                if g.get("term")
            ],
        })
    return by_area, missing


def trim_book(book: dict, tier: str) -> dict:
    if tier == "full":
        return book
    out = dict(book)
    out["chapters"] = [{"id": c["id"], "title": c["title"]} for c in book["chapters"]]
    out["concepts"] = [{"id": c["id"], "name": c["name"]} for c in book["concepts"]]
    if tier == "no-terms":
        out.pop("terms", None)
    else:
        out["terms"] = [{"t": t["t"], "c": t.get("c", "")} for t in book["terms"]]
    return out


def shard(area: str, books: list[dict], tier: str, generator_note: str) -> dict:
    return {
        "schemaVersion": 1,
        "area": area,
        "generator": "tools/build_search_index.py",
        "generatedAt": generator_note,
        "source": "data/manifest.json + data/sites/*.json",
        "trim": tier,
        "fields": ["slug", "file", "repo", "title", "area", "chapters", "concepts", "terms"],
        "counts": {
            "books": len(books),
            "chapters": sum(len(b["chapters"]) for b in books),
            "concepts": sum(len(b["concepts"]) for b in books),
            "terms": sum(len(b.get("terms", [])) for b in books),
        },
        "books": [trim_book(b, tier) for b in books],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="按学科生成检索分片索引")
    ap.add_argument("--data-dir", default=str(ROOT / "data"))
    ap.add_argument("--out-dir", default="", help="默认写 data/dist/，指别的目录试跑不落库")
    ap.add_argument("--max-kb", type=int, default=300, help="单片上限，默认 300KB")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir) if args.out_dir else data_dir / "dist"
    if not (data_dir / "manifest.json").exists():
        print(f"缺少 {data_dir / 'manifest.json'}", file=sys.stderr)
        return 3
    out_dir.mkdir(parents=True, exist_ok=True)
    by_area, missing = load_books(data_dir)
    if missing:
        print(f"警告：manifest 有 {len(missing)} 本书的 sites 文件不存在，已跳过 {missing[:5]}", file=sys.stderr)

    note = datetime.now(timezone.utc).isoformat(timespec="seconds")
    limit = args.max_kb * 1024
    rows = []
    worst = ""
    for area in AREAS:
        books = by_area.get(area) or []
        chosen, payload, tier = None, None, TIERS[-1]
        for t in TIERS:
            payload = json.dumps(shard(area, books, t, note), ensure_ascii=False, separators=(",", ":"))
            if len(payload.encode("utf-8")) <= limit:
                chosen, tier = payload, t
                break
        if chosen is None:
            chosen, tier = payload, "oversize"
            worst = f"{area} 降到最省档仍 {len(chosen.encode('utf-8')) // 1024}KB > {args.max_kb}KB"
        name = out_dir / f"search-{area}.json"
        name.write_text(chosen, encoding="utf-8", newline="\n")
        rows.append((area, len(chosen.encode("utf-8")), tier, len(books)))

    print(f"输出目录：{out_dir}（单片上限 {args.max_kb}KB）")
    for area, size, tier, n in rows:
        print(f"  search-{area:8s} {size / 1024:7.1f}KB  {tier:11s} 书目 {n}")
    if worst:
        print(f"\n失败：{worst}", file=sys.stderr)
        return 1
    print("结论：六片齐（tools 库内 0 本，出空片保持接口一致），全部在上限内。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
