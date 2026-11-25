import type { Discipline } from './types';

export interface RoomSpec {
  key: Discipline;
  title: string;
  short: string;
  color: string;
  /** 阅览室中心在大厅平面坐标（八角方向 × ROOM_DIST） */
  at: [number, number];
  /** 出厅方向（弧度，x=cos、z=sin）：八角厅门洞与走廊都按这个角摆放 */
  angle: number;
}

// 批 8 把六区钉在八角厅的六条边上：八条边取六个方向，剩下 0° 与 225° 两面做壁画墙。
// 方位语义沿用 docs/design.md：数学西、计算机西南、AI 南、化学东南、工具间东北、通识北。
const DOOR_ANGLES: Record<Discipline, number> = {
  math: Math.PI,
  cs: (Math.PI * 3) / 4,
  ai: Math.PI / 2,
  chem: Math.PI / 4,
  tools: -Math.PI / 4,
  general: -Math.PI / 2,
};

export const ROOM_DIST = 150;

function roomAt(angle: number): [number, number] {
  return [
    Math.round(Math.cos(angle) * ROOM_DIST * 100) / 100,
    Math.round(Math.sin(angle) * ROOM_DIST * 100) / 100,
  ];
}

export const ROOMS: RoomSpec[] = (
  [
    { key: 'math', title: '数学', short: '数学', color: '#4a6cf7' },
    { key: 'ai', title: 'AI 人工智能', short: 'AI', color: '#25c2a0' },
    { key: 'chem', title: '化学与食品', short: '化学', color: '#e05a47' },
    { key: 'cs', title: '计算机', short: '计算机', color: '#e0a83a' },
    { key: 'general', title: '通识', short: '通识', color: '#8b95a8' },
    { key: 'tools', title: '工具间', short: '工具', color: '#6b7688' },
  ] as Array<Omit<RoomSpec, 'at' | 'angle'>>
).map((r) => {
  const angle = DOOR_ANGLES[r.key];
  return { ...r, angle, at: roomAt(angle) };
});

export const ROOM_BY_KEY: Record<Discipline, RoomSpec> = ROOMS.reduce(
  (acc, r) => Object.assign(acc, { [r.key]: r }),
  {} as Record<Discipline, RoomSpec>,
);

export const HALL_LABEL = '中央大厅';
export const BG = '#12141a';
export const FLOOR = '#0e1015';

/** 世界尺度约定：1 单位 ≈ 25 cm，房间尺寸由此取得日常阅读室的观感 */
export const HALL_SIDES = 8;
/** 八角厅内切圆半径（墙面到中心） */
export const HALL_RADIUS = 44;
export const HALL_HEIGHT = 22;
/** 无门的两面墙（壁画墙）角度 */
export const HALL_MURAL_ANGLES = [0, (Math.PI * 5) / 4];

export const DOOR_W = 13;
export const DOOR_H = 15;
export const CORRIDOR_W = 10;
export const CORRIDOR_H = 12;
export const WALL_T = 1.2;

export const ROOM_HEIGHT = 15;
/** 书架：沿墙一整排算「一排」，一排内横向分若干层 */
export const SHELF_DEPTH = 2.6;
export const SHELF_HEIGHT = 12;
export const SHELF_BOARD = 0.24;
/** 书位分隔板与书与书之间的缝 */
export const SLOT_GAP = 0.62;
/** 书脊宽度包络（按该书章数归一化，章多的书每册更厚、占位更宽） */
export const SPINE_W_MIN = 0.42;
export const SPINE_W_MAX = 0.72;
/** 书脊高 = 层高净空 × 0.86–1.0 错落 */
export const BOOK_H_JITTER: [number, number] = [0.86, 1];
/**
 * 图集一页 2048²，一格 64×320，一页 32 列 × 6 行 = 192 格 → 每区 1–3 页（即 1–3 个 draw call）。
 * 首版按 1024²/32×160 出图，特写里 11px 字号被放大十几倍糊成竖纹，读不出书名（判据 5）；
 * 页数与格数一个没动，只把每格的像素密度提到 4 倍，显存 3 页共 50MB 只在桌面 3D 路径上发生。
 */
export const ATLAS_SIZE = 2048;
export const CELL_W = 64;
export const CELL_H = 320;
/** 竖排书名截断长度（图集格高 160 / 字号 13 ≈ 12 字） */
export const SPINE_TITLE_MAX = 12;

/**
 * 六区书架形态（批 8 取代批 7 的立柱形态）：一区一种檐口与侧板语言，几何类型 ≥3。
 * crown 山花檐口 / arch 拱券顶 / pediment 断山花 / tower 高塔格 / chest 矮柜双列 / scroll 卷书顶
 */
export type ShelfKind = 'crown' | 'arch' | 'pediment' | 'tower' | 'chest' | 'scroll';
/** 门楣牌匾形制：一区一种 */
export type PlaqueKind = 'round' | 'shield' | 'scroll' | 'board' | 'arch' | 'diamond';

export const SHELF_KINDS: Record<Discipline, ShelfKind> = {
  math: 'arch',
  ai: 'tower',
  chem: 'crown',
  cs: 'chest',
  general: 'pediment',
  tools: 'scroll',
};

export const PLAQUE_KINDS: Record<Discipline, PlaqueKind> = {
  math: 'round',
  ai: 'shield',
  chem: 'scroll',
  cs: 'board',
  general: 'arch',
  tools: 'diamond',
};

/** 是否该走 2D 降级：触屏或窄视口（铁律 4） */
export function prefersFlatView(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 768;
  const forced = new URLSearchParams(location.search).get('flat');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return coarse || narrow;
}
