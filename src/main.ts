import './styles.css';
import type { BookRecord, Discipline, ManifestIndex, SearchHit, SiteEntry } from './types';
import { ROOMS, ROOM_BY_KEY, prefersFlatView } from './config';
import { booksOf, loadManifest, loadShard, loadSiteRecord } from './data';
import { forgetDiagrams, hydrateDiagrams, mermaidRequested, renderDiagram } from './diagram';
import { key, recordIndex } from './layout';
import { renderMarkdown } from './render';
import {
  closeSearch,
  configureSearch,
  initSearch,
  loadedShards,
  openSearch,
  runSearch,
  searchHits,
  searchOpen,
  searchPick,
  searchState,
  type Scope,
} from './search';
import {
  closePanel,
  configurePanel,
  goBack,
  loadedBodyCount,
  openBook,
  openChapter,
  openConcept,
  openConceptOf,
  openedBook,
  panelOpen,
  viewMode,
} from './panel';
import { store, type CameraPose } from './state';
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
  minimap: document.getElementById('minimap') as HTMLElement | null,
  home: document.getElementById('btn-home') as HTMLButtonElement,
  close: document.getElementById('panel-close') as HTMLButtonElement,
  back: document.getElementById('panel-back') as HTMLButtonElement,
};

let manifest: ManifestIndex | null = null;
let view: View | null = null;
let mode: 'three' | 'flat' | null = null;
let currentRoom: Discipline | null = null;
let miniRaf = 0;
const shardCache = new Map<Discipline, Map<string, BookRecord>>();
const bookCache = new Map<string, BookRecord>();

/** 小地图：3D 视图右下角俯视，标六区与当前相机（阶段 D 第 1 项） */
function drawMinimap(): void {
  const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  const wrap = document.getElementById('minimap');
  const cap = document.getElementById('minimap-cap');
  if (!canvas || !wrap || !manifest) return;
  const state3d = isView3D(view) ? view.minimapState() : null;
  if (!state3d) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e1015';
  ctx.fillRect(0, 0, w, h);
  // 大厅坐标 x∈[-260,260]、z∈[-190,190] 等比映射进画布
  const spanX = 560;
  const spanZ = 400;
  const sc = Math.min(w / spanX, h / spanZ);
  const px = (x: number) => w / 2 + x * sc;
  const pz = (z: number) => h / 2 + z * sc;
  ctx.strokeStyle = '#1c2230';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 40, 0, Math.PI * 2);
  ctx.stroke();
  for (const zone of state3d.zones) {
    ctx.beginPath();
    ctx.fillStyle = zone.color;
    ctx.globalAlpha = 0.9;
    ctx.arc(px(zone.x), pz(zone.z), 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8ecf4';
    ctx.font = '9px "Source Han Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${zone.short} ${zone.count}`, px(zone.x), pz(zone.z) + 17);
    ctx.strokeStyle = zone.color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(px(zone.x), pz(zone.z));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const b of state3d.books) {
    ctx.fillStyle = b.level === 'full' ? '#cfd6e4' : '#6b7688';
    ctx.fillRect(px(b.x) - 1.5, pz(b.z) - 1.5, 3, 3);
  }
  // 当前位置 + 朝向
  const cx = px(state3d.camera.x);
  const cz = pz(state3d.camera.z);
  const ang = Math.atan2(pz(state3d.look.z) - cz, px(state3d.look.x) - cx);
  ctx.strokeStyle = '#4a6cf7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cz);
  ctx.lineTo(cx + Math.cos(ang) * 14, cz + Math.sin(ang) * 14);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = '#ffd66b';
  ctx.arc(cx, cz, 4, 0, Math.PI * 2);
  ctx.fill();
  if (cap) {
    cap.textContent = state3d.view === 'hall' ? '俯视 · 中央大厅 · 六区' : `俯视 · ${ROOM_BY_KEY[state3d.room ?? 'general'].short} 房间`;
  }
  miniRaf = requestAnimationFrame(drawMinimap);
}

function stopMinimap(): void {
  if (miniRaf) cancelAnimationFrame(miniRaf);
  miniRaf = 0;
}

/** 采样窗口内挂起小地图与渲染唤醒，把主线程交给帧率测量 */
function holdMinimap(hold: boolean): void {
  (window as unknown as { __zhishuHold: boolean }).__zhishuHold = hold;
  if (hold) stopMinimap();
  else if (isView3D(view)) drawMinimap();
}

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
  const rec = await loadSiteRecord(book.file);
  if (rec) bookCache.set(k, rec);
  return rec;
}

type BookSel = { slug?: string, file?: string };

/** 同名 bookSlug 分布在多仓（31 个重名），自检与调用方给 file 时按 file 精确取 */
async function findBook(sel: BookSel): Promise<boolean> {
  const found = manifest?.sites.find((s) => (sel.file ? s.file === sel.file : s.bookSlug === sel.slug));
  if (!found) return false;
  currentRoom = found.discipline;
  const rec = await bookRecord(found);
  openBook(found, rec);
  return true;
}

function isView3D(v: View | null): v is Matrix3D {
  return !!v && v.kind === '3d';
}

