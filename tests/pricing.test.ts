import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRNG } from '../src/sim/core/rng';
import { actAtPort } from '../src/sim/economy/npc';
import { DEFAULT_SETTINGS } from '../src/sim/classroom/settings';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { arrivalMarket, executeBuy, forecastPrice, inventoryUnit, quoteBuy, updatePrices } from '../src/sim/economy/market';
import { addStock } from '../src/sim/economy/origin';
import { applyCommand, playerArrive, quoteCargoSale } from '../src/sim/economy/player';
import { brandPremium, expectedSaleFactor } from '../src/sim/economy/policy';
import { estimateTrade } from '../src/sim/economy/routePlan';
import { createEconomy, restoreEconomy } from '../src/sim/economy/setup';
import { operatingCost, stepMonth, unitCost } from '../src/sim/economy/step';
import type { EconomyContext, EconomyState, SimEvent } from '../src/sim/economy/types';
import { EARTH_PROFILE } from '../src/sim/earth/profile';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import type { World } from '../src/sim/world/types';
import { makeSaveFile, readSaveFile, worldRef } from '../src/ui/save';

let world: World, initial: EconomyState, ctx: EconomyContext;
beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
  const data = structuredClone(DEFAULT_ECONOMY);
  data.culture.sensitivity.electronics = 1;
  data.culture.premiumScale = 1;
  data.signatureIndustries = { astera: ['electronics'], orden: [] };
  ({ ctx, state: initial } = createEconomy(world, data, DEFAULT_SEED));
});

function market() {
  const state = structuredClone(initial);
  state.cultureWaves.push({
    id: 'wave', brand: 'astera', countries: ['karuna', 'orden'], strength: 0.1, startMonth: 0, endMonth: 2,
    title: '유행', causes: [], effects: [], ended: false,
  });
  state.player.cash = 1e6;
  const city = state.cities.portabel;
  const id = 'electronics';
  city.mix[id] = {};
  city.stock[id] = 0;
  city.reserve[id] = 0;
  city.price[id] = 100;
  city.target[id] = 100;
  addStock(city, id, 40, 'orden', 'astera');
  addStock(city, id, 20, 'karuna', 'astera');
  addStock(city, id, 40, 'orden', 'orden');
  return { state, city, id, ship: state.ships.find((s) => s.id === 'p1')! };
}

