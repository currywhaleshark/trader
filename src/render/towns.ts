import { cellLatLon } from '../sim/core/grid';
import { angularDistance, DEG } from '../sim/core/sphere';
import { SEA_ZONE, type World } from '../sim/world/types';

/** 화면에만 있는 내륙 도시(아직 경제에는 참여하지 않는다) */
export interface Town {
  id: string;
  countryId: string;
  lat: number;
  lon: number;
  /** 1 마을 · 2 소도시(나라마다 첫째) */
  size: 1 | 2;
}

/** 해안에서 이만큼(격자 칸) 떨어져야 내륙 */
const COAST_CELLS = 6;
/** 도시끼리 최소 간격(도) */
const MIN_SPACING_DEG = 5;

/**
 * 세계 지형에서 내륙 도시 자리를 고른다. 같은 세계면 늘 같은 결과.
 * 강이 흐르고 곡물이 잘 자라는 낮은 땅을 좋아하고, 해안·높은 산·다른 도시 곁은 피한다.
 * 큰 나라일수록 많이(2~4곳).
 */
export function placeTowns(world: World): Town[] {
  const { grid, layers } = world;
  const w = grid.width;
  const h = grid.height;
  const grain = layers.cropSuitability.grain;

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
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = (y / 2) % 2; x < w; x += 2) {
      const i = y * w + x;
      const c = layers.countryId[i];
      if (!c) continue;
      const elev = layers.elevation[i];
      if (elev > 1800) continue;
      if (!inland(x, y)) continue;
      // 결정적인 작은 흔들림으로 줄 맞춘 배치를 피한다
      const jitter = (((i * 2654435761) >>> 0) % 1000) / 1000;
      const score =
        (layers.riverFlow[i] / 255) * 1.4 + (grain ? grain[i] / 255 : 0.3) + (elev < 700 ? 0.3 : 0) + jitter * 0.25;
      byCountry[c - 1].push({ cell: i, score });
    }
  }

  const maxArea = Math.max(1, ...world.countries.map((c) => c.areaKm2));
  const taken: [number, number][] = world.cities.map((c) => [c.lat, c.lon]);
  const far = (lat: number, lon: number) =>
    taken.every(([a, b]) => angularDistance(lat, lon, a, b) / DEG >= MIN_SPACING_DEG);

  const towns: Town[] = [];
  world.countries.forEach((country, k) => {
    const want = 2 + Math.round((2 * country.areaKm2) / maxArea);
    const cands = byCountry[k].sort((a, b) => b.score - a.score);
    let n = 0;
    for (const cand of cands) {
      if (n >= want) break;
      const [lat, lon] = cellLatLon(grid, cand.cell);
      if (!far(lat, lon)) continue;
      taken.push([lat, lon]);
      towns.push({ id: `town-${country.id}-${n}`, countryId: country.id, lat, lon, size: n === 0 ? 2 : 1 });
      n++;
    }
  });
  return towns;
}
