import { cellLat, cellLon, computeMetrics, type GridMetrics, type GridSpec } from '../../core/grid';
import { SeededRNG } from '../../core/rng';
import { DEG, latLonToVec3 } from '../../core/sphere';
import type { WorldGenConfig } from '../config';

/** 생성 단계들이 공유하는 사전 계산 */
export interface GenContext {
  cfg: WorldGenConfig;
  grid: GridSpec;
  n: number;
  rowLat: Float64Array;
  colLon: Float64Array;
  /** 셀 중심의 단위 벡터 (x, y, z) × n */
  cellVec: Float32Array;
  metrics: GridMetrics;
  rng: SeededRNG;
}

export function createContext(cfg: WorldGenConfig): GenContext {
  const grid = cfg.grid;
  const { width: w, height: h } = grid;
  const n = w * h;
  const rowLat = new Float64Array(h);
  const colLon = new Float64Array(w);
  for (let y = 0; y < h; y++) rowLat[y] = cellLat(grid, y);
  for (let x = 0; x < w; x++) colLon[x] = cellLon(grid, x);
  const cellVec = new Float32Array(n * 3);
  for (let y = 0; y < h; y++) {
    const cy = Math.cos(rowLat[y] * DEG);
    const sy = Math.sin(rowLat[y] * DEG);
    for (let x = 0; x < w; x++) {
      const lo = colLon[x] * DEG;
      const i = (y * w + x) * 3;
      cellVec[i] = cy * Math.cos(lo);
      cellVec[i + 1] = sy;
      cellVec[i + 2] = -cy * Math.sin(lo);
    }
  }
  return {
    cfg,
    grid,
    n,
    rowLat,
    colLon,
    cellVec,
    metrics: computeMetrics(grid, cfg.planetRadiusKm),
    rng: new SeededRNG(cfg.seed),
  };
}

/** 조건을 만족하는 셀 중 (lat, lon)에 가장 가까운 셀. 없으면 -1. */
export function nearestCell(
  ctx: GenContext,
  lat: number,
  lon: number,
  accept: (cell: number) => boolean,
): number {
  const v = latLonToVec3(lat, lon);
  const cv = ctx.cellVec;
  let best = -1;
  let bestDot = -2;
  for (let i = 0; i < ctx.n; i++) {
    const d = cv[i * 3] * v[0] + cv[i * 3 + 1] * v[1] + cv[i * 3 + 2] * v[2];
    if (d > bestDot && accept(i)) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

/** 셀과 (단위 벡터) 사이 각거리(도) */
export function cellAngleDeg(ctx: GenContext, cell: number, v: readonly [number, number, number]): number {
  const cv = ctx.cellVec;
  const d = cv[cell * 3] * v[0] + cv[cell * 3 + 1] * v[1] + cv[cell * 3 + 2] * v[2];
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) / DEG;
}
