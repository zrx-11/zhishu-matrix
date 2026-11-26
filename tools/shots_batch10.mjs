// 批 10 取证：after 覆盖 1440 大厅 / 数学区 / 书脊特写 + 390 大厅 / 数学区 / 检索，每类 ≥8 张。
// before 从 shots-batch9 同机位复制：大厅 showHall 默认位、走廊 viewCorridor('math')、数学区默认位、
// focusSpine(i, 3.2) 的 0/中/末三条、390 大厅 / 数学区 / 检索同参。
//   npm run build
//   python -m http.server 4199 -d dist &
//   PROBE_BASE=http://127.0.0.1:4199 node tools/shots_batch10.mjs
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
const OUT = '_work/shots-batch10';
const OLD = '_work/shots-batch9';
fs.mkdirSync(OUT, { recursive: true });

const metrics = { at: new Date().toISOString(), base: BASE, shots: [], before: [], zones: {}, mobile: {}, errors: [] };
const copyBefore = (from, to) => {
  const src = `${OLD}/${from}`;
  if (!fs.existsSync(src)) {
    metrics.errors.push(`before 缺图：${src}`);
    return;
  }
  fs.copyFileSync(src, `${OUT}/${to}`);
  metrics.before.push(to);
};
for (const [from, to] of [
  ['after-hall.png', 'before-hall.png'],
  ['after-corridor.png', 'before-corridor.png'],
  ['after-room-math.png', 'before-room-math.png'],
  ['after-mobile390.png', 'before-mobile390.png'],
  ['after-mobile390-room.png', 'before-mobile390-room.png'],
  ['after-mobile390-search.png', 'before-mobile390-search.png'],
]) copyBefore(from, to);
for (const f of fs.readdirSync(OLD)) {
  const m = /^after-spine-(.+)\.png$/.exec(f);
  if (m) copyBefore(f, `before-spine-${m[1]}.png`);
}

const ZONES = ['math', 'ai', 'chem', 'cs', 'general', 'tools'];
const CORRIDORS = ['math', 'ai', 'chem', 'cs', 'general', 'tools'];
const QUERIES = ['傅里叶', '矩阵', '概率', '导数', '积分', '算法', '图论', '神经网络'];

async function shot(page, name) {
  const path = `${OUT}/after-${name}.png`;
  await page.screenshot({ path });
  metrics.shots.push(path);
  return path;
}

async function ready(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 20000 });
  await page.waitForTimeout(900);
}

