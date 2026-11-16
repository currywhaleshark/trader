/** 문자열 -> uint32 해시 (xmur3 변형). 시드 문자열과 fork 라벨에 쓴다. */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 결정적 난수 생성기 (mulberry32).
 * fork(label)은 "처음 시드 + 라벨"에서 독립 스트림을 만든다. 소비 순서와 무관하므로
 * 생성 단계를 추가·수정해도 다른 단계의 난수열이 달라지지 않는다.
 */
export class SeededRNG {
  private readonly origin: string;
  private s: number;

  constructor(seed: string | number) {
    this.origin = String(seed);
    this.s = hashString(this.origin);
  }

  nextUint32(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, 1) */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** [min, max] 정수 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  fork(label: string): SeededRNG {
    return new SeededRNG(`${this.origin}/${label}`);
  }

  /** 저장/이어하기용 상태 */
  getState(): { origin: string; s: number } {
    return { origin: this.origin, s: this.s };
  }

  static fromState(state: { origin: string; s: number }): SeededRNG {
    const r = new SeededRNG(state.origin);
    r.s = state.s | 0;
    return r;
  }
}
