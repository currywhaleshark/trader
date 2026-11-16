import { trapezoid } from '../../core/math';
import { Noise3D } from '../../core/noise';
import { DEG } from '../../core/sphere';
import type { GenContext } from './context';

/**
 * 광물·원유: 기후와 무관한 단순 지질 규칙.
 *  1) 자원별 "지질 적합"을 계산 (철광석: 구릉·산록 / 원유: 저지 분지와 대륙붕)
 *  2) 시드로 매장 지대 몇 곳을 고른다. 처음 두 곳은 서로 다른 대륙에 강제 배치.
 *  3) 풍부도 = 적합 × 지대와의 거리 감쇠 × 노이즈
 */
export function generateResources(
  ctx: GenContext,
  elevation: Int16Array,
  continentId: Uint8Array,
  coastDist: Float32Array,
): Record<string, Uint8Array> {
  const { cfg, n, cellVec } = ctx;
  const out: Record<string, Uint8Array> = {};
  const continentIds = cfg.continents.map((c) => c.id);

  for (const res of cfg.resources) {
    const rng = ctx.rng.fork(`resource/${res.id}`);
    const noise = new Noise3D(ctx.rng.fork(`resource-noise/${res.id}`));
    const fit = new Float32Array(n);
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      if (continentId[i]) {
        fit[i] = trapezoid(elevation[i], res.elevation);
        if (fit[i] > 0.6) candidates.push(i);
      } else if (res.shelfKm > 0 && coastDist[i] < res.shelfKm) {
        fit[i] = 0.75 * (1 - (coastDist[i] / res.shelfKm) * 0.5);
      }
    }

    const provinces: number[] = [];
    const farEnough = (cell: number): boolean => {
      for (const p of provinces) {
        const d =
          cellVec[cell * 3] * cellVec[p * 3] +
          cellVec[cell * 3 + 1] * cellVec[p * 3 + 1] +
          cellVec[cell * 3 + 2] * cellVec[p * 3 + 2];
        if (Math.acos(Math.min(1, d)) < res.minSeparationDeg * DEG) return false;
      }
      return true;
    };
    for (let k = 0; k < res.provinces && candidates.length > 0; k++) {
      const forced = k < continentIds.length ? continentIds[k] : 0;
      for (let attempt = 0; attempt < 400; attempt++) {
        const cell = candidates[rng.int(0, candidates.length - 1)];
        if (forced && continentId[cell] !== forced) continue;
        if (!farEnough(cell)) continue;
        provinces.push(cell);
        break;
      }
    }

    const layer = new Uint8Array(n);
    const r2 = (res.provinceRadiusDeg * DEG) ** 2;
    for (let i = 0; i < n; i++) {
      if (fit[i] <= 0) continue;
      let field = 0;
      for (const p of provinces) {
        const d =
          cellVec[i * 3] * cellVec[p * 3] +
          cellVec[i * 3 + 1] * cellVec[p * 3 + 1] +
          cellVec[i * 3 + 2] * cellVec[p * 3 + 2];
        if (d < 0.9) continue;
        const ang = Math.acos(Math.min(1, d));
        field += Math.exp(-(ang * ang) / r2);
      }
      if (field < 0.05) continue;
      const patch =
        0.5 + 0.5 * noise.fbm(cellVec[i * 3] * 14, cellVec[i * 3 + 1] * 14, cellVec[i * 3 + 2] * 14, 3);
      const v = fit[i] * Math.min(1, field) * (0.35 + 1.1 * patch);
      if (v >= 0.18) layer[i] = Math.round(255 * Math.min(1, v));
    }
    out[res.id] = layer;
  }
  return out;
}
