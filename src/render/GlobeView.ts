import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEG, densifyPath, latLonToVec3, wrapLon, type LatLon } from '../sim/core/sphere';
import type { ComposeOptions } from './compose';
import type { SurfaceLine } from './surfaceLines';
import { lowpolyMaterial } from './lowpoly/kit';
import { buildPort, buildTown } from './lowpoly/ports';
import { buildShip } from './lowpoly/ships';

/** 지구본에 세울 항구 도시 */
export interface GlobePort {
  id: string;
  lat: number;
  lon: number;
  /** 부두가 향할 바다 쪽 점 */
  seaLat: number;
  seaLon: number;
  level: 1 | 2 | 3;
  countryColor: string;
}

/** 지구본에 세울 내륙 도시 */
export interface GlobeTown {
  id: string;
  lat: number;
  lon: number;
  size: 1 | 2;
  countryColor: string;
}

/** 지구본 위 이름표(항구 이름과, 상품 렌즈를 켰을 때의 값 꼬리표) */
export interface GlobeLabel {
  id: string;
  lat: number;
  lon: number;
  text: string;
  badge?: string;
  tone?: 'cheap' | 'dear' | 'plain';
  emphasis?: boolean;
}

/** 지구본에 띄울 배 */
export interface GlobeShip {
  id: string;
  lat: number;
  lon: number;
  /** 뱃머리가 향하는 점 */
  headLat: number;
  headLon: number;
  /** 'small' | 'medium' | 'bulk' | 'container' | 'reefer' | 'npc' */
  kind: string;
  /** 굴뚝(회사) 색 */
  funnel: string;
  /** 눌러서 고를 수 있는 배(내 배) */
  pickable?: boolean;
}

/** 지구 표면 그림: 육지 색·바다 색(같은 크기의 RGBA)과, 둘을 가르는 육지 마스크 */
export interface GlobeSurface {
  width: number;
  height: number;
  land: Uint8ClampedArray;
  sea: Uint8ClampedArray;
  mask: { width: number; height: number; data: Uint8Array };
  /** 가까이서 땅에 잔 결을 입힌다(지형 그림용. 색으로 구분하는 주제도에서는 끈다) */
  detail?: boolean;
}

/**
 * 지표 셰이더. 해안선을 텍스처에 굽지 않고 육지 마스크(선형 보간)를 0.5에서 잘라 그린다.
 * 화면 픽셀 단위로 경계를 다듬으므로 아무리 확대해도 해안이 계단지거나 뭉개지지 않는다.
 * 색은 sRGB 값을 그대로 다룬다(텍스처·출력 모두 변환 없음).
 */
const SURFACE_VS =
  'varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SURFACE_FS = `
uniform sampler2D tLand; uniform sampler2D tSea; uniform sampler2D tMask;
uniform float uDetail; uniform float uFlat;
varying vec2 vUv; varying vec3 vPos;

// 육지 마스크를 3차 곡선으로 보간해 해안선을 둥근 곡선으로 만든다.
// Catmull-Rom(칸 중심 값을 지킨다)과 B-스플라인(계단을 펴 준다)을 섞는다: 비스듬한 해안의
// 칸 단위 계단은 눌러 주되, 한 칸짜리 섬(0.54)과 해협(0.27)은 0.5 기준을 넘지 않아 그대로 남는다
vec4 crWeights(float t){
  float t2 = t * t; float t3 = t2 * t;
  vec4 cr = vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
  float u = 1.0 - t;
  vec4 bs = vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
  return mix(cr, bs, 0.8);
}
float maskSmooth(vec2 uv){
  ivec2 size = textureSize(tMask, 0);
  vec2 st = uv * vec2(size) - 0.5;
  ivec2 b = ivec2(floor(st));
  vec4 wx = crWeights(fract(st.x)); vec4 wy = crWeights(fract(st.y));
  float s = 0.0;
  for (int j = 0; j < 4; j++) {
    float r = 0.0;
    int y = clamp(b.y + j - 1, 0, size.y - 1);
    for (int i = 0; i < 4; i++) {
      int x = ((b.x + i - 1) % size.x + size.x) % size.x;
      r += wx[i] * texelFetch(tMask, ivec2(x, y), 0).r;
    }
    s += wy[j] * r;
  }
  return s;
}

