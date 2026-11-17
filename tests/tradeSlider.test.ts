import { describe, expect, it } from 'vitest';
import { tradeSlider } from '../src/ui/tradeModel';

describe('수량 막대', () => {
  it('상해서 소수로 남은 짐도 막대 끝 칸으로 전부 팔 수 있다', () => {
    const s = tradeSlider('sell', 0, 39.37);
    expect(s.max).toBe(40);
    expect(s.quantity(s.max)).toBeCloseTo(39.37, 9);
    expect(s.quantity(39)).toBe(39);
  });

  it('1개보다 적게 남은 찌꺼기(0.1개)도 팔 수 있다', () => {
    const s = tradeSlider('sell', 0, 0.0999);
    expect(s.max).toBe(1);
    expect(s.quantity(1)).toBeCloseTo(0.0999, 9);
  });

  it('살 때는 온전한 개수만 고른다', () => {
    const s = tradeSlider('buy', 26.8, 0);
    expect(s.max).toBe(26);
    expect(s.quantity(26)).toBe(26);
    expect(s.quantity(30)).toBe(26);
    expect(tradeSlider('buy', 0.6, 0).max).toBe(0);
  });
});
