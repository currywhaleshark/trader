import { byteToFlow } from '../sim/world/gen/hydrology';
import { CLIMATE_ZONES, PRECIP_SCALE, SEA_ZONE, TEMP_SCALE, type World } from '../sim/world/types';

/**
 * World(데이터) -> 등장방형 RGBA 그림. DOM을 쓰지 않는 순수 함수라
 * 브라우저(지구본 텍스처·2D 지도)와 Node(PNG 미리보기)가 함께 쓴다.
 */
export type LayerId =
  | 'terrain'
  | 'countries'
  | 'climate'
  | 'temperature'
  | 'precipitation'
  | 'crops'
  | 'harvest'
  | 'resources'
  | 'sea';

export interface LayerDef {
  id: LayerId;
  name: string;
  hint: string;
  monthly?: boolean;
}

export const LAYERS: LayerDef[] = [
  { id: 'terrain', name: '지형', hint: '땅의 높낮이와 강, 바다의 깊이' },
  { id: 'countries', name: '국가', hint: '여섯 나라의 영토' },
  { id: 'climate', name: '기후대', hint: '기온과 강수로 나눈 기후 구분' },
  { id: 'temperature', name: '기온', hint: '달마다 달라지는 평균 기온', monthly: true },
  { id: 'precipitation', name: '강수', hint: '달마다 달라지는 비의 양', monthly: true },
  { id: 'crops', name: '농업', hint: '작물을 기르기 좋은 곳' },
  { id: 'harvest', name: '수확 시기', hint: '곡물을 가장 많이 거두는 달' },
  { id: 'resources', name: '자원', hint: '철광석과 원유가 묻힌 곳' },
  { id: 'sea', name: '바다·항로', hint: '중앙해·외해·관문 해협과 항해 위험' },
];

export interface BaseLayerOptions {
  layer: LayerId;
  /** 0 = 1월 */
  month: number;
  cropId: string;
  /** 격자 한 칸을 몇 픽셀로 그릴지 */
  scale: number;
  /**
   * 육지 그림(data)과 바다 그림(sea)을 따로 만든다. 해안선은 굽지 않는다 —
   * 지구본 셰이더가 육지 마스크로 두 그림을 갈라, 확대해도 해안이 또렷하다.
   */
  split?: boolean;
}

export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** split일 때만: 바다 쪽 색 */
  sea?: Uint8ClampedArray;
}

/** 격자 해상도의 육지 마스크(육지 255, 바다 0). 선형 보간해 0.5에서 자르면 해안선이 된다 */
export function landMask(world: World): { width: number; height: number; data: Uint8Array } {
  const { width, height } = world.grid;
  const data = new Uint8Array(width * height);
  const id = world.layers.continentId;
  for (let i = 0; i < data.length; i++) data[i] = id[i] ? 255 : 0;
  return { width, height, data };
}

type RGB = [number, number, number];
type Stop = [number, number, number, number];

function ramp(stops: Stop[], t: number, out: RGB): void {
  if (t <= stops[0][0]) {
    out[0] = stops[0][1]; out[1] = stops[0][2]; out[2] = stops[0][3];
    return;
  }
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const a = stops[k - 1];
      const b = stops[k];
      const f = (t - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * f;
      out[1] = a[2] + (b[2] - a[2]) * f;
      out[2] = a[3] + (b[3] - a[3]) * f;
      return;
    }
  }
  const last = stops[stops.length - 1];
  out[0] = last[1]; out[1] = last[2]; out[2] = last[3];
}

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export const TEMP_STOPS: Stop[] = [
  [-30, 70, 40, 140], [-15, 60, 100, 200], [0, 150, 205, 235], [10, 235, 240, 190],
  [20, 250, 200, 90], [28, 235, 110, 50], [36, 160, 25, 35],
];
export const PRECIP_STOPS: Stop[] = [
  [0, 225, 205, 160], [25, 215, 215, 150], [60, 150, 205, 130], [120, 70, 170, 150],
  [220, 40, 110, 185], [400, 60, 45, 140],
];
export const SUIT_STOPS: Stop[] = [
  [0, 150, 145, 135], [0.2, 185, 180, 130], [0.5, 150, 195, 95], [1, 25, 125, 50],
];
const SEA_STOPS: Stop[] = [
  [-4200, 16, 44, 92], [-1500, 24, 70, 128], [-220, 40, 104, 165], [-20, 66, 138, 190],
];
const ELEV_STOPS: Stop[] = [
  [0, 0, 0, 0], [900, 0.25, 0.25, 0.25], [2000, 0.7, 0.7, 0.7], [3400, 1, 1, 1],
];
/** 수확 월(1~12) 색: 북반구 가을(9~10월)과 남반구 가을(3~4월)이 정반대 색이 되게 한 색상환 */
export const MONTH_COLORS: RGB[] = [
  [70, 110, 200], [60, 150, 200], [50, 180, 170], [70, 185, 110], [140, 195, 70], [205, 200, 60],
  [235, 170, 50], [235, 125, 50], [220, 80, 70], [200, 70, 130], [160, 80, 180], [105, 90, 200],
];

