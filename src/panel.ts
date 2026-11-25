import type { BookRecord, SiteEntry } from './types';
import { ROOM_BY_KEY } from './config';

const LEVEL_TEXT: Record<string, string> = {
  full: '正文可读（Markdown）',
  degraded: '正文为成品 HTML，公式不可还原',
  'stats-only': '仅计数，点下方原站入口',
};

let current: SiteEntry | null = null;

export function openBook(book: SiteEntry, record: BookRecord | null): void {
  current = book;
  const panel = document.getElementById('panel');
  const title = document.getElementById('panel-title');
  const body = document.getElementById('panel-body');
  if (!panel || !title || !body) return;
  const spec = ROOM_BY_KEY[book.discipline];
  title.textContent = book.title || book.bookSlug;
  const chapters = record?.chapters ?? [];
  body.textContent = '';

  const meta = el('div');
  meta.appendChild(badge(book.contentLevel, spec.color));
  meta.appendChild(txt('span', ` ${book.repo} · ${book.bookSlug}`));
  body.appendChild(meta);

  body.appendChild(head('概况'));
  const grid = el('div', 'statgrid');
  for (const [k, v] of Object.entries(book.stats)) {
    const cell = el('div');
    cell.appendChild(numEl(String(v), k));
    grid.appendChild(cell);
  }
  body.appendChild(grid);
  body.appendChild(el('p', '', LEVEL_TEXT[book.contentLevel] ?? ''));

  if (chapters.length) {
    body.appendChild(head(`章节 ${chapters.length}`));
    const ul = el('ul', 'chaplist');
    for (const ch of chapters.slice(0, 200)) {
      const li = document.createElement('li');
      li.appendChild(spanCls('n', ch.num === null || ch.num === undefined ? '—' : String(ch.num)));
      li.appendChild(txt('span', ch.title || ch.id));
      ul.appendChild(li);
    }
    body.appendChild(ul);
    if (chapters.length > 200) body.appendChild(el('p', '', `其余 ${chapters.length - 200} 章略`));
  }

  body.appendChild(head('阅读层'));
  body.appendChild(
    el(
      'p',
      '',
      '正文渲染与公式排版属批 3；骨架阶段只列结构。原站：' +
        `https://zrx-11.github.io/${book.repo}/（离线不可达，仅记录路径）`,
    ),
  );
  panel.hidden = false;
}

export function closePanel(): void {
  current = null;
  const panel = document.getElementById('panel');
  if (panel) panel.hidden = true;
}

export const openedBook = (): SiteEntry | null => current;

function el(tag: string, cls = '', textContent = ''): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (textContent) node.textContent = textContent;
  return node;
}

function txt(tag: string, s: string): HTMLElement {
  return el(tag, '', s);
}

function spanCls(cls: string, s: string): HTMLElement {
  return el('span', cls, s);
}

function head(s: string): HTMLElement {
  return el('h3', '', s);
}

function numEl(v: string, k: string): HTMLElement {
  const b = document.createElement('b');
  b.textContent = v;
  const span = document.createElement('span');
  span.textContent = {
    chapters: '章',
    concepts: '概念',
    quizzes: '题',
    cards: '卡',
    glossary: '术语',
  }[k] ?? k;
  const wrap = document.createElement('span');
  wrap.append(b, span);
  return wrap;
}

function badge(level: string, color: string): HTMLElement {
  const b = el('span', `badge ${level}`, level);
  b.style.color = color;
  return b;
}
