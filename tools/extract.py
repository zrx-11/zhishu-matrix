#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools/extract.py — 知枢矩阵抽取器

本轮（批 1 前置）只实现 `--probe`：对 3 个代表站探测
  1. 数据所在的文件路径
  2. 内联数据的变量名
  3. 顶层字段名
  4. 各字段数组长度
probe 模式**不写 data/**（铁律 6：data/ 只由抽取器产出阶段写入）。

全量模式（`--all` / 非 probe 的 `--repo`）属批 1 主体，未开工，直接退出。

阶段策略（2026-11-24 确认）
  - 探路阶段（本文件 --probe）：GitHub trees API，recursive=1，3 次请求拿全树。
  - 全量阶段（批 1 主体）：**不用 trees API**（未授权 60 次/小时，47 站必爆），
    改用 raw + `docs/sites.md` 候选路径表逐站试探，见 CANDIDATE_PATHS 与 tools/README.md。

约束出处
  - 禁用系统代理        → docs/pitfalls.md 已验证 6
  - 中文路径逐段编码    → docs/pitfalls.md 已验证 5
  - \\u002F 反转义       → docs/pitfalls.md 已验证 4
  - 说明文件数字不可信  → docs/pitfalls.md 已验证 8
  - 候选优先级          → docs/schema.md 三、抽取优先级
  - 单站失败不中断      → docs/schema.md 四、容错
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import ProxyHandler, Request, build_opener

# ---------------------------------------------------------------- 配置

OWNER = "zrx-11"
BRANCH = "main"
RAW_HOST = "https://raw.githubusercontent.com"
API_BASE = f"https://api.github.com/repos/{OWNER}"
USER_AGENT = "zhishu-extract/0.1 (+probe)"

# 探路样本：多文件包 / 带 src 的特殊结构 / 单文件大包
PROBE_REPOS = ["hello-ai-zhishu", "sudoku-zhishu", "math-physical-methods"]

CACHE_SUBDIR = "_work/cache"          # 已随 .gitignore 的 `_work/` 一起忽略
TIMEOUT = 20
RETRIES = 2

MAX_FILES_PER_REPO = 12               # 单站内容文件抓取上限
MAX_BYTES_PER_REPO = 8 * 1024 * 1024  # 单站累计上限
MAX_FILE_BYTES = 3 * 1024 * 1024      # 单文件超此值只记路径不下载
MAX_DOC_BYTES = 200 * 1024            # 说明文件只读前若干字节

# 显式禁用代理：传空 dict，不能传 None（None 会回退读系统代理设置）
OPENER = build_opener(ProxyHandler({}))

# 统一 schema 字段 → 已知的旧版别名（docs/pitfalls.md 待验证 2）
ALIASES = {
    "chapters": ["chapters", "sections", "lessons", "units", "modules", "toc", "contents"],
    "concepts": ["concepts", "knowledge", "knowledges", "points", "items"],
    "quizzes": ["quizzes", "questions", "problems", "exercises", "tests", "quiz", "qa"],
    "cards": ["cards", "flashcards", "flash", "kp"],
    "glossary": ["glossary", "terms", "words", "vocabulary", "glossaries", "dic"],
}
TITLE_KEYS = ["title", "name", "heading", "label", "term"]
BODY_KEYS = ["body", "content", "text", "html", "md", "markdown", "detail", "depth"]
REF_KEYS = ["file", "path", "url", "href", "slug", "src", "filename"]

# 全量阶段将启用的候选路径表（本轮不用；留结构占位）
CANDIDATE_PATHS: dict[str, list[str]] = {
    # "hello-ai-zhishu": ["manifest.json", "01-Hello-AI人工智能导论/manifest.json", "index.html"],
}


# ---------------------------------------------------------------- HTTP 与缓存

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _cache_paths(url: str) -> tuple[str, str]:
    # 缓存名用 URL 的 sha1，不用裸站名：同站不同路径/不同分支不会互相覆盖
    key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    base = os.path.join(ROOT_DIR, CACHE_SUBDIR, key)
    return base + ".bin", base + ".meta.json"


def http_get(url: str, *, accept: str = "*/*", use_cache: bool = True) -> dict:
    """GET 一个 URL，返回 {url,status,bytes,body,fromCache,fetchedAt,error,attempts}。"""
    bin_path, meta_path = _cache_paths(url)
    if use_cache and os.path.exists(bin_path) and os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if meta.get("url") == url and meta.get("status") == 200:
                with open(bin_path, "rb") as f:
                    raw = f.read()
                meta["body"] = raw
                meta["fromCache"] = True
                return meta
        except Exception:
            pass  # 缓存坏了就重新抓

    out = {
        "url": url,
        "status": None,
        "error": None,
        "fromCache": False,
        "fetchedAt": None,
        "attempts": 0,
        "bytes": 0,
        "body": b"",
    }
    last_err = None
    for attempt in range(RETRIES + 1):
        out["attempts"] = attempt + 1
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
            with OPENER.open(req, timeout=TIMEOUT) as resp:
                out["status"] = resp.status
                out["body"] = resp.read()
                out["bytes"] = len(out["body"])
                out["fetchedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())
            last_err = None
            break
        except HTTPError as e:
            last_err = f"HTTP {e.code} {e.reason}"
            out["status"] = e.code
            if e.code == 404:
                break  # 不存在，重试无意义
            if e.code in (403, 422):
                break  # 限流 / 树过大，重试也拿不到
        except (URLError, OSError, TimeoutError) as e:
            last_err = f"{type(e).__name__}: {e}"
            out["error"] = last_err
            if attempt < RETRIES:
                time.sleep(1.5 * (attempt + 1))
    if last_err and out["status"] != 200:
        out["error"] = last_err
    if out["status"] == 200 and use_cache:
        try:
            os.makedirs(os.path.dirname(bin_path), exist_ok=True)
            with open(bin_path, "wb") as f:
                f.write(out["body"])
            meta = {k: out[k] for k in ("url", "status", "bytes", "fetchedAt", "attempts")}
            meta["contentType"] = "application/octet-stream"
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
        except Exception as e:  # 缓存失败不影响主流程
            out["error"] = (out["error"] or "") + f" [cache-write-failed {e}]"
    if not out["body"]:
        out["body"] = b""
    return out


def decode_bytes(raw: bytes) -> tuple[str, str]:
    """返回 (文本, 编码标注)。

    先按 UTF-8 严格解，失败再试 gb18030 —— Windows 侧 build 脚本用
    `open(..., 'w')` 写出的是 cp936/gb18030，不能一律当 UTF-8。
    """
    bom = raw.startswith(b"\xef\xbb\xbf")
    body = raw[3:] if bom else raw
    try:
        return body.decode("utf-8"), ("utf-8(BOM)" if bom else "utf-8")
    except UnicodeDecodeError:
        pass
    try:
        return body.decode("gb18030"), "gb18030（非 UTF-8）"
    except UnicodeDecodeError:
        return body.decode("utf-8", errors="replace"), "unknown（utf-8 replace）"


def decode_text(raw: bytes) -> str:  # 兼容旧调用点
    return decode_bytes(raw)[0]


def raw_url(repo: str, path: str) -> str:
    """逐段 URL 编码（pitfalls 已验证 5）：中文目录名与文件名都在此处理。"""
    base = f"{RAW_HOST}/{OWNER}/{repo}/{BRANCH}"
    return base + "/" + "/".join(quote(seg, safe="") for seg in path.split("/"))


def repo_tree(repo: str, use_cache: bool = True) -> dict:
    """GitHub trees API（仅探路阶段用）。"""
    url = f"{API_BASE}/{repo}/git/trees/{BRANCH}?recursive=1"
    r = http_get(url, accept="application/vnd.github+json", use_cache=use_cache)
    info = {
        "source": url,
        "method": "github-trees-api",
        "status": r.get("status"),
        "fromCache": r.get("fromCache"),
        "fetchedAt": r.get("fetchedAt"),
        "attempts": r.get("attempts"),
        "error": r.get("error"),
        "requestBytes": r.get("bytes", 0),
        "entryCount": None,
        "truncated": None,
        "entries": [],
    }
    if r.get("status") != 200:
        return info
    try:
        data = json.loads(decode_text(r["body"]))
    except Exception as e:
        info["error"] = f"trees JSON 解析失败 {e}"
        return info
    info["truncated"] = data.get("truncated")
    entries = []
    for it in data.get("tree", []):
        if it.get("type") != "blob":
            continue
        entries.append({"path": it.get("path"), "size": it.get("size"), "sha": it.get("sha")})
    info["entries"] = entries
    info["entryCount"] = len(entries)
    return info


# ---------------------------------------------------------------- 候选文件挑选
# 优先级照 docs/schema.md 三、抽取优先级

P_ROOT_MANIFEST = 1
P_SUB_MANIFEST = 2
P_ROOT_JSON = 3
P_ROOT_HTML = 4
P_CONTENT_JS = 5
P_ROOT_JS = 6
P_DOC = 7

PRIORITY_LABEL = {
    P_ROOT_MANIFEST: "P1 根 manifest.json",
    P_SUB_MANIFEST: "P2 子目录 manifest.json",
    P_ROOT_JSON: "P1' 根其它 .json",
    P_ROOT_HTML: "P3 index.html 内联",
    P_CONTENT_JS: "P3' src/content/*.js",
    P_ROOT_JS: "P3'' 根/src .js",
    P_DOC: "P4 交付说明/README",
}


def pick_candidates(entries: list[dict]) -> list[dict]:
    out = []
    for e in entries:
        path = e.get("path") or ""
        base = posixpath.basename(path)
        depth = path.count("/")
        prio = reason = None
        if base == "manifest.json":
            prio = P_ROOT_MANIFEST if depth == 0 else P_SUB_MANIFEST
            reason = "manifest"
        elif depth == 0 and base.endswith(".json"):
            prio, reason = P_ROOT_JSON, f"根目录 {base}"
        elif depth == 0 and base.endswith(".html"):
            prio, reason = P_ROOT_HTML, "根 HTML"
        elif re.search(r"(^|/)(src/)?content/[^/]+\.js$", path):
            prio, reason = P_CONTENT_JS, "内容 .js"
        elif re.search(r"^src/[^/]+\.js$", path):
            prio, reason = P_ROOT_JS, "src/*.js"
        elif depth == 0 and base.endswith(".js"):
            prio, reason = P_ROOT_JS, "根 .js"
        elif depth <= 1 and base in ("交付说明.md", "README.md", "readme.md"):
            prio, reason = P_DOC, "说明文件"
        if prio:
            out.append(
                {
                    "path": path,
                    "size": e.get("size"),
                    "priority": prio,
                    "priorityLabel": PRIORITY_LABEL[prio],
                    "reason": reason,
                }
            )
    # 同级内：数据文件按体积降序（内联数据在最大的那个 HTML/JS 里），文档按升序
    out.sort(key=lambda c: (c["priority"], -(c["size"] or 0) if c["priority"] != P_DOC else (c["size"] or 0)))
    return out


# ---------------------------------------------------------------- 内联数据提取

SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.I | re.S)
SRC_ATTR_RE = re.compile(r"\bsrc\s*=", re.I)
JSON_TYPE_RE = re.compile(r"type\s*=\s*['\"]application/(?:ld\+)?json['\"]", re.I)
ASSIGN_RE = re.compile(
    r"(?:^|[\s;{}(,])(?:(?:export|default)\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=|>)"
)
WINDOW_RE = re.compile(
    r"(?:window|globalThis|self)\s*[.\[]\s*['\"]?([A-Za-z_$][\w$]*)['\"]?\s*\]?\s*=(?!=|>)"
)
# 命名空间式赋值：`ZS.lessons = (…).concat([`、`ZS.META = {`，知枢旧产物常见
PROP_ASSIGN_RE = re.compile(
    r"^[ \t]*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=(?!=|>)", re.M
)


