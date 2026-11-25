// 批 8 空间化取证：大厅用本批默认机位（体量缩小后 (0,330,380) 只占画面一角，见 HALL_POSE 注释），
// 进区机位由布局决定；额外拍书脊特写并跑 faceIndex 映射 vs 真实射线的对账。
//   python -m http.server 4199 -d dist &
//   PROBE_BASE=http://127.0.0.1:4199 PROBE_TAG=after node tools/shots_batch8.mjs
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
const SHOTS = process.env.PROBE_SHOTS ?? '_work/shots-batch8';
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

  await page.goto(`${BASE}/?flat=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 20000 });
  await page.waitForTimeout(900);

  // ---------------------------------------------------------------- 大厅（与 before 同机位）
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
  };
  // 走廊：门 + 走廊墙 + 地面铭牌
  await page.evaluate(() => window.__zhishu.viewCorridor('math'));
  await page.waitForTimeout(600);
  await shot(page, 'corridor');
  metrics.desktop.corridor = await page.evaluate(() => window.__zhishu.corridorScreenBox('math'));

  // ---------------------------------------------------------------- 六区
  for (const zone of ZONES) {
    await page.evaluate((k) => window.__zhishu.enterRoom(k), zone);
    await page.waitForFunction((k) => window.__zhishu.room() === k, zone, { timeout: 15000 });
    await page.waitForTimeout(900);
    await shot(page, `room-${zone}`);
    const census = await page.evaluate(() => window.__zhishu.census());
    const structure = await page.evaluate(() => window.__zhishu.structure());
    const nodes = await page.evaluate(() => window.__zhishu.nodeStats());
    // 挑三条书脊：首、中、尾，特写 + faceIndex 映射 vs 射线对账
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
    // 回到默认机位测帧率（与批 7 同口径：进区视角、8 秒采样）
    // 截图与特写会触发图集重建，采样前留足 1.5s 让重建落定，否则把建图耗时算进帧率
    await page.evaluate((k) => window.__zhishu.enterRoom(k), zone);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__zhishu.holdMinimap(true));
    const f = await fps(page, zone === 'general' || zone === 'ai' ? 8000 : 4000);
    await page.evaluate(() => window.__zhishu.holdMinimap(false));
    metrics.desktop[zone] = {
      fps: f,
      census,
      structure,
      nodes,
      spineProbes: probes,
    };
  }

  // ---------------------------------------------------------------- 阅读页（同 before 的同一本书同一章）
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

  // ---------------------------------------------------------------- 交互回归：WASD、返回大厅状态
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

  // ---------------------------------------------------------------- 手机 390（2D 平面视图）
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
  await m.evaluate(() => window.__zhishu.enterRoom('math'));
  await m.waitForTimeout(900);
  await shot(m, 'mobile390-room');
  metrics.mobile = {
    mode: await m.evaluate(() => window.__zhishu.mode),
    scrollWidth: await m.evaluate(() => document.documentElement.scrollWidth),
    canvas: await m.evaluate(() => Boolean(document.querySelector('#three-root canvas'))),
    svgNodes: await m.evaluate(() => document.querySelectorAll('#svg-root svg *').length),
    roomSvg: await m.evaluate(() => document.querySelectorAll('#svg-root [data-slug]').length),
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
  hall: summarize(metrics.desktop.hall?.census),
  zones: Object.fromEntries(
    ZONES.map((k) => {
      const c = metrics.desktop[k]?.census;
      const s = metrics.desktop[k]?.structure;
      return [k, {
        fps: metrics.desktop[k]?.fps,
        ...summarize(c),
        walls: s?.walls,
        ceiling: s?.ceiling,
        baseboards: s?.baseboards,
        rails: s?.rails,
        beams: s?.ceilingBeams,
        shelfRows: s?.shelfRows,
        tiers: s?.tiers,
        side: s?.side,
        probes: (metrics.desktop[k]?.spineProbes ?? []).map((p) => ({
          i: p.index,
          chapter: p.chapterId,
          hitKind: p.hit?.kind ?? null,
          hitChapter: p.hit?.chapterId ?? null,
          ok: p.hit?.kind === 'chapter' && p.hit?.chapterId === p.chapterId,
        })),
      }];
    }),
  ),
  wasd: metrics.desktop.wasd,
  backToHall: summarize(metrics.desktop.backToHall?.census),
  mobile: metrics.mobile,
  errors: metrics.errors,
};
console.log(JSON.stringify(brief, null, 2));

function summarize(c) {
  if (!c) return null;
  return {
    tris: c.triangles,
    calls: c.calls.perFrame,
    spineMeshes: c.spines.meshes,
    spineCells: c.spines.cells,
    spineChapters: c.spines.chapters,
    spineMapped: c.spines.mapped,
    mapLengths: c.spines.mapLengths,
    shelfRows: c.shelves.rows,
    shelfGeom: c.builtShelfGeometry.length,
    shelfKind: c.builtShelfKind,
    dots: c.dotCount,
    labels: c.labels,
    hall: c.hall,
    room: c.room,
  };
}

/** 与批 7 / before 同一本「full + 正文够长」的书，两次截图可比 */
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
