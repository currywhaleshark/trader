import type { SeededRNG } from './rng';

/** 시드 기반 3D 그래디언트 노이즈(개선 펄린). 단위 구 위 좌표로 샘플링하면 경도 경계에서 이음매가 없다. */
export class Noise3D {
  private readonly p = new Uint8Array(512);

  constructor(rng: SeededRNG) {
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  /** 대략 [-1, 1] */
  noise(x: number, y: number, z: number): number {
    const p = this.p;
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const zf = Math.floor(z);
    const X = xf & 255;
    const Y = yf & 255;
    const Z = zf & 255;
    x -= xf;
    y -= yf;
    z -= zf;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return mix(
      mix(
        mix(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        mix(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      mix(
        mix(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        mix(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }

  /** 프랙탈 합. 대략 [-1, 1] */
  fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x, y, z);
      norm += amp;
      amp *= gain;
      x = x * lacunarity + 17.3;
      y = y * lacunarity + 5.1;
      z = z * lacunarity + 9.7;
    }
    return sum / norm;
  }

  /** 능선형 노이즈. [0, 1] */
  ridged(x: number, y: number, z: number, octaves: number): number {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const r = 1 - Math.abs(this.noise(x, y, z));
      sum += amp * r * r;
      norm += amp;
      amp *= 0.5;
      x = x * 2 + 3.7;
      y = y * 2 + 11.9;
      z = z * 2 + 1.3;
    }
    return sum / norm;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mix(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
