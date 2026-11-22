import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { addStock } from '../src/sim/economy/origin';
import { applyCommand, playerBuyLimit, PLAYER_ID, quoteCargoSale } from '../src/sim/economy/player';
import { restoreEconomy } from '../src/sim/economy/setup';
import { createGame } from '../src/sim/economy/start';
import { citySpecialties, quoteSpecialtyBuy, specialties, specialtyAvailable, specialtySupply, SPECIALTY_RULES, tickSpecialties } from '../src/sim/economy/specialties';
import { totals } from '../src/sim/economy/step';
import { lotQuantity, moveLots } from '../src/sim/economy/warehouse';
import { cargoProducts, productCatalog } from '../src/sim/economy/products';
import { EARTH_SPECIALTIES, INDUSTRY_SPECIALTY_NAMES } from '../src/sim/earth/specialtyNames';
import { earthDefinitions } from '../src/sim/earth/definitions';
import { tradeRows } from '../src/ui/tradeModel';
import type { EconomyContext, EconomyState } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import type { World } from '../src/sim/world/types';
import { trustLevel } from '../src/sim/economy/trust';

let ctx: EconomyContext, initial: EconomyState, world: World;
beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
  ({ ctx, state: initial } = createGame(world, DEFAULT_ECONOMY, DEFAULT_SEED));
});

function fixture() {
  const state = structuredClone(initial);
  const source = ctx.portIds.find((id) => citySpecialties(ctx, state, id).length)!;
  const def = citySpecialties(ctx, state, source)[0];
  const dest = ctx.portIds.find((id) => ctx.countryOfCity[id] !== def.countryId)!;
  const ship = state.ships.find((s) => s.companyId === PLAYER_ID)!;
  ship.to = ship.from = source;
  ship.cargo = [];
  ship.holding = true;
  state.player.cash = 1e6;
  state.specialtySupply = { [def.id]: { month: state.month, remaining: 3 } };
  const city = state.cities[source];
  city.stock[def.goodId] = 0;
  city.mix[def.goodId] = {};
  addStock(city, def.goodId, 1000 + city.reserve[def.goodId], def.countryId, def.countryId);
  city.price[def.goodId] = ctx.goodById[def.goodId].basePrice;
  state.cities[dest].target[def.goodId] = 500;
  const buy = (quantity: number, specialtyId: string | undefined = def.id) => applyCommand(ctx, state, { type: 'trade', shipId: ship.id, goodId: def.goodId, side: 'buy', quantity, specialtyId });
  return { state, ship, source, dest, def, buy };
}

