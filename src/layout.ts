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
  /**
   * 挂在该章立柱上的概念光点。
   * 来源是 `concepts[].chapterIds`，**不是 `chapters[].conceptIds`**——
   * 129 本实测 1,169 章里只有 15 章带 conceptIds，而 765 个概念的 chapterIds 全部可解析〔X〕，
   * 走前者会画出一片没有光点的空立柱。
   */
  concepts: Array<{ id: string; title: string }>;
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
    const byChapter = conceptsByChapter(rec);
    const per = Math.max(1, Math.ceil(Math.sqrt(n)));
    const step = 4.2;
    chapters.forEach((ch, i) => {
      const cx = placement.x + (i % per - (per - 1) / 2) * step;
      const cz = placement.z + (Math.floor(i / per) - (Math.ceil(n / per) - 1) / 2) * step;
      const num = typeof ch.num === 'number' ? ch.num : i + 1;
      const concepts = byChapter.get(ch.id) ?? [];
      columns.push({
        book: placement.book,
        chapter: { id: ch.id, title: ch.title, num },
        x: cx,
        z: cz,
        height: 2.2 + Math.min(num, 24) * 0.34,
        concepts,
      });
    });
  }
  return { ...layout, columns };
}

/** 全书 concepts 按 `chapterIds` 反绑到章；一章多概念就全挂，不做数量截断 */
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
