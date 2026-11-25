import MiniSearch from 'minisearch';
import { ROOMS } from './config';
import { loadSearchShard } from './data';
import type { Discipline, ManifestIndex, SearchHit, SearchKind, SearchShard } from './types';

export type Scope = 'hall' | Discipline;
export type Status = 'empty' | 'loading' | 'ready' | 'none' | 'error';

export interface SearchHooks {
  getManifest(): ManifestIndex | null;
  currentScope(): Scope;
  /** 命中后由 main 负责精确取书、开阅读层并记住返程位姿（判据 C3/C4） */
  onPick(hit: SearchHit): Promise<boolean>;
  onHud?(text: string): void;
}

interface Doc {
  id: string;
  kind: SearchKind;
  label: string;
  book: string;
  file: string;
  area: Discipline;
  target: string;
  via: string;
  text: string;
}

const PER_KIND = 10;
const MAX_TOTAL = 24;
const ROOM_LABEL: Record<Scope, string> = {
  hall: '中央大厅',
  math: '数学',
  ai: 'AI',
  chem: '化学',
  cs: '计算机',
  general: '通识',
  tools: '工具间',
};

let hooks: SearchHooks = {
  getManifest: () => null,
  currentScope: () => 'hall',
  onPick: async () => false,
};

let light: MiniSearch<Doc> | null = null;
const areaIndexes = new Map<Discipline, MiniSearch<Doc>>();
const areaTasks = new Map<Discipline, Promise<MiniSearch<Doc>>>();
const shardInfo = new Map<Discipline, { books: number; missing: boolean }>();

const els = {
  trigger: document.getElementById('search-open') as HTMLButtonElement | null,
  overlay: document.getElementById('search-overlay') as HTMLDivElement | null,
  input: document.getElementById('search-input') as HTMLInputElement | null,
  scope: document.getElementById('search-scope') as HTMLDivElement | null,
  results: document.getElementById('search-results') as HTMLUListElement | null,
  status: document.getElementById('search-status') as HTMLDivElement | null,
  close: document.getElementById('search-close') as HTMLButtonElement | null,
};

const state = { open: false, scope: 'hall' as Scope, query: '', status: 'empty' as Status, hits: [] as SearchHit[], active: 0 };
let runSeq = 0;
let debounce = 0;

function newEngine(): MiniSearch<Doc> {
  return new MiniSearch<Doc>({
    fields: ['label', 'book', 'text'],
    storeFields: ['kind', 'label', 'book', 'file', 'area', 'target', 'via'],
    tokenize,
    processTerm: (term) => term.toLowerCase(),
    searchOptions: { combineWith: 'OR', prefix: true, fuzzy: 0.12, boost: { label: 5, book: 1.5, text: 1 } },
  });
}

/** 中文按单字 + 二字组合索引，西文按整词：MiniSearch 默认按空白切，中文一条不加空格就永远匹配不上 */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const match of String(text ?? '').matchAll(/[A-Za-z0-9_+.\-]+|[\u3400-\u4dbf\u4e00-\u9fff]+/g)) {
    const token = match[0];
    if (/^[A-Za-z0-9]/.test(token)) {
      out.push(token.toLowerCase());
      continue;
    }
    for (let i = 0; i < token.length; i += 1) out.push(token[i]);
    for (let i = 0; i + 1 < token.length; i += 1) out.push(token.slice(i, i + 2));
  }
  return out;
}

function bookDoc(site: ManifestIndex['sites'][number]): Doc {
  const id = `b:${site.file}`;
  return {
    id,
    kind: 'book',
    label: site.title || site.bookSlug,
    book: site.title || site.bookSlug,
    file: site.file,
    area: site.discipline,
    target: '',
    via: '',
    text: `${site.repo} ${site.bookSlug}`,
  };
}

function ensureLight(): MiniSearch<Doc> {
  if (light) return light;
  const manifest = hooks.getManifest();
  const engine = newEngine();
  // manifest 级轻索引只含 129 条书目，用已加载的 manifest 现建，不发额外请求
  engine.addAll((manifest?.sites ?? []).map(bookDoc));
  if (manifest) light = engine;
  return engine;
}

