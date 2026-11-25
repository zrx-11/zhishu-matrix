/**
 * 批 8 空间装配：程序化表面纹理（木纹 / 石膏墙 / 地毯 / 铜）、环境光照、灯光套件与后期链。
 * 铁律 2 在本文件的具体含义——所有贴图由 canvas 现画，环境光照由 PMREM 现烘，
 * 一个 .hdr / .glb / .ktx2 / .png / .jpg 都不落地。
 *
 * 木纹生成法取自 `_work/refs/codex-library/lib/textures.ts` L17–107（noise2 / fbm / 环形年轮 / 木节），
 * 改动逐条记在 `_work/decisions.md` 批 8 借鉴清单。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ROOMS } from './config';

const texCache = new Map<string, THREE.CanvasTexture>();

/**
 * 公共表面纹理（木纹/墙/地毯）按 key 缓存，跨区复用：切区只释放本区图集与合并几何，
 * 不动这些——「切区释放纹理导致黑块」的根因就是把共用纹理跟着区一起 dispose 了（见 pitfalls 批 8）。
 */
function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const tex = make();
  texCache.set(key, tex);
  return tex;
}

export function sharedTextures(): THREE.CanvasTexture[] {
  return [...texCache.values()];
}

function noise2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    v += amp * noise2(x * freq, y * freq, seed + i);
    freq *= 2;
    amp *= 0.5;
  }
  return v;
}

function rgbOf(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * 木纹：竖向纹理线 + 大环年轮 + 木节，一次生成 256² 反复平铺。
 * 比参考实现少一半像素（256 vs 512）并把 ringMask 幂次从 18 降到 9——
 * 我们的构件只有 1–3 单位宽，512 图摊上去等于看不见纹理。
 */
export function woodTexture(base: string, ring: string, seed = 3): THREE.CanvasTexture {
  const key = `wood:${base}:${ring}:${seed}`;
  return cached(key, () => {
    const W = 256;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = W;
    const g = c.getContext('2d');
    if (!g) throw new Error('canvas 2d 不可用');
    g.fillStyle = base;
    g.fillRect(0, 0, W, W);
    const b = rgbOf(base);
    const r = rgbOf(ring);
    const img = g.getImageData(0, 0, W, W);
    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const u = x / W;
        const v = y / W;
        const grain = fbm(u * 8, v * 40, seed);
        const distort = fbm(u * 3, v * 5, seed + 7) * 0.3;
        const ringDist = Math.abs(Math.sin((v + distort) * 12 + fbm(u, v, seed + 13) * 1.5));
        const mask = Math.pow(ringDist, 9) * 0.55 + grain * 0.35;
        const i = (y * W + x) * 4;
        img.data[i] = b.r * (1 - mask) + r.r * mask;
        img.data[i + 1] = b.g * (1 - mask) + r.g * mask;
        img.data[i + 2] = b.b * (1 - mask) + r.b * mask;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 3; i += 1) {
      const kx = noise2(i + 1, 99, seed) * W;
      const ky = noise2(i + 1, 7, seed) * W;
      const kr = 6 + noise2(i + 1, 3, seed) * 12;
      const grad = g.createRadialGradient(kx, ky, 0, kx, ky, kr);
      grad.addColorStop(0, 'rgba(18, 10, 4, 0.85)');
      grad.addColorStop(1, 'rgba(18, 10, 4, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(kx, ky, kr, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.userData.procedural = true;
    return tex;
  });
}

/** 墙面：石膏底色 + 上下方向的灯照渐变 + 竖向护墙分格线（比纯色的「空间感」来源） */
export function wallTexture(base: string, accent: string, tint: string): THREE.CanvasTexture {
  const key = `wall:${base}:${accent}:${tint}`;
  return cached(key, () => {
    const W = 256;
    const H = 256;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) throw new Error('canvas 2d 不可用');
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, base);
    bg.addColorStop(0.62, accent);
    bg.addColorStop(1, tint);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // 细噪点，避免大色块被 ACES 压成塑料
    const img = g.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const n = (fbm(x / W * 40, y / H * 40, 21) - 0.5) * 26;
        const i = (y * W + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
      }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      const x = Math.round((i * W) / 4) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.userData.procedural = true;
    return tex;
  });
}

