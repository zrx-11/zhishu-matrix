// 批 9 全端 3D 取证：机位沿用批 8（大厅 showHall 默认位、进区由布局决定、走廊 viewCorridor），
// 差别只有两处——不再有 ?flat=0 与 #svg-root 读数（2D 已删），以及 390 窄视口从「平面视图」
// 换成「同一套 3D」：大厅 / 阅览室 / 触摸开书 / 检索四条链路各出一张图。
//   python -m http.server 4199 -d dist &
//   PROBE_BASE=http://127.0.0.1:4199 PROBE_TAG=after node tools/shots_batch9.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  execSync('npm i -D --no-audit --no-fund playwright-core', { stdio: 'inherit' });
  ({ chromium } = await import('playwright-core'));
}

const EDGE = process.env.PROBE_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:4199';
const TAG = process.env.PROBE_TAG ?? 'after';
const SHOTS = process.env.PROBE_SHOTS ?? '_work/shots-batch9';
fs.mkdirSync(SHOTS, { recursive: true });

const ZONES = ['math', 'ai', 'chem', 'cs', 'general', 'tools'];
const metrics = { tag: TAG, base: BASE, at: new Date().toISOString(), shots: [], desktop: {}, mobile: {}, errors: [] };

function fps(page, ms) {
  return page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let frames = 0;
        const tick = () => {
          frames += 1;
          const t = performance.now();
          if (t - t0 < dur) requestAnimationFrame(tick);
          else resolve(Number((frames / ((t - t0) / 1000)).toFixed(1)));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

async function shot(page, name) {
  const path = `${SHOTS}/${TAG}-${name}.png`;
  await page.screenshot({ path });
  metrics.shots.push(path);
  return path;
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith(BASE) || url.startsWith('blob:')) return route.continue();
    metrics.errors.push(`外部请求被拦：${url}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') metrics.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => metrics.errors.push(`pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 20000 });
  await page.waitForTimeout(900);

  // ---------------------------------------------------------------- 大厅（与批 8 同机位）
  await page.evaluate(() => window.__zhishu.showHall());
  await page.waitForTimeout(700);
  await shot(page, 'hall');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__zhishu.holdMinimap(true));
  const hallFps = await fps(page, 8000);
  await page.evaluate(() => window.__zhishu.holdMinimap(false));
  metrics.desktop.hall = {
    fps8s: hallFps,
    pose: await page.evaluate(() => window.__zhishu.pose()),
    census: await page.evaluate(() => window.__zhishu.census()),
    frameCheck: await page.evaluate(() => window.__zhishu.frameCheck()),
  };
  // 走廊：门 + 走廊墙 + 地面铭牌（顶面结构在画面里，批 9 C1 的判读位）
  await page.evaluate(() => window.__zhishu.viewCorridor('math'));
  await page.waitForTimeout(600);
  await shot(page, 'corridor');
  metrics.desktop.corridor = await page.evaluate(() => window.__zhishu.corridorScreenBox('math'));

  // ---------------------------------------------------------------- 六区
  for (const zone of ZONES) {
    await page.evaluate((k) => window.__zhishu.enterRoom(k), zone);
    await page.waitForFunction((k) => window.__zhishu.room() === k, zone, { timeout: 15000 });
    await page.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'room', null, { timeout: 15000 });
    await page.waitForTimeout(900);
    await shot(page, `room-${zone}`);
    const census = await page.evaluate(() => window.__zhishu.census());
    const structure = await page.evaluate(() => window.__zhishu.structure());
    const nodes = await page.evaluate(() => window.__zhishu.nodeStats());
    const frameCheck = await page.evaluate(() => window.__zhishu.frameCheck());
    const contrast = await page.evaluate(() => window.__zhishu.spineContrast());
    const total = census?.spines?.cells ?? 0;
    const picks = total ? [0, Math.floor(total / 2), Math.max(0, total - 1)] : [];
    const probes = [];
    for (const i of picks) {
      const probe = await page.evaluate((idx) => window.__zhishu.focusSpine(idx, 3.2), i);
      if (!probe) continue;
      await page.waitForTimeout(320);
      await shot(page, `spine-${zone}-${i}`);
      probes.push(probe);
    }
    await page.evaluate((k) => window.__zhishu.enterRoom(k), zone);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__zhishu.holdMinimap(true));
    const f = await fps(page, zone === 'general' || zone === 'ai' ? 8000 : 4000);
    await page.evaluate(() => window.__zhishu.holdMinimap(false));
    metrics.desktop[zone] = { fps: f, census, structure, nodes, frameCheck, contrast, spineProbes: probes };
  }

  // ---------------------------------------------------------------- 阅读页（同一本书同一章，与批 8 可比）
  const target = pickReadable();
  await page.evaluate((k) => window.__zhishu.enterRoom(k), target.discipline);
  await page.waitForFunction((k) => window.__zhishu.room() === k, target.discipline, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.evaluate((t) => window.__zhishu.openChapterOf({ slug: t.slug, file: t.file }, t.chapter), target);
  await page
    .waitForFunction(() => (document.getElementById('panel-body')?.innerText ?? '').length > 400, null, { timeout: 20000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  await shot(page, 'reader');
  metrics.desktop.reader = {
    file: target.file,
    chapter: target.chapter,
    chars: await page.evaluate(() => (document.getElementById('panel-body')?.innerText ?? '').length),
  };
  await page.evaluate(() => document.getElementById('panel-close')?.click());
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- 交互回归：WASD、返回大厅
  await page.evaluate(() => window.__zhishu.enterRoom('cs'));
  await page.waitForTimeout(600);
  const beforePose = await page.evaluate(() => window.__zhishu.pose());
  const beforeDir = await page.evaluate(() => window.__zhishu.direction());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  const afterPose = await page.evaluate(() => window.__zhishu.pose());
  const afterDir = await page.evaluate(() => window.__zhishu.direction());
  metrics.desktop.wasd = {
    moved: Math.hypot(afterPose.px - beforePose.px, afterPose.pz - beforePose.pz),
    dirShift: Math.hypot(afterDir.x - beforeDir.x, afterDir.z - beforeDir.z),
  };
  await page.evaluate(() => window.__zhishu.showHall());
  await page.waitForTimeout(500);
  metrics.desktop.backToHall = {
    room: await page.evaluate(() => window.__zhishu.room()),
    census: await page.evaluate(() => window.__zhishu.census()),
  };
  await context.close();

  // ---------------------------------------------------------------- 手机 390：同一套 3D
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const m = await mctx.newPage();
  m.on('pageerror', (e) => metrics.errors.push(`mobile pageerror: ${e.message}`));
  m.on('console', (msg) => {
    if (msg.type() === 'error') metrics.errors.push(`mobile console: ${msg.text()}`);
  });
  await m.goto(BASE, { waitUntil: 'load' });
  await m.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 20000 });
  await m.waitForTimeout(800);
  await shot(m, 'mobile390');
  metrics.mobile.hallFrame = await m.evaluate(() => window.__zhishu.frameCheck());
  await m.evaluate(() => window.__zhishu.holdMinimap(true));
  metrics.mobile.hallFps = await fps(m, 4000);
  await m.evaluate(() => window.__zhishu.holdMinimap(false));

  await m.evaluate(() => window.__zhishu.enterRoom('math'));
  await m.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'room', null, { timeout: 15000 });
  await m.waitForTimeout(900);
  await shot(m, 'mobile390-room');
  await m.evaluate(() => window.__zhishu.holdMinimap(true));
  metrics.mobile.roomFps = await fps(m, 4000);
  await m.evaluate(() => window.__zhishu.holdMinimap(false));
  metrics.mobile.roomFrame = await m.evaluate(() => window.__zhishu.frameCheck());
  metrics.mobile.roomCensus = await m.evaluate(() => window.__zhishu.census());

  // 指头轻点一根书脊 → 开的是点到的那一本那一章。屏幕点由 faceIndex 反查给出，
  // 但要挑一个真在视口内、且不被左下角小地图压住的格（门槛里同一条判据也是这么挑的）
  const tap = await m.evaluate(() => {
    const cells = window.__zhishu.census().spines.cells;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (let k = 0; k < 60 && cells > 0; k += 1) {
      const i = Math.floor((k * cells) / 60);
      const p = window.__zhishu.spineProbe(i);
      if (!p?.screen || p.hit?.kind !== 'chapter' || p.hit.chapterId !== p.chapterId) continue;
      const x = p.screen.x;
      const y = p.screen.y;
      if (x < 12 || y < 12 || x > vw - 12 || y > vh - 12) continue;
      if (x < 120 && y > vh - 120) continue;
      return { i, chapter: p.chapterId, file: p.book, x, y };
    }
    return null;
  });
  if (tap) await m.touchscreen.tap(tap.x, tap.y);
  await m
    .waitForFunction(() => window.__zhishu.readerState().open === true, null, { timeout: 20000 })
    .catch(() => undefined);
  await m.waitForTimeout(700);
  await shot(m, 'mobile390-reader');
  metrics.mobile.tap = {
    expect: tap,
    lastTap: await m.evaluate(() => window.__zhishu.lastTap()),
    readerState: await m.evaluate(() => window.__zhishu.readerState()),
    chars: await m.evaluate(() => (document.getElementById('panel-body')?.innerText ?? '').length),
  };
  await m.evaluate(() => document.getElementById('panel-close')?.click());
  await m.waitForTimeout(400);

  // 检索：窄屏下搜索面板 + 结果列表（正文仍走 HTML+KaTeX 阅读层）
  await m.evaluate(() => window.__zhishu.searchShow('傅里叶'));
  await m.waitForFunction(() => window.__zhishu.searchState().open === true, null, { timeout: 10000 });
  await m.waitForFunction(() => window.__zhishu.searchState().hits > 0, null, { timeout: 20000 }).catch(() => undefined);
  await m.waitForTimeout(600);
  await shot(m, 'mobile390-search');
  metrics.mobile.search = await m.evaluate(() => window.__zhishu.searchState());

  metrics.mobile.summary = {
    mode: await m.evaluate(() => window.__zhishu.mode),
    scrollWidth: await m.evaluate(() => document.documentElement.scrollWidth),
    canvas: await m.evaluate(() => Boolean(document.querySelector('#three-root canvas'))),
    quality: await m.evaluate(() => window.__zhishu.quality()),
    sceneChunk: await m.evaluate(() =>
      performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => n.startsWith('scene3d-')),
    ),
  };
  await mctx.close();
} catch (err) {
  metrics.errors.push(String(err).slice(0, 400));
} finally {
  await browser.close();
}