function shardDocs(shard: SearchShard): Doc[] {
  const docs: Doc[] = [];
  for (const book of shard.books) {
    const base = `s:${book.file}`;
    docs.push({
      id: `${base}:title`,
      kind: 'book',
      label: book.title,
      book: book.title,
      file: book.file,
      area: book.area,
      target: '',
      via: '',
      text: `${book.repo} ${book.slug}`,
    });
    for (const ch of book.chapters) {
      docs.push({
        id: `${base}:c:${ch.id}`,
        kind: 'chapter',
        label: ch.title || ch.id,
        book: book.title,
        file: book.file,
        area: book.area,
        target: ch.id,
        via: '',
        text: ch.core ?? '',
      });
    }
    for (const cp of book.concepts) {
      docs.push({
        id: `${base}:k:${cp.id}`,
        kind: 'concept',
        label: cp.name || cp.id,
        book: book.title,
        file: book.file,
        area: book.area,
        target: cp.id,
        via: '',
        text: cp.brief ?? '',
      });
    }
    for (const [i, term] of (book.terms ?? []).entries()) {
      const target = term.c ?? '';
      docs.push({
        id: `${base}:t:${i}`,
        // 术语命中按落点归类：有章就进「章节」组，没章只落书总览，不猜目标
        kind: target ? 'chapter' : 'book',
        label: `术语 · ${term.t}`,
        book: book.title,
        file: book.file,
        area: book.area,
        target,
        via: '术语',
        text: term.d ?? '',
      });
    }
  }
  return docs;
}

function areaIndex(area: Discipline): Promise<MiniSearch<Doc>> {
  const done = areaIndexes.get(area);
  if (done) return Promise.resolve(done);
  const pending = areaTasks.get(area);
  if (pending) return pending;
  const task = loadSearchShard(area)
    .then((shard) => {
      const engine = newEngine();
      engine.addAll(shardDocs(shard));
      areaIndexes.set(area, engine);
      shardInfo.set(area, {
        books: shard.counts.books,
        missing: shard.generator === 'missing',
      });
      return engine;
    })
    .finally(() => areaTasks.delete(area));
  areaTasks.set(area, task);
  return task;
}

function toHit(doc: Doc): SearchHit {
  return {
    kind: doc.kind,
    label: doc.label,
    book: doc.book,
    file: doc.file,
    area: doc.area,
    target: doc.target || null,
    via: doc.via || null,
  };
}

