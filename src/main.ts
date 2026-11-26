import './styles.css';
import type { BookRecord, Discipline, ManifestIndex, SearchHit, SiteEntry } from './types';
import { ROOMS, ROOM_BY_KEY } from './config';
import { booksOf, loadManifest, loadShard, loadSiteRecord } from './data';
import { SPINE_PLATE_RECT } from './atlas';
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

/** 批 9 起全端只有 3D 一条渲染路径（2D 降级视图与 `svg2d.ts` 已删除） */
type View = Matrix3D;

const els = {
  three: document.getElementById('three-root') as HTMLDivElement,
  loading: document.getElementById('loading') as HTMLDivElement,
  where: document.getElementById('where') as HTMLDivElement,
  hud: document.getElementById('hud') as HTMLDivElement,
  roombar: document.getElementById('roombar') as HTMLElement,
  minimap: document.getElementById('minimap') as HTMLElement | null,
  home: document.getElementById('btn-home') as HTMLButtonElement,
  walk: document.getElementById('btn-walk') as HTMLButtonElement | null,
  close: document.getElementById('panel-close') as HTMLButtonElement,
  back: document.getElementById('panel-back') as HTMLButtonElement,
};

let manifest: ManifestIndex | null = null;
let view: View | null = null;
let mode: 'three' | null = null;
let currentRoom: Discipline | null = null;
let miniRaf = 0;
const shardCache = new Map<Discipline, Map<string, BookRecord>>();
const bookCache = new Map<string, BookRecord>();

