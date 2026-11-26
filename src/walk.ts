/**
 * 批 11：第一人称漫游的碰撞体与滑动解算。纯数学、不碰渲染——
 * 输入是 layout / architecture 已经落好的结构常量与房间布置，输出是世界空间的 OBB 列表。
 *
 * 为什么是 OBB 而不是 AABB：阅览室绕 Y 转了 `π/2 − angle`（pitfalls 31），六个区的墙与书架
 * 在世界空间里全是斜的。斜墙若按轴对齐包围盒算，门洞会被盒角糊住、贴墙走会撞在假墙角上。
 * 这里的盒子只绕 Y 转，所以 xz 平面内一次旋转就能把点换进盒子的局部系，
 * 解完再换回来——等价于「每个房间自己的坐标系里做 AABB」。
 */
import * as THREE from 'three';
import {
  ATRIUM,
  CORRIDOR_W,
  DOOR_W,
  FACADE_SIDE,
  HALL_RADIUS,
  HALL_SIDES,
  ROOMS,
  ROOM_DIST,
  SHELF_DEPTH,
  WALL_T,
  WALK,
} from './config';
import { ROOM_DOOR } from './architecture';
import type { RoomPlan } from './layout';

/** 不设顶：外墙若给有限高度，跳跃（或将来加跳）就从盒顶绕出去了 */
const OPEN_TOP = 1e6;
const CORRIDOR_HW = CORRIDOR_W / 2;

export interface Blocker {
  /** 盒心（世界 xz） */
  cx: number;
  cz: number;
  /** 局部轴向半幅：hx 沿盒子本地 x、hz 沿本地 z（本地 z = 绕 yaw 后的朝向） */
  hx: number;
  hz: number;
  /** 绕 Y 的朝向（弧度）：局部 z 轴 → (sin yaw, cos yaw) */
  yaw: number;
  /** 竖直占带（世界 y）：[y0,y1] 与人体柱相交才算挡住 */
  y0: number;
  y1: number;
  /** 只对账用：是哪一类结构 */
  kind:
    | 'hallWall'
    | 'hallDoorJamb'
    | 'corridorWall'
    | 'corridorEnd'
    | 'facade'
    | 'roomWall'
    | 'doorJamb'
    | 'shelf'
    | 'indexDesk'
    | 'displayCase';
  /**
   * 批 12 索引台是圆柱（任务书口径「半径 4 的圆柱」），八角台体用它正好，
   * 不必再拿一串 OBB 去拼圆——拼出来的并集在角上外扩 1.4 单位，是堵看不见的墙。
   * `shape:'cyl'` 时 hx = 半径，hz / yaw 不参与计算。
   */
  shape?: 'box' | 'cyl';
}

export interface CorridorAxis {
  angle: number;
  /** 近大厅端（含八角墙厚） */
  from: number;
  /** 近阅览室端 */
  to: number;
}

