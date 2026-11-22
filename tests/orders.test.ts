import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { deliverableQuantity, newOrderBook, orderPurchasePlan, ORDER_RULES, orderReason, tickOrders, warehouseDeliverableQuantity } from '../src/sim/economy/orders';
import { cityTrust, settleOrderTrust, trustLevel } from '../src/sim/economy/trust';
import { addStock } from '../src/sim/economy/origin';
import { applyCommand, estimateVoyage, PLAYER_ID, playerBuyLimit } from '../src/sim/economy/player';
import { createGame } from '../src/sim/economy/start';
import { restoreEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { Command, EconomyContext, EconomyState, SimEvent, TradeOrder } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import type { World } from '../src/sim/world/types';

let ctx: EconomyContext, initial: EconomyState, world: World;
beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
  ({ ctx, state: initial } = createGame(world, DEFAULT_ECONOMY, DEFAULT_SEED));
});

function localFixture() {
  const f = fixture(), home = f.state.player.warehouse!.cityId, source = f.order.cityId;
  f.order.kind = 'local';
  f.order.cityId = home;
  f.order.sourceCityId = source;
  f.ship.to = f.ship.from = home;
  f.ship.cargo[0].originCityId = source;
  f.ship.cargo[0].originCountryId = ctx.countryOfCity[source];
  f.state.player.warehouse!.cargo = structuredClone(f.ship.cargo);
  f.ship.cargo = [];
  return f;
}

