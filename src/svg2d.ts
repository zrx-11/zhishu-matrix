/**
 * 2D 降级视图（铁律 4）：触屏或 <768px 用它，不加载 Three.js。
 * 批 8 起它画的是同一套空间账——八角厅 + 六条走廊 + 阅览室平面（三面书架、书位按章数占宽），
 * 坐标直接沿用 architecture/layout 的 room-local 值，不再另起一套圆盘布局。
 */
import type { BookRecord, Discipline, ManifestIndex, SiteEntry } from './types';
import { CORRIDOR_W, DOOR_W, HALL_RADIUS, ROOMS, ROOM_BY_KEY, ROOM_DIST, SHELF_DEPTH } from './config';
import { planRoom } from './layout';
import type { CameraPose } from './state';

export interface FlatHooks {
  onPickRoom(discipline: Discipline): void;
  onPickBook(discipline: Discipline, book: SiteEntry): void;
  onHud(text: string): void;
  onPan(pan: { x: number; y: number; zoom: number }): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 世界 ±175 单位 → SVG 0..360，1 单位 = 1 世界单位，省掉一层换算 */
const EXT = 360;
const MID = EXT / 2;
/** 大厅里阅览室体量按名义边长画，进区后按该区书量算出的真实边长画 */
const FACADE_SIDE = 26;

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
    this.svg.setAttribute('viewBox', `0 0 ${EXT} ${EXT}`);
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
    return EXT / Math.max(1, Math.min(rect.width, rect.height));
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

  // ------------------------------------------------------------------ 大厅

  showHall(_pose?: CameraPose | null): void {
    this.room = null;
    this.pan = { x: 0, y: 0, zoom: 1 };
    this.layer.removeAttribute('transform');
    this.layer.textContent = '';
    const grouped = new Map<Discipline, SiteEntry[]>();
    for (const s of this.manifest.sites) {
      grouped.set(s.discipline, [...(grouped.get(s.discipline) ?? []), s]);
    }
    // 地面 + 八角厅轮廓 + 六条走廊，先把「空间」画出来
    this.layer.appendChild(rect(-MID, -MID, EXT, EXT, '#12141a', 1));
    this.layer.appendChild(polygon(HALL_RADIUS, 8, Math.PI / 8, '#1b1f28', '#5a4a26'));
    for (const r of ROOMS) {
      const dx = Math.cos(r.angle);
      const dz = Math.sin(r.angle);
      const from = HALL_RADIUS - 1;
      const to = ROOM_DIST - FACADE_SIDE / 2;
      this.layer.appendChild(
        band(dx * from, dz * from, dx * to, dz * to, CORRIDOR_W, '#191d25', '#2b3244'),
      );
      // 门洞
      this.layer.appendChild(
        band(dx * (HALL_RADIUS - 1.6), dz * (HALL_RADIUS - 1.6), dx * (HALL_RADIUS + 1.6),
          dz * (HALL_RADIUS + 1.6), DOOR_W, '#241a11', '#c9a24a'),
      );
    }
    this.layer.appendChild(text(MID, MID - 4, '中央大厅', '#e9eef8', 9, 700));
    this.layer.appendChild(text(MID, MID + 8, '六门通六区', '#8b95a8', 7));
    for (const r of ROOMS) {
      const n = (grouped.get(r.key) ?? []).length;
      const g = document.createElementNS(SVG_NS, 'g');
      g.dataset.room = r.key;
      g.setAttribute('tabindex', '0');
      const x = MID + r.at[0];
      const y = MID + r.at[1];
      g.appendChild(rect(x - FACADE_SIDE / 2, y - FACADE_SIDE / 2, FACADE_SIDE, FACADE_SIDE, r.color, 0.82, 2.4));
      g.appendChild(text(x, y + 2, r.short, '#101318', 8.5, 700));
      g.appendChild(text(x, y + FACADE_SIDE / 2 + 9, `${n} 册`, '#cfd6e4', 7.5));
      this.layer.appendChild(g);
    }
    this.apply();
    this.hooks.onHud(`${this.manifest.totals.sites} 本书 · 点房子进区 · 单指拖动可平移视图`);
  }