/** 地毯：中心菱形花纹 + 边框，铺阅读室中央（参考 makeRugTexture 的分层画法，尺寸缩到 256） */
export function rugTexture(color: string): THREE.CanvasTexture {
  const key = `rug:${color}`;
  return cached(key, () => {
    // 学科色直接画会亮到越过 bloom 阈值：批 8 把机位移进室内后，地毯边框糊成一圈霓虹红框。
    // 压到 45% 明度，花纹还在、不再发光（批 7 的俯视机位里这块地摊只占画面一角，所以当时没暴露）。
    const dim = `#${new THREE.Color(color).multiplyScalar(0.45).getHexString()}`;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (!g) throw new Error('canvas 2d 不可用');
    g.fillStyle = '#2a1f18';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#3a2a1c';
    g.fillRect(14, 14, S - 28, S - 28);
    g.strokeStyle = dim;
    g.lineWidth = 5;
    g.strokeRect(24, 24, S - 48, S - 48);
    g.globalAlpha = 0.5;
    g.fillStyle = dim;
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        const x = 44 + i * ((S - 88) / 4);
        const y = 44 + j * ((S - 88) / 4);
        g.beginPath();
        g.moveTo(x, y - 9);
        g.lineTo(x + 9, y);
        g.lineTo(x, y + 9);
        g.lineTo(x - 9, y);
        g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.userData.procedural = true;
    return tex;
  });
}

/** 概念光点（光尘）：一张 64px 径向渐变，核心亮、外圈收得干净，全部光点共用 */
export function glowTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas 2d 不可用');
  const half = S / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(0.16, 'rgba(255, 255, 255, 0.5)');
  grad.addColorStop(0.38, 'rgba(255, 255, 255, 0.14)');
  grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.03)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
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
 * 环境反射：等距柱状渐变 + 六区学科色斑（canvas 现画）→ PMREM 预滤波 → scene.environment。
 * 室内的反射主体是「上方一盏暖顶灯、四方是暗木墙」，所以把天顶带画亮、地平线以下压暗。
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): EnvironmentBundle {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas 2d 不可用');
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#4a3a22');
  sky.addColorStop(0.34, '#2b2418');
  sky.addColorStop(0.52, '#14161c');
  sky.addColorStop(1, '#07080b');
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);
  ROOMS.forEach((r) => {
    const az = Math.atan2(-r.at[1], r.at[0]);
    const u = (az / (Math.PI * 2) + 0.5) * 512;
    const blob = g.createRadialGradient(u, 132, 0, u, 132, 62);
    blob.addColorStop(0, `${r.color}aa`);
    blob.addColorStop(0.6, `${r.color}33`);
    blob.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = blob;
    g.fillRect(u - 70, 60, 140, 140);
  });
  const source = new THREE.CanvasTexture(c);
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

/** 天/地双色环境光 + 一盏投影主光 + 六个区各一盏带衰减的学科色点光（吊灯光） */
export function buildLightRig(): LightRig {
  const hemi = new THREE.HemisphereLight(0xb9a17a, 0x10131a, 0.36);
  hemi.position.set(0, 400, 0);
  const key = new THREE.DirectionalLight(0xffe6c4, 1.15);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.28;
  const zones = ROOMS.map((r) => {
    const light = new THREE.PointLight(new THREE.Color(r.color).getHex(), 300, 190, 2);
    // 摆在走廊里、门廊正前方（体量外壳半宽 13 再外退 16）：
    // 先版吊在屋顶上方 16 单位，只照亮箱顶，大厅俯视仍是六个黑盒；
    // 挪到门前才把外壳朝大厅那一面与区名铜牌洗成学科色，六条走廊也各带一段色光。
    const r2 = Math.hypot(r.at[0], r.at[1]) || 1;
    const k = 1 - 29 / r2;
    light.position.set(r.at[0] * k, 12, r.at[1] * k);
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

/** Bloom 只吃吊灯与光尘的高光：室内地面反照率低，0.6 阈值以下不会整屏发灰 */
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.5, 0.6);
  const output = new OutputPass();
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(output);
  return { composer, render, bloom, output };
}