describe('거점 지역 발주와 도시별 거래 신뢰도', () => {
  it('완납 때만 신뢰도를 한 번 올리고 다른 도시와 일반 시장 판매는 분리한다', () => {
    const { state, ship, order } = fixture();
    command(state, { type: 'acceptOrder', orderId: order.id });
    command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 4 });
    expect(cityTrust(state, order.cityId).score).toBe(0);
    expect(order.trustChange).toBeUndefined();
    command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 100 });
    expect(cityTrust(state, order.cityId)).toMatchObject({ score: 10, completed: 1, cancelled: 0, expired: 0 });
    expect(cityTrust(state, order.sourceCityId).score).toBe(0);
    const before = structuredClone(state.player.cityTrust);
    settleOrderTrust(state, order);
    command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 100 });
    command(state, { type: 'trade', shipId: ship.id, goodId: 'grain', side: 'sell', quantity: 1 });
    expect(state.player.cityTrust).toEqual(before);
  });

  it('거절·무시는 그대로, 수락 후 취소와 기한 종료만 해당 도시의 신뢰도를 깎는다', () => {
    for (const outcome of ['declined', 'ignored', 'cancelled', 'expired'] as const) {
      const { state, order } = fixture();
      state.player.cityTrust = { [order.cityId]: { score: 20, completed: 2, cancelled: 0, expired: 0 } };
      state.player.orders!.nextOfferMonth = state.player.orders!.nextLocalOfferMonth = 1e9;
      const cash = state.player.cash;
      if (outcome === 'declined') command(state, { type: 'declineOrder', orderId: order.id });
      else if (outcome === 'ignored') { state.month = order.offerExpiresMonth; tickOrders(ctx, state, []); }
      else {
        command(state, { type: 'acceptOrder', orderId: order.id });
        if (outcome === 'cancelled') command(state, { type: 'cancelOrder', orderId: order.id });
        else { state.month = order.deadlineMonth; tickOrders(ctx, state, []); }
      }
      const expected = outcome === 'cancelled' ? 15 : outcome === 'expired' ? 12 : 20;
      expect(cityTrust(state, order.cityId).score, outcome).toBe(expected);
      expect(state.player.cash).toBe(cash);
      const before = structuredClone(state);
      tickOrders(ctx, state, []);
      expect(state).toEqual(before);
    }
  });

  it('신뢰도는 0~100으로 제한하고 실제 변화와 완납 실적을 남긴다', () => {
    const { state, order } = fixture();
    command(state, { type: 'acceptOrder', orderId: order.id });
    command(state, { type: 'cancelOrder', orderId: order.id });
    expect(order.trustChange).toBe(0);
    expect(cityTrust(state, order.cityId)).toMatchObject({ score: 0, cancelled: 1 });
    state.player.cityTrust![order.cityId].score = 95;
    const completed = { ...order, id: 'cap', status: 'completed' as const, trustChange: undefined };
    expect(settleOrderTrust(state, completed)).toBe(5);
    expect(cityTrust(state, order.cityId)).toMatchObject({ score: 100, completed: 1 });
    expect(trustLevel(19).bonus).toBe(0);
    expect(trustLevel(20).bonus).toBe(0.05);
    expect(trustLevel(50).localInterval).toBe(2);
    expect(trustLevel(80).bonus).toBe(0.15);
  });

  it('거점의 실제 부족과 외부 창고 재고를 연결하며 배가 없어도 지역 발주가 온다', () => {
    const { state, order } = localFixture();
    state.ships = state.ships.filter((s) => s.companyId !== PLAYER_ID);
    state.player.orders = newOrderBook(state.month);
    state.player.orders.nextOfferMonth = 1e9;
    state.month += 2;
    const home = state.cities[order.cityId];
    for (const g of ctx.goods) home.stock[g.id] = home.target[g.id];
    home.stock.grain = 0;
    home.target.grain = 200;
    const before = structuredClone(state), twin = structuredClone(state);
    tickOrders(ctx, state, []);
    tickOrders(ctx, twin, []);
    expect(state.player.orders).toEqual(twin.player.orders);
    expect(state.player.orders.items).toHaveLength(1);
    const local = state.player.orders.items[0];
    expect(local).toMatchObject({ kind: 'local', sourceKind: 'warehouse', cityId: home.id, goodId: 'grain', quantity: 13, suggestedBuyQuantity: 0 });
    expect(state.cities).toEqual(before.cities);
    expect(state.rng).toEqual(before.rng);
    expect(state.player.warehouse).toEqual(before.player.warehouse);
    expect(state.player.cash).toBe(before.player.cash);
    expect(state.player.orders.nextLocalOfferMonth).toBe(state.month + 4);
    command(state, { type: 'acceptOrder', orderId: local.id });
    state.month++;
    state.player.orders.nextLocalOfferMonth = state.month;
    tickOrders(ctx, state, []);
    expect(state.player.orders.items).toHaveLength(1);
  });

  it('지역 조달은 왕복 항속거리·현금에 맞추며 신뢰도 혜택은 새 계약에 고정한다', () => {
    const low = fresh(), home = low.player.warehouse!.cityId, ship = shipOf(low);
    for (const g of ctx.goods) low.cities[home].stock[g.id] = low.cities[home].target[g.id];
    low.cities[home].stock.grain = 0;
    low.cities[home].target.grain = 300;
    low.cities[home].price.grain = 400;
    const source = ctx.portIds.find((id) => id !== home && estimateVoyage(ctx, ship.typeId!, home, id, low).leg && estimateVoyage(ctx, ship.typeId!, id, home, low).leg)!;
    addStock(low.cities[source], 'grain', 1000, ctx.countryOfCity[source], ctx.countryOfCity[source]);
    low.cities[source].price.grain = 100;
    low.month += 2;
    low.player.orders!.nextOfferMonth = 1e9;
    const high = structuredClone(low);
    high.player.cityTrust = { [home]: { score: 50, completed: 5, cancelled: 0, expired: 0 } };
    tickOrders(ctx, low, []);
    tickOrders(ctx, high, []);
    const a = low.player.orders!.items[0], b = high.player.orders!.items[0];
    expect(a).toMatchObject({ kind: 'local', sourceKind: 'market', cityId: home });
    expect(a.sourceCityId).not.toBe(home);
    expect(estimateVoyage(ctx, ship.typeId!, home, a.sourceCityId, low).distanceKm).toBeLessThanOrEqual(3500);
    expect(estimateVoyage(ctx, ship.typeId!, a.sourceCityId, home, low).distanceKm).toBeLessThanOrEqual(3500);
    expect(a.estimatedCost).toBeLessThan(low.player.cash);
    expect(a.unitPrice * a.quantity).toBeGreaterThan(a.estimatedCost);
    expect(b.sourceCityId).toBe(a.sourceCityId);
    expect(b.unitPrice).toBe(Math.ceil(a.unitPrice * 1.1));
    expect(b.trustBonus).toBe(0.1);
    expect(low.player.orders!.nextLocalOfferMonth).toBe(low.month + 4);
    expect(high.player.orders!.nextLocalOfferMonth).toBe(high.month + 2);
    command(high, { type: 'acceptOrder', orderId: b.id });
    const fixed = b.unitPrice;
    high.player.cityTrust![home].score = 80;
    expect(b.unitPrice).toBe(fixed);
  });

  it('조달항에 가는 동안 현지에서 쓸 재고는 발주 조달량으로 잡지 않는다', () => {
    const state = fresh(), home = state.player.warehouse!.cityId;
    state.month += 2;
    state.player.orders!.nextOfferMonth = 1e9;
    for (const g of ctx.goods) state.cities[home].stock[g.id] = state.cities[home].target[g.id];
    state.cities[home].stock.grain = 0;
    state.cities[home].target.grain = 300;
    for (const id of ctx.portIds) {
      if (id === home) continue;
      state.cities[id].last.consumed.grain = state.cities[id].stock.grain + 1;
    }
    tickOrders(ctx, state, []);
    expect(state.player.orders!.items).toHaveLength(0);
  });

  it('일반·냉장 창고에서 나누어 납품해 돈·물량·원가를 보존하고 완납 때 신뢰를 얻는다', () => {
    const { state, order } = localFixture(), warehouse = state.player.warehouse!;
    warehouse.cargo[0].quantity = 4;
    warehouse.coldCapacity = 60;
    warehouse.coldCargo = [{ ...structuredClone(warehouse.cargo[0]), quantity: 8, unitCost: 120 }];
    state.ships = state.ships.filter((s) => s.companyId !== PLAYER_ID);
    command(state, { type: 'acceptOrder', orderId: order.id });
    const before = totals(ctx, state), cash = state.player.cash;
    expect(warehouseDeliverableQuantity(state, order, 'ambient')).toBe(4);
    expect(command(state, { type: 'deliverWarehouseOrder', orderId: order.id, storage: 'ambient', quantity: 99 }).ok).toBe(true);
    expect(cityTrust(state, order.cityId).score).toBe(0);
    expect(command(state, { type: 'deliverWarehouseOrder', orderId: order.id, storage: 'cold', quantity: 99 }).ok).toBe(true);
    expect(order.status).toBe('completed');
    expect(state.player.cash - cash).toBe(5000);
    expect(warehouse.cargo).toHaveLength(0);
    expect(warehouse.coldCargo[0].quantity).toBe(2);
    expect(cityTrust(state, order.cityId)).toMatchObject({ score: 10, completed: 1 });
    expect(state.player.chronicle.at(-1)).toMatchObject({ storage: 'cold', quantity: 6, cost: 720, revenue: 3000, orderId: order.id });
    expect(state.player.chronicle.at(-1)?.shipId).toBeUndefined();
    expect(totals(ctx, state).goods.grain).toBeCloseTo(before.goods.grain, 7);
    expect(totals(ctx, state).money).toBeCloseTo(before.money, 4);
    const done = structuredClone(state);
    expect(command(state, { type: 'deliverWarehouseOrder', orderId: order.id, storage: 'cold', quantity: 1 }).ok).toBe(false);
    expect(state).toEqual(done);
  });

  it('현지에서 산 창고 화물·다른 거점·기한 종료·잘못된 구역은 납품할 수 없다', () => {
    for (const variant of ['localBuy', 'wrongHome', 'expired', 'unaccepted', 'empty', 'badZone', 'nan', 'negative']) {
      const { state, order } = localFixture();
      if (variant !== 'unaccepted') command(state, { type: 'acceptOrder', orderId: order.id });
      if (variant === 'localBuy') state.player.warehouse!.cargo[0].originCityId = order.cityId;
      if (variant === 'wrongHome') order.cityId = order.sourceCityId;
      if (variant === 'expired') state.month = order.deadlineMonth;
      if (variant === 'empty') state.player.warehouse!.cargo = [];
      const before = structuredClone(state);
      const cmd = { type: 'deliverWarehouseOrder', orderId: order.id, storage: variant === 'badZone' ? 'other' : 'ambient', quantity: variant === 'nan' ? NaN : variant === 'negative' ? -1 : 10 } as Command;
      expect(command(state, cmd).ok, variant).toBe(false);
      expect(state, variant).toEqual(before);
    }
  });

  it('기존 저장은 0점에서 시작하며 저장 후 계약 완료·신뢰도·다음 발주 시점을 보존한다', () => {
    const { state, order } = localFixture();
    delete state.player.cityTrust;
    delete state.player.orders!.nextLocalOfferMonth;
    command(state, { type: 'acceptOrder', orderId: order.id });
    const saved = JSON.parse(JSON.stringify(state));
    const restored = restoreEconomy(world, ctx.data, DEFAULT_SEED, saved).state;
    const before = structuredClone(restored);
    expect(cityTrust(restored, order.cityId).score).toBe(0);
    expect(restored).toEqual(before);
    command(restored, { type: 'deliverWarehouseOrder', orderId: order.id, storage: 'ambient', quantity: 10 });
    tickOrders(ctx, restored, []);
    expect(restored.player.orders!.nextLocalOfferMonth).toBe(restored.month + 2);
    expect(cityTrust(restored, order.cityId).score).toBe(10);
    const again = restoreEconomy(world, ctx.data, DEFAULT_SEED, JSON.parse(JSON.stringify(restored))).state;
    expect(again.player).toEqual(restored.player);
    expect(stepMonth(ctx, again).state).toEqual(stepMonth(ctx, restored).state);
    expect(cityTrust(again, order.cityId).completed).toBe(1);
  });
});
const fresh = () => structuredClone(initial);
const shipOf = (s: EconomyState) => s.ships.find((ship) => ship.companyId === PLAYER_ID)!;
const command = (s: EconomyState, cmd: Command) => applyCommand(ctx, s, cmd);