function groupLimit(hits: SearchHit[]): SearchHit[] {
  const buckets: Record<SearchKind, SearchHit[]> = { chapter: [], concept: [], book: [] };
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = `${hit.kind}|${hit.file}|${hit.target ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (buckets[hit.kind].length < PER_KIND) buckets[hit.kind].push(hit);
  }
  const merged = [...buckets.chapter, ...buckets.concept, ...buckets.book];
  return merged.length > MAX_TOTAL ? merged.slice(0, MAX_TOTAL) : merged;
}

async function searchOnce(query: string, scope: Scope): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  if (scope === 'hall') {
    return groupLimit(
      ensureLight()
        .search(q)
        .map((r) => toHit(r as unknown as Doc)),
    );
  }
  const engine = await areaIndex(scope);
  return groupLimit(
    engine
      .search(q)
      .slice(0, 60)
      .map((r) => toHit(r as unknown as Doc)),
  );
}

/** 探针与外部调用入口：跑一次真实检索并返回命中（UI 打开时同步刷新） */
export async function runSearch(query: string, scope?: Scope): Promise<SearchHit[]> {
  const target = scope ?? state.scope;
  const seq = ++runSeq;
  state.query = query;
  state.scope = target;
  if (state.open) {
    state.status = 'loading';
    paint();
  }
  try {
    const hits = await searchOnce(query, target);
    if (seq !== runSeq) return hits;
    state.hits = hits;
    state.status = !query.trim() ? 'empty' : hits.length ? 'ready' : 'none';
    state.active = 0;
  } catch (err) {
    if (seq !== runSeq) return [];
    state.hits = [];
    state.status = 'error';
    hooks.onHud?.(`检索失败：${String(err).slice(0, 80)}`);
  }
  if (state.open) paint();
  return state.hits;
}

function scopeNote(): string {
  if (state.scope === 'hall') {
    const n = hooks.getManifest()?.sites.length ?? 0;
    return `当前范围 · 中央大厅（只搜 ${n} 条书目，章节与概念需进学科）`;
  }
  const info = shardInfo.get(state.scope);
  const loaded = info ? `${info.missing ? '该区分片缺失，已按空片容错' : `已载分片 ${info.books} 本`}` : '分片未加载';
  return `当前范围 · ${ROOM_LABEL[state.scope]} 区内（书目 + 章节 + 概念 + 术语）· ${loaded}`;
}

function statusText(): string {
  switch (state.status) {
    case 'loading':
      return `索引加载中 · ${ROOM_LABEL[state.scope]} 分片正在取，稍候自动出结果`;
    case 'empty':
      return '输入关键词即搜 · ↑↓ 选择 · Enter 打开 · Esc 关闭';
    case 'none': {
      const info = state.scope === 'hall' ? undefined : shardInfo.get(state.scope);
      if (info && info.books === 0) {
        return `${ROOM_LABEL[state.scope]} 区库里 0 本（分片是空的），换到其他学科再搜`;
      }
      return `没有命中「${state.query.trim()}」· 换个说法，或点下面的学科扩大范围`;
    }
    case 'error':
      return '检索出错 · 分片未就绪或索引读失败，空间视图不受影响';
    case 'ready':
      return `${state.hits.length} 条命中 · 章节 ${count('chapter')} / 概念 ${count('concept')} / 书 ${count('book')}`;
  }
}

function count(kind: SearchKind): number {
  return state.hits.filter((h) => h.kind === kind).length;
}

function chipsHtml(): string {
  const hall = `<button type="button" class="scope-chip${state.scope === 'hall' ? ' on' : ''}" data-area="hall">全库书目</button>`;
  const rooms = ROOMS.map(
    (r) =>
      `<button type="button" class="scope-chip${state.scope === r.key ? ' on' : ''}" data-area="${r.key}">${esc(r.short)}</button>`,
  ).join('');
  return `${hall}${rooms}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resultsHtml(): string {
  const groups: Array<[SearchKind, string]> = [
    ['chapter', '章节'],
    ['concept', '概念'],
    ['book', '书'],
  ];
  const parts: string[] = [];
  let index = -1;
  for (const [kind, title] of groups) {
    const hits = state.hits.filter((h) => h.kind === kind);
    if (!hits.length) continue;
    parts.push(`<li class="hit-group">${title} ${hits.length}</li>`);
    for (const hit of hits) {
      index += 1;
      const mark = hit.kind === 'chapter' ? '章' : hit.kind === 'concept' ? '概' : '书';
      parts.push(
        `<li class="hit${index === state.active ? ' active' : ''}" role="option" data-i="${index}">` +
          `<span class="mark">${mark}</span><span class="label">${esc(hit.label)}</span>` +
          `<span class="from">${esc(hit.book)}${hit.via ? ` · ${hit.via}命中` : ''}</span>` +
          `<span class="area">${esc(ROOM_LABEL[hit.area])}</span></li>`,
      );
    }
  }
  return parts.join('');
}

function paint(): void {
  if (!els.overlay) return;
  if (els.scope) els.scope.innerHTML = `${esc(scopeNote())}<div class="chips">${chipsHtml()}</div>`;
  if (els.status) {
    els.status.textContent = statusText();
    els.status.dataset.status = state.status;
  }
  if (els.results) {
    els.results.innerHTML = state.status === 'ready' ? resultsHtml() : '';
    els.results.hidden = state.status !== 'ready';
  }
  wireChips();
}

function wireChips(): void {
  if (!els.scope) return;
  for (const btn of Array.from(els.scope.querySelectorAll<HTMLButtonElement>('.scope-chip'))) {
    btn.addEventListener('click', () => {
      void runSearch(state.query, btn.dataset.area as Scope);
    });
  }
}

function hitByIndex(i: number): SearchHit | null {
  return state.hits[i] ?? null;
}

async function pick(hit: SearchHit | null): Promise<void> {
  if (!hit) return;
  close(false);
  const ok = await hooks.onPick(hit);
  hooks.onHud?.(
    ok
      ? `检索跳转 · ${hit.label}（${hit.book}）· 返回可回到原书节点与原位姿`
      : `检索跳转失败 · ${hit.file} 未在库里`,
  );
}

export function searchHits(): SearchHit[] {
  return state.hits;
}

/** 自检探针模拟点第 i 条结果，走与真实点击同一条 pick() 路径 */
export function searchPick(index: number): Promise<void> {
  return pick(hitByIndex(index));
}

export function openSearch(prefill = ''): void {
  if (!els.overlay) return;
  state.open = true;
  state.scope = hooks.currentScope();
  els.overlay.hidden = false;
  if (els.input) {
    els.input.value = prefill;
    els.input.focus();
  }
  void runSearch(prefill, state.scope);
}

export function closeSearch(): void {
  close();
}

function close(focusTrigger = true): void {
  if (!els.overlay) return;
  state.open = false;
  els.overlay.hidden = true;
  if (focusTrigger) els.trigger?.focus?.();
}

export function searchOpen(): boolean {
  return state.open;
}

export function searchState() {
  return {
    open: state.open,
    scope: state.scope,
    query: state.query,
    status: state.status,
    hits: state.hits.length,
    loadedAreas: [...areaIndexes.keys()],
    shards: Object.fromEntries(shardInfo),
  };
}

export const loadedShards = (): Discipline[] => [...areaIndexes.keys()];

function moveActive(step: number): void {
  if (!state.hits.length) return;
  state.active = (state.active + step + state.hits.length) % state.hits.length;
  paint();
  const el = els.results?.querySelector<HTMLLIElement>(`.hit[data-i="${state.active}"]`);
  el?.scrollIntoView({ block: 'nearest' });
}

function onInputKey(ev: KeyboardEvent): void {
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    moveActive(1);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    moveActive(-1);
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    void pick(hitByIndex(state.active));
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    close();
  }
}