describe('브랜드별 가격과 장부', () => {
  it('100 + 평판 20% + 유행 10% = 130, 도착 전에 유행이 끝나면 120', () => {
    const { state, city, id } = market();
    expect(100 * (1 + brandPremium(ctx, state, city.countryId, id, 'astera'))).toBeCloseTo(130);
    expect(expectedSaleFactor(ctx, state, city.id, id, 'orpa', 2, 'astera')).toBeCloseTo(1.2);
    expect(expectedSaleFactor(ctx, state, city.id, id, 'orpa', 1, 'astera')).toBeCloseTo(1.3);
    expect(inventoryUnit(ctx, state, city, id)).toBeCloseTo(118);
    const recipe = ctx.goodById.automobiles.recipe!;
    expect(unitCost(ctx, city, 'automobiles', state)).toBeCloseTo(operatingCost(ctx, 'automobiles') + recipe.steel * inventoryUnit(ctx, state, city, 'steel') + recipe.electronics * 118);
    expect(city.price[id]).toBe(100);
    const q = quoteBuy(ctx, city, id, 20, state, 'astera');
    expect(estimateTrade(ctx, state, 'small', city.id, id, 20, 'orpa', 2, 0, undefined, 'astera').cost)
      .toBeCloseTo(q.total + 20 * ctx.goodById[id].volume * ctx.data.shipping.portFeePerUnit);
  });

  it.each([[undefined, 900], ['astera', 900], [undefined, 100], ['astera', 100]] as const)('브랜드 %s, 기본 시세 %i에서 구매·부분 재판매로 이익이 생기지 않는다', (brand, price) => {
    const { state, city, id, ship } = market();
    city.price[id] = price;
    const cash = state.player.cash;
    const before = structuredClone(city.mix[id]);
    const buy = quoteBuy(ctx, city, id, 30, state, brand);
    expect(applyCommand(ctx, state, { type: 'trade', side: 'buy', goodId: id, shipId: ship.id, quantity: 30, brandCountryId: brand }).ok).toBe(true);
    expect(ship.cargo.map((p) => p.originCountryId)).toContain('karuna');
    if (brand) expect(city.mix[id]['orden/orden']).toBe(before['orden/orden']);
    const fee = ctx.goodById[id].volume * ctx.data.shipping.portFeePerUnit;
    expect(cash - state.player.cash).toBeCloseTo(buy.total + fee * buy.quantity);
    for (const p of buy.parts) {
      const lot = ship.cargo.find((l) => l.originCountryId === p.origin && l.brandCountryId === p.brand)!;
      expect(lot.unitCost).toBeCloseTo(p.unitPrice + fee);
      expect(lot.quantity).toBeCloseTo(p.quantity);
    }
    for (const quantity of [7, 23]) {
      const sale = quoteCargoSale(ctx, state, ship, id, quantity);
      const cashBeforeSale = state.player.cash;
      expect(applyCommand(ctx, state, { type: 'trade', side: 'sell', shipId: ship.id, goodId: id, quantity }).ok).toBe(true);
      expect(state.player.cash - cashBeforeSale).toBeCloseTo(sale.total);
    }
    expect(state.player.cash).toBeLessThan(cash);
    for (const [key, amount] of Object.entries(before)) expect(city.mix[id][key]).toBeCloseTo(amount);
    expect(ship.cargo).toHaveLength(0);
    expect(executeBuy(ctx, city, id, 20, state, '없는 상표').quantity).toBe(0);
  });
});

it('같은 재고 충격의 첫달과 예측이 일치하고 제조 원가 충격은 늦게라도 시세에 반영된다', () => {
  const { city } = market();
  const ids = ['grain', 'electronics', 'clothing'];
  for (const id of ids) {
    city.price[id] = ctx.goodById[id].basePrice;
    city.stock[id] = city.target[id] / 2;
  }
  const forecast = ids.map((id) => forecastPrice(ctx, city, id, 0, 1));
  for (const [i, id] of ids.entries()) expect(arrivalMarket(ctx, city, id, 0, 1).price).toBeCloseTo(forecast[i]);
  updatePrices(ctx, city);
  const ratios = ids.map((id, i) => {
    expect(city.price[id]).toBeCloseTo(forecast[i]);
    return city.price[id] / ctx.goodById[id].basePrice;
  });
  expect(ratios[0]).toBeGreaterThan(ratios[1]);
  expect(ratios[1]).toBeGreaterThan(ratios[2]);
  city.stock.clothing = city.target.clothing;
  city.price.clothing = ctx.goodById.clothing.basePrice;
  city.inputCostDelta = { clothing: 200 };
  const first = forecastPrice(ctx, city, 'clothing', 0, 1);
  for (let m = 0; m < 24; m++) updatePrices(ctx, city);
  expect(city.price.clothing).toBeGreaterThan(first);
  expect(first).toBeGreaterThan(ctx.goodById.clothing.basePrice);
});

it('국가별 고정 배정은 독립 시드와 초기 생산 시설에서 결정된다', () => {
  const data = structuredClone(DEFAULT_ECONOMY);
  const game = createEconomy(world, data, DEFAULT_SEED);
  const reversed = { ...data, goods: [...data.goods].reverse() };
  expect(createEconomy(world, reversed, DEFAULT_SEED).ctx.reputation).toEqual(game.ctx.reputation);
  for (const country of world.countries) {
    const goods = Object.keys(game.ctx.reputation.premiums[country.id]);
    expect(goods.length).toBeGreaterThan(0);
    expect(goods.length).toBeLessThanOrEqual(2);
    for (const id of goods) expect(Object.values(game.state.cities).some((c) => c.countryId === country.id && c.industries.some((i) => i.goodId === id && i.capacity > 0))).toBe(true);
  }
  expect(EARTH_PROFILE.signatureIndustries).toMatchObject({ deu: ['automobiles', 'machinery'], kor: ['electronics', 'cosmetics'], ita: ['clothing', 'furniture'] });
});

