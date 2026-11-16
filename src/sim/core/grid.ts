import { DEG, wrapLon } from './sphere';

/**
 * 등장방형 위경도 격자. 셀 (x, y):
 *   경도 = -180 + (x + 0.5) * 360 / width   (x는 동쪽으로 증가, 좌우가 이어진다)
 *   위도 =   90 - (y + 0.5) * 180 / height  (y는 남쪽으로 증가)
 */
export interface GridSpec {
  width: number;
  height: number;
}

export function cellLat(g: GridSpec, y: number): number {
  return 90 - ((y + 0.5) * 180) / g.height;
}

export function cellLon(g: GridSpec, x: number): number {
  return -180 + ((x + 0.5) * 360) / g.width;
}

export function latToY(g: GridSpec, lat: number): number {
  const y = Math.floor(((90 - lat) / 180) * g.height);
  return y < 0 ? 0 : y >= g.height ? g.height - 1 : y;
}

export function lonToX(g: GridSpec, lon: number): number {
  const x = Math.floor(((wrapLon(lon) + 180) / 360) * g.width);
  return x >= g.width ? g.width - 1 : x < 0 ? 0 : x;
}

export function cellIndex(g: GridSpec, lat: number, lon: number): number {
  return latToY(g, lat) * g.width + lonToX(g, lon);
}

export function cellLatLon(g: GridSpec, i: number): [number, number] {
  return [cellLat(g, Math.floor(i / g.width)), cellLon(g, i % g.width)];
}

/** 행별 거리 척도(km). 경로 탐색과 면적 계산이 공유한다. */
export interface GridMetrics {
  /** 동서로 한 칸 */
  rowDx: Float64Array;
  /** 남북으로 한 칸 */
  dy: number;
  /** 행 y와 y+1 사이 대각선 한 칸 */
  diagDown: Float64Array;
  /** 셀 면적(km²) */
  rowArea: Float64Array;
}

export function computeMetrics(g: GridSpec, radiusKm: number): GridMetrics {
  const dLat = Math.PI / g.height;
  const dLon = (2 * Math.PI) / g.width;
  const dy = radiusKm * dLat;
  const rowDx = new Float64Array(g.height);
  const rowArea = new Float64Array(g.height);
  const diagDown = new Float64Array(g.height);
  for (let y = 0; y < g.height; y++) {
    rowDx[y] = radiusKm * Math.cos(cellLat(g, y) * DEG) * dLon;
    rowArea[y] = rowDx[y] * dy;
  }
  for (let y = 0; y < g.height - 1; y++) {
    diagDown[y] = Math.hypot((rowDx[y] + rowDx[y + 1]) / 2, dy);
  }
  return { rowDx, dy, diagDown, rowArea };
}
