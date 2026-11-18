import { cellAngleDeg, createContext, type GenContext } from './gen/context';
import { generateAgriculture, evaluateCrop, type AgriInputs } from './gen/agriculture';
import { classifyClimate, generateClimate } from './gen/climate';
import { assignCityRegions, generateCountries, placeCities, type PlacedCity } from './gen/countries';
import { computeCoastDistance, computeSeaRisk, computeSeaZones, generateElevation } from './gen/elevation';
import { generateHydrology } from './gen/hydrology';
import { gateChannel, generateLandmass } from './gen/landmass';
import { generateResources } from './gen/resources';
import { DX8, DY8 } from '../core/gridSearch';
import { latLonToVec3 } from '../core/sphere';
import type { WorldGenConfig } from './config';
import { buildNavGrid, routeFromSearch, searchFrom } from './seaRoutes';
import { hashWorld } from './serialize';
import {
  PRECIP_SCALE,
  SEA_ZONE,
  TEMP_SCALE,
  WORLD_FORMAT_VERSION,
  type Chokepoint,
  type City,
  type ContinentInfo,
  type Country,
  type RegionSummary,
  type SeaRoute,
  type World,
  type WorldLayers,
  type WorldStats,
} from './types';
import { validateWorld } from './validate';
import { catalogOf, mapUnitsOf, VIRTUAL_GENERATOR_VERSION } from './virtualMeta';

export interface GenerationResult {
  world: World;
  /** 단계별 소요 시간(ms) */
  timings: Record<string, number>;
}

/**
 * 시드 + 설정 -> 세계. 순수 계산이며 같은 입력이면 같은 결과(world.hash)가 나온다.
 * DOM에 의존하지 않으므로 Node(오프라인 생성·테스트)와 브라우저 모두에서 돈다.
 */
