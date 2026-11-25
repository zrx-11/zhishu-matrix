/**
 * 批 8 阅览室布置：把「书」摆上书架墙，把「章」摊成书脊。
 * 纯数学、不碰 three——输出的 room-local 坐标与基向量由 architecture.ts 转成合并几何。
 */
import {
  BOOK_H_JITTER,
  SHELF_DEPTH,
  SLOT_GAP,
  SPINE_W_MAX,
  SPINE_W_MIN,
} from './config';
import type { BookRecord, SiteEntry } from './types';

export type WallId = 'left' | 'right' | 'back';

export interface ChapterRef {
  id: string;
  title: string;
  num: number | null;
  concepts: Array<{ id: string; title: string }>;
}

export interface BookSlot {
  book: SiteEntry;
  chapters: ChapterRef[];
  /** 皮革底色（图集格用），由学科色 + 本书序号抖色 */
  color: string;
  /** 单册书脊宽（章多的书更厚） */
  spineW: number;
  /** 书位起点（沿墙方向的参数，单位=世界） */
  u0: number;
  slotW: number;
  level: number;
  wall: WallId;
  /** 中心点（room-local x,z）与书高 */
  cx: number;
  cz: number;
  bookH: number;
  spineStart: number;
}

export interface SpinePlacement {
  slot: number;
  chapter: ChapterRef;
  chapterIndex: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  depth: number;
  /** 沿墙方向与指向房间中心的法线（room-local，只用到 x/z） */
  dir: [number, number];
  normal: [number, number];
  cell: number;
}

export interface ShelfRowSpec {
  wall: WallId;
  levels: number;
  /** 书架沿墙长度 */
  length: number;
  /** 书架层板高度序列 */
  boardY: number[];
  pitch: number;
  x: number;
  z: number;
  dir: [number, number];
  normal: [number, number];
}

export interface RoomPlan {
  discipline: SiteEntry['discipline'];
  /** 房间边长（正方形阅览室） */
  side: number;
  height: number;
  rows: ShelfRowSpec[];
  slots: BookSlot[];
  spines: SpinePlacement[];
  /** 光尘锚点：概念 → 书架前沿的一颗尘粒 */
  dust: Array<{ x: number; y: number; z: number; size: number; book: SiteEntry; conceptId: string }>;
  bookCount: number;
  chapterCount: number;
  /** 书脊格数 == 章数（门槛逐区核对） */
  cells: number;
}

const WALLS_ORDER: WallId[] = ['left', 'right', 'back'];

const WALLS: Record<WallId, { dir: [number, number]; normal: [number, number]; offset: (side: number) => number }> = {
  left: { dir: [0, 1], normal: [1, 0], offset: (s) => -s / 2 + SHELF_DEPTH / 2 },
  right: { dir: [0, -1], normal: [-1, 0], offset: (s) => s / 2 - SHELF_DEPTH / 2 },
  back: { dir: [1, 0], normal: [0, -1], offset: (s) => s / 2 - SHELF_DEPTH / 2 },
};

const SHELF_BOTTOM = 0.42;
const SHELF_TOP = 11.6;
const BACK_PANEL = 0.14;
const BOARD = 0.22;

/** 单册书脊宽：按该书章数归一化，章多→册厚→占位宽 */
function spineWidth(n: number): number {
  return Math.min(SPINE_W_MAX, Math.max(SPINE_W_MIN, 0.34 + 0.13 * Math.sqrt(n / 12)));
}

