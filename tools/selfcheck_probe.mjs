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
  await d.goto(`${BASE}/?flat=0`, { waitUntil: 'load' });
  await ready(d);

  check('3D 模式挂载（?flat=0）', (await d.evaluate(() => window.__zhishu.mode)) === 'three');
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
  const lumBase = await d.evaluate(() => window.__zhishu.sampleLuminance(0, 0, 1, 1));
  await d.evaluate(() => window.__zhishu.setPassEnabled('Bloom', false));
  const lumNoBloom = await d.evaluate(() => window.__zhishu.sampleLuminance(0, 0, 1, 1));
  await d.evaluate(() => window.__zhishu.setPassEnabled('Bloom', true));
  log.push(
    `大厅亮度对照：基线 ${lumBase.mean}(p95 ${lumBase.p95}) / 关 bloom ${lumNoBloom.mean}(p95 ${lumNoBloom.p95})`,
  );
  check(
    'bloom 确实改变画面（关掉后整屏亮度统计下降）',
    lumBase.mean - lumNoBloom.mean > 1e-3 && lumBase.p95 - lumNoBloom.p95 > 1e-3,
    { base: lumBase, noBloom: lumNoBloom },
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
    check(
      'KaTeX 字体来自本地 bundle（同源 assets/，无 CDN）',
      info.fonts.length > 0 && info.fonts.every((n) => n.startsWith(BASE)),
      { count: info.fonts.length, first: clip(info.fonts[0]?.replace(BASE, '') ?? '', 60) },
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

  // 运行期零外部请求（路由层已阻断，出现即记录）
  check('运行期零外部请求', requests.external.length === 0, requests.external.slice(0, 6));
  await dctx.close();

  // ---------------------------------------------------------------- 手机 390×844 · 2D 降级
  const { context: mctx, page: m } = await newPage(browser, 'mobile', {
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await m.goto(BASE, { waitUntil: 'load' });
  await ready(m);
  check('390px 触屏自动降级 2D', (await m.evaluate(() => window.__zhishu.mode)) === 'flat');
  const wMobileHall = await scrollWidth(m);
  check('390 大厅 scrollWidth === 390', wMobileHall.doc === 390, wMobileHall);
  await m.locator('#roombar button[data-room="ai"]').click();
  await m.waitForFunction(() => window.__zhishu.room() === 'ai', null, { timeout: 10000 });
  // 平面投影把同一面墙的 6 层书架压到一条线上，靠前的书位中心会被后画的那本盖住，
  // 于是 Playwright 的 locator.click 一直等不到「元素接收事件」而超时。
  // 这里改成真人式指点头，并且只认「命中元素属于哪本书」——顺带核对开正文的就是点到的那本。
  await m.waitForFunction(() => document.querySelectorAll('svg g[data-slug]').length > 0, null, { timeout: 15000 });
  const tap = await m.evaluate(() => {
    const gs = [...document.querySelectorAll('svg g[data-slug]')];
    let self = 0;
    let first = null;
    for (const g of gs) {
      const b = g.getBoundingClientRect();
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      const el = document.elementFromPoint(x, y);
      if (el && el.closest('svg g[data-slug]') === g) {
        self += 1;
        first = first ?? { x, y, slug: g.dataset.slug };
      }
    }
    return first ? { ...first, n: gs.length, self } : { n: gs.length, self };
  });
  check('2D 书位存在可命中的中心（压层后仍有书能被指头点到）', tap.self > 0 && tap.n > 0, tap);
  if (tap.x !== undefined) await m.touchscreen.tap(tap.x, tap.y);
  await m.waitForFunction(() => window.__zhishu.readerState().open === true, null, { timeout: 15000 });
  const rsTap = await m.evaluate(() => window.__zhishu.readerState());
  check('2D 指头点色块开正文，且开的是点到的那一本', rsTap.open === true && rsTap.book === tap.slug, { tap, rs: rsTap });
  await m.waitForTimeout(300);
  if (samples.full) {
    await m.evaluate((s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter), samples.full);
    await settle(m, 400);
  }
  const wMobileReader = await scrollWidth(m);
  check('390 阅读层含公式仍无横向溢出', wMobileReader.doc === 390, wMobileReader);
  await m.screenshot({ path: `${SHOTS}/mobile390-reader.png`, fullPage: false });
  const svgOnly = await m.evaluate(() => ({
    svg: Boolean(document.querySelector('#svg-root svg')),
    canvas: Boolean(document.querySelector('#three-root canvas')),
  }));
  check('降级视图无 WebGL 画布、SVG 成图', svgOnly.svg && !svgOnly.canvas, svgOnly);
  check('降级路径未加载 Three.js', (await m.evaluate(() => window.__zhishu.mode)) === 'flat');

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
