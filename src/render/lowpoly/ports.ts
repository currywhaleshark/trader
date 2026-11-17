import type * as THREE from 'three';
import { ModelBuilder, PALETTE, seeded } from './kit';

/**
 * 로우폴리 항구 도시. 지름 약 1, 위 +y, 바다는 +x 쪽(부두가 바다로 뻗는다).
 * 항만 규모(1~3)에 따라 자란다:
 *  1 작은 항구: 나무 부두, 창고 하나, 등대, 집 몇 채
 *  2 중간 항구: 콘크리트 부두, 창고 둘, 지브 크레인, 마을이 커짐
 *  3 큰 항구: 긴 부두 둘, 갠트리 크레인, 컨테이너 야적장, 도시
 * 지붕 일부는 나라 색이라 어느 나라 항구인지 보인다.
 */
export interface PortLook {
  cityId: string;
  level: 1 | 2 | 3;
  countryColor: string;
}

function house(m: ModelBuilder, x: number, z: number, s: number, wall: string, roof: string, rot: number): void {
  const w = 0.07 * s;
  const d = 0.06 * s;
  const h = 0.05 * s;
  m.block(w, h, d, wall, x, 0, z, rot);
  m.gable(w * 1.18, h * 0.75, d * 1.08, roof, x, h, z, rot);
}

function tower(m: ModelBuilder, x: number, z: number, h: number, color: string, roof: string): void {
  m.block(0.07, h, 0.07, color, x, 0, z);
  m.block(0.075, 0.012, 0.075, PALETTE.window, x, h * 0.6, z);
  m.cone(0.06, 0.05, roof, x, h, z, 4);
}

function tree(m: ModelBuilder, x: number, z: number, s: number, dark: boolean): void {
  m.cylinder(0.006, 0.008, 0.02 * s, PALETTE.wood, x, 0, z, 4);
  m.cone(0.03 * s, 0.07 * s, dark ? PALETTE.treeDark : PALETTE.tree, x, 0.02 * s, z, 5);
}

function warehouse(m: ModelBuilder, x: number, z: number, len: number, rot = 0): void {
  m.block(len, 0.06, 0.11, PALETTE.warehouse, x, 0.02, z, rot);
  m.gable(0.12, 0.035, len, PALETTE.warehouseRoof, x, 0.08, z, rot + Math.PI / 2);
}

function jibCrane(m: ModelBuilder, x: number, z: number): void {
  m.block(0.04, 0.018, 0.04, PALETTE.crane, x, 0.02, z);
  m.cylinder(0.008, 0.012, 0.16, PALETTE.crane, x, 0.035, z, 5);
  m.box(0.16, 0.012, 0.012, PALETTE.crane, x + 0.06, 0.19, z, -0.25);
}

function gantry(m: ModelBuilder, x: number, z: number): void {
  for (const dz of [-0.05, 0.05]) {
    m.block(0.014, 0.2, 0.014, PALETTE.crane, x - 0.03, 0.02, z + dz);
    m.block(0.014, 0.2, 0.014, PALETTE.crane, x + 0.03, 0.02, z + dz);
  }
  m.box(0.28, 0.02, 0.12, PALETTE.crane, x + 0.07, 0.22, z);
  m.block(0.05, 0.03, 0.05, PALETTE.white, x - 0.02, 0.22, z);
}

export interface TownLook {
  townId: string;
  /** 1 마을 · 2 소도시 */
  size: 1 | 2;
  countryColor: string;
}

/**
 * 로우폴리 내륙 도시. 지름 약 1, 위 +y. 부두 대신 가운데 광장과 시계탑,
 * 둘레에 집, 바깥에 밭과 나무. 큰 도시(2)는 높은 건물이 섞인다.
 */
export function buildTown(look: TownLook): THREE.BufferGeometry {
  const m = new ModelBuilder();
  const rnd = seeded(look.townId);
  const S = look.size;
  const roofs = [PALETTE.roof, look.countryColor, PALETTE.roof, '#9b7b5c'];
  const walls = [PALETTE.wall, PALETTE.wall2, PALETTE.white];

  // 둥근 땅바닥과 광장, 시계탑
  const ring: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    ring.push([Math.cos(a) * 0.46, Math.sin(a) * 0.46]);
  }
  m.prism(ring, -0.01, 0.02, PALETTE.ground);
  m.cylinder(0.11, 0.11, 0.006, PALETTE.plaza, 0, 0.0, 0, 8);
  tower(m, 0, 0, 0.16 + S * 0.03, PALETTE.white, look.countryColor);

  // 밭: 땅 가장자리에 색이 다른 얇은 판
  for (let k = 0; k < 3 + S; k++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.33 + rnd() * 0.06;
    m.block(0.13, 0.008, 0.09, PALETTE.fields[k % PALETTE.fields.length], Math.cos(a) * r, 0, Math.sin(a) * r, a);
  }

  const taken: [number, number, number][] = [[0, 0, 0.11]];
  const free = (x: number, z: number, r: number) => taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > r + tr);
  const houses = 6 + S * 6;
  let placed = 0;
  for (let tries = 0; tries < houses * 14 && placed < houses; tries++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.13 + rnd() * 0.17;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const big = S === 2 && r < 0.22 && rnd() < 0.35;
    const rr = big ? 0.05 : 0.045;
    if (!free(x, z, rr)) continue;
    taken.push([x, z, rr]);
    const i = placed++;
    // 집은 광장을 바라보게(대략)
    const face = Math.round((-a) / (Math.PI / 2)) * (Math.PI / 2) + (rnd() - 0.5) * 0.3;
    if (big) tower(m, x, z, 0.11 + rnd() * 0.08, walls[i % walls.length], roofs[(i + 1) % roofs.length]);
    else house(m, x, z, 0.8 + rnd() * 0.4, walls[i % walls.length], roofs[i % roofs.length], face);
  }
  for (let i = 0, tries = 0; i < 5 + S * 2 && tries < 80; tries++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.28 + rnd() * 0.15;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z, 0.025)) continue;
    taken.push([x, z, 0.025]);
    tree(m, x, z, 0.8 + rnd() * 0.5, i++ % 2 === 0);
  }
  return m.build();
}

