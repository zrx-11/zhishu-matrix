/**
 * 批 8 结构几何：墙体、天花、踢脚/挂镜线、门框、书架、书脊、八角厅与走廊，
 * 全部合并成少量非索引 BufferGeometry（position/normal/uv）+ 逐三角形角色表用于拾取。
 * 零外部资产：贴图一律由 spacekit / atlas 程序化现画。
 */
import * as THREE from 'three';
import {
  ATRIUM,
  CORRIDOR_H,
  CORRIDOR_W,
  DESK_SECTORS,
  DOOR_H,
  DOOR_W,
  HALL_HEIGHT,
  HALL_RADIUS,
  HALL_SIDES,
  ROOMS,
  SHELF_DEPTH,
  SHELF_KINDS,
  type ShelfKind,
} from './config';
import type { Discipline } from './types';
import type { RoomPlan, ShelfRowSpec, SpinePlacement } from './layout';
import type { SpineAtlas } from './atlas';

export type Vec3 = [number, number, number];
const UP: Vec3 = [0, 1, 0];

/** 程序化纹理的铺贴周期（世界单位）：UV 直接按它换算成「几格」，共享一张贴图也能适配不同房间尺寸 */
export const TILE = { floor: 4.2, wall: 7.5, ceiling: 6.5, trim: 2.4, shelf: 3.6 };

