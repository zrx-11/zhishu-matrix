/**
 * 批 8 图集与文字纹理：书脊图集（一格一章，按书连续分块）、门楣牌匾、走廊地面铭牌、大厅地面总览图。
 * 全部 canvas 现画，不落地任何图片文件（铁律 2）。
 *
 * 图集布局约定：1024² 一页、格 32×160（=书脊世界尺寸 1:5 的纵横比），每页 32 列 × 6 行 = 192 格。
 * 同一本书的章按枚举顺序连续取格，装满一行自动换列、装满一页自动翻页——这就是任务书说的
 * 「按书分块、块内按章分段、放不下按列续块」。翻页数 = 书脊 draw call 数（每区 ≤3）。
 */
import * as THREE from 'three';
import {
  ATLAS_SIZE,
  CELL_H,
  CELL_W,
  ROOMS,
  SPINE_TITLE_MAX,
  type PlaqueKind,
} from './config';
import type { Discipline } from './types';

const SERIF = 'Georgia, "Source Han Serif SC", "Songti SC", SimSun, serif';
const SANS = '"Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
/** 一格能放多少章：192 格 / 页，页上限 3 → 每区 576 章，实测最多的是 AI 450 章 */
export const CELLS_PER_PAGE = (ATLAS_SIZE / CELL_W) * Math.floor(ATLAS_SIZE / CELL_H);
export const MAX_PAGES = 3;
/**
 * 画格内部一律用 32×160 的「逻辑坐标」书写，落笔时整体 scale 到真实格。
 * 这样 ATLAS_SIZE 提密度时字号、金线、铜牌带全部等比变清晰，不用逐处改像素常量。
 */
const CELL_SX = CELL_W / 32;
const CELL_SY = CELL_H / 160;
/** 铜牌带高（逻辑 22px），顶部面 UV 与章号都指这条带 */
const PLAQUE_BAND = 22 * CELL_SY;
/** 侧面色块边长（逻辑 20px） */
const SW_SIDE = 20 * CELL_SX;

export interface SpineCell {
  /** 该格所在图集页（= 该 spine 属于哪个 draw call） */
  page: number;
  /** 书脊正面 UV（已按 1 texel 内缩，防接缝渗色） */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 顶部铜牌 UV（格内上沿 22px 带） */
  p0: number;
  pv0: number;
  p1: number;
  pv1: number;
}

/** 皮革侧面色块：册子的侧面/背面不单独画格，从页底的色条带里取一小块同色区域 */
export interface SwatchUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface SpineBookSpec {
  /** 一本「书」在图集里的一段：连续章格 + 同一个皮革底色 */
  color: string;
  title: string;
  /** 与 chapters 等长：铜牌上的章号 */
  chapters: string[];
}

export interface SpineAtlas {
  /** 展平后的章格，顺序 = 入参书序 × 章序，与 layout.spines 的 cell 下标一致 */
  cells: SpineCell[];
  /** 每本书在其章所涉的每一页上各有一个色块 */
  swatches: SwatchUV[];
  textures: THREE.CanvasTexture[];
  pages: number;
}

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas 2d 不可用');
  return { c, g };
}

function finish(c: HTMLCanvasElement, aniso = 4): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  tex.userData.procedural = true;
  return tex;
}

/** 皮革色：从学科色派生，同区同色系、逐本抖色相与明度，读作一排不同年份的装帧 */
export function leatherColor(color: string, seed: number): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  const jitter = ((seed * 2654435761) % 1000) / 1000;
  const h = (hsl.h + (jitter - 0.5) * 0.1 + 1) % 1;
  const s = Math.min(0.62, 0.28 + hsl.s * 0.42 + jitter * 0.1);
  // 批 9 C3：明度带从 0.16–0.30 提到 0.27–0.39（提一档）。原来的深底在近黑室内被 PBR 的光照
  // 一乘，渲染值只剩贴图值的三成，竖排小字无论怎么描边都读不出；先把底子抬起来才谈得上反差。
  const l = 0.27 + (((seed * 40503) % 137) / 137) * 0.12;
  return `#${new THREE.Color().setHSL(h, s, l).getHexString()}`;
}