export function configureSearch(next: Partial<SearchHooks>): void {
  hooks = { ...hooks, ...next };
}

/** 挂载快捷键与弹层事件（由 main 在 boot 里调一次） */
export function initSearch(): void {
  els.trigger?.addEventListener('click', () => openSearch(els.input?.value ?? ''));
  els.close?.addEventListener('click', () => close());
  els.overlay?.addEventListener('mousedown', (ev) => {
    if (ev.target === els.overlay) close();
  });
  els.results?.addEventListener('click', (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLLIElement>('.hit');
    if (li) void pick(hitByIndex(Number(li.dataset.i)));
  });
  els.input?.addEventListener('input', () => {
    window.clearTimeout(debounce);
    const value = els.input?.value ?? '';
    debounce = window.setTimeout(() => void runSearch(value), 120);
  });
  els.input?.addEventListener('keydown', onInputKey);
  window.addEventListener('keydown', (ev) => {
    const typing = (() => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    })();
    if ((ev.key === 'k' || ev.key === 'K') && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      openSearch(els.input?.value ?? '');
      return;
    }
    // 焦点不在输入框时（点了 chip 等）Esc 也要能收起弹层
    if (ev.key === 'Escape' && state.open) {
      ev.preventDefault();
      close();
      return;
    }
    if (ev.key === '/' && !typing && !state.open) {
      ev.preventDefault();
      openSearch('');
    }
  });
  paint();
}
