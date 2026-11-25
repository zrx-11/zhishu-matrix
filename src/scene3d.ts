import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Discipline, ManifestIndex, SiteEntry } from './types';
import { BG, COLUMN_BASE, COLUMN_KINDS, HALL_LABEL, PODIUM_H, PODIUM_KINDS, PLAT_H, ROOMS, ROOM_BY_KEY } from './config';
import {
  buildEnvironment,
  buildLightRig,
  buildPostChain,
  columnGeometry,
  discTexture,
  glowTexture,
  groundTexture,
  podiumGeometry,
  type EnvironmentBundle,
} from './spacekit';
import { layoutColumns, layoutRoom, type RoomLayout } from './layout';
import type { BookRecord } from './types';
import type { CameraPose } from './state';

const KEY_SPEED = 62; // 世界单位/秒，1440×900 下走一条走廊约 4 秒
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
/** Bloom 内部链的分辨率倍率：0.65 拿回约 11% 帧时间，光晕边缘仍够软 */
const BLOOM_SCALE = 0.65;
/** 立柱截面几何的单位半径 0.6–1.0，展台半径 ~10：不放大到 2.2 倍就是一根针，看不出「柱子」 */
const COLUMN_GIRTH = 2.2;

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

/** 后期链的三条 pass 与 composer 只按用到的方法声明，避免把 addon 的具体类型钉在类字段上 */
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
  zones: Array<{ key: Discipline; short: string; color: string; x: number; z: number; count: number }>;
  books: Array<{ x: number; z: number; level: string }>;
}

/** 渲染层 census：门槛断言与取证脚本只读这份数据，不再从截图反推 */
export interface RenderCensus {
  materials: Record<string, number>;
  litMaterials: number;
  unlitMaterials: number;
  lights: Record<string, number>;
  /** 逐盏灯的参数：断言「每区至少一盏学科色 PointLight 且带距离衰减」要看这个，不看计数 */
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
  fog: { near: number; far: number } | null;
  triangles: { mainPass: number; shadowPass: number; perFrame: number };
  calls: { perFrame: number };
  columnKinds: Record<Discipline, string>;
  columnKindsDistinct: number;
  builtColumnGeometry: string[];
  dotBillboard: boolean;
  dotCount: number;
  dotTexture: string;
}

// 10 秒帧率采样窗口要求持续渲染；静止 12 秒后才停循环，交互即恢复
const IDLE_MS = 12000;

export class Matrix3D {
  readonly kind = '3d' as const;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ray = new THREE.Raycaster();
  private hall = new THREE.Group();
  private room = new THREE.Group();
  private beacons!: THREE.InstancedMesh;
  private platforms: THREE.InstancedMesh | null = null;
  private columns: THREE.InstancedMesh | null = null;
  private dots: THREE.InstancedMesh | null = null;
  private dotRefs: Array<{ book: SiteEntry; conceptId: string }> = [];
  private colRefs: Array<{ book: SiteEntry; chapterId: string }> = [];
  private keyLight: THREE.DirectionalLight | null = null;
  private hemiLight: THREE.HemisphereLight | null = null;
  private zoneLights: THREE.PointLight[] = [];
  private roomLights: THREE.PointLight[] = [];
  private hallFloor: THREE.Mesh | null = null;
  private envBundle: EnvironmentBundle | null = null;
  private groundTex: THREE.CanvasTexture | null = null;
  private discTex: THREE.CanvasTexture | null = null;
  private glowTex: THREE.CanvasTexture | null = null;
  private podiums: THREE.InstancedMesh | null = null;
  private dotSeeds: Array<{ pos: THREE.Vector3; size: number }> = [];
  private dotBase = new THREE.Color('#e8ecf4');
  private billboardMat = new THREE.Matrix4();
  private billboardQuat = new THREE.Quaternion();
  private billboardScale = new THREE.Vector3();
  private composer: ComposerLike | null = null;
  private composerHandle: EffectComposer | null = null;
  private bloomHandle: UnrealBloomPass | null = null;
  private postList: Array<{ name: string; pass: PassLike }> = [];
  private bloomPass: BloomLike | null = null;
  private lines: THREE.LineSegments | null = null;
  private corridorFloors: THREE.Mesh[] = [];
  private corridorMeshes = new Map<Discipline, THREE.Mesh>();
  private corridorNames: string[] = [];
  private emptyMark: THREE.Group | null = null;
  private roomFloor: THREE.Mesh | null = null;
  private hallLabels: THREE.Sprite[] = [];
  private roomLabels: THREE.Sprite[] = [];
  private layout: RoomLayout | null = null;
  private bookOrder: SiteEntry[] = [];
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
  private keys = new Set<string>();
  private lastKeyHint = 0;

