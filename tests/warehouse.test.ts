import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { retainedFraction } from '../src/sim/economy/market';
import { applyCommand, netProfit, PLAYER_ID, quoteCargoSale, stepWarehouse } from '../src/sim/economy/player';
import { createGame } from '../src/sim/economy/start';
import { restoreEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import { lotQuantity, lotVolume, warehouseMonthlyFee, warehouseOf, warehouseTransferLimit, WAREHOUSE_RULES } from '../src/sim/economy/warehouse';
import type { CargoLot, Command, EconomyContext, EconomyState, SimEvent } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import type { World } from '../src/sim/world/types';

let ctx: EconomyContext, initial: EconomyState, world: World;
beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
  ({ ctx, state: initial } = createGame(world, DEFAULT_ECONOMY, DEFAULT_SEED));
});
const fresh = () => structuredClone(initial);
const shipOf = (s: EconomyState) => s.ships.find((ship) => ship.companyId === PLAYER_ID)!;
const command = (state: EconomyState, cmd: Command) => applyCommand(ctx, state, cmd);
function lot(goodId: string, quantity: number, unitCost = 100): CargoLot {
  const origin = ctx.portIds.find((id) => ctx.countryOfCity[id] !== ctx.countryOfCity[ctx.data.player.startCityId])!;
  return { goodId, quantity, unitCost, originCityId: origin, originCountryId: ctx.countryOfCity[origin], brandCountryId: ctx.countryOfCity[origin], bought: { month: initial.month - 2, reason: { category: 'season', text: '수확철에 사 둔 물건이에요.' } } };
}
const transfer = (state: EconomyState, direction: 'store' | 'load', quantity = 10, storage: 'ambient' | 'cold' = 'ambient', goodId = 'grain') => command(state, { type: 'warehouseTransfer', shipId: shipOf(state).id, goodId, quantity, direction, storage });