/**
 * 书脊字口：象牙白字落在一条暗色「题签」底板上。
 *
 * 批 8 用金棕 `#e7cd8c` 直接写在深皮革上，三米外糊成一片；批 9 先把皮革提亮一档，结果反差
 * 反而更糟——提亮后 sRGB 亮度到 0.13–0.53（AI 的青绿最亮），白字掉到 1.6 倍。真正的图书馆
 * 装帧本来也不是「字直接写在皮上」，而是贴一条题签：所以改成暗底板 + 亮字，皮革亮度与字口
 * 反差这两件事就解耦了，各区都能到 4.5 以上。
 */
export const SPINE_INK = '#f7f2e4';
export const SPINE_PLATE = { hex: '#0c0f16', alpha: 0.86 };
const SPINE_INK_EDGE = 'rgba(6, 8, 12, 0.85)';
/**
 * 批 10 C1：题签从「几乎满脊长的一条黑」改成书脊正中的一块贴皮标签。
 * 逻辑格 32×160 内：宽 20（=脊宽 62.5%，落在任务书 60–65% 区间），长 76（47.5%）；
 * 上下各留出一整段装帧纹样——深色带 23–29 / 148–160、双金线 33/41 与 136/142、菱形 46/130，
 * 全部落在底板之外，渲染后两端都能看见。字号随之从 12 收到 7.5（9 字书名 67.5px 正好放进
 * 68px 内区），特写机位下字高约 20px，仍可读。参数与截图采样双证见 scene3d.spinePlateProbe。
 */
export const SPINE_PLATE_RECT = { x: 6, y: 50, w: 20, h: 76, radius: 2.5 } as const;
const SPINE_TITLE_FONT = `700 7.5px ${SERIF}`;

/** 字轴处（格子横向中点）那道高光渐变的实际叠加量：0.42→0.6 之间线性插值到 α≈0.033 的白 */
const SPINE_HILITE_ALPHA = 0.06 * (1 - (0.5 - 0.42) / (0.6 - 0.42));

/** 题签底板按 alpha 压在皮革上、再被中点高光洗过之后的实际颜色（判据算的就是这个色，不是 plate 本身的色） */
function spinePlateOver(base: string): string {
  const c = new THREE.Color(base);
  const p = new THREE.Color(SPINE_PLATE.hex);
  const a = SPINE_PLATE.alpha;
  const over = (v: number, w: number) => v * (1 - a) + w * a;
  const lite = (v: number) => v * (1 - SPINE_HILITE_ALPHA) + 1 * SPINE_HILITE_ALPHA;
  return rgbHex(lite(over(c.r, p.r)), lite(over(c.g, p.g)), lite(over(c.b, p.b)));
}

/**
 * 判定口径：字色 SPINE_INK（fillText 全不透明，取纯色）与「题签底板压在皮革上、再被字轴处
 * 高光渐变洗过」的合成色之间的 WCAG 2.x 相对亮度比，(L_hi + 0.05) / (L_lo + 0.05)。
 * 底板覆盖字轴整条竖列，所以它是字的真实背景；横向渐变在格子中点只剩 α≈0.033 的白，
 * 只作用在底板上（字是全不透明绘制的）。金属凸线与菱形不在字轴上，不计入读数。
 * 每本算一次、每区取最小值，门槛断言读这个 min ≥ 4.5。
 */
export function spineInkContrast(base: string): number {
  return Math.round(contrastRatio(SPINE_INK, spinePlateOver(base)) * 100) / 100;
}