interface Derived {
  shade: Float32Array;
  annualPrecip: Float32Array;
  meanTemp: Float32Array;
}
const derivedCache = new WeakMap<World, Derived>();

function getDerived(world: World): Derived {
  const hit = derivedCache.get(world);
  if (hit) return hit;
  const { width: w, height: h } = world.grid;
  const n = w * h;
  const L = world.layers;
  const shade = new Float32Array(n).fill(1);
  const annualPrecip = new Float32Array(n);
  const meanTemp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    let t = 0;
    for (let m = 0; m < 12; m++) {
      p += L.precipMonthly[m * n + i];
      t += L.tempMonthly[m * n + i];
    }
    annualPrecip[i] = p * PRECIP_SCALE;
    meanTemp[i] = (t / 12) * TEMP_SCALE;
  }
  const land = (i: number) => (L.elevation[i] > 0 ? L.elevation[i] : 0);
  for (let y = 1; y < h - 1; y++) {
    const cos = Math.max(0.2, Math.cos(((90 - ((y + 0.5) * 180) / h) * Math.PI) / 180));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (L.elevation[i] <= 0) continue;
      const xl = x > 0 ? x - 1 : w - 1;
      const xr = x < w - 1 ? x + 1 : 0;
      // 북서쪽에서 비추는 빛
      const gx = (land(y * w + xl) - land(y * w + xr)) / cos;
      const gy = land((y - 1) * w + x) - land((y + 1) * w + x);
      const s = (gx + gy) * 0.00045;
      shade[i] = 1 + (s > 0.38 ? 0.38 : s < -0.42 ? -0.42 : s);
    }
  }
  const d = { shade, annualPrecip, meanTemp };
  derivedCache.set(world, d);
  return d;
}

const idx = new Int32Array(4);
const wt = new Float64Array(4);