fs.writeFileSync(`${SHOTS}/${TAG}-metrics.json`, JSON.stringify(metrics, null, 2));
const brief = {
  tag: TAG,
  shots: metrics.shots.length,
  hallFps8s: metrics.desktop.hall?.fps8s,
  hall: { ...summarize(metrics.desktop.hall?.census), frame: metrics.desktop.hall?.frameCheck?.inFrame },
  zones: Object.fromEntries(
    ZONES.map((k) => {
      const c = metrics.desktop[k]?.census;
      const s = metrics.desktop[k]?.structure;
      const ct = metrics.desktop[k]?.contrast;
      return [k, {
        fps: metrics.desktop[k]?.fps,
        ...summarize(c),
        walls: s?.walls,
        ceiling: s?.ceiling,
        shelfRows: s?.shelfRows,
        side: s?.side,
        frame: metrics.desktop[k]?.frameCheck?.inFrame,
        contrastMin: ct?.min,
        probes: (metrics.desktop[k]?.spineProbes ?? []).map((p) => ({
          i: p.index,
          chapter: p.chapterId,
          ok: p.hit?.kind === 'chapter' && p.hit?.chapterId === p.chapterId,
        })),
      }];
    }),
  ),
  wasd: metrics.desktop.wasd,
  backToHall: summarize(metrics.desktop.backToHall?.census),
  mobile: {
    mode: metrics.mobile.summary?.mode,
    scrollWidth: metrics.mobile.summary?.scrollWidth,
    canvas: metrics.mobile.summary?.canvas,
    quality: metrics.mobile.summary?.quality,
    sceneChunk: metrics.mobile.summary?.sceneChunk,
    hallFps: metrics.mobile.hallFps,
    roomFps: metrics.mobile.roomFps,
    hallFrame: metrics.mobile.hallFrame?.inFrame,
    roomFrame: metrics.mobile.roomFrame?.inFrame,
    tap: metrics.mobile.tap,
    search: metrics.mobile.search,
  },
  errors: metrics.errors,
};
console.log(JSON.stringify(brief, null, 2));

