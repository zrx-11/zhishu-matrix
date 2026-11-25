import { loadBody } from './data';
import { forgetDiagrams, hydrateDiagrams } from './diagram';
import { renderHtmlFragment, renderMarkdown } from './render';
import type { BodyEntry, BodyFile, BookRecord, BookStats, ContentLevel, SiteEntry } from './types';

export interface PanelHooks {
  onHud(text: string): void;
  /** 关闭阅读层时由 main 恢复原书节点与相机位姿（判据 C5） */
  onClose(): void;
  /** 概念正文切到前台时通知 3D 高亮对应光点 */
  onConceptShown?(conceptId: string | null): void;
}

const LEVEL_NOTE: Record<ContentLevel, string> = {
  full: '正文来自 data/bodies/，Markdown 原文 + KaTeX 排版',
  degraded:
    '降级档 · 可做题、无原始 Markdown 正文：读到的是成品 HTML 片段，公式已烤成节点不可还原（docs/schema.md 第三节）',
  'stats-only': '仅有计数与来源，库内无可读正文，不渲染空正文',
};

const STAT_LABEL: Record<string, string> = {
  chapters: '章',
  concepts: '概念',
  quizzes: '题',
  cards: '卡',
  glossary: '术语',
};

const els = {
  panel: document.getElementById('panel'),
  title: document.getElementById('panel-title'),
  crumb: document.getElementById('panel-crumb'),
  body: document.getElementById('panel-body'),
  back: document.getElementById('panel-back') as HTMLButtonElement | null,
};

let hooks: PanelHooks = { onHud: () => undefined, onClose: () => undefined, onConceptShown: () => undefined };
let book: SiteEntry | null = null;
let record: BookRecord | null = null;
let body: BodyFile | null = null;
let bodyFailed = false;
let mode: 'closed' | 'overview' | 'chapter' | 'concept' = 'closed';
let openId: string | null = null;
let loadedBodies = 0;

export function configurePanel(next: PanelHooks): void {
  hooks = next;
}

export const panelOpen = (): boolean => mode !== 'closed';
export const loadedBodyCount = (): number => loadedBodies;
export const openedBook = (): SiteEntry | null => book;
export const viewMode = (): string => mode;

/** 书的总览：只取结构，正文留到点章节 / 概念时才取（判据 C1） */
export function openBook(entry: SiteEntry, struct: BookRecord | null): void {
  book = entry;
  record = struct;
  body = null;
  bodyFailed = false;
  openId = null;
  mode = 'overview';
  show(true);
  renderOverview();
}

export async function openChapter(chapterId: string): Promise<void> {
  if (!book) return;
  mode = 'chapter';
  openId = chapterId;
  hooks.onConceptShown?.(null);
  const chapters = record?.chapters ?? [];
  const index = chapters.findIndex((c) => c.id === chapterId);
  const chapter = index < 0 ? null : chapters[index];
  showCrumb(chapter?.title || chapterId);
  if (!(await ensureBody())) return;
  if (!chapter) {
    setBody('<div class="degrade-bar">该章不在结构索引里，抽取器未收录该 id。</div>');
    return;
  }
  if (book.contentLevel === 'stats-only') {
    setBody(statsOnlyBody());
    return;
  }
  const entry: BodyEntry | undefined = body?.chapters?.[chapterId];
  const kind = entry?.bodyType ?? chapter.bodyType ?? 'md';
  const text = (entry?.body || '').trim();
  if (!text) {
    setBody(noBodyBody(entry));
    return;
  }
  const rendered = kind === 'html' ? renderHtmlFragment(text) : renderMarkdown(text);
  setBody(
    (kind === 'html' ? bar('正文为成品 HTML，公式不可还原') : '') +
      rendered.html +
      conceptChips(chapter.conceptIds ?? []) +
      footer(renderInfo(rendered), index),
  );
  hooks.onHud(
    `${book.title || book.bookSlug} · ${chapter.title || chapterId} · ${renderInfo(rendered)}`,
  );
}