/** 阅览室门洞（比大厅门小一号） */
export const ROOM_DOOR = { w: 7.2, h: 9.2 };
const SHELF_BASE = 0.42;
const TRIM_H = 0.52;
const RAIL_Y_RATIO = 0.72;

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  /** 逐三角形拾取信息：role = 语义（章/铜牌/封面），ref = 书位下标，aux = 章序号 */
  readonly role: number[] = [];
  readonly ref: number[] = [];
  readonly aux: number[] = [];

  get faces(): number {
    return this.role.length;
  }

  /** 四边形（两三角）：a→b→c、a→c→d；绕序与给定法线不符时自动翻转 */
  quad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    uv: [number, number, number, number],
    n: Vec3,
    role = -1,
    ref = -1,
    aux = -1,
  ): this {
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    const gx = e1y * e2z - e1z * e2y;
    const gy = e1z * e2x - e1x * e2z;
    const gz = e1x * e2y - e1y * e2x;
    const [u0, v0, u1, v1] = uv;
    // UV 绑角点而非绑「槽位」：绕序不符时把 b、d 连同它们的 uv 一起换，
    // 否则贴图会被转置 90°——书脊格是 1:5 的竖长条，转置后书名横躺、金线变竖纹。
    let bb = b;
    let dd = d;
    let bUv: [number, number] = [u1, v0];
    let dUv: [number, number] = [u0, v1];
    if (gx * n[0] + gy * n[1] + gz * n[2] < 0) {
      bb = d;
      dd = b;
      bUv = [u0, v1];
      dUv = [u1, v0];
    }
    const verts = [a, bb, c, a, c, dd];
    const uvs = [u0, v0, bUv[0], bUv[1], u1, v1, u0, v0, u1, v1, dUv[0], dUv[1]];
    for (let i = 0; i < 6; i += 1) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
    }
    this.uv.push(...uvs);
    this.role.push(role, role);
    this.ref.push(ref, ref);
    this.aux.push(aux, aux);
    return this;
  }

  /** 三角形（八角地面/天花的扇形）；批 12 台面扇区也要拾取，故角色表一并落 */
  tri(a: Vec3, b: Vec3, c: Vec3, uv: number[], n: Vec3, role = -1, ref = -1, aux = -1): this {
    // 与 quad 同一条规矩：几何绕序必须与声明的法线一致，否则 FrontSide 下这一面会被背面剔除。
    // 八角厅地面按环序 (a→p→q) 写出来的几何法线朝下，材质却给了 UP——结果整块总览图从俯视看不见，
    // 采样亮度与隐藏它之后一模一样（见 pitfalls 56）。UV 跟着顶点一起换，不能留在槽位上。
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const g: Vec3 = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    let verts: Vec3[] = [a, b, c];
    let uvs = uv;
    if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) {
      verts = [a, c, b];
      uvs = [uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]];
    }
    for (let i = 0; i < 3; i += 1) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
    }
    this.uv.push(...uvs);
    this.role.push(role);
    this.ref.push(ref);
    this.aux.push(aux);
    return this;
  }

  /** 定向长方体：center ± u·hu ± v·hv ± w·hw，六个面各两片，UV 随世界尺寸走 */
  slab(
    center: Vec3,
    u: Vec3,
    v: Vec3,
    w: Vec3,
    hu: number,
    hv: number,
    hw: number,
    uvScale: number,
    ref = -1,
  ): this {
    const faces: Array<{ axis: Vec3; sign: number; a: Vec3; b: Vec3; ha: number; hb: number; off: number }> = [
      { axis: u, sign: -1, a: v, b: w, ha: hv, hb: hw, off: hu },
      { axis: u, sign: 1, a: v, b: w, ha: hv, hb: hw, off: hu },
      { axis: v, sign: -1, a: u, b: w, ha: hu, hb: hw, off: hv },
      { axis: v, sign: 1, a: u, b: w, ha: hu, hb: hw, off: hv },
      { axis: w, sign: -1, a: u, b: v, ha: hu, hb: hv, off: hw },
      { axis: w, sign: 1, a: u, b: v, ha: hu, hb: hv, off: hw },
    ];
    for (const f of faces) {
      const ox = f.axis[0] * f.sign * f.off;
      const oy = f.axis[1] * f.sign * f.off;
      const oz = f.axis[2] * f.sign * f.off;
      const n: Vec3 = [f.axis[0] * f.sign, f.axis[1] * f.sign, f.axis[2] * f.sign];
      const p = (sa: number, sb: number): Vec3 => [
        center[0] + ox + f.a[0] * sa + f.b[0] * sb,
        center[1] + oy + f.a[1] * sa + f.b[1] * sb,
        center[2] + oz + f.a[2] * sa + f.b[2] * sb,
      ];
      this.quad(p(-f.ha, -f.hb), p(f.ha, -f.hb), p(f.ha, f.hb), p(-f.ha, f.hb),
        [-f.ha * uvScale, -f.hb * uvScale, f.ha * uvScale, f.hb * uvScale], n, -1, ref);
    }
    return this;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** 墙面上的一块：以 at（y=0 的墙面基准点）沿 dir 取 [t0,t1]、竖直取 [y0,y1] */
function wallPanel(
  b: GeoBuilder,
  at: Vec3,
  dir: Vec3,
  n: Vec3,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  tile: number,
): void {
  const pt = (t: number, y: number): Vec3 => [at[0] + dir[0] * t, y, at[2] + dir[2] * t];
  b.quad(pt(t0, y0), pt(t1, y0), pt(t1, y1), pt(t0, y1),
    [t0 / tile, y0 / tile, t1 / tile, y1 / tile], n);
}

/** 贴墙的细长装饰条（踢脚、挂镜线、檐口） */
function trimRun(
  b: GeoBuilder,
  at: Vec3,
  dir: Vec3,
  n: Vec3,
  t0: number,
  t1: number,
  y: number,
  h: number,
  out: number,
  tile: number,
): void {
  const mid: Vec3 = [
    at[0] + dir[0] * ((t0 + t1) / 2) + n[0] * (out / 2),
    y + h / 2,
    at[2] + dir[2] * ((t0 + t1) / 2) + n[2] * (out / 2),
  ];
  b.slab(mid, dir, UP, n, (t1 - t0) / 2, h / 2, out / 2, tile);
}

// ---------------------------------------------------------------- 阅览室外壳

export interface RoomShell {
  floor: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  ceiling: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  doorFrame: THREE.BufferGeometry;
  /** 天花格栅梁：单位盒实例矩阵 */
  beams: THREE.Matrix4[];
  stats: { walls: number; ceilingBeams: number; baseboards: number; rails: number; height: number; side: number };
}

export function buildRoomShell(plan: RoomPlan): RoomShell {
  const S = plan.side;
  const H = plan.height;
  const half = S / 2;
  const floor = new GeoBuilder();
  const walls = new GeoBuilder();
  const ceiling = new GeoBuilder();
  const trim = new GeoBuilder();
  const frame = new GeoBuilder();

  floor.quad([-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half],
    [-half / TILE.floor, -half / TILE.floor, half / TILE.floor, half / TILE.floor], UP);
  ceiling.quad([-half, H, -half], [half, H, -half], [half, H, half], [-half, H, half],
    [-half / TILE.ceiling, -half / TILE.ceiling, half / TILE.ceiling, half / TILE.ceiling], [0, -1, 0]);

  const sides: Array<{ at: Vec3; dir: Vec3; n: Vec3 }> = [
    { at: [-half, 0, 0], dir: [0, 0, 1], n: [1, 0, 0] },
    { at: [half, 0, 0], dir: [0, 0, -1], n: [-1, 0, 0] },
    { at: [0, 0, half], dir: [1, 0, 0], n: [0, 0, -1] },
  ];
  for (const w of sides) {
    wallPanel(walls, w.at, w.dir, w.n, -half, half, 0, H, TILE.wall);
    trimRun(trim, w.at, w.dir, w.n, -half, half, 0, TRIM_H, 0.34, TILE.trim);
    trimRun(trim, w.at, w.dir, w.n, -half, half, H * RAIL_Y_RATIO, 0.3, 0.28, TILE.trim);
  }
  const front: Vec3 = [0, 0, -half];
  const fdir: Vec3 = [1, 0, 0];
  const fn: Vec3 = [0, 0, 1];
  const dw = ROOM_DOOR.w / 2;
  const dh = Math.min(ROOM_DOOR.h, H - 1.2);
  wallPanel(walls, front, fdir, fn, -half, -dw, 0, H, TILE.wall);
  wallPanel(walls, front, fdir, fn, dw, half, 0, H, TILE.wall);
  wallPanel(walls, front, fdir, fn, -dw, dw, dh, H, TILE.wall);
  trimRun(trim, front, fdir, fn, -half, -dw, 0, TRIM_H, 0.34, TILE.trim);
  trimRun(trim, front, fdir, fn, dw, half, 0, TRIM_H, 0.34, TILE.trim);
  trimRun(trim, front, fdir, fn, -half, half, H * RAIL_Y_RATIO, 0.3, 0.28, TILE.trim);

  for (const sx of [-1, 1]) {
    frame.slab([sx * (dw + 0.32), dh / 2, -half + 0.12], fdir, UP, fn, 0.32, dh / 2, 0.5, TILE.trim);
  }
  frame.slab([0, dh + 0.34, -half + 0.12], fdir, UP, fn, dw + 0.66, 0.34, 0.5, TILE.trim);
  frame.slab([0, 0.06, -half + 0.12], fdir, UP, fn, dw + 0.66, 0.06, 0.56, TILE.trim);

  const beams: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const bw = 0.55;
  for (let i = 0; i < 3; i += 1) {
    m.compose(pos.set(0, H - 0.42, -S / 2 + (S * (i + 1)) / 4), q, sc.set(S, bw, bw));
    beams.push(m.clone());
  }
  const girders = S > 30 ? 5 : 4;
  for (let i = 0; i < girders; i += 1) {
    m.compose(pos.set(-S / 2 + (S * (i + 1)) / (girders + 1), H - 0.8, 0), q, sc.set(bw * 0.8, bw * 0.8, S));
    beams.push(m.clone());
  }

  return {
    floor: floor.toGeometry(),
    walls: walls.toGeometry(),
    ceiling: ceiling.toGeometry(),
    trim: trim.toGeometry(),
    doorFrame: frame.toGeometry(),
    beams,
    stats: { walls: 4, ceilingBeams: beams.length, baseboards: 4, rails: 4, height: H, side: S },
  };
}

// ---------------------------------------------------------------- 书架

function rowPlace(row: ShelfRowSpec, u: number, y: number, n: number): Vec3 {
  return [
    row.x + row.dir[0] * u + row.normal[0] * n,
    y,
    row.z + row.dir[1] * u + row.normal[1] * n,
  ];
}

function rowBasis(row: ShelfRowSpec): { u: Vec3; w: Vec3 } {
  return { u: [row.dir[0], 0, row.dir[1]], w: [row.normal[0], 0, row.normal[1]] };
}

/** 一区一种檐口语言：几何签名进 census，断言据此判「≥3 种且真建出来」 */
function crown(b: GeoBuilder, row: ShelfRowSpec, kind: ShelfKind, topY: number): string {
  const { u, w } = rowBasis(row);
  const L = row.length;
  const put = (uu: number, yy: number, nn: number, hu: number, hv: number, hw: number) =>
    b.slab(rowPlace(row, uu, yy, nn), u, UP, w, hu, hv, hw, TILE.shelf);
  const D = SHELF_DEPTH;
  switch (kind) {
    case 'crown': {
      put(0, topY + 0.3, 0.1, L / 2 + 0.3, 0.3, (D + 0.7) / 2);
      const n = Math.max(10, Math.round(L / 1.1));
      for (let i = 0; i < n; i += 1) put(-L / 2 + (L * (i + 0.5)) / n, topY + 0.86, 0.1, 0.22, 0.28, 0.42);
      put(0, topY + 1.34, 0.1, L / 2 + 0.1, 0.2, (D + 0.4) / 2);
      return `crown:dentil(${n})`;
    }
    case 'arch': {
      put(0, topY + 0.34, 0, L / 2, 0.34, D / 2);
      const steps = 11;
      for (let i = 0; i < steps; i += 1) {
        const t = -L / 2 + (L * i) / (steps - 1);
        const a = Math.PI * (0.1 + (0.8 * i) / (steps - 1));
        put(t, topY + 0.85 + Math.sin(a) * 1.4, 0.05, L / steps / 2.2, 0.26, 0.4);
      }
      return `arch:ribs(${steps})`;
    }
    case 'pediment': {
      const steps = 14;
      let n = 0;
      for (let i = 0; i < steps; i += 1) {
        if (i > steps - 4) continue;
        for (const s of [-1, 1]) {
          const t = s * (L / 2 - (i * L) / (2 * steps) - L / (4 * steps));
          put(t, topY + 0.5 + (i * 1.9) / steps, 0.05, L / (4 * steps), 0.26, 0.4);
          n += 1;
        }
      }
      put(0, topY + 0.26, 0, L / 2, 0.26, (D - 0.2) / 2);
      return `pediment:broken(${n})`;
    }
    case 'tower': {
      put(0, topY + 0.4, 0, L / 2 + 0.2, 0.4, (D + 0.5) / 2);
      for (const s of [-1, 1]) {
        put(s * (L / 2 - 0.6), topY + 1.5, 0, 0.62, 1.5, (D - 0.3) / 2);
        put(s * (L / 2 - 0.6), topY + 3.15, 0, 0.3, 0.15, 0.3);
        put(s * (L / 2 - 0.6), topY + 3.5, 0, 0.14, 0.22, 0.14);
      }
      put(0, topY + 1.4, -0.2, L / 2 - 1.6, 0.9, 0.2);
      return 'tower:twin-spires';
    }
    case 'chest': {
      put(0, topY + 0.3, 0, L / 2 + 0.4, 0.3, (D + 0.9) / 2);
      const drawers = Math.max(6, Math.round(L / 2.4));
      for (let i = 0; i < drawers; i += 1) {
        const t = -L / 2 + (L * (i + 0.5)) / drawers;
        put(t, SHELF_BASE * 0.55, D / 2 + 0.02, L / drawers / 2 - 0.16, SHELF_BASE * 0.42, 0.12);
        put(t, SHELF_BASE * 0.55, D / 2 + 0.16, 0.16, 0.16, 0.06);
      }
      return `chest:drawers(${drawers})`;
    }
    case 'scroll':
    default: {
      put(0, topY + 0.3, 0, L / 2, 0.3, (D + 0.6) / 2);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i += 1) {
          const r = 1.15 - i * 0.18;
          put(s * (L / 2 + 0.1 - i * 0.22), topY + 0.9 + i * r * 0.45, 0, 0.24, r * 0.5, 0.44);
        }
      }
      return 'scroll:volutes(2)';
    }
  }
}

