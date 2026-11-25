import type { Discipline, SiteEntry } from './types';

export interface CameraPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface Selection {
  discipline: Discipline | null;
  book: SiteEntry | null;
}

interface Persisted {
  view: 'hall' | 'room';
  room: Discipline | null;
  hallCamera: CameraPose | null;
  roomCameras: Partial<Record<Discipline, CameraPose>>;
  selection: Selection;
  /** 2D 降级视图的平移量 */
  flatPan: { x: number; y: number; zoom: number };
}

const KEY = 'zhishu.matrix.state.v1';

const initial: Persisted = {
  view: 'hall',
  room: null,
  hallCamera: null,
  roomCameras: {},
  selection: { discipline: null, book: null },
  flatPan: { x: 0, y: 0, zoom: 1 },
};

let state: Persisted = load();
const listeners = new Set<() => void>();

function load(): Persisted {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...initial };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      ...initial,
      ...parsed,
      roomCameras: parsed.roomCameras ?? {},
      selection: parsed.selection ?? initial.selection,
      flatPan: parsed.flatPan ?? initial.flatPan,
    };
  } catch {
    return { ...initial };
  }
}

function save(): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式写不进去不影响功能 */
  }
}

export const store = {
  get snapshot(): Persisted {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(): void {
    listeners.forEach((fn) => fn());
  },
  setView(view: Persisted['view'], room: Discipline | null = null): void {
    state.view = view;
    state.room = room;
    save();
    this.emit();
  },
  setHallCamera(pose: CameraPose): void {
    state.hallCamera = pose;
    save();
  },
  setRoomCamera(room: Discipline, pose: CameraPose): void {
    state.roomCameras[room] = pose;
    save();
  },
  setSelection(sel: Partial<Selection>): void {
    state.selection = { ...state.selection, ...sel };
    save();
    this.emit();
  },
  setFlatPan(pan: Partial<Persisted['flatPan']>): void {
    state.flatPan = { ...state.flatPan, ...pan };
    save();
  },
  reset(): void {
    state = { ...initial, roomCameras: {} };
    save();
    this.emit();
  },
};
