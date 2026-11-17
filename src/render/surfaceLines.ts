import type { LatLon } from '../sim/core/sphere';
import { flowDirections } from '../sim/world/gen/hydrology';
import type { World } from '../sim/world/types';

/**
 * 지표 위의 선(강·국경). 격자 자료에서 꺾은선을 뽑아 둥글게 다듬는다.
 * 지구본이 이 선을 구면 위 띠로 그리므로, 텍스처에 구운 것과 달리 확대해도 또렷하다.
 */
export interface SurfaceLine {
  points: LatLon[];
  /** 굵기(1/8도 단위). 점마다 다르면 배열 */
  width: number | number[];
  color: string;
}

type P = [number, number, number]; // 격자 좌표 x, y + 굵기

/** 모서리를 깎아 둥글게(Chaikin). 양 끝점은 그대로 둔다 */
function smooth(pts: P[], rounds: number): P[] {
  let cur = pts;
  for (let r = 0; r < rounds && cur.length > 2; r++) {
    const out: P[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

const riverCache = new WeakMap<World, SurfaceLine[]>();
const borderCache = new WeakMap<World, SurfaceLine[]>();

/** 강: 유향을 따라 상류에서 하류로 잇는다. 굵기는 유량을 따른다 */
export function riverLines(world: World): SurfaceLine[] {
  const hit = riverCache.get(world);
  if (hit) return hit;
  const { width: w, height: h } = world.grid;
  const L = world.layers;
  const n = w * h;
  const minByte = Math.round(Math.log2(1 + world.config.hydrology.riverMinFlow) * 16);
  const { down } = flowDirections(world.grid, L.elevation, L.continentId);
  const isRiver = (i: number) => L.continentId[i] !== 0 && L.riverFlow[i] >= minByte;

  let maxByte = minByte + 1;
  // 칸마다 가장 큰 상류(본류)를 정한다: 본류는 한 줄로 길게, 지류는 합류점에서 끝난다
  const mainUp = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isRiver(i)) continue;
    if (L.riverFlow[i] > maxByte) maxByte = L.riverFlow[i];
    const d = down[i];
    if (d >= 0 && (mainUp[d] < 0 || L.riverFlow[i] > L.riverFlow[mainUp[d]])) mainUp[d] = i;
  }
  const widthOf = (i: number) => 1 + (2.4 * (L.riverFlow[i] - minByte)) / (maxByte - minByte);
  const toLatLon = (p: P): LatLon => [90 - ((p[1] + 0.5) * 180) / h, -180 + ((p[0] + 0.5) * 360) / w];

  const lines: SurfaceLine[] = [];
  for (let s = 0; s < n; s++) {
    if (!isRiver(s) || mainUp[s] >= 0) continue; // 발원지에서만 출발
    const pts: P[] = [];
    let i = s;
    let x = i % w;
    const push = (c: number) => {
      // 경도 경계를 넘어도 이어지게 x를 펼친다
      let dx = (c % w) - (((x % w) + w) % w);
      if (dx > w / 2) dx -= w;
      else if (dx < -w / 2) dx += w;
      x += dx;
      pts.push([x, Math.floor(c / w), widthOf(c)]);
    };
    for (;;) {
      push(i);
      const d = down[i];
      if (d < 0) {
        // 하구: 맞닿은 바다 쪽으로 반 칸 더 내밀어 해안선에 닿게 한다
        const cy = Math.floor(i / w);
        const cx = i % w;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const ny = cy + oy;
          if (ny < 0 || ny >= h) continue;
          if (L.continentId[ny * w + ((cx + ox + w) % w)] === 0) {
            pts.push([x + ox * 0.5, cy + oy * 0.5, widthOf(i)]);
            break;
          }
        }
        break;
      }
      if (mainUp[d] !== i) {
        push(d); // 지류: 합류점에서 끝
        break;
      }
      i = d;
    }
    if (pts.length < 2) continue;
    const sm = smooth(pts, 2);
    lines.push({ points: sm.map(toLatLon), width: sm.map((p) => p[2]), color: 'rgba(70,140,205,0.92)' });
  }
  riverCache.set(world, lines);
  return lines;
}

/** 국경: 나라가 다른 이웃 육지 칸 사이의 변을 이어 붙인다 */
export function borderLines(world: World): SurfaceLine[] {
  const hit = borderCache.get(world);
  if (hit) return hit;
  const { width: w, height: h } = world.grid;
  const L = world.layers;
  const V = (h + 1) * w; // 격자 꼭짓점 수(vx는 좌우로 이어진다)
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  const differ = (a: number, b: number) => L.continentId[a] !== 0 && L.continentId[b] !== 0 && L.countryId[a] !== L.countryId[b];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const vx = (x + 1) % w;
      if (differ(i, y * w + vx)) link(y * w + vx, (y + 1) * w + vx);
      if (y < h - 1 && differ(i, i + w)) link((y + 1) * w + x, (y + 1) * w + vx);
    }
  }
  const used = new Set<number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * V + b : b * V + a);
  const lines: SurfaceLine[] = [];
  const walk = (start: number, next: number) => {
    const pts: P[] = [];
    let x = start % w;
    let prev = start;
    pts.push([x, Math.floor(start / w), 0]);
    let cur = next;
    for (;;) {
      used.add(edgeKey(prev, cur));
      let dx = (cur % w) - (((x % w) + w) % w);
      if (dx > w / 2) dx -= w;
      else if (dx < -w / 2) dx += w;
      x += dx;
      pts.push([x, Math.floor(cur / w), 0]);
      const nb = adj.get(cur)!;
      if (nb.length !== 2) break; // 세 나라가 만나는 점·해안에서 끝
      const nxt = nb[0] === prev ? nb[1] : nb[0];
      if (used.has(edgeKey(cur, nxt))) break;
      prev = cur;
      cur = nxt;
    }
    const sm = smooth(pts, 2);
    lines.push({
      points: sm.map((p): LatLon => [90 - (p[1] * 180) / h, -180 + (p[0] * 360) / w]),
      width: 1.6,
      color: 'rgba(30,25,30,0.7)',
    });
  };
  // 갈림점에서 먼저 출발하고, 남은 것(닫힌 고리)을 마저 돈다
  for (const pass of [0, 1]) {
    for (const [v, nb] of adj) {
      if (pass === 0 && nb.length === 2) continue;
      for (const o of nb) if (!used.has(edgeKey(v, o))) walk(v, o);
    }
  }
  borderCache.set(world, lines);
  return lines;
}