export interface BuiltShelves {
  geometry: THREE.BufferGeometry;
  signature: string[];
  rows: number;
  dividers: number;
  tiers: number;
}

/** 三面墙一整排书架：侧板 + 背板 + 底座 + 层板 + 上下檐口 + 书位分隔板，合并成一个几何 */
export function buildShelves(plan: RoomPlan): BuiltShelves {
  const b = new GeoBuilder();
  const signature: string[] = [];
  let dividers = 0;
  const D = SHELF_DEPTH;
  for (const row of plan.rows) {
    const { u, w } = rowBasis(row);
    const L = row.length;
    const topY = row.boardY[row.boardY.length - 1] + row.pitch * 0.62;
    const put = (uu: number, yy: number, nn: number, hu: number, hv: number, hw: number) =>
      b.slab(rowPlace(row, uu, yy, nn), u, UP, w, hu, hv, hw, TILE.shelf);
    for (const s of [-1, 1]) put((s * L) / 2, topY / 2, 0, 0.16, topY / 2, D / 2);
    put(0, topY / 2, -D / 2 + 0.07, L / 2, topY / 2, 0.07);
    put(0, SHELF_BASE * 0.35, 0.04, L / 2, SHELF_BASE * 0.35, D / 2 - 0.06);
    for (const y of row.boardY) put(0, y - 0.11, 0.02, L / 2 - 0.12, 0.11, D - 0.16);
    put(0, topY + 0.05, 0.12, L / 2 + 0.22, 0.2, (D + 0.5) / 2);
    signature.push(crown(b, row, SHELF_KINDS[plan.discipline], topY));
    for (const slot of plan.slots) {
      if (slot.wall !== row.wall) continue;
      const y = row.boardY[slot.level] + slot.bookH / 2;
      for (const edge of [slot.u0, slot.u0 + slot.slotW]) {
        put(edge, y, -0.12, 0.05, slot.bookH / 2, (D - 0.7) / 2);
        dividers += 1;
      }
    }
  }
  return {
    geometry: b.toGeometry(),
    signature,
    rows: plan.rows.length,
    dividers,
    tiers: plan.rows[0]?.levels ?? 0,
  };
}