/** 概念正文：光点拾取与章内概念条都走这里（阶段 C 追加项 6） */
export async function openConcept(conceptId: string): Promise<void> {
  if (!book) return;
  mode = 'concept';
  openId = conceptId;
  hooks.onConceptShown?.(conceptId);
  const concept = (record?.concepts ?? []).find((c) => c.id === conceptId);
  showCrumb(concept?.title || conceptId);
  if (!(await ensureBody())) return;
  if (!concept) {
    setBody('<div class="degrade-bar">该概念不在结构索引里。</div>');
    return;
  }
  if (book.contentLevel === 'stats-only') {
    setBody(statsOnlyBody());
    return;
  }
  const entry = body?.concepts?.[conceptId];
  const text = (entry?.body || concept.depth || '').trim();
  if (!text) {
    setBody(
      bar('该概念无可读正文 · 深度推导字段实测很稀（`depth` 为空即不渲染空壳）') +
        `<p>${esc(concept.brief ?? '')}</p>` +
        conceptChain(concept.prerequisites ?? []) +
        footer('正文条目缺失', -1),
    );
    return;
  }
  const kind = entry?.bodyType ?? 'md';
  const rendered = kind === 'html' ? renderHtmlFragment(text) : renderMarkdown(text);
  const fromChapter = (concept.chapterIds ?? [])[0];
  setBody(
    (kind === 'html' ? bar('正文为成品 HTML，公式不可还原') : '') +
    `<div class="meta"><span class="badge concept">概念 ${esc(conceptId)}</span>` +
    `<span class="dim">前置 ${concept.prerequisites?.length ?? 0} 条 · 关联章 ${(concept.chapterIds ?? []).length} 处</span></div>` +
    rendered.html +
    conceptChain(concept.prerequisites ?? []) +
    (fromChapter
      ? `<p class="dim">出自本章：<button type="button" class="linklike" data-chapter="${esc(fromChapter)}">回到章节正文</button></p>`
      : '') +
    footer(renderInfo(rendered), -1),
  );
  hooks.onHud(`${book.title || book.bookSlug} · 概念 ${concept.title || conceptId}`);
}

/** 由 3D 光点进入：先补齐书与结构，再进概念 */
export function openConceptOf(
  entry: SiteEntry,
  struct: BookRecord | null,
  conceptId: string,
): Promise<void> {
  if (book?.bookSlug !== entry.bookSlug || book?.repo !== entry.repo) {
    book = entry;
    record = struct;
    body = null;
    bodyFailed = false;
    show(true);
    setTitle(entry.title || entry.bookSlug);
  }
  return openConcept(conceptId);
}

export function showOverview(): void {
  if (!book) return;
  mode = 'overview';
  openId = null;
  hooks.onConceptShown?.(null);
  renderOverview();
}

export function closePanel(): void {
  mode = 'closed';
  openId = null;
  hooks.onConceptShown?.(null);
  show(false);
  hooks.onClose();
}

/** 章 / 概念 → 总览 → 空间 */
export function goBack(): void {
  if (mode === 'closed') return;
  if (mode === 'overview') closePanel();
  else showOverview();
}

// ---------------------------------------------------------------- 三档分流

async function ensureBody(): Promise<boolean> {
  if (body || bodyFailed || !book) return Boolean(body);
  if (book.contentLevel === 'stats-only') return true;
  setBody(`<p class="dim">正文加载中… data/bodies/${esc(book.file)}</p>`);
  try {
    body = await loadBody(book.file);
    loadedBodies += 1;
    return true;
  } catch {
    bodyFailed = true;
    setBody(
      bar('正文取不到') +
        `<p class="dim">data/bodies/${esc(book.file)} 未能读取；结构索引仍可用。</p>` +
        '<p><button type="button" data-nav="overview">返回书籍总览</button></p>',
    );
    return false;
  }
}

