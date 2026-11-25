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
