import { beforeAll, describe, expect, it } from 'vitest';
import { applySettings, DEFAULT_SETTINGS } from '../src/sim/classroom/settings';
import { scenariosFor, validateScenario } from '../src/sim/classroom/scenarios';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { applyCommand, PLAYER_ID } from '../src/sim/economy/player';
import { createEconomy } from '../src/sim/economy/setup';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import { economyDataFor } from '../src/sim/modes';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import { packWorld, unpackWorld, type WorldMeta } from '../src/sim/world/serialize';
import type { World } from '../src/sim/world/types';
import { makeSaveFile, readSaveFile, worldRef } from '../src/ui/save';

let world: World;
beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
});

describe('E0: 공통 규칙과 가상 세계 초기값 분리', () => {
  it('가상 세계 경제 데이터는 공통 규칙 + 가상 프로필로 만들고, 예전 기본값과 같다', () => {
    const d = economyDataFor('virtual');
    expect(d.profile).toEqual({ id: 'virtual', mode: 'virtual', version: '1' });
    expect(JSON.stringify(d)).toBe(JSON.stringify(DEFAULT_ECONOMY));
    expect(d.player.startCityId).toBe('portabel');
    expect(d.npc.companies.map((c) => c.homeCityId)).toEqual(['granbel', 'orpa', 'portabel']);
  });

  it('가상 세계 자료에는 모드·세계 id·자료 버전·작물 목록·지도 단위가 들어 있다', () => {
    expect(world.mode).toBe('virtual');
    expect(world.worldId).toBe('virtual');
    expect(world.dataVersion).toBeTruthy();
    expect(world.catalog.crops.map((c) => c.id)).toEqual(world.config!.crops.map((c) => c.id));
    expect(world.mapUnits.map((u) => u.countryId)).toEqual(world.countries.map((c) => c.id));
    expect(world.chokepoints.every((g) => g.kind === 'zone')).toBe(true);
  });

  it('가상 세계 시나리오는 가상 세계의 도시·나라·상품만 가리킨다', () => {
    const cities = world.cities.map((c) => c.id);
    const countries = world.countries.map((c) => c.id);
    const goods = DEFAULT_ECONOMY.goods.map((g) => g.id);
    for (const sc of scenariosFor('virtual')) expect(validateScenario(sc, cities, countries, goods)).toEqual([]);
  });
});

describe('E0: 세계 자료 직렬화', () => {
  it('16비트 지도 단위 레이어는 256 이상의 값을 잃지 않는다', () => {
    const n = world.grid.width * world.grid.height;
    const wide = new Uint16Array(n);
    wide[123] = 300;
    wide[456] = 65000;
    const w2: World = { ...world, layers: { ...world.layers, countryId: wide } };
    const { meta, binary } = packWorld(w2);
    expect(meta.layers.find((e) => e.name === 'countryId')?.type).toBe('Uint16');
    const back = unpackWorld(JSON.parse(JSON.stringify(meta)) as WorldMeta, binary.slice().buffer);
    expect(back.layers.countryId).toBeInstanceOf(Uint16Array);
    expect(back.layers.countryId[123]).toBe(300);
    expect(back.layers.countryId[456]).toBe(65000);
  });

  it('모드 없는 예전 world.json(버전 1)은 가상 세계로 읽는다', () => {
    const { meta, binary } = packWorld(world);
    const legacy = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
    for (const k of ['mode', 'worldId', 'dataVersion', 'catalog', 'layerAvailability', 'mapUnits', 'inlandLinks']) delete legacy[k];
    legacy.version = 1;
    legacy.chokepoints = (legacy.chokepoints as Record<string, unknown>[]).map(({ kind: _k, type: _t, ...g }) => g);
    const back = unpackWorld(legacy as unknown as WorldMeta, binary.slice().buffer);
    expect(back.mode).toBe('virtual');
    expect(back.catalog.resources.map((r) => r.id)).toEqual(world.config!.resources.map((r) => r.id));
    expect(back.mapUnits).toHaveLength(world.countries.length);
    expect(back.chokepoints.every((g) => g.kind === 'zone')).toBe(true);
    expect(back.layers.elevation[1000]).toBe(world.layers.elevation[1000]);
  });

  it('잘린 이진 파일은 조용히 넘기지 않는다', () => {
    const { meta, binary } = packWorld(world);
    expect(() => unpackWorld(meta, binary.slice(0, 1000).buffer)).toThrow();
  });
});