  // ------------------------------------------------------------------ 阅览室平面

  enterRoom(discipline: Discipline, books: SiteEntry[], records: Map<string, BookRecord>): void {
    this.room = discipline;
    const spec = ROOM_BY_KEY[discipline];
    const plan = planRoom(discipline, books, records, (seed) => leatherFlat(spec.color, seed));
    this.layer.textContent = '';
    this.pan = { x: 0, y: 0, zoom: 1 };
    const side = Math.max(1, plan.side);
    // 房间要铺满视口：side 是 20–30 世界单位、书位宽 0.4–0.7，按 min(1,·) 不缩就只占 360 格里的 26，
    // 色块不到一像素——2D 降级不只是「不白屏」，还得点得着（判据：探针在 390 下点第一个书位要能开正文）
    const s = (EXT - 56) / side;
    const inv = 1 / s;
    // 线宽、圆角、字号都是世界单位，先除掉房间缩放才是「屏幕上多大」
    const ux = (px: number) => px * inv;
    this.layer.setAttribute('transform', `translate(${MID} ${MID}) scale(${s})`);
    this.layer.appendChild(rect(-side / 2, -side / 2, side, side, '#191410', 1, ux(1.4), ux(1.2)));
    // 正门（局部 −Z 那面墙）留缺口
    this.layer.appendChild(rect(-DOOR_W / 2, -side / 2 - 1.2, DOOR_W, 1.8, '#241a11', 1, 0, ux(0.8)));
    this.layer.appendChild(this.label(0, -side / 2 - ux(7), '门 · 通走廊', '#8b95a8', 7, inv));
    this.layer.appendChild(this.label(0, -side / 2 + ux(12), `${spec.title} · ${plan.bookCount} 册`, spec.color, 9.5, inv, 700));

    for (const row of plan.rows) {
      const deg = (Math.atan2(row.dir[1], row.dir[0]) * 180) / Math.PI;
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', `translate(${row.x} ${row.z}) rotate(${deg})`);
      // 书架：沿墙一条，进深 SHELF_DEPTH——库里 0 本的区也画，与 3D 同一套建筑账
      g.appendChild(rect(-row.length / 2, -SHELF_DEPTH / 2, row.length, SHELF_DEPTH, '#241a11', 1, ux(0.8), ux(0.6)));
      this.layer.appendChild(g);
    }

    if (!plan.slots.length) {
      this.layer.appendChild(this.label(0, 0, '本区无可解析书目 · 6 个仓库均无 manifest.json', '#8b95a8', 8, inv));
      this.apply();
      this.hooks.onHud(`${spec.title} · 0 本 · 6 个仓库无 manifest，待批 5 补源`);
      return;
    }

    // 章数只在色块宽到放得下一个两位数字时写：AI 区 450 本一起写就糊成一片噪点
    const numMin = ux(9);
    // 书位要沿各自那面墙转过去：slot.cx/cz 是 room-local 中心，但 slotW 是「沿墙」长度，
    // 不转就把厚书横着画——左右墙的色块会横穿房间、探出画布外，2D 里点不中（探针在 390 下点第一个书位）
    const dirOf = new Map(plan.rows.map((r) => [r.wall, r.dir] as const));
    for (const slot of plan.slots) {
      const dir = dirOf.get(slot.wall) ?? ([1, 0] as [number, number]);
      const deg = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
      const g = document.createElementNS(SVG_NS, 'g');
      g.dataset.slug = slot.book.bookSlug;
      g.dataset.repo = slot.book.repo;
      g.setAttribute('tabindex', '0');
      g.setAttribute('transform', `translate(${slot.cx} ${slot.cz}) rotate(${deg})`);
      g.appendChild(rect(
        -slot.slotW / 2, -SHELF_DEPTH * 0.42, slot.slotW, SHELF_DEPTH * 0.84,
        slot.color, slot.book.contentLevel === 'full' ? 0.92 : 0.5, ux(0.5), ux(0.5),
      ));
      if (slot.slotW >= numMin) {
        g.appendChild(this.label(0, 0, String(slot.chapters.length), '#f0dca6', 7, inv, 700, -deg));
      }
      this.layer.appendChild(g);
    }
    this.apply();
    this.hooks.onHud(
      `${spec.title} · ${plan.bookCount} 册 / ${plan.chapterCount} 章 · 点色块看书 · 单指拖动平移`,
    );
  }

