#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools/verify_data.py — `data/` 产出校验门槛（批 3）

把 `data/manifest.json`、`data/_report.json` 与磁盘上的实际文件数固化成可重跑的判据。
业务代码只读 `data/`（铁律 6），所以「读到的东西自不自洽」只能靠本脚本把关。

五类校验：
  1. totals 与实际文件数一致（sites / bodies / dist 分片 + 计数与数组长度对账）
  2. 检索分片 search-<area>.json 六片齐、单片 ≤300KB、counts 与 manifest 对账、跳转目标不悬空
  3. 所有 manifest.json 的 schemaVersion 均为 2
  4. 必填字段齐全（slug / title / chapters / totals，缺失或 null 即失败）
  5. slug 在全部条目内唯一（主键 `repo::bookSlug` 与取数用的 `file`）

用法：
    python tools/verify_data.py                     # 校验 ./data，逐项打印结果
    python tools/verify_data.py --verbose           # 连通过的断言一起打（2000+ 行）
    python tools/verify_data.py --data-dir _work/data-dry
    python tools/verify_data.py --json              # 机读结果（仍按退出码判成败）

任一失败退出码非 0。只用标准库。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter

DISCIPLINES = ("math", "ai", "chem", "cs", "general", "tools")
STAT_KEYS = ("chapters", "concepts", "quizzes", "cards", "glossary")
LEVELS = ("full", "degraded", "stats-only")
REQUIRED_SCHEMA_VERSION = 2
SEARCH_PREFIX = "search-"
SEARCH_MAX_KB = 300
SEARCH_BOOK_FIELDS = ("slug", "file", "title", "area")
SEARCH_BOOK_ARRAYS = ("chapters", "concepts", "terms")


def _stdout_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def load_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class Gate:
    """一个 item 对应一类校验；任一断言 fail 则该项 FAIL。note 是不判成败的事实记录。"""

    def __init__(self) -> None:
        self.items: list[dict] = []

    def item(self, name: str) -> dict:
        item = {"name": name, "checks": [], "notes": [], "ok": True}
        self.items.append(item)
        return item

    def assert_(self, item: dict, ok: bool, detail: str, note: str = "") -> None:
        item["checks"].append({"ok": bool(ok), "detail": detail})
        if not ok:
            item["ok"] = False
        if note:
            item["notes"].append(note)

    def note(self, item: dict, text: str) -> None:
        item["notes"].append(text)

    @property
    def ok(self) -> bool:
        return all(i["ok"] for i in self.items)


def json_files(dir_path: str) -> list[str]:
    if not os.path.isdir(dir_path):
        return []
    return sorted(
        name
        for name in os.listdir(dir_path)
        if name.endswith(".json") and os.path.isfile(os.path.join(dir_path, name))
    )


def only_in(a: list[str], b: list[str]) -> list[str]:
    bs = set(b)
    return [x for x in a if x not in bs][:5]


# ------------------------------------------------------------------ 1. totals

