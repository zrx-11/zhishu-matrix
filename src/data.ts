import type { BodyFile, BookRecord, Discipline, ManifestIndex, SearchShard, Shard, SiteEntry } from './types';

const manifestCache = { value: null as ManifestIndex | null };
const shardCache = new Map<Discipline, Shard>();
const inflight = new Map<string, Promise<unknown>>();

// 产物里的数据是 vite.config.ts 预压的 `xxx.json.gz`（阶段 B：整份拷 data/ 太胖）；
// dev 直接暴露 data/ 明文，所以按构建模式加分支，两边都不用改调用点。
const PREFIX = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const GZIPPED = import.meta.env.PROD;

function dataUrl(rel: string, gzipped = true): string {
  return `${PREFIX}/${rel}${gzipped && GZIPPED ? '.gz' : ''}`;
}

/** gzip 还原：只有 DecompressionStream（Chrome 80 / Safari 16.4 / Firefox 113 起）能读预压分片 */
async function gunzip(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  // 托管层若对 .gz 加了 Content-Encoding: gzip，浏览器已透明解压，拿到的就是明文 JSON（无 1f 8b 魔数）
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前浏览器不支持 DecompressionStream，读不了产物里的 .json.gz 分片');
  }
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

async function getJson<T>(url: string): Promise<T> {
  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;
  const task = fetch(url, { cache: 'force-cache' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      // 托管层开了 SPA 回落时，取不到的分片会以 text/html + 200 返回，不当成 JSON 解析
      if ((res.headers.get('content-type') || '').includes('text/html')) {
        throw new Error(`${url} → 拿到的是 HTML（产物缺这个文件，SPA 回落把 404 伪装成 200）`);
      }
      const text = url.endsWith('.gz') ? await gunzip(await res.arrayBuffer()) : await res.text();
      return JSON.parse(text) as T;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, task);
  return task;
}

export async function loadManifest(): Promise<ManifestIndex> {
  if (manifestCache.value) return manifestCache.value;
  // 首屏引导链保持明文：解压能力没就绪也得能起页面
  manifestCache.value = await getJson<ManifestIndex>(dataUrl('manifest.json', false));
  return manifestCache.value;
}

/** 进房间才加载该学科分片（docs/design.md 第六节）；分片缺失时返回空，不抛错 */
export async function loadShard(discipline: Discipline): Promise<Shard> {
  const hit = shardCache.get(discipline);
  if (hit) return hit;
  let shard: Shard;
  try {
    shard = await getJson<Shard>(dataUrl(`dist/${discipline}.json`));
  } catch {
    // 批 1 里 tools 六个站全无 manifest，dist/tools.json 不存在 —— 空分片而不是白屏
    shard = { discipline, sites: [] };
  }
  shardCache.set(discipline, shard);
  return shard;
}

export function booksOf(manifest: ManifestIndex, discipline: Discipline): SiteEntry[] {
  return manifest.sites.filter((s) => s.discipline === discipline);
}

/**
 * 检索分片按需加载（批 4 判据 C2）：只有用户在该学科内发起搜索才取 `dist/search-<area>.json`。
 * 首屏与分区浏览一律不取；文件缺失（tools 区曾无数据）退回空片而不是白屏。
 */
export async function loadSearchShard(discipline: Discipline): Promise<SearchShard> {
  try {
    return await getJson<SearchShard>(dataUrl(`dist/search-${discipline}.json`));
  } catch {
    return {
      schemaVersion: 1,
      area: discipline,
      generator: 'missing',
      generatedAt: null,
      counts: { books: 0, chapters: 0, concepts: 0, terms: 0 },
      books: [],
    };
  }
}

/**
 * 正文按需加载（批 3 判据 C1）：只有进阅读页才取 `data/bodies/<file>.json`。
 * 129 本共 7.4MB（预压后 2.7MB），大厅与分区浏览阶段一律不请求、也不预取。
 */
export async function loadBody(file: string): Promise<BodyFile> {
  return getJson<BodyFile>(dataUrl(`bodies/${encodeURIComponent(file)}`));
}

/** 单本结构记录，点书 / 检索命中跳转才取；取不到返回 null 由调用方降级，不白屏 */
export async function loadSiteRecord(file: string): Promise<BookRecord | null> {
  try {
    return await getJson<BookRecord>(dataUrl(`sites/${encodeURIComponent(file)}`));
  } catch {
    return null;
  }
}

export function groupedByDiscipline(
  manifest: ManifestIndex,
): Map<Discipline, SiteEntry[]> {
  const map = new Map<Discipline, SiteEntry[]>();
  for (const site of manifest.sites) {
    const list = map.get(site.discipline) ?? [];
    list.push(site);
    map.set(site.discipline, list);
  }
  return map;
}
