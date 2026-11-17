import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 로우폴리 조립 도구.
 * 모델은 "코드로 된 작은 프로그램"이다: 상자·쐐기·원기둥 같은 부품을 색과 함께 놓고,
 * 마지막에 한 덩어리(정점 색이 든 BufferGeometry 하나)로 굽는다.
 * 면마다 법선이 따로라 평평한 면(flat shading)으로 보이고, 모델 하나가 그리기 호출 하나다.
 */

/** 모든 모델이 함께 쓰는 팔레트(한 세계처럼 보이도록) */
export const PALETTE = {
  hullRed: '#b8564a',
  hullNavy: '#3d5a80',
  hullTeal: '#4f8a8b',
  hullWhite: '#e9e4d8',
  hullDark: '#43414a',
  antifoul: '#7a3b36',
  deck: '#a39882',
  white: '#f1ede4',
  window: '#2e3a4d',
  steel: '#8b8f96',
  crane: '#e2b34a',
  hatchGreen: '#6f8f5a',
  hatchBlue: '#5f7fa3',
  concrete: '#b9b4a8',
  quay: '#9d978b',
  wood: '#8a6a4a',
  warehouse: '#cdbfa3',
  warehouseRoof: '#8e6f55',
  wall: '#e6dcc8',
  wall2: '#d7c7a7',
  roof: '#b4624a',
  tree: '#5f8d4e',
  treeDark: '#4a7341',
  lighthouse: '#e8e2d4',
  ground: '#c2b89c',
  plaza: '#d8cfba',
  fields: ['#c9b45a', '#9fb860', '#b99b5f', '#86a656'],
  containers: ['#d9824b', '#4f8a8b', '#c45b54', '#e2b34a', '#5f7fa3', '#8a9a5b'],
} as const;

export class ModelBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** geo를 matrix로 옮겨 color로 칠해 넣는다 */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    if (matrix) g.applyMatrix4(matrix);
    g.computeVertexNormals(); // 정점을 나누지 않았으므로 면마다 평평한 법선
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    geo.dispose();
    return this;
  }

  /** 가운데가 (x, y, z)인 상자. y는 바닥이 아니라 가운데 */
  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rotY = 0): this {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    return this.add(new THREE.BoxGeometry(w, h, d), color, m);
  }

  /** 바닥이 y인 상자 */
  block(w: number, h: number, d: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rotY = 0): this {
    return this.box(w, h, d, color, x, y + h / 2, z, rotY);
  }

  /** 박공지붕: 너비 w(x), 깊이 d(z), 높이 h, 처마 높이 y */
  gable(w: number, h: number, d: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, rotY = 0): this {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    return this.add(g, color, m);
  }

  /** 각진 원기둥(면 수가 적을수록 로우폴리) */
  cylinder(rTop: number, rBottom: number, h: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, seg = 6): this {
    const m = new THREE.Matrix4().makeTranslation(x, y + h / 2, z);
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1), color, m);
  }

  cone(r: number, h: number, color: THREE.ColorRepresentation, x: number, y: number, z: number, seg = 5): this {
    const m = new THREE.Matrix4().makeTranslation(x, y + h / 2, z);
    return this.add(new THREE.ConeGeometry(r, h, seg, 1), color, m);
  }

  /** 평면 다각형(xz 평면, 반시계)을 y0에서 y1까지 올린 기둥 */
  prism(points: [number, number][], y0: number, y1: number, color: THREE.ColorRepresentation): this {
    const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return this.add(g, color);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!g) throw new Error('빈 모델');
    g.computeBoundingSphere();
    return g;
  }
}

/** 모든 로우폴리 모델이 함께 쓰는 재질(정점 색, 평평한 면) */
let shared: THREE.MeshStandardMaterial | null = null;
export function lowpolyMaterial(): THREE.MeshStandardMaterial {
  shared ??= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  return shared;
}

/** 시드 문자열로 정해지는 작은 난수(같은 도시는 늘 같은 모양) */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
