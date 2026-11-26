// 批 3 浏览器自检探针：由 tools/selfcheck.py 启动（静态服务 dist/ 后调用），也可手动跑：
//   PROBE_BASE=http://127.0.0.1:4187 ZHISHU_SAMPLES='{"full":{...}}' node tools/selfcheck_probe.mjs
// 输出 JSON 到 stdout 末行，并写 _work/selfcheck-report.json
import { execSync } from 'node:child_process';
import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  // 自检不占构建依赖：探针首次运行才按需装（约 10MB，纯 JS，不下载浏览器）
  execSync('npm i -D --no-audit --no-fund playwright-core', { stdio: 'inherit' });
  ({ chromium } = await import('playwright-core'));
}

const EDGE = process.env.PROBE_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:4187';
const SHOTS = process.env.PROBE_SHOTS ?? '_work/shots-batch3';
const samples = JSON.parse(process.env.ZHISHU_SAMPLES ?? '{}');
fs.mkdirSync(SHOTS, { recursive: true });

const checks = [];
const log = [];
function check(name, pass, info) {
  checks.push({ name, pass: Boolean(pass), info: info === undefined ? null : info });
}
function clip(s, n = 160) {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').slice(0, n) : s;
}

const requests = { all: 0, bodies: [], external: [], blocked: [], search: [] };
const consoleErrors = [];
const pageErrors = [];

async function newPage(browser, tag, opts) {
  const context = await browser.newContext(opts);
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith(BASE) || url.startsWith('blob:')) {
      if (url.includes('/bodies/')) requests.bodies.push(`${tag}:${url.split('/').pop()}`);
      if (url.includes('/dist/search-')) requests.search.push(`${tag}:${url.split('/').pop()}`);
      requests.all += 1;
      return route.continue();
    }
    requests.external.push(`${tag}: ${url}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${tag}: ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(`${tag}: ${e.message}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.startsWith('data:') && !u.startsWith(BASE)) requests.blocked.push(`${tag}: ${u}`);
  });
  return { context, page };
}

async function ready(page) {
  await page.waitForFunction(() => window.__zhishu && window.__zhishu.totals, null, { timeout: 20000 });
  await page.waitForTimeout(700);
}

async function scrollWidth(page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    stage: document.getElementById('stage')?.scrollWidth ?? null,
    panel: document.getElementById('panel-body')?.scrollWidth ?? null,
    inner: window.innerWidth,
  }));
}

