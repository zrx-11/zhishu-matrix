import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { BookRecord, Discipline, ManifestIndex, SiteEntry } from './types';
import {
  ATLAS_SIZE,
  ATRIUM,
  BG,
  CORRIDOR_H,
  CORRIDOR_W,
  DOOR_W,
  FACADE_DOOR,
  FACADE_PORCH,
  FACADE_SIDE,
  HALL_FOV_MAX,
  HALL_FOV_MIN,
  HALL_HEIGHT,
  HALL_PORTRAIT,
  HALL_RADIUS,
  HALL_SIDES,
  PLAQUE_KINDS,
  ROOMS,
  ROOM_BY_KEY,
  ROOM_DIST,
  ROOM_FOV_MAX,
  ROOM_FOV_MIN,
  ROOM_HEIGHT,
  ROOM_LENS_MAX,
  SHELF_DEPTH,
  SHELF_HEIGHT,
  SHELF_KINDS,
  WALK,
  WALL_T,
  aspectRamp,
  fovForAspect,
  qualityTier,
  type QualityTier,
} from './config';
import {
  buildEnvironment,
  buildLightRig,
  buildPostChain,
  glowTexture,
  rugTexture,
  stoneTexture,
  sharedTextures,
  wallTexture,
  woodTexture,
  type EnvironmentBundle,
} from './spacekit';
import {
  bookRowTexture,
  buildSpineAtlas,
  cofferTexture,
  hallPlanTexture,
  indexDeskTexture,
  leatherColor,
  muralTexture,
  nameplateTexture,
  plaqueTexture,
  SPINE_INK,
  type SpineAtlas,
  spineInkContrast,
} from './atlas';
import { planRoom, type BookSlot, type RoomPlan, type SpinePlacement } from './layout';
import {
  hallBlockers,
  resolveSlide,
  roomBlockers,
  settle,
  wallGap,
  type Blocker,
  type CorridorAxis,
} from './walk';
import {
  ROOM_DOOR,
  SPINE_FACE,
  TILE,
  GeoBuilder,
  buildAtrium,
  buildCorridor,
  buildHall,
  buildRoomShell,
  buildShelves,
  buildSpines,
  unitBox,
  type SpinePage,
  type Vec3,
} from './architecture';
import type { CameraPose } from './state';

const KEY_SPEED = 20; // 世界单位/秒：1 单位 ≈ 25 cm，走一步约 0.5 秒
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
/** 悬停 120ms 才浮出 tooltip：扫过即闪的标签比没有标签更干扰阅读 */
const TIP_DELAY_MS = 120;
/**
 * 雾按视图切换：大厅俯视机位到原点约 500 单位，批 7 的 (210,620) 会把画面压掉七成——
 * 批 8 的区体量不再有大色块兜底，俯视直接黑成空场。大厅用远雾保层次，进区换回近雾。
 */
const HALL_FOG: [number, number] = [420, 1500];
const ROOM_FOG: [number, number] = [210, 620];
/**
 * 大厅默认俯视线：批 7 是 (0,330,380)，那时六区是 60 单位大的彩色体量，远点也压得住画面；
 * 批 8 换成 26 单位的阅览室体量后收到 (0,232,264)，俯角 atan(232/264) = 41.4°。
 * 批 9 起这条线只定义**姿态**，距离按 aspect 沿它推远（见 hallPose），桌面档正好落回原点。
 */
const HALL_TILT: [number, number] = [232, 264];
const HALL_TILT_LEN = Math.hypot(HALL_TILT[0], HALL_TILT[1]);
/** 桌面俯角：批 8/9 那一条线的仰角，竖屏档从这里插值到 HALL_PORTRAIT.pitch */
const HALL_PITCH = Math.atan2(HALL_TILT[0], HALL_TILT[1]);
/**
 * 俯视要装下的半宽：阅览室中心 150 + 体量半宽 13 + 门廊凸出与余量。
 * 大厅地面 quad 铺到 ±360，那是背景而不是构图对象，不进这条账。
 */
const HALL_SPAN = 178;
/**
 * 点书脊的位移容忍：触屏 8px（任务书 B3 硬线：滑动 ≥8px 必须判为拖动）、鼠标 6px。
 * 阈值取「大于等于即判拖动」，所以 8px 那一格也算拖动。
 */
const TAP_SLOP_TOUCH = 8;
const TAP_SLOP_MOUSE = 6;
/** 批 11：第一人称准星就在屏幕中心，拾取射线固定从 ndc (0,0) 发 */
const CENTER_NDC = new THREE.Vector2(0, 0);
/** 走位时每帧把 controls.target 摆在 eye 前方这么多单位，LOD / 小地图朝向都读它 */
const WALK_AHEAD = 8;

/**
 * 批 18：阅览室互通的侧门、短廊与触发。尺寸沿用世界尺度（1 单位 ≈ 25 cm），
 * 门宽 3.2 / 高 4.6 与走廊 10 是任务书给的数，其余是配合现有书架与碰撞的推导值。
 */
const NEIGHBOR = {
  w: 3.2,
  h: 4.6,
  /**
   * 批 19：短廊从 10 米收到 6 米。10 米是「进了门还要在黑廊里走十米」，
   * 玩家走到门洞就以为到头了（站点实测反馈「走不进去」），缩到 6 米让门牌一进门就能看清。
   */
  len: 6,
  /** 门洞后沿离房间后墙 0.6；前移 1/3 落在 z 6.2–9.4（side 20），避开正面门与书架前段 */
  rear: 0.6,
  /**
   * 整排书架往房间前方挪的量。书架进深 2.6、侧板厚 0.16：侧排原后沿 = half−4.44，
   * 挪 1.8 后与门框外沿（half−4.2）留 0.24；再少就会被门框插进侧板。
   */
  shelfShift: 1.8,
  /** 短廊尽头门牌的触发半径与落位内缩（从门洞往房间里退 1 米） */
  trigger: 2.5,
  landingIn: 5.2,
  fadeMs: 250,
  /** 冷却是 1.6 s、落地静默 1.2 s：两个都满足才允许下一次触发 */
  cooldownMs: 1600,
  settleMs: 1200,
  /** 主线程被拖住时的兜底：8 s 还没进到目标房间就取消黑场 */
  safetyMs: 8000,
} as const;

/**
 * 批 20：大厅正门（走廊尽头的体量外壳门）走位判定。
 * 门平面固定在外壳正面 `ROOM_DIST − FACADE_SIDE/2 = 137`，与阅览室正门墙同一圈；
 * 门洞净宽走 config 的 FACADE_DOOR.w，判定只用水平距离（门内用房间局部坐标），不发射线。
 * 落位各退 3 米：进房落在门内 3 米，回大厅落在门外 3 米（走廊里），两边都离触发带 ≥1 米。
 */
const FRONT_DOOR = {
  /** 门平面到厅心的径向距离 */
  planeR: ROOM_DIST - FACADE_SIDE / 2,
  /** 厅侧触发半径：站在门前 2 米内 */
  enterR: 2,
  /** 房间侧触发带：正门外 0–1.5 米、横向不超过门洞半宽 */
  exitDepth: 1.5,
  /** 两个方向的落位内缩/外退 */
  dropIn: 3,
  dropOut: 3,
} as const;

/**
 * 批 20：走门时的落位。经 `onPickRoom` / `onShowHall` 交给 main 的
 * `enterRoom` / `showHall`，再由 `rewalkAfterViewSwitch` 落到相机上——
 * 仍是既有那条进出房间通道的第二个参数，不另立一套相机与碰撞逻辑。
 */
export interface WalkLanding {
  x: number;
  z: number;
  yaw: number;
}

interface NeighborDoor {
  /** 环序下一区（ROOMS 顺序循环） */
  to: Discipline;
  /** 门所在侧：+1 = 本地 +X（左墙），−1 = 本地 −X（右墙） */
  side: 1 | -1;
  wall: 'left' | 'right';
  /** 门洞沿本地 z 的前后沿与中心 */
  z0: number;
  z1: number;
  zc: number;
  wallPatch: THREE.BufferGeometry;
  corridor: THREE.BufferGeometry;
  strip: THREE.BufferGeometry;
  floorGlow: THREE.BufferGeometry;
  plate: THREE.BufferGeometry;
  plateLocal: [number, number, number];
  landingLocal: [number, number, number];
  plateWorld: THREE.Vector3;
  landingWorld: THREE.Vector3;
  landingYaw: number;
}

export interface ThreeHooks {
  /** 第二参数（批 20）只在「走路进门」时给出落位；点选/邻区切换不带，仍走原来的默认落位 */
  onPickRoom(discipline: Discipline, landing?: WalkLanding): void;
  /** 批 20：走路出正门回大厅；landing 落在走廊里、脸朝大厅。点顶栏回大厅不带 */
  onShowHall?(landing?: WalkLanding): void;
  onPickBook(discipline: Discipline, book: SiteEntry): void;
  onPickChapter(discipline: Discipline, book: SiteEntry, chapterId: string): void;
  onPickConcept(discipline: Discipline, book: SiteEntry, conceptId: string): void;
  /** 展柜书脊：首章 id 只在书目分片里，大厅不为它预取六片，交给阅读层现取 */
  onFirstChapter?(discipline: Discipline, book: SiteEntry): void;
  onHud(text: string): void;
  onCamera(pose: CameraPose): void;
  /** 阅读层打开或输入框聚焦时让出键盘，WASD 不抢字 */
  inputBusy(): boolean;
  /** 批 11：进出第一人称时通知顶栏按钮改文案 */
  onCamMode?(walk: boolean): void;
}

type Pick = {
  kind: 'room' | 'book' | 'chapter' | 'concept';
  discipline: Discipline;
  book?: SiteEntry;
  id?: string;
  hint: string;
  /** 批 12 台面扇区：DESK_SECTORS 下标，命中即知选的是哪一区 */
  sector?: number;
  /** 批 12 扇区命中要在 HUD 报「数学 · 45 本 · 265 章」，覆盖默认的「进入 X」 */
  title?: string;
};

interface PassLike {
  enabled: boolean;
}

interface BloomLike extends PassLike {
  threshold: number;
  strength: number;
  radius: number;
}

interface ComposerLike {
  render: () => void;
  setSize: (w: number, h: number) => void;
}

export interface MinimapState {
  view: 'hall' | 'room';
  room: Discipline | null;
  camera: { x: number; z: number };
  look: { x: number; z: number };
  zones: Array<{ key: Discipline; short: string; color: string; x: number; z: number; count: number; here: boolean }>;
  books: Array<{ x: number; z: number; level: string }>;
  /** 八角厅与走廊：小地图画出结构而不是六个散点 */
  hall?: { sides: number; radius: number; doors: number[] };
  corridors?: Array<{ key: Discipline; from: number; to: number; width: number; angle: number }>;
  shell?: { x: number; z: number; side: number; angle: number };
}

/** 渲染层 census：门槛断言与取证脚本只读这份数据，不从截图反推 */
/**
 * 本区结构账：walls/ceiling/baseboards/rails 取构建期落好的 shell 统计（合并几何只有一个
 * mesh，按 mesh 数断言「≥3 面墙」会永远为假），seen.* 则证明这些几何确实在场景里可见。
 */
export interface RoomAccount {
  walls: number;
  ceiling: boolean;
  floor: boolean;
  ceilingBeams: number;
  baseboards: number;
  rails: number;
  side: number;
  height: number;
  door: { w: number; h: number };
  seen: { wallMeshes: number; ceilingMesh: boolean; floorMesh: boolean; beamMesh: boolean };
  shelfRows: number;
  tiers: number;
  dividers: number;
}

export interface RenderCensus {
  materials: Record<string, number>;
  litMaterials: number;
  unlitMaterials: number;
  lights: Record<string, number>;
  lightSpec: Array<{
    type: string;
    color: number;
    intensity: number;
    distance: number;
    decay: number;
    castShadow: boolean;
  }>;
  toneMapping: string;
  directionalCastShadow: boolean;
  shadow: { enabled: boolean; type: string; requested: string; mapSize: number; autoUpdate: boolean };
  environment: {
    present: boolean;
    mapping: number;
    renderTargetTexture: boolean;
    halfFloat: boolean;
    pmremMarked: boolean;
  };
  post: { present: boolean; passes: string[]; bloom: { threshold: number; strength: number; radius: number } | null };
  pixelRatio: number;
  /** 批 8：帧缓冲缩放按视图分开（大厅 1.0、室内 0.85），门槛要能读到当前值 */
  renderScale: number;
  fog: { near: number; far: number } | null;
  triangles: { mainPass: number; shadowPass: number; perFrame: number };
  calls: { perFrame: number };
  /** 批 8：书架形态 */
  shelfKinds: Record<Discipline, string>;
  shelfKindsDistinct: number;
  builtShelfKind: string | null;
  builtShelfGeometry: string[];
  shelves: { rows: number; tiers: number; dividers: number; bookcases: number };
  /** 批 8：书脊合并几何与 faceIndex 映射 */
  spines: {
    meshes: number;
    atlasPages: number;
    cells: number;
    chapters: number;
    books: number;
    triangles: number;
    /** 合并几何为非索引：faceIndex 即三角序号，映射表按它下标取 */
    indexed: boolean;
    /** 每页 triRole/triSlot/triChapter/triSpine 长度 == 该页三角数 */
    mapped: boolean;
    /** 每页映射表长度 */
    mapLengths: number[];
  };
  /** 批 8：空间结构 */
  room: RoomAccount;
  hall: { sides: number; doors: number; murals: number; ceilingBeams: number; radius: number; height: number; ground: boolean; facades: number };
  labels: {
    sprites: number;
    domFloating: number;
    tooltip: boolean;
    plaqueTextures: number;
    nameplateTextures: number;
    spineTitles: number;
  };
  dotBillboard: boolean;
  dotCount: number;
  dotTexture: string;
}

export interface SpineProbe {
  index: number;
  book: string;
  chapterId: string;
  chapterIndex: number;
  screen: { x: number; y: number } | null;
  /** 该书脊在屏幕上的投影高度（CSS 像素），竖屏可点性判据 */
  px: number;
  /** 由 faceIndex 反查到的结果（与上面比对即为命中） */
  hit?: { kind: string; book: string; chapterId: string };
}

/** 竖屏构图账：结构关键点投影后落在视锥内的比例，按分组给，避免「总数够但全是地板」 */
export interface FrameCheck {
  view: string;
  fov: number;
  aspect: number;
  points: Array<{ name: string; inFrame: boolean; ndc: [number, number, number] }>;
  inFrame: number;
  total: number;
  groups: Record<string, { in: number; total: number }>;
}

// 10 秒帧率采样窗口要求持续渲染；静止 12 秒后才停循环，交互即恢复
const IDLE_MS = 12000;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** three 的过滤常量是裸数字，报告里换成名字才读得懂（判据也按名字比） */
function filterName(f: number): string {
  return (
    {
      [THREE.NearestFilter]: 'Nearest',
      [THREE.NearestMipmapNearestFilter]: 'NearestMipmapNearest',
      [THREE.NearestMipmapLinearFilter]: 'NearestMipmapLinear',
      [THREE.LinearFilter]: 'Linear',
      [THREE.LinearMipmapNearestFilter]: 'LinearMipmapNearest',
      [THREE.LinearMipmapLinearFilter]: 'LinearMipmapLinear',
    } as Record<number, string>
  )[f] ?? String(f);
}

const UP_Y = new THREE.Vector3(0, 1, 0);
// 漫游逐帧要用到的临时向量：放在模块级避免每帧 new（走一步一次分配 = 帧率抖动源）
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_C = new THREE.Vector3();

/**
 * 批 18：把侧墙那一整块 quad 从墙体几何里摘掉。墙体是 GeoBuilder 拼出的**非索引**三角形，
 * 侧墙四角的 x 全部等于 side*half，按「三点都在该平面」筛选即可；前端门墙与后墙的三角形
 * 只有部分角点落在该平面，不会误伤。返回值是摘掉的三角形数，0 表示没找到（不动几何）。
 */
function cutWallPlane(geo: THREE.BufferGeometry, planeX: number): number {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  if (!pos) return 0;
  const keepP: number[] = [];
  const keepN: number[] = [];
  const keepU: number[] = [];
  let removed = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    let onPlane = true;
    for (let k = 0; k < 3; k += 1) {
      if (Math.abs(pos.getX(i + k) - planeX) > 1e-4) {
        onPlane = false;
        break;
      }
    }
    if (onPlane) {
      removed += 1;
      continue;
    }
    for (let k = 0; k < 3; k += 1) {
      keepP.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      if (nor) keepN.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
      if (uv) keepU.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  if (!removed) return 0;
  geo.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
  if (nor && keepN.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
  if (uv && keepU.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(keepU, 2));
  geo.computeBoundingSphere();
  return removed;
}

/**
 * 侧墙踢脚原本通长，穿过新门洞下沿。踢脚与挂镜线、门框共用一份 trim 几何：
 * 挂镜线在 10.8 高、不进画面下缘，保留；踢脚按「质心贴侧墙且 y<0.7」整段摘掉，
 * 再用同尺寸（h=0.52 / out=0.34，与 architecture 的 trimRun 一致）补两段到门洞两侧。
 * 合并回同一份几何，材质与 mesh 数都不变；合并失败就保留原踢脚（人能走，只是门槛下有道矮线）。
 */
function trimWithSideDoor(
  geo: THREE.BufferGeometry,
  side: 1 | -1,
  half: number,
  z0: number,
  z1: number,
): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  if (!pos || !nor || !uv) return geo;
  const planeX = side * half;
  const keepP: number[] = [];
  const keepN: number[] = [];
  const keepU: number[] = [];
  let removed = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < 3; k += 1) {
      cx += pos.getX(i + k) / 3;
      cy += pos.getY(i + k) / 3;
    }
    if (Math.abs(cx - planeX) < 0.5 && cy < 0.7) {
      removed += 1;
      continue;
    }
    for (let k = 0; k < 3; k += 1) {
      keepP.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      keepN.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
      keepU.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  if (!removed) return geo;
  const kept = new THREE.BufferGeometry();
  kept.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
  kept.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
  kept.setAttribute('uv', new THREE.Float32BufferAttribute(keepU, 2));
  const add = new GeoBuilder();
  const n: Vec3 = [-side, 0, 0];
  for (const [t0, t1] of [[-half, z0], [z1, half]] as Array<[number, number]>) {
    if (t1 - t0 < 1e-3) continue;
    add.slab(
      [side * (half - 0.17), 0.26, (t0 + t1) / 2],
      [0, 0, 1],
      [0, 1, 0],
      n,
      (t1 - t0) / 2,
      0.26,
      0.17,
      TILE.trim,
    );
  }
  const addGeo = add.toGeometry();
  const merged = mergeGeometries([kept, addGeo], false);
  kept.dispose();
  addGeo.dispose();
  if (!merged) return geo;
  geo.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** 门洞所在的侧墙补片：左右两段 + 门楣上段 + 两侧门框 + 门楣横梁（法线全部朝房间里） */
function neighborWallPatch(
  side: 1 | -1,
  half: number,
  height: number,
  z0: number,
  z1: number,
): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const n: Vec3 = [-side, 0, 0];
  const panel = (t0: number, t1: number, y0: number, y1: number): void => {
    b.quad(
      [side * half, y0, t0],
      [side * half, y0, t1],
      [side * half, y1, t1],
      [side * half, y1, t0],
      [t0 / TILE.wall, y0 / TILE.wall, t1 / TILE.wall, y1 / TILE.wall],
      n,
    );
  };
  panel(-half, z0, 0, height);
  panel(z1, half, 0, height);
  panel(z0, z1, NEIGHBOR.h, height);
  const fx = side * (half - 0.12);
  const X: Vec3 = [1, 0, 0];
  const Y: Vec3 = [0, 1, 0];
  const Z: Vec3 = [0, 0, 1];
  const hw = 0.2;
  b.slab([fx, NEIGHBOR.h / 2, z0 - hw], X, Y, Z, 0.52, NEIGHBOR.h / 2, hw, TILE.trim);
  b.slab([fx, NEIGHBOR.h / 2, z1 + hw], X, Y, Z, 0.52, NEIGHBOR.h / 2, hw, TILE.trim);
  b.slab([fx, NEIGHBOR.h + 0.24, (z0 + z1) / 2], X, Y, Z, 0.52, 0.24, NEIGHBOR.w / 2 + hw, TILE.trim);
  return b.toGeometry();
}

/** 门后短廊：地面 + 顶 + 两侧墙 + 尽头墙。宽高与门洞同，长度 NEIGHBOR.len，尽头封死 */
function neighborCorridor(
  side: 1 | -1,
  half: number,
  z0: number,
  z1: number,
  len: number,
): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const top = NEIGHBOR.h;
  const x0 = side * half;
  const x1 = side * (half + len);
  // 侧墙从门框外沿（0.4）起：门框盒本身已占据 x0..x0+0.4、z0−0.4..z0 那一段，
  // 若两片共面会闪 z-fight；错开 0.4 后接缝正好落在门框见棱的边上
  const xs = x0 + side * 0.4;
  const ux0 = x0 / TILE.floor;
  const ux1 = x1 / TILE.floor;
  const uz0 = z0 / TILE.floor;
  const uz1 = z1 / TILE.floor;
  b.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [ux0, uz0, ux1, uz1], [0, 1, 0]);
  b.quad([x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1], [ux0, uz0, ux1, uz1], [0, -1, 0]);
  const wx0 = xs / TILE.wall;
  const wx1 = x1 / TILE.wall;
  const wy1 = top / TILE.wall;
  b.quad([xs, 0, z0], [x1, 0, z0], [x1, top, z0], [xs, top, z0], [wx0, 0, wx1, wy1], [0, 0, 1]);
  b.quad([xs, 0, z1], [x1, 0, z1], [x1, top, z1], [xs, top, z1], [wx0, 0, wx1, wy1], [0, 0, -1]);
  b.quad(
    [x1, 0, z0],
    [x1, 0, z1],
    [x1, top, z1],
    [x1, top, z0],
    [z0 / TILE.wall, 0, z1 / TILE.wall, wy1],
    [-side, 0, 0],
  );
  return b.toGeometry();
}

/**
 * 侧门的发光门框：门楣一条 + 左右竖边各一条，合并成一个几何。
 *
 * 批 19：原来只有门楣一条 2.4×0.18。阅览室背光、门洞本身是黑的，玩家站在房中央
 * 只看见黑暗里浮着一块门牌，根本认不出那里有门（站点反馈「走不进去」就是没找到门）。
 * 竖边光条把门洞的三条边勾出来，门才在墙上「显形」。
 */
function neighborStrip(side: 1 | -1, half: number, z0: number, z1: number, zc: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const place = (w: number, h: number, y: number, z: number): void => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY((-side * Math.PI) / 2);
    g.translate(side * (half - 0.66), y, z);
    parts.push(g);
  };
  place(3.0, 0.2, NEIGHBOR.h + 0.24, zc);
  const tall = NEIGHBOR.h - 0.2;
  place(0.14, tall, tall / 2, z0 + 0.07);
  place(0.14, tall, tall / 2, z1 - 0.07);
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** 短廊地面的两条导引光带：进门后跟着光走六米就到门牌 */
function neighborFloorGlow(side: 1 | -1, half: number, z0: number, z1: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [z0 + 0.12, z1 - 0.12]) {
    const g = new THREE.PlaneGeometry(NEIGHBOR.len - 0.6, 0.16);
    g.rotateX(-Math.PI / 2);
    g.translate(side * (half + NEIGHBOR.len / 2), 0.04, z);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** 短廊尽头的邻区门牌：复用 plaqueFor 的牌匾纹理，面朝玩家（法线朝房间方向） */
function neighborPlate(side: 1 | -1, half: number, zc: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2.8, 0.95);
  g.rotateY((-side * Math.PI) / 2);
  g.translate(side * (half + NEIGHBOR.len - 0.03), 2.3, zc);
  return g;
}

export class Matrix3D {
  readonly kind = '3d' as const;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ray = new THREE.Raycaster();
  private hall = new THREE.Group();
  private room = new THREE.Group();
  private links = new Map<Discipline, THREE.Group>();
  /** 本区构建物：切区即释放（几何 + 图集 + 材质），不留六区常驻 */
  private roomObjects: THREE.Object3D[] = [];
  private roomGeoms: THREE.BufferGeometry[] = [];
  private roomMats: THREE.Material[] = [];
  private renderScale = 1;
  /** 批 10 A3：当前投影的水平挤压系数（1 = 无变形），供诊断输出与采样口径判断 */
  private lensKx = 1;
  private spineMeshes: THREE.Mesh[] = [];
  private spinePages: SpinePage[] = [];
  private atlas: SpineAtlas | null = null;
  private plan: RoomPlan | null = null;
  private shellStats: { walls: number; ceilingBeams: number; baseboards: number; rails: number; height: number; side: number } | null = null;
  private plaqueTex = new Map<Discipline, THREE.CanvasTexture>();
  private dust: THREE.InstancedMesh | null = null;
  private dotRefs: Array<{ book: SiteEntry; conceptId: string }> = [];
  private dotSeeds: Array<{ pos: THREE.Vector3; size: number }> = [];
  private dotBase = new THREE.Color('#e8ecf4');
  private billboardMat = new THREE.Matrix4();
  private billboardQuat = new THREE.Quaternion();
  private billboardScale = new THREE.Vector3();
  private keyLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private zoneLights: THREE.PointLight[] = [];
  private roomLights: THREE.PointLight[] = [];
  private groundMesh: THREE.Mesh | null = null;
  private hallFloorMesh: THREE.Mesh | null = null;
  /** 批 11 F：漫游近景换掉大厅两块地面的贴图，退出即还原——俯瞰口径一个像素都不动 */
  private walkFloorMat: THREE.MeshStandardMaterial | null = null;
  private walkGroundMat: THREE.MeshStandardMaterial | null = null;
  private orbitHallFloorMat: THREE.MeshStandardMaterial | null = null;
  private orbitGroundMat: THREE.MeshStandardMaterial | null = null;
  private walkTextures: THREE.Texture[] = [];
  private walkMats: THREE.Material[] = [];
  private walkMatPairs: Array<{ mesh: THREE.Mesh; orbit: THREE.Material; walk: THREE.Material }> = [];
  private walkMatsBuilt = false;
  private roomFloor: THREE.Mesh | null = null;
  private facades: THREE.Mesh | null = null;
  private facadeZones: number[] = [];
  private doorPlaques = new Map<Discipline, THREE.Mesh>();
  private nameplates = new Map<Discipline, THREE.Mesh>();
  private corridorMeshes = new Map<Discipline, THREE.Object3D>();
  private corridorNames: string[] = [];
  private envBundle: EnvironmentBundle | null = null;
  private glowTex: THREE.CanvasTexture | null = null;
  private composer: ComposerLike | null = null;
  private composerHandle: EffectComposer | null = null;
  private bloomHandle: UnrealBloomPass | null = null;
  private postList: Array<{ name: string; pass: PassLike }> = [];
  private bloomPass: BloomLike | null = null;
  private tip: HTMLDivElement | null = null;
  private tipTimer = 0;
  private tipKey = '';
  private view: 'hall' | 'room' = 'hall';
  private roomKey: Discipline | null = null;
  private conceptShown: string | null = null;
  private raf = 0;
  private lastActive = performance.now();
  private running = false;
  private disposed = false;
  private readonly shadowRequested = THREE.PCFSoftShadowMap;
  private prevTs = performance.now();
  private frameTimes: number[] = [];
  private downAt = { x: 0, y: 0 };
  private downKind = 'mouse';
  /** 上一次点击判定的实测位移与结论，供门槛断言读（不误开书 = drag 时不派发拾取） */
  private lastTapInfo: { moved: number; slop: number; kind: string; action: 'tap' | 'tap-miss' | 'drag' } | null = null;
  private tier: QualityTier;
  private keys = new Set<string>();
  private lastKeyHint = 0;
  /* ------------------------------------------------- 批 11：第一人称漫游态 */
  /** 'orbit' = 批 2–10 的俯瞰/外部轨道（默认，行为一字不改）；'walk' = 第一人称 */
  private camMode: 'orbit' | 'walk' = 'orbit';
  private walkYaw = 0;
  private walkPitch = 0;
  /** 进入 walk 前的 orbit 位姿，退出时原样还回去（门槛断言「位姿差 ≤0.05」） */
  private orbitReturn: CameraPose | null = null;
  private hallColliders: Blocker[] = [];
  private roomColliders: Blocker[] = [];
  private colliders: Blocker[] = [];
  private crosshair: HTMLDivElement | null = null;
  private stick: HTMLDivElement | null = null;
  private stickKnob: HTMLElement | null = null;
  /** 左半屏摇杆 / 右半屏转头的活动指针 */
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickVec = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private downAtMs = 0;
  /** walk 下每帧一次的准星命中，供 HUD 底部与断言读 */
  private aimHit: Pick | null = null;
  /** WASD 提示抢过一次 HUD，命中文字得重新盖回去 */
  private hudStale = false;
  private sprint = false;
  /** 走位取证：探针按下的键与累计位移，不让它自己算 dt */
  private walkTrace: Array<{ t: number; x: number; y: number; z: number; yaw: number }> = [];
  private walkTracing = false;
  /* ------------------------------------------------- 批 18：阅览室互通（侧门 + 短廊） */
  /** 本区侧门数据；clearRoom 时释放，enterRoom 重算 */
  private neighbor: NeighborDoor | null = null;
  /** 已触发、正在等目标区建好的环序下一区；null = 没有在途切换 */
  private neighborPending: Discipline | null = null;
  private neighborLock = false;
  private neighborCooldownUntil = 0;
  private neighborLandingAt = 0;
  private neighborTimer = 0;
  private neighborSafety = 0;
  private neighborUnlock = 0;
  private neighborFade: HTMLDivElement | null = null;
  /* ------------------------------------------------- 批 20：大厅正门的走路进出 */
  /** 已触发、正在等目标区建好；在这期间 doorTick 不再出第二枪 */
  private frontPending: Discipline | null = null;
  private frontLock = false;
  private frontCooldownUntil = 0;
  private frontLandingAt = 0;
  /** 允许自动走回大厅：走路进房 / 邻区切换，或用户在房内用 F、走进按钮切进漫游；
   *  诊断 API 直调 setWalk / enterRoom（门槛用）不武装，旧检查点语义不变 */
  private frontArmed = false;
  /** 门外触发带被冷却挡住时的记账：计时器一过就切，避免疾走时整段触发带被跳过 */
  private frontExitLatch = false;
  private frontSafety = 0;
  /* ------------------------------------------------- 批 12：中央索引台与展柜 */
  private deskTop: THREE.Mesh | null = null;
  private deskTopMat: THREE.MeshStandardMaterial | null = null;
  private deskBandMat: THREE.MeshStandardMaterial | null = null;
  private deskLight: THREE.PointLight | null = null;
  /** 逐三角 → DESK_SECTORS 下标，拾取按 faceIndex 直接取（与书脊同一套表机制） */
  private deskTriSector: number[] = [];
  private deskSectors: Array<{ key: Discipline; am: number; a0: number; a1: number }> = [];
  private deskCounts = new Map<Discipline, { books: number; chapters: number }>();
  /** 准星当前压住的扇区（高亮与 HUD 用），−1 = 没有 */
  private aimSector = -1;
  private deskNear = false;
  /** 展柜书脊自成一套 slots/spines 账，但走的是批 8 的 faceIndex 映射与 spineAt */
  private casePlan: { slots: BookSlot[]; spines: SpinePlacement[] } | null = null;
  private casePages: SpinePage[] = [];
  private caseSpineMeshes: THREE.Mesh[] = [];
  /** 展柜柜体逐三角 → 区序号，与台面 triSector 同一套表机制 */
  private caseTriRef: number[] = [];
  private atrium: THREE.Group | null = null;
  private caseBodies: THREE.Mesh | null = null;
  private caseHoodMat: THREE.MeshStandardMaterial | null = null;
  /** 批 14：大厅顶星空天窗的 shader 材质（每帧只更新一个 uTime） */
  private skyMat: THREE.ShaderMaterial | null = null;
  private caseLampMat: THREE.MeshStandardMaterial | null = null;
  /** 六个扇区各一块加法混合楔形，只在准星压住时可见 */
  private sectorHl: THREE.Mesh[] = [];
  private caseStands: Array<{ key: Discipline; angle: number; x: number; z: number }> = [];
  private caseAtlas: SpineAtlas | null = null;
  private sightCache: { content: THREE.Object3D[]; wall: THREE.Object3D[] } | null = null;

