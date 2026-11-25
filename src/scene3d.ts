import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Discipline, ManifestIndex, SiteEntry } from './types';
import { BG, FLOOR, HALL_LABEL, ROOMS, ROOM_BY_KEY } from './config';
import { layoutColumns, layoutRoom, type RoomLayout } from './layout';
import type { BookRecord } from './types';
import type { CameraPose } from './state';

const KEY_SPEED = 62; // 世界单位/秒，1440×900 下走一条走廊约 4 秒
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

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

export interface MinimapState {
  view: 'hall' | 'room';
  room: Discipline | null;
  camera: { x: number; z: number };
  look: { x: number; z: number };
  zones: Array<{ key: Discipline; short: string; color: string; x: number; z: number; count: number }>;
  books: Array<{ x: number; z: number; level: string }>;
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
    root.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(new THREE.Color(BG).getHex(), 560, 1300);

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
      new THREE.MeshBasicMaterial({ color: new THREE.Color(FLOOR) }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.4;
    this.hall.add(floor);

    const grid = new THREE.GridHelper(1040, 26, 0x1c2230, 0x171c26);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    this.hall.add(grid);

    const beaconGeo = new THREE.CylinderGeometry(18, 24, 44, 6);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, ROOMS.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    ROOMS.forEach((r, i) => {
      m.makeTranslation(r.at[0], 22, r.at[1]);
      this.beacons.setMatrixAt(i, m);
      this.beacons.setColorAt(i, color.set(r.color));
      this.hall.add(this.label(this.hallLabels, r.short, r.at[0], 60, r.at[1], r.color, 1.5));
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
        new THREE.Line(g, new THREE.LineBasicMaterial({ color: r.color, transparent: true, opacity: 0.32 })),
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
    for (const obj of [this.platforms, this.columns, this.dots]) {
      if (!obj) continue;
      this.room.remove(obj);
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose());
      obj.dispose();
    }
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
      (this.roomFloor.material as THREE.Material).dispose();
      this.roomFloor = null;
    }
    this.platforms = this.columns = this.dots = null;
    this.dotRefs = [];
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

    const platGeo = new THREE.BoxGeometry(18, 1.4, 18);
    const platMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const plats = new THREE.InstancedMesh(platGeo, platMat, books.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    this.layout.books.forEach((b, i) => {
      m.makeTranslation(b.x, 0.7, b.z);
      plats.setMatrixAt(i, m);
      plats.setColorAt(i, col.set(spec.color).multiplyScalar(b.book.contentLevel === 'full' ? 1 : 0.55));
    });
    plats.instanceMatrix.needsUpdate = true;
    if (plats.instanceColor) plats.instanceColor.needsUpdate = true;
    this.platforms = plats;
    this.room.add(plats);

    if (this.layout.columns.length) {
      const colGeo = new THREE.BoxGeometry(1.6, 1, 1.6);
      const columns = new THREE.InstancedMesh(
        colGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        this.layout.columns.length,
      );
      this.layout.columns.forEach((c, i) => {
        m.compose(
          new THREE.Vector3(c.x, 1.4 + c.height / 2, c.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, c.height, 1),
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
      const dots = new THREE.InstancedMesh(
        new THREE.OctahedronGeometry(0.9, 0),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        dotList.length,
      );
      let k = 0;
      const pts: THREE.Vector3[] = [];
      this.dotRefs = [];
      for (const { column: c, concept } of dotList) {
        const top = 1.4 + c.height + 1.6;
        const a = ((k % 8) / 8) * Math.PI * 2;
        const p = new THREE.Vector3(c.x + Math.cos(a) * 2.6, top + (k % 2) * 1.1, c.z + Math.sin(a) * 2.6);
        m.makeTranslation(p.x, p.y, p.z);
        dots.setMatrixAt(k, m);
        dots.setColorAt(k, col.set('#e8ecf4'));
        this.dotRefs.push({ book: c.book, conceptId: concept.id });
        pts.push(p);
        k += 1;
      }
      dots.instanceMatrix.needsUpdate = true;
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
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
    this.enterRoomCamera(spec, reach, pose);
    this.hooks.onHud(
      `${spec.title} · ${books.length} 本 · ${this.layout.columns.length} 根章节立柱`,
    );
  }

  private addRoomFloor(spec: (typeof ROOMS)[number], radius: number): void {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(spec.color),
        transparent: true,
        opacity: 0.09,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
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
    this.wake();
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
        0.7,
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
    this.dotRefs.forEach((ref, i) => {
      this.dots?.setColorAt(i, col.set(ref.conceptId === this.conceptShown ? '#ffd66b' : '#e8ecf4'));
    });
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }

  /** 渲染器实际提交的三角面数（docs/design.md 的 15 万面预算按此核对） */
  triangles(): number {
    return this.renderer.info.render.triangles;
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
      this.renderer.render(this.scene, this.camera);
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
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

function shortTitle(t: string): string {
  return t.length > 9 ? `${t.slice(0, 8)}…` : t;
}
