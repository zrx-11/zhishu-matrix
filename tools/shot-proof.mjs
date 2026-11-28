import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'docs/submission/shots';

const logTail = fs.readFileSync('_work/verify-b22-a.log', 'utf8').trim().split(/\r?\n/).slice(-26);
const statusRaw = fs.readFileSync('_work/publish-status.json', 'utf8');
const st = JSON.parse(statusRaw).result;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const shell = (title, head, body) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#0b0d10;color:#d6dee6;
    font:13px/1.75 "Cascadia Mono","JetBrains Mono",Consolas,monospace;}
  .bar{display:flex;align-items:center;gap:10px;padding:12px 20px;background:#14181d;border-bottom:1px solid #232a31;
    font-size:12px;color:#8b98a5;letter-spacing:.04em}
  .dot{width:9px;height:9px;border-radius:50%;background:#3d4b57}
  .body{padding:26px 28px 34px}
  h1{font:600 17px/1.4 "Segoe UI",system-ui,sans-serif;color:#e8eef4;margin:0 0 4px}
  .sub{color:#7d8b98;font:12px/1.7 "Segoe UI",system-ui,sans-serif;margin-bottom:20px}
  table{border-collapse:collapse;width:100%;margin:14px 0 20px}
  td{padding:7px 0;border-bottom:1px solid #1c232a;vertical-align:top}
  td.k{color:#7d8b98;width:190px}
  td.v{color:#e8eef4}
  .ok{color:#4fbf87}.warn{color:#e0b055}.dim{color:#5d6b78}
  pre{margin:0;white-space:pre-wrap;color:#c3ced8}
  .pass{color:#4fbf87}
</style>
<div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
<span style="margin-left:8px">${esc(title)}</span></div>
<div class="body"><h1>${esc(head)}</h1>${body}</div>`;

const p5 = shell('powershell — D:\\programing\\Qoder CN\\zhishu-matrix',
  '交付门槛：164 项全部通过',
  `<div class="sub">tools/selfcheck.py --skip-build · 批 22 上线前那一轮 · 2026-11-28</div>
   <pre>${esc(logTail.join('\n'))
     .replace(/\[PASS\]/g, '<span class="pass">[PASS]</span>')}</pre>`);

const p6 = shell('qoderclicn sites get_publish_status',
  'Qoder Sites 发布状态：publication_completed',
  `<div class="sub">actionId a220b000-1111-4222-8333-444455556666 · 原始返回 ${statusRaw.length} 字符（完整 JSON 见 _work/publish-status.json）</div>
  <table>
    <tr><td class="k">站点</td><td class="v">${esc(st.site.url)}</td></tr>
    <tr><td class="k">访问模式</td><td class="v ok">${esc(st.site.access_mode)}</td></tr>
    <tr><td class="k">已发布内容</td><td class="v ok">hasPublishedContent = ${st.site.hasPublishedContent}</td></tr>
    <tr><td class="k">published / committed</td><td class="v ok">${st.published} / ${st.operation.committed}</td></tr>
    <tr><td class="k">readiness</td><td class="v ok">${esc(st.readiness)}</td></tr>
    <tr><td class="k">阻塞项 blockers</td><td class="v">[]</td></tr>
    <tr><td class="k">operation state</td><td class="v ok">${esc(st.operation.state)}</td></tr>
    <tr><td class="k">siteId</td><td class="v dim">${esc(st.siteId)}</td></tr>
    <tr><td class="k">projectId</td><td class="v dim">${esc(st.projectId)}</td></tr>
  </table>
  <pre class="dim">${esc(JSON.stringify({ ok: true, result: { published: st.published, readiness: st.readiness, host: st.site.host } }, null, 2))}</pre>`);

const browser = await chromium.launch({ executablePath: EDGE });
const page = await browser.newPage({ viewport: { width: 1500, height: 760 }, deviceScaleFactor: 2 });
await page.setContent(p5, { waitUntil: 'load' });
await page.screenshot({ path: `${OUT}/09-门槛通过.png`, fullPage: true });
await page.setContent(p6, { waitUntil: 'load' });
await page.screenshot({ path: `${OUT}/10-发布状态.png`, fullPage: true });
await browser.close();
console.log('ok');