function along(angle: number, r: number): [number, number] {
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

/** 走廊两侧墙 + 可选的「大厅那头封墙」（进区漫游时大厅是隐藏的，管口必须封住） */
export function corridorBlockers(
  axis: CorridorAxis,
  opts: { sealHallEnd: boolean; facadeFrom?: number },
): Blocker[] {
  const a = axis.angle;
  // 盒子的本地 z 要顺着走廊方向：本地 z → (sin yaw, cos yaw)，取 yaw = π/2 − a 正好等于 (cos a, sin a)
  const yaw = Math.PI / 2 - a;
  const dir: [number, number] = [Math.cos(a), Math.sin(a)];
  const perp: [number, number] = [-Math.sin(a), Math.cos(a)];
  const r0 = axis.from;
  const r1 = opts.facadeFrom ?? axis.to;
  const mid = (r0 + r1) / 2;
  const out: Blocker[] = [];
  for (const s of [-1, 1]) {
    const [ox, oz] = perp.map((v) => v * s * CORRIDOR_HW) as [number, number];
    out.push({
      cx: dir[0] * mid + ox,
      cz: dir[1] * mid + oz,
      hx: WALL_T / 2,
      hz: (r1 - r0) / 2,
      yaw,
      y0: 0,
      y1: OPEN_TOP,
      kind: 'corridorWall',
    });
  }
  if (opts.sealHallEnd) {
    out.push({
      cx: dir[0] * r0,
      cz: dir[1] * r0,
      hx: CORRIDOR_HW,
      hz: WALL_T / 2,
      yaw,
      y0: 0,
      y1: OPEN_TOP,
      kind: 'corridorEnd',
    });
  }
  return out;
}

/**
 * 八角厅：八边壳（六面开门、两面实墙）+ 六条走廊 + 六栋体量外壳。
 * 门洞两侧各留一截墙、门楣那段不算——人在 1.65 的眼高上不会撞上门楣，
 * 而把它算进去就等于把门封了一半。
 */
export function hallBlockers(corridors: CorridorAxis[]): Blocker[] {
  const out: Blocker[] = [];
  const doorSet = new Set(ROOMS.map((r) => norm(r.angle)));
  const half = HALL_RADIUS * Math.tan(Math.PI / HALL_SIDES);
  const dw = DOOR_W / 2;
  for (let k = 0; k < HALL_SIDES; k += 1) {
    const a = (Math.PI * 2 * k) / HALL_SIDES;
    // 盒子的长轴是本地 z，映射到世界是 (sin yaw, cos yaw)；边切线方向 dir = (−sin a, cos a)，
    // 两者对齐要取 yaw = −a。取 +a 会把这截墙转成一根**径向鳍**——除 0°/180° 两边外，
    // 六面墙全部横过来：实墙那边整面漏人（实测 −135° 一路走到 130 单位），门口却提前 5 单位撞鳍。
    const yaw = -a;
    const dir: [number, number] = [-Math.sin(a), Math.cos(a)];
    const center = along(a, HALL_RADIUS);
    // 段与段在顶点处**搭接** 1.2：正好首尾相接的两块膨胀盒，角上会留一个楔形缺口，
    // 沿径向走过去会被最小穿透轴推出到墙外（实测 23° 方向翻到 128 单位开外）。
    const spans: Array<[number, number, Blocker['kind']]> = doorSet.has(norm(a))
      ? [[-half - 1.2, -dw, 'hallDoorJamb'], [dw, half + 1.2, 'hallDoorJamb']]
      : [[-half - 1.2, half + 1.2, 'hallWall']];
    for (const [t0, t1, kind] of spans) {
      const mid = (t0 + t1) / 2;
      out.push({
        cx: center[0] + dir[0] * mid,
        cz: center[1] + dir[1] * mid,
        hx: WALL_T / 2,
        hz: (t1 - t0) / 2,
        yaw,
        y0: 0,
        y1: OPEN_TOP,
        kind,
      });
    }
  }
  const facadeFrom = ROOM_DIST - FACADE_SIDE / 2;
  for (const axis of corridors) {
    out.push(...corridorBlockers(axis, { sealHallEnd: false, facadeFrom }));
  }
  // 六栋体量外壳是实心盒：走廊尽头就是它，「走到房间门口」= 被这面墙挡在门口
  for (const r of ROOMS) out.push({
    cx: r.at[0],
    cz: r.at[1],
    hx: FACADE_SIDE / 2,
    hz: FACADE_SIDE / 2,
    yaw: 0,
    y0: 0,
    y1: OPEN_TOP,
    kind: 'facade',
  });
  out.push(...atriumBlockers());
  return out;
}

/**
 * 批 12 中央内容：索引台（半径 4 的圆柱）+ 六座展柜。
 * 展柜沿切向偏开 `caseLean`，为的是「中心→门洞」那条直线仍走得通：净宽 3 的柜体
 * 加人体半径要 1.95 才不贴身，偏 3.7 之后直线余量 1.75；同时柜体在 25 单位 sight 视锥内
 * 仍能被打到（详见 docs/design.md 十六）。柜高 1.94，不设顶。
 */
export function atriumBlockers(): Blocker[] {
  const out: Blocker[] = [
    {
      cx: 0,
      cz: 0,
      hx: ATRIUM.deskR,
      hz: 0,
      yaw: 0,
      y0: 0,
      y1: OPEN_TOP,
      kind: 'indexDesk',
      shape: 'cyl',
    },
  ];
  for (const r of ROOMS) {
    const a = r.angle;
    const [tx, tz] = [-Math.sin(a), Math.cos(a)];
    out.push({
      cx: Math.cos(a) * ATRIUM.caseR + tx * ATRIUM.caseLean,
      cz: Math.sin(a) * ATRIUM.caseR + tz * ATRIUM.caseLean,
      hx: ATRIUM.caseD / 2,
      hz: ATRIUM.caseW / 2,
      yaw: -a,
      y0: 0,
      y1: OPEN_TOP,
      kind: 'displayCase',
    });
  }
  return out;
}

/**
 * 阅览室：四面外墙（正门那面按 7.2 门洞拆成两段）+ 三面书架整排。
 * 全部在 room-local 里量好，再按 `room.position` / `room.rotation.y` 换到世界——
 * 与 buildRoomShell、buildShelves 用的是同一批数（side / SHELF_DEPTH / row.length），
 * 不另立一套尺寸，否则「看得见穿模、算不出碰撞」。
 */
export function roomBlockers(plan: RoomPlan, pos: THREE.Vector3, yawRoom: number, corridor: CorridorAxis): Blocker[] {
  const S = plan.side;
  const H = plan.height;
  const half = S / 2;
  const dw = Math.min(ROOM_DOOR.w, S - 2) / 2;
  const cos = Math.cos(yawRoom);
  const sin = Math.sin(yawRoom);
  // three 绕 Y 转 θ：局部 (x,z) → 世界 (x·cosθ + z·sinθ, −x·sinθ + z·cosθ)
  const toWorld = (lx: number, lz: number): [number, number] => [
    pos.x + lx * cos + lz * sin,
    pos.z - lx * sin + lz * cos,
  ];
  const push = (
    lx: number, lz: number, hx: number, hz: number, y1: number, kind: Blocker['kind'],
  ): void => {
    const [cx, cz] = toWorld(lx, lz);
    out.push({ cx, cz, hx, hz, yaw: yawRoom, y0: 0, y1, kind });
  };
  const out: Blocker[] = [];
  const h = WALL_T / 2;
  // 转角搭接：正好相接的膨胀盒在角上留楔形缺口，斜着走会被推出到墙外（同 hallBlockers）
  const seal = 0.6;
  // 左 / 右：本地 x = ∓half，沿 z 通长
  push(-half, 0, h, half + seal, OPEN_TOP, 'roomWall');
  push(half, 0, h, half + seal, OPEN_TOP, 'roomWall');
  // 后墙（本地 +Z）通长
  push(0, half, half + seal, h, OPEN_TOP, 'roomWall');
  // 正门墙（本地 −Z）拆两段，中间 7.2 的门洞留着走得过去
  push(-(half + dw) / 2, -half, (half - dw) / 2 + seal, h, OPEN_TOP, 'roomWall');
  push((half + dw) / 2, -half, (half - dw) / 2 + seal, h, OPEN_TOP, 'roomWall');
  const jambH = Math.min(ROOM_DOOR.h, H - 1.2);
  push(-dw - 0.32, -half + 0.12, 0.32, 0.5, jambH, 'doorJamb');
  push(dw + 0.32, -half + 0.12, 0.32, 0.5, jambH, 'doorJamb');

  for (const row of plan.rows) {
    const top = (row.boardY[row.boardY.length - 1] ?? 0) + row.pitch + 1.8;
    // row.x/row.z 是 room-local 的架心；盒子沿 row.dir 通长、沿 row.normal 一个进深，
    // 横板 + 背板 + 侧板 + 分隔板的整体外包——人都 1.65 的眼高站进去了就是穿模，
    // 所以按整排实心算，而不是逐块板算。
    const d: [number, number] = row.dir;
    const [cx, cz] = toWorld(row.x, row.z);
    out.push({
      cx,
      cz,
      hx: SHELF_DEPTH / 2,
      hz: row.length / 2,
      yaw: yawRoom + Math.atan2(d[0], d[1]),
      y0: 0,
      y1: top,
      kind: 'shelf',
    });
  }
  out.push(...corridorBlockers(corridor, { sealHallEnd: true }));
  return out;
}

/**
 * 圆柱（半径 r）与一批 OBB 的滑动解算：把中心推进盒子的「膨胀体」（各轴 +r）之外，
 * 只沿穿透浅的那根轴推——另一个分量原样保留，贴墙走就顺着墙滑走了。
 * 返回本次是否发生推动，供「未卡死」判定读。
 */
export function resolveSlide(
  at: THREE.Vector3,
  blockers: Blocker[],
  r = WALK.radius,
  stand = WALK.stand,
  prev?: THREE.Vector3,
  hint?: [number, number],
): { hits: number; pushed: THREE.Vector2; kinds: string[] } {
  const feet = at.y - WALK.eye;
  const head = at.y + (stand - WALK.eye);
  let hits = 0;
  const pushed = new THREE.Vector2(0, 0);
  const kinds: string[] = [];
  // 两趟：第一趟推完可能顶进邻居，第二趟收尾。斜房转角处一趟会留 ~0.1 的残穿
  for (let pass = 0; pass < 2; pass += 1) {
    let any = false;
    for (const b of blockers) {
      if (b.y1 <= feet || b.y0 >= head) continue;
      const dx = at.x - b.cx;
      const dz = at.z - b.cz;
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      if (b.shape === 'cyl') {
        const len = Math.hypot(dx, dz);
        const pen = b.hx + r - len;
        if (pen <= 0) continue;
        any = true;
        hits += 1;
        if (!kinds.includes(b.kind)) kinds.push(b.kind);
        // 站在轴心上没有「外侧」可依，按来人方向 / 落位朝向退出，否则每次刷新换个方向抖
        let ux = len > 1e-6 ? dx / len : 0;
        let uz = len > 1e-6 ? dz / len : 0;
        if (len <= 1e-6) {
          const hx = hint ? hint[0] : prev ? at.x - prev.x : 0;
          const hz = hint ? hint[1] : prev ? at.z - prev.z : 0;
          const hl = Math.hypot(hx, hz);
          if (hl > 1e-6) {
            ux = hx / hl;
            uz = hz / hl;
          } else {
            ux = 0;
            uz = 1;
          }
        }
        pushed.x += ux * pen;
        pushed.y += uz * pen;
        at.x += ux * pen;
        at.z += uz * pen;
        continue;
      }
      let lx = dx * c - dz * s;
      let lz = dx * s + dz * c;
      const ox = b.hx + r - Math.abs(lx);
      const oz = b.hz + r - Math.abs(lz);
      if (ox <= 0 || oz <= 0) continue;
      any = true;
      hits += 1;
      if (!kinds.includes(b.kind)) kinds.push(b.kind);
      // 推出方向按**上一帧从哪一面进**定，不按「当前在哪一侧」定：薄墙（0.6 厚）斜着撞上去时，
      // 按当前侧算会把人翻到墙外侧——实测厅角 190° 方向被抛到 63 单位开外，人从八角厅里漏出去了。
      let axis: 'x' | 'z' = ox < oz ? 'x' : 'z';
      let side = Math.sign(axis === 'x' ? lx || 1 : lz || 1);
      if (prev) {
        const pdx = prev.x - b.cx;
        const pdz = prev.z - b.cz;
        const plx = pdx * c - pdz * s;
        const plz = pdx * s + pdz * c;
        const outX = Math.abs(plx) >= b.hx + r;
        const outZ = Math.abs(plz) >= b.hz + r;
        if (outX || outZ) {
          if (outX && !outZ) {
            axis = 'x';
            side = Math.sign(plx);
          } else if (outZ && !outX) {
            axis = 'z';
            side = Math.sign(plz);
          } else {
            axis = ox < oz ? 'x' : 'z';
            side = axis === 'x' ? Math.sign(plx) : Math.sign(plz);
          }
        }
      }
      if (axis === 'x') {
        const want = side * (b.hx + r);
        pushed.x += (want - lx) * c;
        pushed.y -= (want - lx) * s;
        at.x += (want - lx) * c;
        at.z -= (want - lx) * s;
        lx = want;
      } else {
        const want = side * (b.hz + r);
        pushed.x += (want - lz) * s;
        pushed.y += (want - lz) * c;
        at.x += (want - lz) * s;
        at.z += (want - lz) * c;
        lz = want;
      }
    }
    if (!any) break;
  }
  return { hits, pushed, kinds };
}

/** 圆柱表面到最近障碍面的距离（负数 = 已穿进膨胀体）。贴墙断言读这个 */
export function wallGap(at: THREE.Vector3, blockers: Blocker[], r = WALK.radius): number {
  let best = Number.POSITIVE_INFINITY;
  for (const b of blockers) {
    if (b.y1 <= at.y - WALK.eye || b.y0 >= at.y + (WALK.stand - WALK.eye)) continue;
    const dx = at.x - b.cx;
    const dz = at.z - b.cz;
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    if (b.shape === 'cyl') {
      const d = Math.hypot(dx, dz) - b.hx - r;
      if (d < best) best = d;
      continue;
    }
    const lx = Math.abs(dx * c - dz * s) - b.hx;
    const lz = Math.abs(dx * s + dz * c) - b.hz;
    const ox = Math.max(lx, 0);
    const oz = Math.max(lz, 0);
    const d = (ox > 0 && oz > 0 ? Math.hypot(ox, oz) : Math.max(ox, oz)) - r;
    if (d < best) best = d;
  }
  return best;
}

/** 把点拉回可行走区（进入 walk 时的落位保险）；`dir` = 落位朝向，轴心退化时按它退出 */
export function settle(at: THREE.Vector3, blockers: Blocker[], dir?: [number, number]): void {
  resolveSlide(at, blockers, WALK.radius, WALK.stand, undefined, dir);
}

function norm(a: number): number {
  return Number((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(6));
}