function renderOverview(): void {
  if (!book) return;
  const chapters = record?.chapters ?? [];
  const concepts = record?.concepts ?? [];
  const st: Partial<BookStats> = book.stats ?? {};
  const degradedInline = chapters.filter((c) => c.bodyType === 'html').length;
  setTitle(book.title || book.bookSlug);
  showCrumb(null);
  const parts = [
    `<div class="meta"><span class="badge ${esc(book.contentLevel)}">${esc(book.contentLevel)}</span>` +
      `<span class="dim">${esc(book.repo)} · ${esc(book.bookSlug)}</span></div>`,
    '<h3>概况</h3>',
    `<div class="statgrid">${Object.entries(st)
      .map(([k, v]) => `<div><b>${Number(v)}</b><span>${STAT_LABEL[k] ?? k}</span></div>`)
      .join('')}</div>`,
    `<p class="dim">${LEVEL_NOTE[book.contentLevel as ContentLevel] ?? ''}</p>`,
  ];
  if (book.contentLevel === 'degraded') {
    parts.push(
      bar(
        `可做题、无原始 Markdown 正文 · 本站 ${Number(st.quizzes ?? 0)} 道题、${Number(st.cards ?? 0)} 张卡；` +
          `已抽到的 ${degradedInline} 章正文为成品 HTML，公式不可还原`,
      ),
    );
  }
  if (book.contentLevel === 'stats-only') parts.push(bar(LEVEL_NOTE['stats-only']));

  parts.push(`<h3>章节 ${chapters.length}</h3>`);
  if (!chapters.length) parts.push('<p class="dim">索引未收录章节。</p>');
  else {
    const level = book.contentLevel;
    parts.push('<ul class="chaplist">');
    chapters.forEach((ch, i) => {
      const tag =
        level === 'stats-only'
          ? '计数'
          : (body?.chapters?.[ch.id]?.body || (ch as { body?: string }).body || '').trim()
            ? '正文'
            : '无正文';
      parts.push(
        `<li><button type="button" class="chap" data-idx="${i}">` +
          `<span class="n">${ch.num === null || ch.num === undefined ? '—' : esc(String(ch.num))}</span>` +
          `<span class="t">${esc(ch.title || ch.id)}</span><span class="tag">${tag}</span></button></li>`,
      );
    });
    parts.push('</ul>');
  }
  if (concepts.length) {
    parts.push(`<h3>概念 ${concepts.length}</h3><div class="chips">`);
    parts.push(
      concepts
        .map((c) => `<button type="button" class="chip" data-concept="${esc(c.id)}">${esc(c.title || c.id)}</button>`)
        .join(''),
    );
    parts.push('</div>');
  }
  parts.push(
    `<h3>来源</h3><p class="dim">原站 ${esc(String(book.homepage ?? '')) || '未记录'} —— 原文链接，离线不可达。` +
      `<br>正文文件 data/bodies/${esc(book.file)}</p>`,
  );
  setBody(parts.join(''));
  hooks.onHud(`${book.title || book.bookSlug} · ${chapters.length} 章 · 点章节进阅读页`);
}

function noBodyBody(entry: BodyEntry | undefined): string {
  const st: Partial<BookStats> = book?.stats ?? {};
  return (
    bar('本章无可读正文 · 可做题、无正文') +
    `<p>全书统计：${Number(st.chapters ?? 0)} 章 / ${Number(st.quizzes ?? 0)} 题 / ` +
    `${Number(st.cards ?? 0)} 卡 / ${Number(st.glossary ?? 0)} 术语。</p>` +
    `<p class="dim">该条 bodyType=${esc(String(entry?.bodyType ?? '未记录'))}${
      bodyFailed ? '，正文文件未取到' : '，body 为空串'
    }。缺失原因见 data/_report.json。</p>` +
    footer('', -1)
  );
}

function statsOnlyBody(): string {
  const st: Partial<BookStats> = book?.stats ?? {};
  return (
    bar('仅计数，无正文') +
    `<p>${esc(String(book?.title ?? ''))} 只抽到计数：${Number(st.chapters ?? 0)} 章 / ` +
    `${Number(st.concepts ?? 0)} 概念 / ${Number(st.quizzes ?? 0)} 题 / ${Number(st.cards ?? 0)} 卡。</p>` +
    `<p class="dim">来源：${esc(String(book?.homepage ?? '')) || '未记录'} —— 原文链接，离线不可达，点击不发起请求。</p>` +
    footer('', -1)
  );
}

