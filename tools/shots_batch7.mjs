// 批 7 渲染层取证脚本：同机位拍 before / after 两套截图，并落一份指标 JSON。
//   python -m http.server 4199 -d dist &
//   PROBE_BASE=http://127.0.0.1:4199 PROBE_TAG=before node tools/shots_batch7.mjs
// 机位只由视图与布局决定（不改布局即两次一致），材质/灯光/后期改动不影响取景。
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
const TAG = process.env.PROBE_TAG ?? 'before';
const SHOTS = process.env.PROBE_SHOTS ?? '_work/shots-batch7';
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

/** 采样三块区域：整屏、地面横带（阴影主要落点）、上半（天空与雾） */
async function luminance(page) {
  return page.evaluate(() => {
    const w = window.__zhishu;
    return {
      full: w.sampleLuminance(0, 0, 1, 1),
      ground: w.sampleLuminance(0.05, 0.18, 0.9, 0.34),
      sky: w.sampleLuminance(0.05, 0.66, 0.9, 0.3),
    };
  });
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

  // ---------------------------------------------------------------- 大厅
  await page.evaluate(() => window.__zhishu.showHall());
  await page.waitForTimeout(600);
  await shot(page, 'hall');
  metrics.desktop.hall = {
    pose: await page.evaluate(() => window.__zhishu.pose()),
    census: await page.evaluate(() => window.__zhishu.census()),
  };
  await page.evaluate(() => window.__zhishu.holdMinimap(true));
  const hallFps = await fps(page, 10000);
  await page.evaluate(() => window.__zhishu.holdMinimap(false));
  metrics.desktop.hall.fps10s = hallFps;
  metrics.desktop.hall.luminance = await luminance(page);
  // 后期与阴影的 A/B：同机位同帧率下逐条关掉再比亮度
  const bloomOff = await page.evaluate(async () => {
    window.__zhishu.setPassEnabled('Bloom', false);
    await new Promise((r) => setTimeout(r, 120));
    const v = window.__zhishu.census();
    return { census: v, on: false };
  });
  metrics.desktop.hall.bloomOff = bloomOff.census.post.passes.length > 0;
  metrics.desktop.hall.luminanceBloomOff = await luminance(page);
  await page.evaluate(() => window.__zhishu.setPassEnabled('Bloom', true));
  await page.waitForTimeout(120);
  metrics.desktop.hall.luminanceShadowsOff = await page.evaluate(async () => {
    window.__zhishu.setShadowsEnabled(false);
    await new Promise((r) => setTimeout(r, 150));
    const v = window.__zhishu.sampleLuminance(0.05, 0.18, 0.9, 0.34);
    window.__zhishu.setShadowsEnabled(true);
    return v;
  });

  // ---------------------------------------------------------------- 六区
  for (const zone of ZONES) {
    await page.evaluate((k) => window.__zhishu.enterRoom(k), zone);
    await page.waitForFunction((k) => window.__zhishu.room() === k, zone, { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot(page, `room-${zone}`);
    const nodes = await page.evaluate(() => window.__zhishu.nodeStats());
    if (zone === 'math') {
      await page.evaluate(() => window.__zhishu.holdMinimap(true));
      const f = await fps(page, 5000);
      await page.evaluate(() => window.__zhishu.holdMinimap(false));
      metrics.desktop.mathFps5s = f;
    }
    metrics.desktop[zone] = {
      pose: await page.evaluate(() => window.__zhishu.pose()),
      nodes,
      census: await page.evaluate(() => window.__zhishu.census()),
      luminance: await luminance(page),
    };
  }

  // ---------------------------------------------------------------- 阅读页（同一本书、同一章，两次可比）
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

  // 立柱形态与光点的几何取证在逐区循环的 census 里（builtColumnGeometry / dotBillboard / dotTexture）

  await context.close();

  // ---------------------------------------------------------------- 手机 390（2D 降级，仍不得加载 three）
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const m = await mctx.newPage();
  await m.goto(BASE, { waitUntil: 'load' });
  await m.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 20000 });
  await m.waitForTimeout(700);
  await shot(m, 'mobile390');
  metrics.mobile = {
    mode: await m.evaluate(() => window.__zhishu.mode),
    scrollWidth: await m.evaluate(() => document.documentElement.scrollWidth),
    canvas: await m.evaluate(() => Boolean(document.querySelector('#three-root canvas'))),
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
  hallFps10s: metrics.desktop.hall?.fps10s,
  mathFps5s: metrics.desktop.mathFps5s,
  hallCensus: metrics.desktop.hall?.census,
  mathCensus: metrics.desktop.math?.census,
  zones: Object.fromEntries(
    ZONES.map((k) => [k, {
      geometry: metrics.desktop[k]?.census?.builtColumnGeometry ?? null,
      kind: metrics.desktop[k]?.census?.columnKinds?.[k] ?? null,
      mainPass: metrics.desktop[k]?.census?.triangles?.mainPass ?? null,
      shadowPass: metrics.desktop[k]?.census?.triangles?.shadowPass ?? null,
      perFrame: metrics.desktop[k]?.census?.triangles?.perFrame ?? null,
      calls: metrics.desktop[k]?.census?.calls?.perFrame ?? null,
      dots: metrics.desktop[k]?.census?.dotCount ?? null,
    }]),
  ),
  mobile: metrics.mobile,
  errors: metrics.errors,
};
console.log(JSON.stringify(brief, null, 2));

/**
 * 从磁盘上的 data/ 确定性挑一本「full + 第一条正文够长」的书与章（Node 侧读，不走网络，
 * 也不管产物里是明文还是 .gz——读的是 data/ 源，data/ 一字不动）。
 */
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