function fixture() {
  const state = fresh(), ship = shipOf(state), source = ship.to;
  const cityId = ctx.portIds.find((id) => id !== source && state.cities[id].target.grain > 0)!;
  const order: TradeOrder = {
    id: 'test-order', cityId, goodId: 'grain', quantity: 10, delivered: 0, unitPrice: 500, referencePrice: 150,
    issuedMonth: state.month, offerExpiresMonth: state.month + 2, deadlineMonth: state.month + 5, status: 'offered',
    reason: { category: 'season', text: '수확이 적은 계절이라 곡물이 필요해요.' },
    sourceCityId: source, sourceReason: { category: 'climate', text: '곡물을 기르기 알맞아요.' }, suggestedBuyQuantity: 10, estimatedCost: 1800,
  };
  state.player.orders = { ...newOrderBook(state.month), items: [order] };
  // 명령 경계 검사에서는 운송을 끝낸 배를 준비한다. 실제 항해는 earth.test에서 검증한다.
  ship.to = ship.from = cityId;
  ship.cargo = [{ goodId: 'grain', quantity: 13, originCityId: source, originCountryId: ctx.countryOfCity[source], brandCountryId: ctx.countryOfCity[source], unitCost: 100, bought: { month: state.month, reason: order.sourceReason } }];
  return { state, ship, order };
}

