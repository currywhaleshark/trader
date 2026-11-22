import { DX8, DY8, gridSearch } from '../../core/gridSearch';
import { smoothstep } from '../../core/math';
import { latLonToVec3 } from '../../core/sphere';
import type { CitySpec } from '../config';
import { buildNavGrid, searchFrom } from '../seaRoutes';
import { SEA_ZONE } from '../types';
import { cellAngleDeg, nearestCell, type GenContext } from './context';
import { byteToFlow } from './hydrology';

/**
 * 국가 영토: 대륙별로 각국 앵커에서 고도 가중 Dijkstra를 돌려 가장 "가까운" 나라에 배정한다.
 * 산을 넘는 비용이 크므로 국경이 산맥을 따라 생긴다.
 */
export function generateCountries(
  ctx: GenContext,
  continentId: Uint8Array,
  elevation: Int16Array,
): Uint8Array {
  const { cfg, grid, metrics, n } = ctx;
  const countryId = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const costMul = new Float32Array(n);
  for (let i = 0; i < n; i++) costMul[i] = 1 + Math.max(0, elevation[i]) / cfg.borderElevationScaleM;

  const anchors: number[] = [];
  cfg.countries.forEach((spec, k) => {
    const passable = new Uint8Array(n);
    for (let i = 0; i < n; i++) passable[i] = continentId[i] === spec.continent ? 1 : 0;
    const anchor = nearestCell(ctx, spec.anchor[0], spec.anchor[1], (i) => passable[i] === 1);
    anchors.push(anchor);
    if (anchor < 0) return;
    const { dist } = gridSearch(grid, metrics, [anchor], { passable, costMul });
    for (let i = 0; i < n; i++) {
      if (dist[i] < best[i]) {
        best[i] = dist[i];
        countryId[i] = k + 1;
      }
    }
  });

  // 본토와 떨어진 섬: 가장 가까운 앵커의 나라
  const anchorVec = cfg.countries.map((c) => latLonToVec3(c.anchor[0], c.anchor[1]));
  for (let i = 0; i < n; i++) {
    if (!continentId[i] || countryId[i]) continue;
    let bestK = 0;
    let bestD = Infinity;
    for (let k = 0; k < anchorVec.length; k++) {
      const d = cellAngleDeg(ctx, i, anchorVec[k]);
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    countryId[i] = bestK + 1;
  }
  return countryId;
}

export interface PlacedCity {
  spec: CitySpec;
  cell: number;
  seaCell: number;
}

/**
 * 항구 도시 배치: 앵커 주변, 해당 국가의 해안 셀 중에서
 * 하구(유량)·만(주변 육지 비율)·저지대 점수가 높고 앵커에 가까운 곳을 고른다.
 */
export function placeCities(
  ctx: GenContext,
  countryId: Uint8Array,
  elevation: Int16Array,
  riverFlow: Uint8Array,
  seaZone: Uint8Array,
  spacingDeg = ctx.cfg.cityPlacement.preferredSpacingDeg,
): PlacedCity[] {
  const { cfg, grid, n } = ctx;
  const w = grid.width;
  const h = grid.height;
  const navigable = (i: number): boolean =>
    seaZone[i] !== SEA_ZONE.LAND && seaZone[i] !== SEA_ZONE.NON_NAVIGABLE;

  /** 항구 앞바다 셀: 4방향 이웃 중 항해 가능한 바다(해협 구역이 아닌 쪽 우선) */
  const harborCell = (i: number): number => {
    const x = i % w;
    const y = (i - x) / w;
    let fallback = -1;
    for (let k = 0; k < 8; k += 2) {
      const ny = y + DY8[k];
      if (ny < 0 || ny >= h) continue;
      const j = ny * w + ((x + DX8[k] + w) % w);
      if (!navigable(j)) continue;
      if (seaZone[j] < SEA_ZONE.GATE_BASE) return j;
      if (fallback < 0) fallback = j;
    }
    return fallback;
  };

  const coastByCountry: number[][] = cfg.countries.map(() => []);
  for (let i = 0; i < n; i++) {
    if (countryId[i] && harborCell(i) >= 0) coastByCountry[countryId[i] - 1].push(i);
  }

  const placed: PlacedCity[] = [];
  const pc = cfg.cityPlacement;
  const coastalNav = buildNavGrid(grid, cfg.planetRadiusKm, seaZone);
  const coastalDistances = new Map<string, Float64Array>();
  const pending = [...cfg.cities];
  while (pending.length) {
    // 본항을 먼저 정한 뒤, 놓을 수 있는 해안이 적은 항구 묶음부터 배치한다.
    // 넓은 해안을 가진 이웃의 연안항이 좁은 반도의 자리를 선점하지 않게 한다.
    if (pending.every((s) => s.nearCityId)) {
      const available = (spec: CitySpec): number => {
        const parent = placed.find((p) => p.spec.id === spec.nearCityId);
        if (!parent) return 0;
        let distances = coastalDistances.get(parent.spec.id);
        if (!distances) {
          distances = searchFrom(coastalNav, coastalNav.mask, parent.seaCell).dist;
          coastalDistances.set(parent.spec.id, distances);
        }
        const k = cfg.countries.findIndex((c) => c.id === spec.countryId);
        return coastByCountry[k].filter((cell) => distances![harborCell(cell)] <= pc.coastalDistanceKm &&
          placed.every((p) => cellAngleDeg(ctx, cell, latLonToVec3(ctx.rowLat[Math.floor(p.cell / w)], ctx.colLon[p.cell % w])) >= spacingDeg)).length;
      };
      const counts = new Map(pending.map((s) => [s.id, available(s)]));
      pending.sort((a, b) => counts.get(a.id)! - counts.get(b.id)!);
    }
    const spec = pending.shift()!;
    const k = cfg.countries.findIndex((c) => c.id === spec.countryId);
    const hub = spec.nearCityId ? placed.find((p) => p.spec.id === spec.nearCityId) : undefined;
    if (spec.nearCityId && !hub) continue; // 거점이 없으면 엉뚱한 해안으로 보내지 않는다.
    let seaDistances: Float64Array | undefined;
    if (hub) {
      seaDistances = coastalDistances.get(hub.spec.id);
      if (!seaDistances) {
        seaDistances = searchFrom(coastalNav, coastalNav.mask, hub.seaCell).dist;
        coastalDistances.set(hub.spec.id, seaDistances);
      }
    }
    const peerDistances = hub ? placed.filter((p) => p.spec.nearCityId === hub.spec.id).map((p) =>
      searchFrom(coastalNav, coastalNav.mask, p.seaCell).dist,
    ) : [];
    const anchorVec = hub
      ? latLonToVec3(ctx.rowLat[Math.floor(hub.cell / w)], ctx.colLon[hub.cell % w])
      : latLonToVec3(spec.anchor[0], spec.anchor[1]);
    const spaced = (cell: number): boolean => {
      for (const p of placed) {
        const lat = ctx.rowLat[(p.cell - (p.cell % w)) / w];
        const lon = ctx.colLon[p.cell % w];
        if (cellAngleDeg(ctx, cell, latLonToVec3(lat, lon)) < spacingDeg) return false;
      }
      return true;
    };
    let bestCell = -1;
    let bestScore = -Infinity;
    let nearest = -1;
    let nearestD = Infinity;
    const candidates: { cell: number; score: number }[] = [];
    for (const cell of k >= 0 ? coastByCountry[k] : []) {
      // 지협 반대편은 직선으로 가까워도 배로 멀다. 실제 바닷길로 근해 여부를 판단한다.
      if (seaDistances && seaDistances[harborCell(cell)] > pc.coastalDistanceKm) continue;
      if (peerDistances.some((dist) => dist[harborCell(cell)] > pc.coastalConnectionKm)) continue;
      if (!spaced(cell)) continue;
      const d = cellAngleDeg(ctx, cell, anchorVec);
      if (d < nearestD) {
        nearestD = d;
        nearest = cell;
      }
      if (!hub && d > pc.searchRadiusDeg) continue;
      const x = cell % w;
      const y = (cell - x) / w;
      let landCount = 0;
      let total = 0;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -3; dx <= 3; dx++) {
          total++;
          if (seaZone[yy * w + ((x + dx + w) % w)] === SEA_ZONE.LAND) landCount++;
        }
      }
      const shelter = 1 - Math.abs(landCount / total - 0.6) / 0.6;
      const river = smoothstep(50, 3000, byteToFlow(riverFlow[cell]));
      const low = 1 - smoothstep(100, 800, elevation[cell]);
      // 연안항은 거점 바로 옆보다 항로 바깥쪽을 선호해 해안을 따라 분산한다.
      const proximity = hub
        ? 0.8 * seaDistances![harborCell(cell)] / pc.coastalDistanceKm
        : -0.6 * (d / pc.searchRadiusDeg) ** 2;
      const score = 0.45 * river + 0.3 * shelter + 0.25 * low + proximity;
      candidates.push({ cell, score });
      if (score > bestScore) {
        bestScore = score;
        bestCell = cell;
      }
    }
    let cell = bestCell >= 0 ? bestCell : nearest;
    // 첫 연안항을 고를 때 둘째 항구 자리와 실제 바닷길도 함께 확인한다.
    const siblingIndex = hub ? pending.findIndex((s) => s.nearCityId === hub.spec.id) : -1;
    if (siblingIndex >= 0) {
      candidates.sort((a, b) => b.score - a.score);
      cell = -1;
      for (const candidate of candidates) {
        const distances = searchFrom(coastalNav, coastalNav.mask, harborCell(candidate.cell)).dist;
        const vec = latLonToVec3(ctx.rowLat[Math.floor(candidate.cell / w)], ctx.colLon[candidate.cell % w]);
        const partner = candidates.find((p) => cellAngleDeg(ctx, p.cell, vec) >= spacingDeg &&
          distances[harborCell(p.cell)] <= pc.coastalConnectionKm);
        if (!partner) continue;
        cell = candidate.cell;
        const sibling = pending.splice(siblingIndex, 1)[0];
        placed.push({ spec: sibling, cell: partner.cell, seaCell: harborCell(partner.cell) });
        break;
      }
    }
    if (cell < 0) continue; // 해안이 없는 나라 -> 검증에서 실패로 보고
    placed.push({ spec, cell, seaCell: harborCell(cell) });
  }
  if (placed.length < cfg.cities.length && spacingDeg > pc.minSpacingDeg) {
    return placeCities(ctx, countryId, elevation, riverFlow, seaZone, Math.max(pc.minSpacingDeg, spacingDeg - 1));
  }
  return placed.sort((a, b) => cfg.cities.indexOf(a.spec) - cfg.cities.indexOf(b.spec));
}

/** 도시 배후지: 같은 나라의 도시 중 가장 가까운 곳에 귀속 */
export function assignCityRegions(
  ctx: GenContext,
  countryId: Uint8Array,
  cities: PlacedCity[],
): Uint8Array {
  const { cfg, n, grid } = ctx;
  const w = grid.width;
  const region = new Uint8Array(n);
  const vecs = cities.map((c) =>
    latLonToVec3(ctx.rowLat[(c.cell - (c.cell % w)) / w], ctx.colLon[c.cell % w]),
  );
  const byCountry: number[][] = cfg.countries.map(() => []);
  cities.forEach((c, idx) => {
    const k = cfg.countries.findIndex((s) => s.id === c.spec.countryId);
    if (k >= 0) byCountry[k].push(idx);
  });
  for (let i = 0; i < n; i++) {
    if (!countryId[i]) continue;
    let best = -1;
    let bestD = Infinity;
    for (const idx of byCountry[countryId[i] - 1]) {
      const d = cellAngleDeg(ctx, i, vecs[idx]);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
    region[i] = best + 1;
  }
  return region;
}