export function generateWorld(cfg: WorldGenConfig): GenerationResult {
  const timings: Record<string, number> = {};
  let last = Date.now();
  const lap = (name: string) => {
    const now = Date.now();
    timings[name] = now - last;
    last = now;
  };

  const ctx = createContext(cfg);
  const { n, grid } = ctx;

  const continentId = generateLandmass(ctx);
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) isLand[i] = continentId[i] ? 1 : 0;
  lap('대륙');

  const coastDist = computeCoastDistance(ctx, isLand);
  const elevation = generateElevation(ctx, continentId, coastDist);
  const seaZone = computeSeaZones(ctx, isLand);
  const seaRisk = computeSeaRisk(ctx, seaZone, coastDist);
  lap('고도·바다 구역');

  const climate = generateClimate(ctx, elevation, isLand, coastDist);
  lap('기후');

  const riverFlow = generateHydrology(ctx, elevation, isLand, climate.precipMonthly);
  const climateZone = classifyClimate(ctx, elevation, isLand, climate);
  lap('하천·기후대');

  const agriInputs: AgriInputs = {
    n,
    width: grid.width,
    height: grid.height,
    elevation,
    tempMonthly: climate.tempMonthly,
    precipMonthly: climate.precipMonthly,
    riverFlow,
  };
  const agri = generateAgriculture(ctx, agriInputs, isLand);
  const resourceRichness = generateResources(ctx, elevation, continentId, coastDist);
  lap('농업·자원');

  const countryId = generateCountries(ctx, continentId, elevation);
  const placed = placeCities(ctx, countryId, elevation, riverFlow, seaZone);
  const cityRegion = assignCityRegions(ctx, countryId, placed);
  lap('국가·도시');

  const layers: WorldLayers = {
    elevation,
    continentId,
    countryId,
    cityRegion,
    seaZone,
    climateZone,
    riverFlow,
    seaRisk,
    harvestMonth: agri.harvestMonth,
    tempMonthly: climate.tempMonthly,
    precipMonthly: climate.precipMonthly,
    cropSuitability: agri.cropSuitability,
    resourceRichness,
  };

  const regions = summarizeRegions(ctx, layers, placed, agriInputs);
  const cities: City[] = placed.map((p, k) => {
    const y = Math.floor(p.cell / grid.width);
    const z = p.seaCell >= 0 ? seaZone[p.seaCell] : SEA_ZONE.OUTER;
    return {
      id: p.spec.id,
      name: p.spec.name,
      countryId: p.spec.countryId,
      lat: ctx.rowLat[y],
      lon: ctx.colLon[p.cell % grid.width],
      cell: p.cell,
      seaCell: p.seaCell,
      isPort: p.seaCell >= 0,
      portSize: p.spec.portSize,
      seaZone: z === SEA_ZONE.CENTRAL ? 'central' : z >= SEA_ZONE.GATE_BASE ? 'gate' : 'outer',
      note: p.spec.note,
      region: regions[k],
    };
  });
  lap('배후지 집계');

  const nav = buildNavGrid(grid, cfg.planetRadiusKm, seaZone);
  const seaRoutes: SeaRoute[] = [];
  for (let a = 0; a < cities.length; a++) {
    if (cities[a].seaCell < 0) continue;
    const search = searchFrom(nav, nav.mask, cities[a].seaCell);
    for (let b = a + 1; b < cities.length; b++) {
      if (cities[b].seaCell < 0) continue;
      const r = routeFromSearch(nav, nav.mask, search.prev, search.dist, cities[a].seaCell, cities[b].seaCell);
      if (!r) continue;
      seaRoutes.push({
        from: cities[a].id,
        to: cities[b].id,
        distanceKm: Math.round(r.distanceKm),
        waypoints: r.waypoints.map((p) => [round3(p[0]), round3(p[1])]),
        gates: r.gates.map((g) => cfg.gates[g].id),
      });
    }
  }
  lap('해상 항로');

  const countries = summarizeCountries(ctx, layers, cities);
  const continents = summarizeContinents(ctx, continentId);
  const chokepoints: Chokepoint[] = cfg.gates.map((g, k) => {
    const mid = gateChannel(g).mid;
    let cells = 0;
    for (let i = 0; i < n; i++) if (seaZone[i] === SEA_ZONE.GATE_BASE + k) cells++;
    return { id: g.id, index: k, name: g.name, lat: round3(mid[0]), lon: round3(mid[1]), cells, kind: 'zone' as const, type: 'strait' as const };
  });
  const stats = computeStats(ctx, layers);

  const partial = {
    version: WORLD_FORMAT_VERSION as 2,
    mode: 'virtual' as const,
    worldId: 'virtual',
    dataVersion: VIRTUAL_GENERATOR_VERSION,
    seed: cfg.seed,
    config: cfg,
    catalog: catalogOf(cfg),
    layerAvailability: { climate: true, monthly: true, crops: true, resources: true, rivers: true },
    mapUnits: mapUnitsOf(countries),
    inlandLinks: [],
    planetRadiusKm: cfg.planetRadiusKm,
    grid,
    layers,
    continents,
    countries,
    cities,
    chokepoints,
    seaRoutes,
    stats,
  };
  const validation = validateWorld(partial, nav);
  const world: World = { ...partial, validation, hash: '' };
  world.hash = hashWorld(world);
  lap('검증');
  return { world, timings };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function summarizeRegions(
  ctx: GenContext,
  L: WorldLayers,
  cities: PlacedCity[],
  inp: AgriInputs,
): RegionSummary[] {
  const { cfg, n, grid, metrics } = ctx;
  const w = grid.width;
  const acc = cities.map(() => ({
    area: 0,
    elev: 0,
    temp: new Array<number>(12).fill(0),
    precip: new Array<number>(12).fill(0),
    zones: {} as Record<string, number>,
    crops: Object.fromEntries(
      cfg.crops.map((c) => [c.id, { suit: 0, arable: 0, monthly: new Array<number>(12).fill(0) }]),
    ),
    resources: Object.fromEntries(cfg.resources.map((r) => [r.id, 0])) as Record<string, number>,
  }));
  const harvest = new Float64Array(12);
  const cityVec = cities.map((c) =>
    latLonToVec3(ctx.rowLat[Math.floor(c.cell / w)], ctx.colLon[c.cell % w]),
  );
  const claimDeg = (cfg.cityPlacement.offshoreClaimKm / cfg.planetRadiusKm) * (180 / Math.PI);

  for (let i = 0; i < n; i++) {
    const area = metrics.rowArea[(i - (i % w)) / w];
    const r = L.cityRegion[i];
    if (!r) {
      // 앞바다 자원은 가까운 도시에 귀속
      if (L.continentId[i]) continue;
      for (const res of cfg.resources) {
        const v = L.resourceRichness[res.id][i];
        if (!v) continue;
        let best = -1;
        let bestD = claimDeg;
        for (let k = 0; k < cityVec.length; k++) {
          const d = cellAngleDeg(ctx, i, cityVec[k]);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        if (best >= 0) acc[best].resources[res.id] += ((v / 255) * area) / 1000;
      }
      continue;
    }
    const a = acc[r - 1];
    a.area += area;
    a.elev += L.elevation[i] * area;
    for (let m = 0; m < 12; m++) {
      a.temp[m] += L.tempMonthly[m * n + i] * TEMP_SCALE * area;
      a.precip[m] += L.precipMonthly[m * n + i] * PRECIP_SCALE * area;
    }
    const z = String(L.climateZone[i]);
    a.zones[z] = (a.zones[z] ?? 0) + area;
    for (const crop of cfg.crops) {
      const res = evaluateCrop(inp, cfg, crop, i, harvest);
      const c = a.crops[crop.id];
      c.suit += res.suitability * area;
      if (res.suitability >= cfg.agriculture.arableThreshold) c.arable += area;
      for (let m = 0; m < 12; m++) c.monthly[m] += res.suitability * area * harvest[m];
    }
    for (const res of cfg.resources) {
      const v = L.resourceRichness[res.id][i];
      if (v) a.resources[res.id] += ((v / 255) * area) / 1000;
    }
  }

  return acc.map((a) => {
    const area = a.area || 1;
    let dominant = 0;
    let dominantArea = -1;
    const climateShare: Record<string, number> = {};
    for (const [z, v] of Object.entries(a.zones)) {
      climateShare[z] = round3(v / area);
      if (v > dominantArea) {
        dominantArea = v;
        dominant = Number(z);
      }
    }
    const crops: RegionSummary['crops'] = {};
    for (const crop of cfg.crops) {
      const c = a.crops[crop.id];
      const total = c.monthly.reduce((s, v) => s + v, 0);
      crops[crop.id] = {
        suitability: round3(c.suit / area),
        arableAreaKm2: Math.round(c.arable),
        monthlyCoef: c.monthly.map((v) => (total > 0 ? round3((12 * v) / total) : 1)),
      };
    }
    const resources: Record<string, number> = {};
    for (const res of cfg.resources) resources[res.id] = Math.round(a.resources[res.id] * 10) / 10;
    return {
      areaKm2: Math.round(a.area),
      meanElevationM: Math.round(a.elev / area),
      tempMonthlyC: a.temp.map((v) => Math.round((v / area) * 10) / 10),
      precipMonthlyMm: a.precip.map((v) => Math.round(v / area)),
      dominantClimate: dominant,
      climateShare,
      crops,
      resources,
    };
  });
}

function summarizeCountries(ctx: GenContext, L: WorldLayers, cities: City[]): Country[] {
  const { cfg, n, grid, metrics } = ctx;
  const w = grid.width;
  const h = grid.height;
  const area = cfg.countries.map(() => 0);
  const coast = cfg.countries.map(() => 0);
  for (let i = 0; i < n; i++) {
    const c = L.countryId[i];
    if (!c) continue;
    const x = i % w;
    const y = (i - x) / w;
    area[c - 1] += metrics.rowArea[y];
    for (let k = 0; k < 8; k += 2) {
      const ny = y + DY8[k];
      if (ny < 0 || ny >= h) continue;
      const z = L.seaZone[ny * w + ((x + DX8[k] + w) % w)];
      if (z !== SEA_ZONE.LAND && z !== SEA_ZONE.NON_NAVIGABLE) {
        coast[c - 1]++;
        break;
      }
    }
  }
  return cfg.countries.map((spec, k) => ({
    id: spec.id,
    index: k + 1,
    name: spec.name,
    continent: spec.continent,
    color: spec.color,
    areaKm2: Math.round(area[k]),
    coastCells: coast[k],
    cityIds: cities.filter((c) => c.countryId === spec.id).map((c) => c.id),
  }));
}

function summarizeContinents(ctx: GenContext, continentId: Uint8Array): ContinentInfo[] {
  const { cfg, grid, metrics, rowLat } = ctx;
  const w = grid.width;
  return cfg.continents.map((spec) => {
    let area = 0;
    let latSum = 0;
    let latMin = 90;
    let latMax = -90;
    const half = 90 / grid.height;
    for (let y = 0; y < grid.height; y++) {
      let cells = 0;
      for (let x = 0; x < w; x++) if (continentId[y * w + x] === spec.id) cells++;
      if (!cells) continue;
      area += cells * metrics.rowArea[y];
      latSum += cells * metrics.rowArea[y] * rowLat[y];
      latMin = Math.min(latMin, rowLat[y] - half);
      latMax = Math.max(latMax, rowLat[y] + half);
    }
    return {
      id: spec.id,
      name: spec.name,
      areaKm2: Math.round(area),
      latMin,
      latMax,
      centroidLat: area > 0 ? round3(latSum / area) : 0,
    };
  });
}

function computeStats(ctx: GenContext, L: WorldLayers): WorldStats {
  const { n, grid, metrics } = ctx;
  const w = grid.width;
  let land = 0;
  let total = 0;
  let central = 0;
  const zones: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const area = metrics.rowArea[(i - (i % w)) / w];
    total += area;
    if (L.continentId[i]) {
      land += area;
      const z = String(L.climateZone[i]);
      zones[z] = (zones[z] ?? 0) + area;
    } else if (L.seaZone[i] === SEA_ZONE.CENTRAL) central += area;
  }
  const climateShare: Record<string, number> = {};
  for (const [z, v] of Object.entries(zones)) climateShare[z] = round3(v / land);
  return { landFraction: round3(land / total), climateShare, centralSeaAreaKm2: Math.round(central) };
}