async function enterRoom(discipline: Discipline): Promise<void> {
  if (!manifest || !view) return;
  searchSpot = null; // 用户自己走了，检索返程落点即失效
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
  searchSpot = null;
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
  } else if (view) {
    store.setFlatPan(view.currentPan);
  }
  store.setSelection({ discipline: currentRoom, book });
  void bookRecord(book).then((rec) => openBook(book, rec));
}

/** 自检脚本临时让出 rAF 时置 __zhishuHold，键盘也一并让位 */
function miniBusy(): boolean {
  return (window as unknown as { __zhishuHold?: boolean }).__zhishuHold === true;
}

/** 正文输入框聚焦时不让 WASD 抢键 */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function pickConcept(book: SiteEntry, conceptId: string): void {
  if (isView3D(view)) {
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
    view.highlightConcept(conceptId);
  }
  store.setSelection({ discipline: currentRoom, book });
  void bookRecord(book).then((rec) => void openConceptOf(book, rec, conceptId));
}

/** 点章节立柱 = 选书 + 直接进该章正文（比先开总览少一步） */
function pickChapter(book: SiteEntry, chapterId: string): void {
  if (isView3D(view)) {
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
    view.highlightConcept(null);
  }
  store.setSelection({ discipline: currentRoom, book });
  void bookRecord(book).then((rec) => {
    openBook(book, rec);
    void openChapter(chapterId);
  });
}

/** 检索跳转前的落点：判据 C4 要求返回时回到原书节点与原相机位姿，不重置 */
interface Spot {
  room: Discipline | null;
  pose: CameraPose | null;
  pan: { x: number; y: number; zoom: number } | null;
  book: SiteEntry | null;
}

let searchSpot: Spot | null = null;

function currentSpot(): Spot {
  return {
    room: currentRoom,
    pose: isView3D(view) ? view.currentPose() : null,
    pan: view && !isView3D(view) ? (view as MatrixFlat).currentPan : null,
    book: store.snapshot.selection.book,
  };
}

/**
 * 检索命中跳转：`file` 精确取书，绕开 31 个跨仓重名 slug（判据 C3）。
 * 只开阅读层，不改 3D 视图与 currentRoom，返回时位姿天然不动。
 */
async function openFromSearch(hit: SearchHit): Promise<boolean> {
  if (!manifest) return false;
  const found = manifest.sites.find((s) => s.file === hit.file);
  if (!found) return false;
  searchSpot = currentSpot();
  store.setSelection({ discipline: found.discipline, book: found });
  const rec = await bookRecord(found);
  openBook(found, rec);
  if (hit.target && hit.kind === 'concept') await openConcept(hit.target);
  else if (hit.target && hit.kind === 'chapter') await openChapter(hit.target);
  return true;
}