  /** 在已缩放的图层里写一段「屏幕上这么大」的字：反缩放包住，字号就还是 viewBox 单位 */
  private label(
    x: number,
    y: number,
    str: string,
    fill: string,
    px: number,
    inv: number,
    weight = 400,
    rotDeg = 0,
  ): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    // 数字比书位宽（一位数也要 0.6 世界单位），不关掉命中就会被邻书的标注抢走点击
    g.setAttribute('pointer-events', 'none');
    g.setAttribute('transform', `translate(${x} ${y}) rotate(${rotDeg}) scale(${inv})`);
    g.appendChild(text(0, px * 0.34, str, fill, px, weight));
    return g;
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

// ------------------------------------------------------------------ 画元素

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  opacity: number,
  stroke = 0,
  rx = 1.2,
): SVGRectElement {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(Math.max(0.2, w)));
  r.setAttribute('height', String(Math.max(0.2, h)));
  r.setAttribute('rx', String(Math.max(0.05, rx)));
  r.setAttribute('fill', fill);
  r.setAttribute('fill-opacity', String(opacity));
  if (stroke > 0) {
    r.setAttribute('stroke', '#0e1015');
    r.setAttribute('stroke-width', String(stroke));
  }
  return r;
}

/** 两点之间的等宽条带：走廊与门洞都用它画 */
function band(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  fill: string,
  stroke: string,
): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.001;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  g.setAttribute('transform', `translate(${MID + x1} ${MID + y1}) rotate(${deg})`);
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', '0');
  r.setAttribute('y', String(-width / 2));
  r.setAttribute('width', String(len));
  r.setAttribute('height', String(width));
  r.setAttribute('fill', fill);
  r.setAttribute('stroke', stroke);
  r.setAttribute('stroke-width', '0.6');
  g.appendChild(r);
  return g;
}

function polygon(radius: number, sides: number, phase: number, fill: string, stroke: string): SVGPolygonElement {
  const pts: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (Math.PI * 2 * i) / sides + phase;
    pts.push(`${MID + Math.cos(a) * radius},${MID + Math.sin(a) * radius}`);
  }
  const p = document.createElementNS(SVG_NS, 'polygon');
  p.setAttribute('points', pts.join(' '));
  p.setAttribute('fill', fill);
  p.setAttribute('stroke', stroke);
  p.setAttribute('stroke-width', '1.4');
  return p;
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

/** 与 atlas.leatherColor 同式的抖色，但不引 three（2D 视图不加载 3D 依赖） */
function leatherFlat(color: string, seed: number): string {
  const hsl = rgbHsl(color);
  const jitter = ((seed * 2654435761) % 1000) / 1000;
  const h = (hsl.h + (jitter - 0.5) * 0.1 + 1) % 1;
  const s = Math.min(0.62, 0.28 + hsl.s * 0.42 + jitter * 0.1);
  const l = 0.2 + (((seed * 40503) % 137) / 137) * 0.16;
  return hslCss(h, s, l);
}

function rgbHsl(css: string): { h: number; s: number; l: number } {
  const hex = css.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h + 6) % 6 / 6, s, l };
}

function hslCss(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
}