def check_totals(gate: Gate, data_dir: str, manifest: dict, report: dict | None) -> None:
    item = gate.item("totals 与实际文件数一致")
    sites = manifest.get("sites") or []
    totals = manifest.get("totals") or {}
    site_files = json_files(os.path.join(data_dir, "sites"))
    body_files = json_files(os.path.join(data_dir, "bodies"))
    same_files = sorted(s.get("file") or "" for s in sites) == site_files
    same_bodies = body_files == site_files

    gate.assert_(
        item,
        totals.get("sites") == len(sites)
        and len(site_files) == len(sites)
        and len(body_files) == len(sites)
        and same_files
        and same_bodies,
        f"totals.sites={totals.get('sites')} / sites 条目={len(sites)} / "
        f"data/sites/={len(site_files)} / data/bodies/={len(body_files)} 四数相等"
        + ("" if same_files else f"；清单与磁盘不符 仅清单有={only_in(sorted(s.get('file') or '' for s in sites), site_files)} 仅磁盘有={only_in(site_files, [s.get('file') or '' for s in sites])}")
        + ("" if same_bodies else f"；bodies 与 sites 文件名集合不同 仅 bodies 有={only_in(body_files, site_files)} 仅 sites 有={only_in(site_files, body_files)}"),
        "每本书一个同名正文文件，前端按 `file` 取正文",
    )

    dist_dir = os.path.join(data_dir, "dist")
    search_names = [n for n in json_files(dist_dir) if n.startswith(SEARCH_PREFIX)]
    shard_files = [n for n in json_files(dist_dir) if n not in search_names]
    shard_keys = [n[: -len(".json")] for n in shard_files]
    unknown = [n for n in shard_keys if n not in DISCIPLINES]
    missing = [d for d in DISCIPLINES if d not in shard_keys]
    gate.assert_(
        item,
        not unknown and not (set(missing) - {"tools"}),
        f"data/dist/ 结构分片 {len(shard_files)} 份（六区 {list(DISCIPLINES)}，检索分片另计 {len(search_names)} 份），"
        f"缺失 {missing or '无'}、清单外 {unknown or '无'}；tools 允许缺失",
        "批 1 实测 tools 六个仓全无 manifest，故 dist/tools.json 不存在",
    )

    by_disc = Counter(s.get("discipline") for s in sites)
    shard_lines = []
    bad_shard = []
    for name, disc in zip(shard_files, shard_keys):
        rec = load_json(os.path.join(data_dir, "dist", name))
        got = len(rec.get("sites") or [])
        want = by_disc.get(disc, 0)
        shard_lines.append(f"{disc} {got}")
        if rec.get("discipline") != disc or got != want:
            bad_shard.append(f"{name}: discipline={rec.get('discipline')!r} 条数={got} manifest 该学科={want}")
    gate.assert_(
        item, not bad_shard,
        f"分片条数逐区等于 manifest：{' / '.join(shard_lines)}" + (f"；异常 {bad_shard}" if bad_shard else ""),
    )

    counted: Counter = Counter()
    levels: Counter = Counter()
    mismatch = []
    for name in site_files:
        rec = load_json(os.path.join(data_dir, "sites", name))
        for k in STAT_KEYS:
            counted[k] += len(rec.get(k) or [])
        levels[rec.get("contentLevel")] += 1
    for k in STAT_KEYS:
        gate.assert_(
            item, totals.get(k) == counted[k],
            f"totals.{k}={totals.get(k)} == 各书 {k}[] 长度之和={counted[k]}"
            if totals.get(k) == counted[k] else
            f"totals.{k}={totals.get(k)} ≠ 各书 {k}[] 长度之和={counted[k]}",
        )

    cl = manifest.get("contentLevels") or {}
    gate.assert_(
        item,
        sum(cl.values()) == len(sites) and all(cl.get(lv, 0) == levels.get(lv, 0) for lv in LEVELS),
        f"contentLevels={dict(cl)} 之和={sum(cl.values())} 等于条目数且与逐文件实测 {dict(levels)} 一致",
    )

    if report:
        gate.assert_(
            item,
            report.get("totals") == totals and report.get("contentLevels") == cl,
            "_report.json 的 totals / contentLevels 与 manifest.json 一致"
            if report.get("totals") == totals and report.get("contentLevels") == cl
            else f"_report 与 manifest 口径不一：totals {report.get('totals')} vs {totals}；"
            f"contentLevels {report.get('contentLevels')} vs {cl}",
        )
        dups = report.get("duplicates") or []
        copies = sum(len(set(d.get("books") or [])) - 1 for d in dups)
        gate.assert_(
            item, totals.get("sitesUnique") == len(sites) - copies,
            f"totals.sitesUnique={totals.get('sitesUnique')} == {len(sites)} − 重复副本 {copies}（{_report_hint(dups)}）",
        )
        collisions = report.get("slugCollisions") or []
        gate.assert_(
            item, not collisions,
            f"_report.slugCollisions={len(collisions)} 条"
            + ("" if not collisions else f"：{collisions[:3]}（非 0 表示有书被跳过，条目数不等于 manifest 数）"),
        )
        gate.note(item, f"failures {len(manifest.get('failures') or [])} 条（无 manifest 的站，不进 sites[]）、"
                        f"_report.pendingSources {len(report.get('pendingSources') or [])} 条、"
                        f"externalLinks {len(report.get('externalLinks') or [])} 条、"
                        f"links.policy={(report.get('links') or {}).get('policy')}")


def _report_hint(dups: list[dict]) -> str:
    sizes = Counter(len(set(d.get("books") or [])) for d in dups)
    return f"{len(dups)} 组，组内条数分布 {dict(sizes)}"


# ------------------------------------------------------------------ 2. 检索分片

