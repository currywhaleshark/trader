import { clamp, smoothstep, trapezoid } from '../../core/math';
import { DEG } from '../../core/sphere';
import { PRECIP_SCALE, TEMP_SCALE } from '../types';
import type { GenContext } from './context';

/** 북반구 여름에 +1, 겨울에 -1 (m: 0 = 1월) */
export function seasonFactor(month: number): number {
  return Math.cos((2 * Math.PI * (month + 0.5 - 7)) / 12);
}

/** 기온 T(°C)의 공기가 품을 수 있는 수증기(28°C = 1) */
function saturation(tempC: number, k: number): number {
  return Math.min(1.3, Math.exp(k * (tempC - 28)));
}

export interface ClimateLayers {
  /** 월평균 기온, 0.5°C 단위, 12 × n */
  tempMonthly: Int8Array;
  /** 월 강수, 4mm 단위, 12 × n */
  precipMonthly: Uint8Array;
}

/**
 * 제작 단계 기후 근사 (런타임에는 다시 계산하지 않는다).
 *  기온 = 위도별 해수면 기온 + 계절 진폭(위도·대륙도) - 고도 감률 + 해류 효과
 *  강수 = 탁월풍을 따라 흐르는 수증기의 이류(바다에서 충전, 육지에서 강수, 지형성 강수와 비그늘)
 *         × 위도별 기압대 계수 + 적도 수렴대의 대류성 강수.  풍대와 수렴대는 계절에 따라 남북으로 이동한다.
 */