describe('회사 창고와 냉장 증설', () => {
  it('배→창고→다른 배 이동은 매매가 아니고 원가·원산지·상표·매입 시점을 그대로 보존한다', () => {
    const state = fresh(), ship = shipOf(state), warehouse = state.player.warehouse!;
    const original = lot('grain', 20, 123);
    ship.cargo = [structuredClone(original)];
    const city = structuredClone(state.cities[warehouse.cityId]), ledger = structuredClone(state.player.ledger), cash = state.player.cash;
    const before = totals(ctx, state);
    expect(transfer(state, 'store', 7).ok).toBe(true);
    expect(warehouse.cargo[0]).toEqual({ ...original, quantity: 7 });
    expect(ship.cargo[0].quantity).toBe(13);
    expect(state.cities[warehouse.cityId]).toEqual(city);
    expect(state.player.ledger).toEqual(ledger);
    expect(state.player.cash).toBe(cash);
    expect(totals(ctx, state)).toEqual(before);
    const second = { ...structuredClone(ship), id: 'p2', cargo: [] };
    state.ships.push(second);
    expect(command(state, { type: 'warehouseTransfer', shipId: second.id, goodId: 'grain', quantity: 100, direction: 'load', storage: 'ambient' }).ok).toBe(true);
    expect(second.cargo).toEqual([{ ...original, quantity: 7 }]);
    expect(warehouse.cargo).toHaveLength(0);
    expect(totals(ctx, state)).toEqual(before);
    expect(state.player.tradeCount).toBe(0);
  });

  it('창고 용량과 배의 남은 공간을 부피로 제한하고 작은 잔량도 넘겨 싣지 않는다', () => {
    const state = fresh(), ship = shipOf(state), warehouse = state.player.warehouse!;
    ship.cargo = [lot('grain', 1)];
    warehouse.cargo = [lot('grain', warehouse.capacity - 0.01)];
    expect(transfer(state, 'store', 1).ok).toBe(true);
    expect(lotVolume(ctx, warehouse.cargo)).toBeCloseTo(warehouse.capacity, 8);
    expect(ship.cargo[0].quantity).toBeCloseTo(0.99, 8);
    expect(transfer(state, 'store', 1).ok).toBe(false);
    ship.cargo = [lot('grain', ship.capacity - 0.02)];
    expect(transfer(state, 'load', 50).ok).toBe(true);
    expect(lotVolume(ctx, ship.cargo)).toBeCloseTo(ship.capacity, 8);
    expect(transfer(state, 'load', 1).ok).toBe(false);
  });

  it('다른 항구·항해 중·자동 항로·타사 배·잘못된 수량·냉장 미증설은 상태를 바꾸지 않고 거절한다', () => {
    for (const variant of ['port', 'sailing', 'route', 'npc', 'negative', 'nan', 'infinity', 'cold']) {
      const state = fresh(), ship = shipOf(state);
      ship.cargo = [lot('grain', 10)];
      if (variant === 'port') ship.from = ship.to = ctx.portIds.find((id) => id !== ship.to)!;
      if (variant === 'sailing') ship.holding = false;
      if (variant === 'route') ship.routeId = 'r1';
      if (variant === 'npc') ship.companyId = 'npc';
      const before = structuredClone(state);
      const quantity = variant === 'negative' ? -1 : variant === 'nan' ? NaN : variant === 'infinity' ? Infinity : 10;
      const result = command(state, { type: 'warehouseTransfer', shipId: ship.id, goodId: 'grain', quantity, direction: 'store', storage: variant === 'cold' ? 'cold' : 'ambient' });
      expect(result.ok, variant).toBe(false);
      expect(state, variant).toEqual(before);
    }
  });

  it('보관 화물도 선종의 적재 제한을 따라 다시 싣는다', () => {
    const state = fresh(), ship = shipOf(state);
    ship.typeId = 'bulk';
    state.player.warehouse!.cargo = [lot('electronics', 5)];
    expect(warehouseTransferLimit(ctx, state, ship, 'electronics', 'load', 'ambient')).toBe(0);
    const before = structuredClone(state);
    expect(transfer(state, 'load', 5, 'ambient', 'electronics').ok).toBe(false);
    expect(state).toEqual(before);
  });

  it('일반 창고는 기존 월 부패율, 냉장 구역과 비부패성 상품은 보존하며 보관료를 기록한다', () => {
    const state = fresh(), warehouse = state.player.warehouse!;
    warehouse.cargo = [lot('fruit', 10, 200), lot('grain', 20)];
    expect(command(state, { type: 'upgradeWarehouse' }).ok).toBe(true);
    warehouse.coldCargo = [lot('fruit', 10, 200)];
    const before = totals(ctx, state), cash = state.player.cash, fee = warehouseMonthlyFee(ctx, warehouse);
    const spoiledBefore = state.spoiled.fruit ?? 0;
    const events: SimEvent[] = [];
    stepWarehouse(ctx, state, events);
    const kept = 10 * retainedFraction(ctx, ctx.goodById.fruit, 1);
    expect(lotQuantity(warehouse.cargo, 'fruit')).toBeCloseTo(kept);
    expect(lotQuantity(warehouse.coldCargo, 'fruit')).toBe(10);
    expect(lotQuantity(warehouse.cargo, 'grain')).toBe(20);
    expect(state.spoiled.fruit - spoiledBefore).toBeCloseTo(10 - kept);
    expect(state.player.lifetime.spoiledCost).toBeCloseTo((10 - kept) * 200);
    expect(state.player.cash).toBeCloseTo(cash - fee);
    expect(state.player.lifetime.storageFees).toBeCloseTo(fee);
    expect(netProfit(state.player.lifetime)).toBeCloseTo(-fee);
    expect(events.some((e) => e.type === 'notice' && e.text.includes('상했어요'))).toBe(true);
    const after = totals(ctx, state);
    expect(after.goods.fruit).toBeCloseTo(before.goods.fruit, 7);
    expect(after.money).toBeCloseTo(before.money, 4);
  });

  it('냉장 증설은 한 번만 비용을 내고, 기존 물건을 옮겨야 부패를 막는다', () => {
    const state = fresh(), warehouse = state.player.warehouse!;
    warehouse.cargo = [lot('fruit', 10)];
    const cash = state.player.cash, money = totals(ctx, state).money;
    expect(command(state, { type: 'upgradeWarehouse' }).ok).toBe(true);
    expect(state.player.cash).toBe(cash - WAREHOUSE_RULES.coldBuildCost);
    expect(state.player.lifetime.warehouseInvestment).toBe(WAREHOUSE_RULES.coldBuildCost);
    expect(warehouse.coldCapacity).toBe(60);
    expect(warehouse.coldCargo).toHaveLength(0);
    const afterUpgrade = structuredClone(state);
    expect(command(state, { type: 'upgradeWarehouse' }).ok).toBe(false);
    expect(state).toEqual(afterUpgrade);
    expect(totals(ctx, state).money).toBeCloseTo(money, 4);
    stepWarehouse(ctx, state, []);
    const remaining = lotQuantity(warehouse.cargo, 'fruit');
    expect(remaining).toBeLessThan(10);
    expect(command(state, { type: 'warehouseMove', goodId: 'fruit', quantity: 100, to: 'cold' }).ok).toBe(true);
    stepWarehouse(ctx, state, []);
    expect(lotQuantity(warehouse.coldCargo, 'fruit')).toBe(remaining);
    expect(warehouse.cargo).toHaveLength(0);
    expect(command(state, { type: 'warehouseMove', goodId: 'fruit', quantity: 2, to: 'ambient' }).ok).toBe(true);
    stepWarehouse(ctx, state, []);
    expect(lotQuantity(warehouse.cargo, 'fruit')).toBeCloseTo(2 * retainedFraction(ctx, ctx.goodById.fruit, 1));
    expect(lotQuantity(warehouse.coldCargo, 'fruit')).toBeCloseTo(remaining - 2);
  });

  it('월 갱신에도 회사 재고는 주민·공장이 소비하지 않으며 현금 부족은 미납 보관료로 남는다', () => {
    const state = fresh(), warehouse = state.player.warehouse!;
    warehouse.cargo = [lot('grain', 20)];
    state.player.cash = 0;
    stepWarehouse(ctx, state, []);
    expect(state.player.arrears).toBe(20 * WAREHOUSE_RULES.feePerVolume);
    expect(state.player.cash).toBe(0);
    const next = stepMonth(ctx, state).state;
    expect(next.player.warehouse!.cargo).toEqual(warehouse.cargo);
    expect(state.player.warehouse!.cargo).toEqual([lot('grain', 20)]);
    const before = structuredClone(next);
    expect(command(next, { type: 'upgradeWarehouse' }).ok).toBe(false);
    expect(next).toEqual(before);
  });

  it('냉장 구역은 별도 용량을 지키고, 무료 빈 창고에는 비용이 없다', () => {
    const state = fresh(), warehouse = state.player.warehouse!;
    stepWarehouse(ctx, state, []);
    expect(state.player.lifetime.storageFees ?? 0).toBe(0);
    command(state, { type: 'upgradeWarehouse' });
    warehouse.cargo = [lot('fruit', 70)];
    expect(command(state, { type: 'warehouseMove', goodId: 'fruit', quantity: 70, to: 'cold' }).ok).toBe(true);
    expect(lotVolume(ctx, warehouse.coldCargo)).toBe(60);
    expect(lotQuantity(warehouse.cargo, 'fruit')).toBe(10);
    const before = structuredClone(state);
    expect(command(state, { type: 'warehouseMove', goodId: 'fruit', quantity: 1, to: 'cold' }).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it('배가 없어도 창고에서 현재 시세로 팔고, 일반 판매와 같은 관세·수수료·시세 충격을 적용한다', () => {
    const warehouseState = fresh(), shipState = fresh();
    const goods = [lot('grain', 10, 100), lot('grain', 8, 150)];
    warehouseState.player.warehouse!.cargo = structuredClone(goods);
    shipOf(shipState).cargo = structuredClone(goods);
    const warehouse = warehouseState.player.warehouse!, home = warehouse.cityId;
    warehouseState.ships = warehouseState.ships.filter((s) => s.companyId !== PLAYER_ID);
    // 값이 내려간 동안 소유권을 보유하고, 나중의 실제 가격으로 판다.
    warehouseState.cities[home].price.grain = shipState.cities[home].price.grain = 60;
    const low = quoteCargoSale(ctx, warehouseState, { to: home, cargo: warehouse.cargo }, 'grain', 7);
    warehouseState.cities[home].price.grain = shipState.cities[home].price.grain = 300;
    const high = quoteCargoSale(ctx, warehouseState, { to: home, cargo: warehouse.cargo }, 'grain', 7);
    expect(high.total).toBeGreaterThan(low.total);
    const before = totals(ctx, warehouseState), cash = warehouseState.player.cash;
    expect(command(warehouseState, { type: 'warehouseSell', goodId: 'grain', quantity: 7, storage: 'ambient' }).ok).toBe(true);
    expect(command(shipState, { type: 'trade', shipId: shipOf(shipState).id, goodId: 'grain', quantity: 7, side: 'sell' }).ok).toBe(true);
    expect(warehouseState.player.cash - cash).toBeCloseTo(high.total);
    expect(warehouseState.player.cash).toBeCloseTo(shipState.player.cash);
    expect(warehouseState.cities).toEqual(shipState.cities);
    expect(warehouseState.player.lifetime).toEqual(shipState.player.lifetime);
    expect(warehouse.cargo).toEqual(shipOf(shipState).cargo);
    expect(warehouseState.player.chronicle.at(-1)).toMatchObject({ storage: 'ambient', cost: high.cost + high.fees, origins: [goods[0].originCountryId] });
    expect(warehouseState.player.chronicle.at(-1)?.shipId).toBeUndefined();
    expect(totals(ctx, warehouseState).money).toBeCloseTo(before.money, 4);
    expect(totals(ctx, warehouseState).goods.grain).toBeCloseTo(before.goods.grain, 7);
  });

  it('저장·불러오기에서 두 구역과 원가를 유지하고 예전 저장에는 무료 기본 창고를 제공한다', () => {
    const state = fresh();
    command(state, { type: 'upgradeWarehouse' });
    state.player.warehouse!.cargo = [lot('grain', 12.3, 121)];
    state.player.warehouse!.coldCargo = [lot('fruit', 7.2, 330)];
    const saved = JSON.parse(JSON.stringify(state));
    const restored = restoreEconomy(world, ctx.data, DEFAULT_SEED, saved).state;
    expect(restored.player.warehouse).toEqual(state.player.warehouse);
    expect(stepMonth(ctx, restored).state).toEqual(stepMonth(ctx, state).state);
    delete saved.player.warehouse;
    const before = structuredClone(saved);
    expect(warehouseOf(ctx, saved).capacity).toBe(180);
    expect(saved).toEqual(before);
    shipOf(saved).cargo = [lot('grain', 5)];
    expect(transfer(saved, 'store', 5).ok).toBe(true);
    expect(saved.player.warehouse.cargo[0]).toEqual(lot('grain', 5));
  });
});