export function renderBaseLayer(world: World, opt: BaseLayerOptions): RasterImage {
  const { width: w, height: h } = world.grid;
  const n = w * h;
  const S = opt.scale;
  const W = w * S;
  const H = h * S;
  const L = world.layers;
  const D = getDerived(world);
  const data = new Uint8ClampedArray(W * H * 4);
  const pixLand = new Uint8Array(W * H);
  const pixCountry = new Uint8Array(W * H);
  const month = ((opt.month % 12) + 12) % 12;
  const tempM = L.tempMonthly.subarray(month * n, (month + 1) * n);
  const precipM = L.precipMonthly.subarray(month * n, (month + 1) * n);
  const crop = L.cropSuitability[opt.cropId] ?? Object.values(L.cropSuitability)[0];
  const resLayers = world.config.resources.map((r) => ({ spec: r, layer: L.resourceRichness[r.id] }));
  const countryRgb = world.countries.map((c) => hexToRgb(c.color));
  const zoneRgb = CLIMATE_ZONES.map((z) => hexToRgb(z.color));
  const riverMinByte = Math.round(Math.log2(1 + world.config.hydrology.riverMinFlow) * 16);
  const rgb: RGB = [0, 0, 0];
  const tmp: RGB = [0, 0, 0];

  /** 같은 종류(육지/바다)의 셀만 섞는 쌍선형 표본 */
  const sample = (arr: ArrayLike<number>, count: number): number => {
    let s = 0;
    let ws = 0;
    for (let k = 0; k < count; k++) {
      s += arr[idx[k]] * wt[k];
      ws += wt[k];
    }
    return s / ws;
  };

  const split = !!opt.split;
  const seaData = split ? new Uint8ClampedArray(W * H * 4) : null;
  let count = 0;
  let near = -1;
  let nearW = -1;
  let p = 0;
  let wantLand = false;
  const consider = (c: number, weight: number) => {
    if ((L.continentId[c] !== 0) !== wantLand) return;
    idx[count] = c;
    wt[count] = weight + 1e-6;
    count++;
    if (weight > nearW) {
      nearW = weight;
      near = c;
    }
  };
  /**
   * 구분값(나라·기후대 등)은 가중치 합이 가장 큰 값을 고른다. 가장 가까운 칸을 쓰면
   * 경계가 네모 계단이 되지만, 이렇게 하면 모서리가 깎여 훨씬 매끄럽다.
   */
  const major = (arr: ArrayLike<number>): number => {
    let best = arr[idx[0]];
    let bestW = -1;
    for (let a = 0; a < count; a++) {
      const v = arr[idx[a]];
      let s = 0;
      for (let b = 0; b < count; b++) if (arr[idx[b]] === v) s += wt[b];
      if (s > bestW) {
        bestW = s;
        best = v;
      }
    }
    return best;
  };

  for (let py = 0; py < H; py++) {
    const gy = (py + 0.5) / S - 0.5;
    let y0 = Math.floor(gy);
    const fy = gy - y0;
    let y1 = y0 + 1;
    if (y0 < 0) y0 = 0;
    if (y1 > h - 1) y1 = h - 1;
    for (let px = 0; px < W; px++) {
      const gx = (px + 0.5) / S - 0.5;
      const xf = Math.floor(gx);
      const fx = gx - xf;
      const x0 = (xf + w) % w;
      const x1 = (xf + 1 + w) % w;
      const c00 = y0 * w + x0;
      const c10 = y0 * w + x1;
      const c01 = y1 * w + x0;
      const c11 = y1 * w + x1;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const landness =
        (L.continentId[c00] ? w00 : 0) + (L.continentId[c10] ? w10 : 0) +
        (L.continentId[c01] ? w01 : 0) + (L.continentId[c11] ? w11 : 0);
      p = py * W + px;
      // split: 해안 칸에서는 육지 색과 바다 색을 둘 다 만든다(한쪽뿐인 곳은 같은 색을 양쪽에 쓴다)
      const doLand = split ? landness > 0 : landness > 0.5;
      const doSea = split ? landness < 1 : !doLand;
      for (let pass = 0; pass < 2; pass++) {
      wantLand = pass === 1;
      if (wantLand ? !doLand : !doSea) continue;
      const out = split && !wantLand ? seaData! : data;
      count = 0;
      near = -1;
      nearW = -1;
      consider(c00, w00);
      consider(c10, w10);
      consider(c01, w01);
      consider(c11, w11);

      if (!wantLand) {
        // --- 바다
        const depth = sample(L.elevation, count);
        ramp(SEA_STOPS, depth, rgb);
        if (opt.layer === 'temperature') {
          ramp(TEMP_STOPS, sample(tempM, count) * TEMP_SCALE, tmp);
          mix(rgb, tmp, 0.55);
        } else if (opt.layer === 'precipitation') {
          ramp(PRECIP_STOPS, sample(precipM, count) * PRECIP_SCALE, tmp);
          mix(rgb, tmp, 0.45);
        } else if (opt.layer === 'sea') {
          const z = major(L.seaZone);
          if (z === SEA_ZONE.CENTRAL) set(rgb, 40, 150, 160);
          else if (z >= SEA_ZONE.GATE_BASE) set(rgb, 240, 150, 40);
          else if (z === SEA_ZONE.NON_NAVIGABLE) set(rgb, 215, 228, 238);
          else set(rgb, 45, 95, 165);
          const risk = sample(L.seaRisk, count) / 255;
          if (z !== SEA_ZONE.NON_NAVIGABLE) {
            set(tmp, 120, 30, 60);
            mix(rgb, tmp, risk * 0.6);
          }
        } else if (opt.layer === 'resources') {
          desaturate(rgb, 0.5);
          for (const r of resLayers) {
            const v = sample(r.layer, count) / 255;
            if (v > 0.05) {
              set(tmp, r.spec.kind === 'oil' ? 30 : 170, r.spec.kind === 'oil' ? 20 : 60, r.spec.kind === 'oil' ? 40 : 40);
              mix(rgb, tmp, Math.min(0.85, v * 1.3));
            }
          }
        } else if (opt.layer !== 'terrain') {
          desaturate(rgb, 0.35);
        }
      } else {
        // --- 육지
        pixLand[p] = 1;
        const country = major(L.countryId);
        pixCountry[p] = country;
        const elev = sample(L.elevation, count);
        let shade = sample(D.shade, count);
        switch (opt.layer) {
          case 'terrain': {
            naturalColor(sample(D.annualPrecip, count), sample(D.meanTemp, count), elev, rgb);
            // 강: 칸 단위 네모가 아니라, 강 칸의 비율을 보간해 0.5 언저리에서 부드럽게 자른다
            let on = 0;
            let strength = 0;
            let ws = 0;
            for (let k = 0; k < count; k++) {
              ws += wt[k];
              const f = L.riverFlow[idx[k]];
              if (f < riverMinByte) continue;
              on += wt[k];
              strength += wt[k] * Math.min(0.85, 0.45 + byteToFlow(f) / 12000);
            }
            const edge = (on / ws - 0.42) / 0.16;
            if (edge > 0) {
              set(tmp, 70, 140, 205);
              mix(rgb, tmp, (strength / on) * (edge > 1 ? 1 : edge));
            }
            break;
          }
          case 'countries': {
            const c = country;
            const base = c ? countryRgb[c - 1] : ([150, 150, 150] as RGB);
            set(rgb, base[0], base[1], base[2]);
            shade = 1 + (shade - 1) * 0.7;
            break;
          }
          case 'climate': {
            const z = zoneRgb[major(L.climateZone)];
            set(rgb, z[0], z[1], z[2]);
            shade = 1 + (shade - 1) * 0.5;
            break;
          }
          case 'temperature':
            ramp(TEMP_STOPS, sample(tempM, count) * TEMP_SCALE, rgb);
            shade = 1 + (shade - 1) * 0.4;
            break;
          case 'precipitation':
            ramp(PRECIP_STOPS, sample(precipM, count) * PRECIP_SCALE, rgb);
            shade = 1 + (shade - 1) * 0.4;
            break;
          case 'crops':
            ramp(SUIT_STOPS, sample(crop, count) / 255, rgb);
            shade = 1 + (shade - 1) * 0.5;
            break;
          case 'harvest': {
            const m = major(L.harvestMonth);
            if (m) {
              const c = MONTH_COLORS[m - 1];
              set(rgb, c[0], c[1], c[2]);
            } else set(rgb, 150, 146, 138);
            shade = 1 + (shade - 1) * 0.5;
            break;
          }
          case 'resources': {
            set(rgb, 196, 192, 180);
            for (const r of resLayers) {
              const v = sample(r.layer, count) / 255;
              if (v > 0.05) {
                set(tmp, r.spec.kind === 'oil' ? 35 : 185, r.spec.kind === 'oil' ? 25 : 65, r.spec.kind === 'oil' ? 45 : 35);
                mix(rgb, tmp, Math.min(0.92, v * 1.4));
              }
            }
            break;
          }
          case 'sea':
            set(rgb, 120, 124, 122);
            shade = 1 + (shade - 1) * 0.6;
            break;
        }
        rgb[0] *= shade;
        rgb[1] *= shade;
        rgb[2] *= shade;
      }
      out[p * 4] = rgb[0];
      out[p * 4 + 1] = rgb[1];
      out[p * 4 + 2] = rgb[2];
      out[p * 4 + 3] = 255;
      }
      if (seaData && doLand !== doSea) {
        // 한쪽뿐인 곳: 멀리서 축소해 볼 때 색이 번지지 않게 같은 색으로 채운다
        const from = doLand ? data : seaData;
        const to = doLand ? seaData : data;
        const o = p * 4;
        to[o] = from[o];
        to[o + 1] = from[o + 1];
        to[o + 2] = from[o + 2];
        to[o + 3] = 255;
      }
    }
  }

  // 해안선과 국경
  const showBorders = opt.layer !== 'sea';
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const p = py * W + px;
      if (!pixLand[p]) continue;
      const r = py * W + ((px + 1) % W);
      const d = py < H - 1 ? p + W : p;
      const l = py * W + ((px - 1 + W) % W);
      const u = py > 0 ? p - W : p;
      if (!pixLand[r] || !pixLand[d] || !pixLand[l] || !pixLand[u]) {
        if (!split) darken(data, p, 0.62);
      } else if (showBorders && (pixCountry[r] !== pixCountry[p] || pixCountry[d] !== pixCountry[p])) {
        const o = p * 4;
        data[o] = data[o] * 0.35 + 30;
        data[o + 1] = data[o + 1] * 0.35 + 25;
        data[o + 2] = data[o + 2] * 0.35 + 30;
      }
    }
  }
  return seaData ? { width: W, height: H, data, sea: seaData } : { width: W, height: H, data };
}

