import { describe, expect, it } from 'vitest';
import { makeSaveFile } from '../src/ui/save';
import type { GameSettings } from '../src/sim/classroom/settings';
import type { EconomyState } from '../src/sim/economy/types';

describe('저장 파일 내보내기', () => {
  it('누른 순간의 상태를 담고, 그 뒤 게임이 바뀌어도 파일 내용은 그대로다', () => {
    const state = { month: 7, player: { name: '우리 회사', cash: 1234 } } as unknown as EconomyState;
    const settings = { seed: 's' } as unknown as GameSettings;
    const file = makeSaveFile({ label: '우리 회사 · 2000년 8월', settings, state });
    expect(file.version).toBe(1);
    expect(file.state.month).toBe(7);
    expect(file.state.player.cash).toBe(1234);
    expect(Number.isNaN(Date.parse(file.savedAt))).toBe(false);
    // 게임이 계속 진행돼도(같은 객체가 바뀌어도) 내보낸 내용은 바뀌지 않는다
    state.month = 8;
    state.player.cash = 0;
    expect(file.state.month).toBe(7);
    expect(file.state.player.cash).toBe(1234);
  });
});
