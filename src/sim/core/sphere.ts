/**
 * 구면 기하. 좌표 규약(전 프로젝트 공통):
 *   x = cos(lat)cos(lon), y = sin(lat), z = -cos(lat)sin(lon)
 * Three.js SphereGeometry의 기본 UV(등장방형 텍스처, 왼쪽 끝 = 경도 -180°)와 일치한다.
 */
export const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];
/** [위도, 경도] (도). 북위·동경이 양수. */
export type LatLon = [number, number];

export function latLonToVec3(lat: number, lon: number): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [c * Math.cos(lo), Math.sin(la), -c * Math.sin(lo)];
}

export function vec3ToLatLon(v: Vec3): LatLon {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[1] / len))) / DEG;
  const lon = Math.atan2(-v[2], v[0]) / DEG;
  return [lat, lon];
}

/** 경도를 [-180, 180)로 접는다. */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** 두 단위 벡터 사이 각(라디안). 작은 각에서도 안정적. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b));
}

/** 대권 각거리(라디안). 경도 ±180° 경계에서 연속이다. */
export function angularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG;
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 대권 위 보간 (t: 0~1) */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const ang = angleBetween(a, b);
  if (ang < 1e-9) return [a[0], a[1], a[2]];
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s;
  const wb = Math.sin(t * ang) / s;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}

/** 경유점 사이를 대권으로 잘게 나눈다. 렌더링·검증용. */
export function densifyPath(points: readonly LatLon[], stepDeg: number): LatLon[] {
  const out: LatLon[] = [];
  if (points.length === 0) return out;
  out.push([points[0][0], points[0][1]]);
  for (let i = 1; i < points.length; i++) {
    const a = latLonToVec3(points[i - 1][0], points[i - 1][1]);
    const b = latLonToVec3(points[i][0], points[i][1]);
    const ang = angleBetween(a, b) / DEG;
    const k = Math.max(1, Math.ceil(ang / stepDeg));
    for (let s = 1; s <= k; s++) out.push(vec3ToLatLon(slerp(a, b, s / k)));
  }
  return out;
}

/** 경유점 경로의 총 각거리(라디안) */
export function pathAngularLength(points: readonly LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += angularDistance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return sum;
}

/** 구면 "캡슐": 대권 선분(a→b)과의 각거리를 재기 위한 사전 계산 */
export interface Capsule {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  nx: number; ny: number; nz: number;
  arc: boolean;
}

export function makeCapsule(from: LatLon, to: LatLon): Capsule {
  const a = latLonToVec3(from[0], from[1]);
  const b = latLonToVec3(to[0], to[1]);
  const c = cross(a, b);
  const len = Math.hypot(c[0], c[1], c[2]);
  const arc = len > 1e-6;
  return {
    ax: a[0], ay: a[1], az: a[2],
    bx: b[0], by: b[1], bz: b[2],
    nx: arc ? c[0] / len : 0, ny: arc ? c[1] / len : 0, nz: arc ? c[2] / len : 0,
    arc,
  };
}

function acosSafe(v: number): number {
  return Math.acos(v > 1 ? 1 : v < -1 ? -1 : v);
}

/** 단위 벡터 p에서 선분까지의 각거리(라디안) */
export function capsuleDistance(c: Capsule, px: number, py: number, pz: number): number {
  const da = acosSafe(px * c.ax + py * c.ay + pz * c.az);
  if (!c.arc) return da;
  const dn = px * c.nx + py * c.ny + pz * c.nz;
  const qx = px - dn * c.nx;
  const qy = py - dn * c.ny;
  const qz = pz - dn * c.nz;
  const s1 = (c.ay * qz - c.az * qy) * c.nx + (c.az * qx - c.ax * qz) * c.ny + (c.ax * qy - c.ay * qx) * c.nz;
  const s2 = (qy * c.bz - qz * c.by) * c.nx + (qz * c.bx - qx * c.bz) * c.ny + (qx * c.by - qy * c.bx) * c.nz;
  if (s1 >= 0 && s2 >= 0) return Math.asin(Math.min(1, Math.abs(dn)));
  const db = acosSafe(px * c.bx + py * c.by + pz * c.bz);
  return da < db ? da : db;
}