def read_container(s: str, start: int) -> tuple[str | None, int | None]:
    """从 s[start]（'{' 或 '['）开始做括号配平扫描，跳过字符串与注释。

    正则 `.*?` 在嵌套结构与字符串里的括号上必崩，所以手写状态机。
    返回 (子串, 结束下标)；不配平返回 (None, None)。
    """
    if start >= len(s) or s[start] not in "{[":
        return None, None
    closer = {"{": "}", "[": "]"}[s[start]]
    frames: list[list] = [["brace", closer, 0]]  # 第 3 位记录该帧起始下标
    i = start + 1
    n = len(s)
    while i < n and frames:
        top = frames[-1]
        if top[0] == "str":
            q = top[1]
            c = s[i]
            if c == "\\":
                i += 2
                continue
            if c == q:
                frames.pop()
                i += 1
                continue
            if q == "`" and c == "$" and i + 1 < n and s[i + 1] == "{":
                frames.append(["brace", "}", i])  # 模板字面量插值：进入代码态
                i += 2
                continue
            i += 1
            continue
        c = s[i]
        if c in "\"'":
            frames.append(["str", c, i])
            i += 1
            continue
        if c == "`":
            frames.append(["str", "`", i])
            i += 1
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "{[":
            frames.append(["brace", "}" if c == "{" else "]", i])
            i += 1
            continue
        if c in "}]":
            if top[1] == c:
                frames.pop()
                i += 1
                if not frames:
                    return s[start:i], i
                continue
            k = len(frames) - 1
            while k >= 0 and frames[k][1] != c:
                k -= 1
            if k < 0:
                return None, None
            del frames[k:]
            i += 1
            continue
        i += 1
    return None, None


def parse_container(snippet: str) -> tuple[object | None, str]:
    """先按原样 loads，失败再处理 \\u002F（pitfalls 已验证 4）。"""
    try:
        return json.loads(snippet), "json"
    except Exception:
        pass
    fixed = snippet.replace("\\u002F", "/").replace("\\/", "/")
    try:
        return json.loads(fixed), "json-after-u002f-fix"
    except Exception:
        return None, "js-literal-needs-js-side-parser"


def container_candidates(text: str, idx: int, window: int = 240) -> list[int]:
    """赋值号右侧窗口内所有 `{`/`[` 起点；遇引号、反引号、`;` 即止。"""
    starts: list[int] = []
    i, n = idx, min(len(text), idx + window)
    while i < n:
        c = text[i]
        if c in "{[":
            starts.append(i)
        elif c in "\"'`;>":
            break
        i += 1
    return starts


def best_container(text: str, idx: int, window: int = 240) -> tuple[str | None, int | None]:
    """取窗口内**配平后最长**的容器。

    必须这样：`ZS.lessons = (ZS.lessons || []).concat([ … ])` 的首个 `[` 是
    `(ZS.lessons || [])` 里的空数组（2 字节），真数据在其后的 `.concat([…])`。
    """
    best: tuple[str, int] | None = None
    for st in container_candidates(text, idx, window):
        snip, _end = read_container(text, st)
        if snip is None:
            continue
        if best is None or len(snip) > len(best[0]):
            best = (snip, st)
    return best if best else (None, None)


def js_features(snippet: str) -> dict:
    """解析失败时，记下 JS 字面量相对 JSON 多用了什么，供批 1 决定用哪种解析器。"""
    return {
        "backticks": snippet.count("`"),
        "singleQuotes": snippet.count("'"),
        "comments": len(re.findall(r"/\*|//[^\n]*", snippet)),
        "unquotedKeys": len(re.findall(r"[{,]\s*[A-Za-z_$][\w$]*\s*:", snippet)),
        "trailingCommas": len(re.findall(r",\s*[}\]]", snippet)),
    }


def scan_text(text: str, *, is_html: bool, keep_snippet: bool = False) -> list[dict]:
    """从 HTML/JS 文本里提取所有「看起来是数据容器」的赋值。

    keep_snippet=True 时额外保留字面量原文（给 Node 求值用）；默认不带，
    否则 --probe --json 会被 846KB 的 BOOKS 字面量撑爆。
    """
    blocks: list[tuple[str, int, str]] = []
    if is_html:
        for m in SCRIPT_RE.finditer(text):
            attrs, body = m.group(1) or "", m.group(2) or ""
            if SRC_ATTR_RE.search(attrs):
                continue
            if not body.strip():
                continue
            kind = "json-block" if JSON_TYPE_RE.search(attrs) else "script"
            blocks.append((kind, m.start(2), body))
    else:
        blocks.append(("module", 0, text))

    found: list[dict] = []
    seen_names: dict[str, int] = {}
    for kind, block_off, body in blocks:
        if kind == "json-block":
            snippet = body.strip()
            value, how = parse_container(snippet)
            if value is None or not isinstance(value, (dict, list)):
                continue
            found.append(
                {
                    "kind": "inline-json-script",
                    "var": "—（<script type=\"application/json\"> 无变量名）",
                    "offset": block_off,
                    "parse": how,
                    "value": value,
                    "rawLen": len(snippet),
                }
            )
            continue

        hits = [(m.group(1), m.start(1), m.end()) for m in ASSIGN_RE.finditer(body)]
        hits += [(m.group(1), m.start(1), m.end()) for m in WINDOW_RE.finditer(body)]
        hits += [(m.group(1), m.start(1), m.end()) for m in PROP_ASSIGN_RE.finditer(body)]
        for name, name_at, eq_end in hits:
            seen_names[name] = seen_names.get(name, 0) + 1
            starts = container_candidates(body, eq_end)
            if not starts:
                continue
            snippet, ci = best_container(body, eq_end)
            if snippet is None:
                ci = starts[0]
                found.append(
                    {
                        "kind": "inline-var",
                        "var": name,
                        "offset": block_off + ci,
                        "parse": "unbalanced-brackets",
                        "value": None,
                        "rawLen": None,
                        "sample": body[ci : ci + 200],
                        "jsFeatures": js_features(body[ci : ci + 4000]),
                    }
                )
                continue
            value, how = parse_container(snippet)
            if isinstance(value, (dict, list)) and not value and len(snippet) <= 4:
                continue  # `window.ZS = {}` 之类的占位赋值，不算数据容器
            if value is None:
                found.append(
                    {
                        "kind": "inline-var",
                        "var": name,
                        "offset": block_off + name_at,
                        "parse": how,
                        "value": None,
                        "rawLen": len(snippet),
                        "sample": snippet[:200],
                        "jsFeatures": js_features(snippet),
                        **({"snippet": snippet} if keep_snippet else {}),
                    }
                )
                continue
            if isinstance(value, (dict, list)):
                found.append(
                    {
                        "kind": "inline-var",
                        "var": name,
                        "offset": block_off + name_at,
                        "parse": how,
                        "value": value,
                        "rawLen": len(snippet),
                        **({"snippet": snippet} if keep_snippet else {}),
                    }
                )
    for f in found:
        f["dupDeclarations"] = seen_names.get(f["var"], 1)
    return found


# ---------------------------------------------------------------- 结构画像

def elem_keys(value: object) -> list[str]:
    """数组首个 object 元素的键；元素是标量时给出类型名。"""
    if isinstance(value, dict):
        return list(value.keys())
    if isinstance(value, list):
        for it in value:
            if isinstance(it, dict):
                return list(it.keys())
        if value:
            return [f"<元素为标量 {type(value[0]).__name__}>"]
        return []
    return []


def measure_inline(arr: list) -> dict:
    """正文是内联还是外链：外链即元素带 file/path/url 且值以 .md/.html/.json 结尾。"""
    out = {
        "titleKey": None,
        "bodyKey": None,
        "bodyAvgChars": None,
        "bodyNonEmpty": 0,
        "refKey": None,
        "refSample": None,
        "hasPrerequisites": None,
        "idKey": None,
    }
    dicts = [x for x in arr if isinstance(x, dict)][:50]
    if not dicts:
        return out
    keys = set()
    for d in dicts:
        keys.update(d.keys())
    for k in TITLE_KEYS:
        if k in keys:
            out["titleKey"] = k
            break
    for k in ("id", "no", "num", "key", "code", "uid"):
        if k in keys:
            out["idKey"] = k
            break
    out["hasPrerequisites"] = "prerequisites" in keys
    for k in REF_KEYS:
        for d in dicts:
            v = d.get(k)
            if isinstance(v, str) and v.lower().endswith((".md", ".html", ".json", ".txt")):
                out["refKey"] = k
                out["refSample"] = v[:80]
                break
        if out["refKey"]:
            break
    lens: dict[str, list[int]] = {}
    for d in dicts:
        for k in BODY_KEYS:
            v = d.get(k)
            if isinstance(v, str) and v.strip():
                lens.setdefault(k, []).append(len(v))
    if lens:
        best = max(lens.items(), key=lambda kv: sum(kv[1]) / len(kv[1]) * len(kv[1]))
        out["bodyKey"] = best[0]
        out["bodyAvgChars"] = round(sum(best[1]) / len(best[1]))
        out["bodyNonEmpty"] = len(best[1])
        out["bodyKeyCoverage"] = f"{len(best[1])}/{len(dicts)} 个元素非空（取样前 50）"
    return out


