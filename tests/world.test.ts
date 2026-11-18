import { beforeAll, describe, expect, it } from 'vitest';
import { cellIndex, latToY, lonToX } from '../src/sim/core/grid';
import { DEG, angularDistance, densifyPath } from '../src/sim/core/sphere';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import {
  buildNavGrid,
  findSeaRoute,
  nearestNavigableCell,
  type NavGrid,
} from '../src/sim/world/seaRoutes';
import { hashWorld, packWorld, unpackWorld } from '../src/sim/world/serialize';
import { PRECIP_SCALE, SEA_ZONE, TEMP_SCALE, type City, type World } from '../src/sim/world/types';
import { peakMonth } from '../src/sim/world/validate';

let world: World;
let nav: NavGrid;
let n: number;

const city = (id: string): City => {
  const c = world.cities.find((x) => x.id === id);
  if (!c) throw new Error(`도시 없음: ${id}`);
  return c;
};

beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
  nav = buildNavGrid(world.grid, world.planetRadiusKm, world.layers.seaZone);
  n = world.grid.width * world.grid.height;
});

describe('재현성', () => {
  it('같은 시드는 같은 세계(해시)를 만든다', () => {
    const again = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
    expect(again.hash).toBe(world.hash);
    expect(again.cities.map((c) => c.cell)).toEqual(world.cities.map((c) => c.cell));
  });

  it('다른 시드는 다른 세계를 만들되 구조 검증은 통과한다', () => {
    for (const seed of ['other-seed', 'm0-check-3']) {
      const other = generateWorld(makeConfig({ seed })).world;
      expect(other.hash).not.toBe(world.hash);
      const failed = other.validation.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
      expect(failed, `시드 ${seed}`).toEqual([]);
    }
  });

  it('저장(JSON+이진) 후 불러오면 같은 세계다', () => {
    const { meta, binary } = packWorld(world);
    const json = JSON.parse(JSON.stringify(meta));
    const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
    const loaded = unpackWorld(json, buffer as ArrayBuffer);
    expect(hashWorld(loaded)).toBe(world.hash);
    expect(loaded.layers.elevation).toEqual(world.layers.elevation);
    expect(loaded.layers.tempMonthly.length).toBe(12 * n);
    expect(loaded.seaRoutes).toEqual(world.seaRoutes);
  });
});

describe('행성 구조 (§3.1)', () => {
  it('생성 검증 항목을 모두 통과한다', () => {
    const failed = world.validation.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(world.validation.ok).toBe(true);
  });

  it('북대륙은 북반구에 치우치되 적도를 넘고, 남대륙은 그 반대다', () => {
    const [north, south] = world.continents;
    expect(north.centroidLat).toBeGreaterThan(15);
    expect(north.latMin).toBeLessThan(0);
    expect(north.latMin).toBeGreaterThan(-20);
    expect(south.centroidLat).toBeLessThan(-15);
    expect(south.latMax).toBeGreaterThan(0);
    expect(south.latMax).toBeLessThan(20);
  });

  it('두 대륙은 상하 대칭이 아니다', () => {
    const { width: w, height: h } = world.grid;
    const L = world.layers;
    let mismatch = 0;
    let land = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = L.continentId[y * w + x] ? 1 : 0;
        const b = L.continentId[(h - 1 - y) * w + x] ? 1 : 0;
        land += a;
        if (a !== b) mismatch++;
      }
    }
    expect(mismatch / (2 * land)).toBeGreaterThan(0.25);
  });

  it('6개국이 대륙당 3개씩이고, 국가 레이어가 자기 대륙 위에만 있다', () => {
    expect(world.countries).toHaveLength(6);
    for (const cont of [1, 2]) expect(world.countries.filter((c) => c.continent === cont)).toHaveLength(3);
    const L = world.layers;
    let landWithoutCountry = 0;
    for (let i = 0; i < n; i++) {
      if (L.continentId[i] && !L.countryId[i]) landWithoutCountry++;
      if (!L.continentId[i]) expect(L.countryId[i]).toBe(0);
    }
    expect(landWithoutCountry).toBe(0);
  });

  it('행성 반대편(경도 180° 부근)은 이어진 외해다', () => {
    const L = world.layers;
    for (let lat = -60; lat <= 60; lat += 10) {
      for (const lon of [179.75, -179.75, 150, -150]) {
        expect(L.seaZone[cellIndex(world.grid, lat, lon)]).toBe(SEA_ZONE.OUTER);
      }
    }
  });

  it('고도는 육지에서 양수, 바다에서 음수다', () => {
    const L = world.layers;
    for (let i = 0; i < n; i++) {
      if (L.continentId[i]) expect(L.elevation[i]).toBeGreaterThan(0);
      else expect(L.elevation[i]).toBeLessThan(0);
    }
  });
});

