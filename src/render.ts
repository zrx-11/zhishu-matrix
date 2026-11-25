import katex from 'katex';
import MarkdownIt from 'markdown-it';
import type { StateBlock, StateInline } from 'markdown-it';
import 'katex/dist/katex.min.css';

// 铁律 2：渲染结果运行时不发请求。markdown-it 开 html（库内有 37 处内联 SVG 图示），
// 但输出前一律过 sanitizeHtml()：外链降级为纯文本、危险标签与属性剔除。
const md = new MarkdownIt({ html: true, linkify: false, breaks: false, typographer: false });

const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'noscript', 'template',
]);
const URL_ATTRS = ['href', 'src', 'xlink:href', 'srcset', 'action', 'poster', 'data', 'background'];

function isRemoteUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith('data:') || v.startsWith('#') || v.startsWith('/')) return false;
  return /^[a-z][a-z0-9+.-]*:/.test(v) && !v.startsWith('blob:');
}

/**
 * mermaid 产出的 SVG 专用消毒：与 sanitizeHtml 同规则，但保留 `<style>`
 * ——mermaid 的连线/文字样式写在 SVG 内嵌 style 里，剔掉就成了无色不可读图。
 */
export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(`<body>${svg}</body>`, 'text/html');
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'script') {
      node.remove();
      continue;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      else if (name.startsWith('xmlns')) continue;
      else if (URL_ATTRS.includes(name) && isRemoteUrl(attr.value)) node.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}

/** 真外链 → 纯文本 + 标注，点击不发起请求（docs/schema.md 铁律、批 3 判据 C4） */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    const tag = node.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      node.replaceWith(doc.createTextNode(node.textContent ?? ''));
      continue;
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      // xmlns 是命名空间声明，浏览器不会去取；xmlns:xlink 同理（铁律 2 白名单第 1 类）
      else if (name.startsWith('xmlns')) continue;
      else if (URL_ATTRS.includes(name) && isRemoteUrl(attr.value)) node.removeAttribute(attr.name);
    }
    if (tag === 'a' && !node.getAttribute('href')) {
      const label = doc.createElement('span');
      label.className = 'ext-link';
      label.textContent = `${node.textContent ?? ''}（原文链接，已保留未加载）`;
      node.replaceWith(label);
    }
  }
  return doc.body.innerHTML;
}

// ---------------------------------------------------------------- KaTeX 双定界符

function katexHtml(tex: string, displayMode: boolean, original: string): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      errorColor: '#e0a83a',
      strict: false,
      trust: false,
      output: 'html',
    });
  } catch {
    // 渲染失败保留原始文本，不吞内容
    return `<span class="math-raw">${escapeText(original)}</span>`;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findInlineEnd(src: string, start: number, close: string): number {
  let i = start;
  while (i < src.length) {
    const at = src.indexOf(close, i);
    if (at < 0) return -1;
    if (src[at - 1] !== '\\') return at;
    i = at + close.length;
  }
  return -1;
}

/** 行内：`$...$` 与 `\(...\)`；闭定界符必须在同一行，`\$` 视为转义 */
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src[pos] === '\\') {
    if (src[pos + 1] !== '(') return false;
    const end = findInlineEnd(src, pos + 2, '\\)');
    if (end < 0 || src.slice(pos, end).includes('\n')) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = src.slice(pos + 2, end);
      token.markup = '\\(';
    }
    state.pos = end + 2;
    return true;
  }
  if (src[pos] !== '$' || src[pos + 1] === '$') return false;
  const end = findInlineEnd(src, pos + 1, '$');
  if (end < 0 || src.slice(pos, end).includes('\n')) return false;
  const body = src.slice(pos + 1, end);
  if (!body.trim() || body.startsWith(' ') || body.endsWith(' ')) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = body;
    token.markup = '$';
  }
  state.pos = end + 1;
  return true;
}