// 색은 확대될 때 3차(B-스플라인) 보간: 선형 보간의 마름모꼴 얼룩 없이 매끄럽게 이어진다
vec3 smoothColor(sampler2D t, vec2 uv){
  vec2 size = vec2(textureSize(t, 0));
  vec2 st = uv * size;
  float texelsPerPx = max(length(dFdx(st)), length(dFdy(st)));
  vec3 plain = texture2D(t, uv).rgb;
  if (texelsPerPx >= 1.0) return plain;
  st -= 0.5;
  vec2 f = fract(st); vec2 b = floor(st);
  vec2 f2 = f * f; vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1; vec2 g1 = w2 + w3;
  vec2 p0 = (b + 0.5 - 1.0 + w1 / g0) / size;
  vec2 p1 = (b + 0.5 + 1.0 + w3 / g1) / size;
  vec3 c = g0.x * g0.y * textureLod(t, vec2(p0.x, p0.y), 0.0).rgb
         + g1.x * g0.y * textureLod(t, vec2(p1.x, p0.y), 0.0).rgb
         + g0.x * g1.y * textureLod(t, vec2(p0.x, p1.y), 0.0).rgb
         + g1.x * g1.y * textureLod(t, vec2(p1.x, p1.y), 0.0).rgb;
  return mix(c, plain, smoothstep(0.5, 1.0, texelsPerPx));
}

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 격자(0.5도)보다 잔 결: 다가갈수록 한 겹씩 나타나 땅이 밋밋한 그러데이션으로 보이지 않게 한다
float detail(vec3 p){
  float px = length(fwidth(p));
  float d = 0.0; float amp = 1.0; float freq = 180.0;
  for (int o = 0; o < 5; o++) {
    d += amp * smoothstep(0.35, 0.1, px * freq) * (vnoise(p * freq) - 0.5);
    amp *= 0.55; freq *= 2.0;
  }
  return d;
}

void main(){
  float m = maskSmooth(vUv);
  float fw = max(fwidth(m), 1e-4);
  vec3 land = smoothColor(tLand, vUv);
  vec3 sea = smoothColor(tSea, vUv);
  // 평면 지도에서도 구면 위의 점으로 결을 만든다(지구본과 같은 무늬, 좌우 이음매 없음)
  vec3 sp = vPos;
  if (uFlat > 0.5) {
    float lon = (vUv.x - 0.5) * 6.2831853; float lat = (vUv.y - 0.5) * 3.1415927;
    sp = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
  }
  land *= 1.0 + uDetail * 0.16 * detail(sp);
  // 해안선: 육지 쪽 가장자리를 화면에서 2px쯤(가까이서는 조금 더 굵게) 어둡게
  float w = clamp(1.8 * fw, 0.045, 0.5);
  float line = 1.0 - smoothstep(0.5 + w - fw, 0.5 + w + fw, m);
  land *= mix(1.0, 0.62, line);
  gl_FragColor = vec4(mix(sea, land, smoothstep(0.5 - 0.7 * fw, 0.5 + 0.7 * fw, m)), 1.0);
}`;

/**
 * 띠(항로·경위선) 셰이더. 중심선에서 옆으로 벌리는 폭을 화면 픽셀로 정하므로
 * 멀리서도 가늘어 사라지지 않고, 가까이서도 뭉툭해지지 않는다.
 */
const RIBBON_VS = `
attribute vec3 aSide; attribute float aOff; attribute float aLift; attribute vec4 aColor; attribute float aDist; attribute float aDash;
uniform float uRadPerPx; uniform float uZoomK; uniform float uFlat;
varying vec4 vColor; varying float vDist; varying float vDash;
void main(){
  float px = max(abs(aOff) * uZoomK, 1.3);
  vec3 q = position + aSide * sign(aOff) * px * 0.5 * uRadPerPx;
  vec3 p = uFlat > 0.5 ? vec3(q.xy, aLift - 1.0) : normalize(q) * aLift;
  vColor = aColor; vDist = aDist; vDash = aDash;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const RIBBON_FS = `
uniform float uDashScale;
varying vec4 vColor; varying float vDist; varying float vDash;
void main(){
  if (vDash > 0.5 && mod(vDist / uDashScale, 22.0) > 12.0) discard;
  gl_FragColor = vColor;
}`;

interface Strip {
  /** 촘촘히 나눈 중심선 */
  points: LatLon[];
  /** 굵기(1/8도 단위 — 기본 거리에서 약 1.2px). 점마다 다르면 배열 */
  width: number | number[];
  color: [number, number, number, number];
  dashed: boolean;
  lift: number;
}

/** '#rrggbb' 또는 'rgb()/rgba()' -> 0~1 sRGB + 알파 */
function parseColor(c: string): [number, number, number, number] {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const v = m[1].split(',').map(Number);
    return [v[0] / 255, v[1] / 255, v[2] / 255, v[3] ?? 1];
  }
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

const Z_UP = new THREE.Vector3(0, 0, 1);

/** flat: 구면 대신 평면(x = 경도, y = 위도, 라디안)에 놓는다. 경도는 ±180°를 넘어도 이어지게 펼친다 */
function buildRibbons(strips: readonly Strip[], flat: boolean): THREE.BufferGeometry {
  let total = 0;
  for (const s of strips) total += s.points.length;
  const pos = new Float32Array(total * 6);
  const side = new Float32Array(total * 6);
  const off = new Float32Array(total * 2);
  const lift = new Float32Array(total * 2);
  const col = new Float32Array(total * 8);
  const dist = new Float32Array(total * 2);
  const dash = new Float32Array(total * 2);
  const index: number[] = [];
  const t = new THREE.Vector3();
  let v = 0;
  for (const s of strips) {
    const n = s.points.length;
    if (n < 2) continue;
    const sph = s.points.map((q) => new THREE.Vector3(...latLonToVec3(q[0], q[1])));
    let pts = sph;
    if (flat) {
      let lon = s.points[0][1];
      pts = s.points.map((q, i) => {
        if (i > 0) {
          let d = q[1] - s.points[i - 1][1];
          if (d > 180) d -= 360;
          else if (d < -180) d += 360;
          lon += d;
        }
        return new THREE.Vector3(lon * DEG, q[0] * DEG, 0);
      });
    }
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) run += (sph[i].angleTo(sph[i - 1]) / DEG) * 8;
      // 진행 방향 × 위 = 옆
      t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).cross(flat ? Z_UP : pts[i]).normalize();
      for (let k = 0; k < 2; k++) {
        const o = v + k;
        pos.set([pts[i].x, pts[i].y, pts[i].z], o * 3);
        side.set([t.x, t.y, t.z], o * 3);
        const wd = typeof s.width === 'number' ? s.width : s.width[i];
        off[o] = k === 0 ? wd : -wd;
        lift[o] = s.lift;
        col.set(s.color, o * 4);
        dist[o] = run;
        dash[o] = s.dashed ? 1 : 0;
      }
      if (i < n - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 3));
  g.setAttribute('aOff', new THREE.BufferAttribute(off, 1));
  g.setAttribute('aLift', new THREE.BufferAttribute(lift, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
  g.setAttribute('aDash', new THREE.BufferAttribute(dash, 1));
  g.setIndex(index);
  return g;
}

/** 경위선(30° 간격, 적도는 점선) */
function graticuleStrips(): Strip[] {
  const out: Strip[] = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const points: LatLon[] = [];
    for (let lon = -180; lon <= 180; lon += 1) points.push([lat, lon]);
    out.push({ points, width: 1.5, color: [1, 1, 1, lat === 0 ? 0.5 : 0.14], dashed: lat === 0, lift: 1.0001 });
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const points: LatLon[] = [];
    for (let lat = 80; lat >= -80; lat -= 1) points.push([lat, lon]);
    out.push({ points, width: 1.5, color: [1, 1, 1, 0.14], dashed: false, lift: 1.0001 });
  }
  return out;
}