def profile(value: object) -> dict:
    """顶层字段名 + 数组长度 + 元素字段，并按 ALIASES 做推断归类。"""
    prof: dict = {"topType": type(value).__name__}
    if isinstance(value, dict):
        prof["topKeys"] = list(value.keys())
        fields = {}
        for k, v in value.items():
            entry: dict = {"type": type(v).__name__}
            if isinstance(v, list):
                entry["len"] = len(v)
                entry["keys"] = elem_keys(v)
                entry["mapHint"] = [c for c, names in ALIASES.items() if k.lower() in names]
                if v:
                    entry.update(measure_inline(v))
            elif isinstance(v, dict):
                entry["len"] = len(v)
                entry["keys"] = list(v.keys())[:20]
                entry["note"] = "对象而非数组，需转换（schema.md 四、容错）"
                entry["sub"] = {
                    sk: (
                        {"type": "array", "len": len(sv), "keys": elem_keys(sv)}
                        if isinstance(sv, list)
                        else {"type": type(sv).__name__, "preview": str(sv)[:60]}
                    )
                    for sk, sv in list(v.items())[:12]
                }
            else:
                entry["preview"] = str(v)[:60]
            fields[k] = entry
        prof["fields"] = fields
    elif isinstance(value, list):
        prof["len"] = len(value)
        prof["elemKeys"] = elem_keys(value)
        if value and isinstance(value[0], dict):
            prof["elemKeysSource"] = "首个 dict 元素"
            prof["inline"] = measure_inline(value)
    return prof


def doc_lines_with_counts(text: str) -> list[str]:
    """说明文件里的数字表述，只作交叉校验（pitfalls 已验证 8）。"""
    pat = re.compile(r"\d+\s*(?:章|个)?\s*(?:概念|节|题目?|测验|卡片?|术语|词条|知识点)")
    hits = []
    for line in text.splitlines():
        line = line.strip()
        if line and pat.search(line):
            hits.append(line[:160])
        if len(hits) >= 8:
            break
    return hits


# ---------------------------------------------------------------- 单站探测

def probe_repo(repo: str, use_cache: bool = True, result: dict | None = None) -> dict:
    """result 可由调用方传入，异常时已探得的部分仍保留在报告里。"""
    result = result if result is not None else {}
    result.setdefault("repo", repo)
    result.setdefault("notes", [])
    result.setdefault("tree", {})
    result.setdefault("candidates", [])
    tree = repo_tree(repo, use_cache=use_cache)
    result["tree"] = tree
    if tree.get("status") != 200:
        result["notes"].append(
            f"trees API 未成功（status={tree.get('status')} error={tree.get('error')}）→ "
            "本轮探路无 raw 候选表兜底，全量阶段改走 raw + docs/sites.md 路径表"
        )
        return result
    if tree.get("truncated"):
        result["notes"].append("trees API 返回 truncated=true，文件清单不完整")

    cands = pick_candidates(tree["entries"])
    files = tree["entries"]
    result["tree"]["fileCount"] = len(files)
    result["extensions"] = top_extensions(files)
    result["manifestDirs"] = sorted(
        {posixpath.dirname(c["path"]) or "（根目录）" for c in cands if c["reason"] == "manifest"}
    )

    fetched = 0
    total_bytes = 0
    cand_out = result["candidates"]  # 就地追加，异常时已探部分可见
    for c in cands:
        rec = dict(c)
        size = c.get("size")
        if size is not None and size > MAX_FILE_BYTES:
            rec["fetched"] = False
            rec["skipReason"] = f"单文件 {size:,}B > 上限 {MAX_FILE_BYTES:,}B，只记路径"
            cand_out.append(rec)
            continue
        if fetched >= MAX_FILES_PER_REPO:
            rec["fetched"] = False
            rec["skipReason"] = f"超出单站 {MAX_FILES_PER_REPO} 文件预算"
            cand_out.append(rec)
            continue
        if total_bytes + (size or 0) > MAX_BYTES_PER_REPO:
            rec["fetched"] = False
            rec["skipReason"] = f"超出单站 {MAX_BYTES_PER_REPO // 1024 // 1024}MB 预算"
            cand_out.append(rec)
            continue

        url = raw_url(repo, c["path"])
        r = http_get(url, use_cache=use_cache)
        rec["source"] = url
        rec["status"] = r.get("status")
        rec["fromCache"] = r.get("fromCache")
        rec["fetchedAt"] = r.get("fetchedAt")
        if r.get("status") != 200:
            rec["fetched"] = False
            rec["skipReason"] = r.get("error") or f"HTTP {r.get('status')}"
            cand_out.append(rec)
            continue
        rec["fetched"] = True
        fetched += 1
        total_bytes += r["bytes"]
        rec["bytes"] = r["bytes"]
        text, enc = decode_bytes(r["body"])
        rec["encoding"] = enc
        rec["replacementChars"] = text.count("\ufffd")
        rec["chars"] = len(text)
        rec["hasBom"] = bool(r["body"].startswith(b"\xef\xbb\xbf"))
        rec["u002fCount"] = text.count("\\u002F") + text.count("\\u002f")
        mc = re.search(r"""<meta[^>]+charset\s*=\s*["']?([\w-]+)""", text, re.I)
        if mc:
            rec["metaCharset"] = mc.group(1)

        ext = posixpath.basename(c["path"]).lower()
        if ext == "交付说明.md" or ext.endswith(".md"):
            rec["carrier"] = "markdown-doc"
            rec["docCountLines"] = doc_lines_with_counts(text)
        elif ext.endswith(".json"):
            rec["carrier"] = "json-file"
            try:
                value = json.loads(text)
                rec["parse"] = "json"
                rec["profile"] = profile(value)
            except Exception as e:
                rec["carrier"] = "json-file"
                rec["parse"] = f"json-loads-failed: {e}"
                rec["sample"] = text[:200]
        elif ext.endswith((".html", ".htm")):
            rec["carrier"] = "html-inline"
            mc = re.search(r"""<meta[^>]+charset\s*=\s*["']?([\w-]+)""", text[:4000], re.I)
            rec["metaCharset"] = mc.group(1) if mc else "未声明"
            rec["scriptBlocks"] = len(SCRIPT_RE.findall(text))
            rec["externalScripts"] = len(
                [m for m in SCRIPT_RE.finditer(text) if SRC_ATTR_RE.search(m.group(1) or "")]
            )
            blocks = scan_text(text, is_html=True)
            rec["blocks"] = rank_blocks(blocks)
            rec["candidatesWithNoContainer"] = len(
                [b for b in blocks if b.get("value") is None]
            )
            # 正文也可能直接写进 DOM 而不是 JS 容器，这里量一下
            rec["domSectionCount"] = len(re.findall(r"<(?:section|article)\b", text, re.I))
            rec["domChapterIds"] = len(set(re.findall(r"""id=["']?(ch\d+)""", text)))
        elif ext.endswith(".js"):
            rec["carrier"] = "js-module"
            blocks = scan_text(text, is_html=False)
            rec["blocks"] = rank_blocks(blocks)
            rec["exportCount"] = len(re.findall(r"\bexport\b", text))
        else:
            rec["carrier"] = "other"
        cand_out.append(rec)
    result["budget"] = {
        "filesFetched": fetched,
        "bytesFetched": total_bytes,
        "candidatesConsidered": len(cands),
        "limits": {
            "filesPerRepo": MAX_FILES_PER_REPO,
            "bytesPerRepo": MAX_BYTES_PER_REPO,
            "fileBytes": MAX_FILE_BYTES,
        },
    }
    return result


def top_extensions(entries: list[dict]) -> list[dict]:
    from collections import Counter

    c: Counter = Counter()
    sz: Counter = Counter()
    for e in entries:
        ext = posixpath.splitext(e["path"])[1].lower() or "(no-ext)"
        c[ext] += 1
        sz[ext] += e.get("size") or 0
    return [
        {"ext": k, "files": v, "bytes": sz[k]}
        for k, v in c.most_common(10)
    ]


CONTENT_FIELD_SET = set(ALIASES) | {n for names in ALIASES.values() for n in names} | {
    "depth",
    "brief",
    "explain",
    "misconception",
}


def score_block(value: object) -> int:
    """给候选数据块打分，判断哪个是「真数据」，不作为结论只作为排序。"""
    s = 0
    if isinstance(value, dict):
        for k in value:
            if k.lower() in CONTENT_FIELD_SET:
                s += 10
            v = value[k]
            if isinstance(v, list) and len(v) >= 3:
                s += 3
    elif isinstance(value, list):
        s += 5
        if value and isinstance(value[0], dict):
            s += sum(1 for k in value[0] if k.lower() in CONTENT_FIELD_SET) * 4
        s += min(len(value), 20)
    return s


def rank_blocks(blocks: list[dict]) -> list[dict]:
    dedup: dict[tuple, dict] = {}
    for b in blocks:
        key = (b.get("var"), b.get("offset"))
        if key not in dedup:
            dedup[key] = b
    out = list(dedup.values())
    for b in out:
        b["score"] = score_block(b.get("value"))
        b["profile"] = profile(b["value"]) if b.get("value") is not None else None
        b.pop("value", None)
    # 高分在前；解析失败的容器往往体积最大（正文就在这里），单列体积序
    out.sort(key=lambda b: (-b["score"], -(b.get("rawLen") or 0)))
    return out


def size_note(blocks: list[dict]) -> str:
    ranked = sorted(blocks, key=lambda b: -(b.get("rawLen") or 0))[:5]
    return " · ".join(
        f"{b.get('var')}={fmt_int(b.get('rawLen'))}B" + ("" if b.get("parse", "").startswith("json") else "(未解析)")
        for b in ranked
    )


# ---------------------------------------------------------------- 打印

def p(*a):
    print(*a)


def fmt_int(n) -> str:
    return "—" if n is None else f"{n:,}"


