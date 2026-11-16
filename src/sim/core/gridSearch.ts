import type { GridMetrics, GridSpec } from './grid';

/** (키, 값) 이진 최소 힙 */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** 가장 작은 키의 값을 꺼낸다. 비어 있으면 -1. */
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const n = keys.length;
    if (n === 0) return -1;
    const top = vals[0];
    const key = keys.pop() as number;
    const val = vals.pop() as number;
    const m = n - 1;
    if (m > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= m) break;
        if (c + 1 < m && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

export const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

export interface SearchOptions {
  /** 1 = 지나갈 수 있는 셀. 출발 셀은 값과 무관하게 허용된다. */
  passable: Uint8Array;
  /** 셀별 비용 배수(양 끝 셀의 평균을 쓴다) */
  costMul?: Float32Array;
  /** 지정하면 이 셀에 닿는 즉시 멈춘다 */
  goal?: number;
  /** A* 휴리스틱(km). goal과 함께 쓴다. */
  heuristic?: (cell: number) => number;
  /** 대각선 이동 시 양옆 직교 셀도 통과 가능해야 한다(육지 모서리 관통 방지) */
  strictCorners?: boolean;
}

export interface SearchResult {
  dist: Float64Array;
  prev: Int32Array;
}

/** 경도 방향으로 이어진 8방향 격자 위 Dijkstra / A*. 거리 단위 km. */
export function gridSearch(
  g: GridSpec,
  m: GridMetrics,
  sources: ArrayLike<number>,
  opt: SearchOptions,
): SearchResult {
  const w = g.width;
  const h = g.height;
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const { passable, costMul, heuristic, strictCorners } = opt;
  const goal = opt.goal ?? -1;

  for (let k = 0; k < sources.length; k++) {
    const s = sources[k];
    dist[s] = 0;
    heap.push(heuristic ? heuristic(s) : 0, s);
  }

  while (heap.size > 0) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const x = i % w;
    const y = (i - x) / w;
    const di = dist[i];
    for (let k = 0; k < 8; k++) {
      const ny = y + DY8[k];
      if (ny < 0 || ny >= h) continue;
      let nx = x + DX8[k];
      if (nx < 0) nx += w;
      else if (nx >= w) nx -= w;
      const j = ny * w + nx;
      if (!passable[j] || closed[j]) continue;
      let step: number;
      if (DY8[k] === 0) step = m.rowDx[y];
      else if (DX8[k] === 0) step = m.dy;
      else {
        if (strictCorners && (!passable[y * w + nx] || !passable[ny * w + x])) continue;
        step = m.diagDown[ny < y ? ny : y];
      }
      if (costMul) step *= 0.5 * (costMul[i] + costMul[j]);
      const nd = di + step;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(heuristic ? nd + heuristic(j) : nd, j);
      }
    }
  }
  return { dist, prev };
}

/**
 * 연결 성분 라벨링. mask가 1인 셀만 대상.
 * connectivity 4 = 바다(대각선으로는 못 지나감), 8 = 육지.
 */
export function labelComponents(
  g: GridSpec,
  mask: Uint8Array,
  connectivity: 4 | 8,
): { labels: Int32Array; sizes: number[] } {
  const w = g.width;
  const h = g.height;
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  const stepK = connectivity === 4 ? 2 : 1;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 8; k += stepK) {
        const ny = y + DY8[k];
        if (ny < 0 || ny >= h) continue;
        let nx = x + DX8[k];
        if (nx < 0) nx += w;
        else if (nx >= w) nx -= w;
        const j = ny * w + nx;
        if (mask[j] && labels[j] < 0) {
          labels[j] = id;
          queue[tail++] = j;
        }
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}