  constructor(
    private root: HTMLElement,
    private manifest: ManifestIndex,
    private hooks: ThreeHooks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new THREE.Color(BG), 1);
    // composer 的每条 pass 内部都调 renderer.render()，默认自动重置会让 info 只剩最后一条全屏 quad。
    // 关掉自动重置、每帧开头手动 reset，triangles()/calls 才是「整帧」口径，改前改后同一把尺。
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 场景里只有相机在动，灯与几何每帧不变 → 阴影贴图按「视图切换」重烘一次，
    // 每帧重算白扔 11% 帧时间（实测大厅 53.5 → 63.7 fps）
    this.renderer.shadowMap.autoUpdate = false;
    // 有光照就得压高光：ACES 让光点与信标过曝时收住，不至于整屏发灰
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    root.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(new THREE.Color(BG).getHex(), 520, 1250);

    // 环境反射全部程序化：canvas 等距柱状渐变 → PMREM 预滤波 → scene.environment，
    // 不落地任何 .hdr/.env 文件（铁律 2 零外部资产）
    this.envBundle = buildEnvironment(this.renderer);
    this.scene.environment = this.envBundle.texture;

    const rig = buildLightRig();
    this.hemiLight = rig.hemi;
    this.keyLight = rig.key;
    this.zoneLights = rig.zones;
    this.scene.add(rig.hemi, rig.key, rig.key.target, ...rig.zones);

