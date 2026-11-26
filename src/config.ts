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

/**
 * 批 12：中央索引台 + 内圈展柜。大厅尺度（半径 44 / 高 22）一字不动——那是批 10 俯瞰构图
 * 的分母；要让 1.65 眼高有落点，只能往中心加内容。尺寸全部挂在 HALL_* 与 ROOMS 上。
 */
export const ATRIUM = {
  /** 台体：八角棱柱，底面直径 8（外接半径 4），台面高 1.1 */
  deskSides: 8,
  deskR: 4,
  /** 台面板：1.02 起、1.1 收面，沿口出一圈 0.22 的檐 */
  deskSlabY: 1.02,
  deskTopY: 1.1,
  deskTopR: 4.22,
  /** 台沿细灯带：贴在台身外侧上沿 */
  bandY0: 0.82,
  bandY1: 0.96,
  bandR: 4.06,
  /** 靠近 6 单位内台面自发光升档并出 HUD 提示 */
  nearR: 6,
  /** 台面扇区内缘：中心留一枚铜罗盘，不参与拾取 */
  sectorR0: 1.15,
  /** 展柜圈：沿内圈半径 18–22 摆六座 */
  caseR: 19,
  /**
   * 每座沿切向偏走廊一侧（负 = 顺时针）。桌面净宽 3 + 人体半径 0.45，
   * 直线通路要求 |caseLean| > 1.5 + 0.45；同时它得让 sight 射线在 25 单位内打得上柜体。
   */
  caseLean: -3.7,
  caseW: 3,
  caseD: 1.2,
  /** 桌面高 1.2：实体柜体 0→1.02 + 台面石板 1.02→1.2 + 亚克力罩 1.2→1.94 */
  caseBodyH: 1.02,
  caseTopY: 1.2,
  hoodTopY: 1.94,
  /** 罩内立 2–3 根真实书脊 */
  caseSpines: 3,
  /** 大厅 walk 落位环：贴着台体（半径 4 的圆柱）外沿站定 */
  standR: 4.6,
} as const;

/**
 * 索引台扇区：把台面按「离哪条走廊最近」切成六块，边界取相邻门向的角平分线。
 * 这样扇区中心角恒等于 ROOMS[].angle，扇区与走廊对齐是推导出来的，不是手调出来的；
 * 两块扇区之间在两条壁画墙（0°、225°）方向自然留出 22.5° 的空白。
 */
export interface DeskSector {
  key: Discipline;
  /** 扇区中心角 = 该区走廊门向 */
  am: number;
  a0: number;
  a1: number;
}

export const DESK_SECTORS: DeskSector[] = (() => {
  const sorted = [...ROOMS].sort((a, b) => normPi(a.angle) - normPi(b.angle));
  const n = sorted.length;
  return sorted.map((r, i) => {
    // 边界 = 与相邻门向的角平分线。差值必须先归到 (−π, π] 再折半，
    // 否则跨过 ±180° 的那对（通识 −90° 与数学 180°）会取到优弧那一侧。
    const bis = (other: number) => r.angle + normPi(other - r.angle) / 2;
    return {
      key: r.key,
      am: r.angle,
      a0: bis(sorted[(i - 1 + n) % n].angle),
      a1: bis(sorted[(i + 1) % n].angle),
    };
  });
})();

function normPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

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
/** 大厅俯视用的「阅览楼体量」名义边长：进区后才按该区书量算真实房间边长 */
export const FACADE_SIDE = 26;
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

/**
 * 批 10 A1：竖屏大厅机位。
 * 批 8–9 竖屏按「水平装下六区」反解得 (0,294,335)（俯角 41.4°），六个阅览室确实全在，
 * 但投影包围盒只占画面纵向 31%，上下各留一大块死黑。批 10 换成「站到 AI 走廊上空近看」：
 * 水平距离 260、俯角 64°，近处的 AI 门签压到画面下缘、远端通识门签顶到上缘，
 * 包围盒纵向实测 67%；横向再靠 lensKx 1.55 的压缩把 ±150 的六区宽度收进 390 屏
 * （不压缩就得把机位推到 500 单位外，纵向立刻掉回 30% —— 窄屏的水平/垂直是一对死结）。
 * 所有数字都是 390×763 画布上的实测值，口径见 _work/decisions.md 批 10 A 节。
 */
export const HALL_PORTRAIT = {
  /** 机位到原点的水平距离 */
  dist: 260,
  /** 俯角（弧度）：机位高度 = dist × tan(pitch) */
  pitch: (64 * Math.PI) / 180,
  /** 横向镜头压缩上限（aspect ≤0.55 时取满） */
  lensMax: 0.55,
} as const;

/**
 * 批 10 A2：竖屏阅览室的横向镜头压缩上限。
 * 机位不能退——书脊屏高 36px 是「指头点得中章节带」的硬线（批 9 卡在 37–40px）；
 * 退机位或加 fov 都会把书脊压到 30px 以下。只压横向：aspect 0.545 时 Kx=1.55，
 * 后墙四角 NDC 1.13 → 0.73、侧墙远端 1.45 → 0.94，背墙 4/4、侧墙 2/4 入画。
 */
export const ROOM_LENS_MAX = 0.55;

/**
 * 批 11：第一人称漫游。世界尺度 1 单位 ≈ 25 cm（见 HALL_SIDES 上方注释），
 * 所以下面每个数都能换算回日常尺寸，不是「手感调出来的魔法数」。
 */
export const WALK = {
  /**
   * 眼高 1.65 单位 = 1.65 m 的人眼高（常规层高 2.6–3 m 的读数）。
   * 房间 side 20 / height 15、书架 5 层总高 ≈11.6：站在 1.65 处正好平视最下一排书脊
   * （首层板 0.42 + 书高 ≈1.6 → 书心 1.2，抬头读上面几层），换成 5 或 8 会把书架顶压到头上。
   */
  eye: 1.65,
  /** 站立身高（碰撞柱顶），只用于竖直通带判定 */
  stand: 1.85,
  /** 步速 3.2 单位/秒：房间宽 20，横穿约 6 秒 */
  speed: 3.2,
  /** Shift 疾走倍率 */
  sprint: 1.8,
  /** 圆柱碰撞半径 0.45 单位 ≈ 45 cm 肩宽的一半 */
  radius: 0.45,
  /** 俯仰限幅 ±70°：不到 90° 就不可能出现万向锁翻转 */
  pitchMax: (70 * Math.PI) / 180,
  /** 转头灵敏度：每 CSS 像素 0.0052 弧度（转 90° 需拖 302px，一屏宽正好半圈） */
  lookPerPx: 0.0052,
  /** 轻点最长按压时长：超过即算「按住」而不是「点」——判序永远是先位移后时长 */
  tapMaxMs: 700,
  /** 摇杆：把手拖出该半径才算移动（占 48px 行程的 1/4） */
  stickDead: 0.18,
  stickPx: 48,
} as const;

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
