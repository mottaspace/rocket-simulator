// 실사풍 3D 장면: 셰이더 행성·구름층·하늘·대기, 발사장 지면, 구름 덩어리, 별, 배기 연기
import * as THREE from './vendor/three.module.min.js';
import { PLANET, V } from './physics3d.js';

const DPR = window.devicePixelRatio || 1;
export const TIERS = {
  high:   { key: 'high',   name: '높음', pixelRatio: Math.min(DPR, 2),    planet: [256, 128], cap: [64, 128], oct: 8, bake: 4096, shadows: true,  bloom: true,  particles: 500, puffs: 260, stars: 5000, trees: 900 },
  medium: { key: 'medium', name: '중간', pixelRatio: Math.min(DPR, 1.25), planet: [160, 80],  cap: [40, 80],  oct: 7, bake: 2048, shadows: false, bloom: false, particles: 220, puffs: 110, stars: 2500, trees: 350 },
  low:    { key: 'low',    name: '낮음', pixelRatio: Math.min(DPR, 1) * 0.6, planet: [96, 48], cap: [24, 48], oct: 6, bake: 1024, shadows: false, bloom: false, particles: 90, puffs: 30, stars: 1200, trees: 100 },
};
export const TIER_ORDER = ['high', 'medium', 'low'];
export const PAD = [0, PLANET.R, 0];
export const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.56).normalize();
export const CLOUD_ALT = 3200;

// ── GLSL 공통: 해시·값 잡음·fbm, 행성 표면색 ──
const NOISE = `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }
const mat3 ROT3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm(vec3 p, int oct){ float a = 0.0, w = 0.5; for (int i = 0; i < 10; i++){ if (i >= oct) break; a += w * vnoise(p); p = ROT3 * p * 2.03; w *= 0.5; } return a / (1.0 - pow(0.5, float(oct))); }
`;
const SURFACE = `
uniform int uOct;
vec3 surface(vec3 n, out float water){
  float pad = smoothstep(0.990, 1.0, n.y);                       // 발사장(+y) 주변은 육지
  float c = fbm(n * 1.6 + vec3(3.1, 1.7, -2.3), uOct) + pad * 0.3;
  float mtn = 1.0 - abs(fbm(n * 6.0 + 7.0, max(uOct - 2, 2)) * 2.0 - 1.0);
  float h = c - 0.53 + mtn * 0.06 * smoothstep(0.53, 0.62, c);
  float lat = abs(n.z);
  water = 1.0 - smoothstep(-0.004, 0.004, h);
  vec3 deep = vec3(0.004, 0.018, 0.06), shallow = vec3(0.01, 0.09, 0.15);
  vec3 sea = mix(deep, shallow, smoothstep(-0.09, 0.0, h));
  float moist = fbm(n * 3.2 + 11.0, 4) + pad * 0.35 - smoothstep(0.15, 0.32, lat) * smoothstep(0.48, 0.32, lat) * 0.25;
  vec3 desert = vec3(0.42, 0.31, 0.18), grass = vec3(0.09, 0.17, 0.05), forest = vec3(0.025, 0.075, 0.025), tundra = vec3(0.20, 0.19, 0.15), rock = vec3(0.17, 0.15, 0.13);
  vec3 land = mix(desert, grass, smoothstep(0.42, 0.56, moist));
  land = mix(land, forest, smoothstep(0.56, 0.70, moist));
  land = mix(land, tundra, smoothstep(0.55, 0.72, lat));
  land = mix(land, rock, smoothstep(0.10, 0.20, h));
  land *= 0.78 + 0.44 * fbm(n * 48.0, 3);
  float snow = max(smoothstep(0.20, 0.26, h), smoothstep(0.84, 0.90, lat + (fbm(n * 9.0, 3) - 0.5) * 0.08));
  vec3 col = mix(sea, land, 1.0 - water);
  float seaIce = smoothstep(0.90, 0.94, lat + (fbm(n * 7.0, 3) - 0.5) * 0.06);
  col = mix(col, vec3(0.80, 0.84, 0.90), max(snow * (1.0 - water), seaIce));
  water *= 1.0 - seaIce;
  return col;
}
`;
const LOGV = ['#include <common>', '#include <logdepthbuf_pars_vertex>'].join('\n');
const LOGF = ['#include <common>', '#include <logdepthbuf_pars_fragment>'].join('\n');
const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