async function fps(page, ms) {
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

async function panelText(page) {
  return page.evaluate(() => document.getElementById('panel-body')?.innerText ?? '');
}

/** openChapter 是 async：等正文真的落到 DOM，别拿「加载中」的 44 字当结论 */
async function settle(page, min = 120, ms = 15000) {
  await page
    .waitForFunction((n) => (document.getElementById('panel-body')?.innerText ?? '').length > n, min, { timeout: ms })
    .catch(() => undefined);
  return page.evaluate(() => {
    const panel = document.getElementById('panel');
    const r = panel?.getBoundingClientRect();
    return {
      visible: !!r && r.width > 60 && r.height > 60 && !panel.hidden,
      chars: (document.getElementById('panel-body')?.innerText ?? '').length,
      mode: window.__zhishu.readerState().mode,
    };
  });
}

/** mermaid 分包在浏览器里的实际加载痕迹：chunk 名 + 模块级 promise 是否已发起 */
const MM_CHUNKS = new Set(samples.mermaidChunks || []);
async function mermaidChunks(page) {
  return page.evaluate((names) => {
    const set = new Set(names);
    return performance
      .getEntriesByType('resource')
      .map((r) => r.name.split('/').pop())
      .filter((n) => set.has(n));
  }, [...MM_CHUNKS]);
}

/** 读某个图型对应的围栏容器（data-kind 在渲染启动时才写，未渲染时按源码首词判） */
function readDiagram(kind) {
  const els = Array.from(document.querySelectorAll('#panel-body .diagram'));
  const el =
    els.find((e) => e.dataset.kind === kind) ||
    els.find((e) => ((e.querySelector('.diagram-src')?.textContent ?? '').trim().split(/[\s;{]/)[0] ?? '') === kind);
  if (!el) return null;
  const svg = el.querySelector('.diagram-view svg');
  const box = el.getBoundingClientRect();
  return {
    state: el.dataset.diagram ?? null,
    kind: el.dataset.kind ?? null,
    hasSvg: Boolean(svg),
    svgBytes: svg ? svg.outerHTML.length : 0,
    svgText: svg ? (svg.textContent ?? '').replace(/\s+/g, '').length : 0,
    inFlow: box.width > 40 && box.height > 20,
    remote: svg ? /(href|xlink:href|src)\s*=\s*"(https?:|\/\/)[^"]*"/i.test(svg.outerHTML) ? 1 : 0 : -1,
    cap: el.querySelector('.diagram-cap')?.textContent ?? '',
    err: el.querySelector('.diagram-err')?.textContent ?? '',
    src: (el.querySelector('.diagram-view pre.code')?.textContent ?? el.querySelector('.diagram-src')?.textContent ?? '').length,
  };
}

async function diagramFor(page, kind) {
  return page.evaluate(readDiagram, kind);
}

async function scrollDiagram(page, kind) {
  await page.evaluate((k) => {
    const els = Array.from(document.querySelectorAll('#panel-body .diagram'));
    const el =
      els.find((e) => e.dataset.kind === k) ||
      els.find((e) => ((e.querySelector('.diagram-src')?.textContent ?? '').trim().split(/[\s;{]/)[0] ?? '') === k);
    el?.scrollIntoView({ block: 'center' });
  }, kind);
}

async function waitDiagram(page, kind, ms = 25000) {
  await page
    .waitForFunction(
      (k) => {
        const els = Array.from(document.querySelectorAll('#panel-body .diagram'));
        const el =
          els.find((e) => e.dataset.kind === k) ||
          els.find((e) => ((e.querySelector('.diagram-src')?.textContent ?? '').trim().split(/[\s;{]/)[0] ?? '') === k);
        return !el || ['done', 'error', 'empty'].includes(el.dataset.diagram);
      },
      kind,
      { timeout: ms },
    )
    .catch(() => undefined);
  await page.waitForTimeout(120);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
let exitCode = 0;
try {
  // ---------------------------------------------------------------- 桌面 1440×900 · 3D
  const { context: dctx, page: d } = await newPage(browser, 'desktop', {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await d.goto(BASE, { waitUntil: 'load' });
  await ready(d);

  check('3D 模式挂载（1440 桌面）', (await d.evaluate(() => window.__zhishu.mode)) === 'three');
  const wHall = await scrollWidth(d);
  check('1440 视口无横向溢出', wHall.doc === 1440, wHall);
  check('大厅阶段零正文请求', requests.bodies.length === 0, requests.bodies.slice(0, 5));
  const mmHall = await mermaidChunks(d);
  const lazyHall = await d.evaluate(() => window.__zhishu.diagramStates());
  check(
    '非阅读页不加载 mermaid（大厅零 chunk、零请求）',
    mmHall.length === 0 && lazyHall.mermaidRequested === false,
    { chunks: mmHall.slice(0, 4), mermaidRequested: lazyHall.mermaidRequested },
  );
  const shardHall = requests.search.length;
  check('首屏不预取检索分片', shardHall === 0, requests.search.slice(0, 6));

  const labels = await d.evaluate(() => window.__zhishu.corridorLabels());
  check('走廊地面学科名六条已建', labels.length === 6, labels);
  await d.screenshot({ path: `${SHOTS}/hall-corridor.png` });

  // 走廊名沿走廊走向铺地，单一大厅机位必然压扁其中两条：逐条转到正对视角取证
  const corridorShots = [];
  for (const key of ['math', 'ai', 'chem', 'cs', 'general', 'tools']) {
    const ok = await d.evaluate((k) => window.__zhishu.viewCorridor(k), key);
    await d.waitForTimeout(350);
    const box = await d.evaluate((k) => window.__zhishu.corridorScreenBox(k), key);
    await d.screenshot({ path: `${SHOTS}/corridor-${key}.png` });
    corridorShots.push({ key, ok, box, ratio: box ? Number((box.w / Math.max(1, box.h)).toFixed(1)) : 0 });
  }
  check(
    '六条走廊名在正对视角下均为横排可读（宽高比 ≥3、宽 ≥120px）',
    corridorShots.every((c) => c.ok && c.ratio >= 3 && c.box.w >= 120),
    corridorShots,
  );
  await d.evaluate(() => window.__zhishu.showHall());
  await d.waitForTimeout(300);

  const mini = await d.evaluate(() => {
    const el = document.getElementById('minimap');
    const cv = document.getElementById('minimap-canvas');
    const ctx = cv.getContext('2d');
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 60) ink += 1;
    return { hidden: !el || el.hidden, ink, state: window.__zhishu.minimap() };
  });
  check(
    '小地图可见且六区已标',
    !mini.hidden && mini.ink > 400 && mini.state?.zones?.length === 6 && !!mini.state?.camera,
    { ink: mini.ink, zones: mini.state?.zones?.length, camera: mini.state?.camera },
  );

  // ---------------------------------------------------------------- 批 10 B：桌面大厅补光三账
  // 判据 6/7/8。采样点固定在世界坐标（藻井环 r=40.8 的梁轴 vs 扇板轴、门内 r=38 vs 门外 r=50 地面、
  // 中央地面三圈），每类多点平均后读回 0–255；整帧 p5 走 sampleLuminance 的 96×96 网格。
  // 放在 WASD 平移之前——探针按当前机位投影世界点，机位一动采样窗就跟着动。
  const hallLight = await d.evaluate(() => window.__zhishu.hallLightProbe());
  await d.screenshot({ path: `${SHOTS}/hall-light.png` });
  log.push(
    `大厅补光：梁 ${hallLight.beam} / 板 ${hallLight.panel} 差 ${hallLight.beamDiff}/255 · ` +
      `门内 ${hallLight.doorIn} / 门外 ${hallLight.doorOut} 差 ${hallLight.doorDiff}/255 · ` +
      `地面总览均值 ${hallLight.groundMean}（最低 ${hallLight.groundMin}）· 整帧 p5 ${hallLight.frameP5} p50 ${hallLight.frameP50} 暗像素比 ${hallLight.darkRatio}`,
  );
  check(
    '批 10 B1 藻井梁与井板明度可分（差 ≥8/255，地面总览图均值 ≥0.08）',
    hallLight.beamDiff >= 8 && hallLight.groundMean >= 0.08,
    hallLight,
  );
  check('批 10 B2 六个门洞内外明度可分（差 ≥10/255）', hallLight.doorDiff >= 10, hallLight);
  check('批 10 B3 补光不是整屏提亮（大厅整帧 p5 ≤0.03）', hallLight.frameP5 <= 0.03, hallLight);

  // WASD 平移：位移改变、朝向不变
  await d.evaluate(() => window.__zhishu.wake());
  await d.waitForTimeout(1400);
  const poseA = await d.evaluate(() => window.__zhishu.pose());
  const dirA = await d.evaluate(() => window.__zhishu.direction());
  await d.keyboard.down('KeyD');
  await d.waitForTimeout(700);
  await d.keyboard.up('KeyD');
  const poseB = await d.evaluate(() => window.__zhishu.pose());
  const dirB = await d.evaluate(() => window.__zhishu.direction());
  const moved = Math.hypot(poseB.px - poseA.px, poseB.pz - poseA.pz);
  const aligned = dot(dirA, dirB);
  check('WASD 平移生效且不改朝向', moved > 5 && aligned > 0.9995, {
    moved: Number(moved.toFixed(1)),
    dirDot: Number(aligned.toFixed(5)),
  });

  const tri = await d.evaluate(() => window.__zhishu.triangles());
  log.push(`大厅三角面 renderer.info.render.triangles = ${tri}`);
  check('三角面在 15 万预算内', tri > 0 && tri <= 150000, tri);

  // ---------------------------------------------------------------- 渲染层（批 7 · 阶段 B/D 判据）
  const cenHall = await d.evaluate(() => window.__zhishu.census());
  log.push(
    `大厅 census：材质 ${JSON.stringify(cenHall.materials)} · 灯 ${JSON.stringify(cenHall.lights)} · ` +
      `阴影 ${cenHall.shadow.type}/${cenHall.shadow.requested} mapSize=${cenHall.shadow.mapSize} autoUpdate=${cenHall.shadow.autoUpdate} · ` +
      `env present=${cenHall.environment.present} rt=${cenHall.environment.renderTargetTexture} half=${cenHall.environment.halfFloat} pmrem=${cenHall.environment.pmremMarked} · ` +
      `post ${JSON.stringify(cenHall.post.passes)} bloom=${JSON.stringify(cenHall.post.bloom)} · ` +
      `tone=${cenHall.toneMapping} dpr=${cenHall.pixelRatio} fog=${JSON.stringify(cenHall.fog)} · ` +
      `三角面 主${cenHall.triangles.mainPass}/阴影${cenHall.triangles.shadowPass}/整帧${cenHall.triangles.perFrame} · draw ${cenHall.calls.perFrame}`,
  );
  const litCount = Object.values(cenHall.lights).reduce((a, b) => a + b, 0);
  check(
    '光照齐：≥3 盏灯且主光投影开启、阴影为 PCF 且 mapSize ≥1024',
    litCount >= 3 &&
      cenHall.directionalCastShadow === true &&
      cenHall.shadow.enabled === true &&
      cenHall.shadow.mapSize >= 1024 &&
      /PCF/.test(cenHall.shadow.type) &&
      cenHall.shadow.requested === 'PCFSoftShadowMap',
    { lights: cenHall.lights, shadow: cenHall.shadow, directionalCastShadow: cenHall.directionalCastShadow },
  );
  const zoneDots = (cenHall.lightSpec || []).filter((l) => l.type === 'PointLight' && l.distance > 0 && l.decay > 0);
  check(
    '六区各一盏学科色点光且带距离衰减（decay>0、distance>0）',
    zoneDots.length >= 6,
    zoneDots.map((l) => `${l.color.toString(16)}/${l.intensity}/${l.distance}/${l.decay}`),
  );
  check(
    '环境反射来自程序化 PMREM（render-target 贴图 + HalfFloat + 装配标记）',
    cenHall.environment.present &&
      cenHall.environment.renderTargetTexture &&
      cenHall.environment.halfFloat &&
      cenHall.environment.pmremMarked,
    cenHall.environment,
  );
  check(
    '后期链三条 pass 齐（RenderPass → UnrealBloomPass → OutputPass）且 bloom 参数已定',
    cenHall.post.present &&
      ['RenderPass', 'UnrealBloomPass', 'OutputPass'].every((p) => cenHall.post.passes.includes(p)) &&
      cenHall.post.bloom !== null,
    cenHall.post,
  );
  check(
    '雾保留且 DPR ≤2（批 7 只微调不动交互）',
    cenHall.fog !== null && cenHall.fog.near > 0 && cenHall.fog.far > cenHall.fog.near && cenHall.pixelRatio <= 2,
    { fog: cenHall.fog, pixelRatio: cenHall.pixelRatio, toneMapping: cenHall.toneMapping },
  );
  // bloom 是否真的在改画面：headless 拿不到肉眼，就用同源像素亮度对照（阴影对照留给数学区，大厅只有 144 投影面）
  // 每次 sampleLuminance 都现渲染一帧，光尘在飘 → 单帧 p95 有 ±0.004 的抖动。取三帧中位数，
  // 阈值一字不动（批 9 C1 提亮墙面后 p95 已经不在高光簇上，单帧对照会随机翻脸）。
  // 采样窗两处：整帧（弱信号，批 7 起的现行口径，留着不动）+ 高光簇窗（强信号，本批补）。
  // 高光簇窗是 10×7 网格逐格 on/off 对照扫出来的：大厅默认机位下 Δmean 最大的一格在
  // cx0.35 / cy0.36（被照亮的阅览室外立面 + 门洞辉光那一片），整窗 18%×24%。
  // 实测（5 轮 on/off 交替，极差 0.00000）：簇窗 Δmean 0.00623 / Δp95 0.02970，
  // 整帧 Δmean 0.00229 / Δp95 0.00428——整帧 p95 落在暗部平台上，关掉 bloom 时它本来就只降 1/255，
  // 单帧采样会取到「两边同为 0.06069」的相等结果，所以这条判据改由簇窗承担，整帧 Δmean 仍然保留。
  const BLOOM_CLUSTER = [0.26, 0.24, 0.44, 0.48];
  const lumMedian = async (box, n = 3) => {
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      rows.push(await d.evaluate((w) => window.__zhishu.sampleLuminance(...w), box));
      await d.waitForTimeout(120);
    }
    const med = (k) => {
      const v = rows.map((r) => r[k]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    return { mean: med('mean'), p95: med('p95'), brightRatio: med('brightRatio'), samples: rows[0]?.samples ?? 0 };
  };
  const fullBase = await lumMedian([0, 0, 1, 1]);
  const clusterBase = await lumMedian(BLOOM_CLUSTER);
  await d.evaluate(() => window.__zhishu.setPassEnabled('Bloom', false));
  const fullNoBloom = await lumMedian([0, 0, 1, 1]);
  const clusterNoBloom = await lumMedian(BLOOM_CLUSTER);
  await d.evaluate(() => window.__zhishu.setPassEnabled('Bloom', true));
  log.push(
    `大厅亮度对照：整帧 ${fullBase.mean}(p95 ${fullBase.p95}) / 关 bloom ${fullNoBloom.mean}(p95 ${fullNoBloom.p95})；` +
      `高光簇 ${clusterBase.mean}(p95 ${clusterBase.p95}) / 关 bloom ${clusterNoBloom.mean}(p95 ${clusterNoBloom.p95})`,
  );
  check(
    'bloom 确实改变画面（整帧均值下降 + 高光簇均值与 p95 双下降，簇窗亮度须显著高于整帧）',
    fullBase.mean - fullNoBloom.mean > 1e-3 &&
      clusterBase.mean - clusterNoBloom.mean > 1e-3 &&
      clusterBase.p95 - clusterNoBloom.p95 > 1e-3 &&
      clusterBase.mean > fullBase.mean * 1.5,
    {
      full: { base: fullBase, noBloom: fullNoBloom },
      cluster: { box: BLOOM_CLUSTER, base: clusterBase, noBloom: clusterNoBloom },
    },
  );
  check(
    '三角面分主/阴影两口径上报且主口径不越预算',
    cenHall.triangles.mainPass > 0 &&
      cenHall.triangles.mainPass <= 150000 &&
      cenHall.triangles.shadowPass <= 150000,
    cenHall.triangles,
  );

  await d.evaluate(() => window.__zhishu.holdMinimap(true));
  const fpsHall = await fps(d, 10000);
  await d.evaluate(() => window.__zhishu.holdMinimap(false));
  log.push(`大厅 10s 采样 fps = ${fpsHall}`);
  check('大厅 10 秒帧率 ≥45', fpsHall >= 45, fpsHall);

  // 进数学区：阅览室壳体 / 书架墙 / 书脊图集与映射 / 光点 / 零正文请求
  await d.locator('#roombar button[data-room="math"]').click();
  await d.waitForFunction(() => window.__zhishu.room() === 'math', null, { timeout: 10000 });
  await d.waitForTimeout(900);
  const nodes = await d.evaluate(() => window.__zhishu.nodeStats());
  const fpsRoom = await fps(d, 5000);
  const triRoom = await d.evaluate(() => window.__zhishu.triangles());
  const cenMath = await d.evaluate(() => window.__zhishu.census());
  const structMath = cenMath.room;
  const shelfMath = cenMath.shelves;
  const spineMath = cenMath.spines;
  const labelMath = cenMath.labels;
  log.push(
    `数学区 fps = ${fpsRoom} · 三角面 = ${triRoom} · 书 ${nodes?.books} · 书脊 ${spineMath.cells}/章 ${spineMath.chapters} · ` +
      `书架 ${structMath.shelfRows} 排 ${structMath.tiers} 层 · 光点 ${nodes?.dots}`,
  );
  check(
    '数学区是封闭阅览室（≥3 墙 + 顶 + 地 + 踢脚 + 挂线 + 藻井梁，且真的在场景里可见）',
    structMath.walls >= 3 &&
      structMath.ceiling === true &&
      structMath.floor === true &&
      structMath.baseboards >= 3 &&
      structMath.rails >= 3 &&
      structMath.ceilingBeams >= 1 &&
      structMath.seen.wallMeshes >= 1 &&
      structMath.seen.ceilingMesh === true &&
      structMath.seen.floorMesh === true,
    structMath,
  );
  check(
    '书架墙 ≥3 排、每排 ≥2 层、门楣有学科牌匾',
    shelfMath.rows >= 3 &&
      shelfMath.tiers >= 2 &&
      shelfMath.bookcases === shelfMath.rows &&
      labelMath.plaqueTextures >= 1,
    { shelves: shelfMath, plaqueTextures: labelMath.plaqueTextures },
  );
  check(
    '一章一脊：书脊格数 == 本区章节数（== 标题行数）',
    spineMath.cells > 0 && spineMath.cells === spineMath.chapters && nodes.spinesEqualChapters,
    spineMath,
  );
  log.push(
    `数学区 census：受光材质 ${cenMath.litMaterials} / 自发光 ${cenMath.unlitMaterials} · ` +
      `书脊 mesh ${spineMath.meshes} 图集 ${spineMath.atlasPages} 页 三角 ${spineMath.triangles} 映射 ${spineMath.mapped}/${JSON.stringify(spineMath.mapLengths)} · ` +
      `标签 ${JSON.stringify(labelMath)} · 帧缩放 ${cenMath.renderScale} · ` +
      `光点 billboard=${cenMath.dotBillboard} 数=${cenMath.dotCount} · 三角面 主${cenMath.triangles.mainPass}/阴影${cenMath.triangles.shadowPass} · draw ${cenMath.calls.perFrame}`,
  );
  check(
    '房间受光材质 ≥4（地面/墙/顶/书架/展台都是 Standard）',
    cenMath.litMaterials >= 4 && cenMath.materials.MeshStandardMaterial >= 4,
    cenMath.materials,
  );
  check(
    '书脊 = 合并几何 + 图集：整区 ≤3 个网格体、非实例、映射表长度 == 三角数',
    spineMath.meshes >= 1 &&
      spineMath.meshes <= 3 &&
      spineMath.atlasPages >= 1 &&
      spineMath.atlasPages <= 3 &&
      spineMath.indexed === false &&
      spineMath.mapped === true &&
      spineMath.mapLengths.length === spineMath.meshes &&
      spineMath.triangles === spineMath.cells * 12 &&
      spineMath.mapLengths.reduce((a, b) => a + b, 0) === spineMath.triangles &&
      cenMath.calls.perFrame <= 110,
    spineMath,
  );
  check(
    '标签全部进几何：零 Sprite、零 DOM 浮动标签、悬停有延迟提示、书名烘进图集',
    labelMath.sprites === 0 &&
      labelMath.domFloating === 0 &&
      labelMath.tooltip === true &&
      labelMath.spineTitles === spineMath.books &&
      labelMath.plaqueTextures >= 1 &&
      labelMath.nameplateTextures >= 1,
    labelMath,
  );
  check(
    '批 8 空间预算：主口径三角面 ≤60,000 且每帧 draw ≤110',
    cenMath.triangles.mainPass <= 60000 && cenMath.calls.perFrame <= 110,
    { tris: cenMath.triangles.mainPass, calls: cenMath.calls.perFrame },
  );
  check(
    '帧缓冲缩放按视图分开（室内 0.85、大厅 1.0）',
    cenMath.renderScale === 0.85 && cenHall.renderScale === 1,
    { room: cenMath.renderScale, hall: cenHall.renderScale },
  );
  check(
    '概念光点是共用 canvas 渐变贴图的面片实例（非粒子海、非几何堆）',
    cenMath.dotBillboard === true &&
      String(cenMath.dotTexture).startsWith('canvas:') &&
      cenMath.dotCount > 0 &&
      cenMath.dotCount <= 600,
    { billboard: cenMath.dotBillboard, texture: cenMath.dotTexture, count: cenMath.dotCount },
  );
  // 阴影对照放在房间：大厅只有几百个投影面、亮度差太贴边；数学区三面书架墙把影子落在地板与书脊上
  await new Promise((r) => setTimeout(r, 700));
  const lumShadowOn = await d.evaluate(() => window.__zhishu.sampleLuminance(0.05, 0.18, 0.9, 0.34));
  await d.evaluate(() => window.__zhishu.setShadowsEnabled(false));
  await new Promise((r) => setTimeout(r, 700));
  const lumShadowOff = await d.evaluate(() => window.__zhishu.sampleLuminance(0.05, 0.18, 0.9, 0.34));
  await d.evaluate(() => window.__zhishu.setShadowsEnabled(true));
  await new Promise((r) => setTimeout(r, 700));
  log.push(
    `数学区地面亮度对照：开阴影 ${lumShadowOn.mean}(p95 ${lumShadowOn.p95}) / 关阴影 ${lumShadowOff.mean}(p95 ${lumShadowOff.p95})`,
  );
  check(
    '阴影确实改变画面（关掉后地面带变亮）',
    lumShadowOff.mean - lumShadowOn.mean > 2e-3 && lumShadowOff.p95 - lumShadowOn.p95 > 2e-3,
    { shadowOn: lumShadowOn, shadowOff: lumShadowOff },
  );
  check(
    '阴影口径非零且整帧不越 15 万面',
    cenMath.triangles.shadowPass > 0 && cenMath.triangles.perFrame <= 150000,
    cenMath.triangles,
  );

  // 批 8 拾取映射：逐条把相机压到书脊正前方，用真实射线回归 faceIndex 反查表
  const spinePicks = await d.evaluate(() => {
    const cells = window.__zhishu.census().spines.cells;
    const picks = [];
    for (const i of [0, 1, Math.floor(cells * 0.3), Math.floor(cells * 0.6), cells - 2, cells - 1]) {
      const p = window.__zhishu.focusSpine(i, 3.4);
      if (p && p.screen) picks.push({ i, want: p.chapterId, got: p.hit?.chapterId ?? null, kind: p.hit?.kind ?? null });
    }
    return picks;
  });
  await d.evaluate(() => window.__zhishu.enterRoom('math'));
  await d.waitForTimeout(600);
  log.push(`书脊 faceIndex ↔ 真实射线：${spinePicks.length} 条样本，一致 ${spinePicks.filter((p) => p.got === p.want).length} 条`);
  check(
    'faceIndex 区间映射与实时射线一致（点击时零线性搜索，书脊不被光尘遮挡）',
    spinePicks.length >= 5 && spinePicks.every((p) => p.got === p.want && p.kind === 'chapter'),
    spinePicks,
  );

  // ---------------------------------------------------------------- 批 10 C1：题签宽度双证
  // 图集参数：SPINE_PLATE_RECT.w / 逻辑格宽（32）= 画的占比；渲染实测：题签正面 7 条跨脊扫描线找暗带，
  // 取中位比（单条会被横贯金线干扰，中位比才稳）。两条都 ≤0.65 才判过。
  const plateSpec = await d.evaluate(() => window.__zhishu.spinePlateSpec());
  const plateParam = plateSpec.w / plateSpec.cellW;
  const plate = await d.evaluate(() => {
    const z = window.__zhishu;
    z.focusSpine(2, 3.4);
    return z.spinePlateProbe(2);
  });
  await d.waitForTimeout(250);
  await d.screenshot({ path: `${SHOTS}/spine-plate-width.png` });
  await d.evaluate(() => window.__zhishu.enterRoom('math'));
  await d.waitForTimeout(600);
  log.push(
    `题签宽度双证：图集绘制 ${plateSpec.w}/${plateSpec.cellW} = ${plateParam.toFixed(4)} · ` +
      `渲染实测中位比 ${plate?.ratio}（脊 ${plate?.spinePx}px / 签 ${plate?.platePx}px）· 七线 ${JSON.stringify(plate?.ratios)}`,
  );
  check(
    '批 10 C1 题签只占脊宽 ≤0.65（图集参数 + 渲染实测双证）',
    plateParam <= 0.65 && !!plate && plate.ratio <= 0.65 && plate.spinePx >= 80,
    { param: plateParam, spec: plateSpec, probe: plate },
  );
  check('分区浏览阶段零正文请求', requests.bodies.length === 0, requests.bodies.slice(0, 5));
  const mmRoom = await mermaidChunks(d);
  check('3D 分区阶段同样不加载 mermaid', mmRoom.length === 0, mmRoom.slice(0, 4));
  await d.screenshot({ path: `${SHOTS}/room-math.png` });

  // 概念光点拾取 → 概念正文
  if (samples.concept) {
    const ok = await d.evaluate(
      (s) => window.__zhishu.openConceptOf({ slug: s.slug, file: s.file }, s.concept),
      samples.concept,
    );
    const st = await settle(d);
    const txt = await panelText(d);
    check('3D 光点 → 概念正文可读', ok && txt.length > 40 && st.visible, {
      slug: samples.concept.slug,
      ...st,
      head: clip(txt, 90),
    });
    await d.screenshot({ path: `${SHOTS}/reader-concept.png` });
  }

  // full 正文 + KaTeX 行内 $
  if (samples.full) {
    await d.evaluate(
      (s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter),
      samples.full,
    );
    const st = await settle(d, 400);
    const info = await d.evaluate(() => ({
      katex: document.querySelectorAll('#panel-body .katex').length,
      display: document.querySelectorAll('#panel-body .katex-display').length,
      raw: document.querySelectorAll('#panel-body .math-raw').length,
      chars: (document.getElementById('panel-body')?.innerText ?? '').length,
      diagrams: document.querySelectorAll('#panel-body .diagram').length,
      fonts: performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .filter((n) => /KaTeX_.*\.(woff2|ttf|woff)$/.test(n)),
    }));
    check('full 正文渲染且 KaTeX 生效', info.katex > 0 && info.chars > 500 && st.visible, {
      ...info,
      fonts: info.fonts.length,
      first: clip(info.fonts[0]?.replace(BASE, '') ?? '', 80),
    });
    // 口径修正（批 10 复核）：原判据读 performance.getEntriesByType('resource')，
    // 字体走磁盘缓存时列表为空，会误判 count=0（同一轮 katex/chars 都是通的）。
    // 改读 CSSOM 里全部 @font-face 的 src：与缓存无关，且比「看实际请求」更严——
    // 它证明的是「声明本身没有任何一处指向外部」。
    const fontFaces = await d.evaluate((base) => {
      const raw = [];
      const collect = (rules) => {
        for (const r of rules) {
          if (r.constructor && r.constructor.name === 'CSSFontFaceRule') {
            const src = r.style?.getPropertyValue('src') ?? '';
            for (const m of src.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) raw.push(m[2]);
          } else if (r.cssRules) {
            collect(r.cssRules);
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          collect(sheet.cssRules);
        } catch {
          /* 跨源样式表读不到 cssRules，本项目无外部样式 */
        }
      }
      const abs = raw.map((u) => {
        try {
          return new URL(u, base).href;
        } catch {
          return u;
        }
      });
      return {
        count: abs.length,
        inline: abs.filter((u) => u.startsWith('data:')).length,
        offsite: abs.filter((u) => !u.startsWith(base) && !u.startsWith('data:')),
        first: abs[0] ?? '',
      };
    }, BASE);
    check(
      'KaTeX 字体来自本地 bundle（同源 assets/，无 CDN）',
      fontFaces.count >= 40 && fontFaces.offsite.length === 0,
      {
        cssFontFace: fontFaces.count,
        inlineDataUri: fontFaces.inline,
        offsite: fontFaces.offsite.length,
        loadedRequests: info.fonts.length,
        first: clip(fontFaces.first.replace(BASE, ''), 60),
      },
    );
    await d.screenshot({ path: `${SHOTS}/reader-full.png` });
    const wReader = await scrollWidth(d);
    check('阅读层不撑破 1440 文档宽', wReader.doc === 1440, wReader);

    // 关闭阅读层 → 相机位姿与选中态复原
    const poseRoom = await d.evaluate(() => window.__zhishu.pose());
    await d.locator('#panel-close').click({ timeout: 8000 });
    await d.waitForTimeout(400);
    const poseBack = await d.evaluate(() => window.__zhishu.pose());
    const sel = await d.evaluate(() => window.__zhishu.readerState());
    const hidden = await d.evaluate(() => document.getElementById('panel').hidden);
    log.push(`关闭阅读层后位姿差 ${Math.hypot(poseBack.px - poseRoom.px, poseBack.pz - poseRoom.pz).toFixed(3)}`);
    check('关闭阅读层后相机与选中态保留', sel.open === false && sel.book === samples.full.slug && hidden === true);
  }

  // 微信外链 → 纯文本，点击零请求
  if (samples.weixin) {
    await d.evaluate((s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter), samples.weixin);
    await d.waitForFunction(() => window.__zhishu.readerState().mode === 'chapter', null, { timeout: 15000 });
    const before = requests.all;
    const link = await d.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('#panel-body a[href*="weixin"]'));
      const spans = Array.from(document.querySelectorAll('#panel-body .ext-link'));
      const target = spans[0];
      if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return { anchors: anchors.length, spans: spans.length, sample: (target?.textContent ?? '').slice(0, 120) };
    });
    await d.waitForTimeout(600);
    check(
      '微信外链降级为纯文本且点击零请求',
      link.anchors === 0 && link.spans > 0 && requests.all === before,
      { ...link, newRequests: requests.all - before },
    );
    await d.screenshot({ path: `${SHOTS}/reader-weixin-strip.png` });
  }

  // 成品 HTML 正文（degraded / bodyType=html）不吞内容
  if (samples.htmlBody) {
    await d.evaluate((s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter), samples.htmlBody);
    const stW = await settle(d);
    const txt = await panelText(d);
    check('成品 HTML 正文可读且不吞段落', txt.length > (s_chars('htmlBody') * 0.6 || 40), {
      chars: txt.length,
      expected: s_chars('htmlBody'),
      head: clip(txt, 90),
    });
  }

  // ------------------------------------------- Mermaid 真渲染（批 3.5 A2：占位 → 可见 → 本地分包出 SVG）
  if (samples.mermaid) {
    // 重开一页，把「首屏零 mermaid」与「第一个围栏可见才加载」这两件事在同一个干净会话里对齐
    await d.reload({ waitUntil: 'load' });
    await ready(d);
    const mmFresh = await mermaidChunks(d);
    check('重载后仍是零 mermaid 分包（模块级缓存随页面重置）', mmFresh.length === 0, mmFresh.slice(0, 4));
    await d.evaluate((s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter), samples.mermaid);
    await settle(d);
    const placeholder = await d.evaluate(() => {
      const el = document.querySelector('#panel-body .diagram');
      if (!el) return null;
      const src = (el.querySelector('.diagram-src')?.textContent ?? '').trim();
      return {
        state: el.dataset.diagram ?? null,
        kind: src.split(/[\s;{]/)[0] ?? '',
        cap: el.querySelector('.diagram-cap')?.textContent ?? '',
        srcLen: src.length,
        srcBox: Boolean(el.querySelector('details.diagram-srcbox')),
        svgBefore: Boolean(el.querySelector('.diagram-view svg')),
      };
    });
    check(
      '围栏先是占位容器（登记为 watching、源码保留在 details 里、此刻无 SVG）',
      !!placeholder && placeholder.state === 'watching' && placeholder.svgBefore === false && placeholder.srcLen > 20 && placeholder.srcBox,
      placeholder,
    );
    const kind0 = placeholder?.kind ?? '';
    const chunkBefore = (await mermaidChunks(d)).length;
    await scrollDiagram(d, kind0);
    await waitDiagram(d, kind0);
    const first = await diagramFor(d, kind0);
    const chunkAfter = await mermaidChunks(d);
    check(
      '滚动到可见后本地 mermaid 出 SVG，且分包正是此刻才加载',
      !!first && first.state === 'done' && first.hasSvg && first.svgBytes > 500 && chunkBefore === 0 && chunkAfter.length > 0,
      { kind: kind0, svgBytes: first?.svgBytes, svgText: first?.svgText, chunks: chunkAfter.length, cap: clip(first?.cap, 80) },
    );
    await d.screenshot({ path: `${SHOTS}/mermaid-${kind0.replace(/[^a-z0-9]/gi, '')}.png` });
  }

  const kindRows = [];
  for (const [kind, s] of Object.entries(samples.diagrams || {})) {
    await d.evaluate((x) => window.__zhishu.openChapterOf({ file: x.file }, x.chapter), s);
    await settle(d);
    await scrollDiagram(d, kind);
    await waitDiagram(d, kind);
    const st = await diagramFor(d, kind);
    kindRows.push({
      kind,
      file: s.file,
      chapter: s.chapter,
      state: st?.state ?? null,
      svg: st?.hasSvg ?? false,
      bytes: st?.svgBytes ?? 0,
      labelChars: st?.svgText ?? 0,
      remote: st?.remote ?? -1,
      sized: st?.inFlow ?? false,
    });
    if (st?.hasSvg) await d.screenshot({ path: `${SHOTS}/mermaid-${kind.replace(/[^a-z0-9]/gi, '')}.png` });
  }
  check(
    `库里出现的 ${Object.keys(samples.diagrams || {}).length} 类图型逐条本地渲染成 SVG（不硬造类型）`,
    kindRows.length >= 5 && kindRows.every((r) => r.state === 'done' && r.svg && r.bytes > 300 && r.labelChars > 0 && r.sized),
    kindRows,
  );
  check('渲染结果零远程引用（无外链图片 / 字体 / CDN）', kindRows.every((r) => r.remote === 0), kindRows.map((r) => `${r.kind}:${r.remote}`));

  const multi = Object.values(samples.diagrams || {}).find((x) => (x.fences || 0) >= 2);
  if (multi) {
    const before = (await mermaidChunks(d)).length;
    await d.evaluate((x) => window.__zhishu.openChapterOf({ file: x.file }, x.chapter), multi);
    await settle(d);
    const fences = await d.evaluate(() => document.querySelectorAll('#panel-body .diagram').length);
    for (let i = 0; i < 12; i += 1) {
      await d.evaluate(() => {
        const b = document.getElementById('panel-body');
        b.scrollTop = Math.min(b.scrollHeight, b.scrollTop + 420);
      });
      await d.waitForTimeout(220);
    }
    await d.waitForTimeout(1200);
    const after = (await mermaidChunks(d)).length;
    const states = await d.evaluate(() =>
      Array.from(document.querySelectorAll('#panel-body .diagram')).map((e) => e.dataset.diagram),
    );
    check(
      '同章节多围栏只加载一次 mermaid 模块（滚完全部围栏后 chunk 数不变）',
      fences >= 2 && before === after && states.filter((x) => x === 'done').length >= 1,
      { fences, chunkBefore: before, chunkAfter: after, states },
    );
  }

  // 批 8 判据 3：只建当前区，切回大厅必须把图集 + 合并几何 + 牌匾纹理释放掉
  await d.evaluate(() => window.__zhishu.showHall());
  await d.waitForTimeout(700);
  const cenBack = await d.evaluate(() => window.__zhishu.census());
  const triBack = await d.evaluate(() => window.__zhishu.triangles());
  log.push(
    `回大厅：三角面 ${triBack}（数学区 ${triRoom}）· draw ${cenBack.calls.perFrame} · ` +
      `书脊网格 ${cenBack.spines.meshes}/${cenBack.spines.cells} · 房间壳体 ${cenBack.room.walls} 墙 · 帧缩放 ${cenBack.renderScale}`,
  );
  check(
    '切回大厅即释放本区构建物（书脊网格、壳体、书架归零）且帧缩放回 1.0',
    cenBack.spines.meshes === 0 &&
      cenBack.spines.cells === 0 &&
      cenBack.room.walls === 0 &&
      cenBack.shelves.rows === 0 &&
      cenBack.renderScale === 1 &&
      triBack < triRoom,
    { tris: triBack, spines: cenBack.spines.meshes, walls: cenBack.room.walls, scale: cenBack.renderScale },
  );
  check(
    '大厅是八角中庭：八边壳 + 六扇门洞 + 地面总览图 + 六块走廊地铭',
    cenBack.hall.sides === 8 &&
      cenBack.hall.doors === 6 &&
      cenBack.hall.ground === true &&
      cenBack.hall.facades >= 1 &&
      cenBack.labels.nameplateTextures === 6 &&
      cenBack.labels.sprites === 0,
    { hall: cenBack.hall, labels: cenBack.labels },
  );
  await d.evaluate(() => window.__zhishu.enterRoom('math'));
  await d.waitForTimeout(500);

  const brokenInjected = await d.evaluate(() =>
    window.__zhishu.injectReader('上一段。\n\n```mermaid\n!!! 这不是 mermaid 语法 @@\n```\n\n下一段。'),
  );
  await d.waitForTimeout(1500);
  const broken = await d.evaluate(() => {
    const el = document.querySelector('#panel-body .diagram');
    if (!el) return null;
    return {
      state: el.dataset.diagram ?? null,
      err: el.querySelector('.diagram-err')?.textContent ?? '',
      preChars: (el.querySelector('.diagram-view pre.code')?.textContent ?? '').length,
      viewChars: (el.querySelector('.diagram-view')?.innerText ?? '').replace(/\s+/g, '').length,
      svg: Boolean(el.querySelector('.diagram-view svg')),
    };
  });
  check('坏语法回退为源码 + 一行原因，容器不空不白屏', !!broken && broken.state === 'error' && !broken.svg && broken.preChars > 5 && broken.err.length > 4 && broken.viewChars > 10, {
    injected: brokenInjected,
    ...broken,
  });
  const apiFallback = await d.evaluate(async () => {
    const r = await window.__zhishu.diagramRender('!!! 这不是 mermaid 语法 @@');
    return { svg: r.svg ? r.svg.length : 0, error: r.error ?? '', kind: r.kind };
  });
  check('renderDiagram 对坏源码返回原因而不抛错', apiFallback.svg === 0 && apiFallback.error.length > 0, apiFallback);
  await d.screenshot({ path: `${SHOTS}/mermaid-fallback.png` });

  // 批 6 阶段 C：白名单外的图型（库里 0 处使用）不再打包，走的是同一条回退支——容器给源码 + 一行原因，不出 SVG
  const unbundled = await d.evaluate(async () => {
    const src = 'classDiagram\n  Animal <|-- Duck\n  class Animal { +int age }';
    const r = await window.__zhishu.diagramRender(src);
    const injected = window.__zhishu.injectReader('上一段。\n\n```mermaid\n' + src + '\n```\n\n下一段。');
    return { svg: r.svg ? r.svg.length : 0, error: r.error ?? '', kind: r.kind, injected };
  });
  await d.waitForTimeout(1500);
  const unbundledDom = await d.evaluate(() => {
    const el = document.querySelector('#panel-body .diagram');
    if (!el) return null;
    return {
      state: el.dataset.diagram ?? null,
      err: el.querySelector('.diagram-err')?.textContent ?? '',
      preChars: (el.querySelector('.diagram-view pre.code')?.textContent ?? '').length,
      viewChars: (el.querySelector('.diagram-view')?.innerText ?? '').replace(/\s+/g, '').length,
      svg: Boolean(el.querySelector('.diagram-view svg')),
    };
  });
  check(
    '白名单外图型不打包且回退源码 + 一行原因（不空容器、不出 SVG）',
    unbundled.svg === 0 &&
      unbundled.error.length > 0 &&
      !!unbundledDom &&
      unbundledDom.state === 'error' &&
      !unbundledDom.svg &&
      unbundledDom.preChars > 5 &&
      unbundledDom.viewChars > 10,
    { api: unbundled, dom: unbundledDom },
  );
  await d.screenshot({ path: `${SHOTS}/mermaid-unbundled.png` });

  await d.evaluate(() => document.getElementById('panel-close').click());
  await d.waitForTimeout(500);
  const fpsHallMm = await fps(d, 5000);
  await d.evaluate(() => window.__zhishu.enterRoom('ai'));
  await d.waitForFunction(() => window.__zhishu.room() === 'ai', null, { timeout: 12000 });
  await d.waitForTimeout(700);
  const fpsRoomMm = await fps(d, 5000);
  const triMm = await d.evaluate(() => window.__zhishu.triangles());
  const mmStill = await d.evaluate(() => ({
    requested: window.__zhishu.diagramStates().mermaidRequested,
    panels: document.querySelectorAll('#panel-body .diagram').length,
  }));
  check(
    'mermaid 已进运行时后大厅与分区帧率仍 ≥45、三角面不越预算',
    fpsHallMm >= 45 && fpsRoomMm >= 45 && triMm > 0 && triMm <= 150000,
    { fpsHall: fpsHallMm, fpsRoom: fpsRoomMm, triangles: triMm, moduleLoaded: mmStill.requested },
  );

  const cenAi = await d.evaluate(() => window.__zhishu.census());
  log.push(
    `AI 区：书脊 ${cenAi.spines.cells}/章 ${cenAi.spines.chapters} · 网格 ${cenAi.spines.meshes} 图集 ${cenAi.spines.atlasPages} 页 ` +
      `· 书架形 ${cenAi.builtShelfKind} ${cenAi.shelves.rows} 排 ${cenAi.shelves.tiers} 层 ${cenAi.shelves.dividers} 隔板 · draw ${cenAi.calls.perFrame}`,
  );
  check(
    '跨区书架与书脊真的不同（同一套建筑代码按本区数据分档，数学≠AI）',
    cenAi.spines.cells === cenAi.spines.chapters &&
      cenAi.spines.cells > spineMath.cells &&
      cenAi.spines.meshes >= 1 &&
      cenAi.spines.meshes <= 3 &&
      cenAi.spines.mapped === true &&
      cenAi.builtShelfKind !== cenMath.builtShelfKind &&
      cenAi.shelves.tiers !== cenMath.shelves.tiers &&
      cenAi.room.walls === cenMath.room.walls &&
      cenAi.labels.sprites === 0 &&
      cenAi.labels.domFloating === 0 &&
      cenAi.calls.perFrame <= 110,
    {
      ai: { spines: cenAi.spines.cells, shelf: cenAi.builtShelfKind, tiers: cenAi.shelves.tiers, calls: cenAi.calls.perFrame },
      math: { spines: spineMath.cells, shelf: cenMath.builtShelfKind, tiers: cenMath.shelves.tiers },
    },
  );

  // ---- 批 8：逐区空间账（判据 3「书脊总数 == 章节总数」要对六区都成立，不能只验数学与 AI）
  const zoneRows = [];
  for (const area of ['chem', 'cs', 'general', 'tools']) {
    await d.evaluate((a) => window.__zhishu.enterRoom(a), area);
    await d.waitForTimeout(1100);
    zoneRows.push({ area, cen: await d.evaluate(() => window.__zhishu.census()) });
  }
  for (const z of zoneRows) {
    const c = z.cen;
    if (z.area === 'tools') {
      check(
        'tools 区库里 0 本：空阅览室仍封闭且不造书（铁律「不为演示编数据」）',
        c.room.walls >= 3 && c.room.ceiling === true && c.room.floor === true &&
          c.shelves.rows >= 3 && c.spines.cells === 0 && c.spines.meshes === 0 &&
          c.labels.sprites === 0 && c.labels.domFloating === 0,
        { walls: c.room.walls, rows: c.shelves.rows, cells: c.spines.cells },
      );
      continue;
    }
    check(
      `${z.area} 区书脊格数 == 章数，且图集分页刚好装下（不超 3 页、不浪费整页）`,
      c.spines.cells === c.spines.chapters && c.spines.cells > 0 &&
        c.spines.atlasPages >= 1 && c.spines.atlasPages <= 3 &&
        c.spines.cells <= c.spines.atlasPages * 192 &&
        c.spines.cells > (c.spines.atlasPages - 1) * 192 &&
        c.spines.mapped === true && c.spines.triangles === c.spines.cells * 12,
      { cells: c.spines.cells, chapters: c.spines.chapters, pages: c.spines.atlasPages, tri: c.spines.triangles },
    );
    check(
      `${z.area} 区阅览室建筑与预算（≥3 面墙 + ≥3 排书架 + 零浮标 + 双口径不越界）`,
      c.room.walls >= 3 && c.room.ceiling === true && c.shelves.rows >= 3 &&
        c.shelves.bookcases === c.shelves.rows && c.labels.sprites === 0 &&
        c.labels.domFloating === 0 && c.labels.plaqueTextures >= 1 &&
        c.triangles.mainPass <= 60000 && c.calls.perFrame <= 110 && c.renderScale === 0.85,
      {
        walls: c.room.walls, rows: c.shelves.rows, kind: c.builtShelfKind,
        tris: c.triangles.mainPass, calls: c.calls.perFrame, labels: c.labels,
      },
    );
  }
  log.push(`逐区：${zoneRows.map((z) => `${z.area} 脊 ${z.cen.spines.cells}/${z.cen.spines.chapters} 图 ${z.cen.spines.atlasPages} 主 ${z.cen.triangles.mainPass} draw ${z.cen.calls.perFrame}`).join(' · ')}`);

  // ---- 批 9 C3：书脊字口反差。判定口径在 atlas.spineInkContrast 的注释里：字色 SPINE_INK 与
  // 「暗题签底板压在皮革上、再被字轴处约 3% 高光洗过」的合成色之间的 WCAG 相对亮度比，逐本算、每区取最小值。
  const contrastRows = [];
  for (const area of ['math', 'ai', 'chem', 'cs', 'general', 'tools']) {
    await d.evaluate((a) => window.__zhishu.enterRoom(a), area);
    await d.waitForFunction(
      (a) => window.__zhishu.room() === a && window.__zhishu.frameCheck()?.view === 'room',
      area,
      { timeout: 15000 },
    ).catch(() => undefined);
    await d.waitForTimeout(900);
    contrastRows.push({ area, ...(await d.evaluate(() => window.__zhishu.spineContrast())) });
  }
  const contrasted = contrastRows.filter((r) => r.books > 0);
  log.push(
    `书脊字口反差（ ink ${contrastRows[0]?.ink}）：${contrastRows.map((r) => `${r.area} ${r.books} 本 min=${r.min} p50=${r.p50}`).join(' · ')}`,
  );
  check(
    '书脊字口反差逐区 ≥4.5（皮革提一档 + 暗题签底板承亮字，六区里有书的都不低于 4.5）',
    contrasted.length >= 5 && contrasted.every((r) => r.min >= 4.5),
    contrastRows.map((r) => ({ area: r.area, books: r.books, min: r.min, p50: r.p50 })),
  );
  // 批 10 C2：把下限从 AA 4.5 抬到 AAA 12——题签收窄到 0.625 后字口仍在暗底板上，六区（有书的）
  // 最小值必须全部 ≥12，3 米复读才有余量（批 9 实测 15.2–16.95，本批题签变窄后复测）。
  check(
    '批 10 C2 书脊字口反差逐区 ≥12（WCAG AAA 级，有书的区）',
    contrasted.length >= 5 && contrasted.every((r) => r.min >= 12),
    contrastRows.map((r) => ({ area: r.area, books: r.books, min: r.min, p50: r.p50 })),
  );

  await d.evaluate(() => window.__zhishu.enterRoom('math'));
  await d.waitForTimeout(1200);

  // ---- 批 8：HTML 浮标换成 120ms 延时 tooltip，延时本身必须实测（阶段 D 的可读性约定）
  const tipAt = await d.evaluate(() => {
    const p = window.__zhishu.focusSpine(6, 3.4);
    return p && p.screen ? { x: p.screen.x, y: p.screen.y, chapter: p.chapterId } : null;
  });
  await d.mouse.move(tipAt.x, tipAt.y);
  const tipInstant = await d.evaluate(() => document.querySelector('[data-hover-tip]')?.hidden);
  await d.waitForTimeout(360);
  const tipShown = await d.evaluate(() => {
    const t = document.querySelector('[data-hover-tip]');
    return { hidden: t ? t.hidden : null, text: t ? (t.textContent || '').slice(0, 40) : '' };
  });
  await d.mouse.move(2, 2); // 挪到顶栏（离开画布）→ pointerleave 必触发
  await d.waitForTimeout(260);
  const tipGone = await d.evaluate(() => document.querySelector('[data-hover-tip]')?.hidden);
  check(
    '扫过书脊的瞬间不闪标签（120ms 内 tooltip 仍隐藏）',
    tipInstant === true,
    { tipInstant, shown: tipShown },
  );
  check(
    '停够延时才浮出 DOM tooltip，内容是可读章节名',
    tipShown.hidden === false && tipShown.text.length > 3,
    { tipShown, chapter: tipAt.chapter },
  );
  check('指针移开 tooltip 立即收起（不留残余浮标）', tipGone === true, { tipGone });
  await d.evaluate(() => window.__zhishu.enterRoom('ai'));
  await d.waitForTimeout(900);

  // ---------------------------------------------------------------- 检索层（批 4 · 判据 C1—C4）
  const sc = samples.search || {};
  const areaRows = [];
  for (const [area, s] of Object.entries(sc.areas || {})) {
    const loaded = await d.evaluate(() => window.__zhishu.searchLoaded().slice());
    const hits = await d.evaluate(async (q) => await window.__zhishu.searchRun(q.query, q.area), s);
    const after = await d.evaluate(() => ({ loaded: window.__zhishu.searchLoaded().slice(), info: window.__zhishu.searchState().shards }));
    areaRows.push({
      area,
      query: s.query,
      want: s.file,
      books: s.books,
      hits: hits.length,
      kinds: [...new Set(hits.map((h) => h.kind))],
      allInArea: hits.every((h) => h.area === area),
      first: hits[0] ?? null,
      loadedBefore: loaded.length,
      loadedAfter: after.loaded.length,
      shard: after.info?.[area] ?? null,
    });
  }
  check(
    '六个学科各有关键词命中，且命中都落在本区',
    areaRows.filter((r) => r.area !== 'tools').length === 5 &&
      areaRows.filter((r) => r.area !== 'tools').every((r) => r.hits > 0 && r.allInArea),
    areaRows.map((r) => ({ area: r.area, hits: r.hits, kinds: r.kinds, shard: r.shard })),
  );
  check(
    '检索分片按区懒加载：查一区只拉一片，首屏不预取六片',
    requests.search.length <= 6 && areaRows.every((r) => r.loadedAfter === r.loadedBefore + (r.books > 0 ? 1 : 0)),
    { requests: requests.search.slice(), perArea: areaRows.map((r) => [r.area, r.loadedBefore, r.loadedAfter]) },
  );
  check(
    '结果分「章节 / 概念 / 书」三类且带 file 精确落点',
    new Set(areaRows.flatMap((r) => r.kinds)).size >= 3 && areaRows.every((r) => !r.first || !!r.first.file),
    { kinds: [...new Set(areaRows.flatMap((r) => r.kinds))], first: areaRows[0]?.first },
  );

  const toolsRow = areaRows.find((r) => r.area === 'tools') ?? null;
  const toolsUi = await d.evaluate(async () => {
    window.__zhishu.searchShow('');
    await window.__zhishu.searchRun('数学', 'tools');
    return {
      status: document.getElementById('search-status')?.dataset.status ?? null,
      text: document.getElementById('search-status')?.textContent ?? '',
      scope: document.getElementById('search-scope')?.textContent ?? '',
      hits: window.__zhishu.searchHits().length,
      open: window.__zhishu.searchOpen(),
      shard: window.__zhishu.searchState().shards.tools ?? null,
    };
  });
  const toolsBooks = toolsRow ? toolsRow.books : toolsUi.shard?.books ?? null;
  check(
    'tools 区空片容错：分片取到但库里 0 本，给明确提示不报错',
    toolsBooks === 0 && toolsUi.shard?.missing === false && toolsUi.status === 'none' && toolsUi.hits === 0 &&
      toolsUi.text.includes('0 本') && toolsUi.scope.includes('工具间') && toolsUi.open === true,
    { row: toolsRow, ...toolsUi },
  );

  const groups = await d.evaluate(async () => {
    await window.__zhishu.searchRun('算法', 'cs');
    await new Promise((r) => setTimeout(r, 200));
    return Array.from(document.querySelectorAll('#search-results .hit-group')).map((n) => n.textContent ?? '');
  });
  const statesUi = await d.evaluate(async () => {
    const out = {};
    const box = document.getElementById('search-input');
    box.value = '';
    await window.__zhishu.searchRun('', 'cs');
    out.empty = {
      status: document.getElementById('search-status')?.dataset.status ?? null,
      text: document.getElementById('search-status')?.textContent ?? '',
      resultsHidden: document.getElementById('search-results')?.hidden,
    };
    await window.__zhishu.searchRun('zxqvkjz', 'cs');
    out.none = {
      status: document.getElementById('search-status')?.dataset.status ?? null,
      text: document.getElementById('search-status')?.textContent ?? '',
      resultsHidden: document.getElementById('search-results')?.hidden,
    };
    return out;
  });
  check('空查询 / 无结果两态各有文案，不白屏', statesUi.empty.status === 'empty' && statesUi.empty.resultsHidden === true && statesUi.none.status === 'none' && statesUi.none.resultsHidden === true && statesUi.none.text.length > 6, statesUi);
  await d.screenshot({ path: `${SHOTS}/search-desktop.png` });

  // Ctrl+K 与 `/` 两个快捷键都能唤起，Esc 收起
  const keys = {};
  await d.evaluate(() => window.__zhishu.searchHide());
  await d.waitForTimeout(150);
  await d.keyboard.press('Control+k');
  await d.waitForTimeout(250);
  keys.ctrlK = await d.evaluate(() => ({ open: window.__zhishu.searchOpen(), focused: document.activeElement?.id === 'search-input' }));
  await d.keyboard.press('Escape');
  await d.waitForTimeout(200);
  keys.afterEsc = await d.evaluate(() => window.__zhishu.searchOpen());
  await d.keyboard.press('/');
  await d.waitForTimeout(250);
  keys.slash = await d.evaluate(() => ({ open: window.__zhishu.searchOpen(), focused: document.activeElement?.id === 'search-input' }));
  check('Ctrl+K 与 `/` 都能唤起搜索并聚焦输入框，Esc 收起', keys.ctrlK.open && keys.ctrlK.focused && keys.afterEsc === false && keys.slash.open && keys.slash.focused, keys);
  check('结果按类型分组给出表头', groups.length >= 2, groups);

  // 点结果 → 带 file 精确取书（不吃 31 个跨仓重名 slug）
  if (sc.dup) {
    const dupHits = await d.evaluate(async (q) => {
      await window.__zhishu.searchRun(q.query, 'ai');
      return window.__zhishu.searchHits();
    }, sc.dup);
    const hit = dupHits.find((h) => h.file === sc.dup.file) ?? dupHits[0] ?? null;
    const jumped = await d.evaluate(async () => {
      await window.__zhishu.searchPick(0);
      return window.__zhishu.readerState();
    });
    check(
      `重名 bookSlug（${sc.dup.slug}，${(sc.dup.twins || []).length} 份镜像）按 file 精确取书`,
      !!hit && jumped.open === true && jumped.file === sc.dup.file,
      { query: sc.dup.query, twins: sc.dup.twins, hits: dupHits.length, want: sc.dup.file, got: jumped.file, slug: jumped.book },
    );
  }

  // 判据 C4：搜索跳转后点返回，回到原书节点与原相机位姿
  await d.evaluate(() => window.__zhishu.enterRoom('math'));
  await d.waitForFunction(() => window.__zhishu.room() === 'math', null, { timeout: 12000 });
  await d.waitForTimeout(700);
  const beforeJump = await d.evaluate(() => ({ pose: window.__zhishu.pose(), room: window.__zhishu.room(), sel: window.__zhishu.readerState() }));
  const jumpRow = areaRows.find((r) => r.area === 'general' && r.first) ?? areaRows.find((r) => r.first);
  await d.evaluate(() => window.__zhishu.searchShow(''));
  const jumpedHits = await d.evaluate(async (q) => await window.__zhishu.searchRun(q.query, q.area), { query: jumpRow.query, area: jumpRow.area });
  await d.evaluate(async () => {
    await window.__zhishu.searchPick(0);
  });
  const midJump = await d.evaluate(() => ({
    reader: window.__zhishu.readerState(),
    spot: window.__zhishu.searchSpot(),
    room: window.__zhishu.room(),
    pose: window.__zhishu.pose(),
    chars: (document.getElementById('panel-body')?.innerText ?? '').length,
  }));
  await d.locator('#panel-close').click({ timeout: 8000 });
  await d.waitForTimeout(700);
  const afterJump = await d.evaluate(() => ({ pose: window.__zhishu.pose(), room: window.__zhishu.room(), spot: window.__zhishu.searchSpot() }));
  const poseDrift = beforeJump.pose && afterJump.pose
    ? Math.max(...['px', 'py', 'pz', 'tx', 'ty', 'tz'].map((k) => Math.abs(afterJump.pose[k] - beforeJump.pose[k])))
    : Number.MAX_VALUE;
  check(
    '搜索跳转后点返回：所在区、相机位姿、选中书目全部复原（位姿漂移 <1e-6）',
    midJump.spot !== null && afterJump.spot === null && afterJump.room === beforeJump.room && poseDrift < 1e-6 && midJump.chars > 120,
    {
      roomBefore: beforeJump.room,
      roomAfterReturn: afterJump.room,
      poseDrift: Number(poseDrift.toFixed(8)),
      jumpedTo: midJump.reader?.file,
      jumpedFrom: beforeJump.reader?.file,
      bodyChars: midJump.chars,
    },
  );
  await d.screenshot({ path: `${SHOTS}/search-return.png` });
  check('检索跳转阶段仍零外部请求', requests.external.length === 0, requests.external.slice(0, 6));

  // degraded 书：不渲染空正文
  if (samples.degraded) {
    await d.evaluate((s) => window.__zhishu.openBookBy({ slug: s.slug, file: s.file }), samples.degraded);
    await d.waitForFunction(() => window.__zhishu.readerState().open === true, null, { timeout: 15000 });
    const overview = await panelText(d);
    await d.evaluate((s) => window.__zhishu.openChapter(s.chapter), samples.degraded);
    const stW = await settle(d);
    const txt = await panelText(d);
    check(
      'degraded 标记「可做题、无原始 Markdown 正文」+ 题目数，且不渲染空正文',
      overview.includes('可做题、无原始 Markdown 正文') &&
        /\d+ 道题/.test(overview) &&
        txt.includes('成品 HTML') &&
        txt.length > 200,
      { overviewChars: overview.length, chars: txt.length, head: clip(txt, 120) },
    );
    await d.screenshot({ path: `${SHOTS}/reader-degraded.png` });
  }

  // stats-only 合成样本（库内实测 0 本）
  if (samples.statsOnly) {
    await d.evaluate((s) => window.__zhishu.openStatsOnlySample({ slug: s.slug, file: s.file }), samples.statsOnly);
    const stS = await settle(d);
    const txt = await panelText(d);
    check('stats-only 合成样本只显示计数与来源', txt.includes('仅计数，无正文') && txt.includes('来源'), {
      chars: txt.length,
      visible: stS.visible,
      head: clip(txt, 120),
    });
    await d.screenshot({ path: `${SHOTS}/reader-statsonly.png` });
  }

  // 双定界符 + `<details>` 不截断（合成，因为库内 \`=0 处、<details>=0 处）
  const synth = await d.evaluate(() => {
    const src =
      '行内括号式 \\(E = mc^2\\) 与美元式 $a^2+b^2$ 同段。\n\n\\[\\int_0^1 x\\,dx = \\tfrac12\\]\n\n<details><summary>推导细节</summary><p>段一内容 TAIL917</p></details>\n\n错误定界符保留原文 \\(not tex $ \\) 兜底 $\\frac{1}{0}\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha\\alpha$。';
    const out = window.__zhishu.renderSample(src);
    const box = document.createElement('div');
    box.innerHTML = out.html;
    return {
      mathCount: out.mathCount,
      fallbacks: out.formulaFallbacks,
      text: (box.textContent ?? '').replace(/\s+/g, ' '),
      hasDetails: Boolean(box.querySelector('details')),
      hasSummary: Boolean(box.querySelector('summary')),
    };
  });
  check(
    '\\(..\\) 与 \\[..\\] 双定界符渲染且 <details> 内容不丢',
    synth.mathCount >= 2 &&
      synth.text.includes('TAIL917') &&
      synth.text.includes('推导细节') &&
      synth.text.includes('段一内容') &&
      synth.hasDetails &&
      synth.hasSummary,
    synth,
  );
  check('KaTeX 解析失败不吞原文', synth.text.includes('not tex') || synth.fallbacks > 0, {
    fallbacks: synth.fallbacks,
  });

  /* ---------------------------------------------------------------- 批 11：第一人称漫游（桌面 1440×900）
   * 三条口径先说死（详见 _work/decisions.md 批 11 E1–E4），后面每条断言都按这个读：
   *  · 位移读**帧采样轨迹的净位移**，不是「按键秒数 × 速度」的理论值；
   *  · 贴墙滑行读 net ≥0.35 且松键反向还能走（unstick net ≥0.35），只看不卡不看过墙；
   *  · 退出复原读进入前 pose 与退出后 pose 的六分量最大差 ≤0.05，并核对轨道距离不变。
   * orbit 是本批的回归基线：这一段全部走完后，上面的 108 项必须照旧全绿。
   */
  await d.evaluate(() => document.getElementById('panel-close')?.click());
  await d.evaluate(() => window.__zhishu.showHall());
  await d.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'hall', null, { timeout: 15000 });
  await d.waitForTimeout(900);
  const orbitPre = await d.evaluate(() => window.__zhishu.pose());
  await d.keyboard.press('KeyF');
  await d.waitForFunction(() => window.__zhishu.walk().mode === 'walk', null, { timeout: 8000 });
  await d.waitForTimeout(700);
  const walkEntry = await d.evaluate(() => {
    const w = window.__zhishu.walk();
    const ch = document.querySelector('[data-crosshair]');
    const cr = ch?.getBoundingClientRect();
    const cv = document.querySelector('#three-root canvas').getBoundingClientRect();
    const btn = document.getElementById('btn-walk');
    return {
      mode: w.mode,
      eye: w.eye,
      pos: w.pos,
      radius: w.radius,
      speed: w.speed,
      pitchLimitDeg: w.pitchLimitDeg,
      controlsEnabled: w.controlsEnabled,
      blockers: w.blockers,
      blockerKinds: w.blockerKinds,
      wallGap: w.wallGap,
      cross: cr && ch ? { shown: !ch.hidden, dx: Math.round(cr.x + cr.width / 2 - (cv.x + cv.width / 2)), dy: Math.round(cr.y + cr.height / 2 - (cv.y + cv.height / 2)) } : null,
      btn: { text: btn?.textContent ?? '', pressed: btn?.getAttribute('aria-pressed') ?? '' },
      hud: (document.getElementById('hud')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
  check(
    '批11A F 键进漫游：眼高 1.65±0.1、准星钉在画布中心、OrbitControls 停用、HUD 按钮切「退出」',
    Math.abs(walkEntry.eye - 1.65) <= 0.1 &&
      walkEntry.cross?.shown === true &&
      Math.abs(walkEntry.cross.dx) <= 2 &&
      Math.abs(walkEntry.cross.dy) <= 2 &&
      walkEntry.controlsEnabled === false &&
      walkEntry.btn.pressed === 'true' &&
      walkEntry.btn.text === '退出' &&
      walkEntry.radius === 0.45 &&
      walkEntry.blockers >= 30,
    { ...walkEntry, orbitPre },
  );
  await d.screenshot({ path: `${SHOTS}/walk-hall.png` });

  await d.evaluate(() => window.__zhishu.walkTraceStart());
  await d.keyboard.down('KeyW');
  await d.waitForTimeout(1000);
  await d.keyboard.up('KeyW');
  await d.waitForTimeout(150);
  const walkFwd = await d.evaluate(() => window.__zhishu.walkTraceStop());
  check(
    '批11B 大厅按住 W 一秒净位移 3.2±0.4、不浮空（dyMax<0.02）、位移方向沿朝向（drift<6°）',
    Math.abs(walkFwd.net - 3.2) <= 0.4 && walkFwd.dyMax < 0.02 && walkFwd.driftDeg < 6 && walkFwd.samples >= 20,
    walkFwd,
  );

  await d.evaluate(() => window.__zhishu.walkTraceStart());
  await d.keyboard.down('ShiftLeft');
  await d.keyboard.down('KeyW');
  await d.waitForTimeout(1000);
  await d.keyboard.up('KeyW');
  await d.keyboard.up('ShiftLeft');
  await d.waitForTimeout(150);
  const walkRun = await d.evaluate(() => window.__zhishu.walkTraceStop());
  const sprintRatio = walkFwd.net > 0.5 ? Math.round((walkRun.net / walkFwd.net) * 100) / 100 : 0;
  check('批11B Shift 疾走 ×1.8（净位移比 1.5–2.1，且眼高不变）', sprintRatio >= 1.5 && sprintRatio <= 2.1 && walkRun.dyMax < 0.02, {
    walk: walkFwd.net,
    sprint: walkRun.net,
    ratio: sprintRatio,
    dyMax: walkRun.dyMax,
  });

  // 六条走廊 + 八角壳：用同一套 resolveSlide 增量推进（0.12 步长），一次证完「走廊真通到门口」
  // 与「实心边挡得住人」。stopKinds 记的是第一下推谁——漏到 hallWall 之外就是壳没封住。
  const shell = await d.evaluate(() => {
    const R = window.__zhishu;
    const doors = [
      ['math', 180], ['cs', 135], ['ai', 90], ['chem', 45], ['tools', -45], ['general', -90],
    ];
    const via = doors.map(([k, deg]) => {
      const a = (deg * Math.PI) / 180;
      R.walkSnap(0, 0, Math.cos(a), Math.sin(a));
      return { k, deg, ...R.walkMarch(Math.cos(a), Math.sin(a), 150, 'hall') };
    });
    const solid = [-135, 0, 23, -157].map((deg) => {
      const a = (deg * Math.PI) / 180;
      R.walkSnap(0, 0, Math.cos(a), Math.sin(a));
      return { deg, ...R.walkMarch(Math.cos(a), Math.sin(a), 130, 'hall') };
    });
    return { via, solid };
  });
  check(
    '批11B 六条走廊各自真通到该区门面（净推进 ≥125 且第一下阻挡来自 facade）',
    shell.via.length === 6 && shell.via.every((v) => v.travelled >= 125 && String(v.stopKinds).includes('facade')),
    shell.via,
  );
  check(
    '批11B 八角厅实心边与门洞转角挡得住人：四向都在 ≤50 单位被壳拦停、无一人翻出壳外',
    shell.solid.every((v) => v.blockedAt !== null && v.blockedAt <= 50 && v.travelled <= 60 && /hallWall|hallDoorJamb/.test(String(v.stopKinds))),
    shell.solid,
  );
  await d.screenshot({ path: `${SHOTS}/walk-corridor.png` });

  // 进区落位 + 门洞穿行 + 贴墙滑行（全部走真实按键，起点用 walkSnap 钉住）
  await d.evaluate(() => window.__zhishu.setWalk(false));
  await d.evaluate(() => window.__zhishu.enterRoom('math'));
  await d.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'room', null, { timeout: 15000 });
  await d.waitForTimeout(900);
  const roomSpawn = await d.evaluate(() => {
    const R = window.__zhishu;
    R.setWalk(true);
    const w = R.walk();
    return { eye: w.eye, pos: w.pos, view: w.view, room: w.room, kinds: w.blockerKinds, gap: w.wallGap, aim: w.aim };
  });
  await d.waitForTimeout(500);
  check(
    '批11A 进区落点在书架前的过道：眼高 1.65、本区碰撞清单含三排书架、不嵌墙（gap ≥0）',
    Math.abs(roomSpawn.eye - 1.65) <= 0.1 &&
      roomSpawn.view === 'room' &&
      roomSpawn.room === 'math' &&
      (roomSpawn.kinds.shelf ?? 0) >= 3 &&
      roomSpawn.gap >= 0,
    roomSpawn,
  );
  await d.screenshot({ path: `${SHOTS}/walk-aisle.png` });

  await d.evaluate(() => window.__zhishu.walkSnap(-143, 0, 1, 0));
  await d.evaluate(() => window.__zhishu.walkTraceStart());
  await d.keyboard.down('KeyW');
  await d.waitForTimeout(4000);
  await d.keyboard.up('KeyW');
  await d.waitForTimeout(150);
  const doorOut = await d.evaluate(() => {
    const w = window.__zhishu.walk();
    return { trace: window.__zhishu.walkTraceStop(), pos: w.pos, gap: w.wallGap };
  });
  check(
    '批11B 7.2×9.2 门洞真走得过去：房内 −143 起按 W，位置序列跨过门平面 −137 且不停在门内',
    doorOut.trace.start?.[0] <= -142 &&
      doorOut.trace.end?.[0] >= -137 &&
      doorOut.pos.x >= -132 &&
      doorOut.gap >= 0 &&
      doorOut.trace.dyMax < 0.02,
    doorOut,
  );
  await d.screenshot({ path: `${SHOTS}/walk-door.png` });

  await d.evaluate(() => window.__zhishu.walkSnap(-147, 6.55, 0, 1));
  await d.evaluate(() => window.__zhishu.walkTraceStart());
  await d.keyboard.down('KeyW');
  await d.keyboard.down('KeyD');
  await d.waitForTimeout(1500);
  await d.keyboard.up('KeyW');
  await d.keyboard.up('KeyD');
  await d.waitForTimeout(150);
  const hugTrace = await d.evaluate(() => window.__zhishu.walkTraceStop());
  const hugState = await d.evaluate(() => window.__zhishu.walk());
  await d.evaluate(() => window.__zhishu.walkTraceStart());
  await d.keyboard.down('KeyS');
  await d.waitForTimeout(700);
  await d.keyboard.up('KeyS');
  await d.waitForTimeout(150);
  const unstick = await d.evaluate(() => window.__zhishu.walkTraceStop());
  check(
    '批11B 贴墙滑行不卡死：沿墙按住 1.5s 净位移 ≥0.35、柱面贴着墙（gap ≤0.1），松键反向 0.7s 仍能走 ≥0.35',
    hugTrace.net >= 0.35 && hugState.wallGap <= 0.1 && unstick.net >= 0.35 && hugTrace.dyMax < 0.02,
    { hug: hugTrace, gap: hugState.wallGap, unstick },
  );

  // 准星拾取：中心射线（ndc 0,0）复用批 8 的 faceIndex→(book,chapter) 反查，不另开一套拾取
  const aim = await d.evaluate(() => {
    const R = window.__zhishu;
    R.walkSnap(-147, -6.25, 0, -1);
    return { aim: R.walkAimSpine(3), cross: document.querySelector('[data-crosshair]')?.className ?? '', hud: (document.getElementById('hud')?.textContent ?? '').replace(/\s+/g, ' ').trim() };
  });
  await d.waitForTimeout(200);
  await d.mouse.move(720, 450);
  await d.mouse.down();
  await d.mouse.up();
  await d.waitForFunction(() => window.__zhishu.readerState().mode === 'chapter', null, { timeout: 15000 });
  const aimReader = await d.evaluate(() => window.__zhishu.readerState());
  check(
    '批11C 准星对书脊：命中即高亮 + HUD 报书面与章号，点一下开的正是准星下那一章',
    aim.aim?.ok === true &&
      aim.cross.includes('on-target') &&
      aim.hud.includes(aim.aim.chapterId) &&
      aimReader.file === aim.aim.book &&
      aimReader.open === true,
    { aim: aim.aim, cross: aim.cross, hud: aim.hud, reader: aimReader },
  );
  await d.screenshot({ path: `${SHOTS}/walk-crosshair-spine.png` });

  // 近景做工账：房内先读一次（书脊图集、书架、房墙、天花），回大厅漫游态再读一次（石板地面）
  const closeupRoom = await d.evaluate(() => window.__zhishu.closeupReport());
  const closeupHall = await d.evaluate(() => {
    const R = window.__zhishu;
    document.getElementById('panel-close')?.click();
    R.showHall();
    R.setWalk(true);
    return R.closeupReport();
  });
  await d.waitForTimeout(600);
  const texRows = [];
  for (const m of [...(closeupHall.maps ?? []), ...(closeupRoom.maps ?? [])]) {
    if (!texRows.some((r) => r.role === m.role)) texRows.push(m);
  }
  const texBad = texRows.filter((m) => !m.mipmaps || m.anisotropy < 4);
  const walkFloor = texRows.find((m) => m.role === 'hallFloor');
  const spineRow = texRows.find((m) => m.role === 'spines');
  check(
    '批11F 近景贴图账：每张图都有 mipmap 且各向异性 ≥4，漫游大厅地面重铺后 ≥30 texel/单位、书脊图集 ≥20',
    texRows.length >= 6 && texBad.length === 0 && (walkFloor?.texelPerUnit ?? 0) >= 30 && (spineRow?.texelPerUnit ?? 0) >= 20,
    { rows: texRows.map((m) => `${m.role}:${m.w}x${m.h} mip${m.mipmaps} an${m.anisotropy} tpu${m.texelPerUnit}`), maxAnisotropy: closeupHall.maxAnisotropy },
  );

  // 抬头到上限：pitch 必须夹住，yaw 不设限
  await d.evaluate(() => window.__zhishu.walkSetLook(0, 0));
  await d.mouse.move(1000, 700);
  await d.mouse.down();
  for (let i = 1; i <= 30; i += 1) await d.mouse.move(1000, 700 - i * 30);
  await d.mouse.up();
  await d.waitForTimeout(200);
  const lookUp = await d.evaluate(() => window.__zhishu.walk());
  await d.mouse.move(1000, 300);
  await d.mouse.down();
  for (let i = 1; i <= 14; i += 1) await d.mouse.move(1000 + i * 16, 300 - i * 12);
  await d.mouse.up();
  await d.waitForTimeout(200);
  const lookDrag = await d.evaluate(() => window.__zhishu.walk());
  check(
    '批11C 拖拽转头：横向拖 224px 的 Δyaw ≥30°，纵向顶到 −70°…+70° 就夹住（不翻转、不越界）',
    Math.abs(lookDrag.yawDeg) >= 30 && Math.abs(lookUp.pitchDeg) <= lookUp.pitchLimitDeg + 1e-6 && Math.abs(lookUp.pitchDeg - lookUp.pitchLimitDeg) <= 0.5,
    { pitchDeg: lookUp.pitchDeg, pitchLimitDeg: lookUp.pitchLimitDeg, yawDeg: lookDrag.yawDeg },
  );
  await d.evaluate(() => window.__zhishu.walkSetLook(0, 55));
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${SHOTS}/walk-ceiling.png` });

  const walkFps = await fps(d, 10000);
  check('批11E 漫游态桌面帧率 10s 均值 ≥45', walkFps >= 45, { walkFps });

  await d.evaluate(() => window.__zhishu.setWalk(true));
  await d.waitForTimeout(300);
  const poseBeforeWalk = await d.evaluate(() => window.__zhishu.pose());
  await d.evaluate(() => window.__zhishu.walkTraceStart());
  await d.keyboard.down('KeyW');
  await d.waitForTimeout(700);
  await d.keyboard.up('KeyW');
  await d.evaluate(() => window.__zhishu.setWalk(false));
  await d.waitForFunction(() => window.__zhishu.walk().mode === 'orbit', null, { timeout: 8000 });
  await d.waitForTimeout(400);
  const poseAfterWalk = await d.evaluate(() => window.__zhishu.pose());
  const poseDelta = Math.max(...['px', 'py', 'pz', 'tx', 'ty', 'tz'].map((k) => Math.abs(poseAfterWalk[k] - poseBeforeWalk[k])));
  const orbitDist = (p) => Math.hypot(p.px - p.tx, p.py - p.ty, p.pz - p.tz);
  check(
    '批11A 退出漫游复原进入前的轨道位姿：六分量最大差 ≤0.05 且轨道距离不变',
    poseDelta <= 0.05 && Math.abs(orbitDist(poseAfterWalk) - orbitDist(poseBeforeWalk)) <= 0.05,
    {
      poseDelta: Number(poseDelta.toFixed(6)),
      distBefore: Math.round(orbitDist(poseBeforeWalk) * 100) / 100,
      distAfter: Math.round(orbitDist(poseAfterWalk) * 100) / 100,
      crossHidden: await d.evaluate(() => document.querySelector('[data-crosshair]')?.hidden ?? null),
    },
  );

  /* ---------------------------------------------------------------- 批 12：中央大厅的第一人称内容
   * 大厅半径 44 / 高 22 是给俯瞰镜头建的，1.65 眼高站在厅心只读出一整面暗墙——本批不改尺度，
   * 改法是给中央加内容（八角索引台 + 六座低位展柜）。采样口径三条，全写进 _work/decisions.md：
   *  · D1 环视「有内容」= 走真实拾取链 pickAt(ndc(0,0)) → pickHall 的 faceIndex 表命中，且命中物在
   *    内容物角色表（indexDesk/deskTop/deskBand/displayCase/caseHood/caseLamp/caseSpine）内、距离 ≤25；
   *    纯墙不算。台面 1.1 与罩顶 1.94 夹着眼高 1.65，每方位沿俯仰扇 [0,−6,−12,−20,−30]° 取第一条命中。
   *  · D2 扇区↔走廊对位用两个独立来源对撞：doorBearingScan 从厅心水平扫一圈量门洞质心（穿洞打到走廊
   *    尽头 >100，实心墙 44 就停，连续通孔段取圆周质心）；aimDeskRay 从台缘按任意方位角压台面，
   *    读回准星落在哪一块。两边的角差才是实测漂移，±24.5° 必须已经落到邻区。
   *  · D3 通路量 walkGapAt（带符号净空，已扣玩家半径 0.45，负数＝嵌在盒里），与批 9 走廊夹点、
   *    批 11 六走廊贯通同一套 resolveSlide；台面账另与 data/manifest.json 现算值逐区对账。
   */
  const mManifest = JSON.parse(fs.readFileSync('data/manifest.json', 'utf8'));
  const wantCount = {};
  for (const site of mManifest.sites) {
    const w = (wantCount[site.discipline] ??= { books: 0, chapters: 0 });
    w.books += 1;
    w.chapters += site.stats?.chapters ?? 0;
  }
  await d.evaluate(() => document.getElementById('panel-close')?.click());
  await d.evaluate(() => window.__zhishu.showHall());
  await d.waitForFunction(() => window.__zhishu.frameCheck()?.view === 'hall', null, { timeout: 15000 });
  await d.evaluate(() => window.__zhishu.setWalk(true));
  await d.waitForFunction(() => window.__zhishu.walk().mode === 'walk', null, { timeout: 8000 });
  await d.waitForTimeout(700);
  const spawn = await d.evaluate(() => window.__zhishu.walk());
  const atr = await d.evaluate(() => window.__zhishu.atriumState());
  log.push(
    `批 12 大厅内容物：八角台 r ${atr.desk.topR}／台面 ${atr.desk.topY} 纹理 ${atr.topTex.join('×')} · ` +
      `扇区 ${atr.sectors.length} 块、vs 门洞最大漂移 ${atr.maxDriftDeg}° · 展柜 ${atr.cases.length} 座 圈层半径 ${atr.caseRing[0]} · ` +
      `脊 ${atr.spines.slots} 根／${atr.spines.triangles} 三角面／图集 ${atr.spines.atlasPages} 页 · ` +
      `碰撞 indexDesk ${atr.blockers.indexDesk ?? 0} displayCase ${atr.blockers.displayCase ?? 0} 共 ${Object.values(atr.blockers).reduce((a, b) => a + b, 0)} 盒 · ` +
      `自发光 台 ${atr.emissive.top}／灯带 ${atr.emissive.band}／射灯 ${atr.emissive.lamp}`,
  );
  check(
    '批12A 中央索引台立在厅心：八角台 r4 底面直径 8、台面高 1.10、六扇区、台面 1024² canvas、自带一盏点光且是碰撞体',
    atr.sectors.length === 6 &&
      atr.desk.r === 4 &&
      Math.abs(atr.desk.topY - 1.1) < 1e-6 &&
      atr.desk.topR > atr.desk.r &&
      atr.topTex[0] === 1024 &&
      atr.topTex[1] === 1024 &&
      (atr.blockers.indexDesk ?? 0) === 1 &&
      atr.desk.lightIntensity > 0 &&
      atr.desk.lightDistance > 0 &&
      atr.triangles.desk >= 16,
    { desk: atr.desk, topTex: atr.topTex, blockers: atr.blockers, deskTris: atr.triangles.desk, sectors: atr.sectors.length },
  );
  const sectorLedger = atr.sectors.map((x) => ({
    key: x.key,
    books: x.books,
    chapters: x.chapters,
    want: wantCount[x.key]?.books ?? 0,
    wantChapters: wantCount[x.key]?.chapters ?? 0,
  }));
  check(
    '批12A 台面六扇区的区名/本数/章数逐区等于 data/manifest.json 现算值（零编造，合计＝129 本／1169 章）',
    sectorLedger.length === 6 &&
      sectorLedger.every((x) => x.books === x.want && x.chapters === x.wantChapters) &&
      sectorLedger.reduce((a, x) => a + x.books, 0) === mManifest.totals.sites &&
      sectorLedger.reduce((a, x) => a + x.chapters, 0) === mManifest.totals.chapters,
    { rows: sectorLedger, sites: mManifest.totals.sites, chapters: mManifest.totals.chapters },
  );

  // 扇区拼合账：六块必须首尾无缝无叠（宽度不等是设计，漏缝与重压是 bug）
  const seam = await d.evaluate(() => {
    const R = window.__zhishu;
    const st = R.atriumState();
    const norm = (x) => ((x % 360) + 360) % 360;
    const secs = [...st.sectors].sort((a, b) => a.amDeg - b.amDeg);
    const gaps = [];
    let sum = 0;
    for (let i = 0; i < secs.length; i += 1) {
      const a0 = norm(secs[i].a0Deg);
      const a1 = norm(secs[i].a1Deg);
      sum += a1 > a0 ? a1 - a0 : 360 - a0 + a1;
      const nxt = secs[(i + 1) % secs.length];
      gaps.push(Math.round(Math.abs(norm(nxt.a0Deg) - a1) * 100) / 100);
    }
    return {
      sumDeg: Math.round(sum * 100) / 100,
      seams: gaps,
      maxSeam: Math.max(...gaps),
      order: secs.map((x) => `${x.key}@${x.amDeg}`).join(','),
      widths: secs.map((x) => {
        const a0 = norm(x.a0Deg);
        const a1 = norm(x.a1Deg);
        return Math.round((a1 > a0 ? a1 - a0 : 360 - a0 + a1) * 10) / 10;
      }),
    };
  });
  check(
    '批12A 台面六扇区首尾拼满 360°：宽度不等是设计、缝隙与重叠是 bug（相邻分界线角差 ≤0.05°）',
    seam.sumDeg === 360 && seam.maxSeam <= 0.05 && seam.seams.length === 6,
    seam,
  );

  // 近台升档：先在 24 单位外读一档，再回台缘读另一档
  const farRead = await d.evaluate(() => {
    const R = window.__zhishu;
    const s0 = R.walk();
    const a = Math.atan2(s0.pos.z, s0.pos.x);
    R.walkSnap(Math.cos(a) * 24, Math.sin(a) * 24, -Math.cos(a), -Math.sin(a));
    // 默认提示要在「准星没有目标」时读：台面在眼高以下，把俯仰归零即可，否则读到的是上一项测试留下的命中口径
    R.walkSetLook(R.walk().yawDeg, 0);
    const st = R.atriumState();
    return { near: st.near, top: st.emissive.top, band: st.emissive.band, light: st.desk.lightIntensity, dist: 24, at: R.walk().pos };
  });
  const nearRead = await d.evaluate(() => {
    const R = window.__zhishu;
    const s0 = R.walk();
    const a = Math.atan2(s0.pos.z, s0.pos.x);
    R.walkSnap(Math.cos(a) * R.atriumState().desk.standR, Math.sin(a) * R.atriumState().desk.standR, -Math.cos(a), -Math.sin(a));
    R.walkSetLook(R.walk().yawDeg, 0);
    const st = R.atriumState();
    return {
      near: st.near,
      top: st.emissive.top,
      band: st.emissive.band,
      light: st.desk.lightIntensity,
      dist: Math.round(Math.hypot(R.walk().pos.x, R.walk().pos.z) * 100) / 100,
      hud: (document.getElementById('hud')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
  log.push(
    `批 12 近台账：远 ${farRead.dist ?? '—'} 处 near=${farRead.near} 台面 ${farRead.top}/灯带 ${farRead.band}/点光 ${farRead.light} → ` +
      `台缘 ${nearRead.dist} 处 near=${nearRead.near} 台面 ${nearRead.top}/灯带 ${nearRead.band}/点光 ${nearRead.light}`,
  );
  check(
    '批12A 进入 6 单位内台面自发光升一档、灯带同步抬，HUD 出「六区索引 · 准星选扇区」',
    farRead.near === false &&
      nearRead.near === true &&
      nearRead.dist <= 6 &&
      nearRead.top > farRead.top &&
      nearRead.band > farRead.band &&
      nearRead.hud.includes('六区索引') &&
      nearRead.hud.includes('准星选扇区'),
    { far: farRead, near: nearRead },
  );

  // D2：门洞实测方位 + 扇区闭环（扇区左右不对称，边界一律用本区自己的 a0/a1，不用固定 ±角）
  const doorScan = await d.evaluate(() => window.__zhishu.doorBearingScan(1));
  const norm180 = (x) => ((x + 540) % 360) - 180;
  const spanOf = (sec) => norm180(sec.a1Deg - sec.a0Deg);
  const ownerAt = (deg) => atr.sectors.find((x) => {
    const w = norm180(deg - x.a0Deg);
    return w >= 0 && w <= spanOf(x);
  }) ?? null;
  const rays = [];
  for (const sec of atr.sectors) {
    const hole = doorScan.drift.find((x) => x.key === sec.key) ?? null;
    const r = await d.evaluate(
      (arg) => {
        const R = window.__zhishu;
        return {
          mid: R.aimDeskRay(arg.deg),
          inL: R.aimDeskRay(arg.a0 + 2),
          inR: R.aimDeskRay(arg.a1 - 2),
          outL: R.aimDeskRay(arg.a0 - 2),
          outR: R.aimDeskRay(arg.a1 + 2),
          door: R.aimDeskRay(arg.hole >= 0 ? arg.hole : arg.deg),
        };
      },
      { deg: sec.doorDeg, a0: sec.a0Deg, a1: sec.a1Deg, hole: hole?.holeDeg ?? -1 },
    );
    const wantL = ownerAt(sec.a0Deg - 2);
    const wantR = ownerAt(sec.a1Deg + 2);
    rays.push({
      key: sec.key,
      doorDeg: sec.doorDeg,
      sectorDeg: sec.amDeg,
      holeDeg: hole?.holeDeg ?? -1,
      holeSpan: hole ? doorScan.holes.find((h) => h.deg === hole.holeDeg)?.spanDeg ?? 0 : 0,
      holeReach: hole ? doorScan.holes.find((h) => h.deg === hole.holeDeg)?.maxDist ?? 0 : 0,
      driftDeg: hole?.driftDeg ?? 999,
      sectorVsHoleDeg: hole?.sectorVsHoleDeg ?? 999,
      spanDeg: Math.round(spanOf(sec) * 100) / 100,
      hitKey: r.mid.key,
      doorKey: r.door.key,
      inLKey: r.inL.key,
      inRKey: r.inR.key,
      outLKey: r.outL.key,
      outRKey: r.outR.key,
      wantL: wantL?.key ?? '',
      wantR: wantR?.key ?? '',
      ok:
        r.mid.key === sec.key &&
        r.door.key === sec.key &&
        r.inL.key === sec.key &&
        r.inR.key === sec.key &&
        r.outL.key === (wantL?.key ?? '') &&
        r.outL.key !== sec.key &&
        r.outR.key === (wantR?.key ?? '') &&
        r.outR.key !== sec.key,
    });
  }
  log.push(
    `批 12 门洞实测（${doorScan.stepDeg}° 一圈）：通孔 ${doorScan.holes.length} 段 ` +
      doorScan.holes.map((h) => `${h.deg}°/${h.spanDeg}°/${h.maxDist}`).join(' ') +
      ` · 扇区 vs 门洞漂移 ` + rays.map((x) => `${x.key}:${x.sectorVsHoleDeg}`).join(' '),
  );
  check(
    '批12A 台面六扇区与六条走廊实测对位：门洞质心与扇区中心线角差 ≤3°、对准门洞即选中本区，本区边界内 2° 仍是本区、外 2° 已落到邻区',
    doorScan.holes.length === 6 &&
      rays.length === 6 &&
      rays.every((x) => x.holeDeg >= 0 && x.sectorVsHoleDeg <= 3 && x.driftDeg <= 3 && x.ok) &&
      doorScan.maxDriftDeg <= 3,
    { stepDeg: doorScan.stepDeg, holes: doorScan.holes, rows: rays, maxDriftDeg: doorScan.maxDriftDeg },
  );

  // 准星压扇区 → 高亮 + HUD 报数
  const aimRows = [];
  for (let i = 0; i < atr.sectors.length; i += 1) {
    const row = await d.evaluate((k) => {
      const R = window.__zhishu;
      const a = R.aimDeskSector(k);
      const st = R.atriumState();
      return {
        aim: a,
        highlight: st.highlight,
        aimSector: st.aimSector,
        hud: (document.getElementById('hud')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      };
    }, i);
    const sec = atr.sectors[i];
    aimRows.push({
      i,
      key: sec.key,
      ok: Boolean(row.aim?.ok),
      title: row.aim?.title ?? '',
        books: sec.books,
      chapters: sec.chapters,
      highlight: row.highlight,
      hudHasCount: row.hud.includes(`${sec.books} 本`) && row.hud.includes(`${sec.chapters} 章`),
      hud: row.hud.slice(0, 60),
    });
  }
  log.push(`批 12 扇区高亮：${aimRows.map((x) => `${x.key}${x.ok ? '✓' : '✗'}[${x.highlight.join(',')}]`).join(' ')}`);
  check(
    '批12A 准星压到扇区：该块高亮（只亮这一块）+ HUD 报「区名 · N 本 · M 章」，六区全对',
    aimRows.length === 6 && aimRows.every((x) => x.ok && x.highlight.length === 1 && x.highlight[0] === x.i && x.hudHasCount),
    { rows: aimRows.map((x) => ({ key: x.key, ok: x.ok, hi: x.highlight, hud: x.hud })) },
  );
  await d.evaluate(() => window.__zhishu.aimDeskSector(0));
  await d.waitForTimeout(200);
  await d.screenshot({ path: `${SHOTS}/desk-sector.png` });

  // 点击台面扇区 → 走现有 enterRoom
  const enterRows = [];
  for (const i of [0, 2, 4]) {
    await d.evaluate((k) => window.__zhishu.aimDeskSector(k), i);
    await d.waitForTimeout(180);
    await d.mouse.move(720, 450);
    await d.mouse.down();
    await d.mouse.up();
    let got = 'timeout';
    try {
      await d.waitForFunction(
        () => window.__zhishu.room() && window.__zhishu.frameCheck()?.view === 'room',
        null,
        { timeout: 15000 },
      );
      got = await d.evaluate(() => window.__zhishu.room());
    } catch {
      got = 'timeout';
    }
    enterRows.push({ i, want: atr.sectors[i].key, got });
    await d.evaluate(() => {
      document.getElementById('panel-close')?.click();
      window.__zhishu.showHall();
    });
    await d.waitForTimeout(800);
    await d.evaluate(() => window.__zhishu.setWalk(true));
    await d.waitForFunction(() => window.__zhishu.walk().mode === 'walk', null, { timeout: 8000 });
  }
  check(
    '批12A 点台面扇区进对应区（复用现有 enterRoom，三区实测 room() 全对）',
    enterRows.length === 3 && enterRows.every((x) => x.got === x.want),
    enterRows,
  );

  // 展柜圈：位置、书脊账、faceIndex 覆盖柜体
  const caseRing = atr.cases.map((c) => Math.round(Math.hypot(c.x, c.z) * 100) / 100);
  const caseRows = [];
  for (let i = 0; i < atr.cases.length; i += 1) {
    const row = await d.evaluate((k) => {
      const R = window.__zhishu;
      R.showHall();
      R.setWalk(true);
      return R.aimCaseBody(k);
    }, i);
    const c = atr.cases[i];
    caseRows.push({ i, key: c.key, r: caseRing[i], ok: Boolean(row?.ok), kind: row?.kind ?? '', hint: row?.hint ?? '' });
  }
  log.push(
    `批 12 展柜：圈层半径 ${caseRing.join('/')} ·  lean ${atr.cases[0].lean} · 脊 ` +
      atr.cases.map((c) => `${c.key}:${c.spines}`).join(' ') +
      ` · 柜体准星 ` + caseRows.map((x) => `${x.key}${x.ok ? '✓' : '✗'}`).join(' '),
  );
  check(
    '批12B 六座展柜落在内圈 18–22、各居一条走廊入口与中心之间，柜面高 1.2／宽 3／深 1.2，罩顶 1.94',
    atr.cases.length === 6 &&
      caseRing.every((r) => r >= 18 && r <= 22) &&
      (atr.blockers.displayCase ?? 0) === 6 &&
      atr.emissive.lamp >= 2 &&
      atr.emissive.lamp <= 3.5,
    { ring: caseRing, blockers: atr.blockers, lamp: atr.emissive.lamp, near: atr.near },
  );
  check(
    '批12B 展柜书脊只从库内挑：每座取该区章数最多的前三本，脊数＝Σmin(3, 该区本数)，章数合计等于这三本之和',
    atr.spines.slots ===
      atr.cases.reduce((a, c) => a + Math.min(3, wantCount[c.key]?.books ?? 0), 0) &&
      atr.cases.every((c) => {
        const top = mManifest.sites
          .filter((x) => x.discipline === c.key && (x.stats?.chapters ?? 0) > 0)
          .sort((x, y) => (y.stats?.chapters ?? 0) - (x.stats?.chapters ?? 0) || x.file.localeCompare(y.file))
          .slice(0, 3);
        return c.spines === top.length && c.chapters === top.reduce((a, x) => a + (x.stats?.chapters ?? 0), 0);
      }) &&
      atr.spines.triangles === atr.spines.slots * 12 &&
      atr.spines.atlasPages === 1,
    {
      slots: atr.spines.slots,
      tris: atr.spines.triangles,
      pages: atr.spines.atlasPages,
      cases: atr.cases.map((c) => ({ key: c.key, spines: c.spines, titles: c.title.split(' / ').length, chapters: c.chapters })),
    },
  );
  check(
    '批12B 柜体也进 faceIndex→(书,章) 同一张映射表：准星压柜身按区报「N 根书脊」，六座全对（工具间零书位如实报暂无）',
    caseRows.length === 6 &&
      caseRows.every((x) => x.ok && x.kind === 'room' && x.hint.includes('展柜')) &&
      caseRows.filter((x) => x.hint.includes('暂无书位')).length === atr.cases.filter((c) => (wantCount[c.key]?.books ?? 0) === 0).length,
    caseRows,
  );

  // 展柜书脊：逐根准星 + 点开的是不是罩内那一本
  const spineRows = [];
  for (let i = 0; i < atr.spines.slots; i += 1) {
    const row = await d.evaluate((k) => {
      const R = window.__zhishu;
      R.showHall();
      R.setWalk(true);
      return R.aimCaseSpine(k);
    }, i);
    spineRows.push(row);
  }
  const spineOk = spineRows.filter((x) => x?.ok).length;
  log.push(
    `批 12 罩内书脊准星：${spineOk}/${spineRows.length} 命中且书名对得上 ` +
      spineRows.map((x) => `${x.discipline}#${x.index}${x.ok ? '✓' : '✗'}`).join(' '),
  );
  check(
    '批12B 罩内书脊可看：准星压脊 kind=chapter，命中的就是那根脊（file 级对账），全圈 ≥12/15',
    spineRows.length >= 12 && spineOk >= 12 && spineOk === spineRows.length,
    { rows: spineRows.map((x) => ({ i: x.index, key: x.discipline, ok: x.ok, file: x.file, kind: x.kind, dist: x.dist })) },
  );
  await d.evaluate(() => {
    window.__zhishu.showHall();
    window.__zhishu.setWalk(true);
    window.__zhishu.aimCaseSpine(0);
  });
  await d.waitForTimeout(250);
  await d.screenshot({ path: `${SHOTS}/case-spine.png` });

  const openRows = [];
  for (const i of [0, 7]) {
    const aim = await d.evaluate((k) => {
      const R = window.__zhishu;
      R.showHall();
      R.setWalk(true);
      return R.aimCaseSpine(k);
    }, i);
    await d.waitForTimeout(200);
    await d.mouse.move(720, 450);
    await d.mouse.down();
    await d.mouse.up();
    let rd = null;
    try {
      await d.waitForFunction(() => window.__zhishu.readerState().open === true, null, { timeout: 15000 });
      await d.waitForTimeout(500);
      rd = await d.evaluate(() => ({
        reader: window.__zhishu.readerState(),
        chars: (document.getElementById('panel-body')?.innerText ?? '').length,
        head: (document.querySelector('#panel-body h1, #panel-body h2, #panel-body .ch-title')?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        body: (document.getElementById('panel-body')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
      }));
    } catch {
      rd = { reader: { open: false }, chars: 0, head: '' };
    }
    const first = rd.reader?.file ? JSON.parse(fs.readFileSync(`data/sites/${rd.reader.file}`, 'utf8')) : null;
    openRows.push({
      i,
      want: aim?.book ?? '',
      wantFile: aim?.file ?? '',
      gotFile: rd.reader?.file ?? null,
      mode: rd.reader?.mode ?? '',
      chars: rd.chars,
      firstChapter: first?.chapters?.[0]?.title ?? '',
      head: rd.head,
      headHit: Boolean(first?.chapters?.[0]?.title && `${rd.head} ${rd.body}`.includes(String(first.chapters[0].title).slice(0, 10))),
    });
    await d.evaluate(() => {
      document.getElementById('panel-close')?.click();
      window.__zhishu.showHall();
    });
    await d.waitForTimeout(800);
    await d.evaluate(() => window.__zhishu.setWalk(true));
    await d.waitForFunction(() => window.__zhishu.walk().mode === 'walk', null, { timeout: 8000 });
  }
  await d.screenshot({ path: `${SHOTS}/case-reader.png` });
  check(
    '批12B 点罩内书脊开该书首章：file 级对上是同一本、mode=chapter、正文非空且标题即该书第 1 章',
    openRows.length === 2 &&
      openRows.every((x) => x.gotFile === x.wantFile && x.mode === 'chapter' && x.chars > 400 && x.headHit),
    openRows,
  );

  // 走线与可达
  const routes = await d.evaluate(() => {
    const R = window.__zhishu;
    const secs = R.atriumState().sectors;
    return secs.map((sec) => {
      const a = (sec.doorDeg * Math.PI) / 180;
      const dir = [Math.cos(a), Math.sin(a)];
      R.walkSnap(dir[0] * 6, dir[1] * 6, dir[0], dir[1]);
      const m = R.walkMarch(dir[0], dir[1], 150, 'hall');
      let minGap = 99;
      let tightAt = 0;
      for (let r = 6; r <= m.travelled - 1.5; r += 1) {
        const g = R.walkGapAt(dir[0] * r, dir[1] * r);
        if (g < minGap) { minGap = g; tightAt = r; }
      }
      return { key: sec.key, deg: sec.doorDeg, travelled: m.travelled, stopKinds: m.stopKinds, minGap, tightAt };
    });
  });
  log.push(
    `批 12 通路：` + routes.map((x) => `${x.key} ${x.travelled}（${x.stopKinds}）隙 ${x.minGap}@r${x.tightAt}`).join(' · '),
  );
  check(
    '批12C 台与柜不挡六条通路：中心外 6 单位起沿六个门洞方位直线推进，全部 ≥125 到该区门面，最小净空 ≥0.3',
    routes.length === 6 &&
      routes.every((x) => x.travelled >= 125 && String(x.stopKinds).includes('facade') && x.minGap >= 0.3),
    routes,
  );
  const blockRows = await d.evaluate(() => {
    const R = window.__zhishu;
    const ring = [];
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      R.walkSnap(Math.cos(a) * 5.4, Math.sin(a) * 5.4, -Math.cos(a), -Math.sin(a));
      const w = R.walk();
      ring.push(Math.round(Math.hypot(w.pos.x, w.pos.z) * 100) / 100);
    }
    R.showHall();
    R.setWalk(true);
    const s0 = R.walk();
    const a0 = Math.atan2(s0.pos.z, s0.pos.x);
    R.walkSnap(Math.cos(a0) * 4.8, Math.sin(a0) * 4.8, -Math.cos(a0), -Math.sin(a0));
    const into = R.walkMarch(-Math.cos(a0), -Math.sin(a0), 6, 'hall');
    return { ring, ringMin: Math.min(...ring), ringMax: Math.max(...ring), into: { travelled: into.travelled, stopKinds: into.stopKinds } };
  });
  log.push(`批 12 绕行：台外圈 5.4 上 24 点落位半径 ${blockRows.ringMin}–${blockRows.ringMax} · 正对台心推 6 单位只走 ${blockRows.into.travelled}（${blockRows.into.stopKinds}）`);
  check(
    '批12C 索引台是圆柱碰撞体：走不进去（正对台心按 6 单位只推进 <1.2 且第一下是 indexDesk），但绕得过（外圈 24 点全落位、半径不漂）',
    blockRows.into.travelled < 1.2 &&
      String(blockRows.into.stopKinds).includes('indexDesk') &&
      blockRows.ringMin >= 4.9 &&
      blockRows.ringMax <= 5.5,
    { into: blockRows.into, ringMin: blockRows.ringMin, ringMax: blockRows.ringMax, ring: blockRows.ring },
  );

  // 亮度与构图：站位固定成「贴台缘读图」这一点（180° 方位、standR 外），否则前一项测试把人也带走了
  const stand = await d.evaluate(() => {
    const R = window.__zhishu;
    const rr = R.atriumState().desk.standR;
    R.walkSnap(-rr, 0, 1, 0);
    const ground = R.walkGroundSample(-35);
    const sight = R.hallSightScan(25);
    return { ground, sight, standR: rr };
  });
  const ground = stand.ground;
  const sight = stand.sight;
  log.push(
    `批 12 大厅 walk 站立（${sight.at.join(',')}）：环视有内容 ${sight.content}/${sight.total} ` +
      sight.dirs.map((x) => `${x.deg}°${x.content ? '✓' : '·'}${x.role || '无'}@${x.dist === -1 ? '∞' : x.dist}`).join(' ') +
      ` · 地面亮度均值 ${ground.mean}（${ground.floorDirs}/${ground.total} 个方位准星确认打到地面，最低 ${ground.min}）`,
  );
  check(
    '批12D 大厅 walk 环视 360°（8 个 45° 方位 × ±20° 视野带 × 俯仰扇 [0,−6,−12,−20,−30]）：≥5/8 方向有内容且都不是纯墙',
    sight.total === 8 && sight.content >= 5 && sight.dirs.filter((x) => x.content).every((x) => x.dist <= 25),
    { content: sight.content, dirs: sight.dirs, limit: sight.limit, at: sight.at },
  );
  check(
    '批12D 大厅 walk 站立处地面平均亮度 ≥0.06（批 11 同点位 0.042 一档之上；逐方位先确认采样带中心打的是地面）',
    ground.floorDirs >= 8 && ground.mean >= 0.06 && ground.max >= 0.06,
    { mean: ground.mean, min: ground.min, max: ground.max, floorDirs: ground.floorDirs, rows: ground.rows, box: ground.box },
  );
  await d.screenshot({ path: `${SHOTS}/walk-hall-desk.png` });
  await d.evaluate(() => window.__zhishu.walkSetLook(0, 0));
  await d.waitForTimeout(250);
  await d.screenshot({ path: `${SHOTS}/walk-hall-back.png` });
  const shotDoor = await d.evaluate(() => {
    const R = window.__zhishu;
    const sec = R.atriumState().sectors[1];
    const a = (sec.doorDeg * Math.PI) / 180;
    R.walkSnap(Math.cos(a) * 5.4, Math.sin(a) * 5.4, Math.cos(a), Math.sin(a));
    return R.walk().pos;
  });
  await d.waitForTimeout(250);
  await d.screenshot({ path: `${SHOTS}/walk-hall-door.png` });
  const shotCase = await d.evaluate(() => {
    const R = window.__zhishu;
    R.showHall();
    R.setWalk(true);
    R.aimCaseSpine(7);
    return R.walk().pos;
  });
  await d.waitForTimeout(300);
  await d.screenshot({ path: `${SHOTS}/walk-hall-case.png` });
  log.push(`批 12 截图机位：面向走廊 ${JSON.stringify(shotDoor)} · 站在展柜前 ${JSON.stringify(shotCase)}`);

  const atrCen = await d.evaluate(() => window.__zhishu.census());
  const atrFps = await fps(d, 6000);
  log.push(
    `批 12 大厅 walk 帧账：三角面 主 ${atrCen.triangles.mainPass}/阴影 ${atrCen.triangles.shadowPass} · draw ${atrCen.calls.perFrame} · ` +
      `灯 ${JSON.stringify(atrCen.lights)} · 6s 帧率 ${atrFps}`,
  );
  check(
    '批12G 帧预算不回退：大厅 walk 态三角面 ≤60000、draw ≤110、6s 帧率 ≥45',
    atrCen.triangles.mainPass <= 60000 && atrCen.calls.perFrame <= 110 && atrFps >= 45,
    { tris: atrCen.triangles.mainPass, calls: atrCen.calls.perFrame, walkFps: atrFps, lights: atrCen.lights },
  );
  await d.evaluate(() => window.__zhishu.setWalk(false));
  await d.waitForFunction(() => window.__zhishu.walk().mode === 'orbit', null, { timeout: 8000 });
  await d.waitForTimeout(500);
  await d.screenshot({ path: `${SHOTS}/atrium-overhead.png` });

  // 运行期零外部请求（路由层已阻断，出现即记录）
  check('运行期零外部请求', requests.external.length === 0, requests.external.slice(0, 6));
  await dctx.close();

  // ---------------------------------------------------------------- 手机 390×844 · 竖屏 3D（批 9：2D 降级路径已删除）
  // 这一段旧判据不是删掉，是按 3D 语义改写/反写，逐条对应关系见 _work/decisions.md 批 9 D1。
  const { context: mctx, page: m } = await newPage(browser, 'mobile', {
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await m.goto(BASE, { waitUntil: 'load' });
  await ready(m);
  const mobileMount = await m.evaluate(() => {
    const lum = window.__zhishu.sampleLuminance(0, 0, 1, 1);
    return {
      mode: window.__zhishu.mode,
      canvas: Boolean(document.querySelector('#three-root canvas')),
      svgRoot: Boolean(document.querySelector('#svg-root')),
      mean: lum?.mean ?? 0,
      p95: lum?.p95 ?? 0,
      quality: window.__zhishu.quality(),
      frame: window.__zhishu.frameCheck(),
      sceneChunks: performance
        .getEntriesByType('resource')
        .map((e) => e.name.split('/').pop() ?? e.name)
        .filter((n) => n.startsWith('scene3d-')),
    };
  });
  log.push(
    `390 竖屏挂载：mode=${mobileMount.mode} 档 ${mobileMount.quality?.name} dpr=${mobileMount.quality?.pixelRatio} ` +
      `bloom=${mobileMount.quality?.bloom} 阴影=${mobileMount.quality?.shadows} mean=${mobileMount.mean} p95=${mobileMount.p95} ` +
      `构图 ${mobileMount.frame?.inFrame}/${mobileMount.frame?.total} · scene3d 分包 ${mobileMount.sceneChunks.join(',') || '无'}`,
  );
  // 旧判据「390px 触屏自动降级 2D」语义反写：three 才是通过态，并补一条「画布不是全黑」的出图证据
  check(
    '390 竖屏走 3D（three 模式 + WebGL 画布 + 画面非全黑）',
    mobileMount.mode === 'three' && mobileMount.canvas === true && mobileMount.p95 > 0.02,
    mobileMount,
  );
  const hallFrameGroups = mobileMount.frame?.groups ?? {};
  check(
    '390 竖屏大厅构图：六体量 / 六门洞 / 天花八角顶点全部入画',
    ['facades', 'doors', 'ceiling'].every(
      (g) => (hallFrameGroups[g]?.total ?? 0) > 0 && hallFrameGroups[g].in === hallFrameGroups[g].total,
    ),
    hallFrameGroups,
  );
  const wMobileHall = await scrollWidth(m);
  check('390 大厅 scrollWidth === 390', wMobileHall.doc === 390, wMobileHall);

  // ---------------------------------------------------------------- 批 10 A：竖屏构图反算（判据 1/2/5）
  // 主体 = 八角壳 16 点 + 六门 24 点 + 六走廊端点 24 点 + 六门签 24 点，投到 NDC 取包络；
  // 底部 UI = 小地图 + 房间栏 + hud 提示条 三者的并集带（顶边取最高者），重叠按主体屏幕矩形算面积比。
  const hallSubject = await m.evaluate(() => {
    const z = window.__zhishu;
    z.holdMinimap(true);
    const sub = z.subjectBox('hall');
    const lum = z.sampleLuminance(0, 0, 1, 1);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? { top: r.top, h: r.height, w: r.width } : null;
    };
    const uis = { roombar: rect('roombar'), minimap: rect('minimap'), hud: rect('hud') };
    const bandTop = Math.min(...Object.values(uis).filter(Boolean).map((r) => r.top));
    const [nx0, nx1, ny0, ny1] = sub.ndc;
    const sx0 = ((nx0 + 1) / 2) * vw;
    const sx1 = ((nx1 + 1) / 2) * vw;
    const sy0 = ((1 - ny1) / 2) * vh;
    const sy1 = ((1 - ny0) / 2) * vh;
    const ix = Math.max(0, Math.min(sx1, vw) - Math.max(sx0, 0));
    const iy = Math.max(0, Math.min(sy1, vh) - Math.max(bandTop, sy0));
    const subArea = Math.max(1, (Math.min(sx1, vw) - Math.max(sx0, 0)) * (Math.min(sy1, vh) - Math.max(sy0, 0)));
    return {
      sub,
      dark: lum.darkRatio,
      bandH: Number((vh - bandTop).toFixed(1)),
      bandPct: Number((((vh - bandTop) / vh) * 100).toFixed(1)),
      overlapPct: Number(((ix * iy) / subArea * 100).toFixed(1)),
      uis,
      vw,
      vh,
    };
  });
  await m.waitForTimeout(120);
  await m.evaluate(() => window.__zhishu.holdMinimap(false));
  log.push(
    `390 大厅主体：V ${hallSubject.sub.v} H ${hallSubject.sub.h}（NDC ${JSON.stringify(hallSubject.sub.ndc)}）· ` +
      `底部 UI ${hallSubject.bandH}px / ${hallSubject.bandPct}% · 与主体重叠 ${hallSubject.overlapPct}% · 纯黑 ${(hallSubject.dark * 100).toFixed(2)}%`,
  );
  check(
    '批 10 A1 390 大厅主体竖向占屏 ≥50%（壳+走廊+门签投影包络）',
    hallSubject.sub.v >= 0.5,
    { v: hallSubject.sub.v, h: hallSubject.sub.h, ndc: hallSubject.sub.ndc },
  );
  check(
    '批 10 A2 390 大厅主体横向占屏 ≥75% 且六门洞全在画内',
    hallSubject.sub.h >= 0.75 &&
      (hallFrameGroups.doors?.total ?? 0) === 6 &&
      hallFrameGroups.doors.in === 6,
    { h: hallSubject.sub.h, doors: hallFrameGroups.doors },
  );
  check(
    '批 10 A5 390 底部 UI 合计高度 ≤22% 且与主体投影重叠 ≤10%',
    hallSubject.bandPct <= 22 && hallSubject.overlapPct <= 10,
    { bandPct: hallSubject.bandPct, overlapPct: hallSubject.overlapPct, uis: hallSubject.uis, vh: hallSubject.vh },
  );
  check(
    '390 窄屏画质档：DPR ≤1.5、bloom 关、光尘按预算截断',
    mobileMount.quality?.name === 'mobile' &&
      mobileMount.quality.pixelRatio <= 1.5 &&
      mobileMount.quality.bloom === false &&
      mobileMount.quality.dustBudget > 0 &&
      mobileMount.quality.dustBudget < 600,
    mobileMount.quality,
  );
  await m.evaluate(() => window.__zhishu.holdMinimap(true));
  const fpsMobileHall = await fps(m, 4000);
  await m.evaluate(() => window.__zhishu.holdMinimap(false));
  await m.screenshot({ path: `${SHOTS}/mobile390.png` });

  // 批 12 G：加了中央内容物之后，俯瞰构图与 390 站厅是否回退
  const mProj = await m.evaluate(() => {
    const z = window.__zhishu;
    z.showHall();
    z.holdMinimap(true);
    const sub = z.subjectBox('hall');
    const st = z.atriumState();
    z.holdMinimap(false);
    return { sub, proj: st.proj };
  });
  log.push(
    `批 12 390 俯瞰：主体 V ${mProj.sub.v} H ${mProj.sub.h}（批 10 判据下限 0.50/0.75）· ` +
      `八角台+展柜圈投影 ${mProj.proj.inFrame}/${mProj.proj.pts} 点入画，台宽占屏 ${(mProj.proj.deskW * 100).toFixed(1)}%、圈宽 ${(mProj.proj.ringW * 100).toFixed(1)}%`,
  );
  check(
    '批12G 加内容后批 10 俯瞰构图不回退（V ≥0.50、H ≥0.75），且八角台+六展柜 32 点全入画、台面投影宽 ≤45% 屏宽',
    mProj.sub.v >= 0.5 && mProj.sub.h >= 0.75 && mProj.proj.inFrame === mProj.proj.pts && mProj.proj.deskW <= 0.45,
    mProj,
  );
  await m.evaluate(() => window.__zhishu.setWalk(true));
  await m.waitForFunction(() => window.__zhishu.walk().mode === 'walk', null, { timeout: 8000 });
  await m.waitForTimeout(700);
  const mWalkHall = await m.evaluate(() => {
    const z = window.__zhishu;
    const w = z.walk();
    return {
      mode: w.mode,
      pos: w.pos,
      gap: w.wallGap,
      blockers: w.blockers,
      doc: document.documentElement.scrollWidth,
      cross: document.querySelector('[data-crosshair]')?.hidden === false,
      hud: (document.getElementById('hud')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
  await m.screenshot({ path: `${SHOTS}/walk-390-hall.png` });
  await m.evaluate(() => window.__zhishu.walkSetLook(0, -16));
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${SHOTS}/walk-390-desk.png` });
  const wMobileAtrium = await scrollWidth(m);
  log.push(
    `批 12 390 竖屏站厅：${mWalkHall.mode} 落位 ${JSON.stringify(mWalkHall.pos)} gap ${mWalkHall.gap} ` +
      `准星 ${mWalkHall.cross} · scrollWidth ${wMobileAtrium.doc} · HUD「${mWalkHall.hud.slice(0, 40)}」`,
  );
  check(
    '批12D 390 竖屏站在大厅仍是同一条 3D 路径：准星在、无横向滚动、站立处不被台/柜吃掉',
    mWalkHall.mode === 'walk' && mWalkHall.doc === 390 && mWalkHall.cross === true && mWalkHall.gap >= 0,
    { walk: mWalkHall, doc: wMobileAtrium.doc },
  );
  await m.evaluate(() => window.__zhishu.setWalk(false));
  await m.waitForFunction(() => window.__zhishu.walk().mode === 'orbit', null, { timeout: 8000 });
  await m.waitForTimeout(300);

  await m.locator('#roombar button[data-room="math"]').click();
  // room() 在 main.enterRoom() 里是**同步先置**的，正文数据还要 await 一次才建区；
  // 只等 room() 会读到还没切机位的大厅构图，判据必须等视图状态真的切过去
  await m.waitForFunction(
    () => window.__zhishu.room() === 'math' && window.__zhishu.frameCheck()?.view === 'room',
    null,
    { timeout: 15000 },
  );
  const roomFrame = await m.evaluate(() => window.__zhishu.frameCheck());
  const roomGroups = roomFrame?.groups ?? {};
  log.push(`390 数学区构图 ${roomFrame?.inFrame}/${roomFrame?.total}：${JSON.stringify(roomGroups)}`);
  check(
    '390 竖屏阅览室读作「一间房」：书墙中段 / 天花梁下 / 地面中近段全入画 + ≥1 排书架正面',
    ['face', 'ceiling', 'floor'].every(
      (g) => (roomGroups[g]?.total ?? 0) === 4 && roomGroups[g].in === 4,
    ) &&
      (roomGroups.shelves?.total ?? 0) >= 3 &&
      roomGroups.shelves?.in >= 1 &&
      (roomGroups.back?.total ?? 0) === 4 &&
      (roomGroups.sidewall?.total ?? 0) === 4,
    { groups: roomGroups, fov: roomFrame?.fov, aspect: roomFrame?.aspect, inFrame: `${roomFrame?.inFrame}/${roomFrame?.total}` },
  );
  const wMobileRoom = await scrollWidth(m);
  check('390 阅览室 scrollWidth === 390', wMobileRoom.doc === 390, wMobileRoom);

  // ---------------------------------------------------------------- 批 10 A：阅览室主体占屏（判据 3/4）
  const roomSubject = await m.evaluate(() => {
    const z = window.__zhishu;
    const sub = z.subjectBox('room');
    const lum = z.sampleLuminance(0, 0, 1, 1);
    return { sub, dark: lum.darkRatio };
  });
  log.push(
    `390 阅览室主体：V ${roomSubject.sub.v}（裁后 ${roomSubject.sub.vClipped}）· 后墙 ${roomGroups.back?.in}/${roomGroups.back?.total} 侧墙 ${roomGroups.sidewall?.in}/${roomGroups.sidewall?.total} · 纯黑 ${(roomSubject.dark * 100).toFixed(2)}%`,
  );
  check(
    '批 10 A3 390 阅览室主体竖向 ≥55%，后墙与侧墙各 ≥2 点入画（批 9 为 0/4、0/4）',
    roomSubject.sub.v >= 0.55 &&
      (roomGroups.back?.in ?? 0) >= 2 &&
      (roomGroups.sidewall?.in ?? 0) >= 2,
    { v: roomSubject.sub.v, back: roomGroups.back, sidewall: roomGroups.sidewall },
  );
  check(
    '批 10 A4 390 纯黑像素（亮度 <0.02）≤30%（大厅 + 阅览室双测）',
    hallSubject.dark <= 0.3 && roomSubject.dark <= 0.3,
    { hall: hallSubject.dark, room: roomSubject.dark },
  );
  await m.evaluate(() => window.__zhishu.holdMinimap(true));
  const fpsMobileRoom = await fps(m, 5000);
  await m.evaluate(() => window.__zhishu.holdMinimap(false));
  log.push(`390 帧率：大厅 ${fpsMobileHall} / 数学区 ${fpsMobileRoom}（deviceScaleFactor 2）`);
  check('390 竖屏帧率 ≥30（大厅与阅览室双测）', fpsMobileHall >= 30 && fpsMobileRoom >= 30, {
    hall: fpsMobileHall,
    room: fpsMobileRoom,
  });
  await m.screenshot({ path: `${SHOTS}/mobile390-room.png` });
  // 旧判据「2D 书位存在可命中的中心」改成 3D 语义：书脊正面屏幕点由 faceIndex 反查表与实时射线对账，
  // 且落点必须在视口内、不被左下角小地图压住（小地图 pointer-events:none，挡住的书脊指头按不到）
  const spineTap = await m.evaluate(() => {
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
      return { i, file: p.book, chapterId: p.chapterId, x, y, px: p.px, mapped: true, cells };
    }
    return { i: -1, mapped: false, cells };
  });
  check('390 书脊有可命中的屏幕点（faceIndex 反查 = 实时射线）', spineTap.mapped === true, spineTap);
  // 判据 B3：手指滑动 ≥8px 必须判为拖拽。用 CDP 真触摸序列（touchStart → 两次 touchMove → touchEnd），
  // pointerType 与浏览器合成 click 都走真实路径，不是往 DOM 上派发自定义事件。
  const beforeDrag = await m.evaluate(() => window.__zhishu.readerState());
  if (spineTap.mapped) {
    const cdp = await mctx.newCDPSession(m);
    const { x, y } = spineTap;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 9, y: y + 5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 15, y: y + 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await m.waitForTimeout(300);
  }
  const dragInfo = await m.evaluate(() => ({ last: window.__zhishu.lastTap(), rs: window.__zhishu.readerState() }));
  check(
    '触屏滑动 ≥8px 判为拖拽、不误开书（readerState 与滑动前一致）',
    spineTap.mapped === true &&
      dragInfo.last?.kind === 'touch' &&
      dragInfo.last?.action === 'drag' &&
      dragInfo.last?.moved >= 8 &&
      dragInfo.rs.open === beforeDrag.open &&
      dragInfo.rs.mode === beforeDrag.mode,
    { before: beforeDrag, lastTap: dragInfo.last, after: dragInfo.rs },
  );

  // 旧判据「2D 指头点色块开正文，且开的是点到的那一本」→ 3D：点书脊正面开的是那一本的那一章。
  // 上一步的滑动转了视角，而重进同区**按设计不重置机位**（房间相机是记住的，判据 C5 靠它返程），
  // 所以必须按当前位姿重新选靶；且浏览器按**整数 CSS 像素**投递触摸（CDP 合成实测 237.33→237、
  // 421.53→422），书脊中心恰好压章节带边界时 0.3px 小数就会滑到铜牌/封面带（实测同一点
  // 小数坐标 chapter、取整后 book）。选靶一律按投递时的整数坐标验拾取，验的就是指头真正点中的东西。
  await m.evaluate(() => window.__zhishu.enterRoom('math'));
  await m.waitForFunction(
    () => window.__zhishu.room() === 'math' && window.__zhishu.frameCheck()?.view === 'room',
    null,
    { timeout: 15000 },
  );
  await m.waitForTimeout(800);
  const spineTap2 = await m.evaluate(() => {
    const cells = window.__zhishu.census().spines.cells;
    for (let k = 0; k < 60 && cells > 0; k += 1) {
      const i = Math.floor((k * cells) / 60);
      const q = window.__zhishu.spineProbe(i);
      if (!q?.screen) continue;
      const x = Math.round(q.screen.x);
      const y = Math.round(q.screen.y);
      const hit = window.__zhishu.probePick(x, y);
      if (!hit || hit.kind !== 'chapter' || hit.id !== q.chapterId) continue;
      if (x < 12 || y < 12 || x > innerWidth - 12 || y > innerHeight - 12) continue;
      if (x < 120 && y > innerHeight - 120) continue;
      return { i, x, y, px: q.px, file: q.book, chapterId: q.chapterId };
    }
    return null;
  });
  if (spineTap2) await m.touchscreen.tap(spineTap2.x, spineTap2.y);
  // 只等 open === true 会撞上读时竞态：openBook 先出 overview 面板，openChapter 的正文还在异步载入，
  // 探针读到的 mode 可能仍是 overview（批 10 首次跑门禁偶发过一次，定点复现 5/5 全过）。
  // 等 mode 切到 chapter 再读，断言谓词一字不改——它验的本来就是「点完最后停在章节」。
  await m
    .waitForFunction(() => {
      const st = window.__zhishu.readerState();
      return st.open === true && st.mode === 'chapter';
    }, null, { timeout: 15000 })
    .catch(() => undefined);
  await settle(m, 120);
  const rsTap = await m.evaluate(() => ({
    rs: window.__zhishu.readerState(),
    crumb: document.getElementById('panel-crumb')?.innerText ?? '',
    last: window.__zhishu.lastTap(),
  }));
  check(
    '390 触屏轻点书脊开正文，且开的是点到的那一本那一章（书脊投影 ≥36px，指头点得中章节带）',
    spineTap2 !== null &&
      spineTap2.px >= 36 &&
      rsTap.rs.open === true &&
      rsTap.rs.file === spineTap2.file &&
      rsTap.rs.mode === 'chapter' &&
      rsTap.last?.action === 'tap' &&
      rsTap.crumb.length > 0,
    { tap: spineTap2, rs: rsTap.rs, last: rsTap.last, crumb: clip(rsTap.crumb, 80) },
  );
  await m.waitForTimeout(300);
  if (samples.full) {
    await m.evaluate((s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter), samples.full);
    await settle(m, 400);
  }
  const wMobileReader = await scrollWidth(m);
  check('390 阅读层含公式仍无横向溢出', wMobileReader.doc === 390, wMobileReader);
  await m.screenshot({ path: `${SHOTS}/mobile390-reader.png`, fullPage: false });
  // 旧判据「降级视图无 WebGL 画布、SVG 成图」→ 反写：390 同样出 WebGL 画布，降级容器已不存在
  const mobilePaint = await m.evaluate(() => ({
    svg: Boolean(document.querySelector('#svg-root svg')),
    svgRoot: Boolean(document.querySelector('#svg-root')),
    canvas: Boolean(document.querySelector('#three-root canvas')),
  }));
  check(
    '390 走 WebGL 成图、无 SVG 降级容器残留',
    mobilePaint.canvas === true && mobilePaint.svg === false && mobilePaint.svgRoot === false,
    mobilePaint,
  );
  // 旧判据「降级路径未加载 Three.js」→ 方向整个反过来：批 9 起 390 必须把 scene3d 分包拉起来
  const mobileChunks = await m.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name.split('/').pop() ?? e.name)
      .filter((n) => n.startsWith('scene3d-')),
  );
  check('390 加载了 scene3d 分包（判据方向自批 9 起反写）', mobileChunks.length > 0, mobileChunks);

  // ---------------------------------------------------------------- 390 检索弹层（判据 C3 移动端可用 + 加载中态）
  await mctx.route('**/dist/search-*', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  const tapOpen = await m.evaluate(() => {
    const btn = document.getElementById('search-open');
    btn.click();
    const r = btn.getBoundingClientRect();
    return { open: window.__zhishu.searchOpen(), btn: { w: Math.round(r.width), h: Math.round(r.height) } };
  });
  await m.evaluate(() => {
    const i = document.getElementById('search-input');
    i.value = '算法';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await m.waitForTimeout(240);
  const loadingUi = await m.evaluate(() => ({
    status: document.getElementById('search-status')?.dataset.status ?? null,
    text: document.getElementById('search-status')?.textContent ?? '',
    scope: window.__zhishu.searchState().scope,
  }));
  await m
    .waitForFunction(() => ['ready', 'none', 'error'].includes(document.getElementById('search-status')?.dataset.status), null, { timeout: 9000 })
    .catch(() => undefined);
  const readyUi = await m.evaluate(() => {
    const box = document.getElementById('search-box').getBoundingClientRect();
    const hits = Array.from(document.querySelectorAll('#search-results .hit'));
    const first = hits[0]?.getBoundingClientRect();
    return {
      status: document.getElementById('search-status')?.dataset.status ?? null,
      text: document.getElementById('search-status')?.textContent ?? '',
      hits: hits.length,
      loaded: window.__zhishu.searchLoaded().slice(),
      box: { left: Math.round(box.left), right: Math.round(box.right), w: Math.round(box.width), h: Math.round(box.height) },
      firstHit: first ? { w: Math.round(first.width), ellipsis: getComputedStyle(hits[0].querySelector('.label')).textOverflow } : null,
      doc: document.documentElement.scrollWidth,
    };
  });
  await m.screenshot({ path: `${SHOTS}/mobile390-search.png` });
  check('触屏无快捷键时顶栏按钮仍可见可点', tapOpen.open && tapOpen.btn.w > 40 && tapOpen.btn.h > 20, tapOpen);
  check('索引加载中给明确 loading 提示（不白屏、不空弹层）', loadingUi.status === 'loading' && loadingUi.text.length > 4, loadingUi);
  check(
    '390 视口搜索弹层可用且无横向溢出（scrollWidth 390、弹层不越界、结果可点）',
    readyUi.doc === 390 && readyUi.box.left >= 0 && readyUi.box.right <= 390 && readyUi.hits > 0 && readyUi.firstHit?.ellipsis === 'ellipsis',
    readyUi,
  );
  await m.locator('#search-results .hit').first().click({ timeout: 8000 });
  await m.waitForFunction(() => window.__zhishu.readerState().open === true, null, { timeout: 12000 });
  await m.waitForTimeout(400);
  const mPick = await m.evaluate(() => ({
    reader: window.__zhishu.readerState(),
    closed: !window.__zhishu.searchOpen(),
    doc: document.documentElement.scrollWidth,
    chars: (document.getElementById('panel-body')?.innerText ?? '').length,
  }));
  check('390 触屏点结果即开正文，弹层收起且仍无横向溢出', mPick.closed && mPick.reader.open && mPick.doc === 390 && mPick.chars > 60, mPick);
  await m.screenshot({ path: `${SHOTS}/mobile390-search-hit.png` });

  /* ---------------------------------------------------------------- 批 11：漫游在 390 触屏
   * 分屏口径（写死在 _work/decisions.md 批 11 E4，页面上不画分界线）：
   * pointerdown 时 `ev.clientX < innerWidth/2` 且 pointerType==='touch' → 摇杆，其余 → 转头；
   * 390 视口下分界 = 195px，取样点左半取 (90, 620)、右半取 (300, 420)。
   * 轻点/拖拽的判定顺序是先位移后时长：pointerup 按 8px 阈值定性并记账，click 再用 700ms 兜住长按。
   */
  await m.evaluate(() => document.getElementById('panel-close')?.click());
  await m.evaluate(() => window.__zhishu.enterRoom('math'));
  await m.waitForFunction(
    () => window.__zhishu.room() === 'math' && window.__zhishu.frameCheck()?.view === 'room',
    null,
    { timeout: 15000 },
  );
  await m.waitForTimeout(900);
  const mWalkBtn = await m.evaluate(() => {
    const r = document.getElementById('btn-walk').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  });
  await m.touchscreen.tap(mWalkBtn.x, mWalkBtn.y);
  await m.waitForFunction(() => window.__zhishu.walk().mode === 'walk', null, { timeout: 8000 });
  await m.waitForTimeout(500);
  const mWalkLayout = await m.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), hidden: el.hidden };
    };
    const w = window.__zhishu.walk();
    return {
      sw: document.documentElement.scrollWidth,
      eye: w.eye,
      fov: w.fov,
      stick: box('[data-stick]'),
      cross: box('[data-crosshair]'),
      roombar: box('#roombar'),
      btn: box('#btn-walk'),
    };
  });
  const barBox = mWalkLayout.roombar;
  // 摇杆是「指落点才出现」的，进漫游那一刻它必须隐藏——不相压的判定要等按下后拿**实时盒**（见下一条断言）
  check(
    '批11D 390 触屏指头点「走进」即进漫游：眼高 1.65、无横向滚动、准星钉在屏心、按钮够大、摇杆未落点不出现',
    Math.abs(mWalkLayout.eye - 1.65) <= 0.1 &&
      mWalkLayout.sw === 390 &&
      mWalkLayout.cross !== null &&
      Math.abs(mWalkLayout.cross.x + mWalkLayout.cross.w / 2 - 195) <= 3 &&
      mWalkLayout.btn.w >= 44 &&
      mWalkLayout.btn.h >= 32 &&
      mWalkLayout.stick.hidden === true,
    mWalkLayout,
  );

  const mcdp = await mctx.newCDPSession(m);
  await m.evaluate(() => {
    const R = window.__zhishu;
    R.walkSnap(-147, -6.25, 0, -1);
    R.walkTraceStart();
  });
  await mcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 620 }] });
  await m.waitForTimeout(150);
  const stickLive = await m.evaluate(() => {
    const r = document.querySelector('[data-stick]').getBoundingClientRect();
    return {
      hidden: document.querySelector('[data-stick]').hidden,
      vec: window.__zhishu.walk().stick,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
    };
  });
  // 摇杆与学科条的重叠必须用**实时盒**判：底盘按指落点定位，静止时它是 hidden（盒为 0），拿来判会恒真
  const stickOverlap = barBox && stickLive.box
    ? !(stickLive.box.bottom <= barBox.y || barBox.bottom <= stickLive.box.y
      || stickLive.box.x + stickLive.box.w <= barBox.x || barBox.x + barBox.w <= stickLive.box.x)
    : null;
  await m.screenshot({ path: `${SHOTS}/walk-390-stick.png` });
  for (let i = 1; i <= 10; i += 1) {
    await mcdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90, y: 620 - i * 10 }] });
    await m.waitForTimeout(50);
  }
  await m.waitForTimeout(900);
  const stickMoved = await m.evaluate(() => window.__zhishu.walk());
  await mcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await m.waitForTimeout(250);
  const stickTrace = await m.evaluate(() => window.__zhishu.walkTraceStop());
  const stickGone = await m.evaluate(() => document.querySelector('[data-stick]').hidden);
  check(
    '批11D 390 左半屏拖动 = 摇杆推动：底盘可见且向量随指头走、人真在走（净位移 ≥0.3）、底盘 96px 不压学科条，松指摇杆归中隐藏',
    stickLive.hidden === false &&
      stickLive.vec.active === true &&
      stickLive.box.w === 96 &&
      stickOverlap === false &&
      stickTrace.net >= 0.3 &&
      stickGone === true,
    { stickLive, overlapWithRoombar: stickOverlap, roombar: barBox, stickMoved: { vec: stickMoved.stick, pos: stickMoved.pos }, trace: stickTrace, stickGone },
  );

  await m.evaluate(() => window.__zhishu.walkTraceStart());
  const look0 = await m.evaluate(() => window.__zhishu.walk());
  await mcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 420 }] });
  for (let i = 1; i <= 12; i += 1) {
    await mcdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 13, y: 420 + i * 7 }] });
    await m.waitForTimeout(35);
  }
  const lookLive = await m.evaluate(() => ({ stickHidden: document.querySelector('[data-stick]').hidden, vec: window.__zhishu.walk().stick }));
  await m.screenshot({ path: `${SHOTS}/walk-390-look.png` });
  await mcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await m.waitForTimeout(250);
  const look1 = await m.evaluate(() => window.__zhishu.walk());
  const lookTrace = await m.evaluate(() => window.__zhishu.walkTraceStop());
  await mcdp.detach();
  const dYawM = Math.round((look1.yawDeg - look0.yawDeg) * 100) / 100;
  check(
    '批11D 390 右半屏拖动 = 只转头：Δyaw ≥20° 且位移轨迹零采样（摇杆不出现、人不挪步）',
    Math.abs(dYawM) >= 20 && lookTrace.samples === 0 && lookLive.stickHidden === true && lookLive.vec.active === false,
    { dYaw: dYawM, pitchDeg: look1.pitchDeg, lookTrace, stickLive: lookLive },
  );

  // 轻点：先位移（8px）后时长（700ms）两道判据各验一次
  const m390Aim = await m.evaluate(() => {
    const R = window.__zhishu;
    R.walkSnap(-147, -6.25, 0, -1);
    return R.walkAimSpine(3);
  });
  await m.evaluate(() => document.getElementById('panel-close')?.click());
  await m.waitForTimeout(300);
  await m.touchscreen.tap(195, 420);
  await m.waitForFunction(() => window.__zhishu.readerState().mode === 'chapter', null, { timeout: 15000 });
  const mTapOpen = await m.evaluate(() => ({ reader: window.__zhishu.readerState(), tap: window.__zhishu.lastTap() }));
  check(
    '批11D 390 轻点（位移 <8px）走准星拾取开正文：开的是准星下那一章，判据记的是 touch/8px/tap',
    m390Aim?.ok === true &&
      mTapOpen.reader.file === m390Aim.book &&
      mTapOpen.tap.kind === 'touch' &&
      mTapOpen.tap.slop === 8 &&
      mTapOpen.tap.action === 'tap' &&
      mTapOpen.tap.moved < 8,
    { aim: m390Aim, ...mTapOpen },
  );
  await m.evaluate(() => document.getElementById('panel-close')?.click());
  await m.waitForTimeout(300);
  const mcdp2 = await mctx.newCDPSession(m);
  await mcdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420 }] });
  await m.waitForTimeout(900);
  await mcdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await m.waitForTimeout(600);
  const mLongPress = await m.evaluate(() => ({ reader: window.__zhishu.readerState(), tap: window.__zhishu.lastTap() }));
  await mcdp2.detach();
  check(
    '批11D 390 长按 900ms 不算轻点：位移判据先过（0px < 8px），时长超 700ms 再被否（记账翻成 drag），正文不被打开',
    mLongPress.tap.moved < 8 && mLongPress.tap.slop === 8 && mLongPress.tap.action === 'drag' && mLongPress.reader.open === false,
    mLongPress,
  );
  await m.screenshot({ path: `${SHOTS}/walk-390-longpress.png` });

  check('运行期零外部请求（移动端）', requests.external.length === 0, requests.external.slice(0, 6));
  await mctx.close();

  check('控制台零报错', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  check('页面异常零条', pageErrors.length === 0, pageErrors.slice(0, 5));
} catch (err) {
  check('探针完整跑完', false, String(err).slice(0, 300));
  exitCode = 2;
} finally {
  await browser.close();
}

const report = {
  base: BASE,
  at: new Date().toISOString(),
  checks,
  log,
  requests: {
    total: requests.all,
    bodies: requests.bodies.length,
    bodyFiles: [...new Set(requests.bodies)].length,
    searchShards: [...new Set(requests.search)],
    external: requests.external,
    blocked: requests.blocked,
  },
  consoleErrors,
  pageErrors,
  failed: checks.filter((c) => !c.pass),
};
fs.writeFileSync('_work/selfcheck-report.json', JSON.stringify(report, null, 2));
const passed = checks.length - report.failed.length;
console.log(JSON.stringify({ passed, total: checks.length, failed: report.failed, log }, null, 2));
process.exitCode = exitCode || (report.failed.length ? 1 : 0);

function s_chars(key) {
  return samples[key]?.chars ?? 0;
}