describe('발주 품목 바로 채우기', () => {
  function buyingFixture() {
    const f = fixture();
    f.ship.to = f.ship.from = f.order.sourceCityId;
    f.ship.cargo = [];
    f.order.cityId = ctx.portIds.find((id) => id !== f.ship.to && estimateVoyage(ctx, f.ship.typeId!, f.ship.to, id, f.state).leg)!;
    f.order.deadlineMonth = f.state.month + 10;
    f.order.status = 'accepted';
    f.order.acceptedMonth = f.state.month;
    f.state.player.cash = 100000;
    addStock(f.state.cities[f.ship.to], 'grain', 1000, ctx.countryOfCity[f.ship.to], ctx.countryOfCity[f.ship.to]);
    return f;
  }

  it('부분 납품과 이미 실은 외부 화물을 빼고 구매하며 반복 클릭으로 과매입하지 않는다', () => {
    const { state, ship, order } = buyingFixture();
    order.delivered = 3;
    ship.cargo = [
      { goodId: 'grain', quantity: 2, originCityId: ship.to, originCountryId: ctx.countryOfCity[ship.to], brandCountryId: ctx.countryOfCity[ship.to], unitCost: 100 },
      { goodId: 'grain', quantity: 4, originCityId: order.cityId, originCountryId: ctx.countryOfCity[order.cityId], brandCountryId: ctx.countryOfCity[order.cityId], unitCost: 100 },
    ];
    const plan = orderPurchasePlan(ctx, state, ship, order), cash = state.player.cash;
    expect(plan).toMatchObject({ remaining: 7, aboard: 2, needed: 5, quantity: 5 });
    expect(command(state, { type: 'fillOrder', orderId: order.id, shipId: ship.id }).ok).toBe(true);
    expect(cash - state.player.cash).toBeCloseTo(plan.total, 7);
    expect(orderPurchasePlan(ctx, state, ship, order).quantity).toBe(0);
    const after = structuredClone(state);
    expect(command(state, { type: 'fillOrder', orderId: order.id, shipId: ship.id }).ok).toBe(false);
    expect(state).toEqual(after);
  });

  it('부패성 상품은 실제 항로에서 상할 양까지 실어 도착 후 완납한다', () => {
    const { state, ship, order } = buyingFixture();
    order.goodId = 'fruit';
    addStock(state.cities[ship.to], 'fruit', 1000, ctx.countryOfCity[ship.to], ctx.countryOfCity[ship.to]);
    const plan = orderPurchasePlan(ctx, state, ship, order);
    expect(plan.keep).toBeLessThan(1);
    expect(plan.quantity).toBeGreaterThan(order.quantity);
    expect(plan.quantity * plan.keep).toBeGreaterThanOrEqual(order.quantity);
    expect(command(state, { type: 'fillOrder', orderId: order.id, shipId: ship.id }).ok).toBe(true);
    expect(orderPurchasePlan(ctx, state, ship, order).quantity).toBe(0);
    expect(command(state, { type: 'sail', shipId: ship.id, to: order.cityId }).ok).toBe(true);
    const arrival = stepMonth(ctx, state).state;
    const result = command(arrival, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: order.quantity });
    expect(result.ok).toBe(true);
    expect(arrival.player.orders!.items.find((o) => o.id === order.id)!.status).toBe('completed');
  });

  it('짐칸·재고·매입 자금 한도를 지키고 납품 항해 비용을 남긴다', () => {
    for (const limit of ['space', 'stock', 'cash'] as const) {
      const { state, ship, order } = buyingFixture();
      if (limit === 'space') ship.capacity = 3 * ctx.goodById.grain.volume;
      if (limit === 'stock') {
        const city = state.cities[ship.to], country = ctx.countryOfCity[ship.to];
        city.stock.grain = city.reserve.grain + 3 / ctx.data.market.maxBuyShare;
        city.mix.grain = { [`${country}/${country}`]: city.stock.grain };
      }
      if (limit === 'cash') {
        const initialPlan = orderPurchasePlan(ctx, state, ship, order);
        state.player.cash = initialPlan.reserve + initialPlan.total * 0.4;
      }
      const plan = orderPurchasePlan(ctx, state, ship, order);
      expect(plan.quantity, limit).toBeGreaterThan(0);
      expect(plan.quantity, limit).toBeLessThan(plan.needed);
      expect(plan.quantity).toBeLessThanOrEqual(playerBuyLimit(ctx, state, ship, order.goodId));
      expect(command(state, { type: 'fillOrder', orderId: order.id, shipId: ship.id }).ok, limit).toBe(true);
      expect(state.player.cash + 1e-7).toBeGreaterThanOrEqual(plan.reserve);
    }
  });

  it('미수락·기한 종료·납품처 자체 구매·항해 중·자동 항로·타사 배는 구매하지 않는다', () => {
    for (const invalid of ['offered', 'expired', 'destination', 'sailing', 'route', 'foreign', 'late'] as const) {
      const { state, ship, order } = buyingFixture();
      if (invalid === 'offered') order.status = 'offered';
      if (invalid === 'expired') state.month = order.deadlineMonth;
      if (invalid === 'destination') ship.to = ship.from = order.cityId;
      if (invalid === 'sailing') ship.holding = false;
      if (invalid === 'route') ship.routeId = 'route';
      if (invalid === 'foreign') ship.companyId = 'other-company';
      if (invalid === 'late') order.deadlineMonth = state.month + 1;
      const before = structuredClone(state);
      expect(command(state, { type: 'fillOrder', orderId: order.id, shipId: ship.id }).ok, invalid).toBe(false);
      expect(state, invalid).toEqual(before);
    }
  });
});

