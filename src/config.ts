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

/** 窄视口判定：批 9 起只用于画质档位，不再决定是否走 2D（2D 路径已删除） */
export const NARROW_VW = 768;

export function isNarrowViewport(): boolean {
  return window.innerWidth < NARROW_VW;
}

/**
 * 画质档位：全端只有 3D 一条路径，移动端靠降档而不是换视图保帧率。
 * 三档开关集中在这里，`scene3d` 与 `spacekit` 只读结果，不散落在各 build 函数。
 */
export interface QualityTier {
  /** 档名，进 census 供断言读取 */
  name: 'desktop' | 'mobile';
  dprCap: number;
  /** null = 关阴影；否则为 shadowMap 边长 */
  shadowMapSize: number | null;
  /** 光尘实例上限（0 = 不建光尘） */
  dustBudget: number;
  bloom: boolean;
  bloomScale: number;
  /** 房间帧缓冲缩放 */
  renderScale: number;
}

const DESKTOP_TIER: QualityTier = {
  name: 'desktop',
  dprCap: 2,
  shadowMapSize: 2048,
  dustBudget: Number.POSITIVE_INFINITY,
  bloom: true,
  bloomScale: 0.65,
  renderScale: 0.85,
};

/**
 * 窄屏档：全端只有 3D 一条路径，移动端靠降画质而不是换视图保帧率。
 * 光尘与 bloom 是窄屏上最贵的两项（加法混合大 quad 吃 fillrate、bloom 多级降采样），
 * 阴影在关掉 bloom 后仍要一整张 shadow map 的重绘，所以窄屏连阴影一起关。
 */
const MOBILE_TIER: QualityTier = {
  name: 'mobile',
  dprCap: 1.5,
  shadowMapSize: null,
  dustBudget: 220,
  bloom: false,
  bloomScale: 0.5,
  renderScale: 0.72,
};

export function qualityTier(): QualityTier {
  return isNarrowViewport() ? MOBILE_TIER : DESKTOP_TIER;
}

/**
 * 竖屏构图自适应：PerspectiveCamera 的 fov 是**垂直**张角，水平张角 = 2·atan(tan(fov/2)·aspect)。
 * 390×844 的 aspect 只有 0.46，沿桌面那套 fov 时水平视野被压到十几度，
 * 八角厅六门横向铺到 ±157.5°，默认机位进来只装得下正对的一面，走廊与邻区体量全出画；
 * 阅览室也一样，装不下三面墙就看不出「房间」。故 fov 与初始距离都按 aspect 自适应。
 * 判据不靠肉眼，走 `Matrix3d.frameCheck()` 把关键结构点投到 NDC 数在画内的比例。
 */
export const HALL_FOV_MIN = 56;
export const HALL_FOV_MAX = 76;
/**
 * 阅览室横屏下限取批 8 的常量 fov 56：52 也能装下三面墙，但代价是把机位沿门墙法线退到门外
 * （need 随 tan 涨），退出去之后画面上部三分之一变成墙与天花的空场——构图是「装全了」，
 * 观感却成了娃娃屋。56 时 need 落在门墙内侧，画面仍是三面书架铺满，与批 8 同形。
 */
export const ROOM_FOV_MIN = 56;
export const ROOM_FOV_MAX = 76;

/** aspect 低于此值按竖屏处理（390×844 = 0.462，平板竖屏 0.75，桌面 1.6） */
export const PORTRAIT_ASPECT = 0.9;

/** aspect → 自适应量在 [0,1] 上的位置：aspect ≥1 取 0（桌面横屏，一切按批 8 基线），≤0.55 取 1（竖屏） */
export function aspectRamp(aspect: number): number {
  return Math.min(1, Math.max(0, (1 - aspect) / (1 - 0.55)));
}

/** aspect → 垂直 fov：aspect 1 → min、0.55 → max，中间线性、两端饱和 */
export function fovForAspect(min: number, max: number, aspect: number): number {
  return min + (max - min) * aspectRamp(aspect);
}