// ---------------------------------------------------------------- 书脊

export const SPINE_FACE = { chapter: 0, plate: 1, cover: 2 } as const;

export interface SpinePage {
  page: number;
  geometry: THREE.BufferGeometry;
  /** 逐三角：拾取角色（SPINE_FACE） */
  triRole: number[];
  /** 逐三角：书位下标（plan.slots） */
  triSlot: number[];
  /** 逐三角：章在本书内的序号 */
  triChapter: number[];
  /** 逐三角：plan.spines 的全局下标——拾取直接下标取，不做线性搜索 */
  triSpine: number[];
  triangles: number;
}

/**
 * 一页图集 = 一个 Mesh = 一个 draw call（每区 ≤3）。
 * faceIndex → (书, 章) 的映射表在构建期逐三角形落好，点击时只按 faceIndex 下标取，无线性搜索。
 */
export function buildSpines(plan: RoomPlan, atlas: SpineAtlas): SpinePage[] {
  const builders: GeoBuilder[] = [];
  const order: number[][] = [];
  for (let p = 0; p < atlas.pages; p += 1) {
    builders.push(new GeoBuilder());
    order.push([]);
  }
  plan.spines.forEach((sp, i) => {
    const cell = atlas.cells[sp.cell];
    const sw = atlas.swatches[sp.slot];
    if (!cell || !sw) return;
    const page = Math.min(builders.length - 1, cell.page);
    emitSpine(builders[page], sp, cell, sw);
    order[page]?.push(i);
  });
  return builders.map((b, page) => {
    const triSpine: number[] = [];
    // 一条书脊 = 6 面 × 2 三角 = 12 个三角形，按建脊顺序展开即 faceIndex → 书脊
    for (const i of order[page] ?? []) for (let t = 0; t < 12; t += 1) triSpine.push(i);
    return {
      page,
      geometry: b.toGeometry(),
      triRole: [...b.role],
      triSlot: [...b.ref],
      triChapter: [...b.aux],
      triSpine,
      triangles: b.faces,
    };
  });
}

