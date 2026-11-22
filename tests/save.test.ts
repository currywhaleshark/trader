import { describe, expect, it } from 'vitest';
import { checkSaveCompat, makeSaveFile, readSaveFile, slotKey, worldRef, type SaveWorldRef } from '../src/ui/save';
import type { GameSettings } from '../src/sim/classroom/settings';
import type { EconomyState } from '../src/sim/economy/types';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import type { World } from '../src/sim/world/types';

const REF: SaveWorldRef = { mode: 'virtual', worldId: 'virtual', dataVersion: 'virtual-gen-1', profileId: 'virtual', profileVersion: '1' };

describe('저장 파일 내보내기', () => {
  it('누른 순간의 상태를 담고, 그 뒤 게임이 바뀌어도 파일 내용은 그대로다', () => {
    const state = { month: 7, player: { name: '우리 회사', cash: 1234 } } as unknown as EconomyState;
    const settings = { seed: 's' } as unknown as GameSettings;
    const file = makeSaveFile({ label: '우리 회사 · 2000년 8월', world: REF, settings, state });
    expect(file.version).toBe(2);
    expect(file.world.mode).toBe('virtual');
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

describe('저장 형식과 모드(§13.1)', () => {
  it('모드가 없는 예전(버전 1) 저장은 가상 세계 저장으로 읽는다', () => {
    const v1 = { version: 1, savedAt: '2026-01-01T00:00:00Z', label: 'x', settings: { seed: 'trade-world-1' }, state: { month: 3 } };
    const f = readSaveFile(v1)!;
    expect(f.version).toBe(2);
    expect(f.world.mode).toBe('virtual');
    expect(f.settings.mode).toBe('virtual');
    expect(f.state.month).toBe(3);
  });

  it('모양이 틀린 파일은 읽지 않는다', () => {
    expect(readSaveFile(null)).toBeNull();
    expect(readSaveFile({ version: 3, state: {}, settings: {} })).toBeNull();
    expect(readSaveFile({ version: 2, state: {}, settings: {} })).toBeNull();
  });

  it('가상 세계와 현실 지구는 저장 칸을 따로 쓰고, 가상 세계 칸 이름은 예전 그대로다', () => {
    expect(slotKey('virtual', 'auto')).toBe('trade-sim/save/auto');
    expect(slotKey('earth', 'auto')).not.toBe(slotKey('virtual', 'auto'));
    expect(slotKey('earth', 'slot1')).not.toBe(slotKey('virtual', 'slot1'));
  });

  const fakeWorld = (mode: 'virtual' | 'earth', ids: string[], dataVersion: string) =>
    ({ mode, worldId: mode, dataVersion, hash: 'h', cities: ids.map((id) => ({ id })) }) as unknown as World;
  const fakeFile = (mode: 'virtual' | 'earth', ids: string[], dataVersion: string) =>
    makeSaveFile({
      label: 'x',
      world: { ...REF, mode, worldId: mode, dataVersion },
      settings: { seed: 's' } as GameSettings,
      state: { cities: Object.fromEntries(ids.map((id) => [id, {}])), ships: [{ from: ids[0], to: ids[1] }], player: { routes: [] } } as unknown as EconomyState,
    });

  it('다른 모드의 저장은 불러오지 않는다', () => {
    const r = checkSaveCompat(fakeFile('earth', ['busan', 'shanghai'], 'e1'), fakeWorld('virtual', ['busan', 'shanghai'], 'e1'), DEFAULT_ECONOMY);
    expect(r.ok).toBe(false);
  });

  it('자료 버전이 다르고 없는 항구가 있으면 다른 항구에 이어 붙이지 않고 이유를 알린다', () => {
    const data = { ...DEFAULT_ECONOMY, profile: { id: 'earth', mode: 'earth' as const, version: '1' } };
    const r = checkSaveCompat(fakeFile('earth', ['busan', 'pusan_old'], 'e1'), fakeWorld('earth', ['busan', 'shanghai'], 'e2'), data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('pusan_old');
  });

  it('자료 버전만 다르고 항구가 모두 같으면 경고와 함께 불러온다', () => {
    const data = { ...DEFAULT_ECONOMY, profile: { id: 'earth', mode: 'earth' as const, version: '1' } };
    const r = checkSaveCompat(fakeFile('earth', ['busan', 'shanghai'], 'e1'), fakeWorld('earth', ['busan', 'shanghai'], 'e2'), data);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toBeTruthy();
  });

  it('저장의 세계 참조는 세계·경제 프로필을 함께 적는다', () => {
    const ref = worldRef(fakeWorld('virtual', ['a'], 'virtual-gen-1'), DEFAULT_ECONOMY);
    expect(ref).toMatchObject({ mode: 'virtual', worldId: 'virtual', profileId: 'virtual', profileVersion: DEFAULT_ECONOMY.profile.version });
  });

  it('연안항 추가 전 저장에는 새 시장이 없으므로 불완전한 상태로 이어 하지 않는다', () => {
    const r = checkSaveCompat(fakeFile('virtual', ['portabel', 'nandia'], 'virtual-gen-1'),
      fakeWorld('virtual', ['portabel', 'nandia', 'bellona', 'rivana'], 'virtual-gen-2'), DEFAULT_ECONOMY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('bellona');
  });
});