/** 멀리서도 보이도록 실제보다 크게 그린다. 카메라 거리 3.4(기본)일 때의 크기 */
const SHIP_SIZE = 0.04;
const PORT_SIZE = 0.06;
const TOWN_SIZE = 0.05;

/**
 * 3D 지구본, 또는 같은 그림을 평면에 펼친 세계지도(projection: 'flat').
 * 시뮬레이션 데이터를 모른다 — 등장방형 그림을 구(또는 평면)에 입히고,
 * 그 위에 로우폴리 항구·배 모델을 세운다. 누른 지점(또는 배)만 알려준다.
 * 평면에서는 x = 경도, y = 위도(라디안), z = 위. 크기 단위가 지구본과 같아 모델·선 굵기를 그대로 쓴다.
 * 좌우로 끝없이 이어지도록 같은 장면을 ±360° 옮겨 세 번 그린다.
 */
export class GlobeView {
  private readonly flat: boolean;
  /** 지표와 그 위의 모든 것(평면에서는 이 묶음을 옮겨 가며 세 번 그린다) */
  private readonly root = new THREE.Group();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  private readonly controls: OrbitControls;
  private readonly globe: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly landCanvas = document.createElement('canvas');
  private readonly seaCanvas = document.createElement('canvas');
  private landTex: THREE.CanvasTexture | null = null;
  private seaTex: THREE.CanvasTexture | null = null;
  private maskTex: THREE.DataTexture | null = null;
  private maskSource: Uint8Array | null = null;
  private viewH = 1;
  private readonly ribbonMaterial = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VS,
    fragmentShader: RIBBON_FS,
    uniforms: { uRadPerPx: { value: 0.002 }, uZoomK: { value: 1.2 }, uDashScale: { value: 1 }, uFlat: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private lineMesh: THREE.Mesh | null = null;
  private lineSource: readonly SurfaceLine[] | null = null;
  private routeMesh: THREE.Mesh | null = null;
  private routeKey = '';
  private readonly ringGroup = new THREE.Group();
  private ringKey = '';
  private rings: { obj: THREE.Object3D; radius: number }[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.84, 1, 96);
  private readonly ringGeoBold = new THREE.RingGeometry(0.8, 1, 96);
  private readonly discGeo = new THREE.CircleGeometry(0.84, 96);
  private readonly ringMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private frame = 0;
  private downAt: [number, number] | null = null;

  private readonly portGroup = new THREE.Group();
  private readonly shipGroup = new THREE.Group();
  private readonly ports = new Map<string, { mesh: THREE.Mesh; key: string }>();
  private readonly towns = new Map<string, { mesh: THREE.Mesh; key: string }>();
  private readonly ships = new Map<string, { mesh: THREE.Mesh; key: string }>();
  /** 같은 모양(선종·굴뚝 색, 항구 규모·나라 색)은 형상을 함께 쓴다 */
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly marker: THREE.Mesh;
  private selectedShip: string | null = null;
  private readonly labelLayer: HTMLDivElement;
  private labels: { v: THREE.Vector3; el: HTMLButtonElement }[] = [];
  private labelKey = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly onPick: (lat: number, lon: number) => void,
    private readonly onPickShip?: (id: string) => void,
    projection: 'globe' | 'flat' = 'globe',
  ) {
    const flat = (this.flat = projection === 'flat');
    this.ribbonMaterial.uniforms.uFlat.value = flat ? 1 : 0;
    this.scene.add(this.root);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.globe = new THREE.Mesh(
      flat ? new THREE.PlaneGeometry(Math.PI * 2, Math.PI) : new THREE.SphereGeometry(1, 256, 128),
      new THREE.ShaderMaterial({
        vertexShader: SURFACE_VS,
        fragmentShader: SURFACE_FS,
        uniforms: { tLand: { value: null }, tSea: { value: null }, tMask: { value: null }, uDetail: { value: 0 }, uFlat: { value: flat ? 1 : 0 } },
      }),
    );
    this.globe.visible = false; // 그림이 올 때까지
    this.root.add(this.globe);

    // 경위선: 한 번만 만든다
    const graticule = new THREE.Mesh(buildRibbons(graticuleStrips(), flat), this.ribbonMaterial);
    graticule.frustumCulled = false;
    graticule.renderOrder = 1;
    this.root.add(graticule);
    this.root.add(this.ringGroup);

    // 대기 테두리(지구본만)
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 128, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader:
          'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'varying vec3 vN; void main(){ float k = pow(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.45, 0.72, 1.0, 1.0) * clamp(k, 0.0, 1.0) * 1.6; }',
      }),
    );
    if (!flat) this.scene.add(halo);

    // 조명: 하늘·땅 반사광 + 카메라를 따라다니는 해(어디를 봐도 모델이 밝게 보인다)
    const sky = new THREE.HemisphereLight('#f4f1ea', '#5d6b7d', 1.5);
    if (flat) sky.position.set(0, 0, 1); // 평면에서는 z가 위
    this.scene.add(sky);
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(0.6, 1.2, 1);
    this.camera.add(sun);
    this.scene.add(this.camera);

    this.root.add(this.portGroup, this.shipGroup);

    // 고른 배 표시: 배 밑의 금색 고리
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 64),
      new THREE.MeshBasicMaterial({ color: '#ffd166', side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.root.add(this.marker);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    if (flat) {
      // 위에서 똑바로 내려다본다: 끌면 이동, 휠·핀치는 가리킨 곳을 향해 확대
      this.camera.position.set(-2 * DEG, 8 * DEG, 2.4);
      this.controls.target.set(-2 * DEG, 8 * DEG, 0);
      this.controls.enableRotate = false;
      this.controls.screenSpacePanning = true;
      this.controls.zoomToCursor = true;
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      this.controls.minDistance = 0.12;
    } else {
      const start = latLonToVec3(8, -2);
      this.camera.position.set(start[0] * 3.4, start[1] * 3.4, start[2] * 3.4);
      this.controls.enablePan = false;
      this.controls.rotateSpeed = 0.5;
      this.controls.minDistance = 1.12;
      this.controls.maxDistance = 6;
    }

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);

    // 이름표 층: 캔버스 위에 HTML로 얹는다(글자가 또렷하고, 눌러서 항구를 고를 수 있다)
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'globe-labels';
    container.appendChild(this.labelLayer);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();  }

  /** 지표 그림 교체(레이어·월이 바뀔 때). 항로·표식은 여기 없다 — setOverlay가 따로 그린다 */
  setSurface(surface: GlobeSurface): void {
    const u = this.globe.material.uniforms;
    const put = (canvas: HTMLCanvasElement, data: Uint8ClampedArray, old: THREE.CanvasTexture | null): THREE.CanvasTexture => {
      const resized = canvas.width !== surface.width || canvas.height !== surface.height;
      if (resized) {
        canvas.width = surface.width;
        canvas.height = surface.height;
      }
      canvas.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, surface.width, surface.height), 0, 0);
      if (old && !resized) {
        old.needsUpdate = true;
        return old;
      }
      old?.dispose();
      const tex = new THREE.CanvasTexture(canvas);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = THREE.RepeatWrapping;
      return tex;
    };
    u.tLand.value = this.landTex = put(this.landCanvas, surface.land, this.landTex);
    u.tSea.value = this.seaTex = put(this.seaCanvas, surface.sea, this.seaTex);
    u.uDetail.value = surface.detail ? 1 : 0;
    if (this.maskSource !== surface.mask.data) {
      this.maskSource = surface.mask.data;
      const { width: w, height: h, data } = surface.mask;
      // 자료는 북쪽이 첫 줄, 텍스처는 남쪽이 첫 줄
      const flipped = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) flipped.set(data.subarray(y * w, (y + 1) * w), (h - 1 - y) * w);
      this.maskTex?.dispose();
      const tex = new THREE.DataTexture(flipped, w, h, THREE.RedFormat);
      // 셰이더가 texelFetch로 직접 보간한다
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      u.tMask.value = this.maskTex = tex;
    }
    this.globe.visible = true;
  }

  /** 지표의 선(강·국경). 같은 배열이면 다시 만들지 않는다 */
  setSurfaceLines(lines: readonly SurfaceLine[]): void {
    if (lines === this.lineSource) return;
    this.lineSource = lines;
    if (this.lineMesh) {
      this.root.remove(this.lineMesh);
      this.lineMesh.geometry.dispose();
      this.lineMesh = null;
    }
    if (!lines.length) return;
    const strips = lines.map((l): Strip => ({ points: l.points, width: l.width, color: parseColor(l.color), dashed: false, lift: 1.00018 }));
    this.lineMesh = new THREE.Mesh(buildRibbons(strips, this.flat), this.ribbonMaterial);
    this.lineMesh.frustumCulled = false;
    this.lineMesh.renderOrder = 1.5;
    this.root.add(this.lineMesh);
  }

  /** 항로·항구 고리·고른 칸 표식. 텍스처가 아니라 구면 위 도형이라 확대해도 또렷하다 */
  setOverlay(opt: ComposeOptions): void {
    const routeKey = JSON.stringify(opt.routes);
    if (routeKey !== this.routeKey) {
      this.routeKey = routeKey;
      if (this.routeMesh) {
        this.root.remove(this.routeMesh);
        this.routeMesh.geometry.dispose();
        this.routeMesh = null;
      }
      const strips: Strip[] = [];
      for (const r of opt.routes) {
        const points = densifyPath(r.points, 1);
        // 굵은 항로는 어두운 테두리를 먼저 깐다
        if (r.width >= 3) strips.push({ points, width: r.width + 2.5, color: [10 / 255, 20 / 255, 40 / 255, 0.55], dashed: !!r.dashed, lift: 1.0003 });
        strips.push({ points, width: r.width, color: parseColor(r.color), dashed: !!r.dashed, lift: 1.00035 });
      }
      if (strips.length) {
        this.routeMesh = new THREE.Mesh(buildRibbons(strips, this.flat), this.ribbonMaterial);
        this.routeMesh.frustumCulled = false;
        this.routeMesh.renderOrder = 2;
        this.root.add(this.routeMesh);
      }
    }

    const ringKey = JSON.stringify([opt.cities, opt.marker]);
    if (ringKey === this.ringKey) return;
    this.ringKey = ringKey;
    this.ringGroup.clear();
    this.rings = [];
    const material = (color: string, opacity = 1) => {
      const key = `${color}|${opacity}`;
      let m = this.ringMaterials.get(key);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: false });
        this.ringMaterials.set(key, m);
      }
      return m;
    };
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, lat: number, lon: number, radiusDeg: number) => {
      const mesh = new THREE.Mesh(geo, mat);
      if (this.flat) {
        mesh.position.set(lon * DEG, lat * DEG, 0.0003);
      } else {
        const up = new THREE.Vector3(...latLonToVec3(lat, lon));
        mesh.quaternion.setFromUnitVectors(Z_UP, up);
        mesh.position.copy(up).multiplyScalar(1.0003);
      }
      mesh.renderOrder = 3;
      this.ringGroup.add(mesh);
      this.rings.push({ obj: mesh, radius: radiusDeg * DEG });
    };
    for (const c of opt.cities) {
      if (c.size === 0) continue; // 내륙 도시는 3D 모델만으로 충분하다(고리는 항구 표시)
      const r = ((11 + c.size * 2.5) / 8) * (c.selected ? 1.35 : 1);
      add(c.selected ? this.ringGeoBold : this.ringGeo, material(c.selected ? '#ffffff' : c.color), c.lat, c.lon, r);
    }
    if (opt.marker) {
      add(this.discGeo, material('#ffffff', 0.15), opt.marker[0], opt.marker[1], 9 / 8);
      add(this.ringGeoBold, material('#ffffff'), opt.marker[0], opt.marker[1], 9 / 8);
    }
  }

  private geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      g = make();
      this.geoCache.set(key, g);
    }
    return g;
  }

  /** 위치(up)와 뱃머리 방향 점으로 모델의 자세를 정한다: +x 앞, +y 위 */
  private place(obj: THREE.Object3D, lat: number, lon: number, headLat: number, headLon: number, lift: number): void {
    if (this.flat) {
      let dLon = headLon - lon;
      if (dLon > 180) dLon -= 360;
      else if (dLon < -180) dLon += 360;
      const fwd = new THREE.Vector3(dLon, headLat - lat, 0);
      if (fwd.lengthSq() < 1e-12) fwd.set(0, 1, 0);
      fwd.normalize();
      obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, Z_UP, new THREE.Vector3().crossVectors(fwd, Z_UP)));
      obj.position.set(lon * DEG, lat * DEG, lift);
      return;
    }
    const up = new THREE.Vector3(...latLonToVec3(lat, lon));
    const head = new THREE.Vector3(...latLonToVec3(headLat, headLon));
    const fwd = head.sub(up.clone().multiplyScalar(head.dot(up)));
    if (fwd.lengthSq() < 1e-12) fwd.set(0, 1, 0).sub(up.clone().multiplyScalar(up.y));
    if (fwd.lengthSq() < 1e-12) fwd.set(1, 0, 0);
    fwd.normalize();
    const side = new THREE.Vector3().crossVectors(fwd, up);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, up, side));
    obj.position.copy(up).multiplyScalar(1 + lift);
  }

  /** 항구 도시 모델(규모·나라 색이 바뀌면 다시 짓는다) */
  setPorts(ports: readonly GlobePort[]): void {
    const keep = new Set<string>();
    for (const p of ports) {
      keep.add(p.id);
      const key = `${p.id}|${p.level}|${p.countryColor}`;
      let e = this.ports.get(p.id);
      if (!e || e.key !== key) {
        if (e) this.portGroup.remove(e.mesh);
        const geo = this.geometry(`port|${key}`, () => buildPort({ cityId: p.id, level: p.level, countryColor: p.countryColor }));
        e = { mesh: new THREE.Mesh(geo, lowpolyMaterial()), key };
        e.mesh.userData.cityId = p.id;
        this.portGroup.add(e.mesh);
        this.ports.set(p.id, e);
      }
      this.place(e.mesh, p.lat, p.lon, p.seaLat, p.seaLon, 0.0006);
    }
    for (const [id, e] of this.ports) {
      if (!keep.has(id)) {
        this.portGroup.remove(e.mesh);
        this.ports.delete(id);
      }
    }
  }

  /** 내륙 도시 모델(배치는 고정, 나라 색이 바뀌면 다시 짓는다) */
  setTowns(towns: readonly GlobeTown[]): void {
    const keep = new Set<string>();
    for (const t of towns) {
      keep.add(t.id);
      const key = `${t.id}|${t.size}|${t.countryColor}`;
      let e = this.towns.get(t.id);
      if (!e || e.key !== key) {
        if (e) this.portGroup.remove(e.mesh);
        const geo = this.geometry(`town|${key}`, () => buildTown({ townId: t.id, size: t.size, countryColor: t.countryColor }));
        e = { mesh: new THREE.Mesh(geo, lowpolyMaterial()), key };
        this.portGroup.add(e.mesh);
        this.towns.set(t.id, e);
      }
      // 내륙 도시는 북쪽을 앞으로 둔다
      this.place(e.mesh, t.lat, t.lon, t.lat + 1, t.lon, 0.0006);
    }
    for (const [id, e] of this.towns) {
      if (!keep.has(id)) {
        this.portGroup.remove(e.mesh);
        this.towns.delete(id);
      }
    }
  }

  /** 배 모델(자주 불러도 가볍다: 자세만 바꾼다) */
  setShips(ships: readonly GlobeShip[]): void {
    const keep = new Set<string>();
    for (const s of ships) {
      keep.add(s.id);
      const key = `${s.kind}|${s.funnel}`;
      let e = this.ships.get(s.id);
      if (!e || e.key !== key) {
        if (e) this.shipGroup.remove(e.mesh);
        const geo = this.geometry(`ship|${key}`, () => buildShip({ kind: s.kind, funnel: s.funnel }));
        e = { mesh: new THREE.Mesh(geo, lowpolyMaterial()), key };
        e.mesh.userData.shipId = s.id;
        this.shipGroup.add(e.mesh);
        this.ships.set(s.id, e);
      }
      e.mesh.userData.pickable = !!s.pickable;
      this.place(e.mesh, s.lat, s.lon, s.headLat, s.headLon, 0.0004);
    }
    for (const [id, e] of this.ships) {
      if (!keep.has(id)) {
        this.shipGroup.remove(e.mesh);
        this.ships.delete(id);
      }
    }
  }

  /** 이름표(내용이 같으면 다시 만들지 않는다) */
  setLabels(list: readonly GlobeLabel[]): void {
    const key = JSON.stringify(list);
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.labelLayer.replaceChildren();
    this.labels = list.map((l) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `globe-label${l.emphasis ? ' on' : ''}${l.tone ? ` ${l.tone}` : ''}`;
      const name = document.createElement('span');
      name.textContent = l.text;
      el.appendChild(name);
      if (l.badge) {
        const b = document.createElement('b');
        b.textContent = l.badge;
        el.appendChild(b);
      }
      el.addEventListener('click', () => this.onPick(l.lat, l.lon));
      this.labelLayer.appendChild(el);
      return { v: this.flat ? new THREE.Vector3(l.lon * DEG, l.lat * DEG, 0) : new THREE.Vector3(...latLonToVec3(l.lat, l.lon)), el };
    });
  }

  /** 평면: 좌우로 이어진 사본 가운데 화면 중앙에 가장 가까운 것의 x */
  private nearestCopyX(x: number): number {
    const span = Math.PI * 2;
    return x + span * Math.round((this.camera.position.x - x) / span);
  }

  private placeLabels(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (this.flat) {
      const p = new THREE.Vector3();
      for (const l of this.labels) {
        p.set(this.nearestCopyX(l.v.x), l.v.y, 0).project(this.camera);
        if (Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) {
          l.el.style.display = 'none';
          continue;
        }
        l.el.style.display = '';
        l.el.style.opacity = '1';
        l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -150%)`;
      }
      return;
    }
    const camDir = this.camera.position.clone().normalize();
    const horizon = 1 / this.camera.position.length();
    for (const l of this.labels) {
      const facing = l.v.dot(camDir);
      if (facing < horizon + 0.05) {
        l.el.style.display = 'none';
        continue;
      }
      const p = l.v.clone().project(this.camera);
      l.el.style.display = '';
      l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -150%)`;
      // 가장자리로 갈수록 흐리게
      l.el.style.opacity = String(Math.min(1, (facing - horizon) * 6));
    }
  }

  /** 고른 배(금색 고리로 표시). null이면 표시 없음 */
  selectShip(id: string | null): void {
    this.selectedShip = id;
  }

  /** 지정한 위경도가 화면 중앙에 오도록 돌린다 */
  lookAt(lat: number, lon: number): void {
    if (this.flat) {
      this.camera.position.set(lon * DEG, lat * DEG, this.camera.position.z);
      this.controls.target.set(lon * DEG, lat * DEG, 0);
      this.controls.update();
      return;
    }
    const v = latLonToVec3(lat, lon);
    const d = this.camera.position.length();
    this.camera.position.set(v[0] * d, v[1] * d, v[2] * d);
    this.controls.update();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.landTex?.dispose();
    this.seaTex?.dispose();
    this.maskTex?.dispose();
    this.routeMesh?.geometry.dispose();
    this.lineMesh?.geometry.dispose();
    this.ribbonMaterial.dispose();
    this.ringGeo.dispose();
    this.ringGeoBold.dispose();
    this.discGeo.dispose();
    for (const m of this.ringMaterials.values()) m.dispose();
    this.globe.geometry.dispose();
    this.globe.material.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }

  private readonly onDown = (e: PointerEvent) => {
    this.downAt = [e.clientX, e.clientY];
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return; // 끌기는 회전
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.flat) {
      if (this.onPickShip) {
        let best: string | null = null;
        let bestPx = 16;
        const v = new THREE.Vector3();
        for (const [id, s] of this.ships) {
          if (!s.mesh.userData.pickable) continue;
          v.set(this.nearestCopyX(s.mesh.position.x), s.mesh.position.y, 0).project(this.camera);
          const px = Math.hypot(((v.x - ndc.x) / 2) * rect.width, ((v.y - ndc.y) / 2) * rect.height);
          if (px < bestPx) {
            bestPx = px;
            best = id;
          }
        }
        if (best) {
          this.onPickShip(best);
          return;
        }
      }
      const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(Z_UP, 0), new THREE.Vector3());
      if (!hit || Math.abs(hit.y) > Math.PI / 2) return;
      this.onPick(hit.y / DEG, wrapLon(hit.x / DEG));
      return;
    }
    const globeHit = this.raycaster.intersectObject(this.globe)[0];
    // 배가 먼저: 작은 배도 누르기 쉽게 화면에서 가까운(반지름 16px) 배를 고른다. 지구 뒤편 배는 제외
    if (this.onPickShip) {
      const camDir = this.camera.position.clone().normalize();
      let best: string | null = null;
      let bestPx = 16;
      for (const [id, s] of this.ships) {
        if (!s.mesh.userData.pickable) continue;
        if (s.mesh.position.clone().normalize().dot(camDir) < 1 / this.camera.position.length()) continue;
        const v = s.mesh.position.clone().project(this.camera);
        const px = Math.hypot(((v.x - ndc.x) / 2) * rect.width, ((v.y - ndc.y) / 2) * rect.height);
        if (px < bestPx) {
          bestPx = px;
          best = id;
        }
      }
      if (best) {
        this.onPickShip(best);
        return;
      }
    }
    if (!globeHit) return;
    const p = globeHit.point.normalize();
    this.onPick((Math.asin(p.y) * 180) / Math.PI, (Math.atan2(-p.z, p.x) * 180) / Math.PI);
  };

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    // 세로로 긴 화면에서도 지구본이 잘리지 않게
    this.camera.fov = !this.flat && w / h < 1 ? 38 / Math.max(0.55, w / h) : 38;
    this.camera.updateProjectionMatrix();
    if (this.flat) {
      // 가장 멀리 물러나도 지도 밖(위아래 빈 곳, 좌우 한 바퀴 이상)이 보이지 않게
      const t = Math.tan((this.camera.fov * DEG) / 2);
      this.controls.maxDistance = Math.min(Math.PI / 2 / t, Math.PI / (t * (w / h)));
    }
  }

  private readonly loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.flat) {
      // 위아래는 지도 안에 가두고, 좌우는 한 바퀴 넘으면 되감는다(카메라와 보는 점을 함께 옮긴다)
      const cam = this.camera.position;
      const tg = this.controls.target;
      const limit = Math.max(0, Math.PI / 2 - cam.z * Math.tan((this.camera.fov * DEG) / 2));
      const dy = Math.max(-limit, Math.min(limit, tg.y)) - tg.y;
      const dx = tg.x > Math.PI ? -Math.PI * 2 : tg.x < -Math.PI ? Math.PI * 2 : 0;
      cam.x += dx;
      tg.x += dx;
      cam.y += dy;
      tg.y += dy;
    }
    // 지표에서 카메라까지의 높이
    const alt = this.flat ? this.camera.position.z : this.camera.position.length() - 1;
    const dist = alt + 1;
    // 가까이 갈수록 천천히 돌게
    this.controls.rotateSpeed = 0.12 + 0.14 * alt;
    // 모델 크기: 멀리서는 실제보다 크게(보이도록), 다가갈수록 작아지되 화면에서는 점점 크게 보인다
    const f = Math.pow(Math.max(0.05, dist - 1) / 2.4, 0.6);
    for (const e of this.ships.values()) e.mesh.scale.setScalar(SHIP_SIZE * f);
    for (const e of this.ports.values()) e.mesh.scale.setScalar(PORT_SIZE * Math.max(0.45, f));
    for (const e of this.towns.values()) e.mesh.scale.setScalar(TOWN_SIZE * Math.max(0.45, f));
    const k = Math.max(0.45, f);
    for (const r of this.rings) r.obj.scale.setScalar(r.radius * k);
    // 띠 굵기: 화면 1px이 지표에서 몇 라디안인지 + 다가갈수록 조금씩 굵게
    const radPerPx = (2 * (dist - 1) * Math.tan((this.camera.fov * DEG) / 2)) / this.viewH;
    const zoomK = 1.2 * Math.pow(2.4 / Math.max(0.05, dist - 1), 0.3);
    const ru = this.ribbonMaterial.uniforms;
    ru.uRadPerPx.value = radPerPx;
    ru.uZoomK.value = zoomK;
    // 점선 간격도 화면 기준. 2의 거듭제곱으로 끊어 확대 중에 점선이 흘러 다니지 않게 한다
    ru.uDashScale.value = Math.pow(2, Math.round(Math.log2((zoomK * radPerPx * 8) / DEG)));
    // 가까운 면을 지표에 바짝 붙여 깊이 정밀도를 확보한다(표면에 얇게 겹친 띠·고리가 떨리지 않게)
    this.camera.near = Math.max(0.01, (dist - 1) * 0.3);
    this.camera.updateProjectionMatrix();
    const sel = this.selectedShip ? this.ships.get(this.selectedShip) : undefined;
    this.marker.visible = !!sel;
    if (sel) {
      this.marker.position.copy(sel.mesh.position);
      this.marker.quaternion.copy(sel.mesh.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      this.marker.scale.setScalar(SHIP_SIZE * f);
    }
    if (this.flat) {
      // 좌우로 이어지는 지도: 같은 장면을 한 바퀴씩 옮겨 세 번 그린다
      this.renderer.autoClear = false;
      this.renderer.clear();
      for (const turn of [-1, 0, 1]) {
        this.root.position.x = turn * Math.PI * 2;
        this.renderer.render(this.scene, this.camera);
      }
      this.root.position.x = 0;
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.placeLabels();
  };
}
