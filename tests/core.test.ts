import { describe, expect, it } from 'vitest';
import { cellIndex, cellLat, cellLatLon, cellLon, computeMetrics } from '../src/sim/core/grid';
import { gridSearch, labelComponents, MinHeap } from '../src/sim/core/gridSearch';
import { Noise3D } from '../src/sim/core/noise';
import { SeededRNG } from '../src/sim/core/rng';
import {
  DEG,
  angularDistance,
  capsuleDistance,
  densifyPath,
  latLonToVec3,
  makeCapsule,
  vec3ToLatLon,
  wrapLon,
} from '../src/sim/core/sphere';

describe('SeededRNG', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = new SeededRNG('seed');
    const b = new SeededRNG('seed');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('다른 시드는 다른 수열을 내고 값은 [0, 1) 안이다', () => {
    const a = new SeededRNG('seed-a');
    const b = new SeededRNG('seed-b');
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const v = a.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v === b.next()) same++;
    }
    expect(same).toBeLessThan(3);
  });

  it('fork는 부모의 소비량과 무관하다', () => {
    const a = new SeededRNG('root');
    const b = new SeededRNG('root');
    for (let i = 0; i < 37; i++) a.next();
    expect(a.fork('climate').next()).toBe(b.fork('climate').next());
    expect(a.fork('climate').next()).not.toBe(a.fork('terrain').next());
  });

  it('상태를 저장했다 되살리면 이어서 같은 값을 낸다', () => {
    const a = new SeededRNG('save');
    for (let i = 0; i < 10; i++) a.next();
    const b = SeededRNG.fromState(JSON.parse(JSON.stringify(a.getState())));
    for (let i = 0; i < 20; i++) expect(b.next()).toBe(a.next());
  });
});

describe('구면 기하', () => {
  it('위경도 <-> 벡터 변환이 왕복한다', () => {
    for (const [lat, lon] of [[0, 0], [45, 90], [-30, -120], [80, 179.5], [-60, -179.5]]) {
      const back = vec3ToLatLon(latLonToVec3(lat, lon));
      expect(back[0]).toBeCloseTo(lat, 9);
      expect(wrapLon(back[1] - lon)).toBeCloseTo(0, 9);
    }
  });

  it('대권거리: 적도 90°, 극까지 90°', () => {
    expect(angularDistance(0, 0, 0, 90) / DEG).toBeCloseTo(90, 9);
    expect(angularDistance(0, 10, 90, 200) / DEG).toBeCloseTo(90, 9);
  });

  it('경도 ±180° 경계에서 거리가 연속이다', () => {
    expect(angularDistance(10, 179, 10, -179) / DEG).toBeLessThan(2.01);
    expect(angularDistance(0, 179.9, 0, -179.9) / DEG).toBeCloseTo(0.2, 6);
  });

  it('날짜변경선을 넘는 경로를 잘게 나눠도 점프가 없다', () => {
    const pts = densifyPath([[20, 170], [-10, -165]], 0.5);
    for (let i = 1; i < pts.length; i++) {
      expect(angularDistance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) / DEG).toBeLessThan(0.51);
    }
    expect(pts[pts.length - 1][0]).toBeCloseTo(-10, 6);
  });

  it('캡슐 거리: 선분 위는 0, 옆은 수직 거리, 끝 너머는 끝점 거리', () => {
    const cap = makeCapsule([0, 0], [0, 40]);
    const d = (lat: number, lon: number) => {
      const v = latLonToVec3(lat, lon);
      return capsuleDistance(cap, v[0], v[1], v[2]) / DEG;
    };
    expect(d(0, 20)).toBeCloseTo(0, 6);
    expect(d(7, 20)).toBeCloseTo(7, 6);
    expect(d(0, 50)).toBeCloseTo(10, 6);
    expect(d(0, -5)).toBeCloseTo(5, 6);
  });
});

describe('격자', () => {
  const grid = { width: 72, height: 36 };

  it('셀 중심 좌표 <-> 셀 번호가 왕복한다', () => {
    for (const i of [0, 71, 72 * 17 + 5, 72 * 35 + 71]) {
      const [lat, lon] = cellLatLon(grid, i);
      expect(cellIndex(grid, lat, lon)).toBe(i);
    }
    expect(cellLat(grid, 0)).toBe(87.5);
    expect(cellLon(grid, 0)).toBe(-177.5);
  });

  it('경도가 범위를 벗어나도 올바른 셀을 찾는다', () => {
    expect(cellIndex(grid, 0, 182.5)).toBe(cellIndex(grid, 0, -177.5));
    expect(cellIndex(grid, 0, -540)).toBe(cellIndex(grid, 0, 180));
  });

  it('탐색은 좌우 경계를 넘어 최단 경로를 찾는다', () => {
    const m = computeMetrics(grid, 6371);
    const passable = new Uint8Array(72 * 36).fill(1);
    const y = 18;
    const from = y * 72 + 1;
    const to = y * 72 + 70;
    const { dist } = gridSearch(grid, m, [from], { passable });
    expect(dist[to]).toBeCloseTo(3 * m.rowDx[y], 6); // 69칸이 아니라 3칸
  });

  it('벽이 있으면 돌아가고, 대각선으로 모서리를 뚫지 못한다', () => {
    const g = { width: 8, height: 8 };
    const m = computeMetrics(g, 6371);
    const passable = new Uint8Array(64).fill(1);
    // (3,3)과 (4,4)를 막으면 (4,3)->(3,4) 대각선은 양옆이 모두 막힌다
    passable[3 * 8 + 3] = 0;
    passable[4 * 8 + 4] = 0;
    const from = 3 * 8 + 4;
    const to = 4 * 8 + 3;
    const loose = gridSearch(g, m, [from], { passable }).dist[to];
    const strict = gridSearch(g, m, [from], { passable, strictCorners: true }).dist[to];
    expect(strict).toBeGreaterThan(loose * 1.5);
  });

  it('연결 성분: 좌우로 이어진 바다는 한 덩어리', () => {
    const g = { width: 6, height: 3 };
    const mask = new Uint8Array([1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    const { sizes, labels } = labelComponents(g, mask, 4);
    expect(sizes.length).toBe(2);
    expect(labels[0]).toBe(labels[5]);
    expect(labels[8]).not.toBe(labels[0]);
  });

  it('MinHeap은 키 순서대로 꺼낸다', () => {
    const heap = new MinHeap();
    const rng = new SeededRNG('heap');
    const keys: number[] = [];
    for (let i = 0; i < 500; i++) {
      const k = rng.next();
      keys.push(k);
      heap.push(k, i);
    }
    const sorted = [...keys].sort((a, b) => a - b);
    for (let i = 0; i < 500; i++) expect(keys[heap.pop()]).toBe(sorted[i]);
    expect(heap.pop()).toBe(-1);
  });
});

describe('Noise3D', () => {
  it('같은 시드에서 재현되고 값이 범위 안이며 0만 내지 않는다', () => {
    const a = new Noise3D(new SeededRNG('n'));
    const b = new Noise3D(new SeededRNG('n'));
    let min = 1;
    let max = -1;
    for (let i = 0; i < 2000; i++) {
      const v = a.fbm(i * 0.137, i * 0.071, i * 0.053, 4);
      expect(v).toBe(b.fbm(i * 0.137, i * 0.071, i * 0.053, 4));
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThan(-1.01);
    expect(max).toBeLessThan(1.01);
    expect(max - min).toBeGreaterThan(0.5);
  });
});