// 구면 ↔ 텍스처 좌표 (행성 축 = z). 경도 이음매에서 밉맵이 튀지 않게 두 u 중 변화가 작은 쪽을 쓴다(Tarini)
const SPH = `
vec2 dirToUv(vec3 n){ return vec2(atan(n.y, n.x) / 6.2831853 + 0.5, asin(clamp(n.z, -1.0, 1.0)) / 3.1415927 + 0.5); }
vec3 uvToDir(vec2 uv){ float lon = (uv.x - 0.5) * 6.2831853, lat = (uv.y - 0.5) * 3.1415927; return vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)); }
vec4 sampleSph(sampler2D t, vec3 n, float du){
  vec2 uv = dirToUv(n); uv.x += du;
  vec2 a = vec2(fract(uv.x), uv.y), b = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxa = dFdx(a), dya = dFdy(a), dxb = dFdx(b), dyb = dFdy(b);
  return (abs(dxa.x) + abs(dya.x) <= abs(dxb.x) + abs(dyb.x)) ? textureGrad(t, a, dxa, dya) : textureGrad(t, b, dxb, dyb);
}
`;

// 행성 표면·구름 무늬를 시작할 때 한 번만 텍스처로 구워 둔다 (매 프레임 잡음 계산을 피해 휴대폰에서도 가볍게)
function bakePlanet(renderer, size, oct) {
  const mk = () => new THREE.WebGLRenderTarget(size, size / 2, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false });
  const surf = mk(), cloud = mk();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMode: { value: 0 }, uOct: { value: oct } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${NOISE}${SURFACE}${SPH}
uniform int uMode; varying vec2 vUv;
void main(){
  vec3 n = uvToDir(vUv);
  if (uMode == 0) { float water; vec3 c = surface(n, water); gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), water); }
  else {
    float big = fbm(n * 1.9 + 2.0, 3);
    float cov = fbm(n * 6.0, uOct) + (big - 0.5) * 0.55 + smoothstep(0.997, 1.0, n.y) * 0.14;
    float city = smoothstep(0.70, 0.82, vnoise(n * 220.0)) * smoothstep(0.45, 0.65, fbm(n * 9.0, 3));
    gl_FragColor = vec4(smoothstep(0.62, 0.80, cov), city, 0.0, 1.0);
  }
}`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget(), prevTM = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(surf); renderer.render(sc, cam);
  mat.uniforms.uMode.value = 1;
  renderer.setRenderTarget(cloud); renderer.render(sc, cam);
  renderer.setRenderTarget(prevTarget); renderer.toneMapping = prevTM;
  mat.dispose(); quad.geometry.dispose();
  return { surf, cloud };
}

function planetMaterial(baked) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uSurf: { value: baked.surf.texture }, uCloud: { value: baked.cloud.texture }, uRim: { value: 1 }, uHaze: { value: 0 }, uHazeDist: { value: 60000 }, uHazeColor: { value: new THREE.Color() } },
    vertexShader: `${LOGV}
