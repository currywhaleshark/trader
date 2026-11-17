import { cellLatLon } from '../sim/core/grid';
import { DEG } from '../sim/core/sphere';
import type { City, World } from '../sim/world/types';

/**
 * 화면에 그려지는 해안선과 같은 기준으로 "여기가 땅인가"를 잰다.
 * GlobeView의 지표 셰이더(maskSmooth)와 같은 보간이다 — 둘을 함께 바꿔야 한다.
 * 0.5보다 크면 땅.
 */
function weights(t: number, out: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  const u = 1 - t;
  const cr = [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
  const bs = [(u * u * u) / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
  for (let k = 0; k < 4; k++) out[k] = cr[k] * 0.2 + bs[k] * 0.8;
}

const wx = new Float64Array(4);
const wy = new Float64Array(4);

export function landness(world: World, lat: number, lon: number): number {
  const { width: w, height: h } = world.grid;
  const land = world.layers.continentId;
  const gx = ((lon + 180) / 360) * w - 0.5;
  const gy = ((90 - lat) / 180) * h - 0.5;
  const bx = Math.floor(gx);
  const by = Math.floor(gy);
  weights(gx - bx, wx);
  weights(gy - by, wy);
  let s = 0;
  for (let j = 0; j < 4; j++) {
    const y = Math.min(h - 1, Math.max(0, by + j - 1));
    let r = 0;
    for (let i = 0; i < 4; i++) {
      const x = (((bx + i - 1) % w) + w) % w;
      if (land[y * w + x]) r += wx[i];
    }
    s += wy[j] * r;
  }
  return s;
}

export interface PortSite {
  /** 부두가 놓일 물가의 점 */
  lat: number;
  lon: number;
  /** 바다 쪽(해안선에 수직)으로 1도 나간 점 */
  seaLat: number;
  seaLon: number;
}

/**
 * 항구 도시가 설 물가를 찾는다: 도시 칸에서 앞바다 칸 쪽으로 가다 그려진 해안선을 만나는 점.
 * 부두는 그 자리 해안선에 수직으로 바다를 향한다.
 */
export function portSite(world: World, city: City): PortSite {
  if (city.seaCell < 0) return { lat: city.lat, lon: city.lon, seaLat: city.lat, seaLon: city.lon + 1 };
  const [sLat, sLon0] = cellLatLon(world.grid, city.seaCell);
  let dLon = sLon0 - city.lon;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  const dLat = sLat - city.lat;
  const at = (t: number): [number, number] => [city.lat + dLat * t, city.lon + dLon * t];
  const isLand = (t: number) => landness(world, ...at(t)) > 0.5;

  let t = 0;
  if (isLand(0)) {
    // 땅에서 출발해 처음 바다가 되는 곳까지 걷고, 그 사이를 이분법으로 좁힌다
    let lo = 0;
    let hi = 1;
    for (let k = 1; k <= 32; k++) {
      if (!isLand(k / 32)) {
        hi = k / 32;
        break;
      }
      lo = k / 32;
    }
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (isLand(mid)) lo = mid;
      else hi = mid;
    }
    t = lo;
  }
  const [lat, lon] = at(t);

  // 바다 방향: 땅다움이 줄어드는 쪽(해안선에 수직). 기울기가 없으면 앞바다 칸 쪽
  const e = 0.2;
  const cos = Math.max(0.2, Math.cos(lat * DEG));
  let gLat = landness(world, lat + e, lon) - landness(world, lat - e, lon);
  let gLon = landness(world, lat, lon + e / cos) - landness(world, lat, lon - e / cos);
  let len = Math.hypot(gLat, gLon);
  if (len < 1e-3) {
    gLat = -dLat;
    gLon = -dLon * cos;
    len = Math.hypot(gLat, gLon) || 1;
  }
  return { lat, lon, seaLat: lat - gLat / len, seaLon: lon - gLon / len / cos };
}
