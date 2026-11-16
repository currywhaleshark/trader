import { DX8, DY8, MinHeap } from '../../core/gridSearch';
import { clamp } from '../../core/math';
import { PRECIP_SCALE } from '../types';
import type { GenContext } from './context';

/** riverFlow 레이어 값 <-> 유량(m³/s) */
export function flowToByte(q: number): number {
  return clamp(Math.round(Math.log2(1 + q) * 16), 0, 255);
}
export function byteToFlow(b: number): number {
  return Math.pow(2, b / 16) - 1;
}

/**
 * 하천: priority-flood로 웅덩이 없는 유향을 만들고 연 강수를 하류로 누적한다.
 * 반환: riverFlow (log 스케일 유량)
 */
export function generateHydrology(
  ctx: GenContext,
  elevation: Int16Array,
  isLand: Uint8Array,
  precipMonthly: Uint8Array,
): Uint8Array {
  const { grid, n, metrics } = ctx;
  const w = grid.width;
  const h = grid.height;
  const down = new Int32Array(n).fill(-1);
  const filled = new Float32Array(n);
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const heap = new MinHeap();

  for (let i = 0; i < n; i++) {
    if (!isLand[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < 8; k++) {
      const ny = y + DY8[k];
      if (ny < 0 || ny >= h) continue;
      const j = ny * w + ((x + DX8[k] + w) % w);
      if (!isLand[j]) {
        visited[i] = 1;
        filled[i] = elevation[i];
        heap.push(elevation[i], i);
        break;
      }
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    order.push(i);
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < 8; k++) {
      const ny = y + DY8[k];
      if (ny < 0 || ny >= h) continue;
      const j = ny * w + ((x + DX8[k] + w) % w);
      if (!isLand[j] || visited[j]) continue;
      visited[j] = 1;
      filled[j] = Math.max(elevation[j], filled[i]);
      down[j] = i;
      heap.push(filled[j], j);
    }
  }

  const q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!isLand[i]) continue;
    let annual = 0;
    for (let m = 0; m < 12; m++) annual += precipMonthly[m * n + i] * PRECIP_SCALE;
    // 건조할수록 유출률이 낮다(증발)
    const runoff = clamp((annual - 250) / 1500, 0.02, 0.6);
    // mm/년 × km² -> m³/s
    q[i] = annual * metrics.rowArea[(i - (i % w)) / w] * runoff * 3.171e-5;
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (down[i] >= 0) q[down[i]] += q[i];
  }
  const riverFlow = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isLand[i]) riverFlow[i] = flowToByte(q[i]);
  return riverFlow;
}
