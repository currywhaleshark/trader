export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 사다리꼴 적합도: a 이하 0, b~c 1, d 이상 0 */
export function trapezoid(x: number, r: readonly [number, number, number, number]): number {
  const [a, b, c, d] = r;
  if (x < a || x > d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return d > c ? (d - x) / (d - c) : 0;
}

/** 부드러운 최댓값 (다항식). k가 클수록 이음매가 둥글다. */
export function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