function emitSpine(b: GeoBuilder, sp: SpinePlacement, cell: SpineAtlas['cells'][number], sw: SpineAtlas['swatches'][number]): void {
  const w: Vec3 = [sp.normal[0], 0, sp.normal[1]];
  // 面内水平轴由法线推出（u = up × w），不直接用 row.dir：
  // 书架沿三面墙排布，对侧墙的 dir 与 normal 构成的手性相反，正对着看会整面镜像——
  // 铜牌数字变 Ɛ、汉字左右翻，特写里书名怎么提分辨率都读不出来。
  const u: Vec3 = [w[2], 0, -w[0]];
  const hu = sp.w / 2;
  const hv = sp.h / 2;
  const hw = sp.depth / 2;
  const corner = (su: number, sv: number, sn: number): Vec3 => [
    sp.x + u[0] * su * hu + w[0] * sn * hw,
    sp.y + sv * hv,
    sp.z + u[2] * su * hu + w[2] * sn * hw,
  ];
  const axis = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  // 正面：章格（点 → 该章）
  b.quad(corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1),
    [cell.u0, cell.v0, cell.u1, cell.v1], axis(w, 1), SPINE_FACE.chapter, sp.slot, sp.chapterIndex);
  // 顶面：铜牌（点 → 该书总览）
  b.quad(corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1),
    [cell.p0, cell.pv0, cell.p1, cell.pv1], UP, SPINE_FACE.plate, sp.slot, sp.chapterIndex);
  // 背面 / 两侧 / 底面：该书皮革色块
  b.quad(corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1),
    [sw.u0, sw.v0, sw.u1, sw.v1], axis(w, -1), SPINE_FACE.cover, sp.slot, sp.chapterIndex);
  for (const s of [-1, 1]) {
    b.quad(corner(s, -1, -1), corner(s, -1, 1), corner(s, 1, 1), corner(s, 1, -1),
      [sw.u0, sw.v0, sw.u1, sw.v1], axis(u, s), SPINE_FACE.cover, sp.slot, sp.chapterIndex);
  }
  b.quad(corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1),
    [sw.u0, sw.v0, sw.u1, sw.v1], [0, -1, 0], SPINE_FACE.cover, sp.slot, sp.chapterIndex);
}

// ---------------------------------------------------------------- 八角大厅

export interface BuiltHall {
  floor: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  muralPanels: THREE.BufferGeometry;
  muralFaces: Array<{ center: Vec3; normal: Vec3 }>;
  ceiling: THREE.BufferGeometry;
  /** 批 10 B1：藻井圈（8 扇环带，顶面/内檐/底面/外檐），补光下梁与顶板明度可分开 */
  coffer: THREE.BufferGeometry;
  frames: THREE.BufferGeometry;
  beams: THREE.Matrix4[];
  doors: Array<{ angle: number; plaque: Vec3; normal: Vec3; dir: Vec3; headerY: number }>;
  stats: { sides: number; doors: number; murals: number; ceilingBeams: number; radius: number; height: number };
}

/**
 * 批 10 B1 藻井圈参数：内径 38 让远端通识门洞的门楣（y=15.5）仍从圈内看得到，
 * 外径 43.6 离墙面（内切 44）留 0.4 的暗缝；圈顶 21.15 比径向梁顶 21.775 低，
 * 梁从圈面凸出 0.6，俯视才有「梁压板」的层级。采样口径见 scene3d.hallLightProbe。
 */
export const COFFER = { rIn: 38, rOut: 43.6, yTop: 21.15, yBot: 20.75, sides: HALL_SIDES } as const;

function sideBasis(k: number) {
  const angle = (Math.PI * 2 * k) / HALL_SIDES;
  const outward: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
  return {
    angle,
    center: [outward[0] * HALL_RADIUS, 0, outward[2] * HALL_RADIUS] as Vec3,
    dir: [-outward[2], 0, outward[0]] as Vec3,
    inward: [-outward[0], 0, -outward[2]] as Vec3,
    half: HALL_RADIUS * Math.tan(Math.PI / HALL_SIDES),
  };
}

