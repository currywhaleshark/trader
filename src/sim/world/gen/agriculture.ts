import { smoothstep, trapezoid } from '../../core/math';
import type { CropSpec, WorldGenConfig } from '../config';
import { PRECIP_SCALE, TEMP_SCALE } from '../types';
import type { GenContext } from './context';
import { byteToFlow } from './hydrology';

export interface CellCropResult {
  /** 0~1 */
  suitability: number;
  /** 수확 월 분포(합 1). out에 기록된다. */
  peakMonth: number;
}

export interface AgriInputs {
  n: number;
  width: number;
  height: number;
  elevation: Int16Array;
  tempMonthly: Int8Array;
  precipMonthly: Uint8Array;
  riverFlow: Uint8Array;
}

const growth = new Float64Array(12);
const score = new Float64Array(12);

/**
 * 한 셀에서 한 작물의 적합도와 수확 월 분포를 계산한다.
 *  - 월별 생육 점수 = 기온 적합 × 수분 적합(강수 + 하천 관개)
 *  - 재배 기간 길이의 연속 구간 중 가장 좋은 구간이 적합도
 *  - 구간이 끝난 다음 달이 수확기. 연중 재배가 가능한 곳은 분포가 평평해진다.
 */
export function evaluateCrop(
  inp: AgriInputs,
  cfg: WorldGenConfig,
  crop: CropSpec,
  cell: number,
  harvestOut: Float64Array,
): CellCropResult {
  const { n, width: w, height: h } = inp;
  const elev = inp.elevation[cell];
  const x = cell % w;
  const y = (cell - x) / w;
  let relief = 0;
  const nb = [
    y * w + ((x + 1) % w),
    y * w + ((x - 1 + w) % w),
    (y > 0 ? y - 1 : y) * w + x,
    (y < h - 1 ? y + 1 : y) * w + x,
  ];
  for (const j of nb) {
    if (inp.elevation[j] > 0) relief = Math.max(relief, Math.abs(inp.elevation[j] - elev));
  }
  const terrain = (1 - smoothstep(1300, 2700, elev)) * (1 - 0.8 * smoothstep(350, 1300, relief));
  const river = byteToFlow(inp.riverFlow[cell]);
  const irrigation = cfg.agriculture.irrigationMm * smoothstep(100, 1500, river);

  if (crop.kind === 'perennial') {
    let tMean = 0;
    let pMean = 0;
    for (let m = 0; m < 12; m++) {
      tMean += inp.tempMonthly[m * n + cell] * TEMP_SCALE;
      pMean += inp.precipMonthly[m * n + cell] * PRECIP_SCALE;
    }
    tMean /= 12;
    pMean /= 12;
    const s = trapezoid(tMean, crop.temp) * trapezoid(pMean + irrigation * 0.3, crop.water);
    for (let m = 0; m < 12; m++) harvestOut[m] = 1 / 12;
    return { suitability: s * (1 - smoothstep(1800, 3200, elev)), peakMonth: 0 };
  }

  for (let m = 0; m < 12; m++) {
    const t = inp.tempMonthly[m * n + cell] * TEMP_SCALE;
    const p = inp.precipMonthly[m * n + cell] * PRECIP_SCALE;
    const pPrev = inp.precipMonthly[((m + 11) % 12) * n + cell] * PRECIP_SCALE;
    const water = 0.6 * p + 0.4 * pPrev + irrigation; // 토양 수분의 이월
    growth[m] = trapezoid(t, crop.temp) * trapezoid(water, crop.water);
  }
  const len = crop.seasonMonths;
  let best = 0;
  let bestEnd = 0;
  let total = 0;
  for (let e = 0; e < 12; e++) {
    let sum = 0;
    let worst = 1;
    for (let j = 0; j < len; j++) {
      const g = growth[(e - j + 12) % 12];
      sum += g;
      if (g < worst) worst = g;
    }
    // 기간 중 생육이 끊기는 달이 있으면 감점
    const sc = (sum / len) * (0.4 + 0.6 * Math.min(1, worst * 3));
    score[e] = sc;
    if (sc > best) {
      best = sc;
      bestEnd = e;
    }
  }
  for (let e = 0; e < 12; e++) {
    const wgt = Math.pow(score[e], 4);
    score[e] = wgt;
    total += wgt;
  }
  for (let m = 0; m < 12; m++) harvestOut[m] = 0;
  if (total > 0) {
    for (let e = 0; e < 12; e++) harvestOut[(e + 1) % 12] = score[e] / total;
  }
  return { suitability: best * terrain, peakMonth: ((bestEnd + 1) % 12) + 1 };
}

/** 작물별 적합도 레이어와 곡물(첫 번째 계절 작물) 수확 월 레이어 */
export function generateAgriculture(
  ctx: GenContext,
  inp: AgriInputs,
  isLand: Uint8Array,
): { cropSuitability: Record<string, Uint8Array>; harvestMonth: Uint8Array } {
  const { cfg, n } = ctx;
  const cropSuitability: Record<string, Uint8Array> = {};
  const harvestMonth = new Uint8Array(n);
  const harvest = new Float64Array(12);
  const staple = cfg.crops.find((c) => c.kind === 'seasonal');
  for (const crop of cfg.crops) {
    const layer = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!isLand[i]) continue;
      const r = evaluateCrop(inp, cfg, crop, i, harvest);
      layer[i] = Math.round(255 * Math.min(1, r.suitability));
      if (crop === staple && r.suitability >= 0.2) harvestMonth[i] = r.peakMonth;
    }
    cropSuitability[crop.id] = layer;
  }
  return { cropSuitability, harvestMonth };
}