def print_block(b: dict, indent: str) -> None:
    parse = b.get("parse")
    prof = b.get("profile")
    p(
        f"{indent}var={b.get('var')}  offset={fmt_int(b.get('offset'))}  "
        f"容器={fmt_int(b.get('rawLen'))}B  parse={parse}  score={b.get('score')}"
    )
    if prof is None:
        f = b.get("jsFeatures") or {}
        p(f"{indent}↳ 未解析成 JSON：{b.get('parse')}")
        p(
            f"{indent}   JS 字面量特征: 反引号 {fmt_int(f.get('backticks'))} · 单引号 {fmt_int(f.get('singleQuotes'))}"
            f" · 注释 {fmt_int(f.get('comments'))} · 无引号键 {fmt_int(f.get('unquotedKeys'))}"
            f" · 尾逗号 {fmt_int(f.get('trailingCommas'))}"
        )
        p(f"{indent}   样本: {str(b.get('sample', ''))[:120]!r}")
        return
    if prof["topType"] == "dict":
        p(f"{indent}↳ 顶层 object，键 {len(prof['topKeys'])} 个: {', '.join(prof['topKeys'][:14])}")
        for k, v in prof["fields"].items():
            if v["type"] == "list":
                hint = "/".join(v.get("mapHint") or []) or "未归类"
                extra = ""
                if v.get("refKey"):
                    extra += f" 外链 {v['refKey']}={v['refSample']}"
                if v.get("bodyKey"):
                    extra += f" 内联正文 {v['bodyKey']} 均 {fmt_int(v.get('bodyAvgChars'))} 字({v.get('bodyKeyCoverage', '')})"
                if v.get("hasPrerequisites") is not None:
                    extra += f" prerequisites={v['hasPrerequisites']}"
                keys = ", ".join(v.get("keys") or [])[:110]
                p(
                    f"{indent}   · {k}: array 长度 {fmt_int(v.get('len'))} → 推断 {hint}"
                    f"{extra}\n{indent}     元素键: {keys or '—（元素非 object）'}"
                )
            elif v["type"] == "dict":
                p(
                    f"{indent}   · {k}: object 键数 {fmt_int(v.get('len'))} "
                    f"→ {', '.join(v.get('keys') or [])[:100]}"
                )
                for sk, sv in (v.get("sub") or {}).items():
                    if sv["type"] == "array":
                        p(
                            f"{indent}     · {k}.{sk}: array 长度 {fmt_int(sv['len'])}"
                            f" 元素键 {', '.join(sv.get('keys') or [])[:80] or '—'}"
                        )
                    else:
                        p(f"{indent}     · {k}.{sk}: {sv['type']} = {sv.get('preview', '')[:70]}")
            else:
                p(f"{indent}   · {k}: {v['type']} = {v.get('preview', '')}")
        if prof.get("elemKeys"):
            p(f"{indent}↳ 顶层 array 长度 {fmt_int(prof.get('len'))}，元素键: {prof['elemKeys']}")
    else:
        p(
            f"{indent}↳ 顶层 {prof['topType']} 长度 {fmt_int(prof.get('len'))}，"
            f"元素键: {', '.join(prof.get('elemKeys') or [])[:120]}"
        )
        if prof.get("inline"):
            i = prof["inline"]
            p(
                f"{indent}   bodyKey={i.get('bodyKey')} 均 {fmt_int(i.get('bodyAvgChars'))} 字 "
                f"refKey={i.get('refKey')} prerequisites={i.get('hasPrerequisites')}"
            )


def print_human(results: list[dict]) -> None:
    for res in results:
        tree = res.get("tree", {})
        p("")
        p(
            f"[{res['repo']}] tree: {fmt_int(tree.get('entryCount'))} 文件 "
            f"· status={tree.get('status')} · truncated={tree.get('truncated')} "
            f"· method={tree.get('method')} · cache={tree.get('fromCache')}"
        )
        b = res.get("budget")
        if b:
            p(
                f"  抓取预算: {b['filesFetched']}/{b['limits']['filesPerRepo']} 文件 · "
                f"{b['bytesFetched'] / 1024:.0f}KB · 候选 {b['candidatesConsidered']} 个"
            )
        if res.get("extensions"):
            p(
                "  扩展名分布: "
                + " · ".join(f"{e['ext']}×{e['files']}({e['bytes'] / 1024:.0f}KB)" for e in res["extensions"])
            )
        if res.get("manifestDirs"):
            p("  manifest 所在目录: " + " | ".join(res["manifestDirs"]))
        for n in res.get("notes", []):
            p(f"  ! {n}")
        if not res.get("candidates"):
            p("  未命中：候选清单为空（tree 未取到）")
            continue
        hit_any = False
        for c in res["candidates"]:
            mark = "✓" if c.get("fetched") else "·"
            extra = f"  编码={c['encoding']}" if c.get("fetched") and c.get("encoding") else ""
            if c.get("metaCharset"):
                extra += f" · <meta charset>={c['metaCharset']}"
            if c.get("replacementChars"):
                extra += f" · U+FFFD×{c['replacementChars']}"
            p(
                f"  {mark} {c['priorityLabel']:<24} {c['path']}  {fmt_int(c.get('size'))}B{extra}"
                + (f"  [{c.get('skipReason')}]" if c.get("skipReason") else "")
            )
            if not c.get("fetched"):
                continue
            if c.get("carrier") == "markdown-doc":
                if c.get("docCountLines"):
                    for line in c["docCountLines"]:
                        p(f"      说明文件数字行: {line}")
                else:
                    p("      说明文件未探到含章/概念/题等计数的行")
                continue
            if c["carrier"] in ("json-file",):
                if c.get("profile"):
                    hit_any = True
                    print_block({"var": "—（纯 JSON 文件）", "offset": None, "rawLen": c.get("bytes"),
                                 "parse": c.get("parse"), "score": score_block(None),
                                 "profile": c["profile"]}, "      ")
                else:
                    p(f"      解析失败: {c.get('parse')}  样本: {c.get('sample', '')[:100]!r}")
                continue
            blocks = c.get("blocks") or []
            if not blocks:
                p(
                    f"      未探到内联数据容器（script 块 {fmt_int(c.get('scriptBlocks'))} 个，"
                    f"外链 script {fmt_int(c.get('externalScripts'))} 个，export {fmt_int(c.get('exportCount'))} 处）"
                )
                continue
            hit_any = True
            p(f"      容器体积 Top5: {size_note(blocks)}")
            if c.get("carrier") == "html-inline":
                p(
                    f"      HTML 侧线索: <script> {fmt_int(c.get('scriptBlocks'))} 块"
                    f"（外链 {fmt_int(c.get('externalScripts'))} 个）· <section>/<article> "
                    f"{fmt_int(c.get('domSectionCount'))} 个 · 去重 id=chNN {fmt_int(c.get('domChapterIds'))} 个"
                )
            if c.get("u002fCount"):
                p(f"      \\u002F 出现 {c['u002fCount']} 次")
            shown: list[tuple] = []
            for blk in blocks[:3] + [b for b in blocks[3:] if (b.get("rawLen") or 0) > 20000]:
                key = (blk.get("var"), blk.get("offset"))
                if key in shown:
                    continue
                shown.append(key)
                print_block(blk, "      ")
            rest = len(blocks) - len(shown)
            if rest > 0:
                p(f"      （另有 {rest} 个小体积容器未展开）")
        if not hit_any:
            p("  未命中：已抓候选里探不到可用数据容器，路径见上")
    p("")


# ---------------------------------------------------------------- 入口

# ================================================== 批 1 主体（全量抽取，一书一条）
#
# 契约：docs/schema.md v2（2026-11-25 定稿：一条 sites 记录 = 一本书，不是仓库）
# 主路径：本地 clone `_work/repos/{repo}/`；raw 只作兜底（3 并发 + `_work/cache/` + 断点）。
# 产出：data/sites/….json、data/bodies/….json、data/dist/{discipline}.json、
#       data/manifest.json、data/_report.json
# 本轮铁律：不写 data/ 的内容 —— 验证一律 `--out-dir _work/data-dry`。

REPOS_SUBDIR = "_work/repos"
STATE_SUBDIR = "_work/state"
SCHEMA_VERSION = 2
GENERATOR = "tools/extract.py"
MAX_MANIFEST_DEPTH = 4          # 实测 manifest 落在根/一级/二级，留两层余量
RAW_CONCURRENCY = 3             # 兜底抓 raw 的并发上限（schema.md 第三节）
SITES_MD = "docs/sites.md"

DISCIPLINE_SECTIONS = {          # docs/sites.md 分节标题 → 学科 key（不写死站名清单）
    "AI": "ai",
    "数学": "math",
    "化学与食品": "chem",
    "计算机": "cs",
    "通识": "general",
    "工具": "tools",
}
DISCIPLINE_TITLES = {
    "math": "数学", "ai": "AI", "chem": "化学与食品",
    "cs": "计算机", "general": "通识", "tools": "工具",
}
SLUG_BAD_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._\-]+")
NO_EXTENSIONS = {".git", "node_modules", "__pycache__", ".github", ".vscode"}

# 字段别名（docs/schema.md 第四节；probe 实测三站 + 已知旧版写法）
FIELD_ALIAS = {
    "title": ["title", "name", "heading", "label"],
    "core": ["core", "summary", "tldr", "abstract"],
    "file": ["file", "path", "filename", "src"],
    "prerequisites": ["prerequisites", "prereq", "requires", "dependsOn"],
    "brief": ["short", "brief", "summary", "definition", "def"],
    "depth": ["depthFragment", "depth", "derivation"],
    "stem": ["question", "stem", "q", "title"],
    "options": ["options", "choices", "items"],
    "answer": ["answer", "correct", "answerIndex"],
    "explain": ["explain", "explanation", "analysis", "reason"],
    "front": ["front", "q", "question"],
    "back": ["back", "a", "answer"],
    "conceptIds": ["conceptIds", "concepts", "knowledge"],
    "chapterId": ["chapterId", "lesson", "chapter", "cid"],
    "chapterIds": ["chapterIds", "chapters", "chapterId"],
    "tags": ["tags", "tag", "labels"],
    "type": ["type", "kind"],
    "conceptId": ["relatedConceptId", "conceptId", "concept"],
    "id": ["id", "no", "key"],
}


def work_path(*parts: str) -> str:
    return os.path.join(ROOT_DIR, *parts)


def read_text_file(path: str) -> tuple[str | None, str]:
    """本地读盘，返回 (文本, 编码或错误标记)。"""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError as e:
        return None, f"oserror:{e.__class__.__name__}"
    text, enc = decode_bytes(raw)
    return text, enc


