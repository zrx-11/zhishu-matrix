import './styles.css';
import type { BookRecord, Discipline, ManifestIndex, SiteEntry } from './types';
import { ROOMS, ROOM_BY_KEY, prefersFlatView } from './config';
import { booksOf, loadManifest, loadShard } from './data';
import { key, recordIndex } from './layout';
import { closePanel, openBook } from './panel';
import { store } from './state';
import type { Matrix3D } from './scene3d';
import { MatrixFlat } from './svg2d';

type View = Matrix3D | MatrixFlat;

const els = {
  three: document.getElementById('three-root') as HTMLDivElement,
  flat: document.getElementById('svg-root') as HTMLDivElement,
  loading: document.getElementById('loading') as HTMLDivElement,
  where: document.getElementById('where') as HTMLDivElement,
  hud: document.getElementById('hud') as HTMLDivElement,
  roombar: document.getElementById('roombar') as HTMLElement,
  home: document.getElementById('btn-home') as HTMLButtonElement,
  close: document.getElementById('panel-close') as HTMLButtonElement,
};

let manifest: ManifestIndex | null = null;
let view: View | null = null;
let mode: 'three' | 'flat' | null = null;
let currentRoom: Discipline | null = null;
const shardCache = new Map<Discipline, Map<string, BookRecord>>();
const bookCache = new Map<string, BookRecord>();

function setHud(text: string): void {
  if (els.hud) els.hud.textContent = text;
}

function setWhere(text: string): void {
  if (els.where) els.where.textContent = text;
}