export function generateClimate(
  ctx: GenContext,
  elevation: Int16Array,
  isLand: Uint8Array,
  coastDist: Float32Array,
): ClimateLayers {
  const { cfg, grid, n, rowLat, metrics } = ctx;
  const c = cfg.climate;
  const w = grid.width;
  const h = grid.height;
  const tempMonthly = new Int8Array(12 * n);
  const precipMonthly = new Uint8Array(12 * n);

  // --- 해류 효과: 아열대 서해안은 한류(서늘·건조), 중위도 서해안은 난류(온화·습윤)
  const currentT = new Float32Array(n);
  const currentP = new Float32Array(n).fill(1);
  const win = Math.max(1, Math.round(c.currentWindowDeg / (360 / w)));
  for (let y = 0; y < h; y++) {
    const a = Math.abs(rowLat[y]);
    const sub = trapezoid(a, [10, 18, 30, 37]);
    const mid = trapezoid(a, [37, 44, 62, 70]);
    if (sub === 0 && mid === 0) continue;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!isLand[i]) continue;
      const near = 1 - smoothstep(0, c.currentReachKm, coastDist[i]);
      if (near <= 0) continue;
      let west = 0;
      let east = 0;
      for (let k = 1; k <= win; k++) {
        if (!isLand[y * w + ((x - k + w) % w)]) west++;
        if (!isLand[y * w + ((x + k) % w)]) east++;
      }
      const facing = ((west - east) / win) * near; // +: 서쪽이 바다인 해안
      currentT[i] = c.currentTempC * facing * (mid - sub);
      currentP[i] = clamp(1 - 0.55 * Math.max(0, facing) * sub + 0.2 * Math.max(0, facing) * mid, 0.3, 1.3);
    }
  }

  // --- 기온
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) height[i] = elevation[i] > 0 ? elevation[i] : 0;
  const rowSeaLevel = new Float64Array(h);
  const rowAmp = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    const sl = Math.sin(Math.abs(rowLat[y]) * DEG);
    rowSeaLevel[y] = c.equatorTempC - c.poleDropC * sl * sl;
    rowAmp[y] = Math.pow(sl, 0.7) * (rowLat[y] >= 0 ? 1 : -1);
  }
  for (let m = 0; m < 12; m++) {
    const s = seasonFactor(m);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const cont = isLand[i] ? smoothstep(0, c.continentalityKm, coastDist[i]) : 0;
        const amp = c.seasonalAmpOceanC + (c.seasonalAmpLandC - c.seasonalAmpOceanC) * cont;
        const t =
          rowSeaLevel[y] + s * amp * rowAmp[y] - (c.lapseRateCPerKm * height[i]) / 1000 + currentT[i];
        tempMonthly[m * n + i] = clamp(Math.round(t / TEMP_SCALE), -127, 127);
      }
    }
  }

  // --- 강수
  // 육지 공기의 바탕 습도(포화 대비): 해안에서 높고 내륙으로 갈수록 증발산 수준까지 낮아진다
  const humidBg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!isLand[i]) continue;
    humidBg[i] =
      c.landRecycle + (c.maritimeHumidity - c.landRecycle) * Math.exp(-coastDist[i] / c.maritimeReachKm);
  }
  const moisture = new Float32Array(n);
  const rain = new Float32Array(n);
  const tmp = new Float32Array(n);
  const satCell = new Float32Array(n);
  const rowSu = new Int8Array(h); // 풍상측 x 방향 (-1: 서쪽에서 불어옴)
  const rowYu = new Int32Array(h); // 풍상측 행
  const rowWu = new Float64Array(h);
  const rowDs = new Float64Array(h);
  const rowSatSea = new Float64Array(h);
  const rowESea = new Float64Array(h);
  const rowELand = new Float64Array(h);
  const rowERech = new Float64Array(h);
  const rowBelt = new Float64Array(h);
  const rowConv = new Float64Array(h);

  for (let m = 0; m < 12; m++) {
    const s = seasonFactor(m);
    const shift = c.beltShiftDeg * s;
    for (let y = 0; y < h; y++) {
      const lat = rowLat[y];
      const p = lat - shift;
      const a = Math.abs(p);
      const sign = p >= 0 ? 1 : -1;
      const trade = 1 - smoothstep(26, 34, a);
      const polar = smoothstep(58, 66, a);
      const west = 1 - trade - polar;
      const u = -trade + west - polar; // +: 서풍(동쪽으로 붊)
      const vNorth = sign * (-0.45 * trade * Math.tanh(a / 6) + 0.3 * west - 0.3 * polar);
      let wu = Math.abs(u);
      let wv = Math.abs(vNorth);
      const yu = y + (vNorth > 0 ? 1 : -1);
      if (yu < 0 || yu >= h) wv = 0;
      if (wu + wv < 1e-6) wu = 1;
      const sum = wu + wv;
      wu /= sum;
      wv /= sum;
      rowSu[y] = u >= 0 ? -1 : 1;
      rowYu[y] = yu < 0 || yu >= h ? y : yu;
      rowWu[y] = wu;
      const ds = Math.max(8, wu * metrics.rowDx[y] + wv * metrics.dy);
      rowDs[y] = ds;
      const sl = Math.sin(Math.abs(lat) * DEG);
      const tSea = c.equatorTempC - c.poleDropC * sl * sl + s * c.seasonalAmpOceanC * rowAmp[y];
      rowSatSea[y] = saturation(tSea, c.saturationExp);
      rowESea[y] = 1 - Math.exp(-ds / c.seaRechargeKm);
      rowELand[y] = 1 - Math.exp(-ds / c.landRainoutKm);
      rowERech[y] = 1 - Math.exp(-ds / c.landRechargeKm);
      // 기압대: 적도 수렴대(다우) - 아열대 고압대(건조) - 중위도 폭풍대(다우) - 극(건조)
      rowBelt[y] =
        c.beltBase + c.beltEquator * Math.exp(-((p / 11) ** 2)) + c.beltMidLat * Math.exp(-(((a - 50) / 13) ** 2));
      rowConv[y] = c.convectionMm * Math.exp(-((p / c.convectionWidthDeg) ** 2));
    }
    for (let i = 0; i < n; i++) {
      satCell[i] = saturation(tempMonthly[m * n + i] * TEMP_SCALE, c.saturationExp);
      moisture[i] = 0.4 * rowSatSea[(i - (i % w)) / w];
      rain[i] = 0;
    }

    // 풍상측 값을 쓰는 Gauss-Seidel 스윕. 방향을 바꿔 가며 반복하면 정상 상태에 수렴한다.
    for (let pass = 0; pass < c.rounds * 4; pass++) {
      const xAsc = (pass & 1) === 0;
      const yAsc = (pass & 2) === 0;
      for (let yy = 0; yy < h; yy++) {
        const y = yAsc ? yy : h - 1 - yy;
        const su = rowSu[y];
        const yu = rowYu[y];
        const wu = rowWu[y];
        const wv = 1 - wu;
        const ds = rowDs[y];
        for (let xx = 0; xx < w; xx++) {
          const x = xAsc ? xx : w - 1 - xx;
          const i = y * w + x;
          let xu = x + su;
          if (xu < 0) xu += w;
          else if (xu >= w) xu -= w;
          const iu = y * w + xu;
          const iv = yu * w + x;
          const mUp = wu * moisture[iu] + wv * moisture[iv];
          if (!isLand[i]) {
            const mx = mUp + (rowSatSea[y] - mUp) * rowESea[y];
            moisture[i] = mx;
            rain[i] = (mx / c.landRainoutKm) * 0.8;
            continue;
          }
          const hUp = wu * height[iu] + wv * height[iv];
          let mx = mUp;
          const target = satCell[i] * humidBg[i];
          if (target > mx) mx += (target - mx) * rowERech[y];
          let loss = mx * rowELand[y];
          let rem = mx - loss;
          const uplift = height[i] - hUp;
          if (uplift > 0) {
            const oro = rem * (1 - Math.exp(-uplift / c.orographicScaleM));
            loss += oro;
            rem -= oro;
          }
          if (rem > satCell[i]) {
            const excess = (rem - satCell[i]) * c.excessRate;
            loss += excess;
          }
          if (uplift < 0) loss *= 1 / (1 - uplift / c.leeScaleM); // 비그늘
          moisture[i] = mx - loss;
          rain[i] = loss / ds;
        }
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const humid = Math.min(1, moisture[i] / 0.6);
        tmp[i] = rain[i] * c.advectionScale * rowBelt[y] * currentP[i] + rowConv[y] * humid;
      }
    }
    // 가벼운 번짐: 행 사이의 줄무늬를 없앤다
    for (let b = 0; b < 2; b++) {
      for (let y = 0; y < h; y++) {
        const y0 = y > 0 ? y - 1 : y;
        const y1 = y < h - 1 ? y + 1 : y;
        for (let x = 0; x < w; x++) {
          const xl = x > 0 ? x - 1 : w - 1;
          const xr = x < w - 1 ? x + 1 : 0;
          rain[y * w + x] =
            (tmp[y * w + x] * 4 +
              tmp[y * w + xl] + tmp[y * w + xr] + tmp[y0 * w + x] + tmp[y1 * w + x]) / 8;
        }
      }
      tmp.set(rain);
    }
    for (let i = 0; i < n; i++) {
      precipMonthly[m * n + i] = clamp(Math.round(tmp[i] / PRECIP_SCALE), 0, 255);
    }
  }
  return { tempMonthly, precipMonthly };
}

