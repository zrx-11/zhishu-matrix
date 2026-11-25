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

/** 是否该走 2D 降级：触屏或窄视口（铁律 4） */
export function prefersFlatView(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 768;
  const forced = new URLSearchParams(location.search).get('flat');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return coarse || narrow;
}
