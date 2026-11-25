import type { Discipline, ManifestIndex, SiteEntry } from './types';
import { ROOMS, ROOM_BY_KEY } from './config';
import { layoutRoom } from './layout';
import type { CameraPose } from './state';

export interface FlatHooks {
  onPickRoom(discipline: Discipline): void;
  onPickBook(discipline: Discipline, book: SiteEntry): void;
  onHud(text: string): void;
  onPan(pan: { x: number; y: number; zoom: number }): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 2D 降级视图（铁律 4）：触屏或 <768px 用它，不加载 Three.js */
export class MatrixFlat {
  readonly kind = '2d' as const;
  private svg: SVGSVGElement;
  private viewport: SVGGElement;
  private layer: SVGGElement;
  private pan = { x: 0, y: 0, zoom: 1 };
  private room: Discipline | null = null;
  private dragging = false;
  private moved = 0;
  private last = { x: 0, y: 0 };
  private frames = 0;

  constructor(
    private root: HTMLElement,
    private manifest: ManifestIndex,
    private hooks: FlatHooks,
  ) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.viewport = document.createElementNS(SVG_NS, 'g');
    this.layer = document.createElementNS(SVG_NS, 'g');
    this.viewport.appendChild(this.layer);
    this.svg.appendChild(this.viewport);
    this.root.appendChild(this.svg);
    this.svg.addEventListener('pointerdown', this.onDown);
    this.svg.addEventListener('pointermove', this.onMove);
    this.svg.addEventListener('pointerup', this.onUp);
    this.svg.addEventListener('pointercancel', this.onUp);
  }

  setPan(pan: { x: number; y: number; zoom: number }): void {
    this.pan = { ...pan };
    this.apply();
  }

  get currentPan(): { x: number; y: number; zoom: number } {
    return { ...this.pan };
  }

  private apply(): void {
    this.viewport.setAttribute(
      'transform',
      `translate(${this.pan.x} ${this.pan.y}) scale(${this.pan.zoom})`,
    );
  }

  private onDown = (ev: PointerEvent): void => {
    this.dragging = true;
    this.moved = 0;
    this.last = { x: ev.clientX, y: ev.clientY };
    try { this.svg.setPointerCapture?.(ev.pointerId); } catch { /* 合成事件或旧内核不支持指针捕获，不影响拖拽 */ }
  };

  private onMove = (ev: PointerEvent): void => {
    this.frames += 1;
    if (!this.dragging) return;
    const dx = ev.clientX - this.last.x;
    const dy = ev.clientY - this.last.y;
    this.last = { x: ev.clientX, y: ev.clientY };
    this.moved += Math.abs(dx) + Math.abs(dy);
    const scale = this.viewBoxScale();
    this.pan.x += dx * scale;
    this.pan.y += dy * scale;
    this.apply();
    this.hooks.onPan(this.pan);
  };

  private onUp = (ev: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    try { this.svg.releasePointerCapture?.(ev.pointerId); } catch { /* 同上 */ }
    if (this.moved > 10) return; // 当成拖动，不算点击
    const hit = this.hitTest(ev.clientX, ev.clientY);
    if (hit?.dataset.room) this.hooks.onPickRoom(hit.dataset.room as Discipline);
    else if (hit?.dataset.slug && this.room) {
      const book = this.manifest.sites.find(
        (s) => s.discipline === this.room && s.bookSlug === hit.dataset.slug && s.repo === hit.dataset.repo,
      );
      if (book) this.hooks.onPickBook(this.room, book);
    }
  };

  private viewBoxScale(): number {
    const rect = this.svg.getBoundingClientRect();
    return 100 / Math.max(1, Math.min(rect.width, rect.height));
  }

  private hitTest(cx: number, cy: number): SVGGraphicsElement | null {
    const el = document.elementFromPoint(cx, cy);
    let node: Element | null = el;
    while (node && node !== this.svg) {
      if (node instanceof SVGGElement && (node.dataset.room || node.dataset.slug)) {
        return node as SVGGraphicsElement;
      }
      node = node.parentElement;
    }
    return null;
  }