function buildRoombar(): void {
  if (!els.roombar || !manifest) return;
  els.roombar.textContent = '';
  for (const r of ROOMS) {
    const n = booksOf(manifest, r.key).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${r.short} ${n}`;
    btn.style.color = r.color;
    btn.dataset.room = r.key;
    btn.addEventListener('click', () => void enterRoom(r.key));
    els.roombar.appendChild(btn);
  }
  syncRoombar();
}

function syncRoombar(): void {
  for (const btn of Array.from(els.roombar.querySelectorAll<HTMLButtonElement>('button'))) {
    btn.setAttribute('aria-current', String(btn.dataset.room === currentRoom));
  }
}

async function recordsOf(discipline: Discipline): Promise<Map<string, BookRecord>> {
  const hit = shardCache.get(discipline);
  if (hit) return hit;
  const shard = await loadShard(discipline);
  const map = recordIndex(shard);
  shardCache.set(discipline, map);
  return map;
}

async function bookRecord(book: SiteEntry): Promise<BookRecord | null> {
  const k = key(book.repo, book.bookSlug);
  if (bookCache.has(k)) return bookCache.get(k) ?? null;
  try {
    const res = await fetch(`/sites/${encodeURIComponent(book.file)}`, { cache: 'force-cache' });
    if (!res.ok) return null;
    const rec = (await res.json()) as BookRecord;
    bookCache.set(k, rec);
    return rec;
  } catch {
    return null;
  }
}

function isView3D(v: View | null): v is Matrix3D {
  return !!v && v.kind === '3d';
}

async function enterRoom(discipline: Discipline): Promise<void> {
  if (!manifest || !view) return;
  if (isView3D(view)) {
    // 离开大厅时存下大厅相机，返回时原样恢复（判据：返回后相机与选中状态不丢）
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
  }
  currentRoom = discipline;
  const books = booksOf(manifest, discipline);
  const records = books.length ? await recordsOf(discipline) : new Map<string, BookRecord>();
  if (isView3D(view)) {
    view.enterRoom(discipline, books, records, store.snapshot.roomCameras[discipline] ?? null);
  } else {
    (view as MatrixFlat).enterRoom(discipline, books);
  }
  setWhere(`${ROOM_BY_KEY[discipline].title} · ${books.length} 本`);
  store.setView('room', discipline);
  syncRoombar();
}

function showHall(): void {
  if (!view) return;
  if (currentRoom && isView3D(view)) store.setRoomCamera(currentRoom, view.currentPose());
  currentRoom = null;
  if (isView3D(view)) view.showHall(store.snapshot.hallCamera);
  else (view as MatrixFlat).showHall();
  setWhere('中央大厅');
  store.setView('hall', null);
  syncRoombar();
}

function pickBook(book: SiteEntry): void {
  // 选书时保存的是「当前所在视图」的相机，不能误写大厅位姿
  if (isView3D(view)) {
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
  }
  store.setSelection({ discipline: currentRoom, book });
  void bookRecord(book).then((rec) => openBook(book, rec));
}

async function mount(): Promise<void> {
  manifest = await loadManifest();
  const wantFlat = prefersFlatView();
  const nextMode = wantFlat ? 'flat' : 'three';
  if (view && mode === nextMode) return;
  if (view) {
    // 跨越 768px 断点重挂载时，先把当前位姿写回状态，返回后不丢
    if (isView3D(view)) {
      if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
      else store.setHallCamera(view.currentPose());
    }
    view.dispose();
    view = null;
  }
  if (nextMode === 'three') {
    els.flat.hidden = true;
    els.three.hidden = false;
    // 移动端走 2D 时不加载 Three.js（docs/design.md 第七节）
    const { Matrix3D } = await import('./scene3d');
    view = new Matrix3D(els.three, manifest, {
      onPickRoom: (d) => void enterRoom(d),
      onPickBook: (_d, b) => pickBook(b),
      onHud: setHud,
      onCamera: () => undefined,
    });
    els.three.addEventListener('click', (ev) => {
      (view as Matrix3D).handleClick(ev as PointerEvent);
    });
  } else {
    els.three.hidden = true;
    els.flat.hidden = false;
    view = new MatrixFlat(els.flat, manifest, {
      onPickRoom: (d) => void enterRoom(d),
      onPickBook: (_d, b) => pickBook(b),
      onHud: setHud,
      onPan: (p) => store.setFlatPan(p),
    });
    (view as MatrixFlat).setPan(store.snapshot.flatPan);
  }
  mode = nextMode;
  buildRoombar();
  const resume = store.snapshot;
  if (resume.view === 'room' && resume.room) await enterRoom(resume.room);
  else showHall();
  if (resume.selection.book && manifest) {
    const found = manifest.sites.find(
      (s) =>
        s.repo === resume.selection.book?.repo &&
        s.bookSlug === resume.selection.book?.bookSlug,
    );
    if (found) void bookRecord(found).then((rec) => openBook(found, rec));
  }
  if (els.loading) els.loading.hidden = true;
  exposeDiagnostics();
}

function exposeDiagnostics(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__zhishu = {
    mode,
    totals: manifest?.totals ?? null,
    levels: manifest?.contentLevels ?? null,
    room: () => currentRoom,
    fps: () => (view ? view.fps() : 0),
    running: () => (isView3D(view) ? view.isRunning : true),
    pose: () => (isView3D(view) ? view.currentPose() : (view as MatrixFlat).currentPan),
    screenPoint: (kind: 'room' | 'book', id: string) =>
      isView3D(view) ? view.screenPoint(kind, id) : null,
    nodeStats: () => (isView3D(view) ? view.nodeStats() : null),
    enterRoom: (d: Discipline) => void enterRoom(d),
    showHall,
    wake: () => {
      if (isView3D(view)) view.nudge();
    },
  };
}

function boot(): void {
  els.home?.addEventListener('click', showHall);
  els.close?.addEventListener('click', closePanel);
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePanel();
    if (ev.key === 'h' || ev.key === 'H') showHall();
  });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const want = prefersFlatView() ? 'flat' : 'three';
      if (want !== mode) void mount();
      else if (isView3D(view)) view.resize();
    }, 160);
  });
  void mount().catch((err) => {
    if (els.loading) els.loading.textContent = `加载失败：${String(err)}`;
    setHud(String(err));
  });
}

boot();
