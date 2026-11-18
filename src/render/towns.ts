import { cellLatLon } from '../sim/core/grid';
import { angularDistance, DEG } from '../sim/core/sphere';
import { flowDirections } from '../sim/world/gen/hydrology';
import { SEA_ZONE, type World } from '../sim/world/types';

/** 화면에만 있는 내륙 도시(아직 경제에는 참여하지 않는다) */
export interface Town {
  id: string;
  countryId: string;
  lat: number;
  lon: number;
  /** 1 마을 · 2 소도시 · 3 대도시(큰 나라의 가장 좋은 자리) */
  size: 1 | 2 | 3;
  /** 강가에 선 도시 */
  river: boolean;
  /** 도시의 큰길이 향하는 점: 강가 도시는 강이 흘러가는 쪽 */
  headLat: number;
  headLon: number;
}

/** 해안에서 이만큼(격자 칸) 떨어져야 내륙 */
const COAST_CELLS = 3;
/** 도시끼리 최소 간격(도) */
const MIN_SPACING_DEG = 2.4;
/** 대도시 둘레는 더 비운다(도) */
const METRO_SPACING_DEG = 6;
/** 한대 기후(CLIMATE_ZONES의 id) */
const POLAR = 9;

/**
 * 세계 지형에서 내륙 도시 자리를 고른다. 같은 세계면 늘 같은 결과.
 * 실제 도시처럼 강가에 선다: 강이 흐르는 칸을 가장 좋아하고(큰 강일수록), 곡물이 잘 자라는
 * 낮은 땅을 좋아한다. 해안·높은 산·얼음 땅·다른 도시 곁은 피한다. 큰 나라일수록 많이(6~14곳).
 * 나라마다 가장 좋은 자리 몇 곳은 소도시가 되고, 큰 나라는 첫째 자리가 대도시가 된다.
 */
export function placeTowns(world: World): Town[] {
  const { grid, layers } = world;
  const w = grid.width;
  const h = grid.height;
  const grain = layers.cropSuitability.grain;
  const riverMin = Math.round(Math.log2(1 + world.catalog.riverMinFlow) * 16);

  const inland = (x: number, y: number): boolean => {
    for (let dy = -COAST_CELLS; dy <= COAST_CELLS; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) return false;
      for (let dx = -COAST_CELLS; dx <= COAST_CELLS; dx++) {
        if (layers.seaZone[yy * w + ((x + dx + w) % w)] !== SEA_ZONE.LAND) return false;
      }
    }
    return true;
  };

  const byCountry: { cell: number; score: number }[][] = world.countries.map(() => []);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = layers.countryId[i];
      if (!c) continue;
      const elev = layers.elevation[i];
      if (elev > 1800 || layers.climateZone[i] === POLAR) continue;
      if (!inland(x, y)) continue;
      // 결정적인 작은 흔들림으로 줄 맞춘 배치를 피한다
      const jitter = (((i * 2654435761) >>> 0) % 1000) / 1000;
      const flow = layers.riverFlow[i];
      const river = flow >= riverMin ? 1.2 + ((flow - riverMin) / (255 - riverMin)) * 1.5 : 0;
      const score = river + (grain ? grain[i] / 255 : 0.3) + (elev < 700 ? 0.3 : 0) + jitter * 0.25;
      byCountry[c - 1].push({ cell: i, score });
    }
  }

  const maxArea = Math.max(1, ...world.countries.map((c) => c.areaKm2));
  // [위도, 경도, 둘레에 비워 둘 거리(도)]
  const taken: [number, number, number][] = world.cities.map((c) => [c.lat, c.lon, MIN_SPACING_DEG]);
  const far = (lat: number, lon: number, gap: number) =>
    taken.every(([a, b, g]) => angularDistance(lat, lon, a, b) / DEG >= Math.max(gap, g));
  const { down } = flowDirections(grid, layers.elevation, layers.continentId);

  const towns: Town[] = [];
  world.countries.forEach((country, k) => {
    const want = 6 + Math.round((8 * country.areaKm2) / maxArea);
    const metro = country.areaKm2 >= 0.35 * maxArea;
    const cands = byCountry[k].sort((a, b) => b.score - a.score);
    let n = 0;
    for (const cand of cands) {
      if (n >= want) break;
      const [lat, lon] = cellLatLon(grid, cand.cell);
      const size: 1 | 2 | 3 = n === 0 ? (metro ? 3 : 2) : n <= 2 ? 2 : 1;
      const gap = size === 3 ? METRO_SPACING_DEG : MIN_SPACING_DEG;
      if (!far(lat, lon, gap)) continue;
      taken.push([lat, lon, gap]);
      const river = layers.riverFlow[cand.cell] >= riverMin && down[cand.cell] >= 0;
      const [headLat, headLon] = river ? cellLatLon(grid, down[cand.cell]) : [lat + 1, lon];
      towns.push({ id: `town-${country.id}-${n}`, countryId: country.id, lat, lon, size, river, headLat, headLon });
      n++;
    }
  });
  return towns;
}
