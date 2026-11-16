import { cellLat, cellLon, computeMetrics, lonToX, latToY, type GridMetrics, type GridSpec } from '../core/grid';
import { gridSearch } from '../core/gridSearch';
import {
  DEG,
  angleBetween,
  densifyPath,
  latLonToVec3,
  pathAngularLength,
  vec3ToLatLon,
  type LatLon,
  type Vec3,
} from '../core/sphere';
import { SEA_ZONE } from './types';

/**
 * 해상 항로 탐색. 바다 셀을 노드로 하는 8방향 격자 그래프(경도 방향으로 이어짐) 위에서
 * Dijkstra/A*로 길을 찾고, 대권 직선으로 당겨 편 경유점 목록으로 만든다.
 * 생성 시(전 항구 쌍 사전 계산)와 런타임(해협 봉쇄 시 재탐색)이 같은 코드를 쓴다.
 */
export interface NavGrid {
  grid: GridSpec;
  metrics: GridMetrics;
  radiusKm: number;
  seaZone: Uint8Array;
  /** 1 = 항해 가능 */
  mask: Uint8Array;
  rowSin: Float64Array;
  rowCos: Float64Array;
  colSin: Float64Array;
  colCos: Float64Array;
}

export interface RouteResult {
  waypoints: LatLon[];
  distanceKm: number;
  /** 통과한 관문 해협 번호 */
  gates: number[];
}

export function buildNavGrid(grid: GridSpec, radiusKm: number, seaZone: Uint8Array): NavGrid {
  const n = grid.width * grid.height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = seaZone[i] !== SEA_ZONE.LAND && seaZone[i] !== SEA_ZONE.NON_NAVIGABLE ? 1 : 0;
  }
  const rowSin = new Float64Array(grid.height);
  const rowCos = new Float64Array(grid.height);
  const colSin = new Float64Array(grid.width);
  const colCos = new Float64Array(grid.width);
  for (let y = 0; y < grid.height; y++) {
    rowSin[y] = Math.sin(cellLat(grid, y) * DEG);
    rowCos[y] = Math.cos(cellLat(grid, y) * DEG);
  }
  for (let x = 0; x < grid.width; x++) {
    colSin[x] = Math.sin(cellLon(grid, x) * DEG);
    colCos[x] = Math.cos(cellLon(grid, x) * DEG);
  }
  return {
    grid,
    metrics: computeMetrics(grid, radiusKm),
    radiusKm,
    seaZone,
    mask,
    rowSin,
    rowCos,
    colSin,
    colCos,
  };
}

/** 봉쇄된 해협을 뺀 통행 마스크 */
export function maskWithBlockade(nav: NavGrid, blockedGates: readonly number[]): Uint8Array {
  if (blockedGates.length === 0) return nav.mask;
  const mask = nav.mask.slice();
  const blocked = new Set(blockedGates.map((g) => SEA_ZONE.GATE_BASE + g));
  for (let i = 0; i < mask.length; i++) if (blocked.has(nav.seaZone[i])) mask[i] = 0;
  return mask;
}

function cellVec(nav: NavGrid, cell: number): Vec3 {
  const w = nav.grid.width;
  const x = cell % w;
  const y = (cell - x) / w;
  return [nav.rowCos[y] * nav.colCos[x], nav.rowSin[y], -nav.rowCos[y] * nav.colSin[x]];
}

/** 두 점을 잇는 대권이 전부 통행 가능한 바다 위인가 */
function lineOfSight(nav: NavGrid, mask: Uint8Array, a: Vec3, b: Vec3): boolean {
  const ang = angleBetween(a, b);
  if (ang < 1e-9) return true;
  const step = 0.35 * (Math.PI / nav.grid.height);
  const k = Math.ceil(ang / step);
  const s = Math.sin(ang);
  const w = nav.grid.width;
  for (let q = 1; q < k; q++) {
    const t = q / k;
    const wa = Math.sin((1 - t) * ang) / s;
    const wb = Math.sin(t * ang) / s;
    const ll = vec3ToLatLon([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
    if (!mask[latToY(nav.grid, ll[0]) * w + lonToX(nav.grid, ll[1])]) return false;
  }
  return true;
}

/** 격자 경로를 대권 직선으로 당겨 편다(가시선 검사). */
function straighten(nav: NavGrid, fullMask: Uint8Array, cells: number[]): LatLon[] {
  // 직선 구간은 육지에서 한 칸 이상 떨어진 바다만 지나게 한다(표본 사이로 육지 모서리를 스치지 않도록).
  const mask = erode(nav, fullMask);
  const vecs = cells.map((c) => cellVec(nav, c));
  const out: LatLon[] = [vec3ToLatLon(vecs[0])];
  const n = cells.length;
  let i = 0;
  const STRIDE = 8;
  while (i < n - 1) {
    let next = i + 1;
    // 먼 쪽부터 성기게 훑어 처음 보이는 지점을 찾고, 그 앞 구간을 촘촘히 다듬는다
    for (let j = n - 1; j > i + 1; j -= STRIDE) {
      if (lineOfSight(nav, mask, vecs[i], vecs[j])) {
        next = j;
        for (let k = Math.min(n - 1, j + STRIDE - 1); k > j; k--) {
          if (lineOfSight(nav, mask, vecs[i], vecs[k])) {
            next = k;
            break;
          }
        }
        break;
      }
    }
    out.push(vec3ToLatLon(vecs[next]));
    i = next;
  }
  return out;
}

const erodeCache = new WeakMap<Uint8Array, Uint8Array>();

function erode(nav: NavGrid, mask: Uint8Array): Uint8Array {
  const hit = erodeCache.get(mask);
  if (hit) return hit;
  const { width: w, height: h } = nav.grid;
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : w - 1;
      const xr = x < w - 1 ? x + 1 : 0;
      let ok = 1;
      for (let yy = y - 1; yy <= y + 1 && ok; yy++) {
        if (!mask[yy * w + xl] || !mask[yy * w + x] || !mask[yy * w + xr]) ok = 0;
      }
      out[y * w + x] = ok;
    }
  }
  erodeCache.set(mask, out);
  return out;
}

