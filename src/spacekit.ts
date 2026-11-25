/**
 * 批 7 渲染层装配：程序化贴图、几何形态、灯光与后期链。
 * 铁律 2「零外部资产」在本节的具体含义——所有贴图都由 canvas 现画，环境光照由 PMREM 现烘，
 * 一个 .hdr / .glb / .ktx2 / .png 都不落地；这里出现的 MeshBasicMaterial 只服务于
 * 「环境球与自造光源面板」，它们属于生成 env 的中间场景，不进主场景、不参与主场景统计。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FLOOR, ROOMS } from './config';
import type { ColumnKind, PodiumKind } from './config';

/** 立柱形态：一律「单位高、底面落在 y=0、截面半径为世界单位」，实例矩阵只做 Y 缩放 */
export function columnGeometry(kind: ColumnKind): THREE.BufferGeometry {
  switch (kind) {
    case 'hexPrism':
      return capped(cylinder(0.78, 0.9, 6));
    case 'coneTower':
      // 化学：锥形塔——下粗上细，顶部再外翻一圈，读作蒸馏塔与锥形瓶
      return lathe(
        [
          [0.02, 0],
          [0.98, 0],
          [0.92, 0.1],
          [0.64, 0.52],
          [0.34, 0.82],
          [0.44, 0.93],
          [0.38, 1],
          [0.02, 1],
        ],
        10,
      );
    case 'boxPillar': {
      // 计算机：方柱，比特块与机柜
      const g = new THREE.BoxGeometry(1.45, 1, 1.45);
      g.translate(0, 0.5, 0);
      return g;
    }
    case 'stackedDrum':
      // 通识：叠层柱，三段鼓叠起来
      return lathe(
        [
          [0.02, 0],
          [0.86, 0],
          [0.86, 0.3],
          [0.58, 0.3],
          [0.58, 0.38],
          [0.9, 0.38],
          [0.9, 0.66],
          [0.6, 0.66],
          [0.6, 0.74],
          [0.78, 0.74],
          [0.78, 0.98],
          [0.02, 0.98],
        ],
        8,
      );
    case 'ringColumn':
      // 工具间：环柱， shaft 上两道凸环，读作刻度与垫圈
      return lathe(
        [
          [0.02, 0],
          [0.74, 0],
          [0.62, 0.08],
          [0.62, 0.26],
          [0.94, 0.32],
          [0.62, 0.38],
          [0.62, 0.6],
          [0.9, 0.66],
          [0.58, 0.72],
          [0.58, 0.94],
          [0.74, 1],
          [0.02, 1],
        ],
        8,
      );
    case 'cylinder':
    default:
      // 数学：十二段圆柱，连续与极限
      return capped(cylinder(0.7, 0.86, 12));
  }
}

/** 展台底座：盘 / 阶 / 环三种堆叠，与立柱同一学科同一种语言 */
export function podiumGeometry(kind: PodiumKind): THREE.BufferGeometry {
  const profiles: Record<PodiumKind, Array<[number, number]>> = {
    disc: [
      [0.02, 0],
      [10.4, 0],
      [10.4, 0.58],
      [8.6, 1.1],
      [0.02, 1.1],
    ],
    step: [
      [0.02, 0],
      [10.6, 0],
      [10.6, 0.38],
      [8.6, 0.38],
      [8.6, 0.74],
      [6.8, 0.74],
      [6.8, 1.1],
      [0.02, 1.1],
    ],
    ring: [
      [0.02, 0],
      [10.2, 0],
      [10.2, 0.42],
      [7.8, 0.42],
      [7.8, 0.72],
      [10.4, 0.72],
      [10.4, 1.08],
      [0.02, 1.08],
    ],
  };
  return lathe(profiles[kind], 14);
}

/**
 * 大厅地面：1,040 世界单位摊满一张 1024px 贴图，网格每格 26 单位（=展台间距），
 * 每四格一道粗线，外加一层径向衰减把边缘压暗——取代原来的 GridHelper 线框。
 * 画的是反照率（比 FLOOR 亮一档），落地亮度由光强决定：Standard 漫反射 ≈ albedo × irradiance / π，
 * 直接照 FLOOR 的色值进贴图会被压成纯黑。
 */