it('농장·광산만 있는 가상 국가는 원자재를 대표·보조 산업으로 삼고 이전 저장의 배정은 보존한다', () => {
  const data = structuredClone(DEFAULT_ECONOMY);
  for (const city of Object.values(data.cities)) city.factories = {};
  const { ctx, state } = createEconomy(world, data, DEFAULT_SEED);
  expect(ctx.reputation.version).toBe(2);
  for (const country of world.countries) {
    const produced = new Set(Object.values(state.cities).filter((c) => c.countryId === country.id)
      .flatMap((c) => c.industries.map((i) => i.goodId)));
    const picked = Object.entries(ctx.reputation.premiums[country.id]);
    expect(picked).toHaveLength(Math.min(2, produced.size));
    for (const [i, [id, premium]] of picked.entries()) {
      expect(produced.has(id)).toBe(true);
      expect(ctx.goodById[id].source).toBeDefined();
      expect(premium).toBe(i === 0 ? data.industryPremium.primary : data.industryPremium.secondary);
    }
  }
  expect(Object.values(ctx.reputation.premiums).some((p) => Object.keys(p).length === 2)).toBe(true);
  const old = { version: 1, premiums: { orden: { automobiles: 0.2, processed_food: 0.1 } }, unassigned: {} };
  const saved = { ...state, reputation: old };
  const restored = restoreEconomy(world, data, DEFAULT_SEED, saved);
  expect(restored.ctx.reputation).toEqual(old);
  expect(restored.state).toEqual(saved);
});

it.each([1, 2])('v%i 저장의 시장·화물 원가·현금·문화 유행을 유지하고, 배정을 다음 저장에 고정한다', (version) => {
  const { state, ship, id } = market();
  applyCommand(ctx, state, { type: 'trade', side: 'buy', shipId: ship.id, goodId: id, quantity: 10 });
  delete state.reputation;
  const raw = makeSaveFile({ label: '이전 저장', world: worldRef(world, ctx.data), settings: DEFAULT_SETTINGS, state });
  const file = readSaveFile(JSON.parse(JSON.stringify({ ...raw, version })))!;
  const restored = restoreEconomy(world, ctx.data, DEFAULT_SEED, file.state);
  const { reputation, ...other } = restored.state;
  expect(other).toEqual(state);
  expect(reputation).toEqual(initial.reputation);
  const changed = { ...ctx.data, signatureIndustries: { astera: ['machinery'] } };
  expect(restoreEconomy(world, changed, '새 규칙', restored.state).ctx.reputation).toEqual(reputation);
});

it('설정 생략·평판 0이면 공통 재고 반응과 거래 충격을 그대로 사용한다', () => {
  const data = structuredClone(DEFAULT_ECONOMY);
  for (const g of data.goods) delete g.priceResponse;
  data.signatureIndustries = Object.fromEntries(world.countries.map((c) => [c.id, []]));
  const { ctx, state } = createEconomy(world, data, DEFAULT_SEED);
  const city = state.cities.portabel;
  const g = ctx.goodById.grain;
  const q = 5;
  city.stock.grain = 100;
  city.mix.grain = { 'orden/astera': 100 };
  city.target.grain = 200;
  city.reserve.grain = 0;
  city.price.grain = g.basePrice;
  expect(forecastPrice(ctx, city, g.id, 0, 1)).toBeCloseTo(g.basePrice * 2 ** data.market.stockExponent);
  const m = data.market;
  const depth = Math.max(100, 200 * m.depthFloor);
  expect(quoteBuy(ctx, city, g.id, q, state).unitPrice).toBeCloseTo(g.basePrice * (1 + m.spread) * (depth / (depth - q / 2)) ** m.impactExponent);
  updatePrices(ctx, city);
  expect(city.price.grain).toBeCloseTo(g.basePrice * (1 + m.priceAdjust * (2 ** m.stockExponent - 1)));
});