/** 小地图：3D 视图左下角俯视，画八角厅 + 六条走廊 + 六座阅览室 + 本区书架平面 */
function drawMinimap(): void {
  const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  const wrap = document.getElementById('minimap');
  const cap = document.getElementById('minimap-cap');
  if (!canvas || !wrap || !manifest) return;
  const state3d = view ? view.minimapState() : null;
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
  // 世界 x/z ∈ [-175,175] 等比映射进画布（六区外缘 ±173）
  const span = 350;
  const sc = Math.min(w, h) / span;
  const px = (x: number) => w / 2 + x * sc;
  const pz = (z: number) => h / 2 + z * sc;
  const hall = state3d.hall;
  if (hall) {
    ctx.strokeStyle = '#3d465c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < hall.sides; i += 1) {
      const a = (Math.PI * 2 * i) / hall.sides + Math.PI / hall.sides;
      const x = px(Math.cos(a) * hall.radius);
      const y = pz(Math.sin(a) * hall.radius);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(38,44,60,0.55)';
    ctx.fill();
    ctx.stroke();
  }
  for (const cor of state3d.corridors ?? []) {
    const dx = Math.cos(cor.angle);
    const dz = Math.sin(cor.angle);
    ctx.strokeStyle = '#2b3244';
    ctx.lineWidth = Math.max(1.5, cor.width * sc);
    ctx.beginPath();
    ctx.moveTo(px(dx * cor.from), pz(dz * cor.from));
    ctx.lineTo(px(dx * cor.to), pz(dz * cor.to));
    ctx.stroke();
  }
  for (const zone of state3d.zones) {
    ctx.fillStyle = zone.color;
    ctx.globalAlpha = zone.here ? 1 : 0.55;
    ctx.fillRect(px(zone.x) - 5, pz(zone.z) - 5, 10, 10);
    ctx.globalAlpha = 1;
    if (zone.here) {
      ctx.strokeStyle = '#ffd66b';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(px(zone.x) - 7, pz(zone.z) - 7, 14, 14);
    }
    ctx.fillStyle = '#e8ecf4';
    ctx.font = '9px "Source Han Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${zone.short} ${zone.count}`, px(zone.x), pz(zone.z) + 15);
  }
  if (state3d.shell) {
    // 进区后：本区按真实边长与朝向画房间方框，书位跟着墙走
    const s = state3d.shell;
    const half = (s.side / 2) * sc;
    ctx.save();
    ctx.translate(px(s.x), pz(s.z));
    ctx.rotate(-s.angle);
    ctx.fillStyle = 'rgba(26,30,41,0.75)';
    ctx.fillRect(-half, -half, half * 2, half * 2);
    ctx.strokeStyle = '#8b95a8';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    // 正门那一侧（局部 −Z → 屏幕 −Y）开口
    ctx.strokeStyle = '#ffd66b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-half * 0.3, -half);
    ctx.lineTo(half * 0.3, -half);
    ctx.stroke();
    ctx.restore();
    for (const b of state3d.books) {
      ctx.fillStyle = b.level === 'full' ? '#cfd6e4' : '#6b7688';
      ctx.fillRect(px(b.x) - 1.5, pz(b.z) - 1.5, 3, 3);
    }
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
    cap.textContent = state3d.view === 'hall'
      ? '俯视 · 八角厅 · 六门通六区'
      : `平面 · ${ROOM_BY_KEY[state3d.room ?? 'general'].short} 阅览室 · 三面书架`;
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
  else if (view) drawMinimap();
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

async function enterRoom(discipline: Discipline): Promise<void> {
  if (!manifest || !view) return;
  searchSpot = null; // 用户自己走了，检索返程落点即失效
  // 离开大厅时存下大厅相机，返回时原样恢复（判据：返回后相机与选中状态不丢）
  if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
  else store.setHallCamera(view.currentPose());
  currentRoom = discipline;
  const books = booksOf(manifest, discipline);
  const records = books.length ? await recordsOf(discipline) : new Map<string, BookRecord>();
  view.enterRoom(discipline, books, records, store.snapshot.roomCameras[discipline] ?? null);
  setWhere(`${ROOM_BY_KEY[discipline].title} · ${books.length} 本`);
  store.setView('room', discipline);
  syncRoombar();
}

function showHall(): void {
  if (!view) return;
  searchSpot = null;
  if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
  currentRoom = null;
  view.showHall(store.snapshot.hallCamera);
  setWhere('中央大厅');
  store.setView('hall', null);
  syncRoombar();
}

/** 批 11：顶栏「走进 / 退出」——手机上这是唯一的入口（没有 F 键），所以必须常驻可点 */
function syncWalkBtn(walk: boolean): void {
  const btn = els.walk;
  if (!btn) return;
  btn.textContent = walk ? '退出' : '走进';
  btn.setAttribute('aria-pressed', walk ? 'true' : 'false');
  btn.setAttribute('aria-label', walk ? '退出第一人称漫游' : '进入第一人称漫游');
  btn.classList.toggle('on', walk);
}

function toggleWalk(): boolean {
  if (!view) return false;
  const on = view.toggleWalk();
  syncWalkBtn(view.camModeName() === 'walk');
  return on;
}

function pickBook(book: SiteEntry): void {
  // 选书时保存的是「当前所在视图」的相机，不能误写大厅位姿
  if (view) {
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
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
  if (view) {
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
    view.highlightConcept(conceptId);
  }
  store.setSelection({ discipline: currentRoom, book });
  void bookRecord(book).then((rec) => void openConceptOf(book, rec, conceptId));
}

/** 点章节立柱 = 选书 + 直接进该章正文（比先开总览少一步） */
function pickChapter(book: SiteEntry, chapterId: string): void {
  if (view) {
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

/**
 * 展柜书脊 = 选书 + 进该书**首章**。首章 id 只在书目分片里（大厅不为它预取六片，
 * 分片按需加载是批 4 的口径），所以这里现取记录、由记录定首章，不拿 manifest 猜。
 */
function pickFirstChapter(book: SiteEntry): void {
  if (view) {
    if (currentRoom) store.setRoomCamera(currentRoom, view.currentPose());
    else store.setHallCamera(view.currentPose());
    view.highlightConcept(null);
  }
  store.setSelection({ discipline: currentRoom, book });
  void bookRecord(book).then((rec) => {
    openBook(book, rec);
    const first = rec?.chapters?.[0];
    if (first) void openChapter(first.id);
  });
}

/** 检索跳转前的落点：判据 C4 要求返回时回到原书节点与原相机位姿，不重置 */
interface Spot {
  room: Discipline | null;
  pose: CameraPose | null;
  book: SiteEntry | null;
}

let searchSpot: Spot | null = null;

function currentSpot(): Spot {
  return {
    room: currentRoom,
    pose: view ? view.currentPose() : null,
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
    if (spot.pose) view.applyPose(spot.pose);
    view.nudge();
    if (spot.book) store.setSelection({ discipline: spot.book.discipline, book: spot.book });
    else store.setSelection({ discipline: spot.room, book: null });
    syncRoombar();
    const book = openedBook();
    setHud(
      `已按检索前落点返回 · 相机位姿未重置（当前 ${book ? book.title || book.bookSlug : '无选中书目'}，原节点 ${spot.book ? spot.book.title || spot.book.bookSlug : '无'}）`,
    );
    return;
  }
  const pose = currentRoom ? store.snapshot.roomCameras[currentRoom] : store.snapshot.hallCamera;
  if (pose) view.applyPose(pose);
  view.nudge();
  const book = openedBook();
  setHud(
    book
      ? `已返回${currentRoom ? ROOM_BY_KEY[currentRoom].title : '大厅'} · 相机位姿未重置（${book.title || book.bookSlug} 仍在选中）`
      : '已返回空间视图',
  );
}

async function mount(): Promise<void> {
  manifest = await loadManifest();
  if (view) return;
  // scene3d 仍走动态 import：它把 three + 后期链 + 建筑几何单独分包，首屏只取 main，
  // 且「移动端确实加载了 scene3d 分包」这条判据要靠真实的 chunk 请求来证，而不是靠代码里写了 import。
  const { Matrix3D } = await import('./scene3d');
  els.three.hidden = false;
  view = new Matrix3D(els.three, manifest, {
    onPickRoom: (d) => void enterRoom(d),
    onPickBook: (_d, b) => pickBook(b),
    onPickChapter: (_d, b, cid) => pickChapter(b, cid),
    onPickConcept: (_d, b, cid) => pickConcept(b, cid),
    onFirstChapter: (_d, b) => pickFirstChapter(b),
    onHud: setHud,
    onCamera: () => undefined,
    inputBusy: () => panelOpen() || isTyping() || miniBusy(),
    onCamMode: (walk) => syncWalkBtn(walk),
  });
  els.three.addEventListener('click', (ev) => {
    (view as Matrix3D).handleClick(ev as PointerEvent);
  });
  mode = 'three';
  buildRoombar();
  stopMinimap();
  drawMinimap();
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
    running: () => (view ? view.isRunning : true),
    pose: () => (view ? view.currentPose() : null),
    screenPoint: (kind: 'room' | 'book', id: string) =>
      view ? view.screenPoint(kind, id) : null,
    nodeStats: () => (view ? view.nodeStats() : null),
    /** 批 8 空间取证：结构账、书脊特写落点、真实拾取回归 */
    structure: () => (view ? view.structure() : null),
    /** 批 9：画质档位与竖屏构图账，门槛断言只读这两条，不从截图反推 */
    quality: () => (view ? view.quality() : null),
    frameCheck: () => (view ? view.frameCheck() : null),
    /** 批 10 A2：主体占屏比（大厅壳+走廊+门签 / 阅览室内壳结构点） */
    subjectBox: (which?: 'hall' | 'room') => (view ? view.subjectBox(which) : null),
    /** 批 10 B：藻井梁/井板、门洞内外、总览图与整帧 p5 的亮度账 */
    hallLightProbe: () => (view ? view.hallLightProbe() : null),
    /** 批 10 C：题签宽度实测（跨脊扫描线与图集参数双证） */
    spinePlateProbe: (i: number) => (view ? view.spinePlateProbe(i) : null),
    /** 批 10 C：图集绘制参数（题签占脊宽比由 atlas 常量直接给出） */
    spinePlateSpec: () => ({ x: SPINE_PLATE_RECT.x, y: SPINE_PLATE_RECT.y, w: SPINE_PLATE_RECT.w, h: SPINE_PLATE_RECT.h, cellW: 32, cellH: 160 }),
    lastTap: () => (view ? view.lastTap() : null),
    /** 批 11：第一人称漫游取证。只读 walkState + 走真实按键链路，不另开一条内部通道 */
    walk: () => (view ? view.walkState() : null),
    walkToggle: () => toggleWalk(),
    setWalk: (on: boolean) => (view ? view.setWalk(on) : false),
    walkSnap: (x: number, z: number, fx: number, fz: number) =>
      view ? view.walkSnapTo(x, z, fx, fz) : null,
    walkAimSpine: (i: number) => (view ? view.walkAimSpine(i) : null),
    /** 批 12：中央索引台与展柜取证。同样只读真实拾取链，不另开内部通道 */
    atriumState: () => (view ? view.atriumState() : null),
    hallSightScan: (limit?: number) => (view ? view.hallSightScan(limit ?? 25) : null),
    aimDeskSector: (i: number) => (view ? view.aimDeskSector(i) : null),
    aimCaseSpine: (i: number) => (view ? view.aimCaseSpine(i) : null),
    aimDeskRay: (deg: number) => (view ? view.aimDeskRay(deg) : null),
    doorBearingScan: (step?: number) => (view ? view.doorBearingScan(step ?? 1) : null),
    walkGroundSample: (pitch?: number) => (view ? view.walkGroundSample(pitch ?? -35) : null),
    walkGapAt: (x: number, z: number) => (view ? view.walkGapAt(x, z) : null),
    hallAudit: () => (view ? view.hallAudit() : null),
    aimCaseBody: (i: number) => (view ? view.aimCaseBody(i) : null),
    walkSetLook: (yawDeg: number, pitchDeg: number) =>
      view ? view.walkSetLook(yawDeg, pitchDeg) : null,
    closeupReport: () => (view ? view.closeupReport() : null),
    walkMarch: (dx: number, dz: number, d: number, use?: 'here' | 'hall' | 'room') =>
      view ? view.walkMarch(dx, dz, d, use ?? 'here') : null,
    walkTraceStart: () => {
      view?.walkTraceStart();
      return true;
    },
    walkTraceStop: () => (view ? view.walkTraceStop() : null),
    spineContrast: () => (view ? view.spineContrast() : null),
    focusSpine: (i: number, dist?: number) =>
      view ? view.focusSpine(i, dist ?? 3.4) : null,
    spineProbe: (i: number) => (view ? view.spineProbe(i) : null),
    probePick: (x: number, y: number) => (view ? view.probePick(x, y) : null),
    spineCellPeek: (i: number) => (view ? view.spineCellPeek(i) : null),
    triangles: () => (view ? view.triangles() : null),
    roleHide: (role: string, hide: boolean) => (view ? view.roleHide(role, hide) : 0),
    /** 渲染层取证：census / 亮度采样 / 单条 pass 开关，只有 3D 视图有 */
    census: () => (view ? view.census() : null),
    sampleLuminance: (x?: number, y?: number, w?: number, h?: number) =>
      view ? view.sampleLuminance(x ?? 0, y ?? 0, w ?? 1, h ?? 1) : null,
    setPassEnabled: (name: string, on: boolean) => (view ? view.setPassEnabled(name, on) : false),
    setBloom: (next: { threshold?: number; strength?: number; radius?: number }) =>
      view ? view.setBloom(next) : false,
    tune: (o: Record<string, number>) => (view ? view.tune(o) : null),
    setShadowsEnabled: (on: boolean) => {
      if (view) view.setShadowsEnabled(on);
    },
    direction: () => (view ? view.direction() : null),
    corridorLabels: () => (view ? view.corridorLabels() : []),
    viewCorridor: (key: Discipline) => (view ? view.viewCorridor(key) : false),
    corridorScreenBox: (key: Discipline) =>
      view ? view.corridorScreenBox(key) : null,
    minimap: () => (view ? view.minimapState() : null),
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
      if (view) view.nudge();
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
        book: spot.book ? { file: spot.book.file, slug: spot.book.bookSlug, title: spot.book.title } : null,
      };
    },
  };
}

function boot(): void {
  els.home?.addEventListener('click', showHall);
  els.walk?.addEventListener('click', () => {
    toggleWalk();
  });
  els.close?.addEventListener('click', closePanel);
  els.back?.addEventListener('click', goBack);
  configurePanel({
    onHud: setHud,
    onClose: restorePose,
    onConceptShown: (cid) => {
      if (view) view.highlightConcept(cid);
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
    // 只重排相机与帧缓冲，不再重挂载：批 9 起只有一条渲染路径，跨 768px 换的是画质档不是视图
    resizeTimer = window.setTimeout(() => view?.resize(), 160);
  });
  void mount().catch((err) => {
    if (els.loading) els.loading.textContent = `加载失败：${String(err)}`;
    setHud(String(err));
  });
}

boot();
