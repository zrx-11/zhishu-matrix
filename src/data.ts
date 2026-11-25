import type { Discipline, ManifestIndex, Shard, SiteEntry } from './types';

const manifestCache = { value: null as ManifestIndex | null };
const shardCache = new Map<Discipline, Shard>();
const inflight = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T> {
  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;
  const task = fetch(url, { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return res.json() as Promise<T>;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, task);
  return task;
}

export async function loadManifest(): Promise<ManifestIndex> {
  if (manifestCache.value) return manifestCache.value;
  manifestCache.value = await getJson<ManifestIndex>('/manifest.json');
  return manifestCache.value;
}

/** 进房间才加载该学科分片（docs/design.md 第六节）；分片缺失时返回空，不抛错 */
export async function loadShard(discipline: Discipline): Promise<Shard> {
  const hit = shardCache.get(discipline);
  if (hit) return hit;
  let shard: Shard;
  try {
    shard = await getJson<Shard>(`/dist/${discipline}.json`);
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