/** 关掉阅读层后回到原书节点与原相机位姿，不重置（判据 C5） */
function restorePose(): void {
  if (!view) return;
  const spot = searchSpot;
  searchSpot = null;
  if (spot) {
    currentRoom = spot.room;
    if (isView3D(view)) {
      if (spot.pose) view.applyPose(spot.pose);
      view.nudge();
    } else {
      view.setPan(spot.pan ?? store.snapshot.flatPan);
    }
    if (spot.book) store.setSelection({ discipline: spot.book.discipline, book: spot.book });
    else store.setSelection({ discipline: spot.room, book: null });
    syncRoombar();
    const book = openedBook();
    setHud(
      `已按检索前落点返回 · 相机位姿未重置（当前 ${book ? book.title || book.bookSlug : '无选中书目'}，原节点 ${spot.book ? spot.book.title || spot.book.bookSlug : '无'}）`,
    );
    return;
  }
  if (isView3D(view)) {
    const pose = currentRoom ? store.snapshot.roomCameras[currentRoom] : store.snapshot.hallCamera;
    if (pose) view.applyPose(pose);
    view.nudge();
  } else {
    view.setPan(store.snapshot.flatPan);
  }
  const book = openedBook();
  setHud(
    book
      ? `已返回${currentRoom ? ROOM_BY_KEY[currentRoom].title : '大厅'} · 相机位姿未重置（${book.title || book.bookSlug} 仍在选中）`
      : '已返回空间视图',
  );
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
      onPickChapter: (_d, b, cid) => pickChapter(b, cid),
      onPickConcept: (_d, b, cid) => pickConcept(b, cid),
      onHud: setHud,
      onCamera: () => undefined,
      inputBusy: () => panelOpen() || isTyping() || miniBusy(),
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
  stopMinimap();
  if (nextMode === 'three') drawMinimap();
  else if (els.minimap) els.minimap.hidden = true;
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
    triangles: () => (isView3D(view) ? view.triangles() : null),
    /** 渲染层取证：census / 亮度采样 / 单条 pass 开关，只有 3D 视图有 */
    census: () => (isView3D(view) ? view.census() : null),
    sampleLuminance: (x?: number, y?: number, w?: number, h?: number) =>
      isView3D(view) ? view.sampleLuminance(x ?? 0, y ?? 0, w ?? 1, h ?? 1) : null,
    setPassEnabled: (name: string, on: boolean) => (isView3D(view) ? view.setPassEnabled(name, on) : false),
    setBloom: (next: { threshold?: number; strength?: number; radius?: number }) =>
      isView3D(view) ? view.setBloom(next) : false,
    tune: (o: Record<string, number>) => (isView3D(view) ? view.tune(o) : null),
    setShadowsEnabled: (on: boolean) => {
      if (isView3D(view)) view.setShadowsEnabled(on);
    },
    direction: () => (isView3D(view) ? view.direction() : null),
    corridorLabels: () => (isView3D(view) ? view.corridorLabels() : []),
    viewCorridor: (key: Discipline) => (isView3D(view) ? view.viewCorridor(key) : false),
    corridorScreenBox: (key: Discipline) =>
      isView3D(view) ? view.corridorScreenBox(key) : null,
    minimap: () => (isView3D(view) ? view.minimapState() : null),
    renderSample: (src: string) => renderMarkdown(src),
    diagramRender: (src: string) => renderDiagram(src),
    diagramStates: () => {
      const counts: Record<string, number> = {};
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('#panel-body .diagram'))) {
        const st = el.dataset.diagram ?? 'none';
        counts[st] = (counts[st] ?? 0) + 1;
      }
      return { counts, mermaidRequested: mermaidRequested() };
    },
    loadedBodies: loadedBodyCount,
    readerState: () => ({
      mode: viewMode(),
      open: panelOpen(),
      book: openedBook()?.bookSlug ?? null,
      file: openedBook()?.file ?? null,
      level: openedBook()?.contentLevel ?? null,
    }),
    /** 自检专用：把一段 Markdown 直接铺进阅读层并走占位→可见→渲染那条真实路径 */
    injectReader: (md: string) => {
      const box = document.getElementById('panel-body');
      if (!box) return 0;
      forgetDiagrams(box);
      box.innerHTML = renderMarkdown(md).html;
      box.scrollTop = 0;
      hydrateDiagrams(box);
      return box.querySelectorAll('.diagram').length;
    },
    openBookBy: (sel: BookSel) => findBook(sel),
    openChapter: async (chapterId: string) => {
      await openChapter(chapterId);
      return true;
    },
    openChapterOf: async (sel: BookSel, chapterId: string) => {
      const ok = await findBook(sel);
      if (!ok) return false;
      await openChapter(chapterId);
      return true;
    },
    openConceptOf: async (sel: BookSel, conceptId: string) => {
      const ok = await findBook(sel);
      if (!ok) return false;
      await openConcept(conceptId);
      return true;
    },
    /** 合成 stats-only 样本：库内实测 0 本，C2 的第三档只能造数据走一遍 */
    openStatsOnlySample: async (sel: BookSel) => {
      const found = manifest?.sites.find((s) => (sel.file ? s.file === sel.file : s.bookSlug === sel.slug));
      if (!found) return false;
      const rec = await bookRecord(found);
      currentRoom = found.discipline;
      openBook({ ...found, contentLevel: 'stats-only' as const }, rec);
      const first = rec?.chapters?.[0]?.id;
      if (first) await openChapter(first);
      return true;
    },
    enterRoom: (d: Discipline) => void enterRoom(d),
    holdMinimap,
    showHall,
    wake: () => {
      if (isView3D(view)) view.nudge();
    },
    /* ---------------------------------------------------------------- 检索层（批 3.5 / 批 4） */
    searchOpen: () => searchOpen(),
    searchShow: (prefill = '') => openSearch(prefill),
    searchHide: () => closeSearch(),
    searchState: () => searchState(),
    searchRun: (q: string, scope?: Scope | null) => runSearch(q, scope ?? undefined),
    searchHits: () => searchHits().map((h) => ({ ...h })),
    searchPick: (i: number) => searchPick(i),
    searchLoaded: () => loadedShards(),
    /** 返程落点是否已快照（判据 C4 的可观测证据） */
    searchSpot: () => {
      const spot = searchSpot;
      if (!spot) return null;
      return {
        room: spot.room,
        pose: spot.pose,
        pan: spot.pan,
        book: spot.book ? { file: spot.book.file, slug: spot.book.bookSlug, title: spot.book.title } : null,
      };
    },
  };
}

function boot(): void {
  els.home?.addEventListener('click', showHall);
  els.close?.addEventListener('click', closePanel);
  els.back?.addEventListener('click', goBack);
  configurePanel({
    onHud: setHud,
    onClose: restorePose,
    onConceptShown: (cid) => {
      if (isView3D(view)) view.highlightConcept(cid);
    },
  });
  configureSearch({
    getManifest: () => manifest,
    currentScope: () => currentRoom ?? 'hall',
    onPick: (hit) => openFromSearch(hit),
    onHud: setHud,
  });
  initSearch();
  window.addEventListener('keydown', (ev) => {
    // 检索弹层开着时 Esc 只收弹层，不把阅读层一起关掉；`/` 与 Ctrl+K 由 search 内部处理
    if (ev.key === 'Escape' && !searchOpen()) closePanel();
    if (searchOpen() || isTyping()) return;
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