function summarize(c) {
  if (!c) return null;
  return {
    tris: c.triangles,
    calls: c.calls.perFrame,
    spineCells: c.spines.cells,
    spineMeshes: c.spines.meshes,
    shelfRows: c.shelves.rows,
    dots: c.dotCount,
    labels: c.labels,
    hall: c.hall,
    room: c.room,
  };
}

/** 与批 7 / 批 8 同一本「full + 正文够长」的书，三次截图可比 */
function pickReadable() {
  if (pickReadable.cached) return pickReadable.cached;
  const manifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
  const sites = (manifest.sites || [])
    .filter((s) => s.contentLevel === 'full' && s.file)
    .sort((a, b) => a.file.localeCompare(b.file));
  for (const s of sites) {
    let rec = null;
    let bodies = null;
    try {
      rec = JSON.parse(fs.readFileSync(`data/sites/${s.file}`, 'utf8'));
      bodies = JSON.parse(fs.readFileSync(`data/bodies/${s.file}`, 'utf8'));
    } catch {
      continue;
    }
    for (const ch of rec.chapters || []) {
      const body = (bodies.chapters || {})[ch.id]?.body || '';
      if (body.length > 1200) {
        pickReadable.cached = { slug: s.bookSlug, file: s.file, chapter: ch.id, discipline: s.discipline };
        return pickReadable.cached;
      }
    }
  }
  const first = sites[0];
  pickReadable.cached = { slug: first.bookSlug, file: first.file, chapter: 'ch01', discipline: first.discipline };
  return pickReadable.cached;
}
