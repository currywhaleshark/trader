import { labelComponents } from '../../core/gridSearch';
import { smoothMax, smoothstep } from '../../core/math';
import { Noise3D } from '../../core/noise';
import {
  DEG,
  capsuleDistance,
  cross,
  dot,
  latLonToVec3,
  makeCapsule,
  normalize,
  vec3ToLatLon,
  type Capsule,
  type LatLon,
  type Vec3,
} from '../../core/sphere';
import type { GateSpec } from '../config';
import type { GenContext } from './context';

/** 관문 선분(a-b)의 중점을 수직으로 가로지르는 수로 선분 */
export function gateChannel(gate: GateSpec): { from: LatLon; to: LatLon; mid: LatLon } {
  const a = latLonToVec3(gate.a[0], gate.a[1]);
  const b = latLonToVec3(gate.b[0], gate.b[1]);
  const m = normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const along = dot(ab, m);
  const t = normalize([ab[0] - m[0] * along, ab[1] - m[1] * along, ab[2] - m[2] * along]);
  const p = cross(m, t);
  const half = (gate.channelLengthDeg / 2) * DEG;
  const c = Math.cos(half);
  const s = Math.sin(half);
  const from = vec3ToLatLon([m[0] * c + p[0] * s, m[1] * c + p[1] * s, m[2] * c + p[2] * s]);
  const to = vec3ToLatLon([m[0] * c - p[0] * s, m[1] * c - p[1] * s, m[2] * c - p[2] * s]);
  return { from, to, mid: vec3ToLatLon(m) };
}

/**
 * 대륙 생성. 청사진 캡슐의 합집합(육지장)에 노이즈를 더해 해안선을 만들고,
 * 위도 한계·해협 수로를 강제한 뒤 작은 섬과 갇힌 바다를 정리한다.
 * 반환: continentId (0 = 바다)
 */
export function generateLandmass(ctx: GenContext): Uint8Array {
  const { cfg, grid, n, cellVec, rowLat } = ctx;
  const lm = cfg.landmass;
  const w = grid.width;
  const h = grid.height;
  const rng = ctx.rng.fork('landmass');
  const noise = new Noise3D(ctx.rng.fork('landmass-noise'));
  const jitter = (p: LatLon): LatLon => [
    p[0] + rng.range(-lm.jitterDeg, lm.jitterDeg),
    p[1] + rng.range(-lm.jitterDeg, lm.jitterDeg),
  ];

  const continents = cfg.continents.map((spec) => ({
    spec,
    caps: spec.capsules.map((c) => ({
      cap: makeCapsule(jitter(c.from), jitter(c.to)),
      r: c.radiusDeg * (1 + rng.range(-lm.radiusJitter, lm.radiusJitter)) * DEG,
    })),
    offset: [rng.range(0, 50), rng.range(0, 50), rng.range(0, 50)] as Vec3,
  }));
  const carves: { cap: Capsule; hw: number }[] = cfg.gates.map((g) => {
    const ch = gateChannel(g);
    return { cap: makeCapsule(ch.from, ch.to), hw: g.channelHalfWidthDeg * DEG };
  });

  const continentId = new Uint8Array(n);
  /** 부호와 무관하게 가장 가까운 대륙(갇힌 바다를 메울 때 사용) */
  const nearestContinent = new Uint8Array(n);
  let globalLatMax = -90;
  let globalLatMin = 90;
  for (const c of cfg.continents) {
    globalLatMax = Math.max(globalLatMax, c.latMax);
    globalLatMin = Math.min(globalLatMin, c.latMin);
  }

  for (let y = 0; y < h; y++) {
    const lat = rowLat[y];
    if (lat > globalLatMax + 1 || lat < globalLatMin - 1) continue;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const px = cellVec[i * 3];
      const py = cellVec[i * 3 + 1];
      const pz = cellVec[i * 3 + 2];
      let bestF = -Infinity;
      let bestId = 0;
      for (const c of continents) {
        let f = -10;
        let core = -10;
        for (const k of c.caps) {
          const d = capsuleDistance(k.cap, px, py, pz);
          if (d > k.r * 2.5) continue;
          f = smoothMax(f, 1 - d / k.r, lm.blend);
          core = Math.max(core, 1 - d / (k.r * lm.coreFraction));
        }
        if (f < 1 - lm.maxReach) continue;
        const ox = px + c.offset[0];
        const oy = py + c.offset[1];
        const oz = pz + c.offset[2];
        f += lm.noiseAmp * noise.fbm(ox * lm.noiseFreq, oy * lm.noiseFreq, oz * lm.noiseFreq, 3);
        f +=
          lm.detailAmp *
          noise.fbm(ox * lm.detailFreq, oy * lm.detailFreq, oz * lm.detailFreq, lm.noiseOctaves);
        if (core > f) f = core;
        f -= 3 * smoothstep(c.spec.latMax - 4, c.spec.latMax, lat);
        f -= 3 * (1 - smoothstep(c.spec.latMin, c.spec.latMin + 4, lat));
        if (f > bestF) {
          bestF = f;
          bestId = c.spec.id;
        }
      }
      for (const cv of carves) {
        const d = capsuleDistance(cv.cap, px, py, pz);
        if (d < cv.hw) bestF = Math.min(bestF, -0.2 - (1 - d / cv.hw));
      }
      nearestContinent[i] = bestId;
      if (bestF > 0) continentId[i] = bestId;
    }
  }

  // 작은 섬 제거
  const landMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) landMask[i] = continentId[i] ? 1 : 0;
  const land = labelComponents(grid, landMask, 8);
  for (let i = 0; i < n; i++) {
    if (land.labels[i] >= 0 && land.sizes[land.labels[i]] < lm.minIslandCells) continentId[i] = 0;
  }

  // 대양과 이어지지 않은 갇힌 바다는 육지로 메운다
  const seaMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) seaMask[i] = continentId[i] ? 0 : 1;
  const sea = labelComponents(grid, seaMask, 4);
  let ocean = 0;
  for (let k = 1; k < sea.sizes.length; k++) if (sea.sizes[k] > sea.sizes[ocean]) ocean = k;
  for (let i = 0; i < n; i++) {
    if (sea.labels[i] >= 0 && sea.labels[i] !== ocean) continentId[i] = nearestContinent[i] || 1;
  }
  return continentId;
}
