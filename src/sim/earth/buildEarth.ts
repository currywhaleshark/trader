import { cellLat, cellLon, computeMetrics, latToY, lonToX, type GridSpec } from '../core/grid';
import { labelComponents } from '../core/gridSearch';
import { angularDistance, DEG, densifyPath, pathAngularLength, type LatLon } from '../core/sphere';
import { DEFAULT_WORLD_CONFIG } from '../world/config';
import { evaluateCrop, type AgriInputs } from '../world/gen/agriculture';
import { findSeaRoute, navGridOf, routeFromSearch, searchFrom } from '../world/seaRoutes';
import { hashWorld } from '../world/serialize';
import {
  CLIMATE_ZONES,
  PRECIP_SCALE,
  SEA_ZONE,
  TEMP_SCALE,
  WORLD_FORMAT_VERSION,
  type Chokepoint,
  type City,
  type Country,
  type DataSourceRecord,
  type MapUnit,
  type RegionSummary,
  type SeaRoute,
  type ValidationCheck,
  type World,
  type WorldLayers,
} from '../world/types';
import {
  EARTH_CONTINENTS,
  EARTH_COUNTRIES,
  EARTH_DATA_VERSION,
  EARTH_INLAND_LINKS,
  EARTH_MARKETS,
  EARTH_NAVIGATION,
  EARTH_PASSAGES,
  type EarthCountryDef,
  type EarthMarketDef,
} from './definitions';
import { HIGHLAND_ELEVATION_M, KOPPEN_CODES, koppenToZone } from './koppen';

/** data/earth/sources 의 고정 자료(읽어 들인 모양) */
export interface EarthSources {
  naturalEarth: {
    features: {
      a3: string;
      isoA3: string;
      isoN3: string;
      name: string;
      nameKo: string;
      continent: string;
      labelLat: number;
      labelLon: number;
      rings: number[][];
    }[];
  };
  /** 720×360, 북쪽 행부터 */
  etopo: Int16Array;
  koppen: Uint8Array;
  worldBank: { baseYear: number; countries: Record<string, Record<string, { value: number; year: number } | null>> };
  power: { points: Record<string, { lat: number; lon: number; tempC: number[]; precipMm: number[]; elevationM: number }> };
  manifest: { records: (DataSourceRecord & { file: string; sha256Raw?: string })[] };
}

/** 정의를 다른 값으로 바꿔 시험할 때(표시 전용 나라 추가 등) */
export interface EarthDefinitions {
  countries: EarthCountryDef[];
  markets: EarthMarketDef[];
  inlandLinks: typeof EARTH_INLAND_LINKS;
  passages: typeof EARTH_PASSAGES;
  navigation: typeof EARTH_NAVIGATION;
  dataVersion: string;
}

export const DEFAULT_EARTH_DEFINITIONS: EarthDefinitions = {
  countries: EARTH_COUNTRIES,
  markets: EARTH_MARKETS,
  inlandLinks: EARTH_INLAND_LINKS,
  passages: EARTH_PASSAGES,
  navigation: EARTH_NAVIGATION,
  dataVersion: EARTH_DATA_VERSION,
};

const GRID: GridSpec = { width: 720, height: 360 };
const RADIUS_KM = 6371;
/** 표본 경제권(나라 일부만 넣은 경우)의 지도상 배후지 반경(km) */
const SAMPLE_REGION_KM = 1100;
/** 경제권 화면 이름이 없는 표시 전용 단위의 색 */
const DISPLAY_COLORS = ['#9aa5b1', '#a7b0a0', '#b2a69b', '#a39fb3', '#98aab0', '#b0a99a'];

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 경도 ±180을 넘는 차분 좌표를 풀어 [lon, lat] 고리로 */
function decodeRing(flat: number[], q: number): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x * q, y * q]);
  }
  return out;
}