def check_search_shards(gate: Gate, data_dir: str, manifest: dict) -> None:
    """批 3.5 / 判据 C1：`data/dist/search-<area>.json` 六片齐、单片 ≤300KB、 counts 自洽。

    业务代码只读 `data/`，所以「前端能不能按 file 取到正文、点 result 会不会跳空」
    只能靠这里对账——检索索引与抽取产物一旦错位，运行期表现为「命中列表有、点开白屏」。
    """
    item = gate.item(f"检索分片 search-<area>.json 齐全自洽（六片、单片 ≤{SEARCH_MAX_KB}KB）")
    dist_dir = os.path.join(data_dir, "dist")
    site_dir = os.path.join(data_dir, "sites")
    site_files = set(json_files(site_dir))
    by_disc = Counter(s.get("discipline") for s in (manifest.get("sites") or []))

    names = [n for n in json_files(dist_dir) if n.startswith(SEARCH_PREFIX)]
    keys = [n[len(SEARCH_PREFIX): -len(".json")] for n in names]
    missing = [d for d in DISCIPLINES if d not in keys]
    extra = [k for k in keys if k not in DISCIPLINES]
    gate.assert_(
        item, not missing and not extra,
        f"六片齐备 {sorted(keys)}" if not missing and not extra
        else f"缺失 {missing or '无'}、清单外 {extra or '无'}",
        "tools 区库内 0 本，仍要出空片——前端按区取片，缺片与空片的容错路径不同",
    )

    over = []
    offset = []
    bad_field = []
    bad_target = []
    sizes = []
    for name, area in zip(sorted(names), sorted(keys)):
        path = os.path.join(dist_dir, name)
        kb = os.path.getsize(path) / 1024
        sizes.append(f"{area} {kb:.1f}KB")
        if kb > SEARCH_MAX_KB:
            over.append(f"{name} {kb:.1f}KB")
        rec = load_json(path)
        if rec.get("area") != area or rec.get("schemaVersion") != 1 or not rec.get("generator"):
            bad_field.append(f"{name}: area/schemaVersion/generator 不合格 → "
                             f"{rec.get('area')!r}/{rec.get('schemaVersion')!r}/{rec.get('generator')!r}")
            continue
        books = rec.get("books") or []
        counts = rec.get("counts") or {}
        got = {
            "books": len(books),
            "chapters": sum(len(b.get("chapters") or []) for b in books),
            "concepts": sum(len(b.get("concepts") or []) for b in books),
            "terms": sum(len(b.get("terms") or []) for b in books),
        }
        if counts != got:
            offset.append(f"{name}: counts={counts} ≠ 实测 {got}")
        if len(books) != by_disc.get(area, 0):
            offset.append(f"{name}: 书目 {len(books)} 条 ≠ manifest 该学科 {by_disc.get(area, 0)} 条")
        for b in books:
            for f in SEARCH_BOOK_FIELDS:
                if not isinstance(b.get(f), (str, int)) or (isinstance(b.get(f), str) and not b.get(f)):
                    bad_field.append(f"{name}::{b.get('slug')}: 字段 {f} 缺失/为空 → {str(b.get(f))[:30]!r}")
            for f in SEARCH_BOOK_ARRAYS:
                if not isinstance(b.get(f), list):
                    bad_field.append(f"{name}::{b.get('slug')}: {f} 不是数组 → {str(b.get(f))[:30]!r}")
            if b.get("area") != area:
                bad_field.append(f"{name}::{b.get('slug')}: area={b.get('area')!r} 与所在片不符")
            if b.get("file") not in site_files:
                bad_field.append(f"{name}::{b.get('slug')}: file={b.get('file')!r} 在 data/sites/ 无同名正文")
            ch_ids = {c.get("id") for c in (b.get("chapters") or [])}
            for term in b.get("terms") or []:
                ref = term.get("c")
                if ref and ref not in ch_ids:
                    bad_target.append(f"{name}::{b.get('slug')}: 术语「{term.get('t')}」指向不存在的章节 {ref!r}")
            for c in b.get("concepts") or []:
                if not c.get("id") or not c.get("name"):
                    bad_target.append(f"{name}::{b.get('slug')}: 概念缺 id/name → {str(c)[:40]!r}")

    gate.assert_(item, not over,
                 f"单片体积均 ≤{SEARCH_MAX_KB}KB：{' / '.join(sizes)}"
                 + (f"；超限 {over}" if over else ""),
                 "超限按 full → titles-only → no-terms 三档裁剪长描述（见 tools/build_search_index.py --max-kb）")
    gate.assert_(item, not offset,
                 "每片 counts 与数组长度、片内书目数与 manifest 该学科条数全部一致"
                 if not offset else f"对账不符 {offset[:4]} 共 {len(offset)} 处")
    gate.assert_(item, not bad_field,
                 "slug / file / title / area + chapters / concepts / terms 字段齐全，file 均有同名正文"
                 if not bad_field else f"字段缺失或取数落空 {bad_field[:4]} 共 {len(bad_field)} 处")
    gate.assert_(item, not bad_target,
                 "术语的 c 一律落在同片同书的章节 id 上（抽不到就只落书总览，不猜）"
                 if not bad_target else f"跳转目标悬空 {bad_target[:4]} 共 {len(bad_target)} 处")