describe('해상 항로 (§3.2)', () => {
  it('모든 항구 쌍에 항로가 있고 거리는 대권거리 이상이다', () => {
    const ports = world.cities.length;
    expect(world.seaRoutes).toHaveLength((ports * (ports - 1)) / 2);
    for (const r of world.seaRoutes) {
      const a = city(r.from);
      const b = city(r.to);
      const direct = angularDistance(a.lat, a.lon, b.lat, b.lon) * world.planetRadiusKm;
      expect(r.distanceKm).toBeGreaterThan(direct * 0.95);
      expect(r.distanceKm).toBeLessThan(Math.PI * world.planetRadiusKm * 1.6);
    }
  });

  it('어떤 항로도 육지를 지나지 않는다', () => {
    const w = world.grid.width;
    for (const r of world.seaRoutes) {
      for (const p of densifyPath(r.waypoints, 0.1)) {
        const cell = latToY(world.grid, p[0]) * w + lonToX(world.grid, p[1]);
        expect(nav.mask[cell], `${r.from}->${r.to} (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`).toBe(1);
      }
    }
  });

  it('날짜변경선을 넘는 항로가 끊기지 않고 짧은 쪽으로 간다', () => {
    const from = nearestNavigableCell(nav, 10, 170);
    const to = nearestNavigableCell(nav, 10, -170);
    const route = findSeaRoute(nav, from, to);
    expect(route).not.toBeNull();
    const direct = angularDistance(10, 170, 10, -170) * world.planetRadiusKm;
    expect(route!.distanceKm).toBeLessThan(direct * 1.05);
    const pts = densifyPath(route!.waypoints, 0.2);
    for (let i = 1; i < pts.length; i++) {
      expect(angularDistance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) / DEG).toBeLessThan(0.21);
    }
    // 경로가 실제로 ±180°를 넘는다
    expect(pts.some((p) => p[1] > 175)).toBe(true);
    expect(pts.some((p) => p[1] < -175)).toBe(true);
  });

  it('런타임 탐색(A*)이 사전 계산 항로와 같은 거리를 낸다', () => {
    for (const r of world.seaRoutes.slice(0, 12)) {
      const live = findSeaRoute(nav, city(r.from).seaCell, city(r.to).seaCell);
      expect(live).not.toBeNull();
      expect(Math.abs(live!.distanceKm - r.distanceKm) / r.distanceKm).toBeLessThan(0.02);
    }
  });

  it('관문 해협을 막으면 외해로 우회해 더 멀어진다 (QA 7)', () => {
    const west = world.chokepoints.find((g) => g.id === 'west')!;
    const inside = city('portabel'); // 중앙해 쪽 해협 입구
    const outside = city('nandia'); // 같은 나라의 외해 쪽 항구
    const normal = findSeaRoute(nav, inside.seaCell, outside.seaCell)!;
    const detour = findSeaRoute(nav, inside.seaCell, outside.seaCell, [west.index])!;
    expect(normal.gates).toContain(west.index);
    expect(detour).not.toBeNull();
    expect(detour.gates).not.toContain(west.index);
    expect(detour.distanceKm).toBeGreaterThan(normal.distanceKm * 1.5);
  });

  it('관문을 모두 막으면 중앙해 항구는 외해 항구에 닿지 못한다', () => {
    const all = world.chokepoints.map((g) => g.index);
    const inside = world.cities.find((c) => c.seaZone === 'central')!;
    const outside = world.cities.find((c) => c.seaZone === 'outer')!;
    expect(findSeaRoute(nav, inside.seaCell, outside.seaCell, all)).toBeNull();
    // 중앙해 안에서는 여전히 다닐 수 있다
    const inside2 = world.cities.filter((c) => c.seaZone === 'central')[1];
    expect(findSeaRoute(nav, inside.seaCell, inside2.seaCell, all)).not.toBeNull();
  });
});