export function groundTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  ctx.fillStyle = albedo(FLOOR, 15);
  ctx.fillRect(0, 0, size, size);
  const cell = size / 40;
  ctx.strokeStyle = 'rgba(150, 168, 200, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 40; i += 1) {
    const p = Math.round(i * cell) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180, 200, 235, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 10; i += 1) {
    const p = Math.round(i * cell * 4) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  vignette.addColorStop(0, 'rgba(210, 224, 248, 0.2)');
  vignette.addColorStop(0.55, 'rgba(90, 105, 140, 0.06)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.78)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.procedural = true;
  return tex;
}

/** 房间地面：同心环 + 24 道辐条 + 中心学科色辉光，圆盘的极坐标 UV 下不会歪 */
export function discTexture(color: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  const c = size / 2;
  ctx.fillStyle = albedo(FLOOR, 19);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(160, 180, 214, 0.3)';
  ctx.lineWidth = 1.5;
  for (let r = 1; r <= 8; r += 1) {
    ctx.beginPath();
    ctx.arc(c, c, (r / 8) * (c - 4), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120, 140, 178, 0.14)';
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 18, c + Math.sin(a) * 18);
    ctx.lineTo(c + Math.cos(a) * (c - 4), c + Math.sin(a) * (c - 4));
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, `${color}55`);
  glow.addColorStop(0.45, `${color}1a`);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.procedural = true;
  return tex;
}

/** 概念光点：一张 64px 径向渐变，核心亮、外圈收得干净，全部光点共用这一张 */
export function glowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  g.addColorStop(0.16, 'rgba(255, 255, 255, 0.5)');
  g.addColorStop(0.38, 'rgba(255, 255, 255, 0.14)');
  g.addColorStop(0.7, 'rgba(255, 255, 255, 0.03)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.procedural = true;
  return tex;
}

export interface EnvironmentBundle {
  texture: THREE.Texture;
  target: THREE.WebGLRenderTarget;
  source: THREE.Texture;
}

/**
 * 环境反射：等距柱状渐变 + 六区学科色斑（canvas 现画）→ PMREMGenerator 预滤波 → scene.environment。
 * 返回三条句柄：PMREM 产物、它背后的 render target、以及用作输入的渐变图，dispose 时逐个还。
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): EnvironmentBundle {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#31406b');
  sky.addColorStop(0.4, '#1a2440');
  sky.addColorStop(0.52, '#0d1017');
  sky.addColorStop(1, '#05060a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);
  // 六个学科色光斑贴在地平线带上，方位沿用大厅里各区的实际朝向
  ROOMS.forEach((r) => {
    const az = Math.atan2(-r.at[1], r.at[0]);
    const u = (az / (Math.PI * 2) + 0.5) * 512;
    const blob = ctx.createRadialGradient(u, 132, 0, u, 132, 62);
    blob.addColorStop(0, `${r.color}aa`);
    blob.addColorStop(0.6, `${r.color}33`);
    blob.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = blob;
    ctx.fillRect(u - 70, 60, 140, 140);
  });
  const source = new THREE.CanvasTexture(canvas);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(source);
  pmrem.dispose();
  source.userData.procedural = true;
  target.texture.userData.pmrem = true;
  return { texture: target.texture, target, source };
}

export interface LightRig {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  zones: THREE.PointLight[];
}

/** 天/地双色环境光 + 一盏投影主光 + 六个学科区各一盏带衰减的学科色点光 */
export function buildLightRig(): LightRig {
  const hemi = new THREE.HemisphereLight(0x9fb4de, 0x141a24, 0.42);
  hemi.position.set(0, 400, 0);
  const key = new THREE.DirectionalLight(0xfff1dc, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.35;
  const zones = ROOMS.map((r) => {
    const light = new THREE.PointLight(new THREE.Color(r.color).getHex(), 900, 240, 2);
    light.position.set(r.at[0], 46, r.at[1]);
    return light;
  });
  return { hemi, key, zones };
}

export interface PostChain {
  composer: EffectComposer;
  render: RenderPass;
  bloom: UnrealBloomPass;
  output: OutputPass;
}

/** Bloom 取值：threshold 0.55 让只有光点与信标过曝、标定后的地面不过；strength/radius 由 tune_batch7 网格定 */
export function buildPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): PostChain {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.55, 0.55);
  const output = new OutputPass();
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(output);
  return { composer, render, bloom, output };
}

/** 反照率：把配置里的最终色抬亮成「贴图该写的颜色」，最终画面亮度交给光强标定 */
function albedo(hex: string, lift: number): string {
  return `#${new THREE.Color(hex).multiplyScalar(lift).getHexString()}`;
}

function lathe(profile: Array<[number, number]>, segments: number): THREE.LatheGeometry {  return new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(Math.max(0.02, radius), y)),
    segments,
  );
}

function cylinder(top: number, bottom: number, segments: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(top, bottom, 1, segments, 1, false);
}

function capped(g: THREE.CylinderGeometry): THREE.CylinderGeometry {
  g.translate(0, 0.5, 0);
  return g;
}