/** 짝홀 규칙 스캔라인 채우기: 셀 중심이 고리들 안에 있으면 value를 쓴다 */
function rasterize(rings: [number, number][][], grid: GridSpec, out: Uint16Array, value: number): number {
  let latMin = 90;
  let latMax = -90;
  for (const r of rings) for (const [, la] of r) {
    if (la < latMin) latMin = la;
    if (la > latMax) latMax = la;
  }
  const y0 = latToY(grid, latMax);
  const y1 = latToY(grid, latMin);
  let count = 0;
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const lat = cellLat(grid, y);
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > lat !== yj > lat) {
          // 날짜변경선을 건너는 변은 Natural Earth에서 이미 잘려 있다
          xs.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.ceil(((xs[k] + 180) / 360) * grid.width - 0.5);
      const xb = Math.floor(((xs[k + 1] + 180) / 360) * grid.width - 0.5);
      for (let x = Math.max(0, xa); x <= Math.min(grid.width - 1, xb); x++) {
        out[y * grid.width + x] = value;
        count++;
      }
    }
  }
  return count;
}

/** 선분(구면)이 지나는 셀들 */
function cellsAlong(a: LatLon, b: LatLon, grid: GridSpec): number[] {
  const pts = densifyPath([a, b], 0.1);
  const set = new Set<number>();
  for (const p of pts) set.add(latToY(grid, p[0]) * grid.width + lonToX(grid, p[1]));
  return [...set];
}

/** 날짜변경선을 고려한 두 경도 차 */
function cellOf(p: LatLon): number {
  return latToY(GRID, p[0]) * GRID.width + lonToX(GRID, p[1]);
}

/** 1셀짜리 기후 입력으로 작물 적합도·수확 분포를 구한다(가상 세계와 같은 작물 모형) */
function cropFromClimate(tempC: number[], precipMm: number[], elevationM: number, irrigationMm = 0) {
  const inp: AgriInputs = {
    n: 1,
    width: 1,
    height: 1,
    elevation: Int16Array.from([Math.max(0, Math.round(elevationM))]),
    tempMonthly: Int8Array.from(tempC.map((t) => Math.round(t / TEMP_SCALE))),
    precipMonthly: Uint8Array.from(precipMm.map((p) => Math.min(255, Math.round(p / PRECIP_SCALE)))),
    // 관개 보정이 있으면 큰 강 옆 셀처럼 관개가 다 되는 것으로 본다(작물 모형의 하천 관개 항)
    riverFlow: Uint8Array.from([irrigationMm > 0 ? 255 : 0]),
  };
  const cfg = { ...DEFAULT_WORLD_CONFIG, agriculture: { ...DEFAULT_WORLD_CONFIG.agriculture, irrigationMm } };
  const harvest = new Float64Array(12);
  const out: Record<string, { suitability: number; monthlyCoef: number[] }> = {};
  for (const crop of DEFAULT_WORLD_CONFIG.crops) {
    const r = evaluateCrop(inp, cfg, crop, 0, harvest);
    const total = harvest.reduce((s, v) => s + v, 0);
    out[crop.id] = {
      suitability: round3(Math.min(1, r.suitability)),
      monthlyCoef: Array.from(harvest, (v) => (total > 0 ? round3((12 * v) / total) : 1)),
    };
  }
  return out;
}

export interface EarthBuildResult {
  world: World;
  timings: Record<string, number>;
}

/**
 * 고정 자료 + 설계 정의 -> 현실 지구 World.
 * 같은 자료·정의면 같은 결과(world.hash)가 나온다(시드와 무관).
 */
