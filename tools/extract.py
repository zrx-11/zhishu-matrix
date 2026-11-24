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


def scan_text(text: str, *, is_html: bool) -> list[dict]:
    """从 HTML/JS 文本里提取所有「看起来是数据容器」的赋值。"""
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

def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")  # Windows 默认 cp936 会炸中文
    ap = argparse.ArgumentParser(
        prog="extract.py",
        description="知枢矩阵抽取器。本轮只实现 --probe（3 站探路）。",
    )
    ap.add_argument("--probe", action="store_true", help="只探 3 个代表站，打印结构差异")
    ap.add_argument("--all", action="store_true", help="全量抓取（批 1 主体，未实现）")
    ap.add_argument("--repo", action="append", default=[], help="限定仓库，可重复")
    ap.add_argument("--json", action="store_true", help="结构化结果打到 stdout")
    ap.add_argument("--no-cache", action="store_true", help="强制重抓，忽略 _work/cache/")
    args = ap.parse_args(argv)

    if args.all:
        sys.exit("not implemented: --all 属批 1 主体，本轮只交付 --probe")
    if args.repo and not args.probe:
        sys.exit("not implemented: 非 probe 的 --repo 属批 1 主体")

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