/** prev 사슬을 따라 from→to 셀 경로를 복원해 항로로 만든다. 닿지 않으면 null. */
export function routeFromSearch(
  nav: NavGrid,
  mask: Uint8Array,
  prev: Int32Array,
  dist: Float64Array,
  fromCell: number,
  toCell: number,
): RouteResult | null {
  if (!Number.isFinite(dist[toCell])) return null;
  const cells: number[] = [];
  for (let c = toCell; c !== -1; c = prev[c]) {
    cells.push(c);
    if (c === fromCell) break;
  }
  if (cells[cells.length - 1] !== fromCell) return null;
  cells.reverse();
  const waypoints = cells.length > 1 ? straighten(nav, mask, cells) : [vec3ToLatLon(cellVec(nav, fromCell))];
  const gates = new Set<number>();
  const w = nav.grid.width;
  for (const p of densifyPath(waypoints, 0.25)) {
    const z = nav.seaZone[latToY(nav.grid, p[0]) * w + lonToX(nav.grid, p[1])];
    if (z >= SEA_ZONE.GATE_BASE) gates.add(z - SEA_ZONE.GATE_BASE);
  }
  return {
    waypoints,
    distanceKm: pathAngularLength(waypoints) * nav.radiusKm,
    gates: [...gates].sort((a, b) => a - b),
  };
}

/** 한 셀에서 모든 바다 셀까지 (전 항구 쌍 사전 계산용) */
export function searchFrom(nav: NavGrid, mask: Uint8Array, fromCell: number) {
  return gridSearch(nav.grid, nav.metrics, [fromCell], { passable: mask, strictCorners: true });
}

/**
 * 런타임 항로 탐색(A*, 대권거리 휴리스틱). blockedGates의 해협은 지나지 않는다.
 * 출발·도착 셀이 봉쇄 구역 안이어도 그 셀 자체는 허용한다.
 */
export function findSeaRoute(
  nav: NavGrid,
  fromCell: number,
  toCell: number,
  blockedGates: readonly number[] = [],
): RouteResult | null {
  let mask = maskWithBlockade(nav, blockedGates);
  if (!mask[fromCell] || !mask[toCell]) {
    if (!nav.mask[fromCell] || !nav.mask[toCell]) return null;
    mask = mask === nav.mask ? mask.slice() : mask;
    mask[fromCell] = 1;
    mask[toCell] = 1;
  }
  const w = nav.grid.width;
  const gx = toCell % w;
  const gy = (toCell - gx) / w;
  const gs = nav.rowSin[gy];
  const gc = nav.rowCos[gy];
  const gcl = nav.colCos[gx];
  const gsl = nav.colSin[gx];
  const heuristic = (cell: number): number => {
    const x = cell % w;
    const y = (cell - x) / w;
    const d = nav.rowSin[y] * gs + nav.rowCos[y] * gc * (nav.colCos[x] * gcl + nav.colSin[x] * gsl);
    return nav.radiusKm * Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * 0.999;
  };
  const { dist, prev } = gridSearch(nav.grid, nav.metrics, [fromCell], {
    passable: mask,
    strictCorners: true,
    goal: toCell,
    heuristic,
  });
  return routeFromSearch(nav, mask, prev, dist, fromCell, toCell);
}

/** 위경도에서 가장 가까운 항해 가능 셀(주변 탐색). 없으면 -1. */
export function nearestNavigableCell(nav: NavGrid, lat: number, lon: number, maxRing = 12): number {
  const { width: w, height: h } = nav.grid;
  const x0 = lonToX(nav.grid, lon);
  const y0 = latToY(nav.grid, lat);
  const target = latLonToVec3(lat, lon);
  let best = -1;
  let bestAng = Infinity;
  for (let r = 0; r <= maxRing; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cell = y * w + ((x0 + dx + w * 4) % w);
        if (!nav.mask[cell]) continue;
        const ang = angleBetween(cellVec(nav, cell), target);
        if (ang < bestAng) {
          bestAng = ang;
          best = cell;
        }
      }
    }
    if (best >= 0) return best;
  }
  return best;
}
