import type { Discipline } from './types';

export interface RoomSpec {
  key: Discipline;
  title: string;
  short: string;
  color: string;
  /** 大厅俯视平面坐标：x 向东为正，z 向南为正 */
  at: [number, number];
}

// 分区沿用 docs/sites.md 的六学科分组，位置沿用 docs/design.md 第二节：
// 数学左翼、AI 正厅、化学东南、计算机西侧、通识北侧、工具间东北角
export const ROOMS: RoomSpec[] = [
  { key: 'math', title: '数学', short: '数学', color: '#4a6cf7', at: [-190, -10] },
  { key: 'ai', title: 'AI 人工智能', short: 'AI', color: '#25c2a0', at: [0, 95] },
  { key: 'chem', title: '化学与食品', short: '化学', color: '#e05a47', at: [175, 120] },
  { key: 'cs', title: '计算机', short: '计算机', color: '#e0a83a', at: [-175, 125] },
  { key: 'general', title: '通识', short: '通识', color: '#8b95a8', at: [0, -150] },
  { key: 'tools', title: '工具间', short: '工具', color: '#6b7688', at: [215, -140] },
];

export const ROOM_BY_KEY: Record<Discipline, RoomSpec> = ROOMS.reduce(
  (acc, r) => Object.assign(acc, { [r.key]: r }),
  {} as Record<Discipline, RoomSpec>,
);

export const HALL_LABEL = '中央大厅';
export const BG = '#12141a';
export const FLOOR = '#0e1015';

/**
 * 六区立柱形态（批 7 阶段 C）：一区一种，几何类型 ≥3。
 * 语义按学科取形——数学连续、AI 注意力六边形、化学锥形瓶、计算机比特块、通识叠层、工具刻度环。
 */
export type ColumnKind = 'cylinder' | 'hexPrism' | 'coneTower' | 'boxPillar' | 'stackedDrum' | 'ringColumn';
export type PodiumKind = 'disc' | 'step' | 'ring';

export const COLUMN_KINDS: Record<Discipline, ColumnKind> = {
  math: 'cylinder',
  ai: 'hexPrism',
  chem: 'coneTower',
  cs: 'boxPillar',
  general: 'stackedDrum',
  tools: 'ringColumn',
};

export const PODIUM_KINDS: Record<Discipline, PodiumKind> = {
  math: 'disc',
  ai: 'step',
  chem: 'ring',
  cs: 'step',
  general: 'disc',
  tools: 'ring',
};

/** 展台竖向堆叠：底座 + 台面，立柱从二者之上起算（概念光点顶也按这个走） */
export const PODIUM_H = 1.1;
export const PLAT_H = 1.4;
export const COLUMN_BASE = PODIUM_H + PLAT_H;
/** 立柱高度包络：按该书章节数归一化后夹取，39 章的极端书也戳不到天花板 */
export const COLUMN_H_MIN = 3.4;
export const COLUMN_H_MAX = 11.2;

/** 是否该走 2D 降级：触屏或窄视口（铁律 4） */
export function prefersFlatView(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 768;
  const forced = new URLSearchParams(location.search).get('flat');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return coarse || narrow;
}