describe('E0: 예전 가상 세계 저장 호환(§17 이전 저장 호환)', () => {
  it('근거지에서 시작하고, 첫 배가 떠난 뒤 저장을 불러와 새 배를 사도 근거지에서 받는다', () => {
    const settings = { ...DEFAULT_SETTINGS, companyName: '  해오름 해운  ', companyLogo: 'beacon', startCityId: 'granbel', startingCash: 200000 };
    const { ctx, state } = createGame(world, DEFAULT_ECONOMY, settings.seed, settings);
    expect(state.player.name).toBe('해오름 해운');
    expect(state.ships.find((s) => s.id === 'p1')?.to).toBe('granbel');
    expect(applyCommand(ctx, state, { type: 'sail', shipId: 'p1', to: 'portabel' }).ok).toBe(true);
    const snapshot = makeSaveFile({ label: state.player.name, world: worldRef(world, ctx.data), settings, state });
    const file = readSaveFile(JSON.parse(JSON.stringify(snapshot)))!;
    const loaded = createEconomy(world, applySettings(DEFAULT_ECONOMY, file.settings), settings.seed);
    expect(file.settings.companyLogo).toBe('beacon');
    expect(applyCommand(loaded.ctx, file.state, { type: 'buyShip', typeId: 'small' }).ok).toBe(true);
    expect(file.state.ships.find((s) => s.id === 'p2')).toMatchObject({ from: 'granbel', to: 'granbel', holding: true });
  });

  it('버전 1 저장의 선박·화물·시장·항로가 그대로 복구되고 이어서 진행된다', () => {
    const settings = { ...DEFAULT_SETTINGS };
    delete (settings as { mode?: string }).mode; // 예전 설정에는 모드가 없다
    const g = createGame(world, DEFAULT_ECONOMY, settings.seed, settings);
    let state = g.state;
    const ship = state.ships.find((s) => s.companyId === PLAYER_ID)!;
    // 화물을 싣고, 정기 항로를 만들어 둔다
    const buy = applyCommand(g.ctx, state, { type: 'trade', shipId: ship.id, goodId: 'textiles', side: 'buy', quantity: 5 });
    expect(buy.ok).toBe(true);
    applyCommand(g.ctx, state, {
      type: 'saveRoute',
      route: { name: '시험 항로', stops: [{ cityId: 'portabel', buy: [], sell: [] }, { cityId: 'orpa', buy: [], sell: [] }], minMargin: 0.1, cashReserve: 0 },
    });
    for (let m = 0; m < 3; m++) state = stepMonth(g.ctx, state).state;
    const v1 = JSON.parse(JSON.stringify({ version: 1, savedAt: '2026-01-01T00:00:00Z', label: '예전 저장', settings, state }));
    const file = readSaveFile(v1)!;
    expect(file.world.mode).toBe('virtual');
    const { ctx } = createEconomy(world, applySettings(economyDataFor(file.world.mode), file.settings), file.settings.seed);
    expect(file.state.ships).toEqual(state.ships);
    expect(file.state.player.routes).toEqual(state.player.routes);
    expect(file.state.cities.portabel.stock).toEqual(state.cities.portabel.stock);
    const cargo = file.state.ships.find((s) => s.id === ship.id)!.cargo;
    expect(cargo.reduce((s, l) => s + l.quantity, 0)).toBeGreaterThan(4.9);
    // 같은 상태에서 같은 결과로 이어진다
    const a = stepMonth(ctx, file.state).state;
    const b = stepMonth(g.ctx, state).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