varying vec3 vN; varying vec3 vW;
void main(){ vN = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `${LOGF}
${NOISE}${SPH}
uniform sampler2D uSurf; uniform sampler2D uCloud;
uniform vec3 uSun; uniform float uRim; uniform float uHaze; uniform float uHazeDist; uniform vec3 uHazeColor;
varying vec3 vN; varying vec3 vW;
void main(){
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  vec4 s = sampleSph(uSurf, n, 0.0);
  vec3 alb = pow(s.rgb, vec3(2.2)); float water = s.a;
  float dist = length(cameraPosition - vW);
  alb *= mix(1.0, 0.82 + 0.36 * vnoise(n * 2600.0), (1.0 - water) * smoothstep(120000.0, 20000.0, dist));
  vec3 Vd = normalize(cameraPosition - vW);
  float ndl = dot(n, uSun);
  vec3 sunCol = vec3(1.0, 0.96, 0.90) * 3.2;
  vec3 tint = mix(vec3(1.0, 0.45, 0.25), vec3(1.0), smoothstep(0.0, 0.35, ndl));
  vec3 col = alb * (sunCol * tint * max(ndl, 0.0) + vec3(0.015, 0.02, 0.035));
  vec3 H = normalize(uSun + Vd);
  col += water * sunCol * tint * pow(max(dot(n, H), 0.0), 90.0) * 0.5 * step(0.0, ndl);
  float day = smoothstep(-0.08, 0.15, ndl);
  float city = (1.0 - water) * sampleSph(uCloud, n, 0.0).g;
  col += vec3(1.0, 0.62, 0.28) * city * 0.35 * (1.0 - day);
  float fres = pow(1.0 - max(dot(n, Vd), 0.0), 3.0);
  col = mix(col, vec3(0.22, 0.45, 1.0) * (0.04 + 1.6 * max(ndl + 0.15, 0.0)), fres * 0.8 * uRim);
  col = mix(col, uHazeColor, (1.0 - exp(-dist / uHazeDist)) * uHaze);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  });
}

function cloudMaterial(baked) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uCloud: { value: baked.cloud.texture }, uTime: { value: 0 }, uHaze: { value: 0 }, uHazeDist: { value: 60000 }, uHazeColor: { value: new THREE.Color() } },
    vertexShader: `${LOGV}
varying vec3 vN; varying vec3 vW;
void main(){ vN = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `${LOGF}
${NOISE}${SPH}
uniform sampler2D uCloud; uniform vec3 uSun; uniform float uTime; uniform float uHaze; uniform float uHazeDist; uniform vec3 uHazeColor;
varying vec3 vN; varying vec3 vW;
void main(){
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float c = sampleSph(uCloud, n, uTime * 0.000004).r;
  float dist = length(cameraPosition - vW);
  c = clamp(c * mix(1.0, 0.7 + 0.6 * vnoise(n * 1500.0), smoothstep(150000.0, 15000.0, dist)), 0.0, 1.0);
  if (c < 0.01) discard;
  float ndl = dot(n, uSun);
  vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(0.0, 0.35, ndl));
  vec3 Vd = normalize(cameraPosition - vW);
  float under = step(dot(n, Vd), 0.0);
  float shade = mix(1.0, 0.55 + 0.25 * (1.0 - c), under);
  vec3 col = vec3(0.92) * (2.3 * tint * smoothstep(-0.12, 0.45, ndl) * shade + 0.03);
  col = mix(col, uHazeColor, (1.0 - exp(-dist / uHazeDist)) * uHaze);
  gl_FragColor = vec4(col, c * 0.96);
  ${OUT}
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uAlt: { value: 0 }, uDip: { value: 0 } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun; uniform vec3 uUp; uniform float uAlt; uniform float uDip; varying vec3 vD;
void main(){
  vec3 d = normalize(vD);
  float e = dot(d, uUp) + uDip;                         // 고도가 높을수록 지평선이 내려감
  float dens = exp(-uAlt / 9000.0);
  float sunUp = dot(uSun, uUp);
  float mu = max(dot(d, uSun), 0.0);
  vec3 zenith = vec3(0.02, 0.09, 0.36), horizonC = vec3(0.30, 0.47, 0.78);
  vec3 col = mix(zenith, horizonC, pow(1.0 - clamp(e, 0.0, 1.0), 5.0));
  col = mix(col, vec3(0.30, 0.36, 0.42), smoothstep(0.0, -0.12, e));
  col += vec3(1.0, 0.78, 0.5) * pow(mu, 10.0) * 0.45;      // 해 주변 산란
  col *= 1.0 * smoothstep(-0.25, 0.2, sunUp);
  vec3 space = vec3(0.0);
  col = mix(space, col, pow(dens, 0.55));
  float glow = smoothstep(0.012, 0.0, abs(e)) * (1.0 - dens) * smoothstep(0.0, 0.3, 1.0 - dens) * 0.9;
  col += vec3(0.25, 0.5, 1.0) * glow * max(sunUp + 0.3, 0.0);   // 우주에서 본 대기 띠
  col += vec3(1.0, 0.95, 0.88) * smoothstep(0.99955, 0.99985, mu) * 40.0; // 태양 원반
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
}

function atmosMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uAlpha: { value: 1 } },
    vertexShader: `${LOGV}
varying vec3 vN; varying vec3 vW;
void main(){ vN = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `${LOGF}
uniform vec3 uSun; uniform float uAlpha; varying vec3 vN; varying vec3 vW;
void main(){
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN), Vd = normalize(cameraPosition - vW);
  float rim = pow(1.0 - abs(dot(n, Vd)), 4.0);
  float day = max(dot(n, uSun) + 0.35, 0.0);
  vec3 col = vec3(0.25, 0.52, 1.0) * rim * day * 2.2;
  gl_FragColor = vec4(col * uAlpha, 1.0);
  ${OUT}
}`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

const particleShader = {
  uniforms: { uScale: { value: 500 }, uMax: { value: 64 }, uColor: { value: new THREE.Color(0.85, 0.85, 0.88) }, uLight: { value: 1 } },
  vertexShader: `${LOGV}
attribute float aSize; attribute float aAlpha; varying float vA;
uniform float uScale; uniform float uMax;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(uMax, aSize * uScale / max(0.1, -mv.z)); gl_Position = projectionMatrix * mv; vA = aAlpha;
#include <logdepthbuf_vertex>
}`,
  fragmentShader: `${LOGF}
uniform vec3 uColor; uniform float uLight; varying float vA;
void main(){
#include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord - 0.5; float d = length(q); if (d > 0.5) discard;
  float s = 0.75 + 0.25 * (0.5 - q.y);
  gl_FragColor = vec4(uColor * uLight * s, vA * smoothstep(0.5, 0.15, d));
  ${OUT}
}`,
};

// ── CPU 쪽 잡음 (지면 색·배치용) ──
function hash(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, 0), b = hash(xi + 1, yi, 0), c = hash(xi, yi + 1, 0), d = hash(xi + 1, yi + 1, 0);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, y, o) { let a = 0, f = 1, w = 0.5; for (let i = 0; i < o; i++) { a += w * noise2(x * f, y * f); f *= 2.03; w *= 0.5; } return a; }

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function softTexture(inner, outer) {
  return canvasTexture(64, (ctx) => { const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32); g.addColorStop(0, inner); g.addColorStop(1, outer); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); });
}
// 뭉게구름 한 덩어리 텍스처 (여러 원을 겹쳐 가장자리가 불규칙하게)
function puffTexture() {
  return canvasTexture(128, (ctx) => {
    for (let i = 0; i < 26; i++) {
      const a = hash(i, 1, 1) * Math.PI * 2, r = Math.sqrt(hash(i, 2, 2)) * 36, x = 64 + Math.cos(a) * r, y = 70 + Math.sin(a) * r * 0.6, s = 18 + hash(i, 3, 3) * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, s);
      const sh = 255 - Math.round((y - 40) * 0.9);
      g.addColorStop(0, `rgba(${sh},${sh},${Math.min(255, sh + 6)},0.55)`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    }
  });
}
function groundTexture() {
  const t = canvasTexture(256, (ctx, s) => {
    const img = ctx.createImageData(s, s), d = img.data;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const n = fbm2(i / 24, j / 24, 4), m = noise2(i / 3, j / 3);
      const v = 205 + (n - 0.5) * 100 + (m - 0.5) * 40, k = (j * s + i) * 4;
      d[k] = v * 0.97; d[k + 1] = v; d[k + 2] = v * 0.9; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  t.colorSpace = THREE.NoColorSpace; // 밝기 변화만 곱하는 디테일 텍스처
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// 발사장에서 동쪽 e, 북쪽 n(m) 떨어진 지표점 (발사장 기준 좌표, 고도 h)
export function surfaceOffset(e, n, h = 0) {
  const d = Math.hypot(e, n), th = d / PLANET.R, R = PLANET.R + h;
  const ux = d > 0 ? e / d : 0, uz = d > 0 ? n / d : 0;
  return [R * Math.sin(th) * ux, R * Math.cos(th) - PLANET.R, R * Math.sin(th) * uz];
}

export class World {
  constructor(scene, tier, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.root = new THREE.Group();
    this.padRoot = new THREE.Group();
    this.padRoot.position.set(PAD[0], PAD[1], PAD[2]);
    this.root.add(this.padRoot);
    scene.add(this.root);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial());
    this.sky.renderOrder = -1000; this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.time = 0;
    this.build(tier);
  }

  dispose() {
    const kill = o => o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) [].concat(c.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
    [this.planet, this.cloudShell, this.atmos, this.ground, this.pad, this.trees, this.puffs, this.stars, this.particles].forEach(o => { if (o) { if (o.parent) o.parent.remove(o); kill(o); } });
  }

  build(tier) {
    this.dispose();
    this.tier = tier;
    const T = tier;
    if (this.baked) { this.baked.surf.dispose(); this.baked.cloud.dispose(); }
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    this.baked = bakePlanet(this.renderer, Math.min(T.bake, maxTex), T.oct);
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET.R - 30, T.planet[0], T.planet[1]), planetMaterial(this.baked));
    this.root.add(this.planet);
    this.cloudShell = new THREE.Mesh(new THREE.SphereGeometry(PLANET.R + CLOUD_ALT, T.planet[0], T.planet[1]), cloudMaterial(this.baked));
    this.cloudShell.renderOrder = 2;
    this.root.add(this.cloudShell);
    this.atmos = new THREE.Mesh(new THREE.SphereGeometry(PLANET.R + PLANET.atm * 1.5, 128, 64), atmosMaterial());
    this.atmos.renderOrder = 3;
    this.root.add(this.atmos);

    // 발사장 주변 지면 (반경 40 km, 가장자리는 투명하게 행성과 섞임)
    const [rings, segs] = T.cap, DMAX = 40000;
    const pos = [], col = [], uv = [], idx = [], c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
      const d = DMAX * Math.pow(i / rings, 2.3);
      for (let j = 0; j < segs; j++) {
        const a = j / segs * Math.PI * 2, e = Math.cos(a) * d, n = Math.sin(a) * d, p = surfaceOffset(e, n);
        pos.push(p[0], p[1], p[2]); uv.push(e / 30, n / 30);
        const f = fbm2(e / 1400 + 50, n / 1400 + 50, 4), g = fbm2(e / 230, n / 230, 3);
        if (d < 55 || (Math.abs(n) < 6 && e < 0 && e > -1500)) c.setRGB(0.36, 0.36, 0.37);   // 발사대 + 진입로
        else c.setRGB(0.10 + 0.12 * f + 0.05 * g, 0.16 + 0.09 * f, 0.055 + 0.03 * g);         // 들판·숲 (선형 색)
        col.push(c.r, c.g, c.b, Math.min(1, (1 - d / DMAX) * 4));
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs, cc = (i + 1) * segs + j, dd = (i + 1) * segs + (j + 1) % segs;
      idx.push(a, b, cc, b, dd, cc);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    gg.setIndex(idx); gg.computeVertexNormals();
    this.ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTexture(), roughness: 1, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.ground.receiveShadow = T.shadows;
    this.ground.renderOrder = 1;
    this.padRoot.add(this.ground);

    // 발사대·발사탑·연기 배출구
    this.pad = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x7d7f84, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a3b22, roughness: 0.55, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8, metalness: 0.3 });
    const plat = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 22), concrete); plat.position.y = -0.6; plat.receiveShadow = T.shadows; this.pad.add(plat);
    const trench = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 10), dark); trench.position.set(0, 0.01, 6); this.pad.add(trench);
    const tower = new THREE.Group();
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 34, 0.22), steel); leg.position.set(x, 17, z); tower.add(leg); }
    for (let i = 1; i < 17; i++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 2.2), steel); r.position.y = i * 2; tower.add(r);
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.8, 0.08), steel); br.position.set(1, i * 2 - 1, 0); br.rotation.x = 0.78; tower.add(br);
      const bl = br.clone(); bl.position.x = -1; tower.add(bl);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 0.8), steel); arm.position.set(2.4, 22, 0); tower.add(arm);
    tower.position.set(-4.4, 0, 0); tower.traverse(o => { if (o.isMesh) o.castShadow = T.shadows; });
    this.pad.add(tower);
    for (const [x, z] of [[9, 9], [-9, 9], [9, -9], [-9, -9]]) { const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 18, 6), steel); lp.position.set(x, 9, z); this.pad.add(lp); }
    this.padRoot.add(this.pad);

    // 숲 (속도감·크기 비교용)
    const treeGeo = new THREE.ConeGeometry(2.0, 9, 7); treeGeo.translate(0, 4.5, 0);
    this.trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), T.trees);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < T.trees; i++) {
      const r = 90 + Math.pow(hash(i, 3, 9), 1.4) * 7000, a = hash(i, 7, 1) * Math.PI * 2, e = Math.cos(a) * r, n = Math.sin(a) * r;
      if (Math.abs(n) < 20 && e < 0 && e > -1500) continue;
      const p = surfaceOffset(e, n);
      q.setFromUnitVectors(UP, new THREE.Vector3(p[0], p[1] + PLANET.R, p[2]).normalize());
      const k = 0.7 + hash(i, 5, 5) * 1.0; s.set(k, k * (0.8 + hash(i, 9, 2) * 0.6), k);
      m4.compose(new THREE.Vector3(p[0], p[1], p[2]), q, s); this.trees.setMatrixAt(i, m4);
      this.trees.setColorAt(i, c.setRGB(0.03 + hash(i, 1, 4) * 0.03, 0.07 + hash(i, 2, 4) * 0.05, 0.03, THREE.LinearSRGBColorSpace));
    }
    this.trees.castShadow = T.shadows;
    this.padRoot.add(this.trees);

    // 구름 덩어리: 구름층 높이에 발사장 주변으로 배치 → 로켓이 뚫고 지나감
    this.puffs = new THREE.Group();
    const pm = new THREE.SpriteMaterial({ map: puffTexture(), depthWrite: false, fog: false, color: 0xffffff });
    this.puffMat = pm;
    for (let i = 0; i < T.puffs; i++) {
      const r = Math.pow(hash(i, 11, 2), 0.7) * 24000, a = hash(i, 13, 4) * Math.PI * 2;
      const p = surfaceOffset(Math.cos(a) * r, Math.sin(a) * r, CLOUD_ALT - 700 + hash(i, 17, 6) * 1400);
      const sp = new THREE.Sprite(pm), w = 900 + hash(i, 21, 3) * 1800;
      sp.scale.set(w, w * 0.55, 1); sp.position.set(p[0], p[1], p[2]);
      this.puffs.add(sp);
    }
    this.padRoot.add(this.puffs);

    // 별
    const sp = [], sc = [];
    for (let i = 0; i < T.stars; i++) {
      const u = hash(i, 1, 2) * 2 - 1, th = hash(i, 3, 4) * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp.push(r * Math.cos(th) * 4e7, u * 4e7, r * Math.sin(th) * 4e7);
      const b = Math.pow(hash(i, 5, 6), 3) * 0.9 + 0.1, t = hash(i, 7, 8);
      sc.push(b * (0.8 + 0.2 * t), b * 0.9, b * (1.0 - 0.2 * t));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: T.key === 'high' ? 1.8 : 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -900;
    this.scene.add(this.stars);

    // 배기 연기
    const N = T.particles;
    this.pWorld = new Float64Array(N * 3); this.pVel = new Float64Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N); this.pHead = 0;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    this.particles = new THREE.Points(pg, new THREE.ShaderMaterial({ ...particleShader, uniforms: THREE.UniformsUtils.clone(particleShader.uniforms), transparent: true, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  emit(pos, vel, fwd, up, alt, count) {
    const N = this.tier.particles;
    for (let i = 0; i < count; i++) {
      const k = this.pHead; this.pHead = (this.pHead + 1) % N;
      const rnd = () => Math.random() - 0.5;
      if (alt < 25) {
        let d = [rnd(), rnd(), rnd()];
        const du = V.dot(d, up); d = V.norm(V.sub(d, V.mul(up, du)));
        const sp = 16 + Math.random() * 24;
        for (let a = 0; a < 3; a++) { this.pWorld[k * 3 + a] = pos[a] - up[a] * (alt - 1.5); this.pVel[k * 3 + a] = d[a] * sp + up[a] * (2 + Math.random() * 5); }
        this.pMax[k] = this.pLife[k] = 3 + Math.random() * 4;
      } else {
        const sp = 25 + Math.random() * 20;
        for (let a = 0; a < 3; a++) { this.pWorld[k * 3 + a] = pos[a] - fwd[a] * 1.5; this.pVel[k * 3 + a] = vel[a] * 0.9 - fwd[a] * sp + rnd() * 0.5 * sp; }
        this.pMax[k] = this.pLife[k] = 2.5 + Math.random() * 3;
      }
    }
  }

  // 매 프레임 갱신. origin = 64비트 월드 좌표의 기준점(로켓)
  update(origin, dt, alt, camera, viewportH, mapMode) {
    this.time += dt;
    this.root.position.set(-origin[0], -origin[1], -origin[2]);
    const camWorld = V.add(origin, [camera.position.x, camera.position.y, camera.position.z]);
    const camAlt = V.len(camWorld) - PLANET.R, up = V.norm(camWorld);
    // 하늘 돔 (카메라 위치)
    this.sky.position.copy(camera.position);
    const su = this.sky.material.uniforms;
    su.uUp.value.set(up[0], up[1], up[2]);
    su.uAlt.value = mapMode ? 1e7 : Math.max(0, camAlt);
    su.uDip.value = mapMode ? 0 : Math.acos(Math.min(1, PLANET.R / (PLANET.R + Math.max(0, camAlt))));
    this.stars.position.copy(camera.position);
    this.stars.material.opacity = mapMode ? 1 : Math.max(0, Math.min(1, (camAlt - 12000) / 22000));

    // 공기 원근(멀리 있는 땅·구름이 하늘색으로 흐려짐)
    const dens = Math.exp(-Math.max(0, camAlt) / 9000);
    const sunUp = SUN_DIR.dot(new THREE.Vector3(up[0], up[1], up[2]));
    const haze = hazeColor(camAlt, sunUp, this.hazeC || (this.hazeC = new THREE.Color()));
    for (const m of [this.planet.material, this.cloudShell.material]) {
      m.uniforms.uHaze.value = mapMode ? 0 : Math.min(0.95, dens * 1.1);
      m.uniforms.uHazeDist.value = 35000 + camAlt * 2;
      m.uniforms.uHazeColor.value.copy(haze);
    }
    this.planet.material.uniforms.uRim.value = Math.min(1, Math.max(0, (camAlt - 8000) / 30000));
    this.cloudShell.material.uniforms.uTime.value = this.time;
    this.atmos.material.uniforms.uAlpha.value = mapMode ? 1 : Math.max(0, Math.min(1, (camAlt - 25000) / 50000));

    const near = !mapMode && alt < 60000;
    this.ground.visible = this.pad.visible = this.trees.visible = near;
    this.puffs.visible = !mapMode && alt < 15000;
    if (this.puffs.visible) this.puffMat.color.setScalar(0.35 + 0.65 * Math.max(0, sunUp));

    // 연기
    const N = this.tier.particles, P = this.particles.geometry.attributes;
    const pa = P.position.array, sa = P.aSize.array, aa = P.aAlpha.array, drag = Math.exp(-dt * 1.1);
    for (let k = 0; k < N; k++) {
      if (this.pLife[k] <= 0) { aa[k] = 0; continue; }
      this.pLife[k] -= dt;
      for (let a = 0; a < 3; a++) { this.pVel[k * 3 + a] *= drag; this.pWorld[k * 3 + a] += this.pVel[k * 3 + a] * dt; pa[k * 3 + a] = this.pWorld[k * 3 + a] - origin[a]; }
      const age = 1 - this.pLife[k] / this.pMax[k];
      sa[k] = 3 + age * 10; aa[k] = Math.max(0, 0.5 * (1 - age) * Math.min(1, age * 6));
    }
    P.position.needsUpdate = P.aSize.needsUpdate = P.aAlpha.needsUpdate = true;
    const pu = this.particles.material.uniforms;
    pu.uScale.value = viewportH / (2 * Math.tan(camera.fov * Math.PI / 360));
    pu.uMax.value = Math.max(24, viewportH * (this.tier.key === 'high' ? 0.09 : 0.07));
    pu.uLight.value = 0.25 + 1.6 * Math.max(0, sunUp);
    return { camAlt, dens, haze };
  }
}

// 지평선 근처 하늘색 (안개·공기 원근용, 선형 색)
export function hazeColor(alt, sunUp, out) {
  const d = Math.pow(Math.exp(-Math.max(0, alt) / 9000), 0.55), day = 1.0 * Math.max(0, Math.min(1, (sunUp + 0.25) / 0.45));
  return out.setRGB(0.30 * d * day, 0.47 * d * day, 0.78 * d * day);
}