export function buildPort(look: PortLook): THREE.BufferGeometry {
  const m = new ModelBuilder();
  const rnd = seeded(look.cityId);
  const L = look.level;
  const roofs = [PALETTE.roof, look.countryColor, PALETTE.roof, '#9b7b5c'];
  const walls = [PALETTE.wall, PALETTE.wall2, PALETTE.white];

  // 땅바닥(해안을 덮는 얇은 판)과 부두
  m.prism(
    [[-0.5, -0.36], [0.18, -0.4], [0.24, 0], [0.18, 0.4], [-0.5, 0.36], [-0.56, 0]],
    -0.01, 0.02, PALETTE.concrete,
  );
  if (L === 1) {
    m.block(0.32, 0.012, 0.06, PALETTE.wood, 0.36, 0.008, 0.05);
    for (let i = 0; i < 4; i++) m.cylinder(0.006, 0.006, 0.04, PALETTE.wood, 0.24 + i * 0.08, -0.02, 0.02, 4);
  } else {
    m.block(0.42, 0.024, 0.11, PALETTE.quay, 0.42, -0.004, -0.08);
    if (L === 3) m.block(0.42, 0.024, 0.11, PALETTE.quay, 0.42, -0.004, 0.16);
  }

  // 창고
  warehouse(m, 0.05, -0.2, 0.2);
  if (L >= 2) warehouse(m, 0.05, 0.2, 0.22);
  if (L === 3) warehouse(m, -0.12, -0.24, 0.16);

  // 크레인·컨테이너
  if (L === 2) jibCrane(m, 0.4, -0.08);
  if (L === 3) {
    gantry(m, 0.38, -0.08);
    gantry(m, 0.38, 0.16);
    const C = PALETTE.containers;
    let k = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) for (let t = 0; t < 1 + ((i + j) % 2); t++) {
      m.block(0.06, 0.025, 0.028, C[k++ % C.length], -0.06 + i * 0.065, 0.02 + t * 0.026, 0.02 + j * 0.032);
    }
  }
  if (L === 1) tower(m, 0.2, 0.25, 0.16, PALETTE.lighthouse, PALETTE.roof);

  // 마을: 항구가 클수록 집이 많고, 큰 항구는 높은 건물이 섞인다. 서로·창고와 겹치지 않게 자리를 고른다
  const taken: [number, number, number][] = [
    [0.05, -0.2, 0.13], [0.05, 0.2, L >= 2 ? 0.13 : 0], [-0.12, -0.24, L === 3 ? 0.1 : 0], [0.02, 0.06, L === 3 ? 0.14 : 0],
  ];
  const free = (x: number, z: number, r: number) => taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > r + tr);
  const houses = 5 + L * 5;
  let placed = 0;
  for (let tries = 0; tries < houses * 12 && placed < houses; tries++) {
    const x = -0.48 + rnd() * 0.42;
    const z = -0.32 + rnd() * 0.64;
    const big = L === 3 && rnd() < 0.3;
    const r = big ? 0.05 : 0.045;
    if (!free(x, z, r)) continue;
    taken.push([x, z, r]);
    const i = placed++;
    if (big) tower(m, x, z, 0.12 + rnd() * 0.1, walls[i % walls.length], roofs[(i + 1) % roofs.length]);
    else house(m, x, z, 0.8 + rnd() * 0.4, walls[i % walls.length], roofs[i % roofs.length], Math.round(rnd() * 3) * (Math.PI / 2) + (rnd() - 0.5) * 0.3);
  }
  for (let i = 0, tries = 0; i < 4 + L && tries < 60; tries++) {
    const x = -0.5 + rnd() * 0.2;
    const z = -0.34 + rnd() * 0.68;
    if (!free(x, z, 0.025)) continue;
    taken.push([x, z, 0.025]);
    tree(m, x, z, 0.8 + rnd() * 0.5, i++ % 2 === 0);
  }
  return m.build();
}
