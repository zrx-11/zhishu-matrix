/**
 * 批 7 标定脚本：在浏览器里现改光参 / 反照率倍率，量地面与整屏亮度、帧率，
 * 选出一组常量再写回源码——避免「改一版重编一次」的十几次往返。
 * 用法：PROBE_BASE=http://127.0.0.1:4199/ node tools/tune_batch7.mjs
 */
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:4199/';
const EDGE = process.env.PROBE_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const GROUND = [0.05, 0.18, 0.9, 0.34];
const FULL = [0, 0, 1, 1];

function region(name) {
  const [x, y, w, h] = name === 'ground' ? GROUND : FULL;
  return `window.__zhishu.sampleLuminance(${x},${y},${w},${h})`;
}

async function fps(page, ms) {
  await page.evaluate(() => window.__zhishu.holdMinimap(true));
  await page.waitForTimeout(400);
  const n = await page.evaluate(
    (t) =>
      new Promise((res) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - t0 < t) requestAnimationFrame(tick);
          else res(frames / ((performance.now() - t0) / 1000));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
  await page.evaluate(() => window.__zhishu.holdMinimap(false));
  return Number(n.toFixed(1));
}

/** 旋钮走 Matrix3D.tune：它知道自己建了哪些灯与地面，脚本不必再遍历场景猜 */
async function knap(page, opts) {
  return page.evaluate(`window.__zhishu.tune(${JSON.stringify(opts)})`);
}

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--headless=new', '--disable-gpu-sandbox', '--use-angle=d3d11', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '?flat=0', { waitUntil: 'load' });
await page.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 30000 });
await page.evaluate(() => window.__zhishu.showHall());
await page.waitForTimeout(1200);

console.log('knap', JSON.stringify(await knap(page, {})));

const rows = [];
for (const key of [1.35, 1.05, 0.8]) {
  for (const hemi of [0.62, 0.42]) {
    for (const albedo of [1, 0.55, 0.35]) {
      await knap(page, { key, hemi, groundAlbedo: albedo, discAlbedo: albedo, exposure: 1 });
      await page.waitForTimeout(120);
      const full = await page.evaluate(region('full'));
      const ground = await page.evaluate(region('ground'));
      rows.push({ key, hemi, albedo, full: full.mean, ground: ground.mean, p95: ground.p95 });
    }
  }
}
console.log('--- 大厅亮度网格 (key × hemi × 地面反照率倍率) ---');
for (const r of rows) {
  console.log(
    `key=${r.key} hemi=${r.hemi} albedo=${r.albedo} → full=${r.full} ground=${r.ground} groundP95=${r.p95}`,
  );
}

// 帧率 A/B：bloom、阴影各自的代价
await knap(page, { key: 1.05, hemi: 0.42, groundAlbedo: 0.55, discAlbedo: 0.55, exposure: 1 });
const hallBase = await fps(page, 4000);
await page.evaluate(() => window.__zhishu.setPassEnabled('Bloom', false));
const hallNoBloom = await fps(page, 4000);
await page.evaluate(() => window.__zhishu.setPassEnabled('Bloom', true));
await page.evaluate(() => window.__zhishu.setShadowsEnabled(false));
const hallNoShadow = await fps(page, 4000);
await page.evaluate(() => window.__zhishu.setShadowsEnabled(true));
console.log(`大厅 fps: 基线 ${hallBase} · 关 bloom ${hallNoBloom} · 关阴影 ${hallNoShadow}`);

await page.evaluate(() => window.__zhishu.enterRoom('general'));
await page.waitForFunction(() => window.__zhishu.room() === 'general', null, { timeout: 20000 });
await page.waitForTimeout(1200);
const genBase = await fps(page, 4000);
const genLum = await page.evaluate(region('full'));
const genGround = await page.evaluate(region('ground'));
await page.evaluate(() => window.__zhishu.setPassEnabled('Bloom', false));
const genNoBloom = await fps(page, 4000);
await page.evaluate(() => window.__zhishu.setPassEnabled('Bloom', true));
await page.evaluate(() => window.__zhishu.setShadowsEnabled(false));
const genNoShadow = await fps(page, 4000);
await page.evaluate(() => window.__zhishu.setShadowsEnabled(true));
console.log(
  `通识区 fps: 基线 ${genBase} · 关 bloom ${genNoBloom} · 关阴影 ${genNoShadow} · 亮度 full=${genLum.mean} ground=${genGround.mean}`,
);

// 点光强度对房间亮度的影响（区内两盏点光是主光之外的主要来源）
for (const point of [1600, 900, 500]) {
  await knap(page, { roomPoint: point });
  await page.waitForTimeout(120);
  const r = await page.evaluate(region('full'));
  console.log(`point=${point} → 通识 full=${r.mean}`);
}

for (const bloom of [
  { threshold: 0.62, strength: 0.45, radius: 0.5 },
  { threshold: 0.7, strength: 0.35, radius: 0.45 },
  { threshold: 0.55, strength: 0.6, radius: 0.6 },
]) {
  await page.evaluate(
    `window.__zhishu.setBloom(${JSON.stringify(bloom)})`,
  );
  await page.waitForTimeout(150);
  const f = await page.evaluate(region('full'));
  const sky = await page.evaluate(
    `window.__zhishu.sampleLuminance(0.05,0.6,0.9,0.34)`,
  );
  console.log(
    `bloom ${JSON.stringify(bloom)} → full=${f.mean} p95=${f.p95} bright=${f.brightRatio} sky=${sky.mean}`,
  );
}

console.log('errors', errors.slice(0, 5));
await browser.close();