# ------------------------------------------------------------------ 3. schemaVersion

def check_schema_version(gate: Gate, data_dir: str) -> None:
    item = gate.item(f"所有 manifest.json 的 schemaVersion 均为 {REQUIRED_SCHEMA_VERSION}")
    scanned = []
    bad = []
    for root, _dirs, files in os.walk(data_dir):
        for name in files:
            if name != "manifest.json":
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, data_dir).replace("\\", "/")
            scanned.append(rel)
            try:
                ver = load_json(path).get("schemaVersion")
            except (OSError, ValueError) as exc:
                bad.append(f"{rel} 解析失败：{exc}")
                continue
            if ver != REQUIRED_SCHEMA_VERSION:
                bad.append(f"{rel}: schemaVersion={ver!r}")
    gate.assert_(
        item, bool(scanned) and not bad,
        f"扫描到 {len(scanned)} 份 manifest.json（{', '.join(scanned)}）"
        + ("" if not bad else f"；不合格 {bad}"),
        "抽取器只写一份合并索引；`data/sites/*.json` 是书条目、不带版本号，不属本项范围",
    )


# ------------------------------------------------------------------ 4. 必填字段

def check_required_fields(gate: Gate, data_dir: str, manifest: dict) -> None:
    item = gate.item("必填字段齐全（slug / title / chapters / totals）")
    totals = manifest.get("totals")
    need_totals = isinstance(totals, dict) and all(
        totals.get(k) is not None for k in ("repos", "sites", "sitesUnique") + STAT_KEYS
    )
    gate.assert_(item, need_totals,
                 "manifest.totals 存在且 repos/sites/sitesUnique + 五类计数均非 null"
                 if need_totals else f"manifest.totals 不完整 → {totals!r}")

    bad_index = [
        f"sites[{i}].{f} 缺失或为空 → {site.get(f)!r}"
        for i, site in enumerate(manifest.get("sites") or [])
        for f in ("bookSlug", "title", "file")
        if not isinstance(site.get(f), str) or not site.get(f)
    ]
    gate.assert_(item, not bad_index,
                 f"索引层 {len(manifest.get('sites') or [])} 条的 bookSlug / title / file 全非空"
                 + (f"；异常 {bad_index[:5]} 共 {len(bad_index)} 处" if bad_index else ""))

    site_dir = os.path.join(data_dir, "sites")
    files = json_files(site_dir)
    bad: list[str] = []
    stats_off = 0
    for name in files:
        rec = load_json(os.path.join(site_dir, name))
        for f in ("bookSlug", "title"):
            if not isinstance(rec.get(f), str) or not rec.get(f):
                bad.append(f"{name}: {f} 缺失或为 null")
        for f in ("chapters",) + STAT_KEYS:
            if not isinstance(rec.get(f), list):
                bad.append(f"{name}: {f} 缺失或类型不是数组 → {str(rec.get(f))[:40]!r}")
        stats = rec.get("stats")
        if not isinstance(stats, dict) or not all(isinstance(stats.get(k), int) for k in STAT_KEYS):
            bad.append(f"{name}: stats 五类计数不齐或非 int → {str(stats)[:60]}")
        elif any(stats[k] != len(rec.get(k) or []) for k in STAT_KEYS):
            stats_off += 1
    gate.assert_(item, not bad,
                 f"条目层 {len(files)} 份文件的 bookSlug / title / chapters + 四类数组 / stats 齐全"
                 + (f"；缺失或类型错误 {bad[:5]} 共 {len(bad)} 处" if bad else ""),
                 f"stats 与数组长度不一致的书：{stats_off} 本（契约以数组长度为准）")