describe('기후 (§3.3)', () => {
  const tempAt = (lat: number, lon: number, m: number) =>
    world.layers.tempMonthly[m * n + cellIndex(world.grid, lat, lon)] * TEMP_SCALE;

  it('월별 레이어가 12개월 × 전 셀로 저장되어 있다', () => {
    expect(world.layers.tempMonthly.length).toBe(12 * n);
    expect(world.layers.precipMonthly.length).toBe(12 * n);
  });

  it('북반구는 7월이, 남반구는 1월이 더 덥다. 적도는 연교차가 작다', () => {
    expect(tempAt(45, -170, 6) - tempAt(45, -170, 0)).toBeGreaterThan(3);
    expect(tempAt(-45, -170, 0) - tempAt(-45, -170, 6)).toBeGreaterThan(3);
    expect(Math.abs(tempAt(0, -170, 6) - tempAt(0, -170, 0))).toBeLessThan(2);
    expect(tempAt(0, -170, 6)).toBeGreaterThan(tempAt(60, -170, 6) + 10);
  });

  it('높은 산은 같은 위도의 저지대보다 춥다', () => {
    const { width: w, height: h } = world.grid;
    const L = world.layers;
    let checked = 0;
    for (let y = 0; y < h && checked < 20; y++) {
      let high = -1;
      let low = -1;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (L.elevation[i] > 2000) high = i;
        else if (L.elevation[i] > 0 && L.elevation[i] < 200) low = i;
      }
      if (high >= 0 && low >= 0) {
        expect(L.tempMonthly[6 * n + high]).toBeLessThan(L.tempMonthly[6 * n + low]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('비그늘: 산맥을 넘은 뒤에는 넘기 전보다 건조하다', () => {
    // 고도 1500m 이상 셀의 풍상측·풍하측 4° 지점 연강수를 비교(서풍대, 위도 40~50°)
    const { width: w } = world.grid;
    const L = world.layers;
    const annual = (i: number) => {
      let s = 0;
      for (let m = 0; m < 12; m++) s += L.precipMonthly[m * n + i] * PRECIP_SCALE;
      return s;
    };
    let wetter = 0;
    let total = 0;
    for (const sign of [1, -1]) {
      for (let lat = 40; lat <= 50; lat += 0.5) {
        const y = latToY(world.grid, sign * lat);
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const upwind = y * w + ((x - 8 + w) % w);
          const downwind = y * w + ((x + 8) % w);
          if (L.elevation[i] < 1500 || L.elevation[upwind] <= 0 || L.elevation[downwind] <= 0) continue;
          if (L.elevation[upwind] > 800 || L.elevation[downwind] > 800) continue;
          total++;
          if (annual(upwind) > annual(downwind)) wetter++;
        }
      }
    }
    expect(total).toBeGreaterThan(10);
    expect(wetter / total).toBeGreaterThan(0.7);
  });

  it('기후대와 강수 분포가 다양하다', () => {
    const present = Object.entries(world.stats.climateShare).filter(([, v]) => v > 0.015);
    expect(present.length).toBeGreaterThanOrEqual(6);
    const L = world.layers;
    let dry = 0;
    let wet = 0;
    let land = 0;
    for (let i = 0; i < n; i++) {
      if (!L.continentId[i]) continue;
      let s = 0;
      for (let m = 0; m < 12; m++) s += L.precipMonthly[m * n + i] * PRECIP_SCALE;
      land++;
      if (s < 400) dry++;
      if (s > 1500) wet++;
    }
    expect(dry / land).toBeGreaterThan(0.05);
    expect(wet / land).toBeGreaterThan(0.05);
  });
});

describe('도시 배후지와 자원 (M1 입력)', () => {
  it('도시 12곳이 설정대로 자기 나라 해안에 놓인다', () => {
    expect(world.cities).toHaveLength(world.config!.cities.length);
    for (const c of world.cities) {
      const country = world.countries.find((k) => k.id === c.countryId)!;
      expect(world.layers.countryId[c.cell]).toBe(country.index);
      expect(nav.mask[c.seaCell]).toBe(1);
      expect(c.region.areaKm2).toBeGreaterThan(0);
      expect(c.region.tempMonthlyC).toHaveLength(12);
    }
  });

  it('월별 생산 계수는 평균 1이고 음수가 없다', () => {
    for (const c of world.cities) {
      for (const stats of Object.values(c.region.crops)) {
        const sum = stats.monthlyCoef.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(12, 1);
        for (const v of stats.monthlyCoef) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('남북 온대 지역의 곡물 수확기는 반년쯤 어긋난다 (QA 1)', () => {
    const north = city('havenru').region.crops.grain;
    const south = city('draven').region.crops.grain;
    const diff = Math.abs(peakMonth(north.monthlyCoef) - peakMonth(south.monthlyCoef));
    expect(Math.min(diff, 12 - diff)).toBeGreaterThanOrEqual(4);
    // 한쪽의 수확 성수기에 다른 쪽은 평균(1) 이하의 비수기다
    const nPeak = peakMonth(north.monthlyCoef);
    const sPeak = peakMonth(south.monthlyCoef);
    expect(north.monthlyCoef[nPeak]).toBeGreaterThan(3 * south.monthlyCoef[nPeak]);
    expect(south.monthlyCoef[sPeak]).toBeGreaterThan(3 * north.monthlyCoef[sPeak]);
    expect(south.monthlyCoef[nPeak]).toBeLessThan(1);
    expect(north.monthlyCoef[sPeak]).toBeLessThan(1);
  });

  it('자원은 일부 나라에만 있다(전부 가진 나라도, 아무도 없는 자원도 없다)', () => {
    for (const res of world.config!.resources) {
      const owners = world.countries.filter((k) =>
        world.cities.some((c) => c.countryId === k.id && c.region.resources[res.id] > 1),
      );
      expect(owners.length).toBeGreaterThanOrEqual(2);
      expect(owners.length).toBeLessThan(world.countries.length);
    }
  });

  it('목재가 풍부한 곳과 메마른 곳이 함께 있다', () => {
    const timber = world.cities.map((c) => c.region.crops.timber.suitability);
    expect(Math.max(...timber)).toBeGreaterThan(0.7);
    expect(Math.min(...timber)).toBeLessThan(0.2);
  });
});
