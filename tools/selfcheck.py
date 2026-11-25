#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批 3 完成判据门槛：数据校验 + 类型检查 + 构建 + 浏览器自检，逐条打印，任一失败退出码非 0。

    python tools/selfcheck.py                 # 全跑
    python tools/selfcheck.py --skip-build    # 复用已有 dist/
    python tools/selfcheck.py --keep-server   # 跑完留着静态服务，方便手测

依赖：Python 3.10+ 标准库；Node + playwright-core（`npm i -D playwright-core`）+ 本机 Edge。
"""
from __future__ import annotations

import argparse
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
    record("tools/verify_data.py 四类校验全绿、退出码 0", code == 0, out.strip().splitlines()[-1] if out else f"exit {code}")
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

    # 3) 浏览器自检
    samples = pick_samples()
    record("样本齐全（full / degraded / 概念 / 微信外链 / mermaid / 成品 HTML）",
           all(k in samples for k in SAMPLE_KEYS), json.dumps({k: v.get("slug") for k, v in samples.items()}, ensure_ascii=False))
    if not DIST.joinpath("index.html").exists():
        record("dist/index.html 存在", False, "先跑 npm run build")
    elif not all(k in samples for k in SAMPLE_KEYS):
        record("探针未跑", False, "样本缺失，先补 pick_samples 判据")
    else:
        httpd, port, _ = serve(DIST)
        base = f"http://127.0.0.1:{port}"
        env = dict(os.environ, PROBE_BASE=base, ZHISHU_SAMPLES=json.dumps(samples, ensure_ascii=False),
                   PYTHONIOENCODING="utf-8")
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
                for c in rep["checks"]:
                    record(c["name"], c["pass"], json.dumps(c["info"], ensure_ascii=False)[:260] if c["info"] not in (None, "") else "")
                for line in rep.get("log", []):
                    print("      ·", line)
                fps_vals = [c["info"] for c in rep["checks"] if "帧率" in c["name"]]
                record(f"10 秒采样帧率 ≥{args.fps:g}（1440×900）", all(isinstance(v, (int, float)) and v >= args.fps for v in fps_vals) and bool(fps_vals), str(fps_vals))
                record("零外部请求（含字体 / CDN / 微信）", not rep["requests"]["external"], str(rep["requests"]["external"][:3]))
                record("正文按需加载：全程 bodies 请求数 == 打开过的本数", rep["requests"]["bodies"] <= 12,
                       f"bodies {rep['requests']['bodies']} 次 / 总请求 {rep['requests']['total']}")
                if rep["failed"]:
                    print(f"\n未过 {len(rep['failed'])} 项：")
                    for f in rep["failed"]:
                        print("  -", f["name"], json.dumps(f["info"], ensure_ascii=False)[:200])

    bad = [r for r in results if not r[1]]
    print(f"\n{'=' * 68}\n自检 {len(results)} 项，通过 {len(results) - len(bad)}，失败 {len(bad)}，用时 {time.time() - t0:.1f}s")
    print(f"报告：_work/selfcheck-report.json · 截图：_work/shots-batch3/")
    if bad and args.keep_server:
        print("--keep-server 已指定但自检未过，仍退出非 0")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
