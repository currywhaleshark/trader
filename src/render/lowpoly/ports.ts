import type * as THREE from 'three';
import { ModelBuilder, PALETTE, seeded } from './kit';

/**
 * 로우폴리 항구 도시. 지름 약 1, 위 +y, 바다는 +x 쪽(부두가 바다로 뻗는다). 원점은 물가.
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
  /** 1 마을 · 2 소도시 · 3 대도시 */
  size: 1 | 2 | 3;
  countryColor: string;
  /** 강가 도시: 강이 +x 방향으로 가운데를 지난다(강 자리를 비우고 다리를 놓는다) */
  river: boolean;
}

/**
 * 로우폴리 내륙 도시. 길이 약 1, 위 +y, 큰길(강가 도시는 강)이 x축을 따른다.
 * 바닥 판 없이 집을 땅에 바로 놓는다. 길을 따라 집이 줄지어 서고, 가운데서 멀수록 듬성해져
 * 도시마다 길쭉하거나 뭉툭한 제 모양이 된다. 바깥에는 밭과 나무. 소도시(2)는 높은 건물이 섞이고, 대도시(3)는 줄이 더 많고 가운데에 고층 건물이 모인다.
 */
export function buildTown(look: TownLook): THREE.BufferGeometry {
  const m = new ModelBuilder();
  const rnd = seeded(look.townId);
  const S = look.size;
  const roofs = [PALETTE.roof, look.countryColor, PALETTE.roof, '#9b7b5c'];
  const walls = [PALETTE.wall, PALETTE.wall2, PALETTE.white];

  // 도시마다 다른 생김새: 길이, 양쪽 줄 수
  const half = 0.2 + rnd() * 0.16 + S * 0.05;
  const rows = [1 + (rnd() < 0.5 ? 1 : 0) + (S - 1), 1 + (rnd() < 0.5 ? 1 : 0) + (S - 1)];
  const firstRow = look.river ? 0.105 : 0.07;
  const rowGap = 0.088;

  // 광장과 시계탑: 강가 도시는 한쪽 강둑에, 아니면 큰길 한가운데 곁에
  const plazaSide = rnd() < 0.5 ? 1 : -1;
  const plazaX = (rnd() - 0.5) * 0.1;
  const plazaZ = plazaSide * (firstRow + 0.02);
  m.cylinder(0.075, 0.075, 0.006, PALETTE.plaza, plazaX, 0, plazaZ, 8);
  tower(m, plazaX, plazaZ, 0.16 + S * 0.03, PALETTE.white, look.countryColor);
  if (look.river) {
    // 다리
    m.block(0.045, 0.01, firstRow * 2 - 0.03, PALETTE.concrete, plazaX + 0.12, 0.006, 0);
  } else {
    // 큰길
    m.block(half * 2 + 0.08, 0.004, 0.028, PALETTE.plaza, 0, 0, 0);
  }

  const taken: [number, number, number][] = [[plazaX, plazaZ, 0.085]];
  const free = (x: number, z: number, r: number) => taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) > r + tr);
  let i = 0;
  for (const side of [1, -1]) {
    const n = rows[side === 1 ? 0 : 1];
    for (let r = 0; r < n; r++) {
      const z = side * (firstRow + r * rowGap);
      // 바깥 줄일수록 짧다
      const len = half * (1 - r * 0.28);
      for (let x = -len; x <= len; x += 0.086) {
        const edge = Math.abs(x) / half;
        if (rnd() > 1.05 - 0.7 * edge * edge - r * 0.12) continue;
        const hx = x + (rnd() - 0.5) * 0.02;
        const hz = z + (rnd() - 0.5) * 0.02;
        if (!free(hx, hz, 0.04)) continue;
        taken.push([hx, hz, 0.04]);
        const big = S === 3 ? edge < 0.65 && r <= 1 && rnd() < 0.65 - r * 0.2 : S === 2 && edge < 0.5 && r === 0 && rnd() < 0.4;
        // 대도시 한가운데는 고층
        const tall = S === 3 ? (1 - edge) * (0.1 + rnd() * 0.14) : 0;
        // 집은 길(강) 쪽을 바라본다
        const face = (side === 1 ? 0 : Math.PI) + (rnd() - 0.5) * 0.25;
        if (big) tower(m, hx, hz, 0.11 + rnd() * 0.08 + tall, walls[i % walls.length], roofs[(i + 1) % roofs.length]);
        else house(m, hx, hz, 0.8 + rnd() * 0.4, walls[i % walls.length], roofs[i % roofs.length], face);
        i++;
      }
    }
  }

  // 밭: 집들 바깥(양 끝과 뒤편)에 길과 나란히
  const back = (side: number) => side * (firstRow + rows[side === 1 ? 0 : 1] * rowGap + 0.03);
  for (let k = 0; k < 3 + S; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const w = 0.1 + rnd() * 0.08;
    const d = 0.06 + rnd() * 0.05;
    const x = (rnd() - 0.5) * 2 * half;
    const z = back(side) + side * (d / 2 + rnd() * 0.04);
    m.block(w, 0.006, d, PALETTE.fields[Math.floor(rnd() * PALETTE.fields.length)], x, 0, z, (rnd() - 0.5) * 0.2);
    taken.push([x, z, Math.max(w, d) / 2]);
  }
  for (let t = 0, tries = 0; t < 5 + S * 2 && tries < 80; tries++) {
    const x = (rnd() - 0.5) * 2 * (half + 0.08);
    const side = rnd() < 0.5 ? 1 : -1;
    const z = side * (firstRow + rnd() * (Math.abs(back(side)) - firstRow + 0.08));
    if (!free(x, z, 0.025)) continue;
    taken.push([x, z, 0.025]);
    tree(m, x, z, 0.8 + rnd() * 0.5, t++ % 2 === 0);
  }
  return m.build();
}