async function drag(page, x0, y0, dx, dy) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const open = await page.evaluate(() => window.__zhishu.readerState().open);
  if (open) {
    await page.evaluate(() => document.getElementById('panel-close')?.click());
    await page.waitForTimeout(250);
  }
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
  await ready(page);

  // ---------------------------------------------------------------- 1440 大厅 ×8
  await page.evaluate(() => window.__zhishu.showHall());
  await page.waitForTimeout(700);
  await shot(page, 'hall');
  for (const key of CORRIDORS) {
    await page.evaluate((k) => window.__zhishu.viewCorridor(k), key);
    await page.waitForTimeout(380);
    await shot(page, `corridor-${key}`);
  }
  await page.evaluate(() => window.__zhishu.showHall());
  await page.waitForTimeout(500);
  await drag(page, 720, 450, 130, 0);
  await shot(page, 'hall-rot');

  // ---------------------------------------------------------------- 1440 数学区 ×8（默认位 + 7 个环视位）
  await page.evaluate(() => window.__zhishu.enterRoom('math'));
  await page.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'room', null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await shot(page, 'room-math');
  for (let i = 1; i <= 7; i += 1) {
    await drag(page, 720, 460, 95, 0);
    await shot(page, `room-math-view${i}`);
  }

  // ---------------------------------------------------------------- 1440 书脊特写（五区 × 0/中/末 = 15 张，同机位 3.2）
  for (const zone of ZONES) {
    await page.evaluate((k) => window.__zhishu.enterRoom(k), zone);
    await page.waitForFunction((k) => window.__zhishu.room() === k, zone, { timeout: 15000 });
    await page.waitForTimeout(800);
    const total = await page.evaluate(() => window.__zhishu.census()?.spines?.cells ?? 0);
    if (!total) {
      metrics.zones[zone] = { cells: 0 };
      continue;
    }
    const picks = [0, Math.floor(total / 2), total - 1];
    const rows = [];
    for (const i of picks) {
      const probe = await page.evaluate((idx) => window.__zhishu.focusSpine(idx, 3.2), i);
      await page.waitForTimeout(340);
      await shot(page, `spine-${zone}-${i}`);
      rows.push({ i, chapter: probe?.chapterId, ok: probe?.hit?.kind === 'chapter' && probe.hit?.chapterId === probe.chapterId });
    }
    const contrast = await page.evaluate(() => window.__zhishu.spineContrast());
    const subject = await page.evaluate(() => window.__zhishu.subjectBox('room'));
    metrics.zones[zone] = {
      cells: total,
      picks: rows,
      contrastMin: contrast?.min,
      roomSubjectV: subject?.v,
      roomGroups: await page.evaluate(() => window.__zhishu.frameCheck()?.groups),
    };
  }
  await page.evaluate(() => window.__zhishu.showHall());
  await page.waitForTimeout(600);
  metrics.desktop = {
    hallSubject: await page.evaluate(() => window.__zhishu.subjectBox('hall')),
    hallLight: await page.evaluate(() => window.__zhishu.hallLightProbe()),
    hallCensus: await page.evaluate(() => window.__zhishu.census()),
  };
  await context.close();

  // ---------------------------------------------------------------- 390 大厅 ×8（默认 + 六走廊 + 回大厅）
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
  await ready(m);
  await shot(m, 'mobile390-hall');
  for (const key of CORRIDORS) {
    await m.evaluate((k) => window.__zhishu.viewCorridor(k), key);
    await m.waitForTimeout(420);
    await shot(m, `mobile390-corridor-${key}`);
  }
  await m.evaluate(() => window.__zhishu.showHall());
  await m.waitForTimeout(500);
  await shot(m, 'mobile390-back');
  metrics.mobile.hall = {
    subject: await m.evaluate(() => window.__zhishu.subjectBox('hall')),
    light: await m.evaluate(() => window.__zhishu.hallLightProbe()),
    frame: await m.evaluate(() => window.__zhishu.frameCheck()),
    scrollWidth: await m.evaluate(() => document.documentElement.scrollWidth),
  };

  // ---------------------------------------------------------------- 390 数学区 ×8（默认 + 7 条书脊特写）
  await m.evaluate(() => window.__zhishu.enterRoom('math'));
  await m.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'room', null, { timeout: 15000 });
  await m.waitForTimeout(900);
  await shot(m, 'mobile390-room');
  const cells = await m.evaluate(() => window.__zhishu.census()?.spines?.cells ?? 0);
  const spineRows = [];
  for (let k = 0; k < 7; k += 1) {
    const i = Math.floor((k * cells) / 7);
    const probe = await m.evaluate((idx) => window.__zhishu.focusSpine(idx, 3.2), i);
    await m.waitForTimeout(340);
    await shot(m, `mobile390-spine-${i}`);
    spineRows.push({ i, px: probe?.px, chapter: probe?.chapterId });
  }
  metrics.mobile.room = {
    cells,
    subject: await m.evaluate(() => window.__zhishu.subjectBox('room')),
    frame: await m.evaluate(() => window.__zhishu.frameCheck()),
    spineRows,
  };
  await m.evaluate(() => window.__zhishu.enterRoom('math'));
  await m.waitForTimeout(600);

  // ---------------------------------------------------------------- 390 检索 ×8
  const searchRows = [];
  for (let q = 0; q < QUERIES.length; q += 1) {
    await m.evaluate((query) => window.__zhishu.searchShow(query), QUERIES[q]);
    await m.waitForFunction(() => window.__zhishu.searchState().open === true, null, { timeout: 10000 });
    await m
      .waitForFunction(() => window.__zhishu.searchState().hits > 0, null, { timeout: 15000 })
      .catch(() => undefined);
    await m.waitForTimeout(550);
    await shot(m, `mobile390-search-${q + 1}`);
    searchRows.push({ q: QUERIES[q], ...(await m.evaluate(() => window.__zhishu.searchState())) });
    await m.evaluate(() => window.__zhishu.searchHide());
    await m.waitForTimeout(250);
  }
  metrics.mobile.search = searchRows;
  metrics.mobile.scrollWidth = await m.evaluate(() => document.documentElement.scrollWidth);
  await mctx.close();
} catch (err) {
  metrics.errors.push(String(err).slice(0, 400));
} finally {
  await browser.close();
}

fs.writeFileSync(`${OUT}/after-metrics.json`, JSON.stringify(metrics, null, 2));
const counts = {
  before: metrics.before.length,
  after: metrics.shots.length,
  hall1440: metrics.shots.filter((s) => /after-(hall|corridor)/.test(s)).length,
  math1440: metrics.shots.filter((s) => /after-room-math/.test(s)).length,
  spine1440: metrics.shots.filter((s) => /after-spine/.test(s)).length,
  hall390: metrics.shots.filter((s) => /after-mobile390-(hall|corridor|back)/.test(s)).length,
  math390: metrics.shots.filter((s) => /after-mobile390-(room|spine)/.test(s)).length,
  search390: metrics.shots.filter((s) => /after-mobile390-search/.test(s)).length,
};
console.log(JSON.stringify({ counts, errors: metrics.errors, search: metrics.mobile.search?.map((r) => ({ q: r.q, hits: r.hits })) }, null, 2));