function rgbHex(r: number, g: number, b: number): string {
  const f = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/** sRGB 相对亮度（WCAG 2.x：线性化后 0.2126R + 0.7152G + 0.0722B） */
function relLuminance(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 一格书脊：底色 → 横向渐变（两侧压暗）→ 上下深色带 → 四道金色横线 + 阴影 → 首尾菱形 →
 * 竖排书名（rotate(-π/2)）→ 顶部铜牌与章号。层次顺序照 `_work/refs/codex-library/components/Scene.tsx`
 * L61–137 的 createSpineTexture，改动见 `_work/decisions.md` 借鉴清单。
 */
function drawSpineCell(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  title: string,
  chapterLabel: string,
): void {
  const w = CELL_W / CELL_SX;
  const h = CELL_H / CELL_SY;
  const gold = '#c9a24a';
  const goldDark = '#6f5417';
  g.save();
  g.beginPath();
  g.rect(x, y, CELL_W, CELL_H);
  g.clip();
  g.translate(x, y);
  g.scale(CELL_SX, CELL_SY);

  g.fillStyle = color;
  g.fillRect(0, 0, w, h);

  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.06)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // 铜牌带（顶面 UV 指这里）
  g.fillStyle = '#5a4415';
  g.fillRect(0, 0, w, 22);
  g.fillStyle = gold;
  g.fillRect(0, 20, w, 2);
  g.fillStyle = goldDark;
  g.fillRect(0, 22, w, 1);
  g.font = `700 13px ${SERIF}`;
  g.fillStyle = '#f0dca6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(chapterLabel, w / 2, 11);

  // 书脊上下深色带 + 四道金色凸线 + 首尾菱形（批 10：全部落在题签之外，两端可见）
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.fillRect(0, 23, w, 6);
  g.fillRect(0, h - 12, w, 12);
  for (const band of [33, 41, h - 24, h - 18]) {
    g.fillStyle = gold;
    g.fillRect(0, band, w, 2);
    g.fillStyle = goldDark;
    g.fillRect(0, band + 2, w, 1);
  }
  g.fillStyle = gold;
  for (const cy of [46, h - 30]) {
    g.beginPath();
    g.moveTo(w / 2, cy - 4);
    g.lineTo(w / 2 + 4, cy);
    g.lineTo(w / 2, cy + 4);
    g.lineTo(w / 2 - 4, cy);
    g.closePath();
    g.fill();
  }

  // 题签底板 + 竖排书名：底板先压住金线（像真书上一条贴皮标签），再落亮字，
  // 边缘用更暗的一圈把题签与皮革分开（批 9 C3）；批 10 收成 62.5% 宽的中段标签
  const pl = SPINE_PLATE_RECT;
  const plate = new THREE.Color(SPINE_PLATE.hex);
  g.fillStyle = `rgba(${Math.round(plate.r * 255)}, ${Math.round(plate.g * 255)}, ${Math.round(plate.b * 255)}, ${SPINE_PLATE.alpha})`;
  g.beginPath();
  g.roundRect(pl.x, pl.y, pl.w, pl.h, pl.radius);
  g.fill();
  g.strokeStyle = 'rgba(201, 162, 74, 0.35)';
  g.lineWidth = 1;
  g.stroke();

  // 先按字数截，再按实测宽度收进题签长度——只按字数截会在宽字（数字、拉丁）下溢出底板
  const inner = pl.h - 8;
  g.font = SPINE_TITLE_FONT;
  let clipped = title.length > SPINE_TITLE_MAX ? title.slice(0, SPINE_TITLE_MAX) : title;
  if (g.measureText(clipped).width > inner) {
    while (clipped.length > 1 && g.measureText(`${clipped}…`).width > inner) {
      clipped = clipped.slice(0, -1);
    }
    clipped += '…';
  }
  g.save();
  g.translate(w / 2, pl.y + pl.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 1.2;
  g.strokeStyle = SPINE_INK_EDGE;
  g.strokeText(clipped, 0, 0);
  g.fillStyle = SPINE_INK;
  g.fillText(clipped, 0, 0);
  g.restore();

  g.restore();
}

/** 页底色条带：章格占 6 行 × 160 = 960，剩下 64px 给「书侧面」色块，每块 32px，一页 64 个 */
const SWATCH_TOP = Math.floor(ATLAS_SIZE / CELL_H) * CELL_H;
const SWATCH_SLOTS = (ATLAS_SIZE / CELL_W) * ((ATLAS_SIZE - SWATCH_TOP) / CELL_W);

/** 建本区书脊图集：入参按书分块（书序 × 章序），返回章格 UV、书色块 UV 与 1–3 张图集页 */
export function buildSpineAtlas(books: SpineBookSpec[]): SpineAtlas {
  const totalCells = books.reduce((sum, b) => sum + b.chapters.length, 0);
  const pages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(totalCells / CELLS_PER_PAGE) || 1));
  const cols = ATLAS_SIZE / CELL_W;
  const canvases: HTMLCanvasElement[] = [];
  const ctxs: CanvasRenderingContext2D[] = [];
  for (let p = 0; p < pages; p += 1) {
    const { c, g } = canvas(ATLAS_SIZE, ATLAS_SIZE);
    // 先铺一层与书脊同色系的中性底，杜绝格边缘 mip 采样吸到透明黑
    g.fillStyle = '#1a1712';
    g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    canvases.push(c);
    ctxs.push(g);
  }
  const cells: SpineCell[] = [];
  const swatches: SwatchUV[] = [];
  const e = 1 / ATLAS_SIZE;
  let slot = 0;
  for (const book of books) {
    const firstPage = Math.min(pages - 1, Math.floor(cells.length / CELLS_PER_PAGE));
    // 侧面色块按「书 × 涉及页」分配；页用尽则退回中性底色区域（读作深色装帧，不影响正面）
    const idx = slot % SWATCH_SLOTS;
    slot += 1;
    const sx = (idx % cols) * CELL_W + 6 * CELL_SX;
    const sy = SWATCH_TOP + Math.floor(idx / cols) * CELL_W + 6 * CELL_SY;
    const g = ctxs[firstPage];
    const sw = g.createLinearGradient(sx, sy, sx + SW_SIDE, sy);
    sw.addColorStop(0, book.color);
    sw.addColorStop(1, '#0d0b08');
    g.fillStyle = sw;
    g.fillRect(sx, sy, SW_SIDE, SW_SIDE);
    g.fillStyle = 'rgba(201,162,74,0.5)';
    g.fillRect(sx, sy + SW_SIDE * 0.3, SW_SIDE, Math.max(1, CELL_SY));
    swatches.push({
      u0: sx * e + e,
      v0: 1 - (sy + SW_SIDE) * e + e,
      u1: (sx + SW_SIDE) * e - e,
      v1: 1 - sy * e - e,
    });
    book.chapters.forEach((label) => {
      const i = cells.length;
      const local = i % CELLS_PER_PAGE;
      const page = Math.min(pages - 1, Math.floor(i / CELLS_PER_PAGE));
      const x = (local % cols) * CELL_W;
      const y = Math.floor(local / cols) * CELL_H;
      drawSpineCell(ctxs[page], x, y, book.color, book.title, label);
      // canvas y 向下、UV v 向上：v 取反后再内缩一个 texel
      const u0 = x * e + e;
      const u1 = (x + CELL_W) * e - e;
      const vTop = 1 - y * e - e;
      const vBottom = 1 - (y + CELL_H) * e + e;
      cells.push({
        page,
        u0,
        v0: vBottom,
        u1,
        v1: vTop,
        p0: u0,
        pv0: 1 - (y + PLAQUE_BAND) * e + e,
        p1: u1,
        pv1: vTop,
      });
    });
  }
  return { cells, swatches, textures: canvases.map((c) => finish(c, 8)), pages };
}