it('같은 수량을 여러 브랜드로 나눠도 가계 소비량과 목표 재고는 같다', () => {
  const single = structuredClone(initial);
  single.ships = [];
  single.cities.portabel.industries = [];
  const mixed = structuredClone(single);
  const base = single.cities.portabel.stock.clothing;
  mixed.cities.portabel.mix.clothing = { 'orden/astera': base / 2, 'orden/orden': base / 2 };
  const a = stepMonth(ctx, single).state.cities.portabel;
  const b = stepMonth(ctx, mixed).state.cities.portabel;
  expect(b.last.consumed.clothing).toBeGreaterThan(0);
  expect(b.last.consumed.clothing).toBeCloseTo(a.last.consumed.clothing);
  expect(b.target.clothing).toBe(a.target.clothing);
  expect(b.stock.clothing).toBeCloseTo(a.stock.clothing);
});

it('자동항로가 지정한 브랜드만 싣고 실제 매입 견적을 원가로 기록한다', () => {
  const { state, city, ship, id } = market();
  const brand = 'astera';
  const stops = [
    { cityId: city.id, buy: [{ goodId: id, maxQuantity: 12, brandCountryId: brand }], sell: [] },
    { cityId: 'orpa', buy: [], sell: [id] },
  ];
  expect(applyCommand(ctx, state, { type: 'saveRoute', route: { name: '전자부품', stops, minMargin: 0, cashReserve: 0 } }).ok).toBe(true);
  expect(applyCommand(ctx, state, { type: 'assignRoute', shipId: ship.id, routeId: state.player.routes[0].id }).ok).toBe(true);
  const before = structuredClone(city);
  playerArrive(ctx, state, ship, state.month, []);
  const q = ship.cargo.reduce((n, lot) => n + lot.quantity, 0);
  const quote = quoteBuy(ctx, before, id, q, state, brand);
  expect(q).toBeGreaterThan(0);
  expect(ship.cargo.every((l) => l.brandCountryId === brand)).toBe(true);
  expect(city.mix[id]['orden/orden']).toBe(before.mix[id]['orden/orden']);
  expect(ship.cargo.reduce((sum, l) => sum + l.quantity * l.unitCost, 0)).toBeCloseTo(quote.total + q * ctx.goodById[id].volume * ctx.data.shipping.portFeePerUnit);
});

it('NPC 인도와 수동 판매 견적이 혼합 화물 전체의 물량 충격과 원산지별 관세를 공유한다', () => {
  const { state, city, id, ship } = market();
  const local = { ...ctx, data: { ...ctx.data, policy: { ...ctx.data.policy, baseTariff: 0.15 }, npc: { ...ctx.data.npc, minTripProfit: Infinity } } };
  const npc = state.ships.find((s) => s.companyId !== ship.companyId)!;
  npc.to = city.id;
  npc.from = 'orpa';
  npc.cargo = [
    { goodId: id, quantity: 14, originCityId: 'orpa', originCountryId: 'orden', brandCountryId: 'astera', unitCost: 102 },
    { goodId: id, quantity: 9, originCityId: 'orpa', originCountryId: city.countryId, brandCountryId: 'orden', unitCost: 83 },
  ];
  const quote = quoteCargoSale(local, state, npc, id, 23);
  const company = state.companies.find((c) => c.id === npc.companyId)!;
  const cash = company.cash;
  const tax = city.annual.tariffs;
  const events: SimEvent[] = [];
  actAtPort(local, state, npc, state.month, new SeededRNG('delivery'), events);
  const gross = events.reduce((v, e) => v + (e.type === 'delivery' ? e.revenue : 0), 0);
  expect(gross).toBeCloseTo(quote.total + quote.tariffTotal + quote.fees);
  expect(city.annual.tariffs - tax).toBeCloseTo(quote.tariffTotal);
  // NPC는 출항 시 양쪽 항만 처리비를 선납한다.
  expect(company.cash - cash).toBeCloseTo(quote.total + quote.fees);
});