/** 抖一个 0..1 的确定性伪随机（同区同书每次一致，截图才可比） */
function hash(seed: number, salt: number): number {
  const s = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function conceptsByChapter(rec?: BookRecord): Map<string, Array<{ id: string; title: string }>> {
  const map = new Map<string, Array<{ id: string; title: string }>>();
  for (const c of rec?.concepts ?? []) {
    const item = { id: c.id, title: c.title };
    for (const cid of c.chapterIds ?? []) {
      const list = map.get(cid) ?? [];
      list.push(item);
      map.set(cid, list);
    }
  }
  return map;
}

export function key(repo: string, slug: string): string {
  return `${repo}::${slug}`;
}

export function recordIndex(shard: { sites: BookRecord[] }): Map<string, BookRecord> {
  const map = new Map<string, BookRecord>();
  for (const rec of shard.sites) map.set(key(rec.repo, rec.bookSlug), rec);
  return map;
}

interface SlotDraft {
  book: SiteEntry;
  chapters: ChapterRef[];
  spineW: number;
  slotW: number;
  seed: number;
}

/**
 * 房间布置主入口：章数决定书脊宽与书位宽，书位按总长摊到「三面墙 × 若干层」上，
 * 每层内部再等距留缝——空架不会挤在一起，也不会有墙空着。
 */
export function planRoom(
  discipline: SiteEntry['discipline'],
  books: SiteEntry[],
  records: Map<string, BookRecord>,
  leather: (seed: number) => string,
): RoomPlan {
  const sorted = [...books].sort(
    (a, b) => a.repo.localeCompare(b.repo) || a.bookSlug.localeCompare(b.bookSlug),
  );
  const drafts: SlotDraft[] = [];
  sorted.forEach((book, i) => {
    const rec = records.get(key(book.repo, book.bookSlug));
    const byChapter = conceptsByChapter(rec);
    const chapters: ChapterRef[] = (rec?.chapters ?? []).map((ch, ci) => ({
      id: ch.id,
      title: ch.title,
      num: typeof ch.num === 'number' ? ch.num : ci + 1,
      concepts: byChapter.get(ch.id) ?? [],
    }));
    if (!chapters.length) return;
    const spineW = spineWidth(chapters.length);
    drafts.push({
      book,
      chapters,
      spineW,
      slotW: chapters.length * spineW + SLOT_GAP,
      seed: i,
    });
  });

  const totalRun = drafts.reduce((sum, d) => sum + d.slotW, 0);
  const wallCount = 3;
  const levels = Math.max(3, Math.min(6, Math.round(Math.sqrt(Math.max(1, totalRun) / 6))));
  // 书架两端各让出一个进深，否则三面墙的书排在转角处互相穿插（转角那本会种进邻墙的书架里）
  const corner = SHELF_DEPTH + 0.2;
  const side = Math.max(20, Math.min(40, Math.ceil(totalRun / (0.68 * wallCount * levels) + 2 * corner)));
  const tierLen = side - 2 * corner;
  const capacity = wallCount * levels;

  // 贪心分层：装不下就换下一层；层数用尽则摊进最后一层（宁可密，也不丢书）
  const tiers: Array<{ wall: WallId; level: number; slots: SlotDraft[]; used: number }> = [];
  let tierIdx = 0;
  for (const d of drafts) {
    const need = d.slotW + SLOT_GAP;
    const cur = tiers[tierIdx];
    if (cur && cur.used + need > tierLen && tierIdx + 1 < capacity) tierIdx += 1;
    if (!tiers[tierIdx]) {
      tiers[tierIdx] = {
        wall: WALLS_ORDER[tierIdx % wallCount],
        level: Math.floor(tierIdx / wallCount),
        slots: [],
        used: 0,
      };
    }
    tiers[tierIdx].slots.push(d);
    tiers[tierIdx].used += need;
  }

  const pitch = (SHELF_TOP - SHELF_BOTTOM) / levels;
  const rows: ShelfRowSpec[] = WALLS_ORDER.map((wall) => {
    const off = WALLS[wall].offset(side);
    return {
      wall,
      levels,
      length: tierLen,
      boardY: Array.from({ length: levels }, (_, l) => SHELF_BOTTOM + l * pitch),
      pitch,
      x: wall === 'back' ? 0 : off,
      z: wall === 'back' ? off : 0,
      dir: WALLS[wall].dir,
      normal: WALLS[wall].normal,
    };
  });

  const slots: BookSlot[] = [];
  const spines: SpinePlacement[] = [];
  const dust: RoomPlan['dust'] = [];

  for (const tier of tiers) {
    if (!tier || !tier.slots.length) continue;
    const row = rows[WALLS_ORDER.indexOf(tier.wall)];
    const used = tier.slots.reduce((sum, d) => sum + d.slotW, 0);
    const spread = Math.min(1.6, Math.max(0.18, (tierLen - used) / (tier.slots.length + 1)));
    let cursor = -tierLen / 2 + spread;
    const boardTop = row.boardY[tier.level];
    for (const d of tier.slots) {
      const jitter = hash(d.seed, 3.7);
      const bookH = (row.pitch - BOARD - 0.12) *
        (BOOK_H_JITTER[0] + (BOOK_H_JITTER[1] - BOOK_H_JITTER[0]) * jitter);
      const slot: BookSlot = {
        book: d.book,
        chapters: d.chapters,
        color: leather(d.seed),
        spineW: d.spineW,
        u0: cursor,
        slotW: d.slotW,
        level: tier.level,
        wall: tier.wall,
        cx: row.x + row.dir[0] * (cursor + d.slotW / 2),
        cz: row.z + row.dir[1] * (cursor + d.slotW / 2),
        bookH,
        spineStart: spines.length,
      };
      const slotIndex = slots.length;
      slots.push(slot);
      d.chapters.forEach((ch, ci) => {
        const u = cursor + SLOT_GAP / 2 + (ci + 0.5) * d.spineW;
        const depth = Math.min(1.7, SHELF_DEPTH * 0.62);
        // 册子贴住背板往前立，前沿留一段进深——真实书架的凹入感
        const nOff = -SHELF_DEPTH / 2 + BACK_PANEL + depth / 2;
        spines.push({
          slot: slotIndex,
          chapter: ch,
          chapterIndex: ci,
          x: row.x + row.dir[0] * u + row.normal[0] * nOff,
          z: row.z + row.dir[1] * u + row.normal[1] * nOff,
          y: boardTop + bookH / 2,
          w: d.spineW * 0.94,
          h: bookH,
          depth,
          dir: row.dir,
          normal: row.normal,
          cell: spines.length,
        });
        ch.concepts.forEach((concept, k) => {
          dust.push({
            x: row.x + row.dir[0] * (u + (k % 3 - 1) * 0.34) + row.normal[0] * (SHELF_DEPTH / 2 + 0.55),
            z: row.z + row.dir[1] * (u + (k % 3 - 1) * 0.34) + row.normal[1] * (SHELF_DEPTH / 2 + 0.55),
            y: boardTop + 0.1 + 0.08 * (k % 2),
            size: 0.2 + 0.14 * Math.min(1, (d.book.stats?.quizzes ?? 0) / 90) + 0.05 * (k % 3),
            book: d.book,
            conceptId: concept.id,
          });
        });
      });
      cursor += d.slotW + spread;
    }
  }

  return {
    discipline,
    side,
    height: 15,
    rows,
    slots,
    spines,
    dust,
    bookCount: slots.length,
    chapterCount: spines.length,
    cells: spines.length,
  };
}