  showHall(_pose?: CameraPose | null): void {
    this.room = null;
    this.pan = { x: 0, y: 0, zoom: 1 };
    this.layer.removeAttribute('transform');
    this.layer.textContent = '';
    const grouped = new Map<Discipline, SiteEntry[]>();
    for (const s of this.manifest.sites) {
      grouped.set(s.discipline, [...(grouped.get(s.discipline) ?? []), s]);
    }
    for (const r of ROOMS) {
      const n = (grouped.get(r.key) ?? []).length;
      const g = document.createElementNS(SVG_NS, 'g');
      g.dataset.room = r.key;
      g.setAttribute('tabindex', '0');
      const cx = 14 + ((r.at[0] + 220) / 440) * 72;
      const cy = 14 + ((r.at[1] + 170) / 320) * 66;
      g.appendChild(circle(cx, cy, 7.5, r.color, 0.9));
      g.appendChild(text(cx, cy + 11.5, `${r.short} ${n}`, '#e8ecf4', 3.6));
      g.appendChild(text(cx, cy + 0.5, String(n), '#0e1015', 4.4, 700));
      this.layer.appendChild(g);
    }
    this.layer.appendChild(text(50, 4, '中央大厅 · 点圆盘进区', '#8b95a8', 3.4));
    this.apply();
    this.hooks.onHud(`${this.manifest.totals.sites} 本书 · 单指拖动可平移视图`);
  }

  enterRoom(discipline: Discipline, books: SiteEntry[]): void {
    this.room = discipline;
    const spec = ROOM_BY_KEY[discipline];
    const layout = layoutRoom(books);
    const span = Math.max(60, layout.span);
    this.layer.textContent = '';
    this.pan = { x: 0, y: 0, zoom: 1 };
    const scaleTo = 78 / span;
    this.layer.setAttribute(
      'transform',
      `translate(50 52) scale(${scaleTo}) translate(${-spec.at[0] * 0} ${-spec.at[1] * 0})`,
    );
    this.layer.appendChild(text(0, -span / 2 - 8, `${spec.title} · ${books.length} 本`, spec.color, 5.4));
    if (!books.length) {
      this.layer.appendChild(
        text(0, 0, '批 1 无可解析书目 · 6 个仓库均无 manifest.json', '#8b95a8', 4.2),
      );
    }
    for (const b of layout.books) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.dataset.slug = b.book.bookSlug;
      g.dataset.repo = b.book.repo;
      g.setAttribute('tabindex', '0');
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(b.x - 9));
      rect.setAttribute('y', String(b.z - 9));
      rect.setAttribute('width', '18');
      rect.setAttribute('height', '18');
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', spec.color);
      rect.setAttribute('fill-opacity', b.book.contentLevel === 'full' ? '0.85' : '0.4');
      rect.setAttribute('stroke', '#0e1015');
      g.appendChild(rect);
      const chapters = b.book.stats?.chapters ?? 0;
      g.appendChild(text(b.x, b.z + 1.5, String(chapters), '#0e1015', 7, 700));
      g.appendChild(text(b.x, b.z + 14, short(b.book.title || b.book.bookSlug), '#cfd6e4', 4.2));
      this.layer.appendChild(g);
    }
    this.apply();
    this.hooks.onHud(
      books.length
        ? `${spec.title} · 单指拖动平移 · 点方块看书`
        : `${spec.title} · 0 本 · 6 个仓库无 manifest，待批 5 补源`,
    );
  }

  fps(): number {
    return this.frames > 0 ? 60 : 0;
  }

  dispose(): void {
    this.svg.removeEventListener('pointerdown', this.onDown);
    this.svg.removeEventListener('pointermove', this.onMove);
    this.svg.removeEventListener('pointerup', this.onUp);
    this.svg.remove();
  }
}

function circle(cx: number, cy: number, r: number, fill: string, opacity: number): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  c.setAttribute('fill', fill);
  c.setAttribute('fill-opacity', String(opacity));
  c.setAttribute('stroke', '#0e1015');
  return c;
}

function text(
  x: number,
  y: number,
  s: string,
  fill: string,
  size: number,
  weight = 400,
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.setAttribute('fill', fill);
  t.setAttribute('font-size', String(size));
  t.setAttribute('font-weight', String(weight));
  t.setAttribute('text-anchor', 'middle');
  t.textContent = s;
  return t;
}

function short(s: string): string {
  return s.length > 8 ? `${s.slice(0, 7)}…` : s;
}