    this.groundTex = groundTexture();
    this.glowTex = glowTexture();

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.5, 2400);
    this.camera.position.set(0, 330, 380);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.rotateSpeed = 0.85;
    // 触屏：单指旋转，不依赖双指手势（双指留给缩放，可选）
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.scene.add(this.hall, this.room);
    this.buildHall();
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('wheel', this.wake, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.start();
  }

  // ---------------------------------------------------------------- 构场

  private buildHall(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(520, 64),
      new THREE.MeshStandardMaterial({
        map: this.groundTex ?? undefined,
        roughness: 0.86,
        metalness: 0.06,
        envMapIntensity: 0.35,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.4;
    floor.receiveShadow = true;
    floor.userData.role = 'ground';
    this.hallFloor = floor;
    this.hall.add(floor);

    const beaconGeo = new THREE.CylinderGeometry(18, 24, 44, 6);
    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.25,
      envMapIntensity: 0.5,
    });
    this.beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, ROOMS.length);
    this.beacons.castShadow = true;
    this.beacons.receiveShadow = true;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    ROOMS.forEach((r, i) => {
      m.makeTranslation(r.at[0], 22, r.at[1]);
      this.beacons.setMatrixAt(i, m);
      this.beacons.setColorAt(i, color.set(r.color));
      this.hall.add(this.label(this.hallLabels, r.short, r.at[0], 60, r.at[1], r.color, 1.5));
      // 区环保留无光照 MeshBasicMaterial：它是「入口标记」，亮度必须与相机朝向、阴影无关
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(27, 35, 48),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(r.color),
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(r.at[0], 0.4, r.at[1]);
      this.hall.add(disc);
      // 走廊：大厅中心到房间中心的细线
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.2, 0),
        new THREE.Vector3(r.at[0], 0.2, r.at[1]),
      ]);
      this.hall.add(
        new THREE.Line(g, new THREE.LineBasicMaterial({ color: r.color, transparent: true, opacity: 0.22 })),
      );
      this.corridorFloor(r);
    });
    this.beacons.instanceMatrix.needsUpdate = true;
    if (this.beacons.instanceColor) this.beacons.instanceColor.needsUpdate = true;
    this.hall.add(this.beacons);
    this.hall.add(this.label(this.hallLabels, HALL_LABEL, 0, 52, 0, '#e8ecf4', 1.05));
  }

  private label(
    bucket: THREE.Sprite[],
    text: string,
    x: number,
    y: number,
    z: number,
    color: string,
    scale = 1,
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 不可用');
    const font = 44;
    ctx.font = `${font}px "Source Han Sans SC", "Noto Sans SC", sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.width = w;
    canvas.height = font + 24;
    const c2 = canvas.getContext('2d');
    if (!c2) throw new Error('canvas 2d 二次上下文丢失');
    c2.font = `${font}px "Source Han Sans SC", "Noto Sans SC", sans-serif`;
    c2.fillStyle = color;
    c2.textBaseline = 'middle';
    c2.fillText(text, 12, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    const k = 0.14 * scale;
    sprite.scale.set(canvas.width * k, canvas.height * k, 1);
    sprite.position.set(x, y, z);
    bucket.push(sprite);
    return sprite;
  }

  /** 走廊地面学科名：贴地平面，文字基线沿走廊走向（阶段 D 第 3 项） */
  private corridorFloor(r: (typeof ROOMS)[number]): void {
    const dx = r.at[0];
    const dz = r.at[1];
    const len = Math.hypot(dx, dz);
    if (len < 40) return;
    // 阅读方向取「屏幕从左到右」的那一侧：大厅相机在 +Z 侧望向 -Z，屏幕右即 +X
    const ux = dx / len;
    const uz = dz / len;
    const flip = ux < 0 ? -1 : 1;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const font = 96;
    const label = `${r.title} · ${r.key}`;
    ctx.font = `700 ${font}px "Source Han Sans SC", "Noto Sans SC", sans-serif`;
    const w = Math.ceil(ctx.measureText(label).width) + 40;
    canvas.width = w;
    canvas.height = font + 56;
    const c2 = canvas.getContext('2d');
    if (!c2) return;
    c2.font = `700 ${font}px "Source Han Sans SC", "Noto Sans SC", sans-serif`;
    c2.textBaseline = 'middle';
    c2.shadowColor = 'rgba(0, 0, 0, 0.85)';
    c2.shadowBlur = 18;
    c2.fillStyle = r.color;
    c2.fillText(label, 20, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // 地面带宽度固定，文字长度按走廊长度截断比例放大
    const bandW = Math.min(len * 0.62, 150);
    const geo = new THREE.PlaneGeometry(bandW, (bandW * canvas.height) / canvas.width);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.y = Math.atan2(-uz * flip, ux * flip);
    mesh.position.set(dx * 0.72, 0.62, dz * 0.72);
    this.hall.add(mesh);
    this.corridorFloors.push(mesh);
    this.corridorMeshes.set(r.key, mesh);
    this.corridorNames.push(r.title);
  }

  private clearRoom(): void {
    for (const obj of [this.platforms, this.podiums, this.columns, this.dots]) {
      if (!obj) continue;
      this.room.remove(obj);
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose());
      obj.dispose();
    }
    for (const light of this.roomLights.splice(0)) this.room.remove(light);
    if (this.lines) {
      this.room.remove(this.lines);
      this.lines.geometry.dispose();
      (this.lines.material as THREE.Material).dispose();
    }
    if (this.emptyMark) {
      this.room.remove(this.emptyMark);
      this.emptyMark.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.emptyMark = null;
    }
    if (this.roomFloor) {
      this.room.remove(this.roomFloor);
      this.roomFloor.geometry.dispose();
      const mat = this.roomFloor.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      this.discTex = null;
      mat.dispose();
      this.roomFloor = null;
    }
    this.platforms = this.podiums = this.columns = this.dots = null;
    this.dotRefs = [];
    this.dotSeeds = [];
    this.colRefs = [];
    this.lines = null;
    for (const s of this.roomLabels.splice(0)) {
      this.room.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
  }

  // ---------------------------------------------------------------- 视图切换

  showHall(pose?: CameraPose | null): void {
    this.view = 'hall';
    this.roomKey = null;
    this.conceptShown = null;
    this.room.visible = false;
    this.hall.visible = true;
    this.controls.minDistance = 90;
    this.controls.maxDistance = 1000;
    if (pose) this.applyPose(pose);
    else {
      this.camera.position.set(0, 330, 380);
      this.controls.target.set(0, 0, 0);
    }
    this.resetInertia();
    this.controls.update();
    this.focusShadow();
    this.wake();
    this.hooks.onHud(
      `大厅 · ${this.manifest.totals.sites} 本书 / ${this.manifest.totals.repos} 个仓库 · 六区可点`,
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
    const base = layoutRoom(books);
    this.layout = layoutColumns(base, records);
    this.bookOrder = this.layout.books.map((b) => b.book);
    this.addRoomFloor(spec, Math.max(80, (this.layout.span || 0) * 0.85 + 25));

    if (!books.length) {
      this.buildEmptyRoom(spec);
      return;
    }

    const platGeo = new THREE.BoxGeometry(16, PLAT_H, 16);
    const platMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.2,
      envMapIntensity: 0.45,
    });
    const plats = new THREE.InstancedMesh(platGeo, platMat, books.length);
    plats.castShadow = true;
    plats.receiveShadow = true;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const q = new THREE.Quaternion();
    this.layout.books.forEach((b, i) => {
      m.makeTranslation(b.x, PODIUM_H + PLAT_H / 2, b.z);
      plats.setMatrixAt(i, m);
      plats.setColorAt(i, col.set(spec.color).multiplyScalar(b.book.contentLevel === 'full' ? 1 : 0.55));
    });
    plats.instanceMatrix.needsUpdate = true;
    if (plats.instanceColor) plats.instanceColor.needsUpdate = true;
    this.platforms = plats;
    this.room.add(plats);

    // 底座：同学科一种堆叠语言，展台不再直接浮在地板上
    const podiums = new THREE.InstancedMesh(
      podiumGeometry(PODIUM_KINDS[discipline]),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.05,
        envMapIntensity: 0.3,
      }),
      books.length,
    );
    podiums.castShadow = true;
    podiums.receiveShadow = true;
    this.layout.books.forEach((b, i) => {
      m.makeTranslation(b.x, 0, b.z);
      podiums.setMatrixAt(i, m);
      podiums.setColorAt(i, col.set(spec.color).lerp(new THREE.Color('#9aa6bd'), 0.55));
    });
    podiums.instanceMatrix.needsUpdate = true;
    if (podiums.instanceColor) podiums.instanceColor.needsUpdate = true;
    this.podiums = podiums;
    this.room.add(podiums);

    if (this.layout.columns.length) {
      const columns = new THREE.InstancedMesh(
        columnGeometry(COLUMN_KINDS[discipline]),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.62,
          metalness: 0.22,
          envMapIntensity: 0.4,
        }),
        this.layout.columns.length,
      );
      columns.castShadow = true;
      columns.receiveShadow = true;
      columns.userData.role = 'columns';
      columns.userData.shape = COLUMN_KINDS[discipline];
      this.layout.columns.forEach((c, i) => {
        m.compose(
          new THREE.Vector3(c.x, COLUMN_BASE, c.z),
          q,
          new THREE.Vector3(COLUMN_GIRTH, c.height, COLUMN_GIRTH),
        );
        columns.setMatrixAt(i, m);
        columns.setColorAt(i, col.set(spec.color).lerp(new THREE.Color('#e8ecf4'), 0.35));
      });
      columns.instanceMatrix.needsUpdate = true;
      if (columns.instanceColor) columns.instanceColor.needsUpdate = true;
      this.colRefs = this.layout.columns.map((c) => ({
        book: c.book,
        chapterId: c.chapter.id,
      }));
      this.columns = columns;
      this.room.add(columns);
    }

    const dotList = this.layout.columns.flatMap((c) =>
      c.concepts.map((concept) => ({ column: c, concept })),
    );
    if (dotList.length) {
      // 概念光点：一张 canvas 径向渐变 + 面片实例，加法混合发光。
      // 面片朝向每帧按相机四元数重写实例矩阵（CPU 侧），
      // 因为射线拾取读的就是实例矩阵——把朝向塞进顶点着色器会让点得到处跑偏。
      const dots = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this.glowTex ?? undefined,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        dotList.length,
      );
      dots.userData.billboard = true;
      dots.userData.dotTexture = 'canvas:radial-gradient-64';
      this.dotBase = new THREE.Color(spec.color).lerp(new THREE.Color('#f4f7ff'), 0.3);
      let k = 0;
      const pts: THREE.Vector3[] = [];
      this.dotRefs = [];
      this.dotSeeds = [];
      const v = new THREE.Vector3();
      for (const { column: c, concept } of dotList) {
        const top = COLUMN_BASE + c.height + 1.9;
        const a = ((k % 8) / 8) * Math.PI * 2;
        const p = new THREE.Vector3(
          c.x + Math.cos(a) * 4.3,
          top + (k % 3) * 1.15 + (k % 2) * 0.45,
          c.z + Math.sin(a) * 4.3,
        );
        // 半径按该书题量：quizIds 抽不到（1,169 章全空），只有 stats.quizzes 可用
        const quiz = c.book.stats?.quizzes ?? 0;
        const size = 1.5 + 1.15 * Math.sqrt(Math.min(1, quiz / 100));
        this.dotSeeds.push({ pos: p, size });
        m.compose(p, q, v.set(size, size, 1));
        dots.setMatrixAt(k, m);
        this.dotRefs.push({ book: c.book, conceptId: concept.id });
        pts.push(p);
        k += 1;
      }
      dots.instanceMatrix.needsUpdate = true;
      this.dots = dots;
      this.recolorDots();
      this.room.add(dots);
      // 前置链在骨架阶段先用最近邻细线示意，批 3 换成真 prerequisites
      if (pts.length > 1) {
        const seg = new Float32Array(pts.length * 6);
        pts.forEach((p, i) => {
          const q = pts[(i + 1) % pts.length];
          seg.set([p.x, p.y, p.z, q.x, q.y, q.z], i * 6);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(seg, 3));
        this.lines = new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0.22 }),
        );
        this.room.add(this.lines);
      }
    }

    // 每个展台一块书名牌（数量上限保护帧率）
    this.layout.books.slice(0, 64).forEach((b) => {
      this.room.add(
        this.label(
          this.roomLabels,
          shortTitle(b.book.title || b.book.bookSlug),
          b.x,
          8.5,
          b.z + 11,
          '#cfd6e4',
          0.42,
        ),
      );
    });

    const reach = Math.max(80, (this.layout.span || 60) * 1.15);
    this.addRoomLights(spec, this.layout.span || 60);
    this.enterRoomCamera(spec, reach, pose);
    this.hooks.onHud(
      `${spec.title} · ${books.length} 本 · ${this.layout.columns.length} 根章节立柱`,
    );
  }

  /** 区内两盏衰减点光：一盏学科色顶光定调，一盏冷白低位补光，让立柱侧面有明暗而不是纯色块 */
  private addRoomLights(spec: (typeof ROOMS)[number], span: number): void {
    const top = new THREE.PointLight(new THREE.Color(spec.color).getHex(), 700, span * 2.4, 2);
    top.position.set(0, 32, 0);
    // 低位补光架在 18 单位高：贴着地面会把展台照出一坨过曝白斑（第一版 7 单位实测踩到）
    const rim = new THREE.PointLight(0xdfe7f5, 392, span * 2.4, 2);
    rim.position.set(-span * 0.45, 18, span * 0.6);
    this.roomLights = [top, rim];
    this.room.add(top, rim);
  }

  private addRoomFloor(spec: (typeof ROOMS)[number], radius: number): void {
    this.discTex = discTexture(spec.color);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshStandardMaterial({
        map: this.discTex,
        transparent: true,
        opacity: 0.92,
        roughness: 0.8,
        metalness: 0.08,
        envMapIntensity: 0.4,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    disc.receiveShadow = true;
    this.roomFloor = disc;
    this.room.add(disc);
  }

  private buildEmptyRoom(spec: (typeof ROOMS)[number]): void {
    // 工具区 6 个仓库均无 manifest，批 1 无书目；给空房间而不是白屏或 404
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(24, 32, 48),
      new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.32 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    group.add(ring);
    group.add(
      this.label(
        this.roomLabels,
        '批 1 无可解析书目 · 6 个仓库均无 manifest.json',
        0,
        16,
        0,
        '#8b95a8',
        0.85,
      ),
    );
    this.emptyMark = group;
    this.room.add(group);
    this.enterRoomCamera(spec, 110, null);
    this.hooks.onHud(`${spec.title} · 0 本 · 待批 5 生成层补源，不伪造节点`);
  }

  private enterRoomCamera(
    spec: (typeof ROOMS)[number],
    reach: number,
    pose?: CameraPose | null,
  ): void {
    this.room.position.set(spec.at[0], 0, spec.at[1]);
    this.hall.visible = false;
    this.room.visible = true;
    this.view = 'room';
    this.controls.minDistance = 30;
    this.controls.maxDistance = 520;
    if (pose) this.applyPose(pose);
    else {
      this.camera.position.set(spec.at[0], reach * 0.72, spec.at[1] + reach * 0.92);
      this.controls.target.set(spec.at[0], 4, spec.at[1]);
    }
    this.resetInertia();
    this.controls.update();
    this.focusShadow();
    this.wake();
  }

  /**
   * 主光与阴影相机跟着视图走：大厅罩住六区（半径 ~260 + 信标），房间只罩住本区展台。
   * 2048 的贴图摊到 1,040 单位上就糊成一片，所以进房必须收紧范围，而不是把相机架远。
   */
  private focusShadow(): void {
    const key = this.keyLight;
    if (!key) return;
    const spec = this.view === 'room' && this.roomKey ? ROOM_BY_KEY[this.roomKey] : null;
    const cx = spec ? spec.at[0] : 0;
    const cz = spec ? spec.at[1] : 0;
    const half = spec ? Math.max(96, (this.layout?.span ?? 60) * 0.72 + 46) : 380;
    // 俯角 ~38°：影子能拖到展台上被看见；架到 60° 以上影子全压在柱子自己背后（实测亮度差只有 0.1%）
    key.position.set(cx - half * 0.85, half * 0.8, cz + half * 0.6);
    key.target.position.set(cx, 0, cz);
    key.target.updateMatrixWorld();
    const box = key.shadow.camera;
    box.left = -half;
    box.right = half;
    box.top = half;
    box.bottom = -half;
    box.near = 1;
    box.far = half * 3.4;
    box.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  applyPose(pose: CameraPose): void {
    this.camera.position.set(pose.px, pose.py, pose.pz);
    this.controls.target.set(pose.tx, pose.ty, pose.tz);
  }

  /** 切换视图时清掉阻尼残余，否则恢复的相机会继续漂移几像素 */
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
    this.wake();
  };

  private onPointerMove = (ev: PointerEvent): void => {
    this.wake();
    if (ev.buttons !== 0) return;
    const hit = this.pick(ev);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    this.hooks.onHud(hit ? hit.hint : this.hudDefault());
  };

  private hudDefault(): string {
    return this.view === 'hall'
      ? '拖拽转视角 · 滚轮远近 · WASD 平移 · 点六棱柱进房间'
      : '拖拽转视角 · 点方块看书 · 点细柱读章 · 点光点读概念 · WASD 平移';
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

  /** WASD 沿相机朝向的水平投影平移；QE 升降。相机与目标点同步移动 → 朝向不变 */
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

  private pick(ev: PointerEvent): Pick | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.camera);
    if (this.view === 'hall') {
      const hit = this.ray.intersectObject(this.beacons, false)[0];
      if (!hit || hit.instanceId === undefined) return null;
      const spec = ROOMS[hit.instanceId];
      if (!spec) return null;
      return { kind: 'room', discipline: spec.key, hint: `进入 ${spec.title}` };
    }
    // 光点最小、立柱居中、展台最大：按命中距离取最近的 targetable，
    // 否则远处的展台面会挡住近处应点的概念光点
    const targets = [this.platforms, this.columns, this.dots].filter(
      (o): o is THREE.InstancedMesh => !!o && o.visible,
    );
    const hits = this.ray.intersectObjects(targets, false);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      if (hit.object === this.dots) {
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
      if (hit.object === this.columns) {
        const ref = this.colRefs[hit.instanceId];
        if (!ref) continue;
        return {
          kind: 'chapter',
          discipline: ref.book.discipline,
          book: ref.book,
          id: ref.chapterId,
          hint: `${ref.book.title || ref.book.bookSlug} · 章 ${ref.chapterId} · 点击读正文`,
        };
      }
      const book = this.bookOrder[hit.instanceId];
      if (!book) continue;
      return {
        kind: 'book',
        discipline: book.discipline,
        book,
        hint: `${book.title || book.bookSlug} · 点击查看`,
      };
    }
    return null;
  }

  handleClick(ev: PointerEvent): void {
    // OrbitControls 拖拽转视角后浏览器仍会派发 click，按位移阈值把拖动排除掉
    const moved = Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y);
    if (moved > 6) return;
    const hit = this.pick(ev);
    if (!hit) return;
    if (hit.kind === 'room') this.hooks.onPickRoom(hit.discipline);
    else if (hit.kind === 'book' && hit.book) this.hooks.onPickBook(hit.discipline, hit.book);
    else if (hit.kind === 'chapter' && hit.book && hit.id) {
      this.hooks.onPickBook(hit.discipline, hit.book);
      this.hooks.onPickChapter(hit.discipline, hit.book, hit.id);
    } else if (hit.kind === 'concept' && hit.book && hit.id) {
      this.hooks.onPickConcept(hit.discipline, hit.book, hit.id);
    }
  }

  /** 自动化自检用：把房间 / 书目节点的世界坐标投到 CSS 像素坐标 */
  screenPoint(kind: 'room' | 'book', id: string): { x: number; y: number } | null {
    let world: THREE.Vector3 | null = null;
    if (kind === 'room') {
      if (this.view !== 'hall') return null;
      const spec = ROOM_BY_KEY[id as Discipline];
      if (!spec) return null;
      world = new THREE.Vector3(spec.at[0], 22, spec.at[1]);
    } else {
      if (this.view !== 'room') return null;
      const placement = this.layout?.books.find(
        (b) => `${b.book.repo}::${b.book.bookSlug}` === id,
      );
      if (!placement) return null;
      world = new THREE.Vector3(
        this.room.position.x + placement.x,
        PODIUM_H + PLAT_H,
        this.room.position.z + placement.z,
      );
    }
    const ndc = world.clone().project(this.camera);
    if (ndc.z < -1 || ndc.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  }

  /** 自检用：当前房间实际建出的书节点、章节立柱与概念光点数 */
  nodeStats(): { books: number; columns: number; dots: number } {
    return {
      books: this.bookOrder.length,
      columns: this.layout?.columns.length ?? 0,
      dots: this.dotRefs.length,
    };
  }

  /** WASD 判据要证明「只平移不转向」：相机朝向单位向量 */
  direction(): { x: number; y: number; z: number } {
    const v = new THREE.Vector3();
    this.camera.getWorldDirection(v);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** 自检与外部交互可主动唤醒渲染循环 */
  nudge(): void {
    this.wake();
  }

  /** 阅读层当前所在的概念 id：对应光点染高亮色 */
  highlightConcept(conceptId: string | null): void {
    if (this.conceptShown === conceptId) return;
    this.conceptShown = conceptId;
    this.recolorDots();
    this.wake();
  }

  private recolorDots(): void {
    if (!this.dots) return;
    const col = new THREE.Color();
    const gold = new THREE.Color('#ffd66b');
    this.dotRefs.forEach((ref, i) => {
      this.dots?.setColorAt(
        i,
        col.copy(ref.conceptId === this.conceptShown ? gold : this.dotBase),
      );
    });
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }

  /** 光点面片朝向相机：位置/尺寸仍来自实例矩阵，射线拾取与画面保持同源 */
  private updateBillboards(): void {
    const dots = this.dots;
    if (!dots || !dots.visible || !this.dotSeeds.length) return;
    this.camera.updateMatrixWorld();
    this.billboardQuat.setFromRotationMatrix(this.camera.matrixWorld);
    for (let i = 0; i < this.dotSeeds.length; i += 1) {
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

  /** 渲染器实际提交的三角面数（docs/design.md 的 15 万面预算按此核对） */
  triangles(): number {
    return this.renderer.info.render.triangles;
  }

  /**
   * 渲染层 census（阶段 A 基线与阶段 E 断言共用同一把尺）。
   * 三角面三个口径：mainPass 按可见对象静态算、shadowPass 只算投影者、perFrame 取 renderer.info 整帧累计。
   */
  census(): RenderCensus {
    const materials: Record<string, number> = {};
    const lights: Record<string, number> = {};
    const lightSpec: RenderCensus['lightSpec'] = [];
    let main = 0;
    let shadow = 0;
    let lit = 0;
    let unlit = 0;
    const builtColumnGeometry: string[] = [];
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
      const tris = trianglesOf(mesh);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // 半透明 + DoubleSide 会拆成前后两趟提交，静态求和按一趟算就比 GPU 口径少一半：
      // 大厅实测差额 588 = 6 个学科环(96×6) + 6 条走廊地面带(2×6) 的第二趟。
      const drawPasses = mats.some((m) => m?.transparent && m.side === THREE.DoubleSide) ? 2 : 1;
      main += tris * drawPasses;
      if (mesh.castShadow) shadow += tris * drawPasses;
      for (const m of mats) {
        if (!m) continue;
        materials[m.type] = (materials[m.type] ?? 0) + 1;
        if (m.type === 'MeshStandardMaterial' || m.type === 'MeshPhysicalMaterial') lit += 1;
        else if (m.type === 'MeshBasicMaterial') unlit += 1;
      }
      if (obj.userData.role === 'columns') {
        // 签名 = 几何类型 + 形态名 + 顶点数：只报 type 时数学与 AI 都是 CylinderGeometry，
        // 证不了「六种形态」，加上后两段就能直接看出建的是不同的几何体
        const cg = mesh.geometry as THREE.BufferGeometry;
        const verts = cg.getAttribute('position')?.count ?? 0;
        builtColumnGeometry.push(`${cg.type}:${obj.userData.shape ?? '?'}:${verts}`);
      }
    });
    const env = this.scene.environment;
    const bloom = this.bloomPass;
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
        // r186 起 PCFSoftShadowMap 被并入 PCFShadowMap：装配时 requested 是 Soft，
        // 首帧阴影渲染后 three 归一化成 type，两个口径都留证才说得清「软阴影确实开着」
        requested: shadowTypeName(this.shadowRequested),
        mapSize: this.keyLight?.shadow?.mapSize.width ?? 0,
        autoUpdate: this.renderer.shadowMap.autoUpdate,
      },
      environment: {
        present: !!env,
        mapping: env?.mapping ?? -1,
        // PMREM 的产物是 render-target 贴图：TextureLoader 那条路永远拿不到这个标记，
        // 加上 HalfFloatType 与装配时写的 userData.pmrem，三条一起证「环境贴图是程序化生成的」
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
      fog: this.scene.fog instanceof THREE.Fog ? { near: this.scene.fog.near, far: this.scene.fog.far } : null,
      triangles: { mainPass: Math.round(main), shadowPass: Math.round(shadow), perFrame: this.renderer.info.render.triangles },
      calls: { perFrame: this.renderer.info.render.calls },
      columnKinds: { ...COLUMN_KINDS },
      columnKindsDistinct: new Set(Object.values(COLUMN_KINDS)).size,
      builtColumnGeometry,
      dotBillboard: this.dots?.userData.billboard === true,
      dotCount: this.dotRefs.length,
      dotTexture: typeof this.dots?.userData.dotTexture === 'string' ? this.dots.userData.dotTexture : 'none',
    };
  }

  /**
   * 亮度采样：现渲一帧再从默认帧缓冲读一块区域（归一化矩形，y 自下而上）。
   * 无 vsync 的 headless 里这是唯一能拿到「肉眼级」证据的口子——截图与采样同源。
   */
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

  /**
   * 标定入口（仅取证用）：运行时改主光/环境光/曝光/两块地面反照率倍率与两组点光强度，
   * 选出一组常量后回写源码，避免「改一版重编一次」。返回实际生效的值，防旋钮打空。
   */
  tune(o: {
    key?: number;
    hemi?: number;
    exposure?: number;
    groundAlbedo?: number;
    discAlbedo?: number;
    zonePoint?: number;
    roomPoint?: number;
  }): Record<string, number> {
    const out: Record<string, number> = {};
    if (o.key !== undefined && this.keyLight) out.key = this.keyLight.intensity = o.key;
    if (o.hemi !== undefined && this.hemiLight) out.hemi = this.hemiLight.intensity = o.hemi;
    if (o.exposure !== undefined) {
      this.renderer.toneMappingExposure = o.exposure;
      out.exposure = o.exposure;
    }
    if (o.groundAlbedo !== undefined && this.hallFloor) {
      (this.hallFloor.material as THREE.MeshStandardMaterial).color.setScalar(o.groundAlbedo);
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
      this.roomLights[1].intensity = o.roomPoint * 0.56;
      out.roomPoint = o.roomPoint;
    }
    this.wake();
    return out;
  }

  /** 取证用：运行时改 bloom 三参数，标定过程留在门槛日志里而不是靠重编译试 */
  setBloom(next: { threshold?: number; strength?: number; radius?: number }): boolean {
    const bloom = this.bloomPass;
    if (!bloom) return false;
    if (next.threshold !== undefined) bloom.threshold = next.threshold;
    if (next.strength !== undefined) bloom.strength = next.strength;
    if (next.radius !== undefined) bloom.radius = next.radius;
    this.wake();
    return true;
  }

  /** 取证用：单独关掉某条 pass（bloom / output）以对照，不影响正常渲染路径 */
  setPassEnabled(name: string, on: boolean): boolean {
    const hit = this.postList.find((p) => p.name.includes(name));
    if (!hit) return false;
    hit.pass.enabled = on;
    this.wake();
    return true;
  }

  /** 取证用：整帧阴影开关，用来证明阴影 pass 真的在改画面 */
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

  /** 走廊名沿走廊走向铺地，大厅固定机位下必然有两条被透视压成竖排；自检逐条转到正对视角取证 */
  viewCorridor(key: Discipline): boolean {
    const spec = ROOM_BY_KEY[key];
    const mesh = this.corridorMeshes.get(key);
    if (!spec || !mesh) return false;
    this.view = 'hall';
    this.hall.visible = true;
    this.room.visible = false;
    const dir = new THREE.Vector3(spec.at[0], 0, spec.at[1]);
    const len = dir.length() || 1;
    dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const mid = new THREE.Vector3(spec.at[0] * 0.72, 0.62, spec.at[1] * 0.72);
    const dist = Math.max(96, len * 0.5);
    this.camera.position.set(mid.x + perp.x * dist, dist * 0.62, mid.z + perp.z * dist);
    this.controls.target.copy(mid);
    this.resetInertia();
    this.controls.update();
    this.wake();
    return true;
  }

  /** 地面文字投影到屏幕后的包围盒：宽高比 ≥3 才是「横排可读」，否则是被压成竖排 */
  corridorScreenBox(key: Discipline): { w: number; h: number } | null {
    const mesh = this.corridorMeshes.get(key);
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

  /** 小地图数据：大厅俯视用六区，房间俯视用展台 */
  minimapState(): MinimapState {
    if (this.view === 'hall') {
      const grouped = new Map<Discipline, number>();
      for (const s of this.manifest.sites) {
        grouped.set(s.discipline, (grouped.get(s.discipline) ?? 0) + 1);
      }
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
        })),
        books: [],
      };
    }
    return {
      view: 'room',
      room: this.roomKey,
      camera: { x: this.camera.position.x, z: this.camera.position.z },
      look: { x: this.controls.target.x, z: this.controls.target.z },
      zones: [],
      books: (this.layout?.books ?? []).map((b) => ({
        x: this.room.position.x + b.x,
        z: this.room.position.z + b.z,
        level: b.book.contentLevel,
      })),
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
    if (!this.dots || this.view !== 'room') return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.dots.visible = dist <= 240;
    if (this.lines) this.lines.visible = dist <= 200;
  }

  /** 最近若干帧的平均 fps */
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
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.ensurePost(w, h);
  }

  /** 后期链惰性建立：首帧尺寸已知才建，之后每次 resize 让 composer 与各 pass 一起跟着改 */
  private ensurePost(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    if (this.composerHandle) {
      this.composerHandle.setPixelRatio(pr);
      this.composerHandle.setSize(w, h);
      this.bloomHandle?.setSize(Math.round(w * pr * BLOOM_SCALE), Math.round(h * pr * BLOOM_SCALE));
      return;
    }
    const chain = buildPostChain(this.renderer, this.scene, this.camera, w, h);
    this.composerHandle = chain.composer;
    this.composer = chain.composer;
    this.bloomPass = chain.bloom;
    this.bloomHandle = chain.bloom;
    // 辉光是低频信号，bloom 内部链按 0.65 倍率跑，全屏多花的那 11% 帧时间不划算
    chain.bloom.setSize(Math.round(w * pr * BLOOM_SCALE), Math.round(h * pr * BLOOM_SCALE));
    this.postList = [
      { name: 'RenderPass', pass: chain.render },
      { name: 'UnrealBloomPass', pass: chain.bloom },
      { name: 'OutputPass', pass: chain.output },
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('wheel', this.wake);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.corridorMeshes.clear();
    for (const mesh of this.corridorFloors.splice(0)) {
      this.hall.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.corridorNames = [];
    this.clearRoom();
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
    for (const tex of [this.groundTex, this.glowTex, this.discTex]) tex?.dispose();
    this.groundTex = this.glowTex = this.discTex = null;
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

function shortTitle(t: string): string {
  return t.length > 9 ? `${t.slice(0, 8)}…` : t;
}

/**
 * 只走「真正会提交给 GPU」的对象：Group.visible=false 时其整棵子树都不渲染，
 * 原生 traverse 会连隐藏子树一起数，大厅/房间互斥可见时 census 就会虚报一倍。
 */
function walkVisible(obj: THREE.Object3D, fn: (o: THREE.Object3D) => void): void {
  if (!obj.visible) return;
  fn(obj);
  for (const child of obj.children) walkVisible(child, fn);
}

/** 单个对象本帧提交的三角面：实例化按 count 乘，精灵固定两片 */
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