export function buildEarth(src: EarthSources, defs: EarthDefinitions = DEFAULT_EARTH_DEFINITIONS): EarthBuildResult {
  const timings: Record<string, number> = {};
  let last = Date.now();
  const lap = (k: string) => {
    const now = Date.now();
    timings[k] = now - last;
    last = now;
  };
  const grid = GRID;
  const n = grid.width * grid.height;
  const metrics = computeMetrics(grid, RADIUS_KM);
  const countryByA3 = new Map(defs.countries.map((c) => [c.a3, c]));

  // ---- 지도 단위와 래스터
  const unitLayer = new Uint16Array(n);
  const continentOfUnit: number[] = [];
  const features = [...src.naturalEarth.features].sort((a, b) => a.a3.localeCompare(b.a3));
  const unitCells: number[] = [];
  features.forEach((f, k) => {
    const rings = f.rings.map((r) => decodeRing(r, 0.01));
    unitCells.push(rasterize(rings, grid, unitLayer, k + 1));
    const cont = EARTH_CONTINENTS.find((c) => c.key === f.continent)?.id ?? 6;
    continentOfUnit.push(cont);
  });
  lap('지도 단위');

  const elevation = new Int16Array(n);
  const continentId = new Uint8Array(n);
  const climateZone = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const u = unitLayer[i];
    const e = src.etopo[i];
    if (u) {
      continentId[i] = continentOfUnit[u - 1];
      elevation[i] = Math.max(2, e);
    } else {
      elevation[i] = Math.min(-2, e);
    }
  }
  // 기후대: 쾨펜(육지), 자료가 없는 육지 셀은 가까운 육지의 값, 그래도 없으면 위도로
  for (let i = 0; i < n; i++) {
    if (!continentId[i]) continue;
    let code = src.koppen[i];
    if (!code) {
      const x0 = i % grid.width;
      const y0 = (i - x0) / grid.width;
      for (let r = 1; r <= 3 && !code; r++) {
        for (let dy = -r; dy <= r && !code; dy++) {
          for (let dx = -r; dx <= r && !code; dx++) {
            const y = y0 + dy;
            if (y < 0 || y >= grid.height) continue;
            code = src.koppen[y * grid.width + ((x0 + dx + grid.width) % grid.width)];
          }
        }
      }
    }
    let zone = code ? koppenToZone(KOPPEN_CODES[code]) : Math.abs(cellLat(grid, Math.floor(i / grid.width))) > 60 ? 9 : 4;
    if (zone !== 9 && elevation[i] > HIGHLAND_ELEVATION_M) zone = 10;
    climateZone[i] = zone;
  }
  lap('지형·기후대');

  // ---- 바다: 운항 범위, 통과 연결의 차단선, 닿을 수 있는 바다만 운항 가능
  const nav = defs.navigation;
  const seaZone = new Uint8Array(n);
  const navMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (continentId[i]) continue;
    const lat = cellLat(grid, Math.floor(i / grid.width));
    navMask[i] = lat <= nav.maxLatN && lat >= nav.maxLatS ? 1 : 0;
  }
  const barrierCells = new Set<number>();
  for (const p of defs.passages) for (const [a, b] of p.barrier) for (const c of cellsAlong(a, b, grid)) if (!continentId[c]) barrierCells.add(c);
  for (const c of barrierCells) navMask[c] = 0;
  const { labels } = labelComponents(grid, navMask, 4);
  const mainLabel = labels[cellOf([0, -30])];
  const navigableComp = new Set<number>([mainLabel]);
  // 통과 연결로 이어진 바다(지중해·홍해·페르시아만·흑해 등)를 차례로 더한다
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of defs.passages) {
      const la = labels[cellOf(p.a)];
      const lb = labels[cellOf(p.b)];
      if (la < 0 || lb < 0) continue;
      if (navigableComp.has(la) && !navigableComp.has(lb)) {
        navigableComp.add(lb);
        changed = true;
      } else if (navigableComp.has(lb) && !navigableComp.has(la)) {
        navigableComp.add(la);
        changed = true;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (continentId[i]) seaZone[i] = SEA_ZONE.LAND;
    else seaZone[i] = navMask[i] && navigableComp.has(labels[i]) ? SEA_ZONE.OUTER : SEA_ZONE.NON_NAVIGABLE;
  }
  const seaRisk = new Uint8Array(n);
  lap('바다');

  // ---- 경제 국가·지도 단위
  const mapUnits: MapUnit[] = features.map((f, k) => {
    const def = countryByA3.get(f.a3);
    const area = (() => {
      let s = 0;
      for (let i = 0; i < n; i++) if (unitLayer[i] === k + 1) s += metrics.rowArea[Math.floor(i / grid.width)];
      return Math.round(s);
    })();
    return {
      id: f.a3,
      index: k + 1,
      name: def?.name ?? (f.nameKo || f.name),
      color: def?.color ?? DISPLAY_COLORS[k % DISPLAY_COLORS.length],
      countryId: def?.id,
      participation: def ? def.participation : 'display',
      isoA3: f.isoA3 !== '-99' ? f.isoA3 : f.a3,
      areaKm2: area,
      labelLat: round3(f.labelLat),
      labelLon: round3(f.labelLon),
    };
  });
  const unitByA3 = new Map(mapUnits.map((u) => [u.id, u]));
  for (const c of defs.countries) if (!unitByA3.has(c.a3)) throw new Error(`Natural Earth에 ${c.a3}가 없습니다`);

  // ---- 경제권·항구
  const wb = (c: EarthCountryDef, key: string) => src.worldBank.countries[c.id.toUpperCase()]?.[key] ?? null;
  const cityRegion = new Uint16Array(n);
  const markets = defs.markets;
  const marketIndex = new Map(markets.map((m, k) => [m.id, k]));
  // 배후지 칸: 나라의 칸을 같은 나라 경제권 중 가까운 곳에 나눈다. 표본 국가는 반경 안의 칸만.
  for (let i = 0; i < n; i++) {
    const u = unitLayer[i];
    if (!u) continue;
    const cdef = mapUnits[u - 1].countryId ? defs.countries.find((c) => c.id === mapUnits[u - 1].countryId) : undefined;
    if (!cdef) continue;
    const lat = cellLat(grid, Math.floor(i / grid.width));
    const lon = cellLon(grid, i % grid.width);
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < markets.length; k++) {
      const m = markets[k];
      if (m.countryId !== cdef.id) continue;
      const anchor = m.port ? ([m.port.lat, m.port.lon] as LatLon) : m.climatePoint;
      const d = Math.min(angularDistance(lat, lon, anchor[0], anchor[1]), angularDistance(lat, lon, m.climatePoint[0], m.climatePoint[1]));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0) continue;
    if (cdef.simShare < 1 && bestD * RADIUS_KM > SAMPLE_REGION_KM) continue;
    cityRegion[i] = best + 1;
  }
  const nearestLand = (p: LatLon, unitIndex: number): number => {
    let best = -1;
    let bestD = Infinity;
    const y0 = latToY(grid, p[0]);
    const x0 = lonToX(grid, p[1]);
    for (let dy = -8; dy <= 8; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= grid.height) continue;
      for (let dx = -8; dx <= 8; dx++) {
        const i = y * grid.width + ((x0 + dx + grid.width) % grid.width);
        if (!continentId[i]) continue;
        const d = angularDistance(p[0], p[1], cellLat(grid, y), cellLon(grid, i % grid.width)) + (unitLayer[i] === unitIndex ? 0 : 1);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  };

  const problems: string[] = [];
  const cities: City[] = markets.map((m) => {
    const cdef = defs.countries.find((c) => c.id === m.countryId);
    if (!cdef) throw new Error(`경제권 ${m.id}의 나라 ${m.countryId}가 정의에 없습니다`);
    const unit = unitByA3.get(cdef.a3)!;
    const key = `${m.climatePoint[0].toFixed(2)},${m.climatePoint[1].toFixed(2)}`;
    const clim = src.power.points[key];
    if (!clim) throw new Error(`기후 자료가 없습니다: ${m.id} (${key}) — npm run fetch:earth`);
    const crops = cropFromClimate(clim.tempC, clim.precipMm, clim.elevationM, m.irrigationMm ?? 0);
    const arable = wb(cdef, 'arableHa');
    const forest = wb(cdef, 'forestKm2');
    if (!arable) problems.push(`${cdef.id}: 경지 면적 자료 없음(0으로 바꾸지 않고 농업 비중을 0으로 둔다)`);
    if (!forest) problems.push(`${cdef.id}: 삼림 면적 자료 없음`);
    const arableKm2 = ((arable?.value ?? 0) / 100) * m.share.arable;
    const forestKm2 = (forest?.value ?? 0) * m.share.forest;
    const region: RegionSummary = {
      areaKm2: 0,
      meanElevationM: Math.round(clim.elevationM),
      tempMonthlyC: clim.tempC,
      precipMonthlyMm: clim.precipMm,
      dominantClimate: 0,
      climateShare: {},
      crops: Object.fromEntries(
        DEFAULT_WORLD_CONFIG.crops.map((c) => [
          c.id,
          {
            suitability: crops[c.id].suitability,
            arableAreaKm2: Math.round(c.kind === 'perennial' ? forestKm2 : arableKm2),
            monthlyCoef: crops[c.id].monthlyCoef,
          },
        ]),
      ),
      resources: {
        iron_ore: Math.round((cdef.ironOreMt ?? 0) * (m.share.iron ?? 0) * 10) / 10,
        crude_oil: Math.round(((cdef.crudeKbd ?? 0) / 100) * (m.share.oil ?? 0) * 10) / 10,
      },
    };
    const anchor: LatLon = m.port ? [m.port.lat, m.port.lon] : m.climatePoint;
    const cell = nearestLand(anchor, unit.index);
    let seaCell = -1;
    if (m.port) {
      seaCell = cellOf(m.port.entry);
      if (seaZone[seaCell] !== SEA_ZONE.OUTER) problems.push(`${m.id}: 해상 진입점 ${m.port.entry.join(',')}이 운항 가능한 바다가 아닙니다`);
    }
    return {
      id: m.id,
      name: m.name,
      countryId: m.countryId,
      lat: m.port ? m.port.lat : m.climatePoint[0],
      lon: m.port ? m.port.lon : m.climatePoint[1],
      cell,
      seaCell,
      isPort: !!m.port,
      portSize: m.port?.size ?? 1,
      seaZone: 'outer' as const,
      seaName: m.port?.seaName,
      note: m.note,
      region,
      locode: m.port?.locode,
      hinterlands: defs.inlandLinks.filter((l) => l.portId === m.id).map((l) => l.inlandId),
      gatewayPortId: defs.inlandLinks.find((l) => l.inlandId === m.id)?.portId,
    };
  });
  // 배후지 면적·기후대 구성
  const areaAcc = cities.map(() => ({ area: 0, zones: {} as Record<string, number> }));
  for (let i = 0; i < n; i++) {
    const r = cityRegion[i];
    if (!r) continue;
    const a = metrics.rowArea[Math.floor(i / grid.width)];
    const acc = areaAcc[r - 1];
    acc.area += a;
    const z = String(climateZone[i]);
    acc.zones[z] = (acc.zones[z] ?? 0) + a;
  }
  cities.forEach((c, k) => {
    const acc = areaAcc[k];
    c.region.areaKm2 = Math.round(acc.area);
    for (const [z, v] of Object.entries(acc.zones)) c.region.climateShare[z] = round3(v / (acc.area || 1));
    // 대표 기후대: 기후를 잰 생산 배후지 지점의 쾨펜 구분
    const pt = cellOf(markets[k].climatePoint);
    c.region.dominantClimate =
      climateZone[pt] || Number(Object.entries(acc.zones).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0) || climateZone[c.cell] || 0;
  });
  lap('경제권');

  // ---- 경제 국가
  const countries: Country[] = defs.countries.map((c) => {
    const unit = unitByA3.get(c.a3)!;
    return {
      id: c.id,
      index: unit.index,
      name: c.name,
      continent: continentOfUnit[unit.index - 1],
      color: c.color,
      areaKm2: unit.areaKm2,
      coastCells: 0,
      cityIds: markets.filter((m) => m.countryId === c.id).map((m) => m.id),
    };
  });

  // ---- 통과 지점
  const chokepoints: Chokepoint[] = defs.passages.map((p, k) => {
    const aCell = cellOf(p.a);
    const bCell = cellOf(p.b);
    if (seaZone[aCell] !== SEA_ZONE.OUTER) problems.push(`${p.id}: 입구 ${p.a.join(',')}가 운항 가능한 바다가 아닙니다`);
    if (seaZone[bCell] !== SEA_ZONE.OUTER) problems.push(`${p.id}: 출구 ${p.b.join(',')}가 운항 가능한 바다가 아닙니다`);
    const mid = p.path[Math.floor(p.path.length / 2)];
    return {
      id: p.id,
      index: k,
      name: p.name,
      lat: mid[0],
      lon: mid[1],
      cells: 0,
      kind: 'link' as const,
      type: p.type,
      aCell,
      bCell,
      path: p.path,
      lengthKm: Math.round(pathAngularLength(p.path) * RADIUS_KM),
      fee: p.fee,
      delayMonths: p.delayMonths,
      maxShipSize: p.maxShipSize,
      note: p.note,
    };
  });

  const layers: WorldLayers = {
    elevation,
    continentId,
    countryId: unitLayer,
    cityRegion,
    seaZone,
    climateZone,
    riverFlow: new Uint8Array(n),
    seaRisk,
    harvestMonth: new Uint8Array(n),
    tempMonthly: new Int8Array(12 * n),
    precipMonthly: new Uint8Array(12 * n),
    cropSuitability: Object.fromEntries(DEFAULT_WORLD_CONFIG.crops.map((c) => [c.id, new Uint8Array(n)])),
    resourceRichness: Object.fromEntries(DEFAULT_WORLD_CONFIG.resources.map((r) => [r.id, new Uint8Array(n)])),
  };
  lap('레이어');

  // ---- 항로: 모든 항구 쌍의 기본 항로와, 지나는 통과 지점을 하나씩 막았을 때의 대체 항로
  const partialForNav = { grid, planetRadiusKm: RADIUS_KM, layers: { seaZone }, chokepoints };
  const navGrid = navGridOf(partialForNav);
  const ports = cities.filter((c) => c.isPort && c.seaCell >= 0 && seaZone[c.seaCell] === SEA_ZONE.OUTER);
  const seaRoutes: SeaRoute[] = [];
  const toRoute = (from: string, to: string, r: { distanceKm: number; waypoints: LatLon[]; gates: number[] }) => ({
    from,
    to,
    distanceKm: Math.round(r.distanceKm),
    waypoints: r.waypoints.map((p) => [round3(p[0]), round3(p[1])] as LatLon),
    gates: r.gates.map((g) => chokepoints[g].id),
  });
  const searches = new Map<string, ReturnType<typeof searchFrom>>();
  const searchOf = (cell: number, blocked: number[]) => {
    const key = `${cell}|${blocked.join(',')}`;
    let s = searches.get(key);
    if (!s) {
      s = searchFrom(navGrid, navGrid.mask, cell, blocked);
      searches.set(key, s);
    }
    return s;
  };
  for (let a = 0; a < ports.length; a++) {
    const base = searchOf(ports[a].seaCell, []);
    for (let b = a + 1; b < ports.length; b++) {
      const r = routeFromSearch(navGrid, navGrid.mask, base.prev, base.dist, ports[a].seaCell, ports[b].seaCell, base.via);
      if (!r) {
        problems.push(`${ports[a].id}→${ports[b].id}: 바닷길이 없습니다`);
        continue;
      }
      const route: SeaRoute = toRoute(ports[a].id, ports[b].id, r);
      const alternatives: NonNullable<SeaRoute['alternatives']> = [];
      for (const g of r.gates) {
        const s = searchOf(ports[a].seaCell, [g]);
        const alt = routeFromSearch(navGrid, navGrid.mask, s.prev, s.dist, ports[a].seaCell, ports[b].seaCell, s.via);
        const body = alt ? toRoute(ports[a].id, ports[b].id, alt) : { from: ports[a].id, to: ports[b].id, distanceKm: -1, waypoints: [], gates: [] };
        alternatives.push({ avoid: [chokepoints[g].id], ...body });
      }
      if (alternatives.length) route.alternatives = alternatives;
      seaRoutes.push(route);
    }
  }
  lap('항로');

  const inlandLinks = defs.inlandLinks.map((l) => ({ ...l, open: true }));
  const sources: DataSourceRecord[] = src.manifest.records.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    version: r.version,
    retrieved: r.retrieved,
    period: r.period,
    license: r.license,
    attribution: r.attribution,
    sha256: r.sha256,
    notes: r.notes,
  }));

  let land = 0;
  let total = 0;
  const zoneArea: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const a = metrics.rowArea[Math.floor(i / grid.width)];
    total += a;
    if (continentId[i]) {
      land += a;
      zoneArea[climateZone[i]] = (zoneArea[climateZone[i]] ?? 0) + a;
    }
  }
  const partial: Omit<World, 'validation' | 'hash'> = {
    version: WORLD_FORMAT_VERSION as 2,
    mode: 'earth',
    worldId: 'earth',
    dataVersion: defs.dataVersion,
    seed: defs.dataVersion,
    catalog: {
      crops: DEFAULT_WORLD_CONFIG.crops,
      resources: DEFAULT_WORLD_CONFIG.resources,
      riverMinFlow: DEFAULT_WORLD_CONFIG.hydrology.riverMinFlow,
    },
    layerAvailability: { climate: true, monthly: false, crops: false, resources: false, rivers: false },
    mapUnits,
    planetRadiusKm: RADIUS_KM,
    grid,
    layers,
    continents: EARTH_CONTINENTS.map((c) => ({ id: c.id, name: c.name, areaKm2: 0, latMin: -90, latMax: 90, centroidLat: 0 })),
    countries,
    cities,
    chokepoints,
    seaRoutes,
    inlandLinks,
    navigation: nav,
    sources,
    stats: {
      landFraction: round3(land / total),
      climateShare: Object.fromEntries(Object.entries(zoneArea).map(([z, v]) => [z, round3(v / land)])),
      centralSeaAreaKm2: 0,
    },
  };
  const validation = validateEarth(partial as World, problems);
  const world: World = { ...partial, validation, hash: '' };
  world.hash = hashWorld(world);
  lap('검증');
  return { world, timings };
}

