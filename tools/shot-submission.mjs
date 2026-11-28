import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'docs/submission/shots';

const browser = await chromium.launch({ executablePath: EDGE });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__zhishu && typeof window.__zhishu.setWalk === 'function', null, { timeout: 90000 });
await page.waitForTimeout(2400);

await page.evaluate(() => window.__zhishu.setWalk(true));
await page.waitForTimeout(900);

const shot = async (name, x, z, yaw, pitch) => {
  await page.evaluate(([x, z, yaw, pitch]) => {
    window.__zhishu.walkSnap(x, z, 0, 1);
    window.__zhishu.walkSetLook(yaw, pitch);
  }, [x, z, yaw, pitch]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}` });
  const pose = await page.evaluate(() => window.__zhishu.walkPose());
  console.log(name, JSON.stringify(pose));
};

// 02 走廊往里看（yaw 180 = 朝 +z）
await shot('02-走廊书廊.png', 0, 66, 180, -2);
// 03 星空顶
await page.evaluate(() => window.__zhishu.walkSnap(0, -6, 0, 1));
await page.evaluate(() => window.__zhishu.walkSetLook(160, 42));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/03-星空顶.png` });
// 04 走廊尽头正门
await shot('04-正门.png', 0, 124, 180, -2);
// 05 进入 AI 阅览室内部
await page.evaluate(() => window.__zhishu.enterRoom('ai'));
await page.waitForTimeout(1800);
await shot('05-阅览室.png', 0, 148, 180, 4);
// 06 书架近景
await shot('06-书架近景.png', 0, 162, 180, 2);
// 07 侧门（房间内 0.6 米后的侧墙门）
await shot('07-侧门.png', 0, 148, 90, 2);
await browser.close();
