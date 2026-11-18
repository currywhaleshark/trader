import { latToY, lonToX } from '../core/grid';
import { angularDistance, densifyPath, DEG } from '../core/sphere';
import { findSeaRoute, type NavGrid } from './seaRoutes';
import { CLIMATE_ZONES, TEMP_SCALE, type ValidationCheck, type ValidationReport, type World } from './types';

type Unvalidated = Omit<World, 'validation' | 'hash'>;

/** 월별 계수 배열에서 가장 큰 달(0~11) */
export function peakMonth(coef: readonly number[]): number {
  let best = 0;
  for (let m = 1; m < 12; m++) if (coef[m] > coef[best]) best = m;
  return best;
}

/** 요구서 §3.3 "검증" 항목과 M0 완료 조건을 기계적으로 확인한다. */
export function validateWorld(world: Unvalidated, nav: NavGrid): ValidationReport {
  const checks: ValidationCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) =>
    checks.push({ id, label, ok, detail });
  const cfg = world.config!;
  const { width: w, height: h } = world.grid;
  const n = w * h;
  const L = world.layers;

  // 대륙 배치
  {
    const [north, south] = world.continents;
    const ok =
      world.continents.length === 2 &&
      north.centroidLat > 5 && north.latMax >= 38 && north.latMax <= 56 && north.latMin < -2 && north.latMin > -22 &&
      south.centroidLat < -5 && south.latMin <= -38 && south.latMin >= -56 && south.latMax > 2 && south.latMax < 22;
    add(
      'continents',
      '두 대륙이 각각 북·남반구에 치우치고 적도를 조금 넘는다',
      ok,
      world.continents
        .map((c) => `${c.name}: 위도 ${c.latMin.toFixed(1)}°~${c.latMax.toFixed(1)}°, 중심 ${c.centroidLat.toFixed(1)}°`)
        .join(' / '),
    );
  }

  // 국가
  {
    const perContinent = new Map<number, number>();
    for (const c of world.countries) perContinent.set(c.continent, (perContinent.get(c.continent) ?? 0) + 1);
    const ok =
      world.countries.length === 6 &&
      [...perContinent.values()].every((v) => v === 3) &&
      world.countries.every((c) => c.areaKm2 > 300_000 && c.coastCells > 0);
    add(
      'countries',
      '6개국(대륙당 3개국)이 모두 영토와 해안을 가진다',
      ok,
      world.countries.map((c) => `${c.name} ${(c.areaKm2 / 1e6).toFixed(2)}백만km²`).join(', '),
    );
  }

  // 도시·항구
  {
    const ok =
      world.cities.length === cfg.cities.length &&
      world.cities.length >= 8 &&
      world.cities.length <= 12 &&
      world.cities.every((c) => c.seaCell >= 0 && nav.mask[c.seaCell] === 1) &&
      world.countries.every((c) => c.cityIds.length >= 1);
    const central = world.cities.filter((c) => c.seaZone !== 'outer').length;
    add(
      'cities',
      '항구 8~12곳이 모두 항해 가능한 바다에 면한다',
      ok,
      `항구 ${world.cities.length}곳 (중앙해·해협 ${central}, 외해 ${world.cities.length - central})`,
    );
  }

  // 바다 구역
  {
    const ok =
      world.stats.centralSeaAreaKm2 > 2_000_000 &&
      world.chokepoints.every((g) => g.cells > 0) &&
      world.cities.some((c) => c.seaZone === 'central') &&
      world.cities.some((c) => c.seaZone === 'outer');
    add(
      'seas',
      '중앙해와 외해가 구분되고 관문 해협이 열려 있다',
      ok,
      `중앙해 ${(world.stats.centralSeaAreaKm2 / 1e6).toFixed(1)}백만km², 해협 ${world.chokepoints
        .map((g) => `${g.name}(${g.cells}셀)`)
        .join(', ')}`,
    );
  }

  // 항로 연결
  {
    const expected = (world.cities.length * (world.cities.length - 1)) / 2;
    const ok = world.seaRoutes.length === expected && world.seaRoutes.every((r) => r.distanceKm > 0 && Number.isFinite(r.distanceKm));
    const lens = world.seaRoutes.map((r) => r.distanceKm);
    add(
      'routes',
      '모든 항구 쌍이 해상 항로로 연결된다',
      ok,
      `${world.seaRoutes.length}/${expected}개 항로, ${Math.round(Math.min(...lens))}~${Math.round(Math.max(...lens))}km`,
    );
  }

  // 육지 관통·끊김 없음
  {
    let onLand = 0;
    let maxStep = 0;
    for (const r of world.seaRoutes) {
      const pts = densifyPath(r.waypoints, 0.2);
      for (let k = 0; k < pts.length; k++) {
        if (!nav.mask[latToY(world.grid, pts[k][0]) * w + lonToX(world.grid, pts[k][1])]) onLand++;
        if (k > 0) {
          maxStep = Math.max(maxStep, angularDistance(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) / DEG);
        }
      }
    }
    add(
      'routes-sea',
      '항로가 육지를 지나지 않고 경도 경계에서 끊기지 않는다',
      onLand === 0 && maxStep < 0.3,
      `육지 위 표본점 ${onLand}개, 최대 표본 간격 ${maxStep.toFixed(2)}°`,
    );
  }

  // 관문 봉쇄: 하나를 막으면 우회, 모두 막으면 중앙해가 고립
  {
    const central = world.cities.find((c) => c.seaZone === 'central');
    const outer = world.cities.find((c) => c.seaZone === 'outer');
    let ok = false;
    let detail = '중앙해 또는 외해 항구가 없음';
    if (central && outer) {
      const all = world.chokepoints.map((g) => g.index);
      const open = findSeaRoute(nav, central.seaCell, outer.seaCell);
      const sealed = findSeaRoute(nav, central.seaCell, outer.seaCell, all);
      const detours = all.map((g) => findSeaRoute(nav, central.seaCell, outer.seaCell, [g]));
      ok = !!open && sealed === null && detours.every((d) => d !== null);
      detail = `${central.name}→${outer.name}: 평시 ${open ? Math.round(open.distanceKm) : '-'}km, ${world.chokepoints
        .map((g, k) => `${g.name} 봉쇄 시 ${detours[k] ? Math.round(detours[k]!.distanceKm) : '-'}km`)
        .join(', ')}, 전부 봉쇄 시 ${sealed ? '연결됨(오류)' : '고립'}`;
    }
    add('gates', '해협 하나를 막으면 우회하고, 모두 막으면 중앙해가 고립된다', ok, detail);
  }

  // 기후 다양성
  {
    const shares = world.stats.climateShare;
    const present = CLIMATE_ZONES.filter((z) => z.id > 0 && (shares[z.id] ?? 0) >= 0.015);
    const groups = new Set(present.map((z) => z.group));
    const ok = present.length >= 5 && groups.has('열대') && groups.has('건조') && groups.has('온대');
    add(
      'climate',
      '기후대가 다양하다(열대·건조·온대 포함 5종 이상)',
      ok,
      present.map((z) => `${z.name} ${((shares[z.id] ?? 0) * 100).toFixed(0)}%`).join(', '),
    );
  }

  // 계절 반대
  {
    let nJan = 0, nJul = 0, nCnt = 0, sJan = 0, sJul = 0, sCnt = 0;
    for (let y = 0; y < h; y++) {
      const lat = 90 - ((y + 0.5) * 180) / h;
      if (Math.abs(lat) < 30) continue;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!L.continentId[i]) continue;
        const jan = L.tempMonthly[i] * TEMP_SCALE;
        const jul = L.tempMonthly[6 * n + i] * TEMP_SCALE;
        if (lat > 0) { nJan += jan; nJul += jul; nCnt++; } else { sJan += jan; sJul += jul; sCnt++; }
      }
    }
    const ok = nCnt > 0 && sCnt > 0 && nJul / nCnt - nJan / nCnt > 5 && sJan / sCnt - sJul / sCnt > 5;
    add(
      'seasons',
      '북반구와 남반구의 계절이 반대다',
      ok,
      `북(30°↑) 1월 ${(nJan / nCnt).toFixed(1)}°C·7월 ${(nJul / nCnt).toFixed(1)}°C / 남(30°↓) 1월 ${(sJan / sCnt).toFixed(1)}°C·7월 ${(sJul / sCnt).toFixed(1)}°C`,
    );
  }

  // 작물 다양성
  {
    const parts: string[] = [];
    let ok = true;
    for (const crop of cfg.crops) {
      const growers = world.countries.filter((c) =>
        world.cities.some((city) => city.countryId === c.id && (city.region.crops[crop.id]?.arableAreaKm2 ?? 0) > 100_000),
      );
      if (growers.length < 2) ok = false;
      parts.push(`${crop.name}: ${growers.map((c) => c.name).join('·') || '없음'}`);
    }
    add('crops', '작물마다 2개국 이상에서 재배할 수 있다', ok, parts.join(' / '));
  }

  // 수확기 차이
  {
    const staple = cfg.crops.find((c) => c.kind === 'seasonal');
    const farms = world.cities
      .filter((c) => staple && (c.region.crops[staple.id]?.arableAreaKm2 ?? 0) > 100_000)
      .map((c) => ({ c, peak: peakMonth(c.region.crops[staple!.id].monthlyCoef) }));
    const north = farms.filter((f) => f.c.lat > 33);
    const south = farms.filter((f) => f.c.lat < -33);
    let ok = false;
    let detail = '북·남 온대 곡창이 모두 있어야 함';
    if (north.length && south.length) {
      const diff = Math.abs(north[0].peak - south[0].peak);
      ok = Math.min(diff, 12 - diff) >= 4;
      detail = `${north[0].c.name} ${north[0].peak + 1}월 / ${south[0].c.name} ${south[0].peak + 1}월`;
    }
    add('harvest', '남북반구의 곡물 수확기가 서로 다르다', ok, detail);
  }

  // 자원 다양성
  {
    const parts: string[] = [];
    let ok = true;
    for (const res of cfg.resources) {
      const owners = world.countries.filter((c) =>
        world.cities.some((city) => city.countryId === c.id && (city.region.resources[res.id] ?? 0) > 1),
      );
      const continents = new Set(owners.map((c) => c.continent));
      if (owners.length < 2 || continents.size < 2) ok = false;
      parts.push(`${res.name}: ${owners.map((c) => c.name).join('·') || '없음'}`);
    }
    add('resources', '자원마다 두 대륙, 2개국 이상에 분포한다', ok, parts.join(' / '));
  }

  return { ok: checks.every((c) => c.ok), checks };
}