def load_site_catalog(path: str | None = None) -> dict[str, str]:
    """从 docs/sites.md 的分表读「仓库 → 学科」，不在代码里写死站名清单。"""
    path = path or work_path("docs", "sites.md")
    text, _ = read_text_file(path)
    catalog: dict[str, str] = {}
    if not text:
        return catalog
    section = None
    for line in text.splitlines():
        head = re.match(r"^##\s+[一二三四五六七八九十]+、(.+?)\s*$", line.strip())
        if head:
            title = head.group(1).strip()
            section = DISCIPLINE_SECTIONS.get(title)
            continue
        if section and line.strip().startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if not cells or cells[0] in ("", "仓库") or set(cells[0]) <= set("-: "):
                continue
            if len(cells) >= 2:                     # 说明/工具表只有两列，同样收
                repo = cells[0].strip("`")
                if re.fullmatch(r"[A-Za-z0-9._\-]+", repo):
                    catalog.setdefault(repo, section)
    return catalog


def list_repos(catalog: dict[str, str]) -> list[str]:
    """待处理仓库 = docs/sites.md 清单 ∪ _work/repos 目录，交集外的记入报告。"""
    repos = set(catalog)
    base = work_path(*REPOS_SUBDIR.split("/"))
    if os.path.isdir(base):
        for name in os.listdir(base):
            if os.path.isdir(os.path.join(base, name)):
                repos.add(name)
    return sorted(repos)


def find_manifests(repo_dir: str) -> tuple[list[str], list[str]]:
    """返回 (可用 manifest, 被排除的 manifest)。归档副本不算一本书，否则会产出重复条目。"""
    hits: list[str] = []
    excluded: list[str] = []
    base = repo_dir.rstrip("/\\")
    for dirpath, dirnames, filenames in os.walk(base):
        rel_dir = os.path.relpath(dirpath, base).replace(os.sep, "/")
        depth = 0 if rel_dir == "." else rel_dir.count("/") + 1
        if depth >= MAX_MANIFEST_DEPTH:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if d not in NO_EXTENSIONS and not d.startswith(".")]
        if "manifest.json" in filenames:
            rel = posixpath.join(rel_dir if rel_dir != "." else "", "manifest.json")
            low = rel.lower()
            if any(tag in low for tag in EXCLUDED_MANIFEST_PARTS):
                excluded.append(rel)
            else:
                hits.append(rel)
    return sorted(hits), sorted(excluded)


def sanitize_slug(value: str) -> str:
    value = SLUG_BAD_RE.sub("-", str(value or "").strip()).strip("-._ ")
    return value[:80]


def pick_key(container: dict, logical: str) -> str | None:
    for cand in FIELD_ALIAS.get(logical, [logical]):
        if cand in container:
            return cand
    return None


def get_field(container: dict, logical: str, default=None):
    key = pick_key(container, logical)
    if key is None:
        return default
    value = container.get(key)
    return default if value is None else value


def pick_array(manifest: dict, logical: str) -> tuple[list, str | None]:
    """按别名取数组；对象形态尝试 values() 转换（schema.md 五、容错）。"""
    for cand in ALIASES.get(logical, [logical]):
        if cand in manifest:
            value = manifest[cand]
            if isinstance(value, list):
                return value, cand
            if isinstance(value, dict):
                vals = [v for v in value.values() if isinstance(v, dict)]
                return vals, f"{cand}(object→list)"
            return [], f"{cand}(type={type(value).__name__})"
    return [], None


def to_minutes(container: dict, notes: list, where: str):
    """hours/minutes 归一。解析不出单一数值 → None，并记 unmapped，绝不返回 0。"""
    if isinstance(container.get("minutes"), (int, float)) and not isinstance(container.get("minutes"), bool):
        return int(container["minutes"])
    if "minutes" in container and isinstance(container["minutes"], str):
        s = container["minutes"].strip()
        if s.isdigit():
            return int(s)
        notes.append(f"{where}: minutes 非单一数值 {s!r} → null")
        return None
    if "hours" in container:
        v = container["hours"]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return int(round(float(v) * 60))
        if isinstance(v, str) and v.strip().isdigit():
            return int(round(float(v.strip()) * 60))
        notes.append(f"{where}: hours={v!r} 是字符串/区间，取不到单一数值 → null")
        return None
    return None


def book_source(container: dict) -> dict | None:
    src = container.get("source")
    if isinstance(src, dict):
        return {k: v for k, v in src.items()}          # 原样保留，page 可能是 str/int/缺
    if isinstance(src, str) and src.strip():
        return {"file": src}
    return None


def map_chapter(repo: str, slug: str, mdir: str, raw: dict, idx: int, ctx: dict) -> dict:
    notes = ctx["notes"]
    cid = str(get_field(raw, "id", f"ch{idx + 1:02d}"))
    file_rel = get_field(raw, "file", "") or ""
    origin_path = posixpath.join(mdir, file_rel) if file_rel and mdir else (file_rel or "")
    ch = {
        "id": cid,
        "num": chapter_num(cid, idx),
        "title": str(get_field(raw, "title", "")),
        "core": str(get_field(raw, "core", "")),
        "minutes": to_minutes(raw, notes, f"{repo}:{slug}:{cid}.minutes"),
        "bodyType": "md",
        "body": "",
        "conceptIds": [str(x) for x in (get_field(raw, "conceptIds", []) or [])],
        "quizIds": [str(x) for x in (raw.get("quizIds") or raw.get("quiz_ids") or [])],
        "prerequisites": [str(x) for x in (get_field(raw, "prerequisites", []) or [])],
        "origin": {"repo": repo, "path": origin_path},
        "bookSource": book_source(raw),
    }
    if file_rel:
        ctx["want_files"].append((ch, origin_path))
    else:
        ch["bodyType"] = ""
    return ch


def chapter_num(cid: str, idx: int):
    m = re.search(r"(\d+)\s*$", str(cid))
    return int(m.group(1)) if m else idx + 1


def map_concept(repo: str, slug: str, mdir: str, raw: dict, idx: int, ctx: dict) -> dict:
    notes = ctx["notes"]
    cid = str(get_field(raw, "id", f"c{idx + 1:03d}"))
    file_rel = get_field(raw, "file", "") or ""
    origin_path = posixpath.join(mdir, file_rel) if file_rel and mdir else (file_rel or "")
    depth = str(get_field(raw, "depth", "") or "")
    if depth and pick_key(raw, "depth") is None:
        notes.append(f"{repo}:{slug}:{cid} 深度键名不在别名表：{list(raw)[:8]}")
    out = {
        "id": cid,
        "title": str(get_field(raw, "title", "")),
        "chapterIds": [str(x) for x in (get_field(raw, "chapterIds", []) or [])],
        "prerequisites": [str(x) for x in (get_field(raw, "prerequisites", []) or [])],
        "brief": str(get_field(raw, "brief", "")),
        "depth": depth,
        "claims": [c for c in (raw.get("claims") or [])] if isinstance(raw.get("claims"), list) else [],
        "bodyType": "md",
        "body": "",
        "origin": {"repo": repo, "path": origin_path},
        "bookSource": book_source(raw),
    }
    if file_rel:
        ctx["want_files"].append((out, origin_path))
    else:
        out["bodyType"] = ""
    return out


def map_quiz(raw: dict, idx: int, ctx: dict, repo: str, slug: str) -> dict:
    options = get_field(raw, "options", []) or []
    options = [str(o) for o in options] if isinstance(options, list) else []
    qtype = str(get_field(raw, "type", "single"))
    ans = get_field(raw, "answer", None)
    where = f"{repo}:{slug}:q{idx + 1}"

    def index_or_none(value):
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, int):
            return value
        s = str(value).strip()
        if s.isdigit():
            return int(s)
        if len(s) == 1 and s.upper() in "ABCDE" and options:
            return ord(s.upper()) - 65
        return None

    answer: object = None
    if qtype == "multi":
        if isinstance(ans, list):
            vals = [index_or_none(v) for v in ans]
            answer = [v for v in vals if v is not None]
            if len(answer) != len(ans):
                ctx["notes"].append(f"{where} multi 答案含无法归一项 {ans!r} → 保留可解析部分")
        else:
            single = index_or_none(ans)
            answer = [single] if single is not None else []
            if single is None:
                ctx["notes"].append(f"{where} multi 答案非索引数组：{ans!r} → []")
    elif qtype == "blank":
        # 填空题没有选项，answer 就是答案文本；数字串保留字符串形态，免得把 "03" 变成 3
        answer = "" if ans is None else (ans if isinstance(ans, str) else str(ans))
    else:
        answer = index_or_none(ans)
        if answer is None and ans is not None:
            ctx["notes"].append(f"{where} type={qtype} answer 无法归一：{ans!r} → null")
    if isinstance(answer, int) and options and not (0 <= answer < len(options)):
        ctx["notes"].append(f"{where} answer={answer} 越界（options={len(options)}）→ 保留原值待人工")
    if isinstance(answer, list) and options:
        bad = [i for i in answer if not (0 <= i < len(options))]
        if bad:
            ctx["notes"].append(f"{where} multi 越界索引 {bad}（options={len(options)}）")
    return {
        "id": str(get_field(raw, "id", f"q{idx + 1:02d}")),
        "chapterId": str(get_field(raw, "chapterId", "")),
        "stem": str(get_field(raw, "stem", "")),
        "options": options,
        "answer": answer,
        "type": qtype,
        "conceptId": str(get_field(raw, "conceptId", "")),
        "explain": str(get_field(raw, "explain", "")),
        "misconception": str(raw.get("misconception") or ""),
        "bookSource": book_source(raw),
    }


def map_card(raw: dict, idx: int) -> dict:
    return {
        "id": str(get_field(raw, "id", f"k{idx + 1:02d}")),
        "front": str(get_field(raw, "front", "")),
        "back": str(get_field(raw, "back", "")),
        "chapterId": str(get_field(raw, "chapterId", "")),
        "tags": [str(t) for t in (get_field(raw, "tags", []) or [])],
    }