export function buildPort(look: PortLook): THREE.BufferGeometry {
  const m = new ModelBuilder();
  const rnd = seeded(look.cityId);
  const L = look.level;
  const roofs = [PALETTE.roof, look.countryColor, PALETTE.roof, '#9b7b5c'];
  const walls = [PALETTE.wall, PALETTE.wall2, PALETTE.white];

  // 부둣가(물가를 따라 놓인 좁은 콘크리트 바닥)와 부두. 마을 쪽에는 바닥 판을 깔지 않는다
  const apron = 0.24 + L * 0.05;
  m.prism([[-0.12, -apron], [0.21, -apron - 0.02], [0.21, apron + 0.02], [-0.12, apron]], -0.01, 0.02, PALETTE.concrete);
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
  // 도시마다 다른 생김새: 물가를 따라 길게 퍼지거나, 뭍 쪽으로 깊게 들어간다
  const depth = 0.3 + rnd() * 0.22;
  const spread = 0.26 + rnd() * 0.2;
  const lean = (rnd() - 0.5) * 0.25;
  let placed = 0;
  for (let tries = 0; tries < houses * 12 && placed < houses; tries++) {
    // 물가에 가까울수록 빽빽하고, 뭍 쪽으로 갈수록 좁아지며 듬성해진다
    const u = Math.pow(rnd(), 1.4);
    const x = -0.13 - u * depth;
    const z = (rnd() - 0.5) * 2 * spread * (1 - 0.55 * u) + lean * u;
    const big = L === 3 && rnd() < 0.3;
    const r = big ? 0.05 : 0.045;
    if (!free(x, z, r)) continue;
    taken.push([x, z, r]);
    const i = placed++;
    if (big) tower(m, x, z, 0.12 + rnd() * 0.1, walls[i % walls.length], roofs[(i + 1) % roofs.length]);
    else house(m, x, z, 0.8 + rnd() * 0.4, walls[i % walls.length], roofs[i % roofs.length], Math.round(rnd() * 3) * (Math.PI / 2) + (rnd() - 0.5) * 0.3);
  }
  for (let i = 0, tries = 0; i < 4 + L && tries < 60; tries++) {
    const x = -0.2 - rnd() * (depth + 0.05);
    const z = (rnd() - 0.5) * 2 * (spread + 0.06);
    if (!free(x, z, 0.025)) continue;
    taken.push([x, z, 0.025]);
    tree(m, x, z, 0.8 + rnd() * 0.5, i++ % 2 === 0);
  }
  // 원점을 물가(부둣가 끝)에 둔다: 모델 크기가 바뀌어도 부두는 바다에, 마을은 뭍에 남는다
  const g = m.build();
  g.translate(-0.2, 0, 0);
  g.computeBoundingSphere();
  return g;
}
