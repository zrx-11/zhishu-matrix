import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { BookRecord, Discipline, ManifestIndex, SiteEntry } from './types';
import {
  ATLAS_SIZE,
  BG,
  CORRIDOR_W,
  HALL_FOV_MAX,
  HALL_FOV_MIN,
  HALL_HEIGHT,
  HALL_RADIUS,
  PLAQUE_KINDS,
  ROOMS,
  ROOM_BY_KEY,
  ROOM_DIST,
  ROOM_FOV_MAX,
  ROOM_FOV_MIN,
  ROOM_HEIGHT,
  SHELF_HEIGHT,
  SHELF_KINDS,
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
  sharedTextures,
  wallTexture,
  woodTexture,
  type EnvironmentBundle,
} from './spacekit';
import {
  buildSpineAtlas,
  hallPlanTexture,
  leatherColor,
  muralTexture,
  nameplateTexture,
  plaqueTexture,
  SPINE_INK,
  type SpineAtlas,
  spineInkContrast,
} from './atlas';
import { planRoom, type RoomPlan } from './layout';
import {
  ROOM_DOOR,
  SPINE_FACE,
  TILE,
  GeoBuilder,
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
/** 大厅里六个「阅览室体量」的外壳按名义边长建，进区后才按该区书量重算真实边长 */
const FACADE_SIDE = 26;
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

export interface ThreeHooks {
  onPickRoom(discipline: Discipline): void;
  onPickBook(discipline: Discipline, book: SiteEntry): void;
  onPickChapter(discipline: Discipline, book: SiteEntry, chapterId: string): void;
  onPickConcept(discipline: Discipline, book: SiteEntry, conceptId: string): void;
  onHud(text: string): void;
  onCamera(pose: CameraPose): void;
  /** 阅读层打开或输入框聚焦时让出键盘，WASD 不抢字 */
  inputBusy(): boolean;
}

type Pick = {
  kind: 'room' | 'book' | 'chapter' | 'concept';
  discipline: Discipline;
  book?: SiteEntry;
  id?: string;
  hint: string;
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
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
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
        roughness: 0.95,
        metalness: 0.04,
        envMapIntensity: 0.25,
      }),
    );
    ground.receiveShadow = true;
    ground.userData.role = 'ground';
    this.groundMesh = ground;
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
        emissiveIntensity: 0.9,
      }),
    );
    floor.receiveShadow = true;
    floor.userData.role = 'hallFloor';
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
    });
    this.hall.add(this.mark(new THREE.Mesh(built.walls, shellMat), 'hallWall', { receiveShadow: true }));
    const mural = new THREE.Mesh(
      built.muralPanels,
      new THREE.MeshStandardMaterial({
        map: muralTexture('#4a6cf7', 7),
        roughness: 0.9,
        metalness: 0.04,
        envMapIntensity: 0.25,
      }),
    );
    mural.userData.role = 'mural';
    this.hall.add(mural);
    this.hall.add(this.mark(new THREE.Mesh(built.ceiling, shellMat), 'hallCeiling', {}));
    this.hall.add(this.mark(new THREE.Mesh(built.frames, this.brass()), 'hallDoorFrame', { castShadow: true }));

    const beams = new THREE.InstancedMesh(unitBox(), this.wood('#2c2015', 11), built.beams.length);
    built.beams.forEach((m, i) => beams.setMatrixAt(i, m));
    beams.instanceMatrix.needsUpdate = true;
    beams.userData.role = 'hallBeams';
    beams.userData.count = built.beams.length;
    this.hall.add(beams);

    this.buildChandelier();
    this.buildFacades(wallMat);
    this.hall.userData.stats = built.stats;
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
      b.slab(box([0, ROOM_HEIGHT / 2, 0]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        half, ROOM_HEIGHT / 2, half, TILE.wall);
      b.slab(box([0, ROOM_HEIGHT + 0.55, 0]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        half + 0.8, 0.55, half + 0.8, TILE.trim);
      // 门廊：朝大厅那一面（local −Z）凸出一小块
      b.slab(box([0, 4.4, -half - 1.2]), u.toArray() as Vec3, v.toArray() as Vec3, w.toArray() as Vec3,
        ROOM_DOOR.w / 2 + 1.1, 4.4, 1.2, TILE.trim);
      // faceIndex → 区：三块 slab 共 36 个三角面，逐面对齐，点击任意一面都能认到区
      while (facadeZones.length < b.faces) facadeZones.push(idx);
      if (b.faces - before !== 36) throw new Error(`体量外壳面数异常：${b.faces - before}`);
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
    const floorMat = this.wood('#3a2a1a', 5);
    // 走廊壳体三面法线全部朝内（侧墙指向中线、顶面指向下），必须是 FrontSide：
    // 写成 DoubleSide 时顶面从上方照样可见，大厅俯视看到的是六条封闭暗管盖，而不是管里的地面和铭牌。
    const shellMat = new THREE.MeshStandardMaterial({
      map: wallTexture('#33291f', '#4a3c2c', '#241c14'),
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.3,
    });
    for (const r of ROOMS) {
      const group = new THREE.Group();
      const built = buildCorridor(r.angle, HALL_RADIUS - 0.4, ROOM_DIST, FACADE_SIDE);
      const floor = new THREE.Mesh(built.floor, floorMat);
      floor.receiveShadow = true;
      floor.userData.role = 'corridorFloor';
      const shell = new THREE.Mesh(built.shell, shellMat);
      shell.userData.role = 'corridorShell';
      shell.receiveShadow = true;
      group.add(floor, shell);

      // 地面铭牌：文字沿走廊走向铺，正对视角即横排可读
      const tex = nameplateTexture(r.title, r.key.toUpperCase(), r.color);
      const img = tex.image as HTMLCanvasElement | null;
      const aspect = img && img.width ? img.height / img.width : 0.22;
      const bandW = Math.min(built.length * 0.6, 44);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(bandW, bandW * aspect),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.94, side: THREE.DoubleSide, depthWrite: false }),
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
    return out;
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

  /** 俯视机位沿批 8 的 41.4° 俯角线推远，直到六个阅览体量横向都进画；桌面档仍落回 (0,232,264) */
  private hallPose(): [number, number, number] {
    const fov = fovForAspect(HALL_FOV_MIN, HALL_FOV_MAX, this.camera.aspect);
    const need = HALL_SPAN / Math.max(0.05, Math.tan(this.halfFovRad(fov)));
    const dist = Math.min(this.controls.maxDistance - 20, Math.max(HALL_TILT_LEN, need));
    const k = dist / HALL_TILT_LEN;
    return [0, HALL_TILT[0] * k, HALL_TILT[1] * k];
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

  showHall(pose?: CameraPose | null): void {
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
    this.setFov(fovForAspect(HALL_FOV_MIN, HALL_FOV_MAX, this.camera.aspect));
    if (pose) this.applyPose(pose);
    else {
      const def = this.hallPose();
      this.camera.position.set(def[0], def[1], def[2]);
      this.controls.target.set(0, 0, 0);
    }
    this.resetInertia();
    this.controls.update();
    this.focusShadow();
    this.hideTip();
    this.wake();
    this.hooks.onHud(
      `八角厅 · ${this.manifest.totals.sites} 本书 / ${this.manifest.totals.repos} 个仓库 · 六门通六区`,
    );
  }

  enterRoom(
    discipline: Discipline,
    books: SiteEntry[],
    records: Map<string, BookRecord>,
    pose?: CameraPose | null,
  ): void {
    const spec = ROOM_BY_KEY[discipline];
    this.clearRoom();
    this.roomKey = discipline;
    this.conceptShown = null;
    const plan = planRoom(discipline, books, records, (seed) => leatherColor(spec.color, seed));
    this.plan = plan;
    // 正门恒落在走廊尽头：书多则房间向外扩，不会顶穿走廊，也与大厅体量外壳的门同位
    const centerR = ROOM_DIST - FACADE_SIDE / 2 + plan.side / 2;
    this.room.position.set(Math.cos(spec.angle) * centerR, 0, Math.sin(spec.angle) * centerR);
    this.room.rotation.y = Math.PI / 2 - spec.angle;

    const shell = buildRoomShell(plan);
    this.roomGeoms.push(shell.floor, shell.walls, shell.ceiling, shell.trim, shell.doorFrame);
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
    this.addRoomObject(this.mark(new THREE.Mesh(shell.trim, trimMat), 'baseboard', { castShadow: true }));
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
      this.enterRoomCamera(plan, pose);
      this.hooks.onHud(`${spec.title} · 0 本 · 6 个仓库无 manifest，待批 5 生成层补源（不伪造书位）`);
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
    this.enterRoomCamera(plan, pose);
    this.hooks.onHud(
      `${spec.title} · ${plan.bookCount} 册上架 · ${plan.chapterCount} 条书脊 · 点书脊读章、点顶部铜牌看书`,
    );
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

  private enterRoomCamera(plan: RoomPlan, pose?: CameraPose | null): void {
    this.hall.visible = false;
    this.room.visible = true;
    for (const [key, group] of this.links) group.visible = key === this.roomKey;
    this.view = 'room';
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 320;
    this.setFog(ROOM_FOG);
    this.setRenderScale(this.tier.renderScale);
    this.setFov(fovForAspect(ROOM_FOV_MIN, ROOM_FOV_MAX, this.camera.aspect));
    const side = plan.side;
    const spec = ROOM_BY_KEY[plan.discipline];
    const cx = this.room.position.x;
    const cz = this.room.position.z;
    if (pose) this.applyPose(pose);
    else {
      // 机位必须沿**本区自己的轴**摆：房间绕 Y 转了 π/2 − angle，本地 −Z 才是门墙那侧。
      // 早先用世界 +Z 偏移，六个区里只有 angle=90° 的那区碰巧对，其余区等于把相机
      // 塞进后墙书架里，截出来是一整幅横板（见 pitfalls 55）。
      // 站进门口、齐视线高度：墙与天花只朝内，从门内看过去就是封闭室内而不是娃娃屋外壳。
      const toDoor = new THREE.Vector3(-Math.cos(spec.angle), 0, -Math.sin(spec.angle));
      const eye = this.roomEye(side, plan.height);
      this.camera.position.set(cx, 0, cz).addScaledVector(toDoor, eye.dist);
      this.camera.position.y = eye.eyeY;
      this.controls.target.set(cx, eye.lookY, cz);
    }
    this.resetInertia();
    this.controls.update();
    this.focusShadow();
    this.hideTip();
    this.wake();
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
    const c = this.camera.position;
    const t = this.controls.target;
    return { px: c.x, py: c.y, pz: c.z, tx: t.x, ty: t.y, tz: t.z };
  }

  // ---------------------------------------------------------------- 交互

  private onPointerDown = (ev: PointerEvent): void => {
    this.downAt = { x: ev.clientX, y: ev.clientY };
    this.downKind = ev.pointerType || 'mouse';
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
    this.wake();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    this.wake();
    if (ev.buttons !== 0) {
      this.hideTip();
      return;
    }
    const hit = this.pick(ev);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    this.hooks.onHud(hit ? hit.hint : this.hudDefault());
    this.scheduleTip(ev, hit);
  };

  private onPointerLeave = (): void => this.hideTip();

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
      const spec = ROOM_BY_KEY[hit.discipline];
      return `${spec.title} · ${this.manifest.sites.filter((s) => s.discipline === spec.key).length} 册 · 点击进入阅览室`;
    }
    const title = hit.book ? hit.book.title || hit.book.bookSlug : '';
    if (hit.kind === 'concept') return `概念 ${hit.id} · 点击读正文`;
    if (hit.kind === 'chapter') return `${title} · 第 ${hit.id} 章 · 点击读正文`;
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
    if (!MOVE_KEYS.has(code)) return;
    if (this.hooks.inputBusy()) return;
    this.keys.add(code);
    const now = performance.now();
    if (now - this.lastKeyHint > 1500) {
      this.lastKeyHint = now;
      this.hooks.onHud('WASD 平移中 · 只改位置不改朝向');
    }
    this.wake();
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
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

  private pick(ev: PointerEvent): Pick | null {
    this.ray.setFromCamera(this.ndc(ev), this.camera);
    if (this.view === 'hall') return this.pickHall();
    return this.pickRoom();
  }

  /** 大厅：点六栋阅览楼的外壳（faceIndex → 区）或门楣牌匾 */
  private pickHall(): Pick | null {
    const targets: THREE.Object3D[] = [...this.doorPlaques.values()];
    if (this.facades) targets.push(this.facades);
    for (const hit of this.ray.intersectObjects(targets, false)) {
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
      const spine = this.spineAt(page, hit.faceIndex);
      if (!spine) continue;
      const slot = this.plan?.slots[spine.slot];
      if (!slot) continue;
      const role = page.triRole[Math.floor(hit.faceIndex ?? 0)] ?? SPINE_FACE.cover;
      if (role === SPINE_FACE.chapter) {
        return {
          kind: 'chapter',
          discipline: slot.book.discipline,
          book: slot.book,
          id: spine.chapter.id,
          hint: `${slot.book.title || slot.book.bookSlug} · ${spine.chapter.title || spine.chapter.id} · 点击读正文`,
        };
      }
      return {
        kind: 'book',
        discipline: slot.book.discipline,
        book: slot.book,
        hint: `${slot.book.title || slot.book.bookSlug} · ${slot.chapters.length} 章 · 铜牌＝该书总览`,
      };
    }
    return null;
  }

  /** faceIndex → 书脊：构建期落好的映射表，点击时只做一次下标取值 */
  private spineAt(page: SpinePage, faceIndex: number | null | undefined) {
    if (faceIndex === undefined || faceIndex === null || !this.plan) return null;
    const idx = page.triSpine[Math.floor(faceIndex)];
    if (idx === undefined) return null;
    return this.plan.spines[idx] ?? null;
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
    const hit = this.pick(ev);
    if (!hit) {
      this.lastTapInfo.action = 'tap-miss';
      return;
    }
    if (hit.kind === 'room') this.hooks.onPickRoom(hit.discipline);
    else if (hit.kind === 'book' && hit.book) this.hooks.onPickBook(hit.discipline, hit.book);
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
    this.controls.update();
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

  sampleLuminance(x = 0, y = 0, w = 1, h = 1, grid = 96): { mean: number; p95: number; brightRatio: number; samples: number } {
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
    return {
      mean: Number(mean.toFixed(5)),
      p95: Number((lum[Math.max(0, Math.floor(lum.length * 0.95) - 1)] ?? 0).toFixed(5)),
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
    this.controls.update();
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
      this.panKeys(dt);
      this.controls.update();
      this.applyLod();
      this.updateBillboards();
      this.renderOnce();
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
      : fovForAspect(ROOM_FOV_MIN, ROOM_FOV_MAX, this.camera.aspect));
    this.ensurePost(w, h);
  }

  private setFov(fov: number): void {
    // 不做「fov 没变就 return」的短路：resize() 里 aspect 刚变过，投影矩阵必须跟着重算，
    // 否则竖屏切来切去相机 fov 是新的、矩阵还是上一个 aspect 的（构图差 10% 量级）。
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
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
