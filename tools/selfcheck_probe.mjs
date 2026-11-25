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

const requests = { all: 0, bodies: [], external: [], blocked: [] };
const consoleErrors = [];
const pageErrors = [];

async function newPage(browser, tag, opts) {
  const context = await browser.newContext(opts);
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith(BASE) || url.startsWith('blob:')) {
      if (url.includes('/bodies/')) requests.bodies.push(`${tag}:${url.split('/').pop()}`);
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

  await d.evaluate(() => window.__zhishu.holdMinimap(true));
  const fpsHall = await fps(d, 10000);
  await d.evaluate(() => window.__zhishu.holdMinimap(false));
  log.push(`大厅 10s 采样 fps = ${fpsHall}`);
  check('大厅 10 秒帧率 ≥45', fpsHall >= 45, fpsHall);

  // 进数学区：立柱 / 光点 / 零正文请求
  await d.locator('#roombar button[data-room="math"]').click();
  await d.waitForFunction(() => window.__zhishu.room() === 'math', null, { timeout: 10000 });
  await d.waitForTimeout(900);
  const nodes = await d.evaluate(() => window.__zhishu.nodeStats());
  const fpsRoom = await fps(d, 5000);
  const triRoom = await d.evaluate(() => window.__zhishu.triangles());
  log.push(`数学区 fps = ${fpsRoom} · 三角面 = ${triRoom} · 立柱 ${nodes?.columns} · 光点 ${nodes?.dots}`);
  check('数学区章节立柱与概念光点已建', nodes.books > 0 && nodes.columns > 0 && nodes.dots > 0, nodes);
  check('分区浏览阶段零正文请求', requests.bodies.length === 0, requests.bodies.slice(0, 5));
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

  // Mermaid 围栏：源码保留 + 明示不引 CDN
  if (samples.mermaid) {
    await d.evaluate((s) => window.__zhishu.openChapterOf({ slug: s.slug, file: s.file }, s.chapter), samples.mermaid);
    await settle(d);
    const m = await d.evaluate(() => ({
      diagrams: document.querySelectorAll('#panel-body .diagram').length,
      cap: document.querySelector('#panel-body .diagram-cap')?.textContent ?? '',
      code: (document.querySelector('#panel-body .diagram pre.code')?.textContent ?? '').length,
    }));
    check(
      'Mermaid 围栏按「源码 + 明示未渲染」处理',
      m.diagrams > 0 && m.cap.includes('Mermaid') && m.code > 20,
      m,
    );
  }

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
  await m.locator('svg g[data-slug]').first().click();
  await m.waitForFunction(() => window.__zhishu.readerState().open === true, null, { timeout: 15000 });
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