function normAngle(a: number): number {
  return Number((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(6));
}

export function buildHall(doorAngles: number[]): BuiltHall {
  const Rc = HALL_RADIUS / Math.cos(Math.PI / HALL_SIDES);
  const H = HALL_HEIGHT;
  const bFloor = new GeoBuilder();
  const bWalls = new GeoBuilder();
  const bMural = new GeoBuilder();
  const bCeil = new GeoBuilder();
  const bCoffer = new GeoBuilder();
  const bFrame = new GeoBuilder();
  const muralFaces: BuiltHall['muralFaces'] = [];
  const doors: BuiltHall['doors'] = [];
  const doorSet = new Set(doorAngles.map(normAngle));

  for (let k = 0; k < HALL_SIDES; k += 1) {
    const s = sideBasis(k);
    if (doorSet.has(normAngle(s.angle))) {
      const dw = DOOR_W / 2;
      const dh = Math.min(DOOR_H, H - 2);
      wallPanel(bWalls, s.center, s.dir, s.inward, -s.half, -dw, 0, H, TILE.wall);
      wallPanel(bWalls, s.center, s.dir, s.inward, dw, s.half, 0, H, TILE.wall);
      wallPanel(bWalls, s.center, s.dir, s.inward, -dw, dw, dh, H, TILE.wall);
      for (const sg of [-1, 1]) {
        bFrame.slab(
          [s.center[0] + s.dir[0] * sg * (dw + 0.45), dh / 2, s.center[2] + s.dir[2] * sg * (dw + 0.45)],
          s.dir, UP, s.inward, 0.45, dh / 2, 0.5, TILE.trim,
        );
      }
      bFrame.slab([s.center[0], dh + 0.5, s.center[2]], s.dir, UP, s.inward, dw + 0.95, 0.5, 0.55, TILE.trim);
      doors.push({
        angle: s.angle,
        plaque: [s.center[0] + s.inward[0] * 0.4, dh + 1.9, s.center[2] + s.inward[2] * 0.4],
        normal: s.inward,
        dir: s.dir,
        headerY: dh,
      });
    } else {
      wallPanel(bWalls, s.center, s.dir, s.inward, -s.half, s.half, 0, H, TILE.wall);
      trimRun(bWalls, s.center, s.dir, s.inward, -s.half, s.half, 0, TRIM_H * 1.7, 0.3, TILE.trim);
      const mw = s.half * 0.76;
      const mh = H * 0.64;
      const mc: Vec3 = [s.center[0] + s.inward[0] * 0.28, H * 0.45, s.center[2] + s.inward[2] * 0.28];
      bMural.quad(
        [mc[0] - s.dir[0] * mw, mc[1] - mh / 2, mc[2] - s.dir[2] * mw],
        [mc[0] + s.dir[0] * mw, mc[1] - mh / 2, mc[2] + s.dir[2] * mw],
        [mc[0] + s.dir[0] * mw, mc[1] + mh / 2, mc[2] + s.dir[2] * mw],
        [mc[0] - s.dir[0] * mw, mc[1] + mh / 2, mc[2] - s.dir[2] * mw],
        [0, 0, 1, 1],
        s.inward,
      );
      muralFaces.push({ center: mc, normal: s.inward });
    }
  }

  const uvOf = (p: Vec3): [number, number] => [(p[0] + Rc) / (2 * Rc), 1 - (p[2] + Rc) / (2 * Rc)];
  const ring: Vec3[] = [];
  for (let k = 0; k < HALL_SIDES; k += 1) {
    const a = (Math.PI * 2 * (k + 0.5)) / HALL_SIDES;
    ring.push([Math.cos(a) * Rc, 0, Math.sin(a) * Rc]);
  }
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % HALL_SIDES];
    const a = uvOf(p);
    const c = uvOf(q);
    bFloor.tri([0, 0, 0], p, q, [0.5, 0.5, a[0], a[1], c[0], c[1]], UP);
    bCeil.tri([0, H, 0], p, q, [0.5, 0.5, a[0], a[1], c[0], c[1]], [0, -1, 0]);
  });

  // 批 10 B1：藻井圈。u = 方位角/2π（贴图 16 列对齐 8 条径向梁，每扇 2 列），
  // v = 内缘 0 → 外缘 1（贴图内侧亮、外侧压暗）。顶面/内檐/底面/外檐各一面，按扇拼成一块几何。
  for (let k = 0; k < COFFER.sides; k += 1) {
    const a0 = (Math.PI * 2 * k) / COFFER.sides;
    const a1 = (Math.PI * 2 * (k + 1)) / COFFER.sides;
    const am = (a0 + a1) / 2;
    const u0 = a0 / (Math.PI * 2);
    const u1 = a1 / (Math.PI * 2);
    const pt = (r: number, y: number, a: number): Vec3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    const uv: [number, number, number, number] = [u0, 0, u1, 1];
    bCoffer.quad(pt(COFFER.rIn, COFFER.yTop, a0), pt(COFFER.rIn, COFFER.yTop, a1), pt(COFFER.rOut, COFFER.yTop, a1), pt(COFFER.rOut, COFFER.yTop, a0), uv, UP);
    bCoffer.quad(pt(COFFER.rIn, COFFER.yBot, a0), pt(COFFER.rIn, COFFER.yBot, a1), pt(COFFER.rOut, COFFER.yBot, a1), pt(COFFER.rOut, COFFER.yBot, a0), uv, [0, -1, 0]);
    bCoffer.quad(pt(COFFER.rIn, COFFER.yTop, a0), pt(COFFER.rIn, COFFER.yTop, a1), pt(COFFER.rIn, COFFER.yBot, a1), pt(COFFER.rIn, COFFER.yBot, a0), [u0, 0, u1, 1], [-Math.cos(am), 0, -Math.sin(am)]);
    bCoffer.quad(pt(COFFER.rOut, COFFER.yTop, a0), pt(COFFER.rOut, COFFER.yTop, a1), pt(COFFER.rOut, COFFER.yBot, a1), pt(COFFER.rOut, COFFER.yBot, a0), [u0, 0, u1, 1], [Math.cos(am), 0, Math.sin(am)]);
  }

  const m = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  const beams: THREE.Matrix4[] = [];
  for (let k = 0; k < HALL_SIDES; k += 1) {
    const s = sideBasis(k);
    q0.setFromAxisAngle(axis, Math.PI / 2 - s.angle);
    m.compose(v.set(s.center[0] * 0.5, H - 0.7, s.center[2] * 0.5), q0, sc.set(1.6, 0.95, HALL_RADIUS));
    beams.push(m.clone());
  }
  for (let k = 0; k < HALL_SIDES; k += 1) {
    const a = (Math.PI * 2 * (k + 0.5)) / HALL_SIDES;
    q0.setFromAxisAngle(axis, Math.PI / 2 - a);
    m.compose(v.set(Math.cos(a) * Rc * 0.6, H - 1.6, Math.sin(a) * Rc * 0.6), q0, sc.set(Rc * 0.42, 0.5, 0.7));
    beams.push(m.clone());
  }

  return {
    floor: bFloor.toGeometry(),
    walls: bWalls.toGeometry(),
    muralPanels: bMural.toGeometry(),
    muralFaces,
    ceiling: bCeil.toGeometry(),
    coffer: bCoffer.toGeometry(),
    frames: bFrame.toGeometry(),
    beams,
    doors,
    stats: {
      sides: HALL_SIDES,
      doors: doors.length,
      murals: muralFaces.length,
      ceilingBeams: beams.length,
      radius: HALL_RADIUS,
      height: H,
    },
  };
}