/** 쾨펜 단순화 기후대. 저장된(양자화된) 월별 값만으로 판정한다. */
export function classifyClimate(
  ctx: GenContext,
  elevation: Int16Array,
  isLand: Uint8Array,
  climate: ClimateLayers,
): Uint8Array {
  const { n, grid, rowLat } = ctx;
  const w = grid.width;
  const zones = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!isLand[i]) continue;
    const north = rowLat[(i - (i % w)) / w] >= 0;
    let tMin = 99;
    let tMax = -99;
    let tSum = 0;
    let pSum = 0;
    let pSummer = 0;
    let pDriest = 1e9;
    let pDriestSummer = 1e9;
    let pWettestWinter = 0;
    for (let m = 0; m < 12; m++) {
      const t = climate.tempMonthly[m * n + i] * TEMP_SCALE;
      const p = climate.precipMonthly[m * n + i] * PRECIP_SCALE;
      const summer = north ? m >= 3 && m <= 8 : m <= 2 || m >= 9;
      tMin = Math.min(tMin, t);
      tMax = Math.max(tMax, t);
      tSum += t;
      pSum += p;
      pDriest = Math.min(pDriest, p);
      if (summer) {
        pSummer += p;
        pDriestSummer = Math.min(pDriestSummer, p);
      } else pWettestWinter = Math.max(pWettestWinter, p);
    }
    const tMean = tSum / 12;
    const summerShare = pSum > 0 ? pSummer / pSum : 0.5;
    const aridLimit = 20 * tMean + (summerShare >= 0.7 ? 280 : summerShare >= 0.3 ? 140 : 0);
    let z: number;
    if (tMax < 10) z = elevation[i] > 1500 ? 10 : 9;
    else if (elevation[i] > 2500) z = 10;
    else if (pSum < 0.5 * aridLimit) z = 3;
    else if (pSum < aridLimit) z = 4;
    else if (tMin >= 18) z = pDriest >= 60 ? 1 : 2;
    else if (tMin > -3) {
      if (pDriestSummer < 40 && pDriestSummer < pWettestWinter / 3) z = 5;
      else z = tMax >= 22 ? 6 : 7;
    } else z = 8;
    zones[i] = z;
  }
  return zones;
}
