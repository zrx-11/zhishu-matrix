// 与 docs/schema.md v2 对齐的最小类型面；未列字段用索引签名兜住，避免抽取器加字段就编译不过
export type ContentLevel = 'full' | 'degraded' | 'stats-only';
export type Discipline = 'math' | 'ai' | 'chem' | 'cs' | 'general' | 'tools';

export interface BookStats {
  chapters: number;
  concepts: number;
  quizzes: number;
  cards: number;
  glossary: number;
}

export interface SiteEntry {
  repo: string;
  bookSlug: string;
  title: string;
  discipline: Discipline;
  file: string;
  contentLevel: ContentLevel;
  stats: BookStats;
  duplicateGroup?: string;
  [k: string]: unknown;
}

export interface ManifestIndex {
  generatedAt: string | null;
  generator: string;
  schemaVersion: number;
  totals: { repos: number; sites: number; sitesUnique: number; [k: string]: number };
  contentLevels: Record<ContentLevel, number>;
  disciplines: Array<{ key: Discipline; title: string; repoCount: number; siteCount: number }>;
  sites: SiteEntry[];
  failures: Array<{ repo: string; bookSlug: string | null; reason: string; [k: string]: unknown }>;
}

export interface ChapterNode {
  id: string;
  num: number | null;
  title: string;
  core?: string;
  minutes?: number | null;
  conceptIds?: string[];
  quizIds?: string[];
  bodyType?: string;
}

export interface ConceptNode {
  id: string;
  title: string;
  chapterIds?: string[];
  prerequisites?: string[];
  brief?: string;
  /** 深度推导文本，实测 82/765 非空 */
  depth?: string;
  claims?: string[];
  bodyType?: string;
}

export interface BookRecord {
  repo: string;
  bookSlug: string;
  title: string;
  discipline: Discipline;
  contentLevel: ContentLevel;
  chapters: ChapterNode[];
  concepts: ConceptNode[];
  [k: string]: unknown;
}

export interface Shard {
  discipline: Discipline;
  sites: BookRecord[];
}

/** `data/bodies/<file>.json`：章节与概念正文，点开阅读页才取 */
export interface BodyEntry {
  bodyType: 'md' | 'html' | string;
  body: string;
}

export interface BodyFile {
  repo: string;
  bookSlug: string;
  chapters: Record<string, BodyEntry>;
  concepts: Record<string, BodyEntry>;
}

export interface Pick {
  kind: 'room' | 'book';
  discipline: Discipline;
  book?: SiteEntry;
}

/** `data/dist/search-<area>.json`：批 4 检索分片，tools/build_search_index.py 产出 */
export interface SearchChapter {
  id: string;
  title: string;
  core?: string;
}

export interface SearchConcept {
  id: string;
  name: string;
  brief?: string;
}

export interface SearchTerm {
  t: string;
  d?: string;
  /** 该术语所在章，抽不到为空串，命中后只落书总览 */
  c?: string;
}

export interface SearchBook {
  slug: string;
  file: string;
  repo: string;
  title: string;
  area: Discipline;
  chapters: SearchChapter[];
  concepts: SearchConcept[];
  terms?: SearchTerm[];
}

export interface SearchShard {
  schemaVersion: number;
  area: Discipline;
  generator: string;
  generatedAt: string | null;
  source?: string;
  /** 体量超上限时的降级档：full / titles-only / no-terms */
  trim?: string;
  counts: { books: number; chapters: number; concepts: number; terms: number };
  books: SearchBook[];
}

export type SearchKind = 'chapter' | 'concept' | 'book';

export interface SearchHit {
  kind: SearchKind;
  label: string;
  book: string;
  file: string;
  area: Discipline;
  /** 章节 id 或概念 id；书级命中为 null */
  target: string | null;
  /** 命中路径说明，例如「术语」 */
  via: string | null;
}