describe('한정 특산품', () => {
  function mixedCargo() {
    const { state, ship, source } = fixture();
    const earth = { ...ctx, data: { ...ctx.data, profile: { ...ctx.data.profile, mode: 'earth' as const } }, countryNames: { ...ctx.countryNames, kor: '한국', twn: '대만' } };
    ship.cargo = [
      { specialtyId: undefined, quantity: 3 },
      { specialtyId: 'kor:electronics', quantity: 2 },
      { specialtyId: 'twn:electronics', quantity: 4 },
    ].map((p) => ({ goodId: 'electronics', originCityId: source, originCountryId: ctx.countryOfCity[source], brandCountryId: ctx.countryOfCity[source], unitCost: 100, ...p }));
    state.cities[source].target.electronics = 500;
    state.player.warehouse!.cityId = source;
    state.player.warehouse!.coldCapacity = 60;
    return { state, ship, earth };
  }

  it('일반 전자부품·메모리·파운드리를 별도 상품과 별도 수량으로 표시한다', () => {
    const { state, ship, earth } = mixedCargo();
    expect(cargoProducts(earth, ship.cargo).map((p) => p.name)).toEqual(['전자부품', '메모리 반도체', '파운드리 반도체']);
    const rows = tradeRows({ ctx: earth, state }, ship, null).filter((r) => r.goodId === 'electronics');
    expect(rows.map((r) => [r.name, r.have])).toEqual([['전자부품', 3], ['메모리 반도체', 2], ['파운드리 반도체', 4]]);
    expect(new Set(productCatalog(earth).map((p) => p.id)).size).toBe(productCatalog(earth).length);
  });

  it('선택한 상품만 견적·판매하고 다른 전자부품은 남긴다', () => {
    const { state, ship, earth } = mixedCargo();
    const before = totals(earth, state), cash = state.player.cash;
    const quote = quoteCargoSale(earth, state, ship, 'electronics', 99, 'twn:electronics');
    expect(quote.quantity).toBe(4);
    expect(applyCommand(earth, state, { type: 'trade', shipId: ship.id, goodId: 'electronics', specialtyId: 'twn:electronics', quantity: 99, side: 'sell' }).ok).toBe(true);
    expect(state.player.cash - cash).toBeCloseTo(quote.total, 7);
    expect(ship.cargo.map((l) => [l.specialtyId ?? null, l.quantity])).toEqual([[null, 3], ['kor:electronics', 2]]);
    expect(state.player.chronicle.at(-1)?.specialtyId).toBe('twn:electronics');
    expect(totals(earth, state).goods.electronics).toBeCloseTo(before.goods.electronics, 7);
    expect(totals(earth, state).money).toBeCloseTo(before.money, 5);
    expect(applyCommand(earth, state, { type: 'trade', shipId: ship.id, goodId: 'electronics', specialtyId: null, quantity: 99, side: 'sell' }).ok).toBe(true);
    expect(ship.cargo).toHaveLength(1);
    expect(ship.cargo[0]).toMatchObject({ specialtyId: 'kor:electronics', quantity: 2 });
    const saved = structuredClone(state);
    expect(applyCommand(earth, state, { type: 'trade', shipId: ship.id, goodId: 'electronics', specialtyId: null, quantity: 1, side: 'sell' }).ok).toBe(false);
    expect(state).toEqual(saved);
  });

  it('창고 보관·구역 이동·재선적·직접 판매도 상품을 구분한다', () => {
    const { state, ship, earth } = mixedCargo();
    const w = state.player.warehouse!;
    const transfer = (specialtyId: string | null, direction: 'store' | 'load') => applyCommand(earth, state, { type: 'warehouseTransfer', shipId: ship.id, goodId: 'electronics', specialtyId, quantity: 99, direction, storage: 'ambient' });
    expect(transfer('twn:electronics', 'store').ok).toBe(true);
    expect(w.cargo).toHaveLength(1);
    expect(w.cargo[0]).toMatchObject({ specialtyId: 'twn:electronics', quantity: 4 });
    expect(transfer(null, 'store').ok).toBe(true);
    expect(applyCommand(earth, state, { type: 'warehouseMove', goodId: 'electronics', specialtyId: 'twn:electronics', quantity: 99, to: 'cold' }).ok).toBe(true);
    expect(lotQuantity(w.cargo, 'electronics', null)).toBe(3);
    expect(lotQuantity(w.coldCargo, 'electronics', 'twn:electronics')).toBe(4);
    expect(transfer(null, 'load').ok).toBe(true);
    expect(lotQuantity(ship.cargo, 'electronics', null)).toBe(3);
    expect(lotQuantity(ship.cargo, 'electronics', 'kor:electronics')).toBe(2);
    expect(applyCommand(earth, state, { type: 'warehouseSell', goodId: 'electronics', specialtyId: null, quantity: 99, storage: 'cold' }).ok).toBe(false);
    expect(applyCommand(earth, state, { type: 'warehouseSell', goodId: 'electronics', specialtyId: 'twn:electronics', quantity: 1, storage: 'cold' }).ok).toBe(true);
    expect(lotQuantity(w.coldCargo, 'electronics', 'twn:electronics')).toBe(3);
  });

  it('현실 품목은 근거가 있는 이름을 쓰고 가상 산업도 구체적인 상품명을 가진다', () => {
    expect(earthDefinitions().countries.filter((c) => c.id !== 'dji').map((c) => c.id).sort()).toEqual(Object.keys(EARTH_SPECIALTIES).sort());
    for (const [country, item] of Object.entries(EARTH_SPECIALTIES)) {
      expect(ctx.goodById[item.goodId]).toBeDefined();
      expect(item.name).not.toContain('특선');
      if (!['kor', 'twn', 'jpn', 'are'].includes(country)) expect(item.source).toMatch(/^https:\/\//);
    }
    for (const g of ctx.goods) expect(INDUSTRY_SPECIALTY_NAMES[g.id]?.length).toBeGreaterThan(1);
    expect(specialties(ctx).every((s) => !s.name.includes('특선'))).toBe(true);
  });

  it('이름 조사 전 저장한 특산 재고도 숨기거나 다른 계열로 바꾸지 않는다', () => {
    const { state, ship, earth } = mixedCargo();
    const legacyCtx = { ...earth, countryNames: { ...earth.countryNames, bel: '벨기에' } };
    ship.cargo = [{ ...ship.cargo[0], goodId: 'fuel', specialtyId: 'bel:fuel', quantity: 2 }];
    const products = cargoProducts(legacyCtx, JSON.parse(JSON.stringify(ship.cargo)));
    expect(products).toEqual([{ id: 'bel:fuel', goodId: 'fuel', specialtyId: 'bel:fuel', name: '벨기에 정제연료' }]);
    expect(productCatalog(legacyCtx).some((p) => p.id === 'bel:fuel')).toBe(false);
    expect(tradeRows({ ctx: legacyCtx, state }, ship, null).find((p) => p.id === 'bel:fuel')).toMatchObject({ offered: false, buyable: 0, have: 2 });
  });

  it('현실 지구의 대표 품목과 가상 세계의 산업 배정을 기존 상품에 연결한다', () => {
    const earth = { ...ctx, data: { ...ctx.data, profile: { ...ctx.data.profile, mode: 'earth' as const } }, countryNames: { kor: '한국', twn: '대만', jpn: '일본', are: '아랍에미리트' } };
    expect(specialties(earth).map(({ countryId, goodId, name }) => [countryId, goodId, name])).toEqual([
      ['kor', 'electronics', '메모리 반도체'], ['twn', 'electronics', '파운드리 반도체'], ['jpn', 'automobiles', '하이브리드 자동차'], ['are', 'crude_oil', '두바이유'],
    ]);
    const before = structuredClone(initial);
    for (const def of specialties(ctx)) {
      expect(ctx.reputation.premiums[def.countryId][def.goodId]).toBeGreaterThan(0);
      expect(ctx.cityIds.some((id) => ctx.countryOfCity[id] === def.countryId && initial.cities[id].industries.some((i) => i.goodId === def.goodId))).toBe(true);
    }
    expect(new Set(specialties(ctx).map((s) => s.countryId)).size).toBe(specialties(ctx).length);
    expect(initial).toEqual(before);
  });

  it('일반 상품과 재고·시세를 공유하고 상품과 돈을 복제하지 않는다', () => {
    const { state, ship, source, def, buy } = fixture();
    const normal = structuredClone(state), before = totals(ctx, state);
    const expected = quoteSpecialtyBuy(ctx, state, source, def, 2);
    expect(buy(2).ok).toBe(true);
    expect(applyCommand(ctx, normal, { type: 'trade', shipId: ship.id, goodId: def.goodId, side: 'buy', quantity: 2 }).ok).toBe(true);
    expect(state.cities[source]).toEqual(normal.cities[source]);
    expect(state.player.cash).toBeCloseTo(normal.player.cash, 7);
    expect(ship.cargo[0].specialtyId).toBe(def.id);
    expect(ship.cargo[0].quantity).toBeCloseTo(expected.quantity, 8);
    expect(totals(ctx, state).money).toBeCloseTo(before.money, 5);
    expect(totals(ctx, state).goods[def.goodId]).toBeCloseTo(before.goods[def.goodId], 7);
    expect(specialtySupply(ctx, state, def).remaining).toBeCloseTo(1);
  });

  it('배를 늘리거나 같은 나라 항구를 옮겨도 한정 물량을 공유하고 반복 구매로 늘어나지 않는다', () => {
    const { state, ship, def, source, buy } = fixture();
    expect(buy(2).ok).toBe(true);
    const second: typeof ship = { ...structuredClone(ship), id: 'second', cargo: [] };
    const other = ctx.portIds.find((id) => id !== source && ctx.countryOfCity[id] === def.countryId);
    if (other) {
      second.to = second.from = other;
      state.cities[other].industries.push({ goodId: def.goodId, capacity: 100, initialCapacity: 100, weakYears: 0 });
      addStock(state.cities[other], def.goodId, 1000, def.countryId, def.countryId);
    }
    state.ships.push(second);
    expect(applyCommand(ctx, state, { type: 'trade', shipId: second.id, goodId: def.goodId, side: 'buy', quantity: 100, specialtyId: def.id }).ok).toBe(true);
    expect(second.cargo.reduce((q, l) => q + l.quantity, 0)).toBeCloseTo(1);
    const exhausted = structuredClone(state);
    expect(buy(100).ok).toBe(false);
    expect(state).toEqual(exhausted);
  });

  it('생산분만 매달 보충하고 누적 상한과 월 중 재호출을 지킨다', () => {
    const { state, def, buy } = fixture();
    buy(3);
    for (const id of ctx.cityIds) if (ctx.countryOfCity[id] === def.countryId) state.cities[id].last.produced[def.goodId] = 1000;
    tickSpecialties(ctx, state);
    expect(specialtySupply(ctx, state, def).remaining).toBe(0);
    state.month++;
    tickSpecialties(ctx, state);
    const first = specialtySupply(ctx, state, def);
    expect(first.remaining).toBe(first.monthlyCap);
    for (let m = 0; m < 12; m++) { state.month++; tickSpecialties(ctx, state); }
    expect(specialtySupply(ctx, state, def).remaining).toBe(first.capacity);
    state.specialtySupply![def.id].remaining = 0;
    for (const id of ctx.cityIds) if (ctx.countryOfCity[id] === def.countryId) state.cities[id].last.produced[def.goodId] = 0;
    state.month++;
    tickSpecialties(ctx, state);
    expect(specialtySupply(ctx, state, def).remaining).toBe(0);
  });

  it('시세 폭락·관세에도 해외 순수령 최저가를 지키고 일반 수요에 판매한다', () => {
    const { state, ship, dest, def, buy } = fixture();
    buy(2);
    const cost = ship.cargo[0].unitCost * 2;
    ship.to = ship.from = dest;
    state.cities[dest].price[def.goodId] = ctx.goodById[def.goodId].basePrice * 0.01;
    state.policies = [];
    const taxed = { ...ctx, data: { ...ctx.data, policy: { ...ctx.data.policy, baseTariff: 0.6 } } };
    const quote = quoteCargoSale(taxed, state, ship, def.goodId, 2), cash = state.player.cash;
    expect(quote.parts[0].floorApplied).toBe(true);
    expect(quote.total).toBeCloseTo(cost * (1 + SPECIALTY_RULES.minimumMargin), 7);
    const before = totals(taxed, state), stock = state.cities[dest].stock[def.goodId];
    expect(applyCommand(taxed, state, { type: 'trade', shipId: ship.id, goodId: def.goodId, side: 'sell', quantity: 2 }).ok).toBe(true);
    expect(state.player.cash - cash).toBeCloseTo(quote.total, 7);
    expect(state.cities[dest].stock[def.goodId]).toBeCloseTo(stock + 2, 7);
    expect(totals(taxed, state).money).toBeCloseTo(before.money, 5);
    expect(totals(taxed, state).goods[def.goodId]).toBeCloseTo(before.goods[def.goodId], 7);
    expect(state.player.chronicle.at(-1)!.profit).toBeCloseTo(quote.total - cost, 7);
    // 해외에서 다시 산 상품은 일반품이며 수출 보증을 재발급하지 않는다.
    addStock(state.cities[dest], def.goodId, 1000, def.countryId, def.countryId);
    expect(applyCommand(taxed, state, { type: 'trade', shipId: ship.id, goodId: def.goodId, side: 'buy', quantity: 1 }).ok).toBe(true);
    expect(ship.cargo.every((l) => !l.specialtyId)).toBe(true);
    expect(specialtyAvailable(ctx, state, dest, def)).toBe(0);
  });

  it('국내에서는 웃돈·최저가가 없고 일반 화물과 섞어도 특산품 자격을 복제하지 않는다', () => {
    const { state, ship, source, def, buy } = fixture();
    expect(applyCommand(ctx, state, { type: 'trade', shipId: ship.id, goodId: def.goodId, side: 'buy', quantity: 1 }).ok).toBe(true);
    buy(2);
    expect(ship.cargo).toHaveLength(2);
    expect(ship.cargo[0].specialtyId).toBeUndefined();
    expect(ship.cargo[1].specialtyId).toBe(def.id);
    state.cities[source].price[def.goodId] *= 0.01;
    const quote = quoteCargoSale(ctx, state, ship, def.goodId, 3);
    expect(quote.parts.every((p) => !p.floorApplied && p.minimumNet === 0)).toBe(true);
    expect(quote.total).toBeLessThan(quote.cost);
  });

  it('최저가보다 높은 시세에서는 일반 가격 변동과 해외 웃돈을 함께 적용한다', () => {
    const { state, ship, dest, def, buy } = fixture();
    buy(2);
    ship.to = ship.from = dest;
    state.cities[dest].price[def.goodId] = ctx.goodById[def.goodId].basePrice * 8;
    const special = quoteCargoSale(ctx, state, ship, def.goodId, 2);
    const normal = quoteCargoSale(ctx, state, { ...ship, cargo: ship.cargo.map((l) => ({ ...l, specialtyId: undefined })) }, def.goodId, 2);
    expect(special.parts[0].floorApplied).toBe(false);
    expect(special.parts[0].grossUnit / normal.parts[0].grossUnit).toBeCloseTo(1 + SPECIALTY_RULES.foreignPremium, 8);
    state.cities[dest].price[def.goodId] *= 0.75;
    expect(quoteCargoSale(ctx, state, ship, def.goodId, 2).parts[0].grossUnit).toBeCloseTo(special.parts[0].grossUnit * 0.75, 7);
  });

  it('창고에서도 해외 최저가로 팔고 수출 보증은 팔린 수량만큼 소진한다', () => {
    const { state, ship, dest, def, buy } = fixture();
    buy(2);
    const warehouse = state.player.warehouse!;
    warehouse.cityId = dest;
    moveLots(ship.cargo, warehouse.cargo, def.goodId, 2);
    state.cities[dest].price[def.goodId] = 0.01;
    const quote = quoteCargoSale(ctx, state, { to: dest, cargo: warehouse.cargo }, def.goodId, 1), cash = state.player.cash;
    expect(applyCommand(ctx, state, { type: 'warehouseSell', goodId: def.goodId, quantity: 1, storage: 'ambient' }).ok).toBe(true);
    expect(state.player.cash - cash).toBeCloseTo(quote.total, 7);
    expect(warehouse.cargo[0]).toMatchObject({ quantity: 1, specialtyId: def.id });
    expect(state.player.chronicle.at(-1)?.storage).toBe('ambient');
  });

  it('외국산 국내 브랜드 재고를 특산품으로 둔갑시키지 않는다', () => {
    const { state, source, dest, def, buy } = fixture();
    const city = state.cities[source];
    city.stock[def.goodId] = 0;
    city.mix[def.goodId] = {};
    addStock(city, def.goodId, 1000 + city.reserve[def.goodId], ctx.countryOfCity[dest], def.countryId);
    const before = structuredClone(state);
    expect(specialtyAvailable(ctx, state, source, def)).toBe(0);
    expect(buy(2).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it('창고 이동·저장 복원 뒤에도 특산품 원가와 소진한 공급 한도를 유지한다', () => {
    const { state, ship, def, buy } = fixture();
    buy(2);
    const lot = structuredClone(ship.cargo[0]);
    moveLots(ship.cargo, state.player.warehouse!.cargo, def.goodId, 2);
    const saved: EconomyState = JSON.parse(JSON.stringify(state));
    const restored = restoreEconomy(world, DEFAULT_ECONOMY, DEFAULT_SEED, saved);
    expect(specialties(restored.ctx)).toEqual(specialties(ctx));
    expect(specialtySupply(restored.ctx, restored.state, def).remaining).toBeCloseTo(1);
    const restoredShip = restored.state.ships.find((s) => s.id === ship.id)!;
    moveLots(restored.state.player.warehouse!.cargo, restoredShip.cargo, def.goodId, 2);
    expect(restoredShip.cargo[0]).toEqual(lot);
  });

  it('잘못된 품목·브랜드·해외 공급 요청은 상태를 바꾸지 않는다', () => {
    for (const invalid of ['good', 'brand', 'foreign', 'id'] as const) {
      const { state, ship, dest, def } = fixture();
      if (invalid === 'foreign') ship.to = ship.from = dest;
      const before = structuredClone(state);
      const result = applyCommand(ctx, state, { type: 'trade', shipId: ship.id, goodId: invalid === 'good' ? ctx.goods.find((g) => g.id !== def.goodId)!.id : def.goodId, brandCountryId: invalid === 'brand' ? ctx.countryOfCity[dest] : undefined, specialtyId: invalid === 'id' ? 'missing' : def.id, side: 'buy', quantity: 1 });
      expect(result.ok, invalid).toBe(false);
      expect(state, invalid).toEqual(before);
    }
  });
});

describe('도시 신뢰도에 따른 특산품 물량', () => {
  const setTrust = (state: EconomyState, cityId: string, score: number) => {
    (state.player.cityTrust ??= {})[cityId] = { score, completed: 0, cancelled: 0, expired: 0 };
  };

  it.each([[0, 0], [19, 0], [20, 0.1], [49, 0.1], [50, 0.2], [79, 0.2], [80, 0.3], [100, 0.3]])(
    '신뢰도 %i점은 물량에 %f를 더하고 견적·매입 한도·상품 목록이 일치한다', (score, bonus) => {
      const { state, source, ship, def } = fixture();
      const capacity = specialtySupply(ctx, state, def).capacity;
      state.specialtySupply![def.id].remaining = capacity;
      const unitBefore = quoteSpecialtyBuy(ctx, state, source, def, 1).total;
      setTrust(state, source, score);
      const before = structuredClone(state), expected = capacity * (1 + bonus);
      expect(trustLevel(score).specialtyBonus).toBe(bonus);
      expect(specialtyAvailable(ctx, state, source, def)).toBeCloseTo(expected, 8);
      expect(quoteSpecialtyBuy(ctx, state, source, def, 100).quantity).toBeCloseTo(expected, 8);
      expect(playerBuyLimit(ctx, state, ship, def.goodId, undefined, def.id)).toBeCloseTo(expected, 8);
      expect(tradeRows({ ctx, state }, ship, null).find((row) => row.id === def.id)?.buyable).toBeCloseTo(expected, 8);
      expect(quoteSpecialtyBuy(ctx, state, source, def, 1).total).toBe(unitBefore);
      expect(state).toEqual(before); // 조회는 공급량을 보충하거나 신뢰도를 바꾸지 않는다.
    },
  );

  it('추가 구매량도 실제 재고에서 꺼내며 국가 배정과 돈·물량 보존을 지킨다', () => {
    const { state, source, ship, def, buy } = fixture();
    setTrust(state, source, 80);
    const expected = specialtyAvailable(ctx, state, source, def);
    const before = totals(ctx, state), stock = state.cities[source].stock[def.goodId];
    expect(buy(100).ok).toBe(true);
    expect(lotQuantity(ship.cargo, def.goodId, def.id)).toBeCloseTo(expected, 8);
    expect(state.cities[source].stock[def.goodId]).toBeCloseTo(stock - expected, 8);
    expect(specialtySupply(ctx, state, def).remaining).toBeCloseTo(0, 8);
    expect(totals(ctx, state).goods[def.goodId]).toBeCloseTo(before.goods[def.goodId], 7);
    expect(totals(ctx, state).money).toBeCloseTo(before.money, 5);
    const exhausted = structuredClone(state);
    expect(buy(1).ok).toBe(false);
    expect(state).toEqual(exhausted);
  });

  it('분할 구매·다른 배·항구 이동·등급 상승으로 공통 한도가 복제되지 않는다', () => {
    const { state, source, ship, def, buy } = fixture();
    setTrust(state, source, 80);
    expect(buy(1.3).ok).toBe(true); // 기본 배정 1개 사용, 2개 남음
    expect(specialtySupply(ctx, state, def).remaining).toBeCloseTo(2, 8);
    const other = ctx.portIds.find((id) => id !== source && ctx.countryOfCity[id] === def.countryId)!;
    state.cities[other].industries.push({ goodId: def.goodId, capacity: 100, initialCapacity: 100, weakYears: 0 });
    addStock(state.cities[other], def.goodId, 1000, def.countryId, def.countryId);
    const second = { ...structuredClone(ship), id: 'second', to: other, from: other, cargo: [] };
    state.ships.push(second);
    expect(specialtyAvailable(ctx, state, other, def)).toBeCloseTo(2, 8); // 이 도시 신뢰도는 아직 0
    expect(applyCommand(ctx, state, { type: 'trade', shipId: second.id, goodId: def.goodId, specialtyId: def.id, side: 'buy', quantity: 1 }).ok).toBe(true);
    setTrust(state, other, 80);
    expect(specialtyAvailable(ctx, state, other, def)).toBeCloseTo(1.3, 8);
    expect(applyCommand(ctx, state, { type: 'trade', shipId: second.id, goodId: def.goodId, specialtyId: def.id, side: 'buy', quantity: 100 }).ok).toBe(true);
    expect(lotQuantity(second.cargo, def.goodId, def.id)).toBeCloseTo(2.3, 8);
    expect(specialtyAvailable(ctx, state, source, def)).toBeCloseTo(0, 8);
    expect(buy(1).ok).toBe(false);
  });

  it('신뢰도 하락·저장 복원·월 갱신에도 사용한 배정량을 유지한다', () => {
    const { state, source, def, buy } = fixture();
    setTrust(state, source, 50);
    expect(buy(1.2).ok).toBe(true);
    const saved: EconomyState = JSON.parse(JSON.stringify(state));
    const { ctx: restoredCtx, state: restored } = restoreEconomy(world, DEFAULT_ECONOMY, DEFAULT_SEED, saved);
    expect(specialtySupply(restoredCtx, restored, def).remaining).toBeCloseTo(2, 8);
    expect(specialtyAvailable(restoredCtx, restored, source, def)).toBeCloseTo(2.4, 8);
    setTrust(restored, source, 19);
    expect(specialtyAvailable(restoredCtx, restored, source, def)).toBeCloseTo(2, 8);
    setTrust(restored, source, 80);
    expect(specialtyAvailable(restoredCtx, restored, source, def)).toBeCloseTo(2.6, 8);
    delete restored.player.cityTrust; // 예전 저장에는 도시 신뢰도 기록이 없어도 된다.
    expect(specialtyAvailable(restoredCtx, restored, source, def)).toBeCloseTo(2, 8);
    for (const id of ctx.cityIds) if (ctx.countryOfCity[id] === def.countryId) restored.cities[id].last.produced[def.goodId] = 1000;
    restored.month++;
    tickSpecialties(restoredCtx, restored);
    const supply = specialtySupply(restoredCtx, restored, def);
    expect(supply.remaining).toBe(Math.min(supply.capacity, 2 + supply.monthlyCap));
    setTrust(restored, source, 80);
    const before = structuredClone(restored.specialtySupply);
    tickSpecialties(restoredCtx, restored);
    expect(restored.specialtySupply).toEqual(before);
  });

  it('최고 신뢰도여도 주민 몫·국산 재고·생산과 공급이 없으면 더 살 수 없다', () => {
    for (const missing of ['reserve', 'domestic', 'supply', 'factory', 'foreign'] as const) {
      const { state, source, dest, def } = fixture();
      setTrust(state, source, 100);
      setTrust(state, dest, 100);
      const city = state.cities[source];
      if (missing === 'reserve') {
        city.stock[def.goodId] = city.reserve[def.goodId];
        city.mix[def.goodId] = { [`${def.countryId}/${def.countryId}`]: city.stock[def.goodId] };
      }
      if (missing === 'domestic') city.mix[def.goodId] = { [`${ctx.countryOfCity[dest]}/${def.countryId}`]: city.stock[def.goodId] };
      if (missing === 'supply') {
        state.specialtySupply![def.id].remaining = 0;
        for (const id of ctx.cityIds) if (ctx.countryOfCity[id] === def.countryId) state.cities[id].last.produced[def.goodId] = 0;
        state.month++;
        tickSpecialties(ctx, state);
      }
      if (missing === 'factory') city.industries = city.industries.filter((i) => i.goodId !== def.goodId);
      expect(specialtyAvailable(ctx, state, missing === 'foreign' ? dest : source, def), missing).toBe(0);
    }
  });
});
