import { gridSearch, labelComponents } from '../../core/gridSearch';
import { smoothstep } from '../../core/math';
import { Noise3D } from '../../core/noise';
import { DEG, capsuleDistance, makeCapsule, type LatLon } from '../../core/sphere';
import { SEA_ZONE } from '../types';
import { nearestCell, type GenContext } from './context';

/** 육지 셀은 가장 가까운 바다까지, 바다 셀은 가장 가까운 육지까지의 거리(km) */
export function computeCoastDistance(ctx: GenContext, isLand: Uint8Array): Float32Array {
  const { grid, metrics, n } = ctx;
  const all = new Uint8Array(n).fill(1);
  const landCells: number[] = [];
  const seaCells: number[] = [];
  for (let i = 0; i < n; i++) (isLand[i] ? landCells : seaCells).push(i);
  const toSea = gridSearch(grid, metrics, seaCells, { passable: all }).dist;
  const toLand = gridSearch(grid, metrics, landCells, { passable: all }).dist;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = isLand[i] ? toSea[i] : toLand[i];
  return out;
}

/** 고도(m). 육지 ≥ 1, 바다 < 0. */
export function generateElevation(
  ctx: GenContext,
  continentId: Uint8Array,
  coastDist: Float32Array,
): Int16Array {
  const { cfg, n, cellVec } = ctx;
  const el = cfg.elevation;
  const rng = ctx.rng.fork('elevation');
  const noise = new Noise3D(ctx.rng.fork('elevation-noise'));
  const jit = (p: LatLon): LatLon => [
    p[0] + rng.range(-el.ridgeJitterDeg, el.ridgeJitterDeg),
    p[1] + rng.range(-el.ridgeJitterDeg, el.ridgeJitterDeg),
  ];
  const ridges = cfg.continents.flatMap((c) =>
    c.ridges.map((r) => ({
      continent: c.id,
      cap: makeCapsule(jit(r.from), jit(r.to)),
      width: r.widthDeg * DEG,
      height: r.heightM * (1 + rng.range(-el.ridgeHeightJitter, el.ridgeHeightJitter)),
    })),
  );

  const elevation = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const d = coastDist[i];
    if (!continentId[i]) {
      const depth = 20 + 180 * smoothstep(0, 220, d) + 3800 * smoothstep(150, 900, d);
      elevation[i] = -Math.round(depth);
      continue;
    }
    const px = cellVec[i * 3];
    const py = cellVec[i * 3 + 1];
    const pz = cellVec[i * 3 + 2];
    const coast = smoothstep(0, el.coastalPlainKm, d);
    const inland = smoothstep(0, 1200, d);
    const rolling = 0.5 + 0.5 * noise.fbm(px * 3.1 + 7, py * 3.1 + 3, pz * 3.1 + 11, 4);
    let e = 25 + el.baseInlandM * inland * (0.4 + 0.9 * rolling);
    let ridgeSum = 0;
    for (const r of ridges) {
      if (r.continent !== continentId[i]) continue;
      const dist = capsuleDistance(r.cap, px, py, pz);
      if (dist > r.width * 3) continue;
      const q = dist / r.width;
      ridgeSum += r.height * Math.exp(-q * q);
    }
    if (ridgeSum > 0) {
      const crag = 0.45 + 0.95 * noise.ridged(px * 9 + 1, py * 9 + 5, pz * 9 + 2, 4);
      e += ridgeSum * crag * (0.3 + 0.7 * smoothstep(0, 160, d));
    }
    const hills = Math.max(0, noise.fbm(px * 8 + 21, py * 8 + 13, pz * 8 + 5, 4));
    e += el.hillsM * Math.pow(hills * 2, 1.5) * coast;
    elevation[i] = Math.max(1, Math.min(8000, Math.round(e)));
  }
  return elevation;
}

/**
 * 바다 구역: 외해 / 중앙해 / 관문 해협 / 항해 불가.
 * 중앙해는 "모든 관문을 막았을 때 대양과 끊기는, 탐침점을 품은 바다"로 정의한다.
 */
export function computeSeaZones(ctx: GenContext, isLand: Uint8Array): Uint8Array {
  const { cfg, grid, n, cellVec, rowLat } = ctx;
  const w = grid.width;
  const zone = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (isLand[i]) continue;
    const lat = rowLat[(i - (i % w)) / w];
    zone[i] = Math.abs(lat) > cfg.routes.maxNavLatDeg ? SEA_ZONE.NON_NAVIGABLE : SEA_ZONE.OUTER;
  }
  cfg.gates.forEach((g, k) => {
    const cap = makeCapsule(g.a, g.b);
    const hw = g.tagHalfWidthDeg * DEG;
    for (let i = 0; i < n; i++) {
      if (zone[i] !== SEA_ZONE.OUTER) continue;
      if (capsuleDistance(cap, cellVec[i * 3], cellVec[i * 3 + 1], cellVec[i * 3 + 2]) < hw) {
        zone[i] = SEA_ZONE.GATE_BASE + k;
      }
    }
  });
  const open = new Uint8Array(n);
  for (let i = 0; i < n; i++) open[i] = zone[i] === SEA_ZONE.OUTER ? 1 : 0;
  const comp = labelComponents(grid, open, 4);
  let largest = 0;
  for (let k = 1; k < comp.sizes.length; k++) if (comp.sizes[k] > comp.sizes[largest]) largest = k;
  const probe = nearestCell(ctx, cfg.centralSeaProbe[0], cfg.centralSeaProbe[1], (i) => open[i] === 1);
  if (probe >= 0 && comp.labels[probe] !== largest) {
    const id = comp.labels[probe];
    for (let i = 0; i < n; i++) if (comp.labels[i] === id) zone[i] = SEA_ZONE.CENTRAL;
  }
  return zone;
}

/** 기본 해상 위험 계수(0~255): 열대 저기압대, 고위도 폭풍대, 먼바다, 해협 혼잡 */
export function computeSeaRisk(ctx: GenContext, seaZone: Uint8Array, coastDist: Float32Array): Uint8Array {
  const { grid, n, rowLat } = ctx;
  const w = grid.width;
  const risk = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const z = seaZone[i];
    if (z === SEA_ZONE.LAND) continue;
    const a = Math.abs(rowLat[(i - (i % w)) / w]);
    const cyclone = smoothstep(8, 14, a) * (1 - smoothstep(24, 32, a));
    const storm = smoothstep(38, 58, a);
    const open = smoothstep(200, 1200, coastDist[i]);
    let r = 0.1 + 0.4 * cyclone + 0.55 * storm + 0.1 * open;
    if (z >= SEA_ZONE.GATE_BASE) r += 0.1;
    if (z === SEA_ZONE.CENTRAL) r *= 0.8;
    if (z === SEA_ZONE.NON_NAVIGABLE) r = 1;
    risk[i] = Math.round(255 * Math.min(1, r));
  }
  return risk;
}