describe('선택형 도시 발주', () => {
  it('첫 달 뒤 요청을 만들고 경제의 난수·현금·재고는 건드리지 않는다', () => {
    const state = fresh();
    const before = structuredClone(state);
    const events: SimEvent[] = [];
    tickOrders(ctx, state, events);
    expect(events).toHaveLength(0);
    state.month++;
    const twin = structuredClone(state);
    tickOrders(ctx, state, events);
    tickOrders(ctx, twin, []);
    expect(state.player.orders).toEqual(twin.player.orders);
    expect(state.player.orders!.items.length).toBeGreaterThan(0);
    expect(state.cities).toEqual(before.cities);
    expect(state.rng).toEqual(before.rng);
    expect(state.player.cash).toBe(before.player.cash);
    const order = state.player.orders!.items[0];
    const ship = shipOf(state);
    expect(order.unitPrice).toBeGreaterThan(order.referencePrice);
    expect(order.quantity * order.unitPrice).toBeGreaterThan(order.estimatedCost);
    expect(order.estimatedCost).toBeLessThan(state.player.cash);
    expect(estimateVoyage(ctx, ship.typeId!, order.sourceCityId, order.cityId, state).distanceKm).toBeLessThanOrEqual(3500);
    expect(state.cities[order.cityId].stock[order.goodId]).toBeLessThan(state.cities[order.cityId].target[order.goodId] * 0.85);
    expect(state.player.orders!.nextOfferMonth - state.month).toBeGreaterThanOrEqual(ORDER_RULES.intervalMin);
    expect(state.player.orders!.nextOfferMonth - state.month).toBeLessThanOrEqual(ORDER_RULES.intervalMax);
  });

  it('발주를 확인하지 않아도 시뮬레이션의 시장·NPC·난수 흐름은 같다', () => {
    const normal = fresh(), disabled = fresh();
    disabled.player.orders!.nextOfferMonth = 1e9;
    const a = stepMonth(ctx, normal).state, b = stepMonth(ctx, disabled).state;
    expect(a.rng).toEqual(b.rng);
    expect(a.cities).toEqual(b.cities);
    expect(a.ships).toEqual(b.ships);
    expect(a.player.cash).toBe(b.player.cash);
  });

  it('생산 차질·공장 원료·생산 시설 부재를 실제 도시 상태에서 설명한다', () => {
    const { state, order } = fixture();
    const city = state.cities[order.cityId];
    state.modifiers.push({ cityId: city.id, goodId: 'grain', factor: 0.5, untilMonth: state.month + 2, reason: '긴 가뭄' });
    expect(orderReason(ctx, state, city.id, 'grain')).toMatchObject({ category: 'shortage', text: expect.stringContaining('긴 가뭄') });
    city.industries = [{ goodId: 'steel', capacity: 20, initialCapacity: 20, weakYears: 0 }];
    expect(orderReason(ctx, state, city.id, 'iron_ore').category).toBe('industry');
    city.industries = [];
    expect(orderReason(ctx, state, city.id, 'iron_ore').category).toBe('resource');
  });

  it('수락·거절은 선택이며 현금·상품을 움직이지 않고 진행 한도를 지킨다', () => {
    const { state, order } = fixture();
    const before = totals(ctx, state);
    expect(command(state, { type: 'acceptOrder', orderId: order.id }).ok).toBe(true);
    expect(totals(ctx, state)).toEqual(before);
    expect(command(state, { type: 'acceptOrder', orderId: order.id }).ok).toBe(false);
    const second = { ...order, id: 'second', status: 'offered' as const };
    const third = { ...second, id: 'third' };
    state.player.orders!.items.push(second, third);
    expect(command(state, { type: 'acceptOrder', orderId: second.id }).ok).toBe(true);
    expect(command(state, { type: 'acceptOrder', orderId: third.id }).ok).toBe(false);
    expect(command(state, { type: 'declineOrder', orderId: third.id }).ok).toBe(true);
    expect(third.status).toBe('declined');
    expect(totals(ctx, state)).toEqual(before);
  });

  it('부분 납품·완료는 고정 단가로 정확한 양만 지급하며 원산지·장부·무역 이유를 기록한다', () => {
    const { state, ship, order } = fixture();
    command(state, { type: 'acceptOrder', orderId: order.id });
    const before = totals(ctx, state), cash = state.player.cash;
    const stock = state.cities[order.cityId].stock.grain;
    const partial = command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 4 });
    expect(partial.ok).toBe(true);
    expect(order.delivered).toBe(4);
    expect(order.status).toBe('accepted');
    expect(state.player.cash - cash).toBe(2000);
    expect(command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 100 }).ok).toBe(true);
    expect(order.status).toBe('completed');
    expect(order.delivered).toBe(10);
    expect(state.player.cash - cash).toBe(5000);
    expect(state.cities[order.cityId].stock.grain - stock).toBeCloseTo(10);
    expect(ship.cargo[0].quantity).toBe(3);
    expect(state.player.lifetime.sales).toBe(5000);
    const after = totals(ctx, state);
    expect(after.money).toBeCloseTo(before.money, 4);
    expect(after.goods.grain).toBeCloseTo(before.goods.grain, 7);
    expect(state.player.chronicle.at(-1)).toMatchObject({ orderId: order.id, quantity: 6, revenue: 3000, profit: 2400, destReason: order.reason });
    expect(state.player.reasonStats.season.count).toBe(2);
    const done = structuredClone(state);
    expect(command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 10 }).ok).toBe(false);
    expect(state).toEqual(done);
  });

  it('잘못된 납품과 미수락·현지 매입 상품을 거절하고 실패 시 상태를 보존한다', () => {
    for (const variant of ['unaccepted', 'local', 'wrongPort', 'sailing', 'route', 'npc', 'wrongGood', 'zero', 'nan', 'expired']) {
      const { state, ship, order } = fixture();
      if (variant !== 'unaccepted') command(state, { type: 'acceptOrder', orderId: order.id });
      if (variant === 'local') ship.cargo[0].originCityId = order.cityId;
      if (variant === 'wrongPort') ship.to = order.sourceCityId;
      if (variant === 'sailing') { ship.holding = false; ship.from = order.sourceCityId; ship.arrivesAt = state.month + 1; }
      if (variant === 'route') ship.routeId = 'route1';
      if (variant === 'npc') ship.companyId = 'npc';
      if (variant === 'wrongGood') ship.cargo[0].goodId = 'fruit';
      if (variant === 'expired') state.month = order.deadlineMonth;
      const before = structuredClone(state);
      const result = command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: variant === 'zero' ? 0 : variant === 'nan' ? NaN : 10 });
      expect(result.ok, variant).toBe(false);
      expect(state, variant).toEqual(before);
    }
  });

  it('마감 달의 시작부터 수락·납품이 막히고 만료·취소에도 기존 대금과 남은 짐은 유지된다', () => {
    const first = fixture();
    first.state.month = first.order.offerExpiresMonth;
    expect(command(first.state, { type: 'acceptOrder', orderId: first.order.id }).ok).toBe(false);
    for (const kind of ['expired', 'cancelled'] as const) {
      const { state, ship, order } = fixture();
      command(state, { type: 'acceptOrder', orderId: order.id });
      state.month = order.deadlineMonth - 1;
      expect(command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 3 }).ok).toBe(true);
      const cash = state.player.cash, cargo = structuredClone(ship.cargo);
      if (kind === 'expired') { state.month++; tickOrders(ctx, state, []); }
      else command(state, { type: 'cancelOrder', orderId: order.id });
      expect(order.status).toBe(kind);
      expect(state.player.cash).toBe(cash);
      expect(ship.cargo).toEqual(cargo);
      expect(deliverableQuantity(state, ship, order)).toBe(0);
    }
  });

  it('저장·불러오기에서 약속과 납품량을 유지하고 옛 저장에는 발주함을 준비한다', () => {
    const { state, ship, order } = fixture();
    command(state, { type: 'acceptOrder', orderId: order.id });
    command(state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 3 });
    const saved = JSON.parse(JSON.stringify(state));
    const restored = restoreEconomy(world, ctx.data, DEFAULT_SEED, saved);
    expect(restored.state.player.orders).toEqual(state.player.orders);
    expect(command(restored.state, { type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: 20 }).ok).toBe(true);
    expect(restored.state.player.orders!.items[0].delivered).toBe(10);
    delete saved.player.orders;
    saved.month++;
    tickOrders(ctx, saved, []);
    expect(saved.player.orders).toEqual(newOrderBook(saved.month));
  });
});