def map_glossary(raw: dict) -> dict:
    ch = get_field(raw, "chapterId", "")
    ch_ids = [str(x) for x in ch] if isinstance(ch, list) else ([str(ch)] if ch else [])
    return {
        "term": str(raw.get("term") or get_field(raw, "title", "")),
        "en": str(raw.get("en") or ""),
        "def": str(raw.get("def") or raw.get("definition") or get_field(raw, "brief", "")),
        "chapterIds": ch_ids,
    }


# 归档副本不算一本书：路径含这些标记的 manifest.json 一律排除（docs/schema.md 第二节）
EXCLUDED_MANIFEST_PARTS = ("_archive", "_backup", "archive", "backup", "旧版", "deprecated")

# 外链分流白名单（铁律 2 的正解：渲染结果不得在运行时发起网络请求）
RESERVED_HOSTS = ("example.com", "example.org", "example.net", "localhost", "127.0.0.1", "0.0.0.0")
XMLNS_RE = re.compile(r"xmlns(?::[A-Za-z]+)?\s*=\s*[\"']?\s*$")
URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+")


def classify_links(text: str, origin: str) -> tuple[list[dict], list[dict]]:
    """把正文里的 URL 分成 (白名单命中, 真外链)。

    白名单三类（docs/pitfalls.md 已验证 14）：xmlns 命名空间声明、代码块内 URL、
    example.com / localhost 等保留域名。其余算真外链，交付前要按铁律降级成纯文本。
    """
    allowed: list[dict] = []
    external: list[dict] = []
    fence = 0
    for line_no, line in enumerate(text.splitlines(), 1):
        fence += line.count("```")
        in_code = fence % 2 == 1
        for m in URL_RE.finditer(line):
            url = m.group(0)
            before = line[:m.start()]
            host = re.sub(r"^https?://", "", url).split("/")[0].lower()
            if XMLNS_RE.search(before):
                allowed.append({"kind": "xmlns", "url": url, "origin": origin, "line": line_no})
            elif in_code:
                allowed.append({"kind": "code-block", "url": url, "origin": origin, "line": line_no})
            elif any(host == h or host.endswith("." + h) for h in RESERVED_HOSTS):
                allowed.append({"kind": "reserved-domain", "url": url, "origin": origin, "line": line_no})
            else:
                external.append({
                    "kind": "external-link",
                    "url": url,
                    "origin": origin,
                    "line": line_no,
                    "context": line.strip()[:160],
                })
    return allowed, external


def strip_external_links(text: str, external: list[dict]) -> str:
    """真外链降级成纯文本：保留显示文字，去掉可点击链接，加离线标记。

    只在 `--link-policy strip` 时执行；默认 keep，正文原样入库、违规只记 `_report.json`。
    """
    if not external:
        return text
    out = text
    for item in external:
        url = item["url"]
        esc = re.escape(url)
        marker = "（原文链接，离线不可达）"
        out = re.sub(r"\[([^\]]*)\]\(" + esc + r"\)", r"\1" + marker, out)   # [文字](url) → 文字+标记
        out = re.sub(r"<" + esc + r">", url + marker, out)                    # <url> 自动链接
        out = re.sub(esc + r"(?!" + re.escape(marker[:6]) + ")", url + marker, out)  # 裸 URL
    return out


def parse_manifest(path: str) -> tuple[dict | None, str]:
    text, enc = read_text_file(path)
    if text is None:
        return None, enc
    try:
        return json.loads(text), enc
    except json.JSONDecodeError:
        try:
            return json.loads(text.replace("\\u002f", "/").replace("\\u002F", "/")), enc + "+u002F"
        except Exception as e:
            return None, f"jsonerror:{e.__class__.__name__}"


def extract_book(repo: str, discipline: str, mrel: str, manifest: dict, ctx: dict) -> dict:
    mdir = posixpath.dirname(mrel)
    slug = sanitize_slug(manifest.get("slug") or "") or sanitize_slug(os.path.basename(mdir)) or None
    raw_chapters, ch_key = pick_array(manifest, "chapters")
    raw_concepts, co_key = pick_array(manifest, "concepts")
    raw_quizzes, qu_key = pick_array(manifest, "quizzes")
    raw_cards, ca_key = pick_array(manifest, "cards")
    raw_gloss, gl_key = pick_array(manifest, "glossary")
    book_meta = manifest.get("book") if isinstance(manifest.get("book"), dict) else {}
    title = str(get_field(manifest, "title", "") or book_meta.get("title", ""))
    book = {
        "repo": repo,
        "bookSlug": slug,
        "title": title,
        "discipline": discipline,
        "homepage": ctx.get("homepage", ""),
        "contentLevel": "stats-only",
        "manifestPath": mrel,
        "stats": {
            "chapters": len(raw_chapters),
            "concepts": len(raw_concepts),
            "quizzes": len(raw_quizzes),
            "cards": len(raw_cards),
            "glossary": len(raw_gloss),
        },
        "chapters": [map_chapter(repo, slug or mdir, mdir, c, i, ctx) for i, c in enumerate(raw_chapters) if isinstance(c, dict)],
        "concepts": [map_concept(repo, slug or mdir, mdir, c, i, ctx) for i, c in enumerate(raw_concepts) if isinstance(c, dict)],
        "quizzes": [map_quiz(q, i, ctx, repo, slug or mdir) for i, q in enumerate(raw_quizzes) if isinstance(q, dict)],
        "cards": [map_card(c, i) for i, c in enumerate(raw_cards) if isinstance(c, dict)],
        "glossary": [map_glossary(g) for g in raw_gloss if isinstance(g, dict)],
        "sourceKeys": {"chapters": ch_key, "concepts": co_key, "quizzes": qu_key, "cards": ca_key, "glossary": gl_key},
    }
    if not book["title"]:
        book["title"] = book["bookSlug"] or mdir or repo
    return book


def grade_book(book: dict) -> str:
    have_md = sum(1 for c in book["chapters"] if c.get("origin", {}).get("path", "").endswith(".md"))
    if book["stats"]["chapters"] == 0 and book["stats"]["quizzes"] == 0:
        return "stats-only"
    return "full" if have_md else "degraded"


def attach_bodies(book: dict, repo_dir: str, ctx: dict, fetcher) -> None:
    """本地读 .md；缺失且允许兜底时走 raw。读不到的标 bodyType=missing，不伪造。"""
    got = 0
    for item, rel in ctx["want_files"]:
        local = os.path.join(repo_dir, rel.replace("/", os.sep))
        text, enc = read_text_file(local)
        if text is None:
            text = fetcher(book["repo"], rel)
            enc = "raw" if text else "missing"
        if text:
            item["body"] = text
            item["bodyType"] = "md"
            got += 1
            if enc not in ("utf-8", "utf-8-sig", "raw"):
                ctx["notes"].append(f"{book['repo']}:{book['bookSlug']}:{item['id']} 正文编码 {enc}")
        else:
            item["bodyType"] = "missing"
    ctx["bodies_ok"] = got


def strip_bodies(book: dict) -> dict:
    out = json.loads(json.dumps(book, ensure_ascii=False, default=str))
    for key in ("chapters", "concepts"):
        for item in out.get(key, []):
            item.pop("body", None)
    return out


def site_filename(repo: str, slug: str | None, single: bool) -> str:
    if single or not slug:
        return f"{repo}.json"
    return f"{repo}--{slug}.json"


def ensure_git_ssl(args: list[str]) -> list[str]:
    """本机全局 http.sslVerify=false，所有 git 调用显式覆盖回 true。"""
    return ["git", "-c", "http.sslVerify=true"] + args


# ---------------------------------------------------------------- raw 兜底