  constructor(
    private root: HTMLElement,
    private manifest: ManifestIndex,
    private hooks: ThreeHooks,
  ) {
    this.tier = qualityTier();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.dprCap));
    this.renderer.setClearColor(new THREE.Color(BG), 1);
    // composer 每条 pass 内部都调 renderer.render()，默认自动重置会让 info 只剩最后一条全屏 quad。
    // 关掉自动重置、每帧开头手动 reset，triangles/calls 才是「整帧」口径，改前改后同一把尺。
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = this.tier.shadowMapSize !== null;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 只有相机在动，灯与几何每帧不变 → 阴影按「视图切换」重烘一次
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    root.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(new THREE.Color(BG).getHex(), HALL_FOG[0], HALL_FOG[1]);

    this.envBundle = buildEnvironment(this.renderer);
    this.scene.environment = this.envBundle.texture;

    const rig = buildLightRig();
    this.hemiLight = rig.hemi;
    this.keyLight = rig.key;
    this.zoneLights = rig.zones;
    // 六盏区灯挂在大厅组下：它们照的是俯视时的六栋体量。进区后若仍挂在场景根，
    // 每个 PBR 片元都要多算 6 盏点光——房间面积极大，帧率直接被拖掉一半。
    this.hall.add(...rig.zones);
    this.scene.add(rig.hemi, rig.key, rig.key.target);

    this.glowTex = glowTexture();
    this.buildTip();

    this.camera = new THREE.PerspectiveCamera(
      fovForAspect(HALL_FOV_MIN, HALL_FOV_MAX, window.innerWidth / Math.max(1, window.innerHeight)),
      window.innerWidth / Math.max(1, window.innerHeight),
      0.4,
      1600,
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.rotateSpeed = 0.85;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // 机位要按 maxDistance 收敛，所以放在 controls 配好之后再解一次
    const hall = this.hallPose();
    this.camera.position.set(hall[0], hall[1], hall[2]);

    this.scene.add(this.hall, this.room);
    for (const [key, group] of this.buildLinks()) {
      this.links.set(key, group);
      this.scene.add(group);
    }
    this.buildHall();
    this.buildWalkRig();
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    el.addEventListener('wheel', this.wake, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.start();
  }

  // ---------------------------------------------------------------- 大厅

  private buildHall(): void {
    const counts = {} as Record<Discipline, number>;
    for (const r of ROOMS) counts[r.key] = 0;
    for (const s of this.manifest.sites) counts[s.discipline] = (counts[s.discipline] ?? 0) + 1;

    // 场地图：整个建筑群落在一片地上，不再漂浮于纯黑
    const ground = new THREE.Mesh(
      new GeoBuilder()
        .quad([-360, -0.4, -360], [360, -0.4, -360], [360, -0.4, 360], [-360, -0.4, 360],
          [-360 / 26, -360 / 26, 360 / 26, 360 / 26], [0, 1, 0])
        .toGeometry(),
      new THREE.MeshStandardMaterial({
        map: wallTexture('#141821', '#1d2430', '#101820'),
        // 批 10 B2：实测标定值。地面到处是（十字大厅外的整片场地），批 9 渲染亮度只有 5/255，
        // 390 竖屏里它占掉上半屏与两侧，是「死黑带」的主要来源。乘 1.9 后 7/255 上下：
        // 高于 0.02 暗像素阈值、低于 0.03 的 p5 红线；底色本身很暗，线性反照率仍 <0.06。
        color: new THREE.Color(1.9, 1.9, 1.9),
        roughness: 0.95,
        metalness: 0.04,
        envMapIntensity: 0.25,
      }),
    );
    ground.receiveShadow = true;
    ground.userData.role = 'ground';
    this.groundMesh = ground;
    this.orbitGroundMat = ground.material as THREE.MeshStandardMaterial;
    this.hall.add(ground);

    const built = buildHall(ROOMS.map((r) => r.angle));
    const planTex = hallPlanTexture(counts);
    const floor = new THREE.Mesh(
      built.floor,
      new THREE.MeshStandardMaterial({
        map: planTex,
        roughness: 0.78,
        metalness: 0.08,
        envMapIntensity: 0.4,
        emissiveMap: planTex,
        emissive: 0xffffff,
        // 总览图自发光：贴图本身是深蓝灰（线性值 0.03 量级），给 0.9 让区名与楔形色脱离黑底；
        // 曾试 3.2，结果整块地面被 bloom 糊成一团白光——真正的问题不是亮度而是绕序（见 pitfalls 56）
        emissiveIntensity: 1.0,
      }),
    );
    floor.receiveShadow = true;
    floor.userData.role = 'hallFloor';
    this.hallFloorMesh = floor;
    this.orbitHallFloorMat = floor.material as THREE.MeshStandardMaterial;
    this.hall.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      // 六栋体量外壳用这一张，保持 DoubleSide：俯视要看见六栋「关着的房子」。
      // 批 7 那组深棕（#2a2219）在俯视机位下反照只有 0.18，全糊进黑底；提到中棕才读得出体块。
      map: wallTexture('#4a3c2a', '#6b573c', '#3a2f22'),
      roughness: 0.88,
      metalness: 0.05,
      envMapIntensity: 0.3,
      side: THREE.DoubleSide,
    });
    // 大厅内壁与天花只朝内（法线 = s.inward / 向下），所以是 FrontSide：
    // 用 DoubleSide 时俯视先撞上屋顶，八角形里的地面总览图、吊灯与六个门洞全被盖住。
    const shellMat = new THREE.MeshStandardMaterial({
      map: wallTexture('#4a3c2a', '#6b573c', '#3a2f22'),
      roughness: 0.88,
      metalness: 0.05,
      envMapIntensity: 0.3,
      // 批 14：六盏区灯撤成两盏之后，内壁只吃半球光与一盏方向光，站到 1.65 眼高上是一整片黑。
      // 这里补一层极弱的暖自发光把棕木纹读出来——不能再加灯，加灯会把已经泛白的地面继续洗亮。
      emissive: new THREE.Color('#241a10'),
      emissiveIntensity: 0.55,
    });
    this.hall.add(this.mark(new THREE.Mesh(built.walls, shellMat), 'hallWall', { receiveShadow: true }));
    // 批 10 B1 藻井圈：深色井板 + 顶灯/梁料差出「梁压板」的层次；一圈一 draw
    const coffer = new THREE.Mesh(
      built.coffer,
      new THREE.MeshStandardMaterial({
        map: cofferTexture(),
        roughness: 0.93,
        metalness: 0.03,
        envMapIntensity: 0.18,
      }),
    );
    coffer.receiveShadow = true;
    coffer.userData.role = 'hallCoffer';
    this.hall.add(coffer);
    const mural = new THREE.Mesh(
      built.muralPanels,
      new THREE.MeshStandardMaterial({
        map: muralTexture('#4a6cf7', 7),
        roughness: 0.9,
        metalness: 0.04,
        envMapIntensity: 0.25,
        // 批 14：壁画同理，靠自身微光在暗厅里可读
        emissive: new THREE.Color('#20242e'),
        emissiveIntensity: 0.55,
      }),
    );
    mural.userData.role = 'mural';
    this.hall.add(mural);
    // 批 14：八角顶点立八根壁柱。撤灯后人站在 44 半径的空壳里没有竖向参照，
    // 走两步就觉得是在一块荒地上。柱落在两面墙交界的顶点（半径 R/cos(π/8)=47.6），
    // 不占门面宽度、不挡门洞；柱身/柱础/柱头合成一份几何，只占 1 个 draw。
    const Rv = HALL_RADIUS / Math.cos(Math.PI / HALL_SIDES);
    const pillarGeos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < HALL_SIDES; k += 1) {
      const a = (Math.PI * 2 * k) / HALL_SIDES + Math.PI / HALL_SIDES;
      const px = Math.cos(a) * Rv;
      const pz = Math.sin(a) * Rv;
      const shaftH = HALL_HEIGHT - 2.4;
      const shaft = new THREE.CylinderGeometry(1.05, 1.25, shaftH, 14);
      shaft.translate(px, 1.2 + shaftH / 2, pz);
      pillarGeos.push(shaft);
      const base = new THREE.BoxGeometry(3.1, 1.2, 3.1);
      base.translate(px, 0.6, pz);
      pillarGeos.push(base);
      const cap = new THREE.BoxGeometry(2.9, 1.2, 2.9);
      cap.translate(px, HALL_HEIGHT - 0.6, pz);
      pillarGeos.push(cap);
    }
    const pillarMat = new THREE.MeshStandardMaterial({
      map: wallTexture('#5b462e', '#7d6443', '#3c2f1f'),
      roughness: 0.86,
      metalness: 0.08,
      envMapIntensity: 0.3,
      emissive: new THREE.Color('#2a1c10'),
      emissiveIntensity: 0.5,
    });
    const merged = mergeGeometries(pillarGeos);
    pillarGeos.forEach((g) => g.dispose());
    const pillars = new THREE.Mesh(merged, pillarMat);
    pillars.castShadow = true;
    pillars.receiveShadow = true;
    pillars.userData.role = 'hallPillars';
    this.hall.add(pillars);
    // 批 14：天花板整面换成夜空（深空底 + 三层星点，shader 现算）。批 12 之前的顶是着色板，
    // 站到 1.65 眼高抬头只看到一片被泛光洗亮的褐色——「星空顶」必须自己发光，不能靠别的灯照。
    this.skyMat = this.makeStarMat();
    this.hall.add(this.mark(new THREE.Mesh(built.ceiling, this.skyMat), 'hallCeiling', {}));
    this.hall.add(this.mark(new THREE.Mesh(built.frames, this.brass()), 'hallDoorFrame', { castShadow: true }));

    // 批 10 B1：径向梁加宽一档（0.85→1.6）并带微自发光——俯视 1440 下梁宽才 3–4 像素，
    // 采样框一旦偏移就落进井板；梁料本色也比井板亮，配合顶光把「梁压板」读出来
    const beamMat = this.wood('#332416', 11);
    // 批 15：天花板从倒锥改成水平盘后，梁整条贴在星空底下（21.3 vs 22），
    // 梁与井板的明度差从 8/255 掉到 1/255——梁必须自己亮一点，才能在星空背景上读出「木梁压顶」。
    beamMat.emissive = new THREE.Color(0x3a2515);
    beamMat.emissiveIntensity = 0.95;
    const beams = new THREE.InstancedMesh(unitBox(), beamMat, built.beams.length);
    built.beams.forEach((m, i) => beams.setMatrixAt(i, m));
    beams.instanceMatrix.needsUpdate = true;
    beams.userData.role = 'hallBeams';
    beams.userData.count = built.beams.length;
    this.hall.add(beams);

    this.buildAtriumContent();
    this.buildHallSky();
    this.buildChandelier();
    this.buildFacades(wallMat);
    this.hall.userData.stats = built.stats;
  }

  /**
   * 批 12：中央索引台 + 六座低位展柜。
   * 大厅尺度一字不动（半径 44 / 高 22 是批 10 俯瞰构图的分母），站姿视线的落点靠往中心
   * 加内容挣回来。几何在 `architecture.buildAtrium` 里按 `config.ATRIUM` + ROOMS 的角序生成，
   * 碰撞盒（`walk.atriumBlockers`）读的是同一批数——所见即所撞，不另立尺寸。
   */
  /**
   * 批 14：大厅顶的星空天窗 + 地面同心环。
   * 星空只用一块半径 26 的圆盘贴在顶上（HALL_HEIGHT 下方 0.45），四周藻井梁原样保留——
   * 批 10 的「梁顶明度差 ≥8/255」因此不回退。星星在一个 fragment shader 里按网格 hash 现算，
   * 三层不同密度 + 各自相位闪烁，不引任何贴图/依赖（沿用批 8 的零外部资产约束）。
   * 地面两圈加色环不带碰撞与拾取，只为 1.65 眼高提供「脚下有尺度」的参照。
   */
  /** 星空 shader 只吃一个累加时间量，帧时上限 0.1 防止切后台回来跳一大步 */
  private tickSky(dt: number): void {
    if (this.skyMat) this.skyMat.uniforms.uTime.value += Math.min(dt, 0.1);
  }

  /**
   * 批 14：夜空材质。天花板整面用它，星星在 fragment 里按 uv 网格 hash 现算：
   * 三层不同密度、各自相位闪烁；深空底色抬到 0.05 左右，不压成纯黑（批 10 的 p5 ≤0.03 不能回退）。
   * 不引任何贴图/依赖，沿用批 8 的零外部资产约束。
   */
  private makeStarMat(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWarm: { value: new THREE.Color('#ffe6c8') },
        uCool: { value: new THREE.Color('#cfdcff') },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uWarm;
        uniform vec3 uCool;
        varying vec2 vUv;
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float starLayer(vec2 uv, float freq, float cut, float size, float speed, float seed) {
          vec2 g = uv * freq + seed;
          vec2 id = floor(g);
          vec2 f = fract(g) - 0.5;
          float h = hash21(id);
          if (h < cut) return 0.0;
          float mag = (h - cut) / (1.0 - cut);
          float d = length(f);
          float tw = 0.55 + 0.45 * sin(uTime * (0.7 + h * speed) + h * 91.0);
          return smoothstep(size, 0.0, d) * tw * (0.25 + 0.75 * mag);
        }
        void main() {
          // 频率按「一格里只允许一颗星」往上抬：46/110/210 在近顶视角下每格占屏 20+ 像素，
          // 出来是一团散景光斑而不是星点（实测），这里抬到 170/380/700 并把半径收到 0.1 量级
          float near = starLayer(vUv, 170.0, 0.982, 0.16, 5.0, 0.0);
          float mid = starLayer(vUv, 380.0, 0.962, 0.11, 9.0, 7.3);
          float far = starLayer(vUv, 700.0, 0.9955, 0.18, 3.0, 19.1);
          // 批 16：整片均匀星点看着像贴图。加一条斜向银河：雾状亮带 + 带内多一层密星 + 带外极细尘星
          float ang = 0.52;
          vec2 rv = vec2(vUv.x * cos(ang) - vUv.y * sin(ang), vUv.x * sin(ang) + vUv.y * cos(ang));
          float axis = rv.y - 0.44 - 0.05 * sin(rv.x * 5.2 + 0.7);
          float band = exp(-axis * axis * 120.0);
          float dust = starLayer(vUv, 1150.0, 0.975, 0.075, 12.0, 31.0);
          float dense = starLayer(vUv, 820.0, 0.905, 0.09, 7.0, 53.0) * band;
          float bright = clamp(near * 0.9 + mid * 0.5 + far + dense * 0.55 + dust * 0.3, 0.0, 0.95);
          vec3 col = mix(uCool, uWarm, clamp(far * 1.6 + near * 0.5, 0.0, 1.0));
          // 整面顶即夜空：深空底 0.05 左右（不是纯黑，p5 判据不允许整块掉黑），星点直接加在上面
          vec3 sky = vec3(0.045, 0.055, 0.095);
          // 银河雾：偏冷的紫蓝，亮度压在 0.06 以内（远低于 bloom 阈值 0.45，不会把整屏洗灰）
          sky += band * vec3(0.062, 0.054, 0.098) + band * starLayer(vUv, 240.0, 0.86, 0.22, 4.0, 71.0) * 0.075;
          gl_FragColor = vec4(sky + col * bright, 1.0);
        }
      `,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    return mat;
  }

  /** 批 14：地面两圈加色环，只为 1.65 眼高提供「脚下有尺度」的参照，不带碰撞与拾取 */
  private buildHallSky(): void {
    const grp = new THREE.Group();
    grp.userData.role = 'hallRings';
    for (const [r, o] of [[11, 0.22], [19.5, 0.14]] as Array<[number, number]>) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.18, r + 0.18, 192),
        new THREE.MeshBasicMaterial({
          color: 0xffd9a0,
          transparent: true,
          opacity: o,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.userData.role = 'hallRing';
      grp.add(ring);
    }
    this.hall.add(grp);
  }

  private buildAtriumContent(): void {
    const built = buildAtrium();
    const grp = new THREE.Group();
    grp.userData.role = 'atrium';
    this.atrium = grp;
    this.hall.add(grp);

    // 台面账目：逐区书本数与章数由 manifest 现场累加，抽取器之外不写 data/
    const counts = new Map<Discipline, { books: number; chapters: number }>();
    for (const r of ROOMS) counts.set(r.key, { books: 0, chapters: 0 });
    for (const site of this.manifest.sites) {
      const c = counts.get(site.discipline);
      if (!c) continue;
      c.books += 1;
      c.chapters += site.stats?.chapters ?? 0;
    }
    this.deskCounts = counts;
    this.deskSectors = built.desk.sectors;
    this.deskTriSector = built.desk.triSector;

    grp.add(this.mark(
      new THREE.Mesh(built.desk.body, this.wood('#3a2c1d', 31)),
      'indexDesk',
      { castShadow: true, receiveShadow: true },
    ));
    const deskTex = indexDeskTexture(
      built.desk.sectors.map((sec) => {
        const spec = ROOM_BY_KEY[sec.key];
        const c = counts.get(sec.key) ?? { books: 0, chapters: 0 };
        return {
          short: spec.short,
          color: spec.color,
          am: sec.am,
          a0: sec.a0,
          a1: sec.a1,
          books: c.books,
          chapters: c.chapters,
        };
      }),
    );
    // 台面的可读性靠自发光（厅里没有别的灯照得到 1.1 高的台面），近台再升一档
    this.deskTopMat = new THREE.MeshStandardMaterial({
      map: deskTex,
      emissiveMap: deskTex,
      emissive: 0xffffff,
      emissiveIntensity: 0.34,
      roughness: 0.55,
      metalness: 0.16,
      envMapIntensity: 0.5,
    });
    const top = this.mark(new THREE.Mesh(built.desk.top, this.deskTopMat), 'deskTop', { receiveShadow: true });
    this.deskTop = top;
    grp.add(top);
    this.deskBandMat = new THREE.MeshStandardMaterial({
      color: 0x241a0c,
      roughness: 0.42,
      metalness: 0.45,
      emissive: new THREE.Color('#ffd7a0'),
      emissiveIntensity: 2.2,
    });
    grp.add(this.mark(new THREE.Mesh(built.desk.band, this.deskBandMat), 'deskBand', {}));

    // 扇区高亮楔形：不进拾取清单（进了就会挡在台面前面，反噬拾取本身）
    const hlY = ATRIUM.deskTopY + 0.014;
    const hlR1 = ATRIUM.deskTopR * Math.cos(Math.PI / 8) - 0.16;
    const hlR0 = ATRIUM.sectorR0 + 0.08;
    this.sectorHl = built.desk.sectors.map((sec) => {
      const b = new GeoBuilder();
      const n = Math.max(2, Math.ceil(Math.abs(sec.a1 - sec.a0) / (Math.PI / 24)));
      const pt = (t: number, r: number): Vec3 => [Math.cos(t) * r, hlY, Math.sin(t) * r];
      for (let k = 0; k < n; k += 1) {
        const t0 = sec.a0 + ((sec.a1 - sec.a0) * k) / n;
        const t1 = sec.a0 + ((sec.a1 - sec.a0) * (k + 1)) / n;
        b.quad(pt(t0, hlR0), pt(t1, hlR0), pt(t1, hlR1), pt(t0, hlR1), [0, 0, 1, 1], [0, 1, 0]);
      }
      const mesh = new THREE.Mesh(
        b.toGeometry(),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(ROOM_BY_KEY[sec.key].color),
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.visible = false;
      mesh.userData.role = 'deskSectorHl';
      grp.add(mesh);
      return mesh;
    });

    // 批 13 A3：索引台的点光撤掉。它和第 7 个点光一起把大厅 fillrate 压到 36.2 fps，
    // 而台面的可读性本来就由 emissiveMap 承担（下面 deskTopMat 的自发光 + 台沿灯带），
    // 那盏灯只贡献了一层过曝：`desk-sector.png` 里六个区的字被烧成彩色反光就是这个原因。
    // 字段与 readouts 保留（值为 null / 0），walk 落位与 HUD 不依赖灯的强度。
    this.deskLight = null;

    // 展柜：实心柜体（可拾取）+ 亚克力罩（半透明，不吃射线，否则罩内的脊永远点不到）+ 罩顶自发光条
    this.caseBodies = this.mark(
      new THREE.Mesh(built.cases.body, this.wood('#33281d', 41)),
      'displayCase',
      { castShadow: true, receiveShadow: true },
    ) as THREE.Mesh;
    this.caseTriRef = [...built.cases.triRef];
    grp.add(this.caseBodies);
    this.caseHoodMat = new THREE.MeshStandardMaterial({
      color: 0xd6e3ef,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      envMapIntensity: 0.9,
    });
    const hood = new THREE.Mesh(built.cases.hood, this.caseHoodMat);
    hood.userData.role = 'caseHood';
    grp.add(hood);
    this.caseLampMat = new THREE.MeshStandardMaterial({
      color: 0x2b2417,
      roughness: 0.5,
      metalness: 0.15,
      emissive: new THREE.Color('#ffe7bd'),
      emissiveIntensity: 0.5,
    });
    grp.add(this.mark(new THREE.Mesh(built.cases.lamp, this.caseLampMat), 'caseLamp', {}));
    this.caseStands = built.cases.stands;
    this.buildCaseSpines();
  }

  /**
   * 罩内那 2–3 根书脊：取该区章数最多的前三本（`manifest.sites[].stats.chapters`，一本都不另造）。
   * 图集只给「首章」一格、一页、一个 draw；首章 id 不在 manifest 里（书目分片按区懒取），
   * 所以脊面贴 '首'、点击走 onFirstChapter 由阅读层现取记录再开章——不为大厅预取六个分片。
   */
  private buildCaseSpines(): void {
    const slots: BookSlot[] = [];
    const spines: SpinePlacement[] = [];
    const h = ATRIUM.hoodTopY - ATRIUM.caseTopY - 0.14;
    const w = 0.62;
    const pitch = 0.9;
    for (const st of this.caseStands) {
      const a = st.angle;
      const rad: [number, number] = [Math.cos(a), Math.sin(a)];
      const tan: [number, number] = [-Math.sin(a), Math.cos(a)];
      const books = this.manifest.sites
        .filter((x) => x.discipline === st.key && (x.stats?.chapters ?? 0) > 0)
        .sort((x, y) => (y.stats?.chapters ?? 0) - (x.stats?.chapters ?? 0) || x.file.localeCompare(y.file))
        .slice(0, ATRIUM.caseSpines);
      books.forEach((book, i) => {
        const off = (i - (books.length - 1) / 2) * pitch;
        const idx = slots.length;
        slots.push({
          book,
          chapters: [],
          color: leatherColor(ROOM_BY_KEY[st.key].color, idx),
          spineW: w,
          u0: off,
          slotW: w,
          level: 0,
          wall: 'back',
          cx: st.x + tan[0] * off,
          cz: st.z + tan[1] * off,
          bookH: h,
          spineStart: 0,
        });
        spines.push({
          slot: idx,
          chapter: { id: '', title: '', num: null, concepts: [] },
          chapterIndex: 0,
          x: st.x + tan[0] * off,
          y: ATRIUM.caseTopY + h / 2 + 0.02,
          z: st.z + tan[1] * off,
          w,
          h,
          depth: 0.34,
          dir: [tan[0], tan[1]],
          normal: [-rad[0], -rad[1]],
          cell: idx,
        });
      });
    }
    this.casePlan = { slots, spines };
    if (!spines.length) return;
    const atlas = buildSpineAtlas(
      slots.map((sl) => ({
        color: sl.color,
        title: sl.book.title || sl.book.bookSlug,
        chapters: ['首'],
      })),
    );
    this.caseAtlas = atlas;
    this.casePages = buildSpines({ spines } as unknown as RoomPlan, atlas);
    for (const p of this.casePages) {
      const tex = atlas.textures[p.page] ?? null;
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0.5,
        roughness: 0.6,
        metalness: 0.12,
        envMapIntensity: 0.5,
      });
      const mesh = this.mark(new THREE.Mesh(p.geometry, mat), 'caseSpine', {}) as THREE.Mesh;
      mesh.userData.page = p.page;
      mesh.userData.case = true;
      this.caseSpineMeshes.push(mesh);
      this.atrium?.add(mesh);
    }
  }

  /** 台面上的扇区高亮与「近台」判定：只在变化沿动材质，不做每帧常量刷新 */
  private syncAtrium(hit: Pick | null): void {
    const want = hit && hit.kind === 'room' && hit.sector !== undefined ? hit.sector : -1;
    if (want !== this.aimSector) {
      this.aimSector = want;
      this.sectorHl.forEach((m, i) => {
        m.visible = i === want;
      });
    }
    const near = this.camMode === 'walk'
      && this.view === 'hall'
      && Math.hypot(this.camera.position.x, this.camera.position.z) <= ATRIUM.nearR;
    if (near === this.deskNear) return;
    this.deskNear = near;
    if (this.deskTopMat) this.deskTopMat.emissiveIntensity = near ? 0.5 : 0.34;
    if (this.deskBandMat) this.deskBandMat.emissiveIntensity = near ? 2.6 : 2.2;
    if (this.caseLampMat) this.caseLampMat.emissiveIntensity = near ? 0.6 : 0.5;
    if (this.deskLight) this.deskLight.intensity = near ? 18 : 14;
    this.hudStale = true;
  }

  /** 展柜取射线用的一组目标：内容物（台 + 柜 + 脊）与纯墙，一次遍历缓存 */
  private sightTargets(): { content: THREE.Object3D[]; wall: THREE.Object3D[] } {
    if (this.sightCache) return this.sightCache;
    const content = new Set(['indexDesk', 'deskTop', 'deskBand', 'displayCase', 'caseHood', 'caseLamp', 'caseSpine']);
    // 扇区高亮块是台面上的瞬时 UI，Raycaster 不看 visible，留着它会把台面本身挡掉
    const skip = new Set(['sectorHl', 'deskSectorHl']);
    const out: { content: THREE.Object3D[]; wall: THREE.Object3D[] } = { content: [], wall: [] };
    this.hall.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const role = String(o.userData.role ?? '');
      if (content.has(role)) out.content.push(mesh);
      else if (!skip.has(role)) out.wall.push(mesh);
    });
    this.sightCache = out;
    return out;
  }

  /**
   * 大厅漫游环视取证：原地转向八个方位（每 45°），每个方位沿俯仰扇 [0,−6,−12,−20,−30]°
   * 走**真实拾取链**（`pickAt(ndc(0,0))` → pickHall 的 faceIndex 映射），任一眼光落在内容物上
   * 且距离 ≤ limit 即算该方向有内容。俯仰扇是必要的：台面 1.1、罩顶 1.94 都在 1.65 眼高的上下，
   * 单条水平射线既压不到台面也读不全展柜。
   */
  hallSightScan(limit = 25, windowDeg = 20): {
    at: [number, number];
    limit: number;
    pitchFan: number[];
    windowDeg: number;
    dirs: Array<{ deg: number; content: boolean; kind: string; role: string; dist: number; pitchDeg: number; yawOffDeg: number; wallDist: number; wallRole: string; wallPitch: number }>;
    content: number;
    total: number;
  } {
    const targets = this.sightTargets();
    const yaw0 = this.walkYaw;
    const pitch0 = this.walkPitch;
    const pitchFan = [0, -6, -12, -20, -30];
    const offsets: number[] = [];
    for (let w = -Math.abs(windowDeg); w <= Math.abs(windowDeg) + 1e-6; w += 10) offsets.push((w * Math.PI) / 180);
    const dirs = [] as Array<{ deg: number; content: boolean; kind: string; role: string; dist: number; pitchDeg: number; yawOffDeg: number; wallDist: number; wallRole: string; wallPitch: number }>;
    for (let i = 0; i < 8; i += 1) {
      const bearing = (Math.PI / 4) * i;
      let hit: { kind: string; role: string; dist: number; pitchDeg: number; yawOffDeg: number } | null = null;
      let wallDist = Number.POSITIVE_INFINITY;
      let wallRole = '';
      let wallPitch = 0;
      for (const off of offsets) {
        for (const pdeg of pitchFan) {
          this.walkYaw = this.yawToward(Math.cos(bearing + off), Math.sin(bearing + off));
          this.walkPitch = (pdeg * Math.PI) / 180;
          this.camera.rotation.order = 'YXZ';
          this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
          this.camera.updateMatrixWorld();
          this.ray.setFromCamera(CENTER_NDC, this.camera);
          const picked = this.pickHall();
          const first = this.ray.intersectObjects(targets.content, false)[0];
          const near = this.ray.intersectObjects(targets.wall, false)[0];
          if (near && near.distance < wallDist) {
            wallDist = round2(near.distance);
            wallRole = String(near.object.userData.role ?? '');
            wallPitch = pdeg;
          }
          if (picked && first && first.distance <= limit && first.distance <= (near?.distance ?? Infinity)) {
            if (!hit || first.distance < hit.dist) {
              hit = {
                kind: picked.kind,
                role: String(first.object.userData.role ?? ''),
                dist: round2(first.distance),
                pitchDeg: pdeg,
                yawOffDeg: Math.round((off * 180) / Math.PI),
              };
            }
            break;
          }
        }
      }
      dirs.push({
        deg: i * 45,
        content: hit !== null,
        kind: hit?.kind ?? '',
        role: hit?.role ?? '',
        dist: hit?.dist ?? Number.POSITIVE_INFINITY,
        pitchDeg: hit?.pitchDeg ?? 0,
        yawOffDeg: hit?.yawOffDeg ?? 0,
        wallDist: Number.isFinite(wallDist) ? wallDist : -1,
        wallRole,
        wallPitch,
      });
    }
    this.walkYaw = yaw0;
    this.walkPitch = pitch0;
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.camera.updateMatrixWorld();
    this.syncWalkTarget();
    this.refreshAim(true);
    return {
      at: [round2(this.camera.position.x), round2(this.camera.position.z)],
      limit,
      pitchFan,
      windowDeg,
      dirs,
      content: dirs.filter((d) => d.content).length,
      total: dirs.length,
    };
  }

  /** 批 12 对账读数：扇区角 vs 走廊角、台/柜尺寸、书脊账、近台态 */
  atriumState(): {
    sectors: Array<{ key: string; amDeg: number; doorDeg: number; driftDeg: number; a0Deg: number; a1Deg: number; books: number; chapters: number }>;
    maxDriftDeg: number;
    desk: { r: number; topR: number; topY: number; nearR: number; standR: number; bandY: [number, number]; lightIntensity: number; lightDistance: number; lightDecay: number; lightY: number };
    near: boolean;
    aimSector: number;
    highlight: number[];
    emissive: { top: number; band: number; lamp: number };
    cases: Array<{ key: string; deg: number; x: number; z: number; r: number; lean: number; books: number; spines: number; title: string; chapters: number }>;
    caseRing: [number, number];
    spines: { slots: number; pages: number; triangles: number; atlasPages: number };
    topTex: [number, number];
    blockers: Record<string, number>;
    triangles: { desk: number; cases: number };
    proj: { pts: number; inFrame: number; deskW: number; ringW: number };
  } {
    const cases = this.caseStands.map((st) => {
      const c = this.deskCounts.get(st.key) ?? { books: 0, chapters: 0 };
      const top = this.manifest.sites
        .filter((x) => x.discipline === st.key && (x.stats?.chapters ?? 0) > 0)
        .sort((x, y) => (y.stats?.chapters ?? 0) - (x.stats?.chapters ?? 0) || x.file.localeCompare(y.file))
        .slice(0, ATRIUM.caseSpines);
      return {
        key: st.key,
        deg: Math.round(((st.angle * 180) / Math.PI + 360) % 360 * 100) / 100,
        x: round2(st.x),
        z: round2(st.z),
        r: round2(Math.hypot(st.x, st.z)),
        lean: ATRIUM.caseLean,
        books: c.books,
        spines: this.casePlan?.spines.filter((sp) => this.casePlan?.slots[sp.slot]?.book.discipline === st.key).length ?? 0,
        title: top.map((b) => b.title || b.bookSlug).join(' / '),
        chapters: top.reduce((sum, b) => sum + (b.stats?.chapters ?? 0), 0),
      };
    });
    const sectors = this.deskSectors.map((sec) => {
      const spec = ROOM_BY_KEY[sec.key];
      const c = this.deskCounts.get(sec.key) ?? { books: 0, chapters: 0 };
      const door = ((spec.angle * 180) / Math.PI + 360) % 360;
      const am = ((sec.am * 180) / Math.PI + 360) % 360;
      return {
        key: sec.key,
        amDeg: Math.round(am * 1000) / 1000,
        doorDeg: Math.round(door * 1000) / 1000,
        driftDeg: Math.round(Math.abs(((am - door + 540) % 360) - 180) * 1000) / 1000,
        a0Deg: Math.round(((sec.a0 * 180) / Math.PI + 360) % 360 * 10) / 10,
        a1Deg: Math.round(((sec.a1 * 180) / Math.PI + 360) % 360 * 10) / 10,
        books: c.books,
        chapters: c.chapters,
      };
    });
    const kinds: Record<string, number> = {};
    for (const b of this.hallColliders) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    let caseTris = 0;
    let deskTris = 0;
    for (const m of [this.caseBodies, ...this.caseSpineMeshes]) if (m) caseTris += trianglesOf(m);
    for (const m of [this.deskTop]) if (m) deskTris = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
    return {
      sectors,
      maxDriftDeg: Math.max(0, ...sectors.map((x) => x.driftDeg)),
      desk: {
        r: ATRIUM.deskR,
        topR: ATRIUM.deskTopR,
        topY: ATRIUM.deskTopY,
        nearR: ATRIUM.nearR,
        standR: ATRIUM.standR,
        bandY: [ATRIUM.bandY0, ATRIUM.bandY1],
        lightIntensity: this.deskLight?.intensity ?? 0,
        lightDistance: this.deskLight?.distance ?? 0,
        lightDecay: this.deskLight?.decay ?? 0,
        lightY: this.deskLight?.position.y ?? 0,
      },
      near: this.deskNear,
      aimSector: this.aimSector,
      highlight: this.sectorHl.map((m, i) => (m.visible ? i : -1)).filter((i) => i >= 0),
      emissive: {
        top: this.deskTopMat?.emissiveIntensity ?? 0,
        band: this.deskBandMat?.emissiveIntensity ?? 0,
        lamp: this.caseLampMat?.emissiveIntensity ?? 0,
      },
      cases,
      caseRing: [ATRIUM.caseR, ATRIUM.caseR],
      spines: {
        slots: this.casePlan?.slots.length ?? 0,
        pages: this.casePages.length,
        triangles: this.casePages.reduce((a, p) => a + p.triangles, 0),
        atlasPages: this.caseAtlas?.pages ?? 0,
      },
      topTex: [
        (this.deskTopMat?.map?.image as { width?: number } | null)?.width ?? 0,
        (this.deskTopMat?.map?.image as { height?: number } | null)?.height ?? 0,
      ],
      blockers: kinds,
      triangles: { desk: Math.round(deskTris), cases: caseTris },
      proj: this.atriumProjection(),
    };
  }

  /** 准星压到第 i 个台面扇区：站到台沿环上、按真实链路拾取（与 walkAimSpine 同一条路） */
  aimDeskSector(i: number): {
    ok: boolean;
    sector: number;
    key: string;
    title: string;
    hint: string;
    pitchDeg: number;
    stand: string;
    highlight: boolean;
  } | null {
    const sec = this.deskSectors[i];
    if (!sec) return null;
    const at = new THREE.Vector3(
      Math.cos(sec.am) * ATRIUM.standR,
      WALK.eye,
      Math.sin(sec.am) * ATRIUM.standR,
    );
    // 面朝台心：从扇区中心线外侧看进去，落点正落在这一块的弧心
    this.walkDrop(at, this.yawToward(-Math.cos(sec.am), -Math.sin(sec.am)));
    const rr = (ATRIUM.sectorR0 + ATRIUM.deskTopR) / 2;
    const tx = Math.cos(sec.am) * rr;
    const tz = Math.sin(sec.am) * rr;
    const d = Math.hypot(tx - this.camera.position.x, tz - this.camera.position.z);
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, Math.atan2(ATRIUM.deskTopY - this.camera.position.y, d)));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.syncWorld();
    this.refreshAim(true);
    const hit = this.aimHit;
    return {
      ok: hit?.kind === 'room' && hit.sector === i,
      sector: i,
      key: sec.key,
      title: hit?.title ?? '',
      hint: hit?.hint ?? '',
      pitchDeg: Math.round(this.walkPitch * 572957.8) / 10000,
      stand: `${round2(this.camera.position.x)},${round2(this.camera.position.z)}`,
      highlight: this.aimSector === i,
    };
  }

  /** 准星压到展柜第 i 根书脊：站到柜前、按真实链路拾取，返回该书身份供「开的是不是这一本」对账 */
  aimCaseSpine(i: number): {
    ok: boolean;
    index: number;
    book: string;
    file: string;
    discipline: string;
    kind: string;
    pitchDeg: number;
    stand: string;
    dist: number;
  } | null {
    const sp = this.casePlan?.spines[i];
    if (!sp) return null;
    const n: [number, number] = [sp.normal[0], sp.normal[1]];
    const at = new THREE.Vector3(sp.x + n[0] * 1.7, WALK.eye, sp.z + n[1] * 1.7);
    this.walkDrop(at, this.yawToward(-n[0], -n[1]));
    const d = Math.hypot(sp.x - at.x, sp.z - at.z);
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, Math.atan2(sp.y - this.camera.position.y, d)));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.syncWorld();
    this.refreshAim(true);
    const slot = this.casePlan?.slots[sp.slot];
    const hit = this.aimHit;
    return {
      ok: hit?.kind === 'chapter' && hit.book?.file === slot?.book.file,
      index: i,
      book: slot?.book.title || slot?.book.bookSlug || '',
      file: slot?.book.file ?? '',
      discipline: slot?.book.discipline ?? '',
      kind: hit?.kind ?? '',
      pitchDeg: Math.round(this.walkPitch * 572957.8) / 10000,
      stand: `${round2(this.camera.position.x)},${round2(this.camera.position.z)}`,
      dist: round2(Math.hypot(this.camera.position.x - sp.x, this.camera.position.z - sp.z)),
    };
  }

  /** 批 12 审计：厅内每个网格的角色 / 世界包围盒 / 可见性——判「所见即所撞」与射线目标表有没有漏角色 */
  hallAudit(): Array<{ role: string; in: string; vis: boolean; tris: number; box: [number, number, number, number, number, number] }> {
    const out: Array<{ role: string; in: string; vis: boolean; tris: number; box: [number, number, number, number, number, number] }> = [];
    this.hall.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.updateMatrixWorld(true);
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
      const r = (v: number) => Math.round(v * 100) / 100;
      const t = this.sightTargets();
      out.push({
        role: String(mesh.userData.role ?? ''),
        in: t.content.includes(mesh) ? 'content' : t.wall.includes(mesh) ? 'wall' : '-',
        vis: mesh.visible !== false,
        tris: (g.attributes.position?.count ?? 0) / 3,
        box: [r(b.min.x), r(b.min.y), r(b.min.z), r(b.max.x), r(b.max.y), r(b.max.z)],
      });
    });
    return out;
  }

  /** 批 12 通路间隙：不搬玩家，直接读某点的带符号净空（已扣玩家半径 0.45，负数＝嵌在盒里） */
  walkGapAt(x: number, z: number): number {
    return round2(wallGap(new THREE.Vector3(x, WALK.eye, z), this.colliders));
  }

  /** 准星压展柜柜体：走 caseTriRef（faceIndex→区序号）报区名，证明映射表覆盖柜体而非只有书脊 */
  aimCaseBody(i: number): { ok: boolean; index: number; key: string; kind: string; hint: string; stand: string } | null {
    const st = this.caseStands[i];
    if (!st) return null;
    const a = st.angle;
    const nx = -Math.cos(a);
    const nz = -Math.sin(a);
    const at = new THREE.Vector3(st.x + nx * 2.6, WALK.eye, st.z + nz * 2.6);
    this.walkDrop(at, this.yawToward(-nx, -nz));
    const d = Math.hypot(st.x - this.camera.position.x, st.z - this.camera.position.z);
    const target = ATRIUM.caseTopY - 0.34;
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, Math.atan2(target - this.camera.position.y, d)));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.syncWorld();
    this.refreshAim(true);
    const hit = this.aimHit;
    return {
      ok: hit?.kind === 'room' && hit.discipline === st.key,
      index: i,
      key: String(st.key),
      kind: hit?.kind ?? '',
      hint: hit?.hint ?? '',
      stand: `${round2(this.camera.position.x)},${round2(this.camera.position.z)}`,
    };
  }

  /**
   * 批 12 G：八角台与展柜圈在当前机位下的屏幕投影。俯瞰构图的回退风险不是「包络变小」
   * （壳/门洞包络与新增体量无关），而是中央一大团把门环压成背景——所以量的是投影占比。
   */
  private atriumProjection(): { pts: number; inFrame: number; deskW: number; ringW: number } {
    const v = new THREE.Vector3();
    const corners = (cx: number, cz: number, r: number, y: number, n: number) => {
      const out: Array<[number, number, number]> = [];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      return out;
    };
    const project = (pts: Array<[number, number, number]>) =>
      pts.map((q) => v.set(q[0], q[1], q[2]).project(this.camera).clone());
    const desk = project(corners(0, 0, ATRIUM.deskTopR, ATRIUM.deskTopY, 8));
    const ring = project(this.caseStands.flatMap((st) => corners(st.x, st.z, 1.7, ATRIUM.hoodTopY, 4)));
    const all = desk.concat(ring);
    const inNdc = (q: THREE.Vector3) => Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z <= 1;
    const span = (list: THREE.Vector3[]) =>
      (Math.max(...list.map((q) => q.x)) - Math.min(...list.map((q) => q.x))) / 2;
    return {
      pts: all.length,
      inFrame: all.filter(inNdc).length,
      deskW: Math.round(span(desk) * 1000) / 1000,
      ringW: Math.round(span(ring) * 1000) / 1000,
    };
  }

  /**
   * 批 12 门洞实测方位：从厅心（台面之上 2.2，避开八角台）沿水平扫一圈射线打墙系，
   * 穿门洞的能打到走廊尽头（>100），实心墙 44 就停。连续通孔段取圆周质心，
   * 与扇区中心线来源无关——这是「从台面扇区走过去就是那条走廊」的角度证据。
   */
  doorBearingScan(stepDeg = 1): {
    stepDeg: number;
    openMin: number;
    holes: Array<{ deg: number; spanDeg: number; maxDist: number }>;
    drift: Array<{ key: string; roomDeg: number; holeDeg: number; sectorDeg: number; driftDeg: number; sectorVsHoleDeg: number }>;
    maxDriftDeg: number;
    probe: number[];
  } {
    // 只打外墙壳：穿门而过的射线会落到对面墙上（>60），被堵住的打在洞那侧 ~40
    const shell = this.hall.children.filter((o) => String(o.userData.role ?? '') === 'hallWall');
    const eye = new THREE.Vector3(0, ATRIUM.deskTopY + 1.1, 0);
    const dir = new THREE.Vector3();
    const n = Math.max(1, Math.round(360 / stepDeg));
    const step = 360 / n;
    const dist: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = (i * step * Math.PI) / 180;
      this.ray.set(eye, dir.set(Math.cos(a), 0, Math.sin(a)));
      const hit = this.ray.intersectObjects(shell, false)[0];
      dist.push(hit ? round2(hit.distance) : -1);
    }
    const openMin = 60;
    const openAt = (i: number) => {
      const d = dist[((i % n) + n) % n];
      return d < 0 || d >= openMin;
    };
    const holes: Array<{ deg: number; spanDeg: number; maxDist: number }> = [];
    const seen = new Set<number>();
    for (let i = 0; i < 2 * n; i += 1) {
      if (!openAt(i) || seen.has(i % n)) continue;
      let k = 0;
      while (k < n / 2 && openAt(i + k)) k += 1;
      for (let j = 0; j < k; j += 1) seen.add((i + j) % n);
      let sx = 0;
      let sz = 0;
      let mx = 0;
      for (let j = 0; j < k; j += 1) {
        const d = (((i + j) % n) * step * Math.PI) / 180;
        sx += Math.cos(d);
        sz += Math.sin(d);
        mx = Math.max(mx, dist[(i + j) % n]);
      }
      const deg = (Math.atan2(sz, sx) * 180) / Math.PI;
      holes.push({
        deg: Math.round(((deg + 360) % 360) * 100) / 100,
        spanDeg: Math.round(k * step * 100) / 100,
        maxDist: mx,
      });
    }
    const wrap180 = (x: number) => ((x + 540) % 360) - 180;
    const drift = ROOMS.map((r) => {
      const sec = this.deskSectors.find((x) => x.key === r.key);
      let best: { deg: number } | null = null;
      for (const h of holes) {
        if (!best || Math.abs(wrap180(h.deg - (r.angle * 180) / Math.PI)) < Math.abs(wrap180(best.deg - (r.angle * 180) / Math.PI))) {
          best = h;
        }
      }
      const roomDeg = Math.round((((r.angle * 180) / Math.PI + 360) % 360) * 100) / 100;
      const holeDeg = best ? best.deg : -1;
      const sectorDeg = sec ? Math.round((((sec.am * 180) / Math.PI + 360) % 360) * 100) / 100 : -1;
      return {
        key: String(r.key),
        roomDeg,
        holeDeg,
        sectorDeg,
        driftDeg: best ? Math.round(Math.abs(wrap180(holeDeg - roomDeg)) * 100) / 100 : 999,
        sectorVsHoleDeg: best ? Math.round(Math.abs(wrap180(sectorDeg - holeDeg)) * 100) / 100 : 999,
      };
    });
    return {
      stepDeg: Math.round(step * 100) / 100,
      openMin,
      holes,
      drift,
      maxDriftDeg: Math.max(...drift.map((x) => Math.max(x.driftDeg, x.sectorVsHoleDeg))),
      probe: Array.from({ length: 72 }, (_, i) => dist[i * Math.max(1, Math.round(n / 72))]),
    };
  }

  /** 批 12 对位闭环：从台缘沿任意世界方位角望向台面，读回准星压到的是哪一块扇区 */
  aimDeskRay(deg: number): { sector: number; key: string; kind: string; hint: string; at: string } {
    const a = (deg * Math.PI) / 180;
    const at = new THREE.Vector3(Math.cos(a) * ATRIUM.standR, WALK.eye, Math.sin(a) * ATRIUM.standR);
    this.walkDrop(at, this.yawToward(-Math.cos(a), -Math.sin(a)));
    const rr = (ATRIUM.sectorR0 + ATRIUM.deskTopR) / 2;
    const tx = Math.cos(a) * rr;
    const tz = Math.sin(a) * rr;
    const d = Math.hypot(tx - this.camera.position.x, tz - this.camera.position.z);
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, Math.atan2(ATRIUM.deskTopY - this.camera.position.y, d)));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.syncWorld();
    this.refreshAim(true);
    const hit = this.aimHit;
    const i = typeof hit?.sector === 'number' ? hit.sector : -1;
    return {
      sector: i,
      key: i >= 0 ? String(this.deskSectors[i]?.key ?? '') : '',
      kind: hit?.kind ?? '',
      hint: hit?.hint ?? '',
      at: `${round2(this.camera.position.x)},${round2(this.camera.position.z)}`,
    };
  }

  /** 批 12 E：站立处地面亮度。逐方位先用墙系射线确认采样带中心打的是地面，再取该屏带像素均值 */
  walkGroundSample(
    pitchDeg = -35,
    box: [number, number, number, number] = [0.3, 0.68, 0.4, 0.27],
  ): {
    at: [number, number];
    pitchDeg: number;
    box: number[];
    rows: Array<{ deg: number; role: string; dist: number; mean: number }>;
    floorDirs: number;
    total: number;
    mean: number;
    min: number;
    max: number;
  } {
    const targets = this.sightTargets();
    const yaw0 = this.walkYaw;
    const pitch0 = this.walkPitch;
    const probe = new THREE.Vector2(0, 1 - 2 * (box[1] + box[3] / 2));
    const rows: Array<{ deg: number; role: string; dist: number; mean: number }> = [];
    for (let i = 0; i < 12; i += 1) {
      const bearing = (Math.PI / 6) * i;
      this.walkYaw = this.yawToward(Math.cos(bearing), Math.sin(bearing));
      this.walkPitch = (pitchDeg * Math.PI) / 180;
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
      this.camera.updateMatrixWorld();
      this.ray.setFromCamera(probe, this.camera);
      const hit = this.ray.intersectObjects(targets.wall, false)[0];
      const role = hit ? String(hit.object.userData.role ?? '') : '';
      const lum = this.sampleLuminance(box[0], box[1], box[2], box[3], 48);
      rows.push({
        deg: i * 30,
        role,
        dist: hit ? round2(hit.distance) : -1,
        mean: Math.round(lum.mean * 10000) / 10000,
      });
    }
    this.walkYaw = yaw0;
    this.walkPitch = pitch0;
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.camera.updateMatrixWorld();
    const floors = rows.filter((r) => /floor|ground/i.test(r.role));
    const means = floors.map((r) => r.mean);
    const avg = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
    return {
      at: [round2(this.camera.position.x), round2(this.camera.position.z)],
      pitchDeg,
      box,
      rows,
      floorDirs: floors.length,
      total: rows.length,
      mean: Math.round(avg * 10000) / 10000,
      min: means.length ? Math.min(...means) : 0,
      max: means.length ? Math.max(...means) : 0,
    };
  }

  private buildChandelier(): void {
    const y = HALL_HEIGHT - 4.2;
    const brass = this.brass();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.42, 6, 28), brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, y, 0);
    ring.castShadow = true;
    ring.userData.role = 'chandelier';
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.3, 6, 22), brass);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.set(0, y + 1.6, 0);
    ring2.userData.role = 'chandelier';
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.2, 6), brass);
    chain.position.set(0, y + 3.9, 0);
    chain.userData.role = 'chandelier';

    const arms = new THREE.InstancedMesh(unitBox(), brass, 8);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - a);
      m.compose(v.set(Math.cos(a) * 3.3, y + 0.5, Math.sin(a) * 3.3), q, sc.set(6.4, 0.26, 0.26));
      arms.setMatrixAt(i, m);
    }
    arms.instanceMatrix.needsUpdate = true;
    arms.userData.role = 'chandelier';

    const candles = new THREE.InstancedMesh(
      unitBox(),
      new THREE.MeshBasicMaterial({ map: this.glowTex ?? undefined, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      8,
    );
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      m.compose(
        v.set(Math.cos(a) * 6.6, y + 0.5, Math.sin(a) * 6.6),
        new THREE.Quaternion(),
        sc.set(1.9, 1.9, 1.9),
      );
      candles.setMatrixAt(i, m);
    }
    candles.instanceMatrix.needsUpdate = true;
    candles.userData.role = 'chandelier';
    candles.userData.billboard = true;

    // 吊灯只照得亮脚下：44 单位半径的八角厅，halo 从 240 提到 420 才让地面总览图与内壁脱离纯黑
    const halo = new THREE.PointLight(0xffd9a0, 420, 220, 2);
    halo.position.set(0, y, 0);
    halo.userData.role = 'chandelierLight';
    this.hall.add(ring, ring2, chain, arms, candles, halo);
  }

  /** 六个体量外壳：大厅俯视能看到六栋关着的房子，而不是六个圆盘 */
  private buildFacades(wallMat: THREE.Material): void {
    const b = new GeoBuilder();
    const facadeZones: number[] = [];
    ROOMS.forEach((r, idx) => {
      const half = FACADE_SIDE / 2;
      const rot = Math.PI / 2 - r.angle;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      const box = (local: Vec3): Vec3 => {
        const p = new THREE.Vector3(local[0], local[1], local[2])
          .applyQuaternion(q)
          .add(new THREE.Vector3(r.at[0], 0, r.at[1]));
        return [p.x, p.y, p.z] as Vec3;
      };
      const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const v = new THREE.Vector3(0, 1, 0);
      const w = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const before = b.faces;
      /*
       * 批 20：正面中央留门洞——碰撞盒拆成左右翼 + 门楣 + 后墙，视觉体量同步拆开，
       * 否则人走到门口看见的是一整块实心（触发虽在 2 米外，斜向贴墙时仍会穿帮）。
       * 主体正面收进一个门洞进深，左右翼与门楣补回这一层，门洞尽头的后墙正面
       * 与碰撞的后墙同在 local −half+recess，看上去是一扇深色的门斗而不是空洞。
       */
      const fdw = FACADE_DOOR.w / 2;
      const fdh = FACADE_DOOR.h;
      const rz = FACADE_DOOR.recess / 2;
      const bodyHz = half - rz;
      const wingHx = (half - fdw) / 2;
      const wingCx = (half + fdw) / 2;
      const tileWall = TILE.wall;
      b.slab(box([0, ROOM_HEIGHT / 2, rz]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        half, ROOM_HEIGHT / 2, bodyHz, tileWall);
      b.slab(box([-wingCx, ROOM_HEIGHT / 2, -half + rz]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        wingHx, ROOM_HEIGHT / 2, rz, tileWall);
      b.slab(box([wingCx, ROOM_HEIGHT / 2, -half + rz]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        wingHx, ROOM_HEIGHT / 2, rz, tileWall);
      b.slab(box([0, (fdh + ROOM_HEIGHT) / 2, -half + rz]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        fdw, (ROOM_HEIGHT - fdh) / 2, rz, tileWall);
      b.slab(box([0, ROOM_HEIGHT + 0.55, 0]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        half + 0.8, 0.55, half + 0.8, TILE.trim);
      // 门廊：朝大厅那一面（local −Z）凸出一小块；同样只在中央留 3.6×4.6 的门洞
      const porchH = FACADE_PORCH.h;
      const porchHx = FACADE_PORCH.halfW;
      const porchD = FACADE_PORCH.depth;
      const porchCx = (porchHx + fdw) / 2;
      const porchWingHx = (porchHx - fdw) / 2;
      for (const sx of [-1, 1]) {
        b.slab(box([sx * porchCx, porchH / 2, -half - porchD / 2]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
          porchWingHx, porchH / 2, porchD / 2, TILE.trim);
      }
      b.slab(box([0, (fdh + porchH) / 2, -half - porchD / 2]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        fdw, (porchH - fdh) / 2, porchD / 2, TILE.trim);
      // faceIndex → 区：八块 slab 共 96 个三角面，逐面对齐，点击任意一面都能认到区
      while (facadeZones.length < b.faces) facadeZones.push(idx);
      if (b.faces - before !== 96) throw new Error(`体量外壳面数异常：${b.faces - before}`);
    });
    const mesh = new THREE.Mesh(b.toGeometry(), wallMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.role = 'facades';
    this.facadeZones = facadeZones;
    this.facades = mesh;
    this.hall.add(mesh);

    ROOMS.forEach((r) => {
      const tex = plaqueTexture(
        PLAQUE_KINDS[r.key],
        r.short,
        `${(this.manifest.sites.filter((s) => s.discipline === r.key)).length} 册`,
        r.color,
      );
      const half = FACADE_SIDE / 2;
      const rot = Math.PI / 2 - r.angle;
      const outward = new THREE.Vector3(-Math.sin(rot), 0, -Math.cos(rot));
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(9.4, 3.1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
      );
      plaque.position.set(
        r.at[0] + outward.x * (half + 1.35),
        ROOM_DOOR.h + 1.9,
        r.at[1] + outward.z * (half + 1.35),
      );
      plaque.rotation.y = Math.atan2(outward.x, outward.z);
      plaque.userData.role = 'plaque';
      plaque.userData.discipline = r.key;
      this.doorPlaques.set(r.key, plaque);
      this.plaqueTex.set(r.key, tex);
      this.hall.add(plaque);
    });
  }

  private brass(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xc9a24a,
      roughness: 0.34,
      metalness: 0.82,
      envMapIntensity: 0.9,
    });
  }

  private wood(base: string, seed: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: woodTexture(base, '#120c07', seed),
      roughness: 0.72,
      metalness: 0.1,
      envMapIntensity: 0.4,
    });
  }

  private mark<T extends THREE.Object3D>(obj: T, role: string, opts: { castShadow?: boolean; receiveShadow?: boolean }): T {
    obj.userData.role = role;
    const mesh = obj as unknown as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = opts.castShadow === true;
      mesh.receiveShadow = opts.receiveShadow === true;
    }
    return obj;
  }

  // ---------------------------------------------------------------- 走廊

  private buildLinks(): Array<[Discipline, THREE.Group]> {
    const out: Array<[Discipline, THREE.Group]> = [];
    // 走廊壳体三面法线全部朝内（侧墙指向中线、顶面指向下），必须是 FrontSide：
    // 写成 DoubleSide 时顶面从上方照样可见，大厅俯视看到的是六条封闭暗管盖，而不是管里的地面和铭牌。
    const shellMat = new THREE.MeshStandardMaterial({
      map: wallTexture('#33291f', '#4a3c2c', '#241c14'),
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.3,
    });
    // 批 16：走廊原来是一条黑洞——地板只有一条学科色自发光，两侧墙与顶面吃不到任何光。
    // 每 12 米在两侧墙上挂一对壁灯（MeshBasic 自发光小面，零光源成本），走廊才读得出纵深。
    const lampGeos: THREE.BufferGeometry[] = [];
    // 批 17：六条走廊做书廊。书架本体 / 书脊 / 顶灯全部按世界坐标烘进合并几何。
    const shelfGeos: THREE.BufferGeometry[] = [];
    const spinePlates: THREE.BufferGeometry[][] = ROOMS.map(() => []);
    const ceilingLampGeos: THREE.BufferGeometry[] = [];
    const shelfGeo = new THREE.BoxGeometry(4.4, 2.6, 0.36);
    const ceilingLampGeo = new THREE.BoxGeometry(1.6, 0.10, 1.6);
    for (const [zi, r] of ROOMS.entries()) {
      const group = new THREE.Group();
      const built = buildCorridor(r.angle, HALL_RADIUS - 0.4, ROOM_DIST, FACADE_SIDE);
      const dirV = new THREE.Vector3(Math.cos(r.angle), 0, Math.sin(r.angle));
      const lat = new THREE.Vector3(-dirV.z, 0, dirV.x);
      const d0 = HALL_RADIUS - 0.4;
      // buildCorridor 的管体在门墙内皮收口（ROOM_DIST − FACADE_SIDE/2 − 0.5），
      // 不是 ROOM_DIST；书架按管体真实末端留 5 米，否则最后两节会穿进阅览室。
      const corridorEnd = d0 + built.length;
      // 局部 +z 经 yaw 正好映射到 lat；朝大厅一侧的书架要多转 π 让正面朝走廊中线。
      const yaw = Math.atan2(-dirV.z, dirV.x);
      const wallLat = CORRIDOR_W / 2 - 0.30;
      for (const side of [-1, 1]) {
        const sideYaw = yaw + (side > 0 ? Math.PI : 0);
        let d = d0 + 16;
        while (d <= corridorEnd - 5) {
          const px = dirV.x * d + lat.x * side * wallLat;
          const pz = dirV.z * d + lat.z * side * wallLat;
          const body = shelfGeo.clone();
          body.rotateY(sideYaw);
          body.translate(px, 1.3, pz);
          shelfGeos.push(body);
          // 书脊不再是一个个盒子（3 层 × 8 本 × 288 三角/节，书与书之间空 34 cm 远看像悬空方块），
          // 改成每层一块 4.3×0.52 的薄板，贴 bookRowTexture：紧排书脊、单元 6 个三角。
          // 批 18：书架从 3.2 米降到 2.6、层距 0.86→0.66——3.2 高时站在架子前 1 米，最上层
          // 在视野外（仰角 52° > 半视场 38°），用户反映「看不到上边的书」。
          for (let layer = 0; layer < 3; layer++) {
            const g = new THREE.PlaneGeometry(4.3, 0.52);
            g.translate(0, 0.55 + layer * 0.66, 0.19);
            g.rotateY(sideYaw);
            g.translate(px, 0, pz);
            spinePlates[zi].push(g);
          }
          d += 5;
        }
      }
      let ld = d0 + 26;
      while (ld <= corridorEnd - 6) {
        const g = ceilingLampGeo.clone();
        g.rotateY(yaw);
        g.translate(dirV.x * ld, CORRIDOR_H - 1.4, dirV.z * ld);
        ceilingLampGeos.push(g);
        ld += 26;
      }
      for (let d = d0 + 8; d < ROOM_DIST - 7; d += 12) {
        for (const side of [-1, 1]) {
          const g = new THREE.PlaneGeometry(0.5, 1.1);
          const q = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            lat.clone().multiplyScalar(-side),
          );
          const pos = dirV.clone().multiplyScalar(d).addScaledVector(lat, side * (CORRIDOR_W / 2 - 0.12));
          pos.y = 3.4;
          g.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
          lampGeos.push(g);
        }
      }

      // 批 13 A2：六区的学科色改由走廊地面自发光承担（原来靠 6 盏学科色点光，见 spacekit.buildLightRig 注释）。
      // 自发光是零光源成本的，走廊里那条彩色光带还在，但整帧不再为它多算一次点光。
      const floorMat = this.wood('#3a2a1a', 5);
      // 批 16：地板不再吃学科色自发光——极暗环境里哪怕 0.02 的青绿也把整条地面染成墨绿（实测三期）。
      // 只留一层极弱的暖自发光防死黑，区色交给墙根光带与壁灯。
      floorMat.emissive = new THREE.Color('#2a2118');
      floorMat.emissiveIntensity = 0.03;
      const floor = new THREE.Mesh(built.floor, floorMat);
      floor.receiveShadow = true;
      floor.userData.role = 'corridorFloor';
      const shell = new THREE.Mesh(built.shell, shellMat);
      shell.userData.role = 'corridorShell';
      shell.receiveShadow = true;
      group.add(floor, shell);
      // 批 16：两侧墙根的学科色发光带（贴地薄板）。走廊的区色识别靠它 + 壁灯，
      // 不再靠整块地板自发光——地板的绿会在近处变成一条荧光跑道。
      const stripLen = ROOM_DIST - d0 - 8;
      // 光带自身亮度必须压在 bloom 阈值 0.45 以下：原来直接用满色 + 0.55 不透明，
      // 亮度越过阈值后泛光把整条走廊地面晕成一片墨绿（实测）。
      const stripColor = new THREE.Color(r.color).multiplyScalar(0.55);
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(stripLen, 0.02, 0.42),
          new THREE.MeshBasicMaterial({ color: stripColor, transparent: true, opacity: 0.5 }),
        );
        const th = Math.atan2(-dirV.z, dirV.x);
        strip.rotation.y = th;
        strip.position.copy(
          dirV.clone().multiplyScalar(d0 + 4 + stripLen / 2).addScaledVector(lat, side * (CORRIDOR_W / 2 - 0.3)),
        );
        strip.position.y = 0.03;
        strip.userData.role = 'corridorStrip';
        group.add(strip);
      }

      // 地面铭牌：文字沿走廊走向铺，正对视角即横排可读
      const tex = nameplateTexture(r.title, r.key.toUpperCase(), r.color);
      const img = tex.image as HTMLCanvasElement | null;
      const aspect = img && img.width ? img.height / img.width : 0.22;
      // 批 17：走廊地面学科名原来铺满 44 米（走廊全长 93 米），站进走廊等于踩在一面巨大的
      // 荧光字上，近看糊、还越 bloom 阈值。收到 22 米、压到 0.72 不透明 + 灰化，
      // 长廊里它退回成「地上的一块标识」而不是第二块地板。
      const bandW = Math.min(built.length * 0.32, 22);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(bandW, bandW * aspect),
        new THREE.MeshBasicMaterial({
          map: tex,
          color: 0x8f8f8f,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      plate.rotation.order = 'YXZ';
      plate.rotation.x = -Math.PI / 2;
      const dir = new THREE.Vector3(Math.cos(r.angle), 0, Math.sin(r.angle));
      // 让文字基线沿走廊走向、且从大厅看是正字（与批 7 同一条翻转判据）
      const flip = dir.x < 0 ? -1 : 1;
      plate.rotation.y = Math.atan2(-dir.z * flip, dir.x * flip);
      plate.position.set(built.plate.center[0], 0.12, built.plate.center[2]);
      plate.userData.role = 'corridorName';
      this.nameplates.set(r.key, plate);
      this.corridorMeshes.set(r.key, plate);
      this.corridorNames.push(r.title);
      group.add(plate);
      out.push([r.key, group]);
    }
    if (lampGeos.length) {
      const merged = mergeGeometries(lampGeos);
      lampGeos.forEach((g) => g.dispose());
      const lamps = new THREE.Mesh(
        merged,
        new THREE.MeshBasicMaterial({ color: 0xffdfae, side: THREE.DoubleSide }),
      );
      lamps.userData.role = 'corridorLamps';
      this.hall.add(lamps);
    }
    shelfGeo.dispose();
    ceilingLampGeo.dispose();
    if (shelfGeos.length) {
      const merged = mergeGeometries(shelfGeos);
      shelfGeos.forEach((g) => g.dispose());
      const shelves = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({
          color: 0x33241a,
          roughness: 0.88,
          metalness: 0.05,
          emissive: 0x2e2013,
          emissiveIntensity: 0.30,
        }),
      );
      shelves.userData.role = 'corridorShelves';
      this.hall.add(shelves);
    }
    spinePlates.forEach((geos, zi) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      const spines = new THREE.Mesh(
        merged,
        new THREE.MeshBasicMaterial({ map: bookRowTexture(ROOMS[zi].color, zi + 3) }),
      );
      spines.userData.role = 'corridorSpines';
      this.hall.add(spines);
    });
    if (ceilingLampGeos.length) {
      const merged = mergeGeometries(ceilingLampGeos);
      ceilingLampGeos.forEach((g) => g.dispose());
      const ceiling = new THREE.Mesh(
        merged,
        new THREE.MeshBasicMaterial({ color: 0xffd9a6 }),
      );
      ceiling.userData.role = 'corridorCeilingLamps';
      this.hall.add(ceiling);
    }
    return out;
  }

  // ---------------------------------------------------------------- 本区构建与释放

  /* ================================================================ 批 11：第一人称漫游 */

  /**
   * 碰撞体清单 + 准星 + 摇杆。八角厅与六条走廊是静态的，构造期一次算好；
   * 阅览室的盒子跟着本区 plan 走（side 按书量在 20–40 之间变），在 enterRoom 里重建。
   */
  private buildWalkRig(): void {
    this.hallColliders = hallBlockers(this.corridorAxes());
    const cross = document.createElement('div');
    cross.className = 'crosshair';
    cross.hidden = true;
    cross.setAttribute('data-crosshair', '1');
    const h = document.createElement('i');
    const v = document.createElement('i');
    const dot = document.createElement('i');
    dot.className = 'dot';
    cross.append(h, v, dot);
    this.root.appendChild(cross);
    this.crosshair = cross;

    const stick = document.createElement('div');
    stick.className = 'stick';
    stick.hidden = true;
    stick.setAttribute('data-stick', '1');
    const knob = document.createElement('i');
    knob.className = 'knob';
    stick.appendChild(knob);
    this.root.appendChild(stick);
    this.stick = stick;
    this.stickKnob = knob;

    // 批 11 F：漫游专用的大厅地面材质。俯瞰那张是「总览平面图」——1024 摊到 88 单位见方
    // 只有 11.6 texel/单位，加上 0.9 自发光，站到 1.65 眼高上就是一张糊白的地名图。
    // 批 14：石板底色从冷蓝灰改成暖石，粗糙度抬到 0.74、envMapIntensity 压到 0.24——
    // 原来 0.58/0.65 让 PMREM 环境把整块地面洗成一片浅灰白，远景地平线直接跟星空对切。
    const stone = stoneTexture('#3a332b', '#1a1712');
    const floorTex = stone.clone();
    floorTex.repeat.set(14, 14);
    floorTex.needsUpdate = true;
    this.walkTextures.push(floorTex);
    this.walkFloorMat = new THREE.MeshStandardMaterial({
      map: floorTex, roughness: 0.74, metalness: 0.06, envMapIntensity: 0.24,
      emissive: new THREE.Color('#171310'), emissiveIntensity: 0.08,
    });
    const groundTex = stone.clone();
    // 场地的 UV 本来就按 26 单位一瓦片铺（比大厅地面还糊），再切 4 份 → 6.5 单位一瓦片
    groundTex.repeat.set(4, 4);
    groundTex.needsUpdate = true;
    this.walkTextures.push(groundTex);
    this.walkGroundMat = new THREE.MeshStandardMaterial({
      map: groundTex, color: new THREE.Color(1.35, 1.35, 1.4), roughness: 0.95, metalness: 0.04, envMapIntensity: 0.25,
    });
  }

  /** 漫游进出只换大厅两块地面的材质引用；房间视角下大厅本就隐藏，不必换 */
  private applyWalkSurfaces(on: boolean): void {
    const walk = on && this.view === 'hall';
    if (this.hallFloorMesh && this.walkFloorMat && this.orbitHallFloorMat) {
      this.hallFloorMesh.material = walk ? this.walkFloorMat : this.orbitHallFloorMat;
    }
    if (this.groundMesh && this.walkGroundMat && this.orbitGroundMat) {
      this.groundMesh.material = walk ? this.walkGroundMat : this.orbitGroundMat;
    }
    if (on && !this.walkMatsBuilt) {
      this.walkMatsBuilt = true;
      this.buildWalkMats();
    }
    for (const p of this.walkMatPairs) p.mesh.material = walk ? p.walk : p.orbit;
  }

  /**
   * 批 11 F：给大厅内壁 / 天花 / 藻井 / 走廊壳 / 六栋外壳各做一份「把反弹光烘进表面」的漫游变体。
   * 俯瞰口径里这些面吃主光与总览图自发光就够（批 10 的门洞内外差 64.9 就是那套数），
   * 但站到 1.65 眼高上它们全是死黑——竖直内壁吃不到主光、天花法线朝下只吃地面色。
   * 加灯要多算片元（批 9 试过，2.7× 帧时），所以走同图 emissive 这条路，退出即换回原材质。
   */
  private buildWalkMats(): void {
    const want: Record<string, number> = {
      hallWall: 0.17, hallCeiling: 0.17, hallCoffer: 0.14, corridorShell: 0.13, facades: 0.11,
    };
    this.scene.traverse((o) => {
      const role = String(o.userData.role ?? '');
      const k = want[role];
      if (k === undefined) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat?.isMeshStandardMaterial || mat.emissiveMap) return;
      const walk = mat.clone();
      walk.emissive = new THREE.Color(0xffe9c9);
      walk.emissiveMap = mat.map ?? null;
      walk.emissiveIntensity = k;
      this.walkMatPairs.push({ mesh, orbit: mat, walk });
      this.walkMats.push(walk);
    });
  }

  /** 六条走廊的轴向：from = 八角墙内皮，to = 阅览室门墙外沿（与 buildCorridor 同一条式子） */
  private corridorAxes(): CorridorAxis[] {
    return ROOMS.map((r) => ({
      angle: r.angle,
      from: HALL_RADIUS - 0.4,
      to: ROOM_DIST - FACADE_SIDE / 2 - 0.5,
    }));
  }

  /** 本区碰撞体：四面外墙（门洞拆开）+ 三排书架 + 通往大厅的那条走廊（管口封住） */
  private buildRoomColliders(plan: RoomPlan): Blocker[] {
    const spec = ROOM_BY_KEY[plan.discipline];
    const axis = this.corridorAxes().find((a) => Math.abs(a.angle - spec.angle) < 1e-6);
    const list = roomBlockers(plan, this.room.position, this.room.rotation.y, axis ?? {
      angle: spec.angle,
      from: HALL_RADIUS - 0.4,
      to: ROOM_DIST - FACADE_SIDE / 2 - 0.5,
    });
    const nb = this.neighbor;
    if (!nb) return list;
    const half = plan.side / 2;
    const pos = this.room.position;
    const yaw = this.room.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const toLocal = (wx: number, wz: number): [number, number] => [
      (wx - pos.x) * cos - (wz - pos.z) * sin,
      (wx - pos.x) * sin + (wz - pos.z) * cos,
    ];
    // 摘掉原来那面「通长侧墙」，换成门洞两侧两段
    const wi = list.findIndex((b) => {
      if (b.kind !== 'roomWall') return false;
      const [lx, lz] = toLocal(b.cx, b.cz);
      return Math.abs(lx - nb.side * half) < 0.02 && Math.abs(lz) < 0.02;
    });
    if (wi >= 0) list.splice(wi, 1);
    const push = (lx: number, lz: number, hx: number, hz: number, kind: Blocker['kind']): void => {
      list.push({
        cx: pos.x + lx * cos + lz * sin,
        cz: pos.z - lx * sin + lz * cos,
        hx,
        hz,
        yaw,
        y0: 0,
        y1: 1e6,
        kind,
      });
    };
    const h = WALL_T / 2;
    const seal = 0.6;
    // 侧墙两段：延伸到 z=±(half+seal) 与前后墙搭接，门洞 z0..z1 完全留空
    const zLo = -half - seal;
    const zHi = half + seal;
    push(nb.side * half, (zLo + nb.z0) / 2, h, (nb.z0 - zLo) / 2, 'roomWall');
    push(nb.side * half, (nb.z1 + zHi) / 2, h, (zHi - nb.z1) / 2, 'roomWall');
    // 短廊两侧墙与尽头封墙：不封就穿到房间外的空地
    const xMid = nb.side * (half + NEIGHBOR.len / 2);
    push(xMid, nb.z0 - h, NEIGHBOR.len / 2, h, 'corridorWall');
    push(xMid, nb.z1 + h, NEIGHBOR.len / 2, h, 'corridorWall');
    push(nb.side * (half + NEIGHBOR.len + h), nb.zc, h, NEIGHBOR.w / 2 + h, 'corridorEnd');
    return list;
  }

  /**
   * 批 18：环序下一区的侧门数据。门开在哪面侧墙由「下一区相对本区的归一化转角」推导：
   * 房间本地 +X 正好是顺时针切向，所以顺时针下一区开在 +X（layout 的 right 墙），
   * 逆时针开在 −X（left 墙）。门洞放在侧墙靠后 1/3（z1=half−0.6、宽 3.2），
   * 整排侧书架往前挪 1.8；书位、书脊、光尘都是同一批对象，跟着一起挪，计数不变。
   */
  private prepareNeighbor(plan: RoomPlan, discipline: Discipline): NeighborDoor {
    const idx = ROOMS.findIndex((r) => r.key === discipline);
    const to = ROOMS[(idx + 1) % ROOMS.length]?.key ?? ROOMS[0].key;
    const fromAngle = ROOM_BY_KEY[discipline].angle;
    const toAngle = ROOM_BY_KEY[to].angle;
    let turn = toAngle - fromAngle;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn <= -Math.PI) turn += Math.PI * 2;
    const side: 1 | -1 = turn < 0 ? 1 : -1;
    const wall: 'left' | 'right' = side > 0 ? 'right' : 'left';
    const half = plan.side / 2;
    const z1 = half - NEIGHBOR.rear;
    const z0 = z1 - NEIGHBOR.w;
    const zc = (z0 + z1) / 2;

    // 先按移动前的坐标认领光尘，再和书架一起挪，免得光尘留在门洞里
    const keys = new Set<string>();
    for (const sp of plan.spines) {
      const slot = plan.slots[sp.slot];
      if (slot?.wall !== wall) continue;
      for (const c of sp.chapter.concepts) {
        keys.add(`${slot.book.repo}\u0000${slot.book.bookSlug}\u0000${c.id}`);
      }
    }
    const dustMove: number[] = [];
    if (keys.size) {
      for (let i = 0; i < plan.dust.length; i += 1) {
        const d = plan.dust[i];
        if (keys.has(`${d.book.repo}\u0000${d.book.bookSlug}\u0000${d.conceptId}`)) dustMove.push(i);
      }
    }
    const shift = NEIGHBOR.shelfShift;
    const row = plan.rows.find((r) => r.wall === wall);
    if (row) row.z -= shift;
    for (const slot of plan.slots) if (slot.wall === wall) slot.cz -= shift;
    for (const sp of plan.spines) {
      const slot = plan.slots[sp.slot];
      if (slot?.wall === wall) sp.z -= shift;
    }
    for (const i of dustMove) plan.dust[i].z -= shift;

    return {
      to,
      side,
      wall,
      z0,
      z1,
      zc,
      wallPatch: neighborWallPatch(side, half, plan.height, z0, z1),
      corridor: neighborCorridor(side, half, z0, z1, NEIGHBOR.len),
      strip: neighborStrip(side, half, z0, z1, zc),
      floorGlow: neighborFloorGlow(side, half, z0, z1),
      plate: neighborPlate(side, half, zc),
      plateLocal: [side * (half + NEIGHBOR.len - 0.03), 2.3, zc],
      landingLocal: [side * (half - NEIGHBOR.landingIn), WALK.eye, zc],
      plateWorld: new THREE.Vector3(),
      landingWorld: new THREE.Vector3(),
      landingYaw: 0,
    };
  }

  /** 漫游每帧调用：只有站在短廊尽头、冷却与落地静默都过了，才触发 */
  private neighborTick(now: number): void {
    const nb = this.neighbor;
    if (!nb || this.camMode !== 'walk' || this.view !== 'room') return;
    if (this.neighborLock || this.neighborPending) return;
    if (now < this.neighborCooldownUntil) return;
    if (now - this.neighborLandingAt < NEIGHBOR.settleMs) return;
    const dx = this.camera.position.x - nb.plateWorld.x;
    const dz = this.camera.position.z - nb.plateWorld.z;
    if (dx * dx + dz * dz > NEIGHBOR.trigger * NEIGHBOR.trigger) return;
    this.beginNeighborTransition();
  }

  private beginNeighborTransition(): void {
    const nb = this.neighbor;
    if (!nb || this.neighborLock || this.neighborPending) return;
    this.neighborLock = true;
    this.neighborPending = nb.to;
    this.setFade(true);
    window.clearTimeout(this.neighborTimer);
    // 等黑场盖住再切区：淡出 250ms，多留一帧给合成器
    this.neighborTimer = window.setTimeout(() => {
      this.neighborTimer = 0;
      if (this.neighborPending !== nb.to) return;
      this.hooks.onPickRoom(nb.to);
    }, NEIGHBOR.fadeMs + 16);
    window.clearTimeout(this.neighborSafety);
    this.neighborSafety = window.setTimeout(() => {
      this.neighborSafety = 0;
      if (this.neighborPending) {
        this.neighborCooldownUntil = performance.now() + NEIGHBOR.cooldownMs;
        this.cancelNeighbor('邻区加载超时，已留在当前房间');
      }
    }, NEIGHBOR.safetyMs);
  }

  /**
   * 目标区建完后的收尾：pending 对上才落位。除了落位，还要等两帧再淡入——
   * 新房间的几何是同帧建好的，但相机矩阵与首帧渲染要下一帧才生效。
   * 两层 rAF 里任一层被节流，还有 500ms 兜底；不管哪种都只执行一次。
   */
  private finishNeighborEntry(plan: RoomPlan): void {
    if (this.neighborPending !== plan.discipline) return;
    this.neighborPending = null;
    window.clearTimeout(this.neighborTimer);
    this.neighborTimer = 0;
    window.clearTimeout(this.neighborSafety);
    this.neighborSafety = 0;
    window.clearTimeout(this.neighborUnlock);
    this.neighborUnlock = 0;
    const nb = this.neighbor;
    // 目标区自己的 side door 通往它的下一区，与本区无关；这里只核对「确有侧门可落位」
    if (this.camMode !== 'walk' || !nb) {
      this.neighborLock = false;
      this.setFade(false, true);
      this.neighborCooldownUntil = performance.now() + NEIGHBOR.cooldownMs;
      return;
    }
    // 落位在目标区自己那扇侧门内侧 1 米，脸朝房间中心；walkDrop 会用 roomColliders 推开
    const at = nb.landingWorld.clone();
    this.walkDrop(at, nb.landingYaw);
    this.camera.rotation.set(0, nb.landingYaw, 0);
    const now = performance.now();
    this.neighborLandingAt = now;
    this.neighborCooldownUntil = now + NEIGHBOR.cooldownMs;
    this.wake();
    let revealed = false;
    const reveal = (): void => {
      if (revealed) return;
      revealed = true;
      window.clearTimeout(this.neighborUnlock);
      this.neighborUnlock = 0;
      this.neighborLock = false;
      this.setFade(false);
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
    this.neighborUnlock = window.setTimeout(reveal, 500);
  }

  /** 取消在途切换：清计时器、把黑场直接归零（不留半透明残留） */
  private cancelNeighbor(hint?: string): void {
    if (this.neighborTimer) {
      window.clearTimeout(this.neighborTimer);
      this.neighborTimer = 0;
    }
    if (this.neighborSafety) {
      window.clearTimeout(this.neighborSafety);
      this.neighborSafety = 0;
    }
    if (this.neighborUnlock) {
      window.clearTimeout(this.neighborUnlock);
      this.neighborUnlock = 0;
    }
    this.neighborPending = null;
    this.neighborLock = false;
    if (this.neighborFade) {
      this.neighborFade.style.transition = 'none';
      this.neighborFade.style.opacity = '0';
      // 强制回流，把「直接归零」落进样式；下次 setFade(true) 才重新吃到过渡
      void this.neighborFade.offsetWidth;
      this.neighborFade.style.transition = `opacity ${NEIGHBOR.fadeMs}ms linear`;
    }
    if (hint) this.hooks.onHud(hint);
  }

  /* ---------------------------------------------------- 批 20：正门走路进出 */

  /**
   * 漫游每帧调用。只认「真实移动输入」（WASD 或摇杆在场）：
   * 调试用的 walkSnap / walkMarch 是同步摆位，不经过 walkStep，不能因此把人传走，
   * 现有门槛里「六向 march 到门面」与「房内按 W 穿过 7.2 门洞」两条语义也就保住了。
   * 只用水平距离/房间局部坐标，不发射线，门楣与书架不参与判定。
   */
  private doorTick(now: number): void {
    if (this.camMode !== 'walk') return;
    if (this.frontLock || this.frontPending) return;
    if (this.neighborLock || this.neighborPending) return;
    const ready = now >= this.frontCooldownUntil && now - this.frontLandingAt >= NEIGHBOR.settleMs;
    if (this.view === 'hall') {
      if (!ready || !this.walkInputActive()) return;
      for (const r of ROOMS) {
        const dx = this.camera.position.x - Math.cos(r.angle) * FRONT_DOOR.planeR;
        const dz = this.camera.position.z - Math.sin(r.angle) * FRONT_DOOR.planeR;
        if (dx * dx + dz * dz > FRONT_DOOR.enterR * FRONT_DOOR.enterR) continue;
        this.beginFrontEntry(r.key);
        return;
      }
      return;
    }
    if (this.view !== 'room' || !this.plan || !this.frontArmed) return;
    // 世界 → 房间局部：与 roomBlockers / buildRoomColliders 的 toLocal 同一套绕 Y 约定
    const half = this.plan.side / 2;
    const pos = this.room.position;
    const th = this.room.rotation.y;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const wx = this.camera.position.x - pos.x;
    const wz = this.camera.position.z - pos.z;
    const lx = wx * c - wz * s;
    const lz = wx * s + wz * c;
    if (lz >= -half) {
      this.frontExitLatch = false;
      return;
    }
    // 已跨出正门墙：门洞外侧 1.5 米内记一次「真要出去」；冷却/静默期间继续等，人还在门外就补切
    if (Math.abs(lx) <= ROOM_DOOR.w / 2 && lz >= -half - FRONT_DOOR.exitDepth) this.frontExitLatch = true;
    if (!this.frontExitLatch || !ready || !this.walkInputActive()) return;
    this.beginFrontExit();
  }

  /** 真实移动输入：键盘四向任一，或摇杆越过死区 */
  private walkInputActive(): boolean {
    const k = this.keys;
    return k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD')
      || Math.hypot(this.stickVec.x, this.stickVec.y) > 0.05;
  }

  /** 厅侧：人走到门前 2 米内 → 交给 main 的 enterRoom 建区，并带上「门内 3 米」落位 */
  private beginFrontEntry(key: Discipline): void {
    const spec = ROOM_BY_KEY[key];
    const rr = FRONT_DOOR.planeR + FRONT_DOOR.dropIn;
    const landing: WalkLanding = {
      x: Math.cos(spec.angle) * rr,
      z: Math.sin(spec.angle) * rr,
      // 脸朝房间中心（= 沿走廊继续向外的径向）；yawToward(dx,dz) 面向 (dx,dz)
      yaw: this.yawToward(Math.cos(spec.angle), Math.sin(spec.angle)),
    };
    this.frontLock = true;
    this.frontPending = key;
    this.hooks.onPickRoom(key, landing);
    window.clearTimeout(this.frontSafety);
    this.frontSafety = window.setTimeout(() => {
      this.frontSafety = 0;
      if (this.frontPending === key) this.cancelFrontDoor('门前加载超时，已留在大厅');
    }, NEIGHBOR.safetyMs);
  }

  /** 房间侧：穿过正门走到门外触发带 → 交给 main 的 showHall，并带上「门外 3 米」落位 */
  private beginFrontExit(): void {
    const plan = this.plan;
    if (!plan) return;
    const spec = ROOM_BY_KEY[plan.discipline];
    const rr = FRONT_DOOR.planeR - FRONT_DOOR.dropOut;
    const landing: WalkLanding = {
      x: Math.cos(spec.angle) * rr,
      z: Math.sin(spec.angle) * rr,
      // 脸朝大厅（径向朝内）
      yaw: this.yawToward(-Math.cos(spec.angle), -Math.sin(spec.angle)),
    };
    this.frontExitLatch = false;
    this.frontArmed = false;
    this.frontLock = true;
    this.hooks.onShowHall?.(landing);
    this.frontLock = false;
  }

  /** 目标区建好：清在途标记，并按落位重新起算冷却与落地静默 */
  private finishFrontEntry(plan: RoomPlan): void {
    if (this.frontPending !== plan.discipline) return;
    this.frontPending = null;
    this.frontLock = false;
    if (this.frontSafety) {
      window.clearTimeout(this.frontSafety);
      this.frontSafety = 0;
    }
    const now = performance.now();
    this.frontLandingAt = now;
    this.frontCooldownUntil = now + NEIGHBOR.cooldownMs;
    this.frontExitLatch = false;
  }

  private cancelFrontDoor(hint?: string): void {
    if (this.frontSafety) {
      window.clearTimeout(this.frontSafety);
      this.frontSafety = 0;
    }
    this.frontPending = null;
    this.frontLock = false;
    if (hint) this.hooks.onHud(hint);
  }

  /** 过渡黑场：只在第一次用到时建一个 div，保留在 DOM 里复用（dispose 时移除） */
  private fadeEl(): HTMLDivElement {
    if (this.neighborFade) return this.neighborFade;
    const d = document.createElement('div');
    d.setAttribute('data-neighbor-fade', '1');
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = [
      'position:absolute',
      'inset:0',
      // 压在准星/摇杆（z2）之上、阅读面板（z3）之下：面板正开着时切区也不遮内容
      'z-index:2',
      'background:#06080b',
      'opacity:0',
      'pointer-events:none',
      `transition:opacity ${NEIGHBOR.fadeMs}ms linear`,
    ].join(';');
    this.root.appendChild(d);
    this.neighborFade = d;
    return d;
  }

  private setFade(on: boolean, instant = false): void {
    const d = this.fadeEl();
    if (instant) {
      d.style.transition = 'none';
      d.style.opacity = on ? '1' : '0';
      void d.offsetWidth;
      d.style.transition = `opacity ${NEIGHBOR.fadeMs}ms linear`;
      return;
    }
    // 新建层如果当帧就置 1，浏览器会合并成「初始即 1」而没有过渡；先强制回流
    void d.offsetWidth;
    d.style.opacity = on ? '1' : '0';
  }

  private walkForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw));
  }

  /** 看向世界水平方向 (dx,dz) 所需的 yaw */
  private yawToward(dx: number, dz: number): number {
    return Math.atan2(-dx, -dz);
  }

  private syncWalkTarget(): void {
    const fw = this.walkForward(TEMP_A);
    this.controls.target.copy(this.camera.position).addScaledVector(fw, WALK_AHEAD);
  }

  /**
   * 进入 walk 的落位。大厅 = 中央厅地面、朝第一个门洞；
   * 分区 = 离当前机位最近的那排书架前的过道、脸对着书脊（1.65 正好平视最下一排）。
   */
  private walkSpawn(): { at: THREE.Vector3; yaw: number } {
    if (this.view === 'hall' || !this.plan) {
      const first = ROOMS[0];
      // 批 12：贴着台体外沿站定、脸朝第一条走廊。站在厅心等于站在台体里；落位环既退得出碰撞，
      // 又让「转身看台面」与「正向走走廊」都是真实视线。
      return {
        at: new THREE.Vector3(
          Math.cos(first.angle) * ATRIUM.standR,
          WALK.eye,
          Math.sin(first.angle) * ATRIUM.standR,
        ),
        yaw: this.yawToward(Math.cos(first.angle), Math.sin(first.angle)),
      };
    }
    const plan = this.plan;
    // 刚摆过机位的房间 matrixWorld 还是上一帧的，落位点会算到旧位置上
    this.room.updateMatrixWorld();
    let best: { at: THREE.Vector3; yaw: number; d: number } | null = null;
    for (const row of plan.rows) {
      const gap = SHELF_DEPTH / 2 + 1.15;
      const p = this.localToWorld([
        row.x + row.normal[0] * gap,
        WALK.eye,
        row.z + row.normal[1] * gap,
      ]);
      const fw = this.localToWorld([
        row.x + row.normal[0] * (gap + 1),
        WALK.eye,
        row.z + row.normal[1] * (gap + 1),
      ]).sub(p).setY(0);
      const d = p.distanceTo(this.camera.position);
      if (!best || d < best.d) best = { at: p, yaw: this.yawToward(fw.x, fw.z), d };
    }
    return best ?? { at: new THREE.Vector3(0, WALK.eye, 0), yaw: 0 };
  }

  /** 眼高所在水平面之外的兜底：落位点若被盒子吃了，沿盒子法线推到面上 */
  private walkDrop(at: THREE.Vector3, yaw: number): void {
    this.colliders = this.view === 'hall' ? this.hallColliders : this.roomColliders;
    at.y = WALK.eye;
    // 落点若被台体吃了，沿**朝向**退出：圆柱轴心没有「外侧」可依，不给方向就会每次换个方向抖
    settle(at, this.colliders, [-Math.sin(yaw), -Math.cos(yaw)]);
    this.camera.position.copy(at);
    this.walkYaw = yaw;
    this.walkPitch = 0;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, yaw, 0);
    this.syncWalkTarget();
  }

  setWalk(on: boolean): boolean {
    if (on === (this.camMode === 'walk')) return false;
    if (on) {
      this.orbitReturn = this.currentPose();
      this.camMode = 'walk';
      // OrbitControls 关掉：它的 update() 每帧都会 camera.lookAt(target)，与 yaw/pitch 打架
      this.controls.enabled = false;
      const spot = this.walkSpawn();
      this.walkDrop(spot.at, spot.yaw);
      this.applyWalkSurfaces(true);
      this.hideTip();
      this.wake();
      this.hooks.onHud(this.walkHint(null));
    } else {
      this.camMode = 'orbit';
      this.colliders = [];
      this.applyWalkSurfaces(false);
      this.exitPointerLock();
      this.stickId = null;
      this.lookId = null;
      this.stickVec = { x: 0, y: 0 };
      this.controls.enabled = true;
      this.camera.rotation.order = 'XYZ';
      this.applyPose(this.orbitReturn ?? this.hallDefaultPose());
      this.orbitReturn = null;
      this.resetInertia();
      this.aimHit = null;
      this.updateControls();
      this.wake();
      this.hooks.onHud(this.hudDefault());
    }
    this.updateWalkUi();
    this.hooks.onCamMode?.(this.camMode === 'walk');
    return true;
  }

  toggleWalk(): boolean {
    const on = this.camMode !== 'walk';
    const ok = this.setWalk(on);
    // 用户手势进漫游（F 键 / 「走进」按钮）时武装正门回大厅：即便这间房是俯瞰点选的，
    // 切到第一人称后也该能从正门走回大厅。诊断 API 直调 setWalk 不走这里，门槛里的
    // 「房内按 W 穿过门洞仍停在房内」检查点语义不变。
    if (ok && on && this.view === 'room') this.frontArmed = true;
    return ok;
  }

  camModeName(): 'orbit' | 'walk' {
    return this.camMode;
  }

  /**
   * 漫游途中切了视图（点学科条、搜索跳转、点书脊开书）：
   * 把这次视图切换本来的俯瞰机位接成新的退出点，人重新落到新视图的地面上。
   * 批 20：带 landing 时（走正门进出）用门边落位，否则仍是原来的默认落点。
   */
  private rewalkAfterViewSwitch(landing?: WalkLanding | null): void {
    if (this.camMode !== 'walk') return;
    const spot = landing
      ? { at: new THREE.Vector3(landing.x, WALK.eye, landing.z), yaw: landing.yaw }
      : this.walkSpawn();
    this.walkDrop(spot.at, spot.yaw);
    this.applyWalkSurfaces(true);
    this.updateWalkUi();
    this.hooks.onHud(this.walkHint(null));
  }

  /** 大厅默认机位（无存档位姿时的落点，也是漫游途中的退出点兜底） */
  private hallDefaultPose(): CameraPose {
    const def = this.hallPose();
    return { px: def[0], py: def[1], pz: def[2], tx: 0, ty: 0, tz: 0 };
  }

  private walkHint(hit: Pick | null): string {
    if (hit) return this.tipText(hit);
    // 批 16：鼠标点一下就把指针锁进画布，之后纯靠鼠标转头（Esc 解锁）
    const lock = this.pointerLocked ? 'Esc 解锁鼠标' : '单击画面锁定鼠标转头';
    if (this.view !== 'hall') {
      return `第一人称 · WASD 走动 · Shift 疾走 · ${lock} · 准星对准书脊点击读正文 · F 退出`;
    }
    // 批 12：近台给索引台口径，远台给「台面 + 展柜」两条视线落点
    return this.deskNear
      ? '六区索引 · 准星选扇区 · 点击进入该区 · F 退出'
      : `第一人称 · WASD 走动 · ${lock} · 台面选六区 · F 退出`;
  }

  private updateWalkUi(): void {
    const walk = this.camMode === 'walk';
    if (this.crosshair) {
      this.crosshair.hidden = !walk;
      this.crosshair.classList.toggle('on-target', walk && Boolean(this.aimHit));
    }
    if (this.stick && !walk) this.stick.hidden = true;
  }

  /** 准星命中每 3 帧算一次：射线要过 3 页合并几何（每页 ~3k 三角），逐帧太贵 */
  private aimFrame = 0;

  private aimUpdate(): void {
    this.aimFrame = (this.aimFrame + 1) % 3;
    if (this.aimFrame !== 0) return;
    this.refreshAim();
  }

  /** 准星拾取一次，把结果同步到 HUD 与准星高亮态。`force` 用于探针（不等变化沿） */
  private refreshAim(force = false): void {
    // 射线取的是 camera.matrixWorld：瞬移（探针 snap、进出房间、退出漫游）后矩阵还没更新，
    // 不补这一下就会拿上一帧的朝向算准星，读到的是「转身之前」的目标
    this.camera.updateMatrixWorld();
    const hit = this.pickAt(CENTER_NDC);
    this.syncAtrium(hit);
    const same = (hit?.kind ?? '') === (this.aimHit?.kind ?? '')
      && (hit?.book?.file ?? '') === (this.aimHit?.book?.file ?? '')
      && (hit?.id ?? '') === (this.aimHit?.id ?? '');
    if (same && !force && !this.hudStale) return;
    this.hudStale = false;
    this.aimHit = hit;
    this.hooks.onHud(hit ? this.tipText(hit) : this.walkHint(null));
    if (this.crosshair) this.crosshair.classList.toggle('on-target', Boolean(hit));
  }

  /** 按住键走位 + 滑动碰撞。返回本帧位移，供取证读 */
  private walkStep(dt: number): number {
    const k = this.keys;
    let fwd = 0;
    let strafe = 0;
    if (k.has('KeyW')) fwd += 1;
    if (k.has('KeyS')) fwd -= 1;
    if (k.has('KeyD')) strafe += 1;
    if (k.has('KeyA')) strafe -= 1;
    fwd += this.stickVec.y;
    strafe += this.stickVec.x;
    const mag = Math.hypot(fwd, strafe);
    if (mag > 1) {
      fwd /= mag;
      strafe /= mag;
    }
    const moved = mag > 1e-6;
    // 疾走只由 Shift 键状态决定（onKeyUp / onBlur 负责复位）。
    // 曾写 this.sprint = this.sprint && moved：Shift 与 W 之间只要插进一帧“只按 Shift”的空帧，
    // moved 为假就把 sprint 清掉，之后按 W 也只剩步行速度（批 14 门槛 ratio 1.00 即此因）。
    if (!moved) return 0;
    const step = WALK.speed * (this.sprint ? WALK.sprint : 1) * Math.min(dt, 0.05);
    const dir = this.walkForward(TEMP_A);
    const right = TEMP_B.crossVectors(dir, UP_Y).normalize();
    const before = TEMP_C.copy(this.camera.position);
    this.camera.position.addScaledVector(dir, fwd * step).addScaledVector(right, strafe * step);
    this.camera.position.y = WALK.eye;
    resolveSlide(this.camera.position, this.colliders, WALK.radius, WALK.stand, before);
    this.camera.position.y = WALK.eye;
    const d = this.camera.position.distanceTo(before);
    if (this.walkTracing) {
      this.walkTrace.push({
        t: performance.now(),
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
        yaw: this.walkYaw,
      });
      if (this.walkTrace.length > 2000) this.walkTrace.shift();
    }
    return d;
  }

  /* ---------------------------------------------------- 摇杆 / 转头指针分派 */

  private beginStick(ev: PointerEvent): void {
    this.stickId = ev.pointerId;
    this.stickOrigin = { x: ev.clientX, y: ev.clientY };
    this.stickVec = { x: 0, y: 0 };
    const stick = this.stick;
    const knob = this.stickKnob;
    if (!stick || !knob) return;
    const rect = this.root.getBoundingClientRect();
    stick.style.left = `${ev.clientX - rect.left - WALK.stickPx}px`;
    stick.style.top = `${ev.clientY - rect.top - WALK.stickPx}px`;
    stick.style.right = 'auto';
    stick.style.bottom = 'auto';
    knob.style.transform = 'translate(-50%, -50%)';
    stick.hidden = false;
  }

  private moveStick(ev: PointerEvent): void {
    const dx = ev.clientX - this.stickOrigin.x;
    const dy = ev.clientY - this.stickOrigin.y;
    let ux = dx / WALK.stickPx;
    let uy = -dy / WALK.stickPx;
    const m = Math.hypot(ux, uy);
    if (m > 1) {
      ux /= m;
      uy /= m;
    }
    // 死区：手指在原点附近抖不该让人往前挪
    if (Math.hypot(ux, uy) < WALK.stickDead) {
      ux = 0;
      uy = 0;
    } else {
      const s = (Math.hypot(ux, uy) - WALK.stickDead) / (1 - WALK.stickDead);
      const a = Math.atan2(uy, ux);
      ux = Math.cos(a) * s;
      uy = Math.sin(a) * s;
    }
    this.stickVec = { x: ux, y: uy };
    if (this.stickKnob) {
      this.stickKnob.style.transform =
        `translate(calc(-50% + ${Math.round(ux * WALK.stickPx * 0.62)}px), calc(-50% + ${Math.round(-uy * WALK.stickPx * 0.62)}px))`;
    }
  }

  private endStick(): void {
    this.stickId = null;
    this.stickVec = { x: 0, y: 0 };
    if (this.stickKnob) this.stickKnob.style.transform = 'translate(-50%, -50%)';
    if (this.stick) this.stick.hidden = true;
  }

  /** 拖拽转头： yaw 无限、pitch 夹在 ±70°（不夹到 90° 就不会翻转万向锁） */
  private applyLook(dx: number, dy: number): void {
    this.walkYaw -= dx * WALK.lookPerPx;
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, this.walkPitch - dy * WALK.lookPerPx));
  }

  /* --------------------------------------------------------- 自检取证专用 */

  /** 走位轨迹开关：门槛用它算「按住 W 一秒位移 ≈ 3.2」与「门洞穿过去」的位置序列 */
  walkTraceStart(): void {
    this.walkTrace = [];
    this.walkTracing = true;
  }

  walkTraceStop(): {
    samples: number;
    pathLen: number;
    net: number;
    seconds: number;
    dyMax: number;
    driftDeg: number;
    start: [number, number, number] | null;
    end: [number, number, number] | null;
  } {
    this.walkTracing = false;
    const p = this.walkTrace;
    let pathLen = 0;
    let dyMax = 0;
    for (let i = 0; i < p.length; i += 1) {
      if (i) pathLen += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
      dyMax = Math.max(dyMax, Math.abs(p[i].y - WALK.eye));
    }
    const head = p[0] ?? null;
    const tail = p[p.length - 1] ?? null;
    // 位移方向与朝向的夹角：按住 W 一秒该沿当前朝向走，偏得多就是键位映射错了
    let driftDeg = 0;
    if (head && tail) {
      const vx = tail.x - head.x;
      const vz = tail.z - head.z;
      if (Math.hypot(vx, vz) > 0.2) {
        const moveYaw = Math.atan2(-vx, -vz);
        let d = moveYaw - head.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        driftDeg = Math.abs(Math.round((d * 180) / Math.PI * 10) / 10);
      }
    }
    return {
      samples: p.length,
      pathLen: round2(pathLen),
      net: head && tail ? round2(Math.hypot(tail.x - head.x, tail.z - head.z)) : 0,
      seconds: head && tail ? round2((tail.t - head.t) / 1000) : 0,
      dyMax: round2(dyMax),
      driftDeg,
      start: head ? [round2(head.x), round2(head.y), round2(head.z)] : null,
      end: tail ? [round2(tail.x), round2(tail.y), round2(tail.z)] : null,
    };
  }

  /** 把人放到 walk 平面上的指定点并转向：门洞 / 贴墙两条断言用真实按键走，只是起点得钉住 */
  walkSnapTo(x: number, z: number, faceX: number, faceZ: number): { ok: boolean; at: [number, number, number]; gap: number } {
    if (this.camMode !== 'walk') return { ok: false, at: [0, 0, 0], gap: -1 };
    const at = new THREE.Vector3(x, WALK.eye, z);
    this.colliders = this.view === 'hall' ? this.hallColliders : this.roomColliders;
    settle(at, this.colliders, faceX || faceZ ? [faceX, faceZ] : undefined);
    this.camera.position.copy(at).setY(WALK.eye);
    if (faceX || faceZ) this.walkYaw = this.yawToward(faceX, faceZ);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.refreshAim(true);
    this.wake();
    return {
      ok: this.camMode === 'walk',
      at: [round2(at.x), round2(at.y), round2(at.z)],
      gap: round2(wallGap(this.camera.position, this.colliders)),
    };
  }

  /**
   * 沿给定水平方向用**同一套** resolveSlide  marches 过去（不经过帧循环，步长 0.12）：
   * 门槛用它一次证完「六条走廊都真通到门口」与「外墙挡得住人」，不必每向走十几秒。
   */
  walkMarch(dx: number, dz: number, distance: number, use: 'here' | 'hall' | 'room' = 'here'): {
    end: [number, number];
    travelled: number;
    want: number;
    blockedAt: number | null;
    stopKinds: string;
    minGap: number;
  } {
    const saveColliders = this.colliders;
    if (use === 'hall') this.colliders = this.hallColliders;
    else if (use === 'room') this.colliders = this.roomColliders;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const at = new THREE.Vector3(this.camera.position.x, WALK.eye, this.camera.position.z);
    const start = [at.x, at.z];
    const step = 0.12;
    let taken = 0;
    let blockedAt: number | null = null;
    let stopKinds = '';
    let minGap = Number.POSITIVE_INFINITY;
    // 增量推进：上一步的**解算结果**才是下一步的起点。若每步都从原始直线重摆，
    // 脚会一步跨过 1.2 厚的墙、被推出去时当成「从另一侧来」——那是测试的假象，不是碰撞的错。
    const prev = new THREE.Vector3(at.x, WALK.eye, at.z);
    for (let d = step; d <= distance + 1e-9; d += step) {
      prev.set(at.x, WALK.eye, at.z);
      at.x += ux * step;
      at.z += uz * step;
      at.y = WALK.eye;
      const want = [at.x, at.z];
      const res = resolveSlide(at, this.colliders, WALK.radius, WALK.stand, prev);
      const slid = Math.hypot(at.x - want[0], at.z - want[1]);
      if (slid > 0.02 && blockedAt === null) {
        blockedAt = round2(d);
        stopKinds = res.kinds.join('/');
      }
      minGap = Math.min(minGap, wallGap(at, this.colliders));
      taken = Math.max(taken, Math.hypot(at.x - start[0], at.z - start[1]));
    }
    this.colliders = saveColliders;
    return {
      end: [round2(at.x), round2(at.z)],
      travelled: round2(taken),
      want: round2(distance),
      blockedAt,
      stopKinds,
      minGap: round2(minGap),
    };
  }

  /**
   * 走到第 i 根书脊正前方并把准星压上去，然后按真实链路拾取。
   * 必须「站到架前」而不是站在过道上斜着瞄：同一排书脊不在同一深度（书有厚薄），
   * 斜瞄时射线会先落在更凸出的邻脊上——那不是 bug，是人站得不对。
   */
  walkAimSpine(i: number): {
    ok: boolean;
    yawDeg: number;
    pitchDeg: number;
    book: string;
    chapterId: string;
    aimedAt: string;
    stand: string;
    hit: { kind: string; id: string | null } | null;
  } | null {
    const spine = this.plan?.spines[i];
    if (!spine) return null;
    this.room.updateMatrixWorld();
    const n = this.normalToWorld(spine.normal);
    const to = this.localToWorld([spine.x, spine.y, spine.z]);
    // 站在书脊法线方向 1.9 处（≈架面前 0.25，被碰撞柱顶到面上也行），朝向架内
    const at = new THREE.Vector3(to.x + n[0] * 1.9, WALK.eye, to.z + n[1] * 1.9);
    this.walkDrop(at, this.yawToward(-n[0], -n[1]));
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax,
      Math.atan2(to.y - this.camera.position.y,
        Math.hypot(to.x - this.camera.position.x, to.z - this.camera.position.z))));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.syncWorld();
    this.refreshAim(true);
    const slot = this.plan?.slots[spine.slot];
    return {
      ok: this.aimHit?.kind === 'chapter' && this.aimHit.id === spine.chapter.id,
      yawDeg: Math.round(this.walkYaw * 572957.8) / 10000,
      pitchDeg: Math.round(this.walkPitch * 572957.8) / 10000,
      book: slot?.book.file ?? '',
      chapterId: spine.chapter.id,
      aimedAt: `${round2(to.x)},${round2(to.y)},${round2(to.z)}`,
      stand: `${round2(this.camera.position.x)},${round2(this.camera.position.z)}`,
      hit: this.aimHit ? { kind: this.aimHit.kind, id: this.aimHit.id ?? null } : null,
    };
  }

  /** 书脊法线（指向房间中心的 room-local xz）→ 世界 xz，与 localToWorld 同一套绕 Y 约定 */
  private normalToWorld(n: [number, number]): [number, number] {
    const th = this.room.rotation.y;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return [n[0] * c + n[1] * s, -n[0] * s + n[1] * c];
  }

  /** 第一人称取证读数：模式、眼高、朝向、碰撞账、准星命中 */
  walkState(): {
    mode: 'orbit' | 'walk';
    eye: number;
    pos: { x: number; y: number; z: number };
    yawDeg: number;
    pitchDeg: number;
    pitchLimitDeg: number;
    speed: number;
    sprint: boolean;
    radius: number;
    blockers: number;
    blockerKinds: Record<string, number>;
    wallGap: number;
    aim: { kind: string; book: string | null; id: string | null; hint: string } | null;
    view: 'hall' | 'room';
    room: Discipline | null;
    controlsEnabled: boolean;
    fov: number;
    stick: { active: boolean; x: number; y: number };
  } {
    const kinds: Record<string, number> = {};
    for (const b of this.colliders) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    return {
      mode: this.camMode,
      eye: round2(this.camera.position.y),
      pos: {
        x: round2(this.camera.position.x),
        y: round2(this.camera.position.y),
        z: round2(this.camera.position.z),
      },
      yawDeg: Math.round(this.walkYaw * 572957.8) / 10000,
      pitchDeg: Math.round(this.walkPitch * 572957.8) / 10000,
      pitchLimitDeg: Math.round(WALK.pitchMax * 572957.8) / 10000,
      speed: WALK.speed,
      sprint: this.sprint,
      radius: WALK.radius,
      blockers: this.colliders.length,
      blockerKinds: kinds,
      wallGap: this.colliders.length ? round2(wallGap(this.camera.position, this.colliders)) : Number.POSITIVE_INFINITY,
      aim: this.aimHit
        ? {
          kind: this.aimHit.kind,
          book: this.aimHit.book?.file ?? null,
          id: this.aimHit.id ?? null,
          hint: this.tipText(this.aimHit),
        }
        : null,
      view: this.view,
      room: this.roomKey,
      controlsEnabled: this.controls.enabled,
      fov: Math.round(this.camera.fov * 100) / 100,
      stick: { active: this.stickId !== null, x: round2(this.stickVec.x), y: round2(this.stickVec.y) },
    };
  }

  /** 取证用：按度数直接摆头（脚本不想复现拖拽像素系数） */
  walkSetLook(yawDeg: number, pitchDeg: number): { yawDeg: number; pitchDeg: number } | null {
    if (this.camMode !== 'walk') return null;
    this.walkYaw = (yawDeg * Math.PI) / 180;
    this.walkPitch = Math.max(-WALK.pitchMax, Math.min(WALK.pitchMax, (pitchDeg * Math.PI) / 180));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
    this.syncWalkTarget();
    this.refreshAim(true);
    return { yawDeg: Math.round(this.walkYaw * 572957.8) / 10000, pitchDeg: Math.round(this.walkPitch * 572957.8) / 10000 };
  }

  /**
   * 批 11 F：近景贴图做工账。逐角色读**运行时**的贴图设置（mipmap、过滤、各向异性），
   * 并从几何实测「一个贴图瓦片摊到几个世界单位」——近景拉伸成条的根因就是这个数太小。
   * 判据读账，不读代码常量。
   */
  closeupReport(): {
    maxAnisotropy: number;
    maps: Array<{
      role: string;
      w: number;
      h: number;
      mipmaps: boolean;
      minFilter: string;
      magFilter: string;
      anisotropy: number;
      unitsPerTile: number;
      texelPerUnit: number;
      texelPerUnitHi: number;
    }>;
  } {
    const want = new Set(['ground', 'hallFloor', 'roomFloor', 'wall', 'ceiling', 'shelves', 'spines', 'facade']);
    const maps: Array<{
      role: string;
      w: number;
      h: number;
      mipmaps: boolean;
      minFilter: string;
      magFilter: string;
      anisotropy: number;
      unitsPerTile: number;
      texelPerUnit: number;
      texelPerUnitHi: number;
    }> = [];
    const done = new Set<string>();
    this.scene.traverse((o) => {
      const role = String(o.userData.role ?? '');
      if (!want.has(role) || done.has(role)) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const map = mat?.map;
      if (!map) return;
      done.add(role);
      const img = map.image as { width?: number; height?: number } | null;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const box = new THREE.Box3().setFromBufferAttribute(pos);
      // 逐三角形密度取中位数：合并几何（书脊图集、书架）一整片 UV 跨 0..1，
      // 用整体跨度算会算出「19 单位一瓦片」这种假数——真正决定近景糊不糊的是单个格子的 texel/单位。
      const dens: number[] = [];
      const W = img?.width ?? 0;
      const Hh = img?.height ?? 0;
      const rp = Math.max(map.repeat.x, map.repeat.y);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const cc = new THREE.Vector3();
      for (let i = 0; i + 2 < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        cc.fromBufferAttribute(pos, i + 2);
        const area = b.clone().sub(a).cross(cc.clone().sub(a)).length() * 0.5;
        const u0 = uv.getX(i);
        const v0 = uv.getY(i);
        const auv = Math.abs((uv.getX(i + 1) - u0) * (uv.getY(i + 2) - v0)
          - (uv.getX(i + 2) - u0) * (uv.getY(i + 1) - v0)) * 0.5 * rp * rp;
        if (area > 1e-5 && auv > 1e-9) dens.push(Math.sqrt((auv * W * Hh) / area));
      }
      dens.sort((x, y) => x - y);
      const texelPerUnit = dens.length ? dens[Math.floor(dens.length / 2)] : 0;
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y);
      maps.push({
        role,
        w: W,
        h: Hh,
        mipmaps: map.generateMipmaps === true,
        minFilter: filterName(map.minFilter),
        magFilter: filterName(map.magFilter),
        anisotropy: map.anisotropy,
        unitsPerTile: texelPerUnit > 0 ? Math.round((W / texelPerUnit) * 100) / 100 : Math.round(span * 100) / 100,
        texelPerUnit: Math.round(texelPerUnit * 10) / 10,
        texelPerUnitHi: Math.round((dens.length ? dens[Math.floor(dens.length * 0.9)] : 0) * 10) / 10,
      });
    });
    return { maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(), maps };
  }

  // ---------------------------------------------------------------- 本区构建与释放

  private clearRoom(): void {
    for (const obj of this.roomObjects.splice(0)) {
      this.room.remove(obj);
      // 实例缓冲由 InstancedMesh.dispose 释放；几何与材质走 roomGeoms / roomMats
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
    }
    for (const light of this.roomLights.splice(0)) this.room.remove(light);
    for (const g of this.roomGeoms.splice(0)) g.dispose();
    for (const m of this.roomMats.splice(0)) m.dispose();
    for (const tex of this.atlas?.textures ?? []) tex.dispose();
    this.atlas = null;
    this.spineMeshes = [];
    this.spinePages = [];
    this.dust = null;
    this.roomFloor = null;
    this.dotRefs = [];
    this.dotSeeds = [];
    this.plan = null;
    this.shellStats = null;
    // 几何已在 roomGeoms 里释放；门数据本身跨 room 不保留（在途切换走 neighborPending）
    this.neighbor = null;
  }

  private setFog([near, far]: [number, number]): void {
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    }
  }

  /**
   * 帧缓冲缩放：只在室内机位用。批 8 把机位移进房间后，墙面 + 地板 + 书架铺满画面，
   * 瓶颈从几何变成片元（tris 6.2k / calls 29 却只有 40 fps）。实测 1440×900 下
   * 0.85 缩放让三区分别 40.5→55.7 / 39.7→52.3 / 53→67，而书脊格本来就是 0.22 倍
   * 缩小显示（原生像素是屏幕像素的 4.5 倍），缩到 0.85 后仍有 3.8 倍余量，特写读得出书名。
   * 大厅保持 1.0——那里要看地面总览图与门楣小字，且帧率本就有 53。
   */
  private setRenderScale(next: number): void {
    if (Math.abs(this.renderScale - next) < 1e-3) return;
    this.renderScale = next;
    this.resize();
  }

  /**
   * aspect → 水平半张角（PerspectiveCamera.fov 是垂直角，水平要乘 aspect）。
   */
  private halfFovRad(fovDeg: number): number {
    const aspect = this.camera.aspect || 1;
    return Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect);
  }

  /** 俯视机位沿批 8 的 41.4° 俯角线推远；窄屏按 aspect 插值到 HALL_PORTRAIT 的 「站高俯冲」姿态 */
  private hallPose(): [number, number, number] {
    const aspect = this.camera.aspect || 1;
    const fov = fovForAspect(HALL_FOV_MIN, HALL_FOV_MAX, aspect);
    const t = aspectRamp(aspect);
    // 批 10 A1：水平挤压后横向可视半宽是 tan(hfov)·Kx，装下六栋体量所需距离同比缩短。
    // 竖屏档的主体口径收到门签外沿（135.65+余量）而不是桌面档的 178：门签外还整栋楼体，
    // 用 178 会把竖屏机位反推到 287，主体竖向从 52% 掉到 47%（低于门槛），构图反而退回小黑厅。
    const span = HALL_SPAN + (142 - HALL_SPAN) * t;
    const kx = 1 + HALL_PORTRAIT.lensMax * t;
    const need = span / Math.max(0.05, Math.tan(this.halfFovRad(fov)) * kx);
    const tiltLen = HALL_TILT_LEN + (HALL_PORTRAIT.dist - HALL_TILT_LEN) * t;
    const pitch = HALL_PITCH + (HALL_PORTRAIT.pitch - HALL_PITCH) * t;
    const dist = Math.min(this.controls.maxDistance - 20, Math.max(tiltLen, need));
    return [0, Math.sin(pitch) * dist, Math.cos(pitch) * dist];
  }

  /**
   * 阅览室机位：横屏（aspect ≥1）就是批 8 那一档——站进门口、side*0.3，画面被三面书架铺满；
   * 竖屏退到「门内一步」（门墙内侧 1.5 单位），靠 fov 76 把房间横向撑开。
   *
   * 竖屏不求「整间房的顶点都进画」：390×844 的 aspect 只有 0.462，fov 76 时水平半角
   * 也只有 atan(tan38°×0.462)=20.3°，要把 side=20 的后墙四角全装下就得退到门外 13 单位。
   * 那条构图实测是一间娃娃屋：画面上部三分之一是走廊与门洞，一根书脊被压到 21px 高，
   * 指头点上去落进书顶的铜牌带，开出来是「本书总览」而不是章节（门槛里「390 点书脊开正文」
   * 就是这么炸的）。竖屏的构图目标是「站门口看进去、书脊点得中」，两侧墙远段出画是窄屏的性质。
   */
  private roomEye(side: number, height: number): { dist: number; eyeY: number; lookY: number } {
    const t = aspectRamp(this.camera.aspect);
    const near = side * 0.3;
    const doorway = Math.max(near, side * 0.5 - 1.5);
    return {
      dist: near + (doorway - near) * t,
      eyeY: Math.min(height * 0.52, side * 0.42) + (Math.min(height * 0.62, side * 0.5) - Math.min(height * 0.52, side * 0.42)) * t,
      lookY: height * (0.38 + 0.02 * t),
    };
  }

  showHall(pose?: CameraPose | null, walkLanding?: WalkLanding | null): void {
    // 回大厅/被导航打断：立刻撤掉在途邻区切换与黑场，不能把大厅留在黑屏里
    this.cancelNeighbor();
    this.cancelFrontDoor();
    this.frontArmed = false;
    this.frontExitLatch = false;
    this.view = 'hall';
    this.roomKey = null;
    this.conceptShown = null;
    // 回大厅即释放本区图集与合并几何：六区不同时驻留，判据「切区释放」在这里也成立
    this.clearRoom();
    this.room.visible = false;
    this.hall.visible = true;
    for (const g of this.links.values()) g.visible = true;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 1000;
    this.setFog(HALL_FOG);
    this.setRenderScale(1);
    this.setFov(fovForAspect(HALL_FOV_MIN, HALL_FOV_MAX, this.camera.aspect), this.lensForAspect(this.camera.aspect));
    this.applyPose(pose ?? this.hallDefaultPose());
    this.resetInertia();
    this.updateControls();
    this.focusShadow();
    this.hideTip();
    this.wake();
    this.hooks.onHud(
      `八角厅 · ${this.manifest.totals.sites} 本书 / ${this.manifest.totals.repos} 个仓库 · 六门通六区`,
    );
    this.rewalkAfterViewSwitch(walkLanding ?? null);
    if (this.camMode === 'walk') {
      this.frontLandingAt = performance.now();
      this.frontCooldownUntil = this.frontLandingAt + NEIGHBOR.cooldownMs;
    }
  }

  enterRoom(
    discipline: Discipline,
    books: SiteEntry[],
    records: Map<string, BookRecord>,
    pose?: CameraPose | null,
    walkLanding?: WalkLanding | null,
  ): void {
    const spec = ROOM_BY_KEY[discipline];
    // 批 18：在途的邻区切换只在「进的就是那个目标区」时保留；用户改去别区就作废
    if (this.neighborPending && this.neighborPending !== discipline) this.cancelNeighbor();
    if (!this.neighborPending) {
      this.neighborCooldownUntil = 0;
      this.neighborLandingAt = 0;
    }
    // 批 20：正门在途只对「进的就是那一区」有效；改去别区就作废。
    // 武装条件 = 这次进入发生在漫游态（走路进门 / 邻区侧门 / 漫游中点选）——
    // 俯瞰态点选进房的不自动走回大厅，现有「房内按 W 穿门外出」的门槛检查点不受影响。
    if (this.frontPending && this.frontPending !== discipline) this.cancelFrontDoor();
    this.frontArmed = this.camMode === 'walk' || Boolean(walkLanding);
    this.frontExitLatch = false;
    this.clearRoom();
    this.roomKey = discipline;
    this.conceptShown = null;
    const plan = planRoom(discipline, books, records, (seed) => leatherColor(spec.color, seed));
    this.plan = plan;
    // 正门恒落在走廊尽头：书多则房间向外扩，不会顶穿走廊，也与大厅体量外壳的门同位
    const centerR = ROOM_DIST - FACADE_SIDE / 2 + plan.side / 2;
    this.room.position.set(Math.cos(spec.angle) * centerR, 0, Math.sin(spec.angle) * centerR);
    this.room.rotation.y = Math.PI / 2 - spec.angle;
    this.room.updateMatrixWorld(true);
    // 侧门数据必须先于碰撞体：侧书架在 prepare 里前移，roomBlockers 读的是同一批 row
    const nb = this.prepareNeighbor(plan, discipline);
    nb.plateWorld.copy(this.localToWorld(nb.plateLocal));
    nb.landingWorld.copy(this.localToWorld(nb.landingLocal));
    nb.landingYaw = this.yawToward(
      this.room.position.x - nb.landingWorld.x,
      this.room.position.z - nb.landingWorld.z,
    );
    this.neighbor = nb;
    this.roomColliders = this.buildRoomColliders(plan);

    const shell = buildRoomShell(plan);
    // 侧墙整面替换成带门洞的补片：原侧墙三角形摘掉，踢脚摘掉后补两段
    cutWallPlane(shell.walls, nb.side * (plan.side / 2));
    const trimGeo = trimWithSideDoor(shell.trim, nb.side, plan.side / 2, nb.z0, nb.z1);
    this.roomGeoms.push(shell.floor, shell.walls, shell.ceiling, trimGeo, shell.doorFrame);
    this.shellStats = shell.stats;

    const floorMat = this.wood('#4a3521', 2 + ROOMS.findIndex((r) => r.key === discipline));
    this.roomMats.push(floorMat);
    const floor = new THREE.Mesh(shell.floor, floorMat);
    floor.receiveShadow = true;
    floor.userData.role = 'roomFloor';
    this.roomFloor = floor;
    this.addRoomObject(floor);

    // 试过把墙面/天花换成 MeshLambertMaterial 省片元，实测反而慢 2–3 fps（五区同向），
    // 已回退——省下来的预算走「不接影」这条路（见下方 mark）。
    // 批 9 C2：墙面与背板的底色各提一档（#2f2620 → #3d3026）。原来近黑室内里墙与书几乎同值，
    // 「房间有边界」只能靠地面轮廓读出来。仍压在暗段——这是阅览室的低调子，不是白墙。
    // 但底色只解释「有多少光可反」，不解释「有没有光」：灯在 y=10.6、离上部墙脚 18 单位开外，
    // decay 2 之下那里本来就接不到东西。杠杆实测（AI 区默认机位，画面上部 34% 均值）：
    // 基线 0.0048 / 关阴影 0.0098 / hemi 抬到 5× 也才 0.0215，只有 roomPoint 抬到 4.3× 走到 0.091，
    // 代价是整帧 0.072 → 0.235（房间洗坏）。所以走「把反弹光烘进表面」：emissive + 同一张图当
    // emissiveMap——不加灯、不多算片元，花色仍在，只是不再是一块纯黑。
    const wallTex = wallTexture('#3d3026', '#544536', spec.color);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      emissive: 0xffe9c9,
      emissiveMap: wallTex,
      emissiveIntensity: 0.11,
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.4,
    });
    this.roomMats.push(wallMat);
    this.addRoomObject(this.mark(new THREE.Mesh(shell.walls, wallMat), 'wall', { receiveShadow: true }));
    // 批 18：侧门补片与短廊共用本区墙材质；发光条与门牌是 MeshBasic（不加灯）
    this.addRoomObject(this.mark(new THREE.Mesh(nb.wallPatch, wallMat), 'neighborWall', { receiveShadow: true }));
    this.roomGeoms.push(nb.wallPatch);
    // 短廊原来吃本区墙材质，墙纹理铺到地面那一片会显出一块明显的浅灰（实测截图里
    // 廊道一半是暖木、一半是灰白）。整条短廊换成与走廊地板同一档的暖木，并给一点自发光，
    // 极暗环境下不至于走进去什么都看不见。
    const nbMat = this.wood('#3a2a1a', 5);
    nbMat.emissive = new THREE.Color('#241a12');
    nbMat.emissiveIntensity = 0.26;
    nbMat.roughness = 0.9;
    this.roomMats.push(nbMat);
    this.addRoomObject(this.mark(new THREE.Mesh(nb.corridor, nbMat), 'neighborCorridor', { receiveShadow: true }));
    this.roomGeoms.push(nb.corridor);
    // 门框与地面光带用**目的地**的学科色，不用本区色：玩家看到这个颜色就是「走进这扇门会到哪」，
    // 与短廊尽头那块门牌的配色一致，暗房里也更容易把「门」和「墙」分开。
    const glow = new THREE.Color(ROOM_BY_KEY[nb.to].color);
    const peak = Math.max(glow.r, glow.g, glow.b);
    if (peak > 0.4) glow.multiplyScalar(0.4 / peak);
    const glowMat = new THREE.MeshBasicMaterial({ color: glow });
    this.roomMats.push(glowMat);
    this.addRoomObject(this.mark(new THREE.Mesh(nb.strip, glowMat), 'neighborGlow', {}));
    this.roomGeoms.push(nb.strip);
    // 短廊地面导引光带：门洞是黑的，只靠门框勾边玩家仍会犹豫「这里能不能进」，
    // 地上一对光带把落脚点直接指到门牌前。
    this.addRoomObject(this.mark(new THREE.Mesh(nb.floorGlow, glowMat), 'neighborGlow', {}));
    this.roomGeoms.push(nb.floorGlow);
    const plateMat = new THREE.MeshBasicMaterial({
      map: this.plaqueFor(nb.to),
      transparent: true,
      depthWrite: false,
    });
    this.roomMats.push(plateMat);
    this.addRoomObject(this.mark(new THREE.Mesh(nb.plate, plateMat), 'neighborPlate', {}));
    this.roomGeoms.push(nb.plate);
    // 批 9 C1：天花 quad 的法线整片朝下（architecture.ts 里那条 [0,-1,0]），主光在头顶上方，
    // dot(L,N) < 0 被夹成 0 —— 这面只吃 HemisphereLight 的地面色。隐藏天花与不隐藏天花，
    // 画面上部 34% 的均值一字不变（0.00478），说明它本来就渲染成了纯黑而不是没画。
    // 底色抬一档（#3d3026 → #6b5638）+ 反弹光给到 0.16，抬的是落脚亮度，不是入射光，帧时不受影响。
    const ceilTex = wallTexture('#6b5638', '#7c6a4d', spec.color);
    const ceilMat = new THREE.MeshStandardMaterial({
      map: ceilTex,
      emissive: 0xffe9c9,
      emissiveMap: ceilTex,
      emissiveIntensity: 0.22,
      roughness: 0.95,
      metalness: 0.02,
      envMapIntensity: 0.55,
    });
    this.roomMats.push(ceilMat);
    this.addRoomObject(this.mark(new THREE.Mesh(shell.ceiling, ceilMat), 'ceiling', {}));

    // 藻井梁与踢脚/门框共用这一份：梁的底面同样朝下，接不到主光，给一档同样的反弹光
    const trimTex = woodTexture('#453018', '#1c1208', 9);
    const trimMat = new THREE.MeshStandardMaterial({
      map: trimTex,
      emissive: 0xffe9c9,
      emissiveMap: trimTex,
      emissiveIntensity: 0.16,
      roughness: 0.6,
      metalness: 0.16,
      envMapIntensity: 0.5,
    });
    this.roomMats.push(trimMat);
    this.addRoomObject(this.mark(new THREE.Mesh(trimGeo, trimMat), 'baseboard', { castShadow: true }));
    this.addRoomObject(this.mark(new THREE.Mesh(shell.doorFrame, trimMat), 'doorFrame', { castShadow: true }));

    const boxGeom = unitBox();
    this.roomGeoms.push(boxGeom);
    const beams = new THREE.InstancedMesh(boxGeom, trimMat, shell.beams.length);
    shell.beams.forEach((m, i) => beams.setMatrixAt(i, m));
    beams.instanceMatrix.needsUpdate = true;
    beams.userData.role = 'ceilingBeams';
    beams.userData.count = shell.beams.length;
    this.addRoomObject(beams);

    const rugGeo = new GeoBuilder()
      .quad([-6.4, 0.06, -5.2], [6.4, 0.06, -5.2], [6.4, 0.06, 6.8], [-6.4, 0.06, 6.8],
        [0, 0, 1, 1], [0, 1, 0])
      .toGeometry();
    const rugMat = new THREE.MeshStandardMaterial({
      map: rugTexture(spec.color),
      roughness: 0.94,
      metalness: 0.02,
      envMapIntensity: 0.2,
    });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.receiveShadow = true;
    rug.userData.role = 'rug';
    this.roomGeoms.push(rugGeo);
    this.roomMats.push(rugMat);
    this.addRoomObject(rug);

    // 门楣牌匾：区名不再靠浮空标签
    const plaqueGeo = new THREE.PlaneGeometry(6.6, 2.2);
    const plaqueMat = new THREE.MeshBasicMaterial({
      map: this.plaqueFor(discipline),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plaque = new THREE.Mesh(plaqueGeo, plaqueMat);
    plaque.position.set(0, Math.min(ROOM_DOOR.h, plan.height - 1.2) + 1.05, -plan.side / 2 + 0.42);
    plaque.userData.role = 'lintelPlaque';
    this.roomGeoms.push(plaqueGeo);
    this.roomMats.push(plaqueMat);
    this.addRoomObject(plaque);

    // 书架墙先建：库里 0 本的区也该是一间有架子的阅览室，而不是空盒子。
    // 跟着书目走的只有书脊与光尘——没有书就一根脊都不造（铁律：不为演示编数据）。
    const shelf = buildShelves(plan);
    const shelfMat = new THREE.MeshStandardMaterial({
      map: woodTexture('#4f3620', '#221609', 4 + ROOMS.findIndex((r) => r.key === discipline) * 3),
      roughness: 0.68,
      metalness: 0.12,
      envMapIntensity: 0.45,
    });
    this.roomMats.push(shelfMat);
    const shelfMesh = this.mark(new THREE.Mesh(shelf.geometry, shelfMat), 'shelves', {
      castShadow: true,
      receiveShadow: true,
    });
    shelfMesh.userData.signature = shelf.signature;
    shelfMesh.userData.stats = { rows: shelf.rows, tiers: shelf.tiers, dividers: shelf.dividers };
    this.addRoomObject(shelfMesh);
    this.roomGeoms.push(shelf.geometry);

    if (!books.length || !plan.slots.length) {
      this.addRoomLights(plan.side);
      this.enterRoomCamera(plan, pose, walkLanding);
      this.hooks.onHud(`${spec.title} · 0 本 · 6 个仓库无 manifest，待批 5 生成层补源（不伪造书位）`);
      this.finishNeighborEntry(plan);
      return;
    }

    // 书脊图集 + 合并几何（每区 1–3 个 draw call）
    const atlas = buildSpineAtlas(
      plan.slots.map((s) => ({
        color: s.color,
        title: s.book.title || s.book.bookSlug,
        chapters: s.chapters.map((c) => String(c.num ?? '')),
      })),
    );
    this.atlas = atlas;
    const pages = buildSpines(plan, atlas);
    this.spinePages = pages;
    for (const p of pages) {
      // 每条书脊是六面闭合盒、法线全部朝外，背面剔除即可——用 DoubleSide 会把
      // 盒子里侧的像素也送进片元着色，而书脊正是近机位下最大的一片贴图面积。
      const mat = new THREE.MeshStandardMaterial({
        map: atlas.textures[p.page] ?? null,
        roughness: 0.62,
        metalness: 0.14,
        envMapIntensity: 0.55,
      });
      this.roomMats.push(mat);
      const mesh = this.mark(new THREE.Mesh(p.geometry, mat), 'spines', { castShadow: true }) as THREE.Mesh;
      mesh.userData.page = p.page;
      this.spineMeshes.push(mesh);
      this.addRoomObject(mesh);
      this.roomGeoms.push(p.geometry);
    }

    this.buildDust(plan, spec.color);
    this.addRoomLights(plan.side);
    this.enterRoomCamera(plan, pose, walkLanding);
    this.hooks.onHud(
      `${spec.title} · ${plan.bookCount} 册上架 · ${plan.chapterCount} 条书脊 · 点书脊读章、点顶部铜牌看书`,
    );
    this.finishNeighborEntry(plan);
  }

  private addRoomObject(obj: THREE.Object3D): void {
    this.roomObjects.push(obj);
    this.room.add(obj);
  }

  /** 区名牌匾：大门外楣与本区门内共用同一张纹理，一次生成、切区不重建 */
  private plaqueFor(discipline: Discipline): THREE.CanvasTexture {
    let tex = this.plaqueTex.get(discipline);
    if (!tex) {
      const spec = ROOM_BY_KEY[discipline];
      tex = plaqueTexture(
        PLAQUE_KINDS[discipline],
        spec.short,
        `${this.manifest.sites.filter((s) => s.discipline === discipline).length} 册`,
        spec.color,
      );
      this.plaqueTex.set(discipline, tex);
    }
    return tex;
  }

  /** 概念光尘：书架前沿的一粒粒亮尘，加法混合、不写深度，绝不遮书脊 */
  private buildDust(plan: RoomPlan, color: string): void {
    if (!plan.dust.length) return;
    const dotGeo = new THREE.PlaneGeometry(1, 1);
    const dotMat = new THREE.MeshBasicMaterial({
      map: this.glowTex ?? undefined,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dots = new THREE.InstancedMesh(dotGeo, dotMat, plan.dust.length);
    this.roomGeoms.push(dotGeo);
    this.roomMats.push(dotMat);
    dots.userData.role = 'dust';
    dots.userData.billboard = true;
    dots.userData.dotTexture = 'canvas:radial-gradient-64';
    this.dotBase = new THREE.Color(color).lerp(new THREE.Color('#f4f7ff'), 0.34);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    this.dotRefs = [];
    this.dotSeeds = [];
    plan.dust.forEach((d, i) => {
      const p = new THREE.Vector3(d.x, d.y, d.z);
      this.dotSeeds.push({ pos: p, size: d.size });
      m.compose(p, q, v.set(d.size, d.size, 1));
      dots.setMatrixAt(i, m);
      this.dotRefs.push({ book: d.book, conceptId: d.conceptId });
    });
    dots.instanceMatrix.needsUpdate = true;
    this.dust = dots;
    this.applyDustBudget();
    this.addRoomObject(dots);
    this.recolorDots();
  }

  /**
   * 光尘实例数按档位收口：加法混合的大 quad 是移动端 fillrate 的主要开销，密度减半在
   * 390 宽屏上观感差异不可辨。用 `InstancedMesh.count` 截断而不是重建几何——拾取射线
   * 只遍历 count 以内的实例，所以亮尘表与点选表自动同步，不需要第二套索引。
   */
  private applyDustBudget(): void {
    if (!this.dust) return;
    this.dust.count = Math.min(this.dotSeeds.length, Math.max(0, this.tier.dustBudget));
    this.dust.visible = this.dust.count > 0;
  }

  private addRoomLights(side: number): void {
    const span = Math.max(18, side);
    // 灯沿走道两侧摆、不摆在房间中轴线上：批 8 的书架墙是一整面正对机位的平面，
    // 中轴线上的点光在它上面打出的垂足光斑会随灯高等高移动并整片过曝（批 7 是弧形圆盘，
    // 同一盏灯的光斑被曲面摊开）。挪到侧墙那侧后，侧墙虽然仍是垂足面，但它在画面里近乎侧视，
    // 光斑被投影拉散；正对机位的远墙只吃到斜射，亮度自然落回不曝的范围。
    const top = new THREE.PointLight(0xffd9a0, 210, span * 4.6, 2);
    top.position.set(side * 0.34, ROOM_HEIGHT - 4.4, -side * 0.15);
    const fill = new THREE.PointLight(0xdfe7f5, 74, span * 4.2, 2);
    fill.position.set(-side * 0.34, ROOM_HEIGHT - 4.4, side * 0.2);
    this.roomLights = [top, fill];
    this.room.add(top, fill);
  }

  private enterRoomCamera(plan: RoomPlan, pose?: CameraPose | null, walkLanding?: WalkLanding | null): void {
    this.hall.visible = false;
    this.room.visible = true;
    for (const [key, group] of this.links) group.visible = key === this.roomKey;
    this.view = 'room';
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 320;
    this.setFog(ROOM_FOG);
    this.setRenderScale(this.tier.renderScale);
    this.setFov(fovForAspect(ROOM_FOV_MIN, ROOM_FOV_MAX, this.camera.aspect), this.lensForAspect(this.camera.aspect));
    const side = plan.side;
    const spec = ROOM_BY_KEY[plan.discipline];
    const cx = this.room.position.x;
    const cz = this.room.position.z;
    // 机位必须沿**本区自己的轴**摆：房间绕 Y 转了 π/2 − angle，本地 −Z 才是门墙那侧。
    // 早先用世界 +Z 偏移，六个区里只有 angle=90° 的那区碰巧对，其余区等于把相机
    // 塞进后墙书架里，截出来是一整幅横板（见 pitfalls 55）。
    // 站进门口、齐视线高度：墙与天花只朝内，从门内看过去就是封闭室内而不是娃娃屋外壳。
    const toDoor = new THREE.Vector3(-Math.cos(spec.angle), 0, -Math.sin(spec.angle));
    const eye = this.roomEye(side, plan.height);
    const at = new THREE.Vector3(cx, 0, cz).addScaledVector(toDoor, eye.dist);
    at.y = eye.eyeY;
    const nextPose = pose ?? { px: at.x, py: at.y, pz: at.z, tx: cx, ty: eye.lookY, tz: cz };
    this.applyPose(nextPose);
    this.resetInertia();
    this.updateControls();
    this.focusShadow();
    this.hideTip();
    this.wake();
    this.rewalkAfterViewSwitch(walkLanding ?? null);
    if (this.camMode === 'walk') {
      const now = performance.now();
      this.frontLandingAt = now;
      this.frontCooldownUntil = Math.max(this.frontCooldownUntil, now + NEIGHBOR.cooldownMs);
    }
    // 走门进来的那次：清在途标记并按落位重新起算冷却（本函数自带落位时幂等）
    this.finishFrontEntry(plan);
  }

  /** 主光与阴影相机跟着视图走：进房只罩住本区，2048 的贴图摊到 760 单位上就糊成一片 */
  private focusShadow(): void {
    const key = this.keyLight;
    if (!key) return;
    const inRoom = this.view === 'room' && this.plan;
    const cx = inRoom ? this.room.position.x : 0;
    const cz = inRoom ? this.room.position.z : 0;
    const half = inRoom ? Math.max(24, (this.plan?.side ?? 26) * 0.95) : 300;
    key.position.set(cx - half * 0.85, half * 0.9, cz + half * 0.6);
    key.target.position.set(cx, 0, cz);
    key.target.updateMatrixWorld();
    const box = key.shadow.camera;
    box.left = -half;
    box.right = half;
    box.top = half;
    box.bottom = -half;
    box.near = 1;
    box.far = half * 3.6;
    box.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  applyPose(pose: CameraPose): void {
    this.setOrbitPose(pose);
  }

  /**
   * OrbitControls.update() 不看 enabled：它按 (camera.position − target) 解球坐标、
   * 用 min/maxDistance 与极角上限夹一遍，再把相机**位置**写回去。漫游的机位是脚定的，
   * 一旦被它重摆就既不在眼高也不在走廊里——所以漫游期间整段不调。
   */
  private updateControls(): void {
    if (this.camMode === 'walk') return;
    this.controls.update();
  }

  /** 摆机位的唯一入口：漫游中不动相机，只把这套位姿记成「退出漫游后回到的俯瞰点」 */
  private setOrbitPose(pose: CameraPose): void {
    if (this.camMode === 'walk') {
      this.orbitReturn = pose;
      return;
    }
    this.camera.position.set(pose.px, pose.py, pose.pz);
    this.controls.target.set(pose.tx, pose.ty, pose.tz);
  }

  private resetInertia(): void {
    const c = this.controls as unknown as {
      _sphericalDelta?: { set(a: number, b: number, c: number): void };
      _panOffset?: { set(a: number, b: number, c: number): void };
    };
    c._sphericalDelta?.set(0, 0, 0);
    c._panOffset?.set(0, 0, 0);
  }

  currentPose(): CameraPose {
    // 漫游中的相机是人站在地板上，那不该被写进 roomCameras/hallCamera 当成俯瞰位姿存档。
    // 对外报退出漫游后要回到的那个机位——存盘、恢复、断言比对的口径就统一了。
    if (this.camMode === 'walk' && this.orbitReturn) return this.orbitReturn;
    const c = this.camera.position;
    const t = this.controls.target;
    return { px: c.x, py: c.y, pz: c.z, tx: t.x, ty: t.y, tz: t.z };
  }

  // ---------------------------------------------------------------- 交互

  private onPointerDown = (ev: PointerEvent): void => {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.downKind = ev.pointerType || 'mouse';
    this.downAtMs = performance.now();
    this.wake();
    if (this.camMode !== 'walk') return;
    // 批 16：鼠标在漫游里点一下就把指针锁进画布，之后靠 movementX/Y 转头（标准第一人称手感）。
    // 触屏没有指针锁定这回事，仍走左半屏摇杆 + 右半屏拖拽。锁不上（浏览器拒绝 / 已锁）就退回拖拽。
    if (this.downKind === 'mouse' && !this.pointerLocked) {
      this.requestPointerLock();
    }
    if (this.downKind === 'touch' && ev.clientX < window.innerWidth / 2) {
      if (this.stickId === null) this.beginStick(ev);
      return;
    }
    if (this.lookId === null) this.lookId = ev.pointerId;
    this.lookLast = { x: ev.clientX, y: ev.clientY };
  };

  private pointerLocked = false;

  private requestPointerLock(): void {
    const el = this.renderer.domElement;
    const req = el.requestPointerLock as ((opts?: { unadjustedMovement?: boolean }) => Promise<void> | void) | undefined;
    if (!req) return;
    try {
      const ret = req.call(el, { unadjustedMovement: true });
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        (ret as Promise<void>).catch(() => {
          // 系统不支持原始输入时退回默认模式，仍允许锁定
          try {
            req.call(el);
          } catch {
            /* 锁不上就保持拖拽 */
          }
        });
      }
    } catch {
      /* 锁不上就保持拖拽 */
    }
  }

  private exitPointerLock(): void {
    const doc = document as Document & { pointerLockElement?: Element | null; exitPointerLock?: () => void };
    if (doc.pointerLockElement) doc.exitPointerLock?.();
  }

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.pointerLocked) this.lookId = null;
    this.wake();
  };

  /** 位移阈值按**按下时**的指针类型取：触屏 8px（手指抖动远大于鼠标，6px 会在正常滑动后误开书），鼠标 6px */
  private tapVerdict(ev: { clientX: number; clientY: number }) {
    const kind = this.downKind;
    const slop = kind === 'touch' ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;
    return { kind, slop, moved: Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y) };
  }

  /**
   * 拖拽/轻点在 pointerup 就定性并记账：触屏上的滑动手势，浏览器常常**不再派发 click**，
   * 只在 click 里判阈值的话，「滑动 ≥8px 判为拖拽」这件事在门外根本没有可观测的痕迹。
   */
  private onPointerUp = (ev: PointerEvent): void => {
    const { kind, slop, moved } = this.tapVerdict(ev);
    this.lastTapInfo = { moved: round2(moved), slop, kind, action: moved >= slop ? 'drag' : 'tap' };
    if (this.camMode === 'walk') {
      if (ev.pointerId === this.stickId) this.endStick();
      if (ev.pointerId === this.lookId) this.lookId = null;
    }
    this.wake();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    this.wake();
    if (this.camMode === 'walk') {
      if (ev.pointerId === this.stickId) this.moveStick(ev);
      else if (this.pointerLocked) this.applyLook(ev.movementX || 0, ev.movementY || 0);
      else if (ev.pointerId === this.lookId) {
        this.applyLook(ev.clientX - this.lookLast.x, ev.clientY - this.lookLast.y);
        this.lookLast = { x: ev.clientX, y: ev.clientY };
      }
      // 漫游时浮标不跟指针跑：准星钉在屏幕中心，读的是准星下的东西
      this.hideTip();
      return;
    }
    if (ev.buttons !== 0) {
      this.hideTip();
      return;
    }
    const hit = this.pick(ev);
    this.syncAtrium(hit);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    this.hooks.onHud(hit ? hit.hint : this.hudDefault());
    this.scheduleTip(ev, hit);
  };

  private onPointerLeave = (): void => {
    if (this.stickId !== null) this.endStick();
    this.lookId = null;
    this.hideTip();
  };

  /** 120ms 延时浮出：扫过的瞬间不闪标签，停下手才给信息 */
  private scheduleTip(ev: PointerEvent, hit: Pick | null): void {
    if (!this.tip) return;
    const key = hit ? `${hit.kind}:${hit.book?.file ?? ''}:${hit.id ?? ''}` : '';
    if (key !== this.tipKey) {
      this.tipKey = key;
      if (this.tipTimer) window.clearTimeout(this.tipTimer);
      this.tipTimer = 0;
      if (!key) {
        this.tip.hidden = true;
        return;
      }
      this.tipTimer = window.setTimeout(() => {
        this.tipTimer = 0;
        if (!hit || !this.tip) return;
        this.tip.textContent = this.tipText(hit);
        this.tip.hidden = false;
      }, TIP_DELAY_MS);
    }
    if (hit) {
      const rect = this.root.getBoundingClientRect();
      this.tip.style.left = `${Math.max(6, ev.clientX - rect.left + 14)}px`;
      this.tip.style.top = `${Math.max(6, ev.clientY - rect.top + 16)}px`;
    }
  }

  private tipText(hit: Pick): string {
    if (hit.kind === 'room') {
      if (hit.title) return hit.title;
      const spec = ROOM_BY_KEY[hit.discipline];
      return `${spec.title} · ${this.manifest.sites.filter((s) => s.discipline === spec.key).length} 册 · 点击进入阅览室`;
    }
    const title = hit.book ? hit.book.title || hit.book.bookSlug : '';
    if (hit.kind === 'concept') return `概念 ${hit.id} · 点击读正文`;
    if (hit.kind === 'chapter') return hit.id ? `${title} · 第 ${hit.id} 章 · 点击读正文` : `${title} · 首章 · 点击进入阅读`;
    return `${title} · ${hit.book?.stats?.chapters ?? 0} 章 · 点击看书的总览`;
  }

  private hideTip(): void {
    if (this.tipTimer) window.clearTimeout(this.tipTimer);
    this.tipTimer = 0;
    this.tipKey = '';
    if (this.tip) this.tip.hidden = true;
  }

  private hudDefault(): string {
    return this.view === 'hall'
      ? '拖拽转视角 · 滚轮远近 · WASD 平移 · 点六栋阅览楼进区'
      : '拖拽转视角 · 点书脊读该章 · 点书脊顶部铜牌看书 · 点光尘读概念 · WASD 平移';
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    const code = ev.code;
    // 输入框（含阅读面板）聚焦时一律让键，俯瞰与漫游同一条规矩
    if (this.hooks.inputBusy()) return;
    if (code === 'KeyF') {
      this.toggleWalk();
      return;
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (this.camMode === 'walk') this.sprint = true;
      return;
    }
    if (!MOVE_KEYS.has(code)) return;
    this.keys.add(code);
    const now = performance.now();
    if (now - this.lastKeyHint > 1500) {
      this.lastKeyHint = now;
      this.hooks.onHud(this.camMode === 'walk'
        ? 'WASD 行走中 · 顺朝向挪步 · Shift 疾走'
        : 'WASD 平移中 · 只改位置不改朝向');
      this.hudStale = true;
    }
    this.wake();
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') this.sprint = false;
    this.keys.delete(ev.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.sprint = false;
    this.stickVec = { x: 0, y: 0 };
    this.stickId = null;
    this.lookId = null;
    if (this.stick) this.stick.hidden = true;
  };

  private panKeys(dt: number): void {
    if (!this.keys.size) return;
    let fx = 0;
    let fz = 0;
    let fy = 0;
    if (this.keys.has('KeyW')) fz -= 1;
    if (this.keys.has('KeyS')) fz += 1;
    if (this.keys.has('KeyA')) fx -= 1;
    if (this.keys.has('KeyD')) fx += 1;
    if (this.keys.has('KeyQ')) fy -= 1;
    if (this.keys.has('KeyE')) fy += 1;
    if (!fx && !fz && !fy) return;
    const step = KEY_SPEED * Math.min(dt, 0.05);
    const move = new THREE.Vector3();
    if (fx || fz) {
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-6) {
        fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        move.addScaledVector(right, fx).addScaledVector(fwd, -fz);
        if (move.lengthSq() > 0) move.normalize().multiplyScalar(step);
      }
    }
    move.y = fy * step;
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.lastActive = performance.now();
  }

  private ndc(ev: { clientX: number; clientY: number }): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /**
   * 拾取只有一条链路：射线源不同而已。
   * orbit = 点击坐标；walk = 屏幕中心 (0,0)。faceIndex → (book, chapter) 映射共用批 8 的那份。
   */
  private pickAt(ndc: THREE.Vector2): Pick | null {
    this.ray.setFromCamera(ndc, this.camera);
    if (this.view === 'hall') return this.pickHall();
    return this.pickRoom();
  }

  private pick(ev: PointerEvent): Pick | null {
    return this.pickAt(this.camMode === 'walk' ? CENTER_NDC : this.ndc(ev));
  }

  /**
   * 大厅：中央台面扇区 → 区、展柜书脊 → 该书首章、展柜柜体 → 该区展柜，
   * 再往后才是六栋阅览楼的外壳与门楣牌匾。全部走 faceIndex 下标取表，没有第二套射线逻辑。
   */
  private pickHall(): Pick | null {
    const targets: THREE.Object3D[] = [...this.doorPlaques.values()];
    if (this.deskTop) targets.push(this.deskTop);
    if (this.caseBodies) targets.push(this.caseBodies);
    for (const mesh of this.caseSpineMeshes) if (mesh.visible) targets.push(mesh);
    if (this.facades) targets.push(this.facades);
    for (const hit of this.ray.intersectObjects(targets, false)) {
      if (hit.object === this.deskTop) {
        const pick = this.deskPick(hit.faceIndex, hit.point);
        if (pick) return pick;
        continue;
      }
      const pageNo = hit.object.userData.page as number | undefined;
      if (pageNo !== undefined) {
        const page = this.casePages[pageNo];
        if (!page) continue;
        const pick = this.spinePick(page, hit.faceIndex, this.casePlan);
        if (pick) return pick;
        continue;
      }
      if (hit.object === this.caseBodies) {
        const idx = this.caseTriRef[Math.floor(hit.faceIndex ?? -1)];
        const stand = idx === undefined ? undefined : this.caseStands[idx];
        if (!stand) continue;
        const spec = ROOM_BY_KEY[stand.key];
        const n = this.casePlan?.spines.filter((sp) => this.casePlan?.slots[sp.slot]?.book.discipline === stand.key).length ?? 0;
        return {
          kind: 'room',
          discipline: stand.key,
          hint: n ? `${spec.title} 展柜 · 罩内 ${n} 根书脊 · 准星压脊读首章` : `${spec.title} 展柜 · 该区暂无书位`,
        };
      }
      const plaque = hit.object.userData.discipline as Discipline | undefined;
      if (plaque) {
        const spec = ROOM_BY_KEY[plaque];
        return { kind: 'room', discipline: plaque, hint: `进入 ${spec.title}` };
      }
      const idx = this.facadeZoneOf(hit.faceIndex);
      if (idx === null) continue;
      const spec = ROOMS[idx];
      if (!spec) continue;
      return { kind: 'room', discipline: spec.key, hint: `进入 ${spec.title}` };
    }
    return null;
  }

  /**
   * 台面命中 → 扇区：faceIndex → 构建期落的 `triSector`（与书脊 triSpine 同一张表机制）。
   * 中心那圈铜罗盘 ref = −1，不参与；半径小于 sectorR0 的落点也留给罗盘，不判成区。
   */
  private deskPick(faceIndex: number | null | undefined, at: THREE.Vector3): Pick | null {
    if (faceIndex === undefined || faceIndex === null) return null;
    const idx = this.deskTriSector[Math.floor(faceIndex)];
    if (idx === undefined || idx < 0) return null;
    if (Math.hypot(at.x, at.z) < ATRIUM.sectorR0) return null;
    const sec = this.deskSectors[idx];
    if (!sec) return null;
    const spec = ROOM_BY_KEY[sec.key];
    const c = this.deskCounts.get(sec.key) ?? { books: 0, chapters: 0 };
    return {
      kind: 'room',
      discipline: sec.key,
      sector: idx,
      title: `${spec.title} · ${c.books} 本 · ${c.chapters} 章 · 点击进入`,
      hint: `${spec.title} · ${c.books} 本 · ${c.chapters} 章 · 点击进入`,
    };
  }

  private facadeZoneOf(faceIndex: number | null | undefined): number | null {
    if (faceIndex === undefined || faceIndex === null) return null;
    const idx = this.facadeZones[Math.floor(faceIndex)];
    return idx === undefined ? null : idx;
  }

  /**
   * 房间：光尘最小、书脊其次，都走 faceIndex → (书, 章) 的构建期映射表；
   * 命中即返回，不做线性搜索。
   */
  private pickRoom(): Pick | null {
    const targets: THREE.Object3D[] = [];
    if (this.dust?.visible) targets.push(this.dust);
    for (const mesh of this.spineMeshes) if (mesh.visible) targets.push(mesh);
    for (const hit of this.ray.intersectObjects(targets, false)) {
      if (hit.object === this.dust) {
        if (hit.instanceId === undefined) continue;
        const ref = this.dotRefs[hit.instanceId];
        if (!ref) continue;
        return {
          kind: 'concept',
          discipline: ref.book.discipline,
          book: ref.book,
          id: ref.conceptId,
          hint: `概念 ${ref.conceptId} · 点击读正文`,
        };
      }
      const pageNo = hit.object.userData.page as number | undefined;
      const page = pageNo === undefined ? undefined : this.spinePages[pageNo];
      if (!page) continue;
      const pick = this.spinePick(page, hit.faceIndex, this.plan);
      if (pick) return pick;
    }
    return null;
  }

  /**
   * 书脊命中 → Pick：批 8 的 faceIndex 映射只有这一份，阅览室的架与大厅展柜的罩共用，
   * 差别只在把哪一套 slots/spines 账递进来（展柜那套由 manifest 现场搭）。
   */
  private spinePick(
    page: SpinePage,
    faceIndex: number | null | undefined,
    plan: { slots: BookSlot[]; spines: SpinePlacement[] } | null,
  ): Pick | null {
    const spine = this.spineAt(page, faceIndex, plan);
    if (!spine) return null;
    const slot = plan?.slots[spine.slot];
    if (!slot) return null;
    const title = slot.book.title || slot.book.bookSlug;
    const chapters = slot.chapters.length || (slot.book.stats?.chapters ?? 0);
    const role = page.triRole[Math.floor(faceIndex ?? 0)] ?? SPINE_FACE.cover;
    if (role === SPINE_FACE.chapter) {
      return {
        kind: 'chapter',
        discipline: slot.book.discipline,
        book: slot.book,
        id: spine.chapter.id,
        hint: `${title} · ${spine.chapter.title || spine.chapter.id || '首章'} · 点击读正文`,
      };
    }
    return {
      kind: 'book',
      discipline: slot.book.discipline,
      book: slot.book,
      hint: `${title} · ${chapters} 章 · 铜牌＝该书总览`,
    };
  }

  /** faceIndex → 书脊：构建期落好的映射表，点击时只做一次下标取值 */
  private spineAt(
    page: SpinePage,
    faceIndex: number | null | undefined,
    plan: { slots: BookSlot[]; spines: SpinePlacement[] } | null,
  ): SpinePlacement | null {
    if (faceIndex === undefined || faceIndex === null || !plan) return null;
    const idx = page.triSpine[Math.floor(faceIndex)];
    if (idx === undefined) return null;
    return plan.spines[idx] ?? null;
  }

  handleClick(ev: PointerEvent): void {
    // OrbitControls 拖拽后浏览器仍会派发 click，按位移阈值把拖动排除掉。
    // pointerup 已经判成拖拽时直接沿用（同一次手势，两处的位移读数本就一致）。
    const { kind, slop, moved } = this.tapVerdict(ev);
    const dragged = moved >= slop || this.lastTapInfo?.action === 'drag';
    if (dragged) {
      this.lastTapInfo = { moved: round2(moved), slop, kind, action: 'drag' };
      return;
    }
    this.lastTapInfo = { moved: round2(moved), slop, kind, action: 'tap' };
    // 漫游的触屏点按：先判位移、再判时长。按住不动是「在看」不是「要读」，不该开书面板。
    // 顺序不能反——先看时长会把「慢慢拖过头」的手势误判成点击。只作用于 walk，俯瞰行为不动。
    if (this.camMode === 'walk' && performance.now() - this.downAtMs > WALK.tapMaxMs) {
      this.lastTapInfo.action = 'drag';
      return;
    }
    const hit = this.pick(ev);
    if (!hit) {
      this.lastTapInfo.action = 'tap-miss';
      return;
    }
    if (hit.kind === 'room') this.hooks.onPickRoom(hit.discipline);
    else if (hit.kind === 'book' && hit.book) this.hooks.onPickBook(hit.discipline, hit.book);
    else if (hit.kind === 'chapter' && hit.book && !hit.id) {
      // 展柜书脊：首章 id 不在 manifest 里，交阅读层现取记录再开（不为大厅预取六个分片）
      this.hooks.onFirstChapter?.(hit.discipline, hit.book);
    }
    else if (hit.kind === 'chapter' && hit.book && hit.id) {
      // 不补发 onPickBook：main.pickChapter 自己就做了 setSelection + openBook + openChapter。
      // 两条链各调一次 bookRecord（未缓存 = 两次 fetch），回来的先后不定，晚到的 openBook
      // 会把面板从 chapter 打回 overview——390「点书脊开正文」那条就是飘在这里的。
      this.hooks.onPickChapter(hit.discipline, hit.book, hit.id);
    } else if (hit.kind === 'concept' && hit.book && hit.id) {
      this.hooks.onPickConcept(hit.discipline, hit.book, hit.id);
    }
  }

  lastTap(): Matrix3D['lastTapInfo'] {
    return this.lastTapInfo;
  }

  quality(): {
    name: string;
    dprCap: number;
    pixelRatio: number;
    shadows: boolean;
    shadowMapSize: number;
    bloom: boolean;
    bloomScale: number;
    renderScale: number;
    dustBudget: number;
    viewport: { w: number; h: number; aspect: number };
    fov: number;
    lensKx: number;
  } {
    return {
      name: this.tier.name,
      dprCap: this.tier.dprCap,
      pixelRatio: this.renderer.getPixelRatio(),
      shadows: this.renderer.shadowMap.enabled,
      shadowMapSize: this.keyLight?.shadow?.mapSize.width ?? 0,
      bloom: this.tier.bloom,
      bloomScale: this.tier.bloomScale,
      renderScale: this.renderScale,
      dustBudget: Number.isFinite(this.tier.dustBudget) ? this.tier.dustBudget : -1,
      viewport: {
        w: this.root.clientWidth,
        h: this.root.clientHeight,
        aspect: this.camera.aspect,
      },
      fov: this.camera.fov,
      lensKx: Number(this.lensKx.toFixed(4)),
    };
  }

  /**
   * 构图账（批 9 判据「竖屏构图两项」的口径）：把结构关键点投到 NDC，按分组给入画数。
   * 大厅看六个阅览体量中心 + 六个门洞 + 八角厅天花顶点；阅览室分背墙包络 / 书墙中段 /
   * 天花梁下 / 地面 / 书架排五组，口径逐组写在下面 room 分支的注释里。
   * 地面 quad 铺到 ±360，是背景不是构图对象，不进这条账。
   */
  frameCheck(): FrameCheck {
    this.syncWorld();
    const inHall = this.view === 'hall';
    const side = this.plan?.side ?? 0;
    const height = this.plan?.height ?? ROOM_HEIGHT;
    const raw: Array<{ name: string; group: string; local: [number, number, number] }> = [];
    if (inHall) {
      for (const r of ROOMS) {
        raw.push({ group: 'facades', name: `facade:${r.key}`, local: [r.at[0], ROOM_HEIGHT * 0.5, r.at[1]] });
        raw.push({ group: 'doors', name: `door:${r.key}`, local: [Math.cos(r.angle) * (HALL_RADIUS + 1), ROOM_DOOR.h * 0.5, Math.sin(r.angle) * (HALL_RADIUS + 1)] });
      }
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
        raw.push({ group: 'ceiling', name: `ceil:${i}`, local: [Math.cos(a) * HALL_RADIUS, HALL_HEIGHT, Math.sin(a) * HALL_RADIUS] });
      }
    } else {
      // 判据口径（批 9 B1）：分组要问的是「画面里有没有一间房」，不是「房间八个顶点能不能全塞进画」。
      // 窄屏 aspect 0.46 时水平半角只有 20°出头，两侧墙在室内任何机位都必然出画，
      // 硬凑「全部顶点入画」只能把机位退到门外十几单位——那是一张娃娃屋剖面图，
      // 书脊被压到 20px 以下、指头点不中章节带。故这里把「严格包络」与「构图要素」分开：
      //   back     后墙四角（只作参考量，桌面横屏才可能满，竖屏注定不满）
      //   face     后墙书墙中段（画面正中是一面书）
      //   ceiling  天花梁下远段（画面上方有顶，不是空洞）
      //   floor    地面中近段（画面下方有地，不是悬空）
      //   shelves  每一排书架的排中心
      const half = side / 2;
      for (const sx of [-1, 1]) {
        for (const sy of [0.2, height]) {
          raw.push({ group: 'back', name: `back:${sx}:${sy}`, local: [(sx * half) * 0.98, sy, half * 0.98] });
        }
        for (const sy of [height * 0.3, height * 0.75]) {
          raw.push({ group: 'face', name: `face:${sx}:${sy}`, local: [sx * half * 0.35, sy, half * 0.98] });
        }
        raw.push({ group: 'sidewall', name: `side:${sx}:mid`, local: [(sx * half) * 0.98, height * 0.55, half * 0.2] });
        raw.push({ group: 'sidewall', name: `side:${sx}:foot`, local: [(sx * half) * 0.98, 0.25, half * 0.5] });
        raw.push({ group: 'ceiling', name: `ceil:${sx}:beam`, local: [sx * half * 0.45, height - 2.2, half * 0.9] });
        raw.push({ group: 'ceiling', name: `ceil:${sx}:far`, local: [sx * half * 0.2, height - 2.2, half * 0.98] });
        raw.push({ group: 'floor', name: `floor:${sx}:near`, local: [sx * half * 0.25, 0.2, -half * 0.2] });
        raw.push({ group: 'floor', name: `floor:${sx}:mid`, local: [sx * half * 0.25, 0.2, half * 0.4] });
      }
      (this.plan?.rows ?? []).forEach((row, i) => {
        raw.push({ group: 'shelves', name: `shelf:${i}`, local: [row.x, SHELF_HEIGHT * 0.5, row.z] });
      });
    }
    const groups: Record<string, { in: number; total: number }> = {};
    const points: FrameCheck['points'] = [];
    for (const p of raw) {
      const world = inHall
        ? new THREE.Vector3(...p.local).applyMatrix4(this.hall.matrixWorld)
        : this.localToWorld(p.local);
      const v = world.project(this.camera);
      const inFrame = Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1;
      const g = groups[p.group] ?? { in: 0, total: 0 };
      g.total += 1;
      if (inFrame) g.in += 1;
      groups[p.group] = g;
      points.push({
        name: p.name,
        inFrame,
        ndc: [Number(v.x.toFixed(3)), Number(v.y.toFixed(3)), Number(v.z.toFixed(3))],
      });
    }
    return {
      view: this.view,
      fov: this.camera.fov,
      aspect: this.camera.aspect,
      points,
      inFrame: points.filter((p) => p.inFrame).length,
      total: points.length,
      groups,
    };
  }

  /**
   * 批 10 A2 判据「主体占屏比」：主体点集投到 NDC，V/H = 包围盒宽高 ÷2（满屏 = 1）。
   * 口径：大厅 = 八角厅壳 16 个角点 + 六条走廊远端四角 + 六块门签四角（不含体量外壳的
   * 整栋楼——近端楼体在俯冲机位下天然探出下缘，任务书口径就到门签为止）；
   * 阅览室 = frameCheck 的 back/side/ceiling/floor 四组结构点（询问「房间占了多少画面」，
   * 而不是「外壳八个角能否全进画」——近端两角在相机背后，任何室内机位都投不出来）。
   * 另给 clipped：裁到 [−1,1] 的占屏比，避免「主体出画反把百分比做大」。
   */
  subjectBox(which: 'hall' | 'room' = this.view === 'hall' ? 'hall' : 'room'): {
    view: string;
    points: number;
    v: number;
    h: number;
    vClipped: number;
    hClipped: number;
    vSpan: number;
    hSpan: number;
    ndc: [number, number, number, number];
  } {
    this.syncWorld();
    const pts: THREE.Vector3[] = [];
    if (which === 'hall') {
      const Rc = HALL_RADIUS / Math.cos(Math.PI / 8);
      for (let k = 0; k < 8; k += 1) {
        const a = (Math.PI * 2 * k) / 8 + Math.PI / 8;
        for (const y of [0, HALL_HEIGHT]) {
          pts.push(new THREE.Vector3(Math.cos(a) * Rc, y, Math.sin(a) * Rc));
        }
      }
      for (const r of ROOMS) {
        const t = new THREE.Vector3(-Math.sin(r.angle), 0, Math.cos(r.angle));
        const rad = new THREE.Vector3(Math.cos(r.angle), 0, Math.sin(r.angle));
        for (const y of [0, ROOM_DOOR.h]) {
          for (const s of [-1, 1]) {
            pts.push(new THREE.Vector3().copy(rad).multiplyScalar(HALL_RADIUS).addScaledVector(t, s * (DOOR_W / 2)).setY(y));
          }
        }
        for (const y of [0.03, CORRIDOR_H]) {
          for (const s of [-1, 1]) {
            pts.push(new THREE.Vector3().copy(rad).multiplyScalar(136.5).addScaledVector(t, s * (CORRIDOR_W / 2)).setY(y));
          }
        }
        for (const dy of [-1.55, 1.55]) {
          for (const s of [-1, 1]) {
            pts.push(new THREE.Vector3().copy(rad).multiplyScalar(ROOM_DIST - FACADE_SIDE / 2 - 1.35).addScaledVector(t, s * 4.7).setY(ROOM_DOOR.h + 1.9 + dy));
          }
        }
      }
    } else {
      const half = (this.plan?.side ?? 0) / 2;
      const height = this.plan?.height ?? ROOM_HEIGHT;
      for (const sx of [-1, 1]) {
        for (const sy of [0.2, height]) pts.push(this.localToWorld([(sx * half) * 0.98, sy, half * 0.98]).clone());
        pts.push(this.localToWorld([(sx * half) * 0.98, height * 0.55, half * 0.2]).clone());
        pts.push(this.localToWorld([(sx * half) * 0.98, 0.25, half * 0.5]).clone());
        pts.push(this.localToWorld([sx * half * 0.45, height - 2.2, half * 0.9]).clone());
        pts.push(this.localToWorld([sx * half * 0.2, height - 2.2, half * 0.98]).clone());
        pts.push(this.localToWorld([sx * half * 0.25, 0.2, -half * 0.2]).clone());
        pts.push(this.localToWorld([sx * half * 0.25, 0.2, half * 0.4]).clone());
      }
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let cMinX = Infinity;
    let cMaxX = -Infinity;
    let cMinY = Infinity;
    let cMaxY = -Infinity;
    for (const p of pts) {
      const v = p.project(this.camera);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      cMinX = Math.min(cMinX, Math.max(-1, Math.min(1, v.x)));
      cMaxX = Math.max(cMaxX, Math.max(-1, Math.min(1, v.x)));
      cMinY = Math.min(cMinY, Math.max(-1, Math.min(1, v.y)));
      cMaxY = Math.max(cMaxY, Math.max(-1, Math.min(1, v.y)));
    }
    return {
      view: this.view,
      points: pts.length,
      v: Number(((maxY - minY) / 2).toFixed(4)),
      h: Number(((maxX - minX) / 2).toFixed(4)),
      vClipped: Number(((cMaxY - cMinY) / 2).toFixed(4)),
      hClipped: Number(((cMaxX - cMinX) / 2).toFixed(4)),
      vSpan: Number((maxY - minY).toFixed(4)),
      hSpan: Number((maxX - minX).toFixed(4)),
      ndc: [Number(minX.toFixed(3)), Number(maxX.toFixed(3)), Number(minY.toFixed(3)), Number(maxY.toFixed(3))],
    };
  }

  /**
   * 批 10 B 判据「补光是否真的把梁/门洞/总览图分开」：世界点 → 屏幕 3×3 邻域均值亮度。
   * 全部取读回 framebuffer 的 8 位值（ACES 之后的口径），门槛数字即 0–255 的差。
   */
  private probeWorldPoints(pts: Array<[number, number, number]>): number[] {
    this.syncWorld();
    this.renderOnce();
    const gl = this.renderer.getContext();
    const rw = gl.drawingBufferWidth;
    const rh = gl.drawingBufferHeight;
    const one = new Uint8Array(4);
    return pts.map((p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
      const cx = Math.round((v.x * 0.5 + 0.5) * rw);
      const cy = Math.round((v.y * 0.5 + 0.5) * rh);
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = Math.max(0, Math.min(rw - 1, cx + dx));
          const sy = Math.max(0, Math.min(rh - 1, cy + dy));
          gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
          sum += (0.2126 * one[0] + 0.7152 * one[1] + 0.0722 * one[2]) / 255;
          n += 1;
        }
      }
      return sum / n;
    });
  }

  /**
   * 大厅补光三账：藻井梁 vs 井板、门洞内侧 vs 走廊地面、地面总览图均值 + 整帧 p5/暗像素比。
   * 采样点固定在世界坐标（与帧率、机型无关），每类取多组再平均，避开单像素噪声。
   * p5 读整帧（sampleLuminance 的 96×96 网格），暗像素阈值 0.02。
   */
  /** 批 15：天花板从倒锥改成水平盘之后，梁与藻井环整条埋在盘下（21.3 / 20.95 对 22），
   *  俯瞰机位被屋顶整片挡住，原采样点（梁顶 21.775 / 井板顶 21.15）读到的是星空。
   *  改从漫游机位读底面：梁底 20.82、藻井底面 20.74，同一半径 40.8、方位差 π/8（落在梁间空隙中央）。 */
  beamPanelProbe(): { beam: number; panel: number; beamDiff: number } {
    const ring: Array<[number, number, number]> = [];
    const panels: Array<[number, number, number]> = [];
    // 只用朝 +z 的两个扇（45° / 135°）：漫游采样时机位在 (0,-12) 朝 +z，身后两个扇投不出可信屏幕坐标。
    for (const aBeam of [Math.PI / 4, (Math.PI * 3) / 4]) {
      const aPanel = aBeam + Math.PI / 8;
      ring.push([Math.cos(aBeam) * 40.8, 20.82, Math.sin(aBeam) * 40.8]);
      panels.push([Math.cos(aPanel) * 40.8, 20.74, Math.sin(aPanel) * 40.8]);
    }
    const beam = this.probeWorldPoints(ring);
    const panel = this.probeWorldPoints(panels);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    return {
      beam: Number(mean(beam).toFixed(4)),
      panel: Number(mean(panel).toFixed(4)),
      beamDiff: Number((Math.abs(mean(beam) - mean(panel)) * 255).toFixed(2)),
    };
  }

  hallLightProbe(): {
    beam: number;
    panel: number;
    beamDiff: number;
    doorIn: number;
    doorOut: number;
    doorDiff: number;
    groundMean: number;
    groundMin: number;
    frameP5: number;
    frameP50: number;
    darkRatio: number;
  } {
    const ring: Array<[number, number, number]> = [];
    const panels: Array<[number, number, number]> = [];
    for (let k = 0; k < 4; k += 1) {
      const aBeam = (Math.PI / 2) * k + Math.PI / 4;
      const aPanel = aBeam + Math.PI / 8;
      ring.push([Math.cos(aBeam) * 40.8, 21.775, Math.sin(aBeam) * 40.8]);
      panels.push([Math.cos(aPanel) * 40.8, 21.15, Math.sin(aPanel) * 40.8]);
    }
    const beamLum = this.probeWorldPoints(ring);
    const panelLum = this.probeWorldPoints(panels);
    const ins: Array<[number, number, number]> = [];
    const outs: Array<[number, number, number]> = [];
    for (const r of ROOMS) {
      ins.push([Math.cos(r.angle) * 38, 0.05, Math.sin(r.angle) * 38]);
      outs.push([Math.cos(r.angle) * 50, 0.06, Math.sin(r.angle) * 50]);
    }
    const inLum = this.probeWorldPoints(ins);
    const outLum = this.probeWorldPoints(outs);
    const groundPts: Array<[number, number, number]> = [];
    for (const rad of [0, 12, 22]) {
      for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        groundPts.push([Math.cos(a) * rad, 0.02, Math.sin(a) * rad]);
      }
    }
    const ground = this.probeWorldPoints(groundPts);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const frame = this.sampleLuminance(0, 0, 1, 1);
    return {
      beam: Number(mean(beamLum).toFixed(4)),
      panel: Number(mean(panelLum).toFixed(4)),
      beamDiff: Number((Math.abs(mean(beamLum) - mean(panelLum)) * 255).toFixed(2)),
      doorIn: Number(mean(inLum).toFixed(4)),
      doorOut: Number(mean(outLum).toFixed(4)),
      doorDiff: Number((Math.abs(mean(inLum) - mean(outLum)) * 255).toFixed(2)),
      groundMean: Number(mean(ground).toFixed(4)),
      groundMin: Number(Math.min(...ground).toFixed(4)),
      frameP5: frame.p5,
      frameP50: frame.p50,
      darkRatio: frame.darkRatio,
    };
  }

  /**
   * 批 10 C 判据「题签宽度」：对准第 i 条书脊，横向跨脊扫 7 条扫描线，找暗带边界，
   * 暗带宽度 / 脊宽 = 实测题签占比；与图集绘制参数（SPINE_PLATE_RECT.w / 32）互为双证。
   * 扫描线落在题签纵向中段（0.26–0.62，题签占 0.2125–0.6875），避开上下金线与菱形。
   * 边界用「从两端皮革向内找连续 4 个暗样本」而不是从中心向外扩：题签上的亮色书名笔画
   * 会把中心扩展法截断，而两端向内扫不受笔画影响；阈值锚在题签底色 p10 上 +0.045 固定余量
   * （不用 p90 分位：横贯书脊的金线会把自适应阈值抬到 0.15，皮革 0.11–0.19 会被误判成暗）。
   */
  spinePlateProbe(i: number): { index: number; ratio: number; ratios: number[]; spinePx: number; platePx: number } | null {
    this.syncWorld();
    const sp = this.plan?.spines[i];
    if (!sp) return null;
    this.renderOnce();
    const gl = this.renderer.getContext();
    const rw = gl.drawingBufferWidth;
    const rh = gl.drawingBufferHeight;
    const across = new THREE.Vector3(-sp.normal[1], 0, sp.normal[0]);
    // 采样面必须落在正面（中心朝观察者偏 depth/2）而不是中心平面：
    // 中心平面在正面后面 0.85，透视下投影宽只有正面的 ~75%，量出来的分母就偏小，
    // 题签占比会从 0.625 虚高到 ~0.77（批 10 C1 第一次实测踩的就是这个）。
    const faceOut = sp.depth / 2 + 0.03;
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const edge = (t: number, fy: number, out: THREE.Vector3): THREE.Vector3 => out.copy(this.localToWorld([
      sp.x + across.x * (t * sp.w) / 2 + sp.normal[0] * faceOut,
      sp.y + (fy - 0.5) * sp.h,
      sp.z + across.z * (t * sp.w) / 2 + sp.normal[1] * faceOut,
    ])).project(this.camera);
    const one = new Uint8Array(4);
    const lumAt = (px: number, py: number): number => {
      gl.readPixels(Math.max(0, Math.min(rw - 1, px)), Math.max(0, Math.min(rh - 1, py)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      return (0.2126 * one[0] + 0.7152 * one[1] + 0.0722 * one[2]) / 255;
    };
    const ratios: number[] = [];
    let spinePx = 0;
    let platePx = 0;
    for (const fy of [0.26, 0.32, 0.38, 0.44, 0.50, 0.56, 0.62]) {
      edge(-1, fy, left);
      edge(1, fy, right);
      const x0 = (left.x * 0.5 + 0.5) * rw;
      const x1 = (right.x * 0.5 + 0.5) * rw;
      const y = Math.round((left.y * 0.5 + 0.5) * rh);
      const span = Math.abs(x1 - x0);
      if (span < 8) continue;
      const steps = Math.max(24, Math.round(span * 2));
      const lum: number[] = [];
      for (let s = 0; s <= steps; s += 1) {
        lum.push(lumAt(Math.round(x0 + ((x1 - x0) * s) / steps), y));
      }
      const sorted = [...lum].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
      // 阈值锚在题签底色（p10）上 + 固定余量，不用 p90 分位：
      // 书脊上横贯整条的金线会把 p90 抬到 0.45，自适应阈值跟着涨到 0.15，
      // 皮革（0.11–0.19）就被误判成「暗」，同一根书脊的七条扫描线里冒出一条 0.70 的假值。
      const thresh = p10 + 0.045;
      const darkFrom = (from: number, dir: 1 | -1): number => {
        for (let s = from; s >= 3 && s <= steps - 3; s += dir) {
          if (lum[s] <= thresh && lum[s + dir] <= thresh && lum[s + 2 * dir] <= thresh && lum[s + 3 * dir] <= thresh) return s;
        }
        return from;
      };
      const a = darkFrom(Math.floor(steps * 0.12), 1);
      const b = darkFrom(Math.ceil(steps * 0.88), -1);
      const ratio = (b - a) / steps;
      ratios.push(ratio);
      spinePx = Math.round(span);
      platePx = Math.round(span * ratio);
    }
    if (!ratios.length) return null;
    ratios.sort((x, y) => x - y);
    const median = ratios[Math.floor(ratios.length / 2)];
    return { index: i, ratio: Number(median.toFixed(4)), ratios: ratios.map((r) => Number(r.toFixed(4))), spinePx, platePx };
  }

  /**
   * 批 9 C3 判据「书脊字口反差」：对本区每一本书的皮革底色算一次字色/背景对比度，
   * 口径与算法都在 atlas.spineInkContrast 的注释里（背景是暗题签底板压在皮革上的合成色）。
   * 返回逐本比值，门槛读 `min`。
   */
  spineContrast(): {
    zone: string | null;
    ink: string;
    books: number;
    min: number;
    p50: number;
    ratios: number[];
  } {
    const slots = this.plan?.slots ?? [];
    const ratios = slots.map((s) => spineInkContrast(s.color)).sort((a, b) => a - b);
    return {
      zone: this.roomKey ?? null,
      ink: SPINE_INK,
      books: ratios.length,
      min: ratios[0] ?? 0,
      p50: ratios[Math.floor(ratios.length / 2)] ?? 0,
      ratios: ratios.slice(0, 12),
    };
  }

  /** 自动化自检用：把区 / 书位节点的世界坐标投到 CSS 像素坐标 */
  screenPoint(kind: 'room' | 'book', id: string): { x: number; y: number } | null {
    this.syncWorld();
    let world: THREE.Vector3 | null = null;
    if (kind === 'room') {
      if (this.view !== 'hall') return null;
      const plaque = this.doorPlaques.get(id as Discipline);
      if (plaque) world = plaque.position.clone();
    } else {
      if (this.view !== 'room') return null;
      const slot = this.plan?.slots.find((s) => `${s.book.repo}::${s.book.bookSlug}` === id);
      if (!slot) return null;
      world = this.localToWorld([slot.cx, slot.bookH * 0.6, slot.cz]);
    }
    if (!world) return null;
    const ndc = world.clone().project(this.camera);
    if (ndc.z < -1 || ndc.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  }

  private localToWorld(p: [number, number, number]): THREE.Vector3 {
    return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.room.matrixWorld);
  }

  /**
   * 取证专用：新机位还没过 render 时 matrixWorld / matrixWorldInverse 都是上一帧的，
   * 直接投影会得到 p.z 越界的「屏幕外」假象。手动对齐一次，屏幕点与射线才同帧。
   */
  private syncWorld(): void {
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
  }

  /** 自检用：当前房间实际建出的册数、书脊数、光尘数 */
  nodeStats(): { books: number; columns: number; dots: number; spines: number; chapters: number; spinesEqualChapters: boolean } {
    const chapters = this.plan?.chapterCount ?? 0;
    const spines = this.plan?.spines.length ?? 0;
    return {
      books: this.plan?.bookCount ?? 0,
      columns: spines,
      dots: this.dotRefs.length,
      spines,
      chapters,
      spinesEqualChapters: spines === chapters && chapters > 0,
    };
  }

  /** 自检用：房间结构账（墙 / 天花 / 书架排 / 书脊 draw call / 浮空标签）——读构建期落好的账，不重算几何 */
  structure(): RoomAccount {
    const stats = this.shellStats;
    let wallMeshes = 0;
    let ceilingMesh = false;
    let floorMesh = false;
    let beamMesh = false;
    for (const o of this.roomObjects) {
      if (o.userData.role === 'wall') wallMeshes += 1;
      else if (o.userData.role === 'ceiling') ceilingMesh = true;
      else if (o.userData.role === 'roomFloor') floorMesh = true;
      else if (o.userData.role === 'ceilingBeams') beamMesh = true;
    }
    const rows = this.plan?.rows ?? [];
    return {
      walls: stats?.walls ?? 0,
      ceiling: !!stats && ceilingMesh,
      floor: !!stats && floorMesh,
      ceilingBeams: stats?.ceilingBeams ?? 0,
      baseboards: stats?.baseboards ?? 0,
      rails: stats?.rails ?? 0,
      side: stats?.side ?? 0,
      height: stats?.height ?? 0,
      door: { w: ROOM_DOOR.w, h: ROOM_DOOR.h },
      seen: { wallMeshes, ceilingMesh, floorMesh, beamMesh },
      shelfRows: rows.length,
      tiers: rows.reduce((max, r) => Math.max(max, r.levels), 0),
      dividers: (this.plan?.slots.length ?? 0) * 2,
    };
  }

  /** 取证：把相机怼到第 i 条书脊正面，用于「书名可读」特写截图 */
  focusSpine(i: number, dist = 3.4): SpineProbe | null {
    this.syncWorld();
    const sp = this.plan?.spines[i];
    if (!sp || !this.plan) return null;
    const center = this.localToWorld([sp.x, sp.y, sp.z]);
    const outward = this.localToWorld([
      sp.x + sp.normal[0] * dist,
      sp.y,
      sp.z + sp.normal[1] * dist,
    ]);
    this.camera.position.copy(outward);
    this.controls.target.copy(center);
    this.resetInertia();
    this.updateControls();
    this.renderer.shadowMap.needsUpdate = true;
    this.wake();
    return this.spineProbe(i);
  }

  spineProbe(i: number): SpineProbe | null {
    this.syncWorld();
    const sp = this.plan?.spines[i];
    if (!sp || !this.plan) return null;
    const slot = this.plan.slots[sp.slot];
    if (!slot) return null;
    const p = this.localToWorld([sp.x, sp.y, sp.z]).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const inside = p.z >= -1 && p.z <= 1;
    const screen = inside
      ? {
          x: rect.left + ((p.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - p.y) / 2) * rect.height,
        }
      : null;
    // 书脊在屏幕上的像素高：脊面上下沿各投一次。竖屏「指头点得中章节带」的判据口径。
    const top = this.localToWorld([sp.x, sp.y + sp.h / 2, sp.z]).project(this.camera);
    const foot = this.localToWorld([sp.x, sp.y - sp.h / 2, sp.z]).project(this.camera);
    const px = inside ? Math.round(((Math.abs(top.y - foot.y) / 2) * rect.height)) : 0;
    // 真实拾取回归：射线打在该书脊屏幕点上，结果应与 faceIndex 映射表一致
    const probe = screen ? this.probePick(screen.x, screen.y) : null;
    return {
      index: i,
      book: slot.book.file,
      chapterId: sp.chapter.id,
      chapterIndex: sp.chapterIndex,
      screen,
      px,
      hit: probe
        ? { kind: probe.kind, book: probe.book ?? '', chapterId: probe.id ?? '' }
        : undefined,
    };
  }

  /** 自检：在屏幕点上跑一次真实拾取，与 faceIndex 映射表比对 */
  probePick(x: number, y: number): { kind: string; book: string | null; id: string | null } | null {
    this.syncWorld();
    this.ray.setFromCamera(this.ndc({ clientX: x, clientY: y }), this.camera);
    const hit = this.view === 'hall' ? this.pickHall() : this.pickRoom();
    if (!hit) return null;
    return { kind: hit.kind, book: hit.book?.file ?? null, id: hit.id ?? null };
  }

  /**
   * 取证专用：把第 i 条书脊用到的图集格原样裁出来（放大 4 倍）落成 dataURL，
   * 同时给出「格像素 → 屏幕像素」的放大倍率，用来判断书名糊掉是分辨率问题还是倍率问题。
   */
  spineCellPeek(i: number): { png: string; cell: number[]; world: number[]; screen: number[]; magnify: number } | null {
    const sp = this.plan?.spines[i];
    const atlas = this.atlas;
    if (!sp || !atlas) return null;
    const cell = atlas.cells[sp.cell];
    if (!cell) return null;
    const cw = Math.round((cell.u1 - cell.u0) * ATLAS_SIZE);
    const ch = Math.round((cell.v1 - cell.v0) * ATLAS_SIZE);
    const src = atlas.textures[cell.page].image as HTMLCanvasElement;
    const out = document.createElement('canvas');
    out.width = cw * 4;
    out.height = ch * 4;
    const g = out.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    // UV v 向上、canvas y 向下：格左上角的 canvas y = (1 - v1) * ATLAS_SIZE
    g.drawImage(src, Math.floor(cell.u0 * ATLAS_SIZE), Math.floor((1 - cell.v1) * ATLAS_SIZE), cw, ch, 0, 0, cw * 4, ch * 4);
    const ph = this.renderer.domElement.height;
    const screenW = (sp.w / Math.max(1e-6, this.camera.position.distanceTo(new THREE.Vector3(...this.localToWorld([sp.x, sp.y, sp.z]))))) * ph;
    return {
      png: out.toDataURL('image/png'),
      cell: [cw, ch],
      world: [Number(sp.w.toFixed(3)), Number(sp.h.toFixed(3))],
      screen: [Math.round(screenW), Math.round((screenW * sp.h) / sp.w)],
      magnify: Number((screenW / cw).toFixed(2)),
    };
  }

  /** WASD 判据要证明「只平移不转向」：相机朝向单位向量 */
  direction(): { x: number; y: number; z: number } {
    const v = new THREE.Vector3();
    this.camera.getWorldDirection(v);
    return { x: v.x, y: v.y, z: v.z };
  }

  nudge(): void {
    this.wake();
  }

  highlightConcept(conceptId: string | null): void {
    if (this.conceptShown === conceptId) return;
    this.conceptShown = conceptId;
    this.recolorDots();
    this.wake();
  }

  private recolorDots(): void {
    if (!this.dust) return;
    const col = new THREE.Color();
    const gold = new THREE.Color('#ffd66b');
    this.dotRefs.forEach((ref, i) => {
      this.dust?.setColorAt(i, col.copy(ref.conceptId === this.conceptShown ? gold : this.dotBase));
    });
    if (this.dust.instanceColor) this.dust.instanceColor.needsUpdate = true;
  }

  private updateBillboards(): void {
    const dots = this.dust;
    if (!dots || !dots.visible || !this.dotSeeds.length) return;
    this.camera.updateMatrixWorld();
    this.billboardQuat.setFromRotationMatrix(this.camera.matrixWorld);
    for (let i = 0; i < Math.min(this.dotSeeds.length, dots.count); i += 1) {
      const seed = this.dotSeeds[i];
      this.billboardMat.compose(
        seed.pos,
        this.billboardQuat,
        this.billboardScale.set(seed.size, seed.size, 1),
      );
      dots.setMatrixAt(i, this.billboardMat);
    }
    dots.instanceMatrix.needsUpdate = true;
  }

  /** 取证与排障：按角色整类隐藏，用来定位帧率预算落在哪一层（不影响构建账） */
  roleHide(role: string, hide: boolean): number {
    let n = 0;
    this.scene.traverse((o) => {
      if (o.userData.role === role) {
        o.visible = !hide;
        n += 1;
      }
    });
    this.wake();
    return n;
  }

  triangles(): number {
    return this.renderer.info.render.triangles;
  }

  census(): RenderCensus {
    const materials: Record<string, number> = {};
    const lights: Record<string, number> = {};
    const lightSpec: RenderCensus['lightSpec'] = [];
    let main = 0;
    let shadow = 0;
    let lit = 0;
    let unlit = 0;
    let sprites = 0;
    let spineTris = 0;
    const builtShelfGeometry: string[] = [];
    let builtShelfKind: string | null = null;
    let shelfRows = 0;
    let shelfTiers = 0;
    let shelfDividers = 0;
    let hallSides = 0;
    let hallDoors = 0;
    let hallMurals = 0;
    let hallBeams = 0;
    let facades = 0;
    let ground = false;
    let spineMeshes = 0;
    let plaqueTextures = 0;
    let nameplateTextures = 0;
    walkVisible(this.scene, (obj) => {
      if ((obj as THREE.Light).isLight) {
        const light = obj as THREE.Light;
        lights[light.type] = (lights[light.type] ?? 0) + 1;
        const punctual = light as THREE.PointLight;
        lightSpec.push({
          type: light.type,
          color: (light as THREE.DirectionalLight).color?.getHex() ?? 0,
          intensity: light.intensity,
          distance: punctual.distance ?? 0,
          decay: punctual.decay ?? 0,
          castShadow: (light as THREE.DirectionalLight).castShadow === true,
        });
        return;
      }
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh && !(obj as THREE.Sprite).isSprite) return;
      if ((obj as THREE.Sprite).isSprite) sprites += 1;
      const tris = trianglesOf(mesh);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const drawPasses = mats.some((m) => m?.transparent && m.side === THREE.DoubleSide) ? 2 : 1;
      main += tris * drawPasses;
      if (mesh.castShadow) shadow += tris * drawPasses;
      for (const m of mats) {
        if (!m) continue;
        materials[m.type] = (materials[m.type] ?? 0) + 1;
        if (m.type === 'MeshStandardMaterial' || m.type === 'MeshPhysicalMaterial') lit += 1;
        else if (m.type === 'MeshBasicMaterial') unlit += 1;
      }
      const role = obj.userData.role as string | undefined;
      switch (role) {
        case 'shelves': {
          const st = obj.userData.stats as { rows: number; tiers: number; dividers: number } | undefined;
          shelfRows = st?.rows ?? 0;
          shelfTiers = st?.tiers ?? 0;
          shelfDividers = st?.dividers ?? 0;
          const sig = obj.userData.signature as string[] | undefined;
          if (sig) builtShelfGeometry.push(...sig);
          builtShelfKind = this.roomKey ? SHELF_KINDS[this.roomKey] : null;
          break;
        }
        case 'spines':
          spineMeshes += 1;
          spineTris += tris;
          break;
        case 'hallWall':
          hallSides = ((this.hall.userData.stats as { sides?: number })?.sides) ?? 0;
          hallDoors = ((this.hall.userData.stats as { doors?: number })?.doors) ?? 0;
          hallMurals = ((this.hall.userData.stats as { murals?: number })?.murals) ?? 0;
          break;
        case 'hallBeams':
          hallBeams = (obj.userData.count as number) ?? 0;
          break;
        case 'facades':
          facades = 1;
          break;
        case 'ground':
          ground = true;
          break;
        case 'plaque':
        case 'lintelPlaque':
          plaqueTextures += 1;
          break;
        case 'corridorName':
          nameplateTextures += 1;
          break;
        default:
          break;
      }
    });
    const env = this.scene.environment;
    const bloom = this.bloomPass;
    const domFloating = this.root.querySelectorAll('[data-floating-label]').length;
    return {
      materials,
      litMaterials: lit,
      unlitMaterials: unlit,
      lights,
      lightSpec,
      toneMapping: toneName(this.renderer.toneMapping),
      directionalCastShadow: this.keyLight?.castShadow === true,
      shadow: {
        enabled: this.renderer.shadowMap.enabled,
        type: shadowTypeName(this.renderer.shadowMap.type),
        requested: shadowTypeName(this.shadowRequested),
        mapSize: this.keyLight?.shadow?.mapSize.width ?? 0,
        autoUpdate: this.renderer.shadowMap.autoUpdate,
      },
      environment: {
        present: !!env,
        mapping: env?.mapping ?? -1,
        renderTargetTexture: (env as THREE.Texture | null)?.isRenderTargetTexture === true,
        halfFloat: (env as THREE.Texture | null)?.type === THREE.HalfFloatType,
        pmremMarked: (env as THREE.Texture | null)?.userData?.pmrem === true,
      },
      post: {
        present: !!this.composer,
        passes: this.postList.map((p) => p.name),
        bloom: bloom ? { threshold: bloom.threshold, strength: bloom.strength, radius: bloom.radius } : null,
      },
      pixelRatio: this.renderer.getPixelRatio(),
      renderScale: this.renderScale,
      fog: this.scene.fog instanceof THREE.Fog ? { near: this.scene.fog.near, far: this.scene.fog.far } : null,
      triangles: {
        mainPass: Math.round(main),
        shadowPass: Math.round(shadow),
        perFrame: this.renderer.info.render.triangles,
      },
      calls: { perFrame: this.renderer.info.render.calls },
      shelfKinds: { ...SHELF_KINDS },
      shelfKindsDistinct: new Set(Object.values(SHELF_KINDS)).size,
      builtShelfKind,
      builtShelfGeometry,
      shelves: { rows: shelfRows, tiers: shelfTiers, dividers: shelfDividers, bookcases: shelfRows },
      spines: {
        meshes: spineMeshes,
        atlasPages: this.atlas?.pages ?? 0,
        cells: this.atlas?.cells.length ?? 0,
        chapters: this.plan?.chapterCount ?? 0,
        books: this.plan?.bookCount ?? 0,
        triangles: spineTris,
        indexed: this.spineMeshes.length > 0 && this.spineMeshes[0].geometry.index !== null,
        mapped:
          this.spinePages.length > 0 &&
          this.spinePages.every(
            (p) =>
              p.triRole.length === p.triangles &&
              p.triSlot.length === p.triangles &&
              p.triChapter.length === p.triangles &&
              p.triSpine.length === p.triangles,
          ),
        mapLengths: this.spinePages.map((p) => p.triSpine.length),
      },
      room: this.structure(),
      hall: {
        sides: hallSides,
        doors: hallDoors,
        murals: hallMurals,
        ceilingBeams: hallBeams,
        radius: HALL_RADIUS,
        height: HALL_HEIGHT,
        ground,
        facades,
      },
      labels: {
        sprites,
        domFloating,
        tooltip: !!this.tip,
        plaqueTextures,
        nameplateTextures,
        spineTitles: this.plan?.bookCount ?? 0,
      },
      dotBillboard: this.dust?.userData.billboard === true,
      dotCount: this.dotRefs.length,
      dotTexture: typeof this.dust?.userData.dotTexture === 'string' ? this.dust.userData.dotTexture : 'none',
    };
  }

  sampleLuminance(x = 0, y = 0, w = 1, h = 1, grid = 96): {
    mean: number;
    p5: number;
    p50: number;
    p95: number;
    darkRatio: number;
    brightRatio: number;
    samples: number;
  } {
    this.renderOnce();
    const gl = this.renderer.getContext();
    const rw = gl.drawingBufferWidth;
    const rh = gl.drawingBufferHeight;
    const px = Math.max(0, Math.min(rw - 1, Math.round(x * rw)));
    const py = Math.max(0, Math.min(rh - 1, Math.round(y * rh)));
    const pw = Math.max(1, Math.min(rw - px, Math.round(w * rw)));
    const ph = Math.max(1, Math.min(rh - py, Math.round(h * rh)));
    const buf = new Uint8Array(pw * ph * 4);
    gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const stepX = Math.max(1, Math.floor(pw / grid));
    const stepY = Math.max(1, Math.floor(ph / grid));
    const lum: number[] = [];
    for (let yy = 0; yy < ph; yy += stepY) {
      for (let xx = 0; xx < pw; xx += stepX) {
        const i = (yy * pw + xx) * 4;
        lum.push((0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255);
      }
    }
    lum.sort((a, b) => a - b);
    const mean = lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length);
    const at = (q: number): number => lum[Math.max(0, Math.min(lum.length - 1, Math.floor(lum.length * q) - 1))] ?? 0;
    return {
      mean: Number(mean.toFixed(5)),
      p5: Number(at(0.05).toFixed(5)),
      p50: Number(at(0.5).toFixed(5)),
      p95: Number(at(0.95).toFixed(5)),
      // 批 10 B 判据「不整体提灰」：亮度 < 0.02 的像素占比（口径 = 本函数的采样网格）
      darkRatio: Number((lum.filter((v) => v < 0.02).length / Math.max(1, lum.length)).toFixed(5)),
      brightRatio: Number((lum.filter((v) => v > 0.75).length / Math.max(1, lum.length)).toFixed(5)),
      samples: lum.length,
    };
  }

  /** 标定入口（仅取证用）：运行时改主光/环境光/曝光与两组点光强度，返回实际生效值 */
  tune(o: {
    key?: number;
    hemi?: number;
    exposure?: number;
    groundAlbedo?: number;
    discAlbedo?: number;
    zonePoint?: number;
    roomPoint?: number;
    renderScale?: number;
    env?: number;
  }): Record<string, number> {
    const out: Record<string, number> = {};
    if (o.renderScale !== undefined) {
      // 0 表示回到 1：把帧缓冲缩小到 CSS 尺寸的百分比，片元量按平方下降
      const s = o.renderScale > 0 ? o.renderScale : 1;
      this.renderScale = s;
      this.resize();
      out.renderScale = s;
    }
    if (o.env !== undefined) {
      this.scene.environmentIntensity = o.env;
      this.wake();
      out.env = o.env;
    }
    if (o.key !== undefined && this.keyLight) out.key = this.keyLight.intensity = o.key;
    if (o.hemi !== undefined && this.hemiLight) out.hemi = this.hemiLight.intensity = o.hemi;
    if (o.exposure !== undefined) {
      this.renderer.toneMappingExposure = o.exposure;
      out.exposure = o.exposure;
    }
    if (o.groundAlbedo !== undefined && this.groundMesh) {
      (this.groundMesh.material as THREE.MeshStandardMaterial).color.setScalar(o.groundAlbedo);
      out.groundAlbedo = o.groundAlbedo;
    }
    if (o.discAlbedo !== undefined && this.roomFloor) {
      (this.roomFloor.material as THREE.MeshStandardMaterial).color.setScalar(o.discAlbedo);
      out.discAlbedo = o.discAlbedo;
    }
    if (o.zonePoint !== undefined && this.zoneLights.length) {
      for (const l of this.zoneLights) l.intensity = o.zonePoint;
      out.zonePoint = o.zonePoint;
    }
    if (o.roomPoint !== undefined && this.roomLights.length) {
      this.roomLights[0].intensity = o.roomPoint;
      this.roomLights[1].intensity = o.roomPoint * 0.35;
      out.roomPoint = o.roomPoint;
    }
    this.wake();
    return out;
  }

  setBloom(next: { threshold?: number; strength?: number; radius?: number }): boolean {
    const bloom = this.bloomPass;
    if (!bloom) return false;
    if (next.threshold !== undefined) bloom.threshold = next.threshold;
    if (next.strength !== undefined) bloom.strength = next.strength;
    if (next.radius !== undefined) bloom.radius = next.radius;
    this.wake();
    return true;
  }

  setPassEnabled(name: string, on: boolean): boolean {
    const hit = this.postList.find((p) => p.name.includes(name));
    if (!hit) return false;
    hit.pass.enabled = on;
    this.wake();
    return true;
  }

  setShadowsEnabled(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
    this.wake();
  }

  private renderOnce(): void {
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** 六条走廊地面学科名，注册即证明已建出实体 */
  corridorLabels(): string[] {
    return [...this.corridorNames];
  }

  /**
   * 自检用：漫游调参现值。门槛里的「一秒净位移」判据直接对这里取值，
   * 以后调步速不再需要改探针里的写死数字。
   */
  walkTuning(): { speed: number; sprint: number; eye: number } {
    return { speed: WALK.speed, sprint: WALK.sprint, eye: WALK.eye };
  }

  /** 自检用：当前相机世界位置与所在视图，用来验「大厅 ↔ 走廊 ↔ 房间」的行走通断 */
  walkPose(): { x: number; z: number; yawDeg: number; view: string; room: Discipline | null } {
    return {
      x: Number(this.camera.position.x.toFixed(2)),
      z: Number(this.camera.position.z.toFixed(2)),
      yawDeg: Number((((this.camera.rotation.y * 180) / Math.PI) % 360).toFixed(1)),
      view: this.view,
      room: this.view === 'room' ? this.plan?.discipline ?? null : null,
    };
  }

  /**
   * 自检用：本区侧门（通往环序下一区）的世界位置。
   * 门牌点 + 从落位点指向门牌的方向，探针据此 walkSnap 到门牌前触发切区。
   */
  neighborProbe(): {
    to: Discipline;
    wall: 'left' | 'right';
    plate: [number, number];
    dir: [number, number];
    trigger: number;
  } | null {
    const nb = this.neighbor;
    if (!nb) return null;
    const dx = nb.plateWorld.x - nb.landingWorld.x;
    const dz = nb.plateWorld.z - nb.landingWorld.z;
    const len = Math.hypot(dx, dz) || 1;
    return {
      to: nb.to,
      wall: nb.wall,
      plate: [Number(nb.plateWorld.x.toFixed(2)), Number(nb.plateWorld.z.toFixed(2))],
      dir: [Number((dx / len).toFixed(3)), Number((dz / len).toFixed(3))],
      trigger: NEIGHBOR.trigger,
    };
  }

  /** 走廊名沿走廊走向铺地；自检逐条把相机转到正对视角取证 */
  viewCorridor(key: Discipline): boolean {
    const spec = ROOM_BY_KEY[key];
    const mesh = this.nameplates.get(key);
    if (!spec || !mesh) return false;
    this.view = 'hall';
    this.hall.visible = true;
    this.room.visible = false;
    for (const g of this.links.values()) g.visible = true;
    const dir = new THREE.Vector3(Math.cos(spec.angle), 0, Math.sin(spec.angle));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    // 铭牌长边沿走廊走向，正对读必须从走廊侧面看（顶面法线朝下、侧墙法线朝中线，
    // 壳体是 FrontSide，所以侧向机位不会被墙和顶挡住）。取哪一侧由文字基线朝向决定：
    // plate.rotation.y 里的 flip 让左半区文字沿 -dir 排，对应观察者要在 -perp 侧才是正字。
    const flip = dir.x < 0 ? -1 : 1;
    const dist = 30;
    this.camera.position.set(
      mesh.position.x + perp.x * dist * flip,
      14,
      mesh.position.z + perp.z * dist * flip,
    );
    this.controls.target.set(mesh.position.x, 0.12, mesh.position.z);
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 1000;
    this.resetInertia();
    this.updateControls();
    this.wake();
    return true;
  }

  /** 地面文字投影到屏幕后的包围盒：宽高比 ≥3 才是「横排可读」 */
  corridorScreenBox(key: Discipline): { w: number; h: number } | null {
    this.syncWorld();
    const mesh = this.nameplates.get(key);
    if (!mesh) return null;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    const rect = this.renderer.domElement.getBoundingClientRect();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld).project(this.camera);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    return { w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
  }

  /** 小地图数据：大厅俯视画八角 + 六走廊 + 六栋楼，房间俯视画书架与书位 */
  minimapState(): MinimapState {
    const grouped = new Map<Discipline, number>();
    for (const s of this.manifest.sites) grouped.set(s.discipline, (grouped.get(s.discipline) ?? 0) + 1);
    const hallBits = {
      hall: { sides: 8, radius: HALL_RADIUS, doors: ROOMS.map((r) => r.angle) },
      corridors: ROOMS.map((r) => ({
        key: r.key,
        from: HALL_RADIUS,
        to: ROOM_DIST - FACADE_SIDE / 2,
        width: CORRIDOR_W,
        angle: r.angle,
      })),
    };
    if (this.view === 'hall') {
      return {
        view: 'hall',
        room: null,
        camera: { x: this.camera.position.x, z: this.camera.position.z },
        look: { x: this.controls.target.x, z: this.controls.target.z },
        zones: ROOMS.map((r) => ({
          key: r.key,
          short: r.short,
          color: r.color,
          x: r.at[0],
          z: r.at[1],
          count: grouped.get(r.key) ?? 0,
          here: false,
        })),
        books: [],
        ...hallBits,
      };
    }
    const spec = this.roomKey ? ROOM_BY_KEY[this.roomKey] : null;
    const side = this.plan?.side ?? FACADE_SIDE;
    return {
      view: 'room',
      room: this.roomKey,
      camera: { x: this.camera.position.x, z: this.camera.position.z },
      look: { x: this.controls.target.x, z: this.controls.target.z },
      zones: ROOMS.map((r) => ({
        key: r.key,
        short: r.short,
        color: r.color,
        x: r.at[0],
        z: r.at[1],
        count: grouped.get(r.key) ?? 0,
        here: r.key === this.roomKey,
      })),
      books: (this.plan?.slots ?? []).map((s) => {
        const p = this.localToWorld([s.cx, 0, s.cz]);
        return { x: p.x, z: p.z, level: s.book.contentLevel };
      }),
      shell: spec
        ? { x: this.room.position.x, z: this.room.position.z, side, angle: this.room.rotation.y }
        : undefined,
      ...hallBits,
    };
  }

  // ---------------------------------------------------------------- 渲染循环与帧率

  private wake = (): void => {
    this.lastActive = performance.now();
    this.start();
  };

  private start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.prevTs = performance.now();
    const loop = () => {
      if (!this.running || this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = (now - this.prevTs) / 1000;
      this.prevTs = now;
      if (this.camMode === 'walk') {
        // OrbitControls 的 update() 会无条件 lookAt(target) 并按 minDistance 重摆相机，
        // 与第一人称的 yaw/pitch 打架——漫游期间整段绕开它，朝向由 walkStep 直接写。
        this.walkStep(dt);
        this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
        this.syncWalkTarget();
        this.neighborTick(now);
        this.doorTick(now);
        this.lastActive = now;
        this.applyLod();
        this.updateBillboards();
        this.tickSky(dt);
        this.renderOnce();
        this.aimUpdate();
      } else {
        this.panKeys(dt);
        this.tickSky(dt);
        this.updateControls();
        this.applyLod();
        this.updateBillboards();
        this.renderOnce();
      }
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
      if (performance.now() - this.lastActive > IDLE_MS) {
        this.stop();
        this.hooks.onHud('已静止，暂停渲染循环（交互即恢复）');
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private applyLod(): void {
    if (this.view !== 'room') return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    // 光尘只在贴近书架时才点亮（远看是一层雾，白白吃 fillrate）；书脊是内容，不靠 LOD 藏
    if (this.dust) this.dust.visible = dist <= 52;
    for (const mesh of this.spineMeshes) mesh.visible = dist <= 240;
  }

  fps(): number {
    const win = this.frameTimes.slice(-90);
    if (!win.length) return 0;
    const avg = win.reduce((a, b) => a + b, 0) / win.length;
    return avg > 0 ? 1 / avg : 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private onResize = (): void => this.resize();

  resize(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const next = qualityTier();
    if (next.name !== this.tier.name) this.applyTier(next);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.dprCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    // fov 与距离是一对：只改 fov 不改距离，竖屏会「装得下但仍是同一面墙」；
    // 只改距离不改 fov，则推远后被窄水平角再次裁掉。两者都按同一个 aspect 解。
    this.setFov(this.view === 'hall'
      ? fovForAspect(HALL_FOV_MIN, HALL_FOV_MAX, this.camera.aspect)
      : fovForAspect(ROOM_FOV_MIN, ROOM_FOV_MAX, this.camera.aspect),
    this.lensForAspect(this.camera.aspect));
    this.ensurePost(w, h);
  }

  /**
   * 批 10 A3 变形镜头：只把投影矩阵的 x 缩放压小（anamorphic squeeze），横向视场放宽 Kx 倍，
   * 垂直视场与机位距离不动。必须同步重算 projectionMatrixInverse——拾取射线与
   * Vector3.project / raycaster.setFromCamera 都吃它，漏掉会出现「书看得见、点不中」。
   */
  private setFov(fov: number, lens = 1): void {
    // 不做「fov 没变就 return」的短路：resize() 里 aspect 刚变过，投影矩阵必须跟着重算，
    // 否则竖屏切来切去相机 fov 是新的、矩阵还是上一个 aspect 的（构图差 10% 量级）。
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.lensKx = lens;
    if (lens !== 1) {
      this.camera.projectionMatrix.elements[0] /= lens;
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    }
  }

  /** 当前视图在给定 aspect 下的镜头挤压系数：与 hallPose / roomEye 用同一个 ramp */
  private lensForAspect(aspect: number): number {
    const max = this.view === 'hall' ? HALL_PORTRAIT.lensMax : ROOM_LENS_MAX;
    return 1 + max * aspectRamp(aspect);
  }

  /** 画质档只在构造与跨 768px 时切换；散落在各 build 函数的档位常量都走这里 */
  private applyTier(next: QualityTier): void {
    this.tier = next;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, next.dprCap));
    const shadows = next.shadowMapSize !== null;
    this.renderer.shadowMap.enabled = shadows;
    if (this.keyLight) {
      this.keyLight.castShadow = shadows;
      if (next.shadowMapSize) this.keyLight.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
    }
    this.applyDustBudget();
    this.ensurePost(this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight);
    this.wake();
  }

  private buildTip(): void {
    const tip = document.createElement('div');
    tip.className = 'hover-tip';
    tip.hidden = true;
    tip.setAttribute('data-hover-tip', '1');
    tip.style.position = 'absolute';
    tip.style.pointerEvents = 'none';
    tip.style.zIndex = '6';
    this.root.appendChild(tip);
    this.tip = tip;
  }

  private ensurePost(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    // 帧缓冲按 renderScale 缩，输出仍铺满画布（GPU 放大）。批 8 的室内机位把墙面、
    // 地板与书架整片送进片元着色，瓶颈是像素量而不是三角形（tris 6.2k / calls 29）。
    const sw = Math.round(w * this.renderScale);
    const sh = Math.round(h * this.renderScale);
    if (!this.tier.bloom) {
      // 窄屏档：composer 的 RenderPass + OutputPass 本身就是两趟全屏，bloom 关掉时
      // 留着它们只剩开销，直接走 renderer.render（ACES 由 renderer 承担）。
      this.destroyPost();
      return;
    }
    if (this.composerHandle) {
      this.composerHandle.setPixelRatio(pr);
      this.composerHandle.setSize(sw, sh);
      this.bloomHandle?.setSize(
        Math.round(sw * pr * this.tier.bloomScale),
        Math.round(sh * pr * this.tier.bloomScale),
      );
      return;
    }
    const chain = buildPostChain(this.renderer, this.scene, this.camera, w, h);
    this.composerHandle = chain.composer;
    this.composer = chain.composer;
    this.bloomPass = chain.bloom;
    this.bloomHandle = chain.bloom;
    this.composerHandle.setPixelRatio(pr);
    this.composerHandle.setSize(sw, sh);
    chain.bloom.setSize(
      Math.round(sw * pr * this.tier.bloomScale),
      Math.round(sh * pr * this.tier.bloomScale),
    );
    this.postList = [
      { name: 'RenderPass', pass: chain.render },
      { name: 'UnrealBloomPass', pass: chain.bloom },
      { name: 'OutputPass', pass: chain.output },
    ];
  }

  private destroyPost(): void {
    if (!this.composerHandle) return;
    this.composerHandle.dispose();
    this.composerHandle = null;
    this.composer = null;
    this.bloomHandle = null;
    this.bloomPass = null;
    this.postList = [];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.cancelNeighbor();
    this.neighborFade?.remove();
    this.neighborFade = null;
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.wake);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.hideTip();
    this.tip?.remove();
    this.tip = null;
    this.crosshair?.remove();
    this.crosshair = null;
    this.stick?.remove();
    this.stick = null;
    this.stickKnob = null;
    this.colliders = [];
    this.roomColliders = [];
    this.hallColliders = [];
    // 漫游专用材质不在场景图里（退出即摘），遍历 dispose 抓不到，显式收
    this.walkFloorMat?.dispose();
    this.walkGroundMat?.dispose();
    this.walkFloorMat = null;
    this.walkGroundMat = null;
    for (const t of this.walkTextures.splice(0)) t.dispose();
    for (const m of this.walkMats.splice(0)) m.dispose();
    this.walkMatPairs = [];
    this.corridorMeshes.clear();
    this.doorPlaques.clear();
    this.nameplates.clear();
    this.corridorNames = [];
    this.clearRoom();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) mesh.geometry?.dispose?.();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) m.dispose?.();
    });
    for (const g of this.links.values()) g.clear();
    this.links.clear();
    this.composerHandle?.dispose();
    this.composerHandle = null;
    this.bloomHandle = null;
    this.composer = null;
    this.postList = [];
    this.bloomPass = null;
    if (this.envBundle) {
      this.scene.environment = null;
      this.envBundle.texture.dispose();
      this.envBundle.target.dispose();
      this.envBundle.source.dispose();
      this.envBundle = null;
    }
    this.glowTex?.dispose();
    this.glowTex = null;
    for (const tex of sharedTextures()) tex.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

/**
 * 只走「真正会提交给 GPU」的对象：Group.visible=false 时整棵子树都不渲染，
 * 原生 traverse 会连隐藏子树一起数，大厅/房间互斥可见时 census 就会虚报一倍。
 */
function walkVisible(obj: THREE.Object3D, fn: (o: THREE.Object3D) => void): void {
  if (!obj.visible) return;
  fn(obj);
  for (const child of obj.children) walkVisible(child, fn);
}

function trianglesOf(obj: THREE.Object3D): number {
  const sprite = obj as THREE.Sprite;
  if (sprite.isSprite) return 2;
  const mesh = obj as THREE.Mesh;
  if (!mesh.isMesh) return 0;
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo?.getAttribute('position');
  if (!pos) return 0;
  const verts = geo.index ? geo.index.count : pos.count;
  const tris = verts / 3;
  return obj instanceof THREE.InstancedMesh ? tris * obj.count : tris;
}

function shadowTypeName(type: number): string {
  if (type === THREE.PCFSoftShadowMap) return 'PCFSoftShadowMap';
  if (type === THREE.PCFShadowMap) return 'PCFShadowMap';
  if (type === THREE.VSMShadowMap) return 'VSMShadowMap';
  return 'BasicShadowMap';
}

function toneName(mode: number): string {
  if (mode === THREE.ACESFilmicToneMapping) return 'ACESFilmic';
  if (mode === THREE.AgXToneMapping) return 'AgX';
  if (mode === THREE.NeutralToneMapping) return 'Neutral';
  if (mode === THREE.LinearToneMapping) return 'Linear';
  return 'None';
}