# ------------------------------------------------------------------ 5. slug 唯一

def check_slug_unique(gate: Gate, data_dir: str, manifest: dict, report: dict | None) -> None:
    item = gate.item("slug 在全部条目内唯一")
    sites = manifest.get("sites") or []
    pairs = [f"{s.get('repo')}::{s.get('bookSlug')}" for s in sites]
    files = [s.get("file") for s in sites]
    dup_pairs = [k for k, n in Counter(pairs).items() if n > 1]
    dup_files = [k for k, n in Counter(files).items() if n > 1]
    gate.assert_(item, not dup_pairs and not dup_files,
                 f"主键 repo::bookSlug 与取数用 file 在 {len(sites)} 条内各自唯一"
                 + (f"；重复主键 {dup_pairs[:5]}" if dup_pairs else "")
                 + (f"；重复文件名 {dup_files[:5]}" if dup_files else ""))

    bare = Counter(s.get("bookSlug") for s in sites)
    shared = sorted(k for k, n in bare.items() if n > 1)
    dups = (report or {}).get("duplicates") or []
    gate.note(
        item,
        f"裸 bookSlug 重名 {len(shared)} 个（跨仓镜像同书，例 {shared[:3]}）；"
        f"_report.duplicates 有 {len(dups)} 组 —— 重名数不必等于组数（镜像副本的 slug 取值源不同），"
        "唯一性只按 repo::bookSlug 判",
    )
    disk = json_files(os.path.join(data_dir, "sites"))
    gate.assert_(item, len(disk) == len(set(disk)) and set(disk) == set(files),
                 f"data/sites/ 磁盘文件名唯一且与索引 file 一一对应（{len(disk)} 份）")


# ------------------------------------------------------------------ 输出

def render(gate: Gate, verbose: bool) -> str:
    lines = []
    total = sum(len(i["checks"]) for i in gate.items)
    failed = sum(1 for i in gate.items for c in i["checks"] if not c["ok"])
    for i, item in enumerate(gate.items, 1):
        mark = "PASS" if item["ok"] else "FAIL"
        n = len(item["checks"])
        lines.append(f"{i}. [{mark}] {item['name']}　（{n} 项断言）")
        for c in item["checks"]:
            if c["ok"] and not verbose:
                continue
            lines.append(f"   {'ok' if c['ok'] else '!!'} {c['detail']}")
        for note in item["notes"]:
            lines.append(f"   · {note}")
    lines.append("")
    lines.append(f"共 {total} 项断言，失败 {failed} 项")
    lines.append("结论：" + ("全绿" if gate.ok else "未通过"))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    _stdout_utf8()
    ap = argparse.ArgumentParser(description="校验 data/ 产出与 manifest / _report 的一致性")
    ap.add_argument("--data-dir", default="data", help="产出目录，默认 ./data")
    ap.add_argument("--json", action="store_true", help="输出 JSON 结果")
    ap.add_argument("--verbose", action="store_true", help="连通过的断言一起打印")
    args = ap.parse_args(argv)

    data_dir = args.data_dir
    manifest_path = os.path.join(data_dir, "manifest.json")
    report_path = os.path.join(data_dir, "_report.json")
    if not os.path.isfile(manifest_path):
        print(f"缺少 {manifest_path}", file=sys.stderr)
        return 1

    manifest = load_json(manifest_path)
    report = load_json(report_path) if os.path.isfile(report_path) else None

    gate = Gate()
    check_totals(gate, data_dir, manifest, report)
    check_search_shards(gate, data_dir, manifest)
    check_schema_version(gate, data_dir)
    check_required_fields(gate, data_dir, manifest)
    check_slug_unique(gate, data_dir, manifest, report)

    if args.json:
        print(json.dumps(
            {"dataDir": data_dir, "ok": gate.ok, "items": gate.items}, ensure_ascii=False, indent=2
        ))
    else:
        print(f"知枢矩阵 · 数据校验　目录 {data_dir}　条目 {len(manifest.get('sites') or [])} 本\n")
        print(render(gate, args.verbose))
    return 0 if gate.ok else 1


if __name__ == "__main__":
    sys.exit(main())