/** 台面逐三角角色：扇区可拾取，中心罗盘那圈 ref = −1 不拾取 */
export const DESK_FACE = { sector: 0 } as const;

export interface BuiltDesk {
  body: THREE.BufferGeometry;
  top: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  /** 逐三角：DESK_SECTORS 下标，−1 = 不可拾取 */
  triSector: number[];
  sectors: Array<{ key: Discipline; am: number; a0: number; a1: number }>;
}

export interface BuiltCases {
  body: THREE.BufferGeometry;
  hood: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  /** 逐三角：柜序（= ROOMS 下标），命中即知是哪一区的展柜 */
  triRef: number[];
  /** 每座的柜心（世界 xz）与门向 */
  stands: Array<{ key: Discipline; angle: number; x: number; z: number }>;
  triangles: number;
}

export interface BuiltAtrium {
  desk: BuiltDesk;
  cases: BuiltCases;
}

/**
 * 批 12：中央索引台（八角台体 + 台沿灯带 + 十六三角扇区台面）与六座低位展柜。
 * 台面扇区不做手调——16 个三角按「离哪条走廊最近」归属，与 walk/atlas 共用 DESK_SECTORS，
 * 所以「扇区角度 = 走廊角度」是构造出来的恒等式，不是对齐出来的近似值。
 */
export function buildAtrium(): BuiltAtrium {
  const topR = ATRIUM.deskTopR;
  const inR = topR * Math.cos(Math.PI / 8);
  // 八角台的边心距：面法线在 π/4 的整数倍上，任意方位角到最近面法线的偏差决定半径
  const rimR = (a: number): number => {
    const dev = a - (Math.PI / 4) * Math.round(a / (Math.PI / 4));
    return inR / Math.cos(dev);
  };
  const pt = (a: number, r: number, y: number): Vec3 => [Math.cos(a) * r, y, Math.sin(a) * r];
  const uvOf = (p: Vec3): [number, number] => [(p[0] + topR) / (2 * topR), 1 - (p[2] + topR) / (2 * topR)];

  const bBody = new GeoBuilder();
  const bTop = new GeoBuilder();
  const bBand = new GeoBuilder();
  const h = ATRIUM.deskTopY;
  const slabY = ATRIUM.deskSlabY;
  for (let k = 0; k < ATRIUM.deskSides; k += 1) {
    const a = ((Math.PI * 2) / ATRIUM.deskSides) * k;
    const n: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const c0 = a - Math.PI / 8;
    const c1 = a + Math.PI / 8;
    const R = ATRIUM.deskR;
    bBody.quad(pt(c0, R, 0), pt(c1, R, 0), pt(c1, R, slabY), pt(c0, R, slabY), [0, 0, 1, 1], n);
    bBand.quad(
      pt(c0, ATRIUM.bandR, ATRIUM.bandY0),
      pt(c1, ATRIUM.bandR, ATRIUM.bandY0),
      pt(c1, ATRIUM.bandR, ATRIUM.bandY1),
      pt(c0, ATRIUM.bandR, ATRIUM.bandY1),
      [0, 0, 1, 1],
      n,
    );
    // 台面板出檐：沿口那一圈立面
    bBody.quad(
      pt(c0, topR, slabY),
      pt(c1, topR, slabY),
      pt(c1, topR, h),
      pt(c0, topR, h),
      [0, 0, 1, 1],
      n,
    );
  }
  // 台面：16 个三角，环点正落在八角的「面心 + 顶点」上，链段仍在台体边上，不额外鼓出
  const triSector: number[] = [];
  const step = (Math.PI * 2) / 16;
  for (let k = 0; k < 16; k += 1) {
    const a0 = step * k;
    const a1 = step * (k + 1);
    const p = pt(a0, rimR(a0), h);
    const q = pt(a1, rimR(a1), h);
    const u0 = uvOf(p);
    const u1 = uvOf(q);
    bTop.tri([0, h, 0], p, q, [0.5, 0.5, u0[0], u0[1], u1[0], u1[1]], UP, DESK_FACE.sector, sectorOf(a0 + step / 2));
    triSector.push(sectorOf(a0 + step / 2));
  }

  const bCase = new GeoBuilder();
  const bHood = new GeoBuilder();
  const bLamp = new GeoBuilder();
  const stands: BuiltCases['stands'] = [];
  const W = ATRIUM.caseW;
  const D = ATRIUM.caseD;
  ROOMS.forEach((r, idx) => {
    const a = r.angle;
    const rad: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    const tan: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
    const cx = rad[0] * ATRIUM.caseR + tan[0] * ATRIUM.caseLean;
    const cz = rad[2] * ATRIUM.caseR + tan[2] * ATRIUM.caseLean;
    const c: Vec3 = [cx, 0, cz];
    // 实心柜体 + 台面石板（石板出一檐，罩子坐在石板上）；ref = 区序号，命中即知是哪一区
    bCase.slab([c[0], ATRIUM.caseBodyH / 2, c[2]], tan, UP, rad, W / 2, ATRIUM.caseBodyH / 2, D / 2, TILE.shelf, idx);
    const lip = 0.14;
    bCase.slab(
      [c[0], (ATRIUM.caseBodyH + ATRIUM.caseTopY) / 2, c[2]],
      tan, UP, rad, W / 2 + lip, (ATRIUM.caseTopY - ATRIUM.caseBodyH) / 2, D / 2 + lip, TILE.trim, idx,
    );
    // 亚克力罩：从台面向上 0.78，四面 + 顶
    const hy0 = ATRIUM.caseTopY;
    const hy1 = ATRIUM.hoodTopY;
    const hm = (hy1 - hy0) / 2;
    const hc: Vec3 = [c[0], hy0 + hm, c[2]];
    bHood.slab(hc, tan, UP, rad, W / 2 - 0.06, hm, D / 2 - 0.06, 1, idx);
    // 罩顶一盏极小的射灯（自发光盒，不占灯光预算）
    bLamp.slab(
      [c[0], hy1 + 0.07, c[2]], tan, UP, rad, 0.46, 0.07, 0.24, TILE.trim, idx,
    );
    stands.push({ key: r.key, angle: a, x: cx, z: cz });
  });

  return {
    desk: {
      body: bBody.toGeometry(),
      top: bTop.toGeometry(),
      band: bBand.toGeometry(),
      triSector,
      sectors: DESK_SECTORS.map((s) => ({ key: s.key, am: s.am, a0: s.a0, a1: s.a1 })),
    },
    cases: {
      body: bCase.toGeometry(),
      hood: bHood.toGeometry(),
      lamp: bLamp.toGeometry(),
      triRef: [...bCase.ref],
      stands,
      triangles: bCase.faces + bHood.faces + bLamp.faces,
    },
  };
}