/** 현실 지구 자료 검증(§16 E1 완료 기준) */
export function validateEarth(world: World, problems: string[]): World['validation'] {
  const checks: ValidationCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  add('build', '자료 조립', problems.length === 0, problems.length ? problems.slice(0, 8).join(' / ') : '문제 없음');

  const ports = world.cities.filter((c) => c.isPort);
  const pairs = (ports.length * (ports.length - 1)) / 2;
  add('routes', '모든 항구 쌍의 바닷길', world.seaRoutes.length === pairs, `${world.seaRoutes.length}/${pairs}`);

  // 육지 통과 금지: 통과 연결 구간을 뺀 항로 위 점이 육지 셀이면 안 된다
  const g = world.grid;
  const passagePts = new Set<string>();
  for (const c of world.chokepoints) for (const p of c.path ?? []) passagePts.add(`${p[0]},${p[1]}`);
  let landHits = 0;
  for (const r of world.seaRoutes) {
    const segs: LatLon[][] = [[]];
    for (const p of r.waypoints) {
      const inPassage = passagePts.has(`${p[0]},${p[1]}`);
      if (inPassage) segs.push([]);
      else segs[segs.length - 1].push(p);
    }
    for (const s of segs) {
      if (s.length < 2) continue;
      for (const p of densifyPath(s, 0.2)) {
        if (world.layers.seaZone[latToY(g, p[0]) * g.width + lonToX(g, p[1])] === SEA_ZONE.LAND) landHits++;
      }
    }
  }
  add('noLand', '항로가 육지를 지나지 않음', landHits === 0, `육지 위 표본 점 ${landHits}개`);

  // 날짜변경선: 요코하마↔로스앤젤레스처럼 태평양을 건너는 항로가 이어지고 지구를 반대로 돌지 않는다
  const pac = world.seaRoutes.find((r) => [r.from, r.to].includes('yokohama') && [r.from, r.to].includes('los_angeles'));
  if (pac) {
    const crosses = pac.waypoints.some((p, i) => i > 0 && Math.abs(p[1] - pac.waypoints[i - 1][1]) > 180);
    add('dateline', '날짜변경선을 건너는 태평양 항로', crosses && pac.distanceKm < 11000, `요코하마–로스앤젤레스 ${pac.distanceKm}km, 날짜변경선 통과 ${crosses ? '예' : '아니오'}`);
  }

  // 내해: 카스피해는 운항할 수 없다
  const caspian = latToY(g, 42) * g.width + lonToX(g, 50.5);
  add('inland-sea', '닫힌 내해(카스피해)는 운항 불가', world.layers.seaZone[caspian] === SEA_ZONE.NON_NAVIGABLE, `카스피해 칸 구역 ${world.layers.seaZone[caspian]}`);

  // 통과 지점: 막으면 실제로 그 길로 못 가고 다른 길로 돌아간다
  const nav = navGridOf(world);
  const detail: string[] = [];
  let ok = true;
  const city = (id: string) => world.cities.find((c) => c.id === id);
  const probe = (passage: string, a: string, b: string, expectDetour: boolean) => {
    const A = city(a);
    const B = city(b);
    const p = world.chokepoints.find((c) => c.id === passage);
    if (!A || !B || !p) return;
    const open = findSeaRoute(nav, A.seaCell, B.seaCell, []);
    const closed = findSeaRoute(nav, A.seaCell, B.seaCell, [p.index]);
    const uses = !!open?.gates.includes(p.index);
    const avoided = closed ? !closed.gates.includes(p.index) : true;
    const longer = closed ? closed.distanceKm > (open?.distanceKm ?? 0) : true;
    const pass = uses && avoided && longer && (expectDetour ? !!closed : true);
    if (!pass) ok = false;
    detail.push(`${p.name} ${a}→${b}: ${open ? Math.round(open.distanceKm) : '-'}km → 막으면 ${closed ? Math.round(closed.distanceKm) + 'km' : '갈 수 없음'}`);
  };
  probe('suez', 'shanghai', 'rotterdam', true);
  probe('panama', 'new_york', 'los_angeles', true);
  probe('malacca', 'port_klang', 'shanghai', true);
  probe('hormuz', 'jebel_ali', 'singapore', false);
  probe('gibraltar', 'new_york', 'jebel_ali', true);
  probe('bab_el_mandeb', 'rotterdam', 'singapore', true);
  add('passages', '운하·해협 통과 연결과 우회', ok, detail.join(' / '));

  const pathsOk = world.chokepoints.every((c) => c.kind === 'link' && (c.lengthKm ?? 0) > 0);
  add('passage-data', '통과 지점마다 경로·거리·요금', pathsOk, world.chokepoints.map((c) => `${c.name} ${c.lengthKm}km`).join(', '));

  // 격자 한 칸(약 50km)보다 작은 도시국가(싱가포르)는 지도 배후지 칸이 없을 수 있다
  const tiny = new Set(world.mapUnits.filter((u) => u.areaKm2 < 3000).map((u) => u.countryId));
  const noRegion = world.cities.filter((c) => c.region.areaKm2 <= 0);
  add(
    'regions',
    '경제권마다 지도상 배후지',
    noRegion.every((c) => tiny.has(c.countryId)),
    noRegion.length ? `격자보다 작은 도시국가: ${noRegion.map((c) => c.id).join(', ')}` : '모두 있음',
  );
  return { ok: checks.every((c) => c.ok), checks };
}