class RawFetcher:
    """未克隆/稀疏挡掉时的兜底：3 并发 + _work/cache/ + _work/state/ 断点。"""

    def __init__(self, *, concurrency: int = RAW_CONCURRENCY, use_state: bool = True):
        self.concurrency = max(1, concurrency)
        self.state_path = work_path(*STATE_SUBDIR.split("/"), "fetch-state.json")
        self.state: dict[str, dict] = {}
        self.hits = 0
        self.fetches = 0
        self.failures: list[str] = []
        self.use_state = use_state
        if use_state and os.path.exists(self.state_path):
            try:
                with open(self.state_path, "r", encoding="utf-8") as fh:
                    self.state = json.load(fh) or {}
            except Exception:
                self.state = {}

    def __call__(self, repo: str, rel: str) -> str | None:
        url = raw_url(repo, rel)
        if self.use_state:
            rec = self.state.get(url)
            if rec and rec.get("ok") and rec.get("cache") and os.path.exists(rec["cache"]):
                text, _ = read_text_file(rec["cache"])
                if text is not None:
                    self.hits += 1
                    return text
        res = http_get(url, use_cache=True)
        bin_path, _ = _cache_paths(url)
        body = res.get("body") or b""
        if res.get("status") == 200 and body:
            text, _enc = decode_bytes(body if isinstance(body, bytes) else body.encode("utf-8", "replace"))
            self.state[url] = {
                "ok": True,
                "bytes": res.get("bytes") or len(body),
                "cache": bin_path,
                "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
            self.fetches += 1
            return text
        self.state.setdefault(url, {"ok": False, "status": res.get("status"), "error": res.get("error")})
        self.failures.append(f"{repo}:{rel}:{res.get('status') or res.get('error')}")
        return None

    def save(self) -> None:
        if not self.use_state:
            return
        os.makedirs(os.path.dirname(self.state_path), exist_ok=True)
        with open(self.state_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(self.state, fh, ensure_ascii=False, indent=1, default=str)


# ---------------------------------------------------------------- Node 求值（degraded 内联）

NODE_EVAL = r"""
const fs = require('fs');
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const j of jobs) {
  const src = fs.readFileSync(j.file, 'utf8');
  try { out[j.key] = new Function('"use strict"; return (' + src + ');')(); }
  catch (e) { out[j.key] = { __error: String(e && e.message || e) }; }
}
process.stdout.write(JSON.stringify(out));
"""


def inline_bodies_via_node(repo: str, book: dict, ctx: dict) -> int:
    """sudoku 一类：index.html 里的 ZS.* 字面量 → 能 json 解析的直接用，解不了的送 Node 求值。

    实测要点：`ZS.lessons` 会出现**两次**（`ZS.lessons = (ZS.lessons||[]).concat([...])` 追加写法），
    必须把所有同名块合并（16 章 = 8 + 8），只取第一个会得到 8 章〔N〕。
    """
    index = os.path.join(work_path(*REPOS_SUBDIR.split("/")), repo, "index.html")
    text, _ = read_text_file(index)
    if not text:
        ctx["notes"].append(f"{repo} 无 index.html，内联正文未探到")
        return 0
    blocks = [b for b in scan_text(text, is_html=True, keep_snippet=True)
              if (b.get("var") or "").startswith("ZS.")]
    if not blocks:
        ctx["notes"].append(f"{repo} index.html 里没有 ZS.* 容器")
        return 0

    merged: dict[str, list] = {}
    pending: list[tuple[str, str]] = []        # (var, literal)
    jsdir = work_path(*STATE_SUBDIR.split("/"), "jslices")
    for b in blocks:
        var = b["var"]
        if isinstance(b.get("value"), list):
            merged.setdefault(var, []).extend(b["value"])
        elif b.get("snippet"):
            pending.append((var, b["snippet"]))

    if pending:
        os.makedirs(jsdir, exist_ok=True)
        jobs = []
        for i, (var, lit) in enumerate(pending):
            key = f"{repo}_{re.sub(r'[^0-9A-Za-z_]', '_', var)}_{i}"
            fp = os.path.join(jsdir, key + ".txt")
            with open(fp, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(lit)
            jobs.append({"key": key, "file": fp.replace(os.sep, "/")})
        spec = os.path.join(jsdir, f"{repo}_jobs.json")
        with open(spec, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(jobs, fh, ensure_ascii=False)
        runner = os.path.join(jsdir, "_eval.js")
        with open(runner, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(NODE_EVAL)
        try:
            import subprocess

            proc = subprocess.run(["node", runner, spec], capture_output=True, timeout=120)
            payload = json.loads(proc.stdout.decode("utf-8", "replace") or "{}")
            for (var, _lit), job in zip(pending, jobs):
                got = payload.get(job["key"])
                if isinstance(got, list):
                    merged.setdefault(var, []).extend(got)
                elif isinstance(got, dict) and got.get("__error"):
                    ctx["notes"].append(f"{repo} {var} Node 求值失败：{got['__error'][:80]}")
        except Exception as e:
            ctx["notes"].append(f"{repo} 内联正文 Node 求值失败：{type(e).__name__}: {e}")
        return 0 if not merged else _apply_inline(repo, book, merged, ctx)
    return _apply_inline(repo, book, merged, ctx)


def _apply_inline(repo: str, book: dict, merged: dict[str, list], ctx: dict) -> int:
    lessons = merged.get("ZS.lessons") or []
    by_id = {str(l.get("id")): l for l in lessons if isinstance(l, dict)}
    filled = 0
    for ch in book["chapters"]:
        src = by_id.get(ch["id"])
        if src and (src.get("body") or src.get("html")):
            ch["body"] = str(src.get("body") or src.get("html"))
            ch["bodyType"] = "html"
            filled += 1
    mis_inline = sum(1 for q in (merged.get("ZS.quizzes") or []) if isinstance(q, dict) and (q.get("mis") or q.get("misconception")))
    ctx["notes"].append(
        f"{repo} 内联正文：ZS.lessons 合并 {len(lessons)} 条，命中 {filled}/{len(book['chapters'])} 章"
        f"（HTML 片段，公式不可还原）；内联 `mis` 非空 {mis_inline} 条")
    return filled


# ---------------------------------------------------------------- 全量编排

def run_all(*, repos: list[str], catalog: dict[str, str], out_dir: str, bodies: bool,
            dry_run: bool, use_cache: bool, limit: int | None = None,
            link_policy: str = "keep") -> dict:
    base = out_dir if os.path.isabs(out_dir) else work_path(out_dir)
    fetcher = RawFetcher()
    books: list[dict] = []
    failures: list[dict] = []
    collisions: list[dict] = []
    unmapped: list[str] = []
    excluded_all: list[dict] = []
    sigs: dict[str, list[str]] = {}
    pending_repos: list[tuple[str, str]] = []
    cloned = set()
    rbase = work_path(*REPOS_SUBDIR.split("/"))
    if os.path.isdir(rbase):
        cloned = {n for n in os.listdir(rbase) if os.path.isdir(os.path.join(rbase, n))}

    for repo in repos:
        if limit and len(books) >= limit:
            break
        discipline = catalog.get(repo, "general")
        repo_dir = os.path.join(rbase, repo)
        ctx = {"notes": [], "want_files": [], "homepage": ""}
        if repo not in cloned:
            failures.append({"repo": repo, "bookSlug": None, "reason": "未克隆；本地无副本，批 1 未走 raw 全量兜底"})
            continue
        manifests, excluded = find_manifests(repo_dir)
        ctx["excludedManifests"] = excluded
        if not manifests:
            doc = ""
            for name in ("交付说明.md", "README.md", "index.md"):
                text, _ = read_text_file(os.path.join(repo_dir, name))
                if text:
                    doc = name
                    break
            failures.append({
                "repo": repo, "bookSlug": None,
                "reason": f"无 manifest.json（说明文件 {doc or '未探到'}）",
                "contentLevel": "stats-only",
            })
            pending_repos.append((repo, repo_dir))
            continue
        parsed: list[tuple[str, dict]] = []
        for mrel in manifests:
            obj, enc = parse_manifest(os.path.join(repo_dir, mrel.replace("/", os.sep)))
            if not isinstance(obj, dict):
                failures.append({"repo": repo, "bookSlug": None, "manifest": mrel,
                                 "reason": f"manifest 解析失败 {enc}"})
                continue
            parsed.append((mrel, obj))
        single = len(parsed) == 1
        used: dict[str, str] = {}
        for idx, (mrel, obj) in enumerate(parsed):
            ctx["want_files"] = []          # 逐本清空，否则同仓库前一本的正文路径会被重复回读
            book = extract_book(repo, discipline, mrel, obj, ctx)
            if not book["bookSlug"]:
                book["bookSlug"] = sanitize_slug(repo) if single else f"b{idx + 1:02d}"
                ctx["notes"].append(f"{repo}:{mrel} slug 缺失，回退序号 {book['bookSlug']}")
            slug = book["bookSlug"]
            if slug in used:
                collisions.append({"repo": repo, "slug": slug, "paths": [used[slug], mrel], "action": "skipped-later"})
                ctx["notes"].append(f"slug 冲突 {repo}::{slug} → 跳过后者，不覆盖")
                continue
            used[slug] = mrel
            book["bookSlug"] = slug
            book["file"] = site_filename(repo, slug, single)
            book["contentLevel"] = grade_book(book)
            read_ch = read_co = 0
            if bodies and book["contentLevel"] == "full":
                attach_bodies(book, repo_dir, ctx, fetcher)
                read_ch = sum(1 for c in book["chapters"] if c.get("body") and c.get("bodyType") == "md")
                read_co = sum(1 for c in book["concepts"] if c.get("body") and c.get("bodyType") == "md")
                if not (read_ch or read_co):
                    book["contentLevel"] = "degraded"
                    ctx["notes"].append(
                        f"{repo}:{book['bookSlug']} manifest 声明了 .md 但一本都没读到 → 降为 degraded")
            elif bodies and book["contentLevel"] == "degraded":
                inline_bodies_via_node(repo, book, ctx)   # 正文仍是 HTML，等级保持 degraded
            book["bodyCount"] = {
                "chapters": sum(1 for c in book["chapters"] if c.get("body")),
                "concepts": sum(1 for c in book["concepts"] if c.get("body")),
            }
            body_hash = hashlib.sha1("".join(
                (c.get("body") or "") for c in book["chapters"] + book["concepts"]
            ).encode("utf-8", "replace")).hexdigest()[:12] if (read_ch or read_co) else ""
            # 查重键不含 title：聚合仓常给书改名（ai-architecture-handbook 把 hello-ai 叫
            # 「AI 导论：Hello, AI」，章节 id 与计数完全一致），带 title 会漏判〔X〕
            book["signature"] = hashlib.sha1(json.dumps(
                [[c["id"] for c in book["chapters"]], book["stats"], body_hash],
                ensure_ascii=False).encode("utf-8")).hexdigest()[:12]
            book["contentHash"] = body_hash
            sigs.setdefault(book["signature"], []).append(f"{repo}::{book['bookSlug']}")
            books.append(book)
        if ctx.get("excludedManifests"):
            excluded_all.extend({"repo": repo, "path": p} for p in ctx["excludedManifests"])
        unmapped.extend(ctx["notes"])

    link_allowed: dict[str, int] = {}
    external_links: list[dict] = []
    stripped_books = 0
    if bodies:
        for book in books:
            touched = False
            for key in ("chapters", "concepts"):
                for item in book.get(key, []):
                    body = item.get("body") or ""
                    if "http" not in body:
                        continue
                    origin = f"{book['repo']}/{book['bookSlug']}/{item.get('id')}"
                    allowed, external = classify_links(body, origin)
                    for a in allowed:
                        link_allowed[a["kind"]] = link_allowed.get(a["kind"], 0) + 1
                    for e in external:
                        e["file"] = book.get("file", "")
                        external_links.append(e)
                    if external and link_policy == "strip":
                        item["body"] = strip_external_links(body, external)
                        touched = True
            if touched:
                stripped_books += 1

    pending_sources: list[dict] = []
    for repo, repo_dir in pending_repos:
        kinds: dict[str, int] = {}
        for dirpath, dirnames, filenames in os.walk(repo_dir):
            dirnames[:] = [d for d in dirnames if d not in NO_EXTENSIONS and not d.startswith(".")]
            for name in filenames:
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else "(no-ext)"
                if ext in ("csv", "txt", "json", "html", "md"):
                    kinds[ext] = kinds.get(ext, 0) + 1
        if kinds:
            pending_sources.append({"repo": repo, "files": kinds,
                                    "note": "无 manifest.json，需专用适配器（批 1 后续）"})

    levels = {"full": 0, "degraded": 0, "stats-only": 0}
    for b in books:
        levels[b["contentLevel"]] = levels.get(b["contentLevel"], 0) + 1
    duplicates = [{"signature": s, "books": bs} for s, bs in sigs.items() if len(bs) > 1]
    dup_sigs = {s for s, bs in sigs.items() if len(bs) > 1}
    for b in books:
        if b["signature"] in dup_sigs:
            b["duplicateGroup"] = b["signature"]
    disciplines = []
    for key in DISCIPLINE_TITLES:
        rs = sorted({b["repo"] for b in books if b["discipline"] == key})
        bs = [b for b in books if b["discipline"] == key]
        if rs or bs:
            disciplines.append({"key": key, "title": DISCIPLINE_TITLES[key],
                                "repoCount": len(rs), "siteCount": len(bs)})
    index = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "generator": GENERATOR,
        "schemaVersion": SCHEMA_VERSION,
        "totals": {
            "repos": len(repos),
            "sites": len(books),
            "sitesUnique": len(books) - sum(len(d["books"]) - 1 for d in
                                            ({"books": bs} for bs in sigs.values() if len(bs) > 1)),
            "chapters": sum(b["stats"]["chapters"] for b in books),
            "concepts": sum(b["stats"]["concepts"] for b in books),
            "quizzes": sum(b["stats"]["quizzes"] for b in books),
            "cards": sum(b["stats"]["cards"] for b in books),
            "glossary": sum(b["stats"]["glossary"] for b in books),
        },
        "contentLevels": levels,
        "disciplines": disciplines,
        "sites": [{k: b[k] for k in ("repo", "bookSlug", "title", "discipline", "file", "contentLevel", "stats")}
                  for b in books],
        "failures": failures,
    }
    report = {
        "generatedAt": index["generatedAt"],
        "mode": "all" + ("+bodies" if bodies else "-structure-only"),
        "outDir": out_dir,
        "dryRun": dry_run,
        "totals": index["totals"],
        "contentLevels": levels,
        "slugCollisions": collisions,
        "excludedManifests": excluded_all,
        "duplicates": duplicates,
        "links": {"policy": link_policy, "allowed": link_allowed,
                  "external": len(external_links), "booksStripped": stripped_books},
        "externalLinks": external_links[:200],
        "pendingSources": pending_sources,
        "unmappedAndNotes": unmapped,
        "rawFallback": {"fetches": fetcher.fetches, "cacheHits": fetcher.hits,
                        "failures": fetcher.failures[:80], "concurrency": fetcher.concurrency},
        "notInCatalog": sorted({b["repo"] for b in books} - set(catalog)),
        "notCloned": [f["repo"] for f in failures if f.get("reason", "").startswith("未克隆")],
    }
    fetcher.save()
    return {"index": index, "books": books, "report": report, "base": base}


def write_outputs(bundle: dict, *, bodies: bool) -> dict:
    base = bundle["base"]
    sites_dir = os.path.join(base, "sites")
    dist_dir = os.path.join(base, "dist")
    bodies_dir = os.path.join(base, "bodies")
    counts = {"sites": 0, "bodies": 0, "dist": 0}
    if not os.path.isdir(sites_dir):
        os.makedirs(sites_dir, exist_ok=True)
    if bodies and not os.path.isdir(bodies_dir):
        os.makedirs(bodies_dir, exist_ok=True)
    os.makedirs(dist_dir, exist_ok=True)
    for book in bundle["books"]:
        payload = dict(book)
        filename = payload.pop("file", None) or site_filename(book["repo"], book["bookSlug"], True)
        if bodies:
            body_doc = {"repo": book["repo"], "bookSlug": book["bookSlug"], "chapters": {}, "concepts": {}}
            for key in ("chapters", "concepts"):
                for item in book.get(key, []):
                    if item.get("body"):
                        body_doc[key][item["id"]] = {"bodyType": item.get("bodyType"), "body": item["body"]}
            if body_doc["chapters"] or body_doc["concepts"]:
                with open(os.path.join(bodies_dir, filename), "w", encoding="utf-8", newline="\n") as fh:
                    json.dump(body_doc, fh, ensure_ascii=False, indent=1)
                counts["bodies"] += 1
            for key in ("chapters", "concepts"):
                for item in payload.get(key, []):
                    item.pop("body", None)
        with open(os.path.join(sites_dir, filename), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        counts["sites"] += 1
    shards: dict[str, dict] = {}
    for book in bundle["books"]:
        key = book["discipline"]
        shard = shards.setdefault(key, {"discipline": key, "sites": []})
        shard["sites"].append(strip_bodies(book))
    for key, shard in shards.items():
        with open(os.path.join(dist_dir, f"{key}.json"), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(shard, fh, ensure_ascii=False, indent=1)
        counts["dist"] += 1
    with open(os.path.join(base, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(bundle["index"], fh, ensure_ascii=False, indent=2)
    with open(os.path.join(base, "_report.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(bundle["report"], fh, ensure_ascii=False, indent=2)
    return counts


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")  # Windows 默认 cp936 会炸中文
    ap = argparse.ArgumentParser(
        prog="extract.py",
        description="知枢矩阵抽取器。本轮只实现 --probe（3 站探路）。",
    )
    ap.add_argument("--probe", action="store_true", help="只探 3 个代表站，打印结构差异")
    ap.add_argument("--all", action="store_true", help="全量抽取（批 1 主体）：一书一条，写 sites/dist/manifest/_report")
    ap.add_argument("--repo", action="append", default=[], help="限定仓库，可重复")
    ap.add_argument("--json", action="store_true", help="结构化结果打到 stdout")
    ap.add_argument("--no-cache", action="store_true", help="强制重抓，忽略 _work/cache/")
    ap.add_argument("--bodies", action="store_true", help="抽正文：full 读本地 .md，degraded 走 Node 求值（默认只抽结构）")
    ap.add_argument("--out-dir", default="data", help="产出目录，默认 data/；验证用 _work/data-dry")
    ap.add_argument("--dry-run", action="store_true", help="只算不写，打印将要产出的条目")
    ap.add_argument("--limit", type=int, default=None, help="最多产出多少本书（试跑用）")
    ap.add_argument("--link-policy", choices=["keep", "strip"], default="keep",
                    help="真外链处理：keep 只记 _report.json 的 externalLinks；strip 正文降级为纯文本")
    args = ap.parse_args(argv)

    if args.probe and args.all:
        sys.exit("--probe 与 --all 互斥")

    if args.all:
        catalog = load_site_catalog()
        repos = args.repo or list_repos(catalog)
        if args.repo:
            unknown = [r for r in args.repo if r not in catalog and r not in list_repos(catalog)]
            if unknown:
                sys.exit(f"--repo 含未知仓库: {unknown}")
        if not catalog:
            sys.exit(f"读不到仓库清单：{SITES_MD}（硬约束要求不写死站名清单）")
        bundle = run_all(repos=repos, catalog=catalog, out_dir=args.out_dir, bodies=args.bodies,
                         dry_run=args.dry_run, use_cache=not args.no_cache, limit=args.limit,
                         link_policy=args.link_policy)
        counts = None if args.dry_run else write_outputs(bundle, bodies=args.bodies)
        index, report = bundle["index"], bundle["report"]
        p(f"all @ {index['generatedAt']} · 模式={report['mode']} · 产出目录={bundle['base']}"
          f"{'（dry-run 未写文件）' if args.dry_run else ''}")
        p(f"代理已禁用（ProxyHandler({{}})）· 中文路径逐段 URL 编码 · git 调用一律 -c http.sslVerify=true")
        p(f"仓库 {index['totals']['repos']} · 书条目 {index['totals']['sites']}（去重 {index['totals']['sitesUnique']}）· "
          f"章 {index['totals']['chapters']} · 概念 {index['totals']['concepts']} · "
          f"题 {index['totals']['quizzes']} · 卡 {index['totals']['cards']} · 术语 {index['totals']['glossary']}")
        p(f"contentLevels={index['contentLevels']} · 失败 {len(index['failures'])} · "
          f"slug 冲突 {len(report['slugCollisions'])} · 跨仓重复组 {len(report['duplicates'])} · "
          f"排除归档 manifest {len(report['excludedManifests'])} · raw 兜底 {report['rawFallback']['fetches']} 次"
          f"（命中缓存 {report['rawFallback']['cacheHits']}）")
        if counts:
            p(f"已写出 sites={counts['sites']} bodies={counts['bodies']} dist={counts['dist']}")
        lk = report["links"]
        p(f"外链：白名单 {json.dumps(lk['allowed'], ensure_ascii=False)} · 真外链 {lk['external']} 条"
          f"（policy={lk['policy']}，降级 {lk['booksStripped']} 本）· 待适配器站 {len(report['pendingSources'])} 个")
        if args.json:
            sys.stdout.buffer.write(json.dumps({"index": index, "report": report},
                                               ensure_ascii=False, indent=2, default=str).encode("utf-8"))
        else:
            for f in index["failures"][:12]:
                p(f"  FAIL {f['repo']:34s} {f['reason']}")
            for note in report["unmappedAndNotes"][:12]:
                p(f"  NOTE {note[:150]}")
            if len(index["failures"]) > 12 or len(report["unmappedAndNotes"]) > 12:
                p(f"  …其余见 {args.out_dir}/_report.json")
        return 0

    if args.repo and not args.probe:
        sys.exit("需要 --probe 或 --all 之一")

    repos = args.repo or PROBE_REPOS
    if args.probe:
        bad = [r for r in repos if r not in PROBE_REPOS]
        if bad:
            sys.exit(f"--probe 只覆盖 3 个代表站 {PROBE_REPOS}，未知仓库: {bad}")

    use_cache = not args.no_cache
    results = []
    for repo in repos:
        partial = {"repo": repo, "notes": [], "tree": {}, "candidates": []}
        try:
            results.append(probe_repo(repo, use_cache=use_cache, result=partial))
        except Exception as e:  # 单站失败不中断（schema.md 四、容错）
            import traceback

            tb = traceback.format_exc().strip().splitlines()
            partial["notes"].append(
                f"probe 异常（已探部分保留）: {type(e).__name__}: {e} | "
                f"{tb[-3].strip() if len(tb) > 3 else ''} {tb[-2].strip() if len(tb) > 2 else ''}"
            )
            results.append(partial)

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "generator": "tools/extract.py --probe",
        "owner": OWNER,
        "branch": BRANCH,
        "cacheDir": CACHE_SUBDIR,
        "useCache": use_cache,
        "results": results,
    }
    if args.json:
        sys.stdout.buffer.write(
            json.dumps(summary, ensure_ascii=False, indent=2, default=str).encode("utf-8")
        )
    else:
        p(f"probe @ {summary['generatedAt']} · owner={OWNER} branch={BRANCH} · cache={'on' if use_cache else 'off'} ({CACHE_SUBDIR})")
        p(f"代理: 已显式禁用（ProxyHandler({{}})）· 路径逐段 URL 编码")
        print_human(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