function sectorOf(a: number): number {
  const i = DESK_SECTORS.findIndex((s) => inArc(a, s.a0, s.a1));
  return i < 0 ? -1 : i;
}

/** 角度 a 是否落在从 a0 逆时针到 a1 的弧内（a0/a1 已按递增排好，跨过 ±π 时补一个周期） */
function inArc(a: number, a0: number, a1: number): boolean {
  const t = (x: number): number => {
    let v = x;
    while (v < a0) v += Math.PI * 2;
    while (v >= a0 + Math.PI * 2) v -= Math.PI * 2;
    return v;
  };
  const x = t(a);
  return x >= t(a0) && x < t(a1);
}

// ---------------------------------------------------------------- 走廊

export interface BuiltCorridor {
  floor: THREE.BufferGeometry;
  shell: THREE.BufferGeometry;
  length: number;
  plate: { center: Vec3; angle: number; width: number; depth: number };
}

/**
 * 走廊管：地面 + 两侧墙 + 顶面 + 端头梁，从八角厅门洞外沿一直铺到阅览室门前。
 * 侧墙法线朝走廊中线，大厅俯视时外表面被背面剔除，地面依旧看得见。
 */
export function buildCorridor(angle: number, from: number, to: number, roomSide: number): BuiltCorridor {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const px = -dz;
  const pz = dx;
  const bFloor = new GeoBuilder();
  const b = new GeoBuilder();
  const r0 = from;
  const r1 = Math.max(from + 6, to - roomSide / 2 - 0.5);
  const hw = CORRIDOR_W / 2;
  const yTop = CORRIDOR_H;
  const at = (r: number, off: number, y: number): Vec3 => [dx * r + px * off, y, dz * r + pz * off];

  bFloor.quad(at(r0, -hw, 0.03), at(r1, -hw, 0.03), at(r1, hw, 0.03), at(r0, hw, 0.03),
    [r0 / TILE.floor, -hw / TILE.floor, r1 / TILE.floor, hw / TILE.floor], UP);
  b.quad(at(r0, -hw, 0), at(r1, -hw, 0), at(r1, -hw, yTop), at(r0, -hw, yTop),
    [r0 / TILE.wall, 0, r1 / TILE.wall, yTop / TILE.wall], [px, 0, pz]);
  b.quad(at(r0, hw, 0), at(r1, hw, 0), at(r1, hw, yTop), at(r0, hw, yTop),
    [r0 / TILE.wall, 0, r1 / TILE.wall, yTop / TILE.wall], [-px, 0, -pz]);
  b.quad(at(r0, -hw, yTop), at(r1, -hw, yTop), at(r1, hw, yTop), at(r0, hw, yTop),
    [r0 / TILE.ceiling, -hw / TILE.ceiling, r1 / TILE.ceiling, hw / TILE.ceiling], [0, -1, 0]);
  for (const r of [r0, (r0 + r1) / 2, r1]) {
    b.slab([dx * r, yTop - 0.45, dz * r], [px, 0, pz], UP, [dx, 0, dz], hw, 0.45, 0.4, TILE.trim);
  }
  return {
    floor: bFloor.toGeometry(),
    shell: b.toGeometry(),
    length: r1 - r0,
    plate: { center: [dx * (r0 + r1) / 2, 0.07, dz * (r0 + r1) / 2], angle, width: r1 - r0, depth: hw * 2 },
  };
}

/** InstancedMesh 用的单位盒（天花梁、吊灯臂） */
export function unitBox(): THREE.BufferGeometry {
  return new GeoBuilder().slab([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.5, 0.5, 0.5, 1).toGeometry();
}