/**
 * 壁画墙：八角厅六门之外的两面实墙，画的是「书架 + 拱券」的剪影而不是文字，
 * 远看有进深、近看不过度抢戏。程序化生成，无图片资产。
 */
export function muralTexture(color: string, seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const { c, g } = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c1712');
  bg.addColorStop(1, '#0b0908');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const rnd = (n: number) => {
    const s = Math.sin((seed + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  // 拱券框
  g.strokeStyle = '#6a552c';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(46, H - 40);
  g.lineTo(46, 190);
  g.quadraticCurveTo(W / 2, 8, W - 46, 190);
  g.lineTo(W - 46, H - 40);
  g.stroke();
  // 假书架三排 + 一排排书脊剪影
  for (let row = 0; row < 3; row += 1) {
    const y = 210 + row * 96;
    g.fillStyle = '#241a11';
    g.fillRect(66, y, W - 132, 78);
    let x = 74;
    let k = 0;
    while (x < W - 84) {
      const w = 9 + Math.floor(rnd(row * 31 + k) * 12);
      const hh = 44 + Math.floor(rnd(row * 17 + k + 5) * 28);
      g.fillStyle = k % 5 === 0 ? `${color}88` : `rgba(${60 + Math.floor(rnd(k + row) * 90)}, ${40 + Math.floor(rnd(k) * 50)}, ${22 + Math.floor(rnd(k + 3) * 30)}, 0.92)`;
      g.fillRect(x, y + 78 - hh, w, hh);
      x += w + 2;
      k += 1;
    }
    g.fillStyle = '#5a4415';
    g.fillRect(66, y + 76, W - 132, 5);
  }
  // 外框金线
  g.strokeStyle = 'rgba(201,162,74,0.55)';
  g.lineWidth = 4;
  g.strokeRect(18, 18, W - 36, H - 36);
  return finish(c, 4);
}

/**
 * 批 17：走廊书廊里的一排书脊。
 *
 * 一个书架单元如果真拿盒子去堆书脊，3 层 × 8 本就是 288 个三角、6 条走廊 108 米长的墙要
 * 五万多个三角，而且书与书之间空 34 厘米，远看是一排悬空的彩色方块。改成一张 512×128 的
 * 程序纹理贴在每层薄板上：单元 6 个三角，书脊紧密成排，纹理横向 repeat 2 次，一本书约 12 厘米。
 * 明度沿用 leatherColor 的 0.27–0.39 带，MeshBasic 直出，不越过 bloom 阈值 0.45。
 */
export function bookRowTexture(color: string, seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 128;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#0a0806';
  g.fillRect(0, 0, W, H);
  const rnd = (n: number) => {
    const s = Math.sin((seed + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  // 底板：书脊坐在这条暖木线上，底下留一条深缝
  const shelfY = H - 9;
  let x = 0;
  let k = 0;
  while (x < W) {
    const w = 12 + Math.floor(rnd(k * 3 + 1) * 15);
    const hh = 58 + Math.floor(rnd(k * 5 + 2) * 52);
    // 每三本就有一本是暖褐暗装帧，不然整面墙是同一片区色，像荧光板不像书
    g.fillStyle = k % 3 === 0 ? leatherColor('#6a5232', seed * 97 + k) : leatherColor(color, seed * 97 + k);
    g.fillRect(x, shelfY - hh, w - 2, hh);
    // 顶面一道暗边，远看就有「一本本立着」的厚度
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, shelfY - hh, w - 2, 3);
    x += w;
    k += 1;
  }
  g.fillStyle = '#2a1d12';
  g.fillRect(0, shelfY, W, H - shelfY);
  // 整排的顶光渐晕：越靠上越暗，书架才有纵深
  const shade = g.createLinearGradient(0, 0, 0, shelfY);
  shade.addColorStop(0, 'rgba(0,0,0,0.9)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0.42)');
  shade.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, shelfY);
  // 再整体压一档：MeshBasic 直出 sRGB，亮度必须停在 bloom 阈值 0.45 以下，
  // 否则走廊里会出现一片发光的书墙（第一版 0.39 明度就泛光了）。
  g.fillStyle = 'rgba(0,0,0,0.34)';
  g.fillRect(0, 0, W, shelfY);
  const tex = finish(c, 4);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

/** 门楣牌匾：区名 + 书目数，形制按区不同（六种轮廓） */export function plaqueTexture(
  kind: PlaqueKind,
  title: string,
  sub: string,
  color: string,
): THREE.CanvasTexture {
  const W = 512;
  const H = 168;
  const { c, g } = canvas(W, H);
  const gold = '#c9a24a';
  g.clearRect(0, 0, W, H);
  g.save();
  g.beginPath();
  const cy = H / 2;
  switch (kind) {
    case 'round':
      g.ellipse(W / 2, cy, W / 2 - 6, H / 2 - 6, 0, 0, Math.PI * 2);
      break;
    case 'shield':
      g.moveTo(12, 10);
      g.lineTo(W - 12, 10);
      g.lineTo(W - 12, H * 0.6);
      g.lineTo(W / 2, H - 8);
      g.lineTo(12, H * 0.6);
      g.closePath();
      break;
    case 'scroll':
      g.moveTo(30, 14);
      g.lineTo(W - 30, 14);
      g.quadraticCurveTo(W - 6, 14, W - 6, cy);
      g.quadraticCurveTo(W - 6, H - 14, W - 30, H - 14);
      g.lineTo(30, H - 14);
      g.quadraticCurveTo(6, H - 14, 6, cy);
      g.quadraticCurveTo(6, 14, 30, 14);
      break;
    case 'arch':
      g.moveTo(16, H - 10);
      g.lineTo(16, cy);
      g.quadraticCurveTo(W / 2, -18, W - 16, cy);
      g.lineTo(W - 16, H - 10);
      g.closePath();
      break;
    case 'diamond':
      g.moveTo(W / 2, 4);
      g.lineTo(W - 8, cy);
      g.lineTo(W / 2, H - 4);
      g.lineTo(8, cy);
      g.closePath();
      break;
    case 'board':
    default:
      g.rect(8, 12, W - 16, H - 24);
      break;
  }
  const wood = g.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#3a2716');
  wood.addColorStop(0.5, '#2a1b0f');
  wood.addColorStop(1, '#1b1108');
  g.fillStyle = wood;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = gold;
  g.stroke();
  g.restore();

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f0dca6';
  g.font = `700 62px ${SANS}`;
  g.fillText(title, W / 2, cy - 12);
  g.fillStyle = `${color}`;
  g.font = `400 30px ${SANS}`;
  g.fillText(sub, W / 2, cy + 40);
  return finish(c, 4);
}

/** 走廊地面铭牌：横长条，字沿走廊走向（判据要求正对视角宽高比 ≥3） */
export function nameplateTexture(title: string, sub: string, color: string): THREE.CanvasTexture {
  const font = 92;
  const probe = canvas(8, 8).g;
  probe.font = `700 ${font}px ${SANS}`;
  const label = `${title} · ${sub}`;
  const W = Math.min(2048, Math.ceil(probe.measureText(label).width) + 64);
  const H = font + 60;
  const { c, g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0, 0, 0, 0.9)';
  g.shadowBlur = 20;
  g.fillStyle = color;
  g.font = `700 ${font}px ${SANS}`;
  g.fillText(label, 30, H / 2);
  return finish(c, 8);
}

/**
 * 大厅地面总览图：八角轮廓 + 六区楔形（区名、书目数）+ 中心罗盘。
 * 圆/八角几何的 UV 铺满贴图外接方框，所以按 1024 正方形画、半径取中心到边。
 */
export function hallPlanTexture(counts: Record<Discipline, number>): THREE.CanvasTexture {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const cx = S / 2;
  const cy = S / 2;
  const R = S / 2 - 8;
  g.fillStyle = '#2b3542';
  g.fillRect(0, 0, S, S);
  // 八角边线
  g.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#3f4c61';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#7a6330';
  g.stroke();
  // 六区楔形：角度与 ROOMS.angle 同源，画在贴图上即「俯视地图」
  for (const r of ROOMS) {
    const a = r.angle;
    // canvas y 向下 = 世界 z 向下，两者符号一致，直接沿用
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R * 0.9, a - 0.3, a + 0.3);
    g.closePath();
    g.fillStyle = `${r.color}88`;
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = r.color;
    g.stroke();
    const px = cx + Math.cos(a) * R * 0.62;
    const py = cy + Math.sin(a) * R * 0.62;
    g.save();
    g.translate(px, py);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e9eef8';
    g.font = `700 44px ${SANS}`;
    g.fillText(r.short, 0, -18);
    g.fillStyle = r.color;
    g.font = `600 32px ${SANS}`;
    g.fillText(`${counts[r.key] ?? 0} 册`, 0, 22);
    g.restore();
  }
  // 中心罗盘
  const disc = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.3);
  disc.addColorStop(0, 'rgba(230, 210, 150, 0.22)');
  disc.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(cx, cy, R * 0.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(cx, cy, R * 0.17, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f0dca6';
  g.font = `700 40px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('中央大厅', cx, cy - 14);
  g.font = `400 26px ${SANS}`;
  g.fillStyle = '#a9b4c8';
  g.fillText('六门通六区', cx, cy + 24);
  return finish(c, 8);
}

/**
 * 批 12 A3：索引台台面 —— 1024² 的六扇区方位图。
 * 扇区边界取 `DESK_SECTORS` 的角平分线，与 `ROOMS[].angle` 同源；canvas 的 (cos a, sin a)
 * 经 uvOf 的 v 翻转后正好是世界 (x, z)，所以「画在哪个角度」= 「指向哪条走廊」，不需要换算。
 * 每扇区印区名 + 书数 + 章数，色用走廊牌匾那套区色；两条壁画墙（0°、225°）正落在扇区缝上。
 */
export interface DeskSectorRow {
  short: string;
  color: string;
  am: number;
  a0: number;
  a1: number;
  books: number;
  chapters: number;
}

export function indexDeskTexture(rows: DeskSectorRow[]): THREE.CanvasTexture {
  const S = 1024;
  const { c, g } = canvas(S, S);
  const cx = S / 2;
  const cy = S / 2;
  const R = S / 2 - 6;
  g.fillStyle = '#1b2028';
  g.fillRect(0, 0, S, S);
  // 八角台面轮廓（顶点在 22.5°+45k，正好落进画布内切八边形）
  g.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  const plate = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  plate.addColorStop(0, '#3c4859');
  plate.addColorStop(0.62, '#313d4d');
  plate.addColorStop(1, '#232c39');
  g.fillStyle = plate;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#c9a24a';
  g.stroke();
  // 刻度圈：每 15° 一道，45° 处加长—— visitor 一眼能把方位角读成罗盘
  for (let k = 0; k < 24; k += 1) {
    const a = (Math.PI / 12) * k;
    const long = k % 3 === 0;
    const r0 = R * (long ? 0.88 : 0.93);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * R * 0.975, cy + Math.sin(a) * R * 0.975);
    g.lineWidth = long ? 5 : 3;
    g.strokeStyle = long ? 'rgba(201,162,74,0.85)' : 'rgba(201,162,74,0.4)';
    g.stroke();
  }
  for (const s of rows) {
    const span = s.a1 - s.a0;
    g.save();
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R * 0.87, s.a0, s.a1);
    g.closePath();
    const wedge = g.createRadialGradient(cx, cy, R * 0.16, cx, cy, R * 0.87);
    wedge.addColorStop(0, `${s.color}20`);
    wedge.addColorStop(1, `${s.color}70`);
    g.fillStyle = wedge;
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = `${s.color}d0`;
    g.stroke();
    // 三条射线从中心打向门向：把「这块扇区通往哪条走廊」画成看得见的箭头
    g.beginPath();
    g.moveTo(cx + Math.cos(s.am) * R * 0.3, cy + Math.sin(s.am) * R * 0.3);
    g.lineTo(cx + Math.cos(s.am) * R * 0.83, cy + Math.sin(s.am) * R * 0.83);
    g.lineWidth = 7;
    g.strokeStyle = s.color;
    g.stroke();
    g.beginPath();
    const tip = R * 0.85;
    for (const da of [-0.06, 0.06]) {
      g.moveTo(cx + Math.cos(s.am) * tip, cy + Math.sin(s.am) * tip);
      g.lineTo(cx + Math.cos(s.am + da + Math.PI * 0.86) * R * 0.74, cy + Math.sin(s.am + da + Math.PI * 0.86) * R * 0.74);
    }
    g.lineWidth = 6;
    g.stroke();
    // 字头朝台心：人站在自己那一侧的台边低头读，这一向才是正立（朝外会把本区读成倒字）
    g.translate(cx + Math.cos(s.am) * R * 0.58, cy + Math.sin(s.am) * R * 0.58);
    g.rotate(s.am - Math.PI / 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 12;
    g.fillStyle = '#f2e9d6';
    g.font = `700 ${span > 1.1 ? 52 : 46}px ${SANS}`;
    g.fillText(s.short, 0, -40);
    g.fillStyle = s.color;
    g.font = `700 ${span > 1.1 ? 38 : 34}px ${SANS}`;
    g.fillText(`${s.books} 本`, 0, 10);
    g.fillStyle = '#cbd6e6';
    g.font = `400 30px ${SANS}`;
    g.fillText(`${s.chapters} 章`, 0, 54);
    g.restore();
  }
  // 中心铜罗盘：不参与拾取，只压住十六道三角缝的汇聚点
  g.beginPath();
  g.arc(cx, cy, R * 0.26, 0, Math.PI * 2);
  const brass = g.createRadialGradient(cx - R * 0.07, cy - R * 0.08, R * 0.02, cx, cy, R * 0.26);
  brass.addColorStop(0, '#6d5b30');
  brass.addColorStop(0.7, '#463a20');
  brass.addColorStop(1, '#2c2414');
  g.fillStyle = brass;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#c9a24a';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f0dca6';
  g.font = `700 40px ${SANS}`;
  g.fillText('六区索引', cx, cy - 16);
  g.font = `400 26px ${SANS}`;
  g.fillStyle = '#b6a678';
  g.fillText('准星选扇区', cx, cy + 22);
  return finish(c, 8);
}

/**
 * 批 10 B1：大厅藻井圈顶板贴图。画布横向 = 一圈方位角（8 条梁缝在 1/8 的整数倍），
 * 纵向 = 从内缘到外缘（0=内、1=外）。16 格 × 2 排，格心深暖褐、格缝近黑，
 * 内缘一排带一点顶光高光——梁是浅木、板是深木，俯视时梁板才分得开。
 */
export function cofferTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#1d160e';
  g.fillRect(0, 0, W, H);
  const cols = 16;
  const rows = 2;
  const cw = W / cols;
  const ch = H / rows;
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const x = i * cw + 3;
      const y = j * ch + 4;
      const w = cw - 6;
      const h = ch - 8;
      g.fillStyle = '#2a2015';
      g.fillRect(x, y, w, h);
      // 格口上沿受光、下沿落影
      g.fillStyle = 'rgba(255, 224, 168, 0.10)';
      g.fillRect(x, y, w, 3);
      g.fillStyle = 'rgba(0, 0, 0, 0.38)';
      g.fillRect(x, y + h - 4, w, 4);
      g.fillStyle = '#201810';
      g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = '#2a2015';
      g.fillRect(x + 5, y + 5, w - 10, h - 10);
    }
    // 每 1/8 一条梁缝（与 45° 一根的径向梁对齐）
    if (i % 2 === 0) {
      g.fillStyle = '#120c07';
      g.fillRect(i * cw - 4, 0, 8, H);
    }
  }
  g.fillStyle = '#171009';
  g.fillRect(0, H / 2 - 3, W, 6);
  // 内缘一排亮一档（光从中心上方下来）
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255, 226, 172, 0.16)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return finish(c, 4);
}
