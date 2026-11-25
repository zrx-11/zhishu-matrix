import type { BookRecord, SiteEntry } from './types';

export interface BookPlacement {
  book: SiteEntry;
  /** 房间内平面坐标（以房间中心为原点） */
  x: number;
  z: number;
  cols: number;
}

export interface ChapterPlacement {
  book: SiteEntry;
  chapter: { id: string; title: string; num: number | null };
  x: number;
  z: number;
  height: number;
  conceptCount: number;
}

export interface RoomLayout {
  books: BookPlacement[];
  columns: ChapterPlacement[];
  span: number;
}

/** 展台按书排布：方格阵列，同仓库的书相邻（按 repo 分组排序） */
export function layoutRoom(books: SiteEntry[]): RoomLayout {
  const sorted = [...books].sort(
    (a, b) => a.repo.localeCompare(b.repo) || a.bookSlug.localeCompare(b.bookSlug),
  );
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const pitch = 26;
  const placements: BookPlacement[] = sorted.map((book, i) => ({
    book,
    x: (i % cols - (cols - 1) / 2) * pitch,
    z: (Math.floor(i / cols) - (Math.ceil(sorted.length / cols) - 1) / 2) * pitch,
    cols,
  }));
  return { books: placements, columns: [], span: cols * pitch };
}

/** 展台上的章节立柱：按章节序号排成小网格，高度随 num 递增（docs/design.md 第三节） */
export function layoutColumns(
  layout: RoomLayout,
  records: Map<string, BookRecord>,
): RoomLayout {
  const columns: ChapterPlacement[] = [];
  for (const placement of layout.books) {
    const rec = records.get(key(placement.book.repo, placement.book.bookSlug));
    const chapters = rec?.chapters ?? [];
    const n = chapters.length;
    if (!n) continue;
    const per = Math.max(1, Math.ceil(Math.sqrt(n)));
    const step = 4.2;
    chapters.forEach((ch, i) => {
      const cx = placement.x + (i % per - (per - 1) / 2) * step;
      const cz = placement.z + (Math.floor(i / per) - (Math.ceil(n / per) - 1) / 2) * step;
      const num = typeof ch.num === 'number' ? ch.num : i + 1;
      columns.push({
        book: placement.book,
        chapter: { id: ch.id, title: ch.title, num },
        x: cx,
        z: cz,
        height: 2.2 + Math.min(num, 24) * 0.34,
        conceptCount: Math.min(ch.conceptIds?.length ?? 0, 6),
      });
    });
  }
  return { ...layout, columns };
}

export function key(repo: string, slug: string): string {
  return `${repo}::${slug}`;
}

export function recordIndex(shard: { sites: BookRecord[] }): Map<string, BookRecord> {
  const map = new Map<string, BookRecord>();
  for (const rec of shard.sites) map.set(key(rec.repo, rec.bookSlug), rec);
  return map;
}