/** 行间：`$$...$$` 与 `\[...\]`，可跨行 */
function mathBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(start, state.eMarks[startLine]).trim();
  let close: string;
  let markup: string;
  if (line.startsWith('$$')) {
    markup = '$$';
    close = '$$';
  } else if (line.startsWith('\\[')) {
    markup = '\\[';
    close = '\\]';
  } else return false;

  const firstLineBody = line.slice(2).trim();
  if (firstLineBody.endsWith(close) && firstLineBody.length > close.length && !silent) {
    const token = state.push('math_block', 'math', 0);
    token.content = firstLineBody.slice(0, -close.length).trim();
    token.map = [startLine, startLine + 1];
    token.markup = markup;
    state.line = startLine + 1;
    return true;
  }

  let lineNo = startLine;
  let found = -1;
  while (lineNo < endLine) {
    const from = lineNo === startLine ? start + 2 : state.bMarks[lineNo] + state.tShift[lineNo];
    const at = state.src.indexOf(close, from);
    if (at >= 0) {
      found = lineNo;
      break;
    }
    lineNo += 1;
  }
  if (found < 0) return false;
  if (!silent) {
    const bodyEnd = state.eMarks[found] - close.length;
    const token = state.push('math_block', 'math', 0);
    token.content = state.src.slice(start + 2, bodyEnd).trim();
    token.map = [startLine, found + 1];
    token.markup = markup;
  }
  state.line = found + 1;
  return true;
}

md.inline.ruler.before('emphasis', 'math_inline', mathInline);
md.block.ruler.before('paragraph', 'math_block', mathBlock, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
});

md.renderer.rules.math_inline = (tokens, idx) =>
  katexHtml(tokens[idx].content, false, tokens[idx].content);
md.renderer.rules.math_block = (tokens, idx) =>
  katexHtml(tokens[idx].content, true, tokens[idx].content);

// ---------------------------------------------------------------- 围栏代码

/**
 * Mermaid 围栏只出占位容器（判据 A2）：源码留在折叠区里保底，
 * 可见时由 `diagram.ts` 动态引入 mermaid 换成 SVG，换不成就一直显示这段源码。
 */
function diagramBlock(code: string): string {
  return (
    '<div class="diagram" data-diagram="pending">' +
    '<div class="diagram-cap">图示 · Mermaid（本地渲染，滚动到此处自动出图）</div>' +
    '<div class="diagram-view"></div>' +
    `<details class="diagram-srcbox"><summary>图示源码</summary><pre class="code diagram-src"><code>${code}</code></pre></details>` +
    '</div>'
  );
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = (token.info || '').trim().split(/\s+/)[0];
  const code = escapeText(token.content);
  if (lang === 'mermaid') return diagramBlock(code);
  return `<div class="codeblock"><div class="code-lang">${escapeText(lang || 'text')}</div><pre class="code"><code>${code}</code></pre></div>`;
};

// ---------------------------------------------------------------- 对外接口

export type Rendered = {
  html: string;
  mathCount: number;
  formulaFallbacks: number;
  diagramCount: number;
};

/** Markdown 正文（`bodyType: "md"`）→ 已消毒 HTML */
export function renderMarkdown(src: string): Rendered {
  const raw = md.render(src);
  const html = sanitizeHtml(raw);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    html,
    mathCount: doc.querySelectorAll('.katex').length,
    formulaFallbacks: doc.querySelectorAll('.math-raw').length,
    diagramCount: doc.querySelectorAll('.diagram[data-diagram]').length,
  };
}

/** 成品 HTML 片段（`bodyType: "html"`，degraded 站）：不过 markdown-it，直接消毒注入 */
export function renderHtmlFragment(src: string): Rendered {
  const html = sanitizeHtml(src);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    html,
    mathCount: doc.querySelectorAll('.katex').length,
    formulaFallbacks: 0,
    diagramCount: doc.querySelectorAll('.diagram[data-diagram]').length,
  };
}

/** 正文里是否带 `\(...\)` / `\[...\]` 定界符，供「双定界符已生效」自检用 */
export function hasLatexDelimiters(src: string): boolean {
  return src.includes('\\(') || src.includes('\\[');
}

export function plainText(src: string): string {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  return doc.body.textContent ?? '';
}