function set(c: RGB, r: number, g: number, b: number): void {
  c[0] = r; c[1] = g; c[2] = b;
}

function mix(c: RGB, o: RGB, t: number): void {
  c[0] += (o[0] - c[0]) * t;
  c[1] += (o[1] - c[1]) * t;
  c[2] += (o[2] - c[2]) * t;
}

function desaturate(c: RGB, t: number): void {
  const g = c[0] * 0.3 + c[1] * 0.5 + c[2] * 0.2;
  c[0] += (g - c[0]) * t;
  c[1] += (g - c[1]) * t;
  c[2] += (g - c[2]) * t;
}

function darken(data: Uint8ClampedArray, p: number, f: number): void {
  data[p * 4] *= f;
  data[p * 4 + 1] *= f;
  data[p * 4 + 2] *= f;
}

/** 위성사진풍 지표색: 강수(메마름↔푸름), 기온(눈), 고도(암석) */
function naturalColor(annualPrecip: number, meanTemp: number, elev: number, out: RGB): void {
  const wet = Math.max(0, Math.min(1, (annualPrecip - 150) / 1250));
  const lush = wet * wet * (3 - 2 * wet);
  // 메마른 땅 -> 초원 -> 숲
  out[0] = 214 + (58 - 214) * lush;
  out[1] = 190 + (128 - 190) * lush;
  out[2] = 138 + (62 - 138) * lush;
  if (lush > 0.75 && meanTemp > 20) {
    const t = (lush - 0.75) * 4;
    out[0] += (30 - out[0]) * t * 0.6;
    out[1] += (105 - out[1]) * t * 0.6;
    out[2] += (50 - out[2]) * t * 0.6;
  }
  const rock: RGB = [0, 0, 0];
  ramp(ELEV_STOPS, elev, rock);
  const k = rock[0];
  out[0] += (150 - out[0]) * k * 0.8;
  out[1] += (132 - out[1]) * k * 0.8;
  out[2] += (112 - out[2]) * k * 0.8;
  const snow = Math.max(0, Math.min(1, (-meanTemp - 1) / 7));
  out[0] += (240 - out[0]) * snow;
  out[1] += (244 - out[1]) * snow;
  out[2] += (248 - out[2]) * snow;
}