function conceptChips(ids: string[]): string {
  const concepts = record?.concepts ?? [];
  const hit = concepts.filter((c) => ids.includes(c.id));
  if (!hit.length) return '';
  return (
    `<h3>本章概念 ${hit.length}</h3><div class="chips">` +
    hit.map((c) => `<button type="button" class="chip" data-concept="${esc(c.id)}">${esc(c.title || c.id)}</button>`).join('') +
    '</div>'
  );
}

function conceptChain(ids: string[]): string {
  const concepts = record?.concepts ?? [];
  const hit = concepts.filter((c) => ids.includes(c.id));
  if (!hit.length) return '';
  return (
    '<h3>前置链</h3><div class="chips">' +
    hit.map((c) => `<button type="button" class="chip" data-concept="${esc(c.id)}">${esc(c.title || c.id)}</button>`).join('') +
    '</div>'
  );
}

function footer(info: string, index: number): string {
  const total = record?.chapters.length ?? 0;
  return (
    '<footer class="reader-foot">' +
    `<button type="button" data-nav="prev"${index <= 0 ? ' disabled' : ''}>← 上一章</button>` +
    '<button type="button" data-nav="overview">书籍总览</button>' +
    `<button type="button" data-nav="next"${index >= total - 1 ? ' disabled' : ''}>下一章 →</button>` +
    (info ? `<span class="dim">${esc(info)}</span>` : '') +
    '</footer>'
  );
}

function bar(text: string): string {
  return `<div class="degrade-bar">${esc(text)}</div>`;
}

/** 页脚与 HUD 的渲染计数：公式、回退、图示三项按有无显示 */
function renderInfo(rendered: { mathCount: number; formulaFallbacks: number; diagramCount: number }): string {
  const bits = [`公式 ${rendered.mathCount} 处`];
  if (rendered.formulaFallbacks) bits.push(`解析失败回退原文 ${rendered.formulaFallbacks} 处`);
  if (rendered.diagramCount) bits.push(`图示 ${rendered.diagramCount} 处`);
  return bits.join(' · ');
}

// ---------------------------------------------------------------- DOM

function show(visible: boolean): void {
  // 必须走 .hidden 属性：setAttribute('hidden','false') 仍命中 [hidden] 选择器，面板会整块不显示
  if (els.panel) els.panel.hidden = !visible;
  if (els.back) els.back.disabled = !visible;
  document.getElementById('app')?.classList.toggle('reader-open', visible);
}

function setTitle(text: string): void {
  if (els.title) els.title.textContent = text;
}

function showCrumb(chapterTitle: string | null): void {
  if (!els.crumb) return;
  els.crumb.textContent = [book?.discipline ?? '', book?.title ?? '', chapterTitle ?? '']
    .filter(Boolean)
    .join(' / ');
}

function setBody(html: string): void {
  const root = els.body;
  if (!root) return;
  forgetDiagrams(root);
  root.innerHTML = html;
  root.scrollTop = 0;
  wire(root);
  // 判据 A2：正文落地后只登记待渲染围栏，容器进入视口才把 mermaid 分包拉进来
  hydrateDiagrams(root);
}

function wire(root: HTMLElement): void {
  const chapters = record?.chapters ?? [];
  const index = chapters.findIndex((c) => c.id === openId);
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('button.chap'))) {
    btn.addEventListener('click', () => {
      const ch = chapters[Number(btn.dataset.idx)];
      if (ch) void openChapter(ch.id);
    });
  }
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-concept]'))) {
    btn.addEventListener('click', () => void openConcept(String(btn.dataset.concept)));
  }
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-chapter]'))) {
    btn.addEventListener('click', () => void openChapter(String(btn.dataset.chapter)));
  }
  root.querySelector('[data-nav="prev"]')?.addEventListener('click', () => {
    if (index > 0) void openChapter(chapters[index - 1].id);
  });
  root.querySelector('[data-nav="next"]')?.addEventListener('click', () => {
    if (index >= 0 && index < chapters.length - 1) void openChapter(chapters[index + 1].id);
  });
  root.querySelector('[data-nav="overview"]')?.addEventListener('click', showOverview);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
