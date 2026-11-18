import { beforeAll, describe, expect, it } from 'vitest';
import { botCommands, botFleet, botVoyages } from '../src/sim/economy/bot';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import {
  applyCommand,
  cargoOf,
  cargoVolume,
  estimateVoyage,
  isDocked,
  netProfit,
  PLAYER_ID,
} from '../src/sim/economy/player';
import { suggestTrips } from '../src/sim/economy/advice';
import { createGame } from '../src/sim/economy/start';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { Command, EconomyContext, EconomyState, RouteStop, SimEvent } from '../src/sim/economy/types';
import { evaluateRoute } from '../src/sim/economy/routePlan';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

let ctx: EconomyContext;
let initial: EconomyState;
let smallPort: string;
let bigPort: string;

const fresh = () => structuredClone(initial);
const myShips = (s: EconomyState) => s.ships.filter((x) => x.companyId === PLAYER_ID);
const ship1 = (s: EconomyState) => s.ships.find((x) => x.id === 'p1')!;
const apply = (s: EconomyState, cmd: Command) => applyCommand(ctx, s, cmd);

/** 배가 도착할 때까지 달을 넘긴다 */
function runUntilDocked(state: EconomyState, shipId: string, limit = 12): { state: EconomyState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let k = 0; k < limit; k++) {
    const r = stepMonth(ctx, state);
    state = r.state;
    events.push(...r.events);
    if (isDocked(state.ships.find((s) => s.id === shipId)!)) break;
  }
  return { state, events };
}

/** 봇으로 months개월 플레이 */
function playBot(months: number, buyShips: string[]): EconomyState {
  let state = fresh();
  const opt = { buyShips, keepCashPerShip: 10000 };
  for (let m = 0; m < months; m++) {
    state = structuredClone(state);
    for (const phase of [botCommands, botFleet, botVoyages]) for (const cmd of phase(ctx, state, opt)) apply(state, cmd);
    state = stepMonth(ctx, state).state;
  }
  return state;
}

beforeAll(() => {
  const { world } = generateWorld(makeConfig({ seed: DEFAULT_SEED }));
  const eco = createGame(world, DEFAULT_ECONOMY, DEFAULT_SEED);
  ctx = eco.ctx;
  initial = eco.state;
  smallPort = ctx.cityIds.find((id) => ctx.portSize[id] === 1)!;
  bigPort = ctx.cityIds.find((id) => ctx.portSize[id] === 3 && id !== DEFAULT_ECONOMY.player.startCityId)!;
});

describe('시작 상태', () => {
  it('작은 배 한 척과 시작 자금으로, 시작 항구에 서 있다', () => {
    const ships = myShips(initial);
    expect(ships).toHaveLength(1);
    expect(ships[0].typeId).toBe('small');
    expect(isDocked(ships[0])).toBe(true);
    expect(ships[0].to).toBe(DEFAULT_ECONOMY.player.startCityId);
    expect(initial.player.cash).toBe(DEFAULT_ECONOMY.player.startingCash);
  });

  it('선종이 5가지이고 크기·속도·적재량·비용이 서로 다르다', () => {
    const t = ctx.data.shipTypes;
    expect(t.map((x) => x.id).sort()).toEqual(['bulk', 'container', 'medium', 'reefer', 'small']);
    expect(new Set(t.map((x) => x.capacity)).size).toBe(5);
    expect(new Set(t.map((x) => x.speedKmPerMonth)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('수동 거래', () => {
  it('사면 현금과 도시 재고가 줄고 그만큼 배에 실린다', () => {
    const s = fresh();
    const city = s.cities[ship1(s).to];
    const goodId = ctx.goods.find((g) => city.stock[g.id] > city.reserve[g.id] + 20 && g.cargoClass !== 'perishable')!.id;
    const stock0 = city.stock[goodId];
    const cash0 = s.player.cash;
    const r = apply(s, { type: 'trade', shipId: 'p1', goodId, side: 'buy', quantity: 10 });
    expect(r.ok).toBe(true);
    expect(cargoOf(ship1(s), goodId)).toBeCloseTo(10, 6);
    expect(city.stock[goodId]).toBeCloseTo(stock0 - 10, 6);
    expect(s.player.cash).toBeLessThan(cash0);
  });

  it('배 크기·현금·재고를 넘겨 살 수 없고, 현금은 음수가 되지 않는다', () => {
    const s = fresh();
    s.player.cash = 1e9;
    const city = s.cities[ship1(s).to];
    const goodId = ctx.goods.filter((g) => g.cargoClass !== 'perishable').sort((a, b) => city.stock[b.id] - city.stock[a.id])[0].id;
    apply(s, { type: 'trade', shipId: 'p1', goodId, side: 'buy', quantity: 1e6 });
    expect(cargoVolume(ctx, ship1(s))).toBeLessThanOrEqual(ship1(s).capacity + 1e-6);
    expect(city.stock[goodId]).toBeGreaterThanOrEqual(city.reserve[goodId] - 1e-6);

    const poor = fresh();
    poor.player.cash = 500;
    apply(poor, { type: 'trade', shipId: 'p1', goodId, side: 'buy', quantity: 1e6 });
    expect(poor.player.cash).toBeGreaterThanOrEqual(0);
  });

  it('같은 항구에서 사서 바로 팔면 손해다(호가 차이·항만비)', () => {
    const s = fresh();
    const goodId = 'textiles';
    const cash0 = s.player.cash;
    apply(s, { type: 'trade', shipId: 'p1', goodId, side: 'buy', quantity: 20 });
    apply(s, { type: 'trade', shipId: 'p1', goodId, side: 'sell', quantity: 1e9 });
    expect(cargoOf(ship1(s), goodId)).toBe(0);
    expect(s.player.cash).toBeLessThan(cash0);
  });

  it('배에 없는 물건은 팔 수 없고, 항해 중에는 거래할 수 없다', () => {
    const s = fresh();
    expect(apply(s, { type: 'trade', shipId: 'p1', goodId: 'grain', side: 'sell', quantity: 5 }).ok).toBe(false);
    const dest = ctx.cityIds.find((id) => id !== ship1(s).to && ctx.portSize[id] >= 1)!;
    expect(apply(s, { type: 'sail', shipId: 'p1', to: dest }).ok).toBe(true);
    const r = apply(s, { type: 'trade', shipId: 'p1', goodId: 'grain', side: 'buy', quantity: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('항구');
  });

  it('선종이 실을 수 없는 화물은 거절한다(벌크선에 의류)', () => {
    const s = fresh();
    s.player.cash = 1e7;
    expect(apply(s, { type: 'buyShip', typeId: 'bulk', cityId: bigPort }).ok).toBe(true);
    const bulk = myShips(s).find((x) => x.typeId === 'bulk')!;
    const r = apply(s, { type: 'trade', shipId: bulk.id, goodId: 'clothing', side: 'buy', quantity: 5 });
    expect(r.ok).toBe(false);
  });
});

describe('항해', () => {
  it('연료비를 내고 떠나며, 거리/속도만큼 걸려 도착한다', () => {
    let s = fresh();
    const from = ship1(s).to;
    const to = ctx.cityIds.find((id) => id !== from)!;
    const v = estimateVoyage(ctx, 'small', from, to);
    const cash0 = s.player.cash;
    expect(apply(s, { type: 'sail', shipId: 'p1', to }).ok).toBe(true);
    expect(s.player.cash).toBeCloseTo(cash0 - v.fuel, 6);
    expect(ship1(s).arrivesAt - ship1(s).departedAt).toBeCloseTo(v.months, 6);
    const r = runUntilDocked(s, 'p1');
    s = r.state;
    expect(ship1(s).to).toBe(to);
    expect(r.events.some((e) => e.type === 'arrival' && e.shipId === 'p1' && e.cityId === to)).toBe(true);
    expect(Math.ceil(v.months)).toBeGreaterThanOrEqual(r.state.month - initial.month);
  });

  it('연료비가 모자라면 떠날 수 없다', () => {
    const s = fresh();
    s.player.cash = 1;
    const r = apply(s, { type: 'sail', shipId: 'p1', to: ctx.cityIds.find((id) => id !== ship1(s).to)! });
    expect(r.ok).toBe(false);
    expect(s.player.cash).toBe(1);
  });

  it('큰 배는 작은 항구에 들어갈 수도, 그곳에서 살 수도 없다', () => {
    const s = fresh();
    s.player.cash = 1e7;
    expect(apply(s, { type: 'buyShip', typeId: 'container', cityId: smallPort }).ok).toBe(false);
    expect(apply(s, { type: 'buyShip', typeId: 'container', cityId: bigPort }).ok).toBe(true);
    const box = myShips(s).find((x) => x.typeId === 'container')!;
    const r = apply(s, { type: 'sail', shipId: box.id, to: smallPort });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('작아요');
    // 작은 배는 갈 수 있다
    expect(apply(s, { type: 'sail', shipId: 'p1', to: smallPort === ship1(s).to ? bigPort : smallPort }).ok).toBe(true);
  });

  it('과일은 냉장선이 아니면 항해 중 상하고, 상한 양도 장부에 남는다', () => {
    const longTrip = (typeId: string) => {
      let s = fresh();
      s.player.cash = 1e7;
      const from = ctx.cityIds.filter((id) => ctx.portSize[id] >= 2).sort((a, b) => s.cities[b].stock.fruit - s.cities[a].stock.fruit)[0];
      apply(s, { type: 'buyShip', typeId, cityId: from });
      const ship = myShips(s).find((x) => x.typeId === typeId && x.to === from)!;
      apply(s, { type: 'trade', shipId: ship.id, goodId: 'fruit', side: 'buy', quantity: 40 });
      const loaded = cargoOf(ship, 'fruit');
      const to = ctx.cityIds.filter((id) => id !== from && ctx.portSize[id] >= 2).sort((a, b) => ctx.distanceKm(from, b) - ctx.distanceKm(from, a))[0];
      const before = totals(ctx, s).goods.fruit;
      apply(s, { type: 'sail', shipId: ship.id, to });
      const r = runUntilDocked(s, ship.id);
      s = r.state;
      const after = s.ships.find((x) => x.id === ship.id)!;
      return { loaded, left: cargoOf(after, 'fruit'), s, before, events: r.events };
    };
    const plain = longTrip('medium');
    const cold = longTrip('reefer');
    expect(plain.left).toBeLessThan(plain.loaded * 0.95);
    expect(cold.left).toBeCloseTo(cold.loaded, 6);
    expect(plain.s.player.lifetime.spoiledCost).toBeGreaterThan(0);
    expect(plain.s.spoiled.fruit).toBeGreaterThan(0);
  });
});

describe('선박 구매·매각과 장부', () => {
  it('배를 사면 값만큼 현금이 줄고, 팔면 일부를 돌려받는다', () => {
    const s = fresh();
    s.player.cash = 100000;
    const price = ctx.data.shipTypes.find((t) => t.id === 'small')!.price;
    expect(apply(s, { type: 'buyShip', typeId: 'small', cityId: ship1(s).to }).ok).toBe(true);
    expect(s.player.cash).toBeCloseTo(100000 - price, 6);
    const added = myShips(s).find((x) => x.id !== 'p1')!;
    expect(apply(s, { type: 'sellShip', shipId: added.id }).ok).toBe(true);
    expect(s.player.cash).toBeCloseTo(100000 - price * (1 - ctx.data.shipTypes[0].resaleShare), 6);
    expect(apply(s, { type: 'buyShip', typeId: 'medium', cityId: ship1(s).to }).ok).toBe(false); // 돈 부족
  });

  it('장부의 합은 현금 변화와 맞고, 돈과 상품은 생기거나 사라지지 않는다', () => {
    const start = fresh();
    const money0 = totals(ctx, start).money;
    const s = playBot(48, ['small']);
    const life = s.player.lifetime;
    const cashDelta = s.player.cash - DEFAULT_ECONOMY.player.startingCash;
    expect(cashDelta + s.player.arrears).toBeCloseTo(netProfit(life) + life.shipTrade, 3);
    expect(totals(ctx, s).money).toBeCloseTo(money0, 3);
  });

  it('배마다 이력(선령·항해 거리·돈)을 남기고, 모든 배의 합은 회사 장부와 같다', () => {
    const s = playBot(48, ['small']);
    const ships = myShips(s);
    expect(ships.length).toBeGreaterThan(1);
    const sum = (f: (r: NonNullable<(typeof ships)[number]['record']>) => number) => ships.reduce((a, x) => a + f(x.record!), 0);
    const life = s.player.lifetime;
    expect(sum((r) => r.sales)).toBeCloseTo(life.sales, 3);
    expect(sum((r) => r.purchases)).toBeCloseTo(life.purchases, 3);
    expect(sum((r) => r.fuel)).toBeCloseTo(life.fuel, 3);
    expect(sum((r) => r.upkeep)).toBeCloseTo(life.upkeep, 3);
    expect(sum((r) => r.fees)).toBeCloseTo(life.portFees + (life.tariffs ?? 0) + (life.passageFees ?? 0), 3);
    const first = ship1(s).record!;
    expect(first.since).toBe(s.player.startMonth);
    expect(first.voyages).toBeGreaterThan(0);
    expect(first.distanceKm).toBeGreaterThan(0);
    // 나중에 산 배는 산 달이 선령의 시작이다
    expect(ships.filter((x) => x.id !== 'p1').every((x) => x.record!.since > s.player.startMonth)).toBe(true);
  });

  it('배 이름을 바꿀 수 있다(앞뒤 공백 정리, 빈 이름·너무 긴 이름은 거절)', () => {
    const s = fresh();
    expect(apply(s, { type: 'renameShip', shipId: 'p1', name: '  바다  거북  ' }).ok).toBe(true);
    expect(ship1(s).name).toBe('바다 거북');
    expect(apply(s, { type: 'renameShip', shipId: 'p1', name: '   ' }).ok).toBe(false);
    expect(apply(s, { type: 'renameShip', shipId: 'p1', name: '가'.repeat(21) }).ok).toBe(false);
    expect(ship1(s).name).toBe('바다 거북');
    // 다른 회사 배는 바꿀 수 없다
    const npc = s.ships.find((x) => x.companyId !== PLAYER_ID)!;
    expect(apply(s, { type: 'renameShip', shipId: npc.id, name: '남의 배' }).ok).toBe(false);
  });
});

describe('첫 거래 힌트', () => {
  it('첫 힌트를 그대로 따르면 도착해서 팔았을 때 이익이 남는다', () => {
    let s = fresh();
    const idea = suggestTrips(ctx, s, ship1(s))[0];
    expect(idea).toBeDefined();
    expect(idea.reason.length).toBeGreaterThan(5);
    expect(apply(s, { type: 'trade', shipId: 'p1', goodId: idea.goodId, side: 'buy', quantity: idea.quantity }).ok).toBe(true);
    expect(apply(s, { type: 'sail', shipId: 'p1', to: idea.to }).ok).toBe(true);
    s = runUntilDocked(s, 'p1').state;
    expect(apply(s, { type: 'trade', shipId: 'p1', goodId: idea.goodId, side: 'sell', quantity: 1e9 }).ok).toBe(true);
    expect(s.player.cash).toBeGreaterThan(DEFAULT_ECONOMY.player.startingCash);
  });
});

describe('회사 성장 (M2 완료 조건)', () => {
  let grown: EconomyState;
  beforeAll(() => {
    grown = playBot(24, ['small']);
  });

  it('부지런히 거래하면 2년 안에 이익을 내고 다음 배를 산다', () => {
    expect(netProfit(grown.player.lifetime)).toBeGreaterThan(0);
    expect(myShips(grown).length).toBeGreaterThanOrEqual(2);
  });

  it('현금·재고는 어떤 순간에도 음수가 아니다', () => {
    expect(grown.player.cash).toBeGreaterThanOrEqual(0);
    for (const id of ctx.cityIds) for (const g of ctx.goods) expect(grown.cities[id].stock[g.id]).toBeGreaterThanOrEqual(0);
  });

  it('선종마다 운항 경제성이 달라 고를 이유가 있다', () => {
    const from = 'orpa';
    const to = 'lumen';
    const perUnit = (typeId: string, load: number) => {
      const v = estimateVoyage(ctx, typeId, from, to);
      return (v.fuel + v.upkeep) / load;
    };
    // 짐이 적으면 작은 배가, 곡물을 가득 실으면 벌크선이 단위당 싸다
    expect(perUnit('small', 40)).toBeLessThan(perUnit('bulk', 40));
    expect(perUnit('bulk', 650)).toBeLessThan(perUnit('small', 60));
    // 컨테이너선이 가장 빠르다
    const months = (id: string) => estimateVoyage(ctx, id, from, to).months;
    expect(months('container')).toBeLessThan(Math.min(months('small'), months('medium'), months('bulk')));
    // 큰 배가 들어가지 못하는 작은 항구가 있다
    expect(ctx.cityIds.filter((id) => ctx.portSize[id] < 3).length).toBeGreaterThan(0);
  });
});

describe('자동 항로', () => {
  const routeCmd = (minMargin: number, cashReserve: number): Command => ({
    type: 'saveRoute',
    route: {
      name: '시험 항로',
      stops: [
        { cityId: 'lumen', buy: [{ goodId: 'electronics', maxQuantity: 30 }], sell: ['processed_food'] },
        { cityId: 'orpa', buy: [{ goodId: 'processed_food', maxQuantity: 40 }], sell: ['electronics'] },
      ],
      minMargin,
      cashReserve,
    },
  });

  function runRoute(minMargin: number, cashReserve: number, months = 24, cash = 60000) {
    let s = fresh();
    s.player.cash = cash;
    expect(apply(s, routeCmd(minMargin, cashReserve)).ok).toBe(true);
    const routeId = s.player.routes[0].id;
    expect(apply(s, { type: 'assignRoute', shipId: 'p1', routeId }).ok).toBe(true);
    const events: SimEvent[] = [];
    const cashSeen: number[] = [];
    for (let m = 0; m < months; m++) {
      const r = stepMonth(ctx, s);
      s = r.state;
      events.push(...r.events);
      cashSeen.push(s.player.cash);
    }
    return { s, events, cashSeen };
  }

  it('기항지를 번갈아 돌며 사고팔기를 반복한다', () => {
    // 남지 않는 달에는 기다리므로(아래 시험), 도는 횟수보다 "번갈아 돌며 사고판다"를 본다
    const { events } = runRoute(0, 5000, 36);
    const arrivals = events.filter((e) => e.type === 'arrival' && e.shipId === 'p1').map((e) => (e.type === 'arrival' ? e.cityId : ''));
    const onRoute = arrivals.filter((c) => c === 'lumen' || c === 'orpa');
    expect(onRoute.length).toBeGreaterThanOrEqual(6);
    for (let k = 1; k < onRoute.length; k++) expect(onRoute[k]).not.toBe(onRoute[k - 1]);
    const trades = events.filter((e) => e.type === 'trade' && e.shipId === 'p1');
    expect(trades.some((e) => e.type === 'trade' && e.side === 'buy')).toBe(true);
    expect(trades.some((e) => e.type === 'trade' && e.side === 'sell')).toBe(true);
  });

  it('현금 보유 한도 아래로는 사지 않고, 현금은 음수가 되지 않는다', () => {
    const reserve = 50000;
    const { events, cashSeen } = runRoute(0.0, reserve, 18, 60000);
    for (const c of cashSeen) expect(c).toBeGreaterThanOrEqual(0);
    const buys = events.filter((e) => e.type === 'trade' && e.side === 'buy');
    expect(buys.length).toBeGreaterThan(0);
    for (const e of buys) if (e.type === 'trade') expect(e.cashAfter).toBeGreaterThanOrEqual(reserve - 1e-6);
  });

  it('조건(최소 이익률)을 못 맞추면 구매를 보류하고 알림을 남긴다', () => {
    const { events } = runRoute(10, 0, 8);
    expect(events.some((e) => e.type === 'trade' && e.side === 'buy')).toBe(false);
    expect(events.some((e) => e.type === 'notice' && e.text.includes('사지 않았어요'))).toBe(true);
  });

  it('작은 항구가 낀 항로에는 큰 배를 배정할 수 없다', () => {
    const s = fresh();
    s.player.cash = 1e7;
    apply(s, {
      type: 'saveRoute',
      route: { name: '작은 항구', stops: [{ cityId: bigPort, buy: [], sell: [] }, { cityId: smallPort, buy: [], sell: [] }], minMargin: 0.1, cashReserve: 0 },
    });
    apply(s, { type: 'buyShip', typeId: 'medium', cityId: bigPort });
    const medium = myShips(s).find((x) => x.typeId === 'medium')!;
    const r = apply(s, { type: 'assignRoute', shipId: medium.id, routeId: s.player.routes[0].id });
    expect(r.ok).toBe(false);
  });

  it('같은 명령을 같은 순서로 내리면 같은 결과가 나온다(재현성)', () => {
    const a = runRoute(0.05, 5000, 12).s;
    const b = runRoute(0.05, 5000, 12).s;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('자동 항로 수익성(5년)', () => {
  const good: RouteStop[] = [
    { cityId: 'lumen', buy: [{ goodId: 'electronics', maxQuantity: 30 }], sell: ['processed_food'] },
    { cityId: 'orpa', buy: [{ goodId: 'processed_food', maxQuantity: 40 }], sell: ['electronics'] },
  ];
  // 같은 상품을 거꾸로: 비싼 곳에서 사서 싼 곳에 판다
  const bad: RouteStop[] = [
    { cityId: 'orpa', buy: [{ goodId: 'electronics', maxQuantity: 30 }], sell: ['processed_food'] },
    { cityId: 'lumen', buy: [{ goodId: 'processed_food', maxQuantity: 40 }], sell: ['electronics'] },
  ];

  function run5y(stops: RouteStop[], minMargin: number) {
    let s = fresh();
    s.player.cash = 60000;
    expect(apply(s, { type: 'saveRoute', route: { name: '5년 시험', stops, minMargin, cashReserve: 5000 } }).ok).toBe(true);
    const start = evaluateRoute(ctx, s, s.player.routes[0], 'small', { cash: s.player.cash });
    expect(apply(s, { type: 'assignRoute', shipId: 'p1', routeId: s.player.routes[0].id }).ok).toBe(true);
    const events: SimEvent[] = [];
    for (let m = 0; m < 60; m++) {
      const r = stepMonth(ctx, s);
      s = r.state;
      events.push(...r.events);
    }
    const l = s.player.lifetime;
    const net = l.sales - l.purchases - l.fuel - l.portFees - l.upkeep - (l.tariffs ?? 0);
    return { s, events, start, net, sales: s.player.chronicle.filter((c) => c.shipId === 'p1') };
  }

  it('항로 평가는 매매 차익에서 왕복 연료비·유지비를 뺀 순이익과 월평균을 낸다', () => {
    const s = fresh();
    const route = { stops: good, minMargin: 0, cashReserve: 0 };
    const ev = evaluateRoute(ctx, s, route, 'small');
    const legs = estimateVoyage(ctx, 'small', 'lumen', 'orpa').fuel + estimateVoyage(ctx, 'small', 'orpa', 'lumen').fuel;
    expect(ev.fuel).toBeCloseTo(legs, 6);
    expect(ev.upkeep).toBeCloseTo(ev.loopMonths * ctx.data.shipTypes.find((t) => t.id === 'small')!.upkeepPerMonth, 6);
    expect(ev.net).toBeCloseTo(ev.tradeGain - ev.fuel - ev.upkeep, 6);
    expect(ev.perMonth).toBeCloseTo(ev.net / ev.loopMonths, 6);
    // 거래마다 산 값(항만비 포함)·판 값(관세·상함·항만비 반영)·짐칸 몫 운항비가 있다
    for (const t of ev.trades) expect(t.gain).toBeCloseTo(t.revenue - t.cost - t.fuelShare - t.upkeepShare, 6);
    // 남지 않는 항로는 매매가 없어 연료비만큼 손해로 나온다
    const evBad = evaluateRoute(ctx, s, { stops: bad, minMargin: 0, cashReserve: 0 }, 'small');
    expect(evBad.trades).toHaveLength(0);
    expect(evBad.contribution).toBeLessThan(0);
  });

  it('남는 항로는 5년 동안 돌려 누적 순이익이 난다(밑진 판매는 드물다)', () => {
    const { net, sales, start } = run5y(good, 0);
    expect(start.net).toBeGreaterThan(0);
    expect(net).toBeGreaterThan(0);
    expect(sales.length).toBeGreaterThanOrEqual(10);
    const losing = sales.filter((c) => c.profit < 0);
    expect(losing.length / sales.length).toBeLessThan(0.15);
  });

  it('남지 않는 항로는 빈 배로 돌지 않고 기다려, 유지비 말고는 거의 잃지 않는다', () => {
    const { s, net, events } = run5y(bad, 0);
    const upkeep = 60 * ctx.data.shipTypes.find((t) => t.id === 'small')!.upkeepPerMonth;
    const roundTrip = estimateVoyage(ctx, 'small', 'lumen', 'orpa').fuel * 2;
    expect(s.player.lifetime.purchases).toBe(0);
    expect(s.player.lifetime.fuel).toBeLessThanOrEqual(roundTrip);
    expect(net).toBeGreaterThanOrEqual(-upkeep - roundTrip);
    const p1 = s.ships.find((x) => x.id === 'p1')!;
    expect(p1.routeWaiting).toBe(true);
    // 화면이 까닭을 보여 줄 수 있게: 남지 않아서 기다림, 처음 멈춘 때(다달이 갱신되지 않음), 한 바퀴 예상
    expect(p1.routeWait?.reason).toBe('profit');
    expect(p1.routeWait!.since).toBeLessThan(s.month - 12);
    expect(p1.routeWait!.estimate).toBeLessThanOrEqual(0);
    // 기다리는 동안 같은 알림을 다달이 쌓지 않는다
    const waits = events.filter((e) => e.type === 'notice' && e.shipId === 'p1' && e.text.includes('기다렸다가'));
    expect(waits.length).toBeLessThanOrEqual(2);
  });

  it('짐칸에 부스러기(0.01개)나 이 항로에서 팔지 않는 짐만 있으면 빈 배로 보고 헛되이 돌지 않는다', () => {
    let s = fresh();
    s.player.cash = 60000;
    apply(s, { type: 'saveRoute', route: { name: '부스러기', stops: bad, minMargin: 0, cashReserve: 5000 } });
    // 예전 화면에서 일부만 팔아 남은 부스러기, 그리고 이 항로에서는 팔지 않는 짐(상하지 않는 목재)
    const lot = (goodId: string, quantity: number) => ({ goodId, quantity, originCityId: 'portabel', originCountryId: ctx.countryOfCity.portabel, brandCountryId: ctx.countryOfCity.portabel, unitCost: 200 });
    ship1(s).cargo.push(lot('fruit', 0.01), lot('timber', 5));
    expect(apply(s, { type: 'assignRoute', shipId: 'p1', routeId: s.player.routes[0].id }).ok).toBe(true);
    for (let m = 0; m < 24; m++) s = stepMonth(ctx, s).state;
    const roundTrip = estimateVoyage(ctx, 'small', 'lumen', 'orpa').fuel * 2;
    expect(s.player.lifetime.fuel).toBeLessThanOrEqual(roundTrip + estimateVoyage(ctx, 'small', 'portabel', 'orpa').fuel);
    expect(ship1(s).routeWaiting).toBe(true);
  });

  it('상한 짐을 일부만 팔아도 부스러기가 남지 않는다', () => {
    const s = fresh();
    const p = ship1(s);
    p.cargo.push({ goodId: 'fruit', quantity: 39.37, originCityId: 'nandia', originCountryId: ctx.countryOfCity.nandia, brandCountryId: ctx.countryOfCity.nandia, unitCost: 200 });
    expect(apply(s, { type: 'trade', shipId: 'p1', goodId: 'fruit', side: 'sell', quantity: 39.34 }).ok).toBe(true);
    expect(cargoOf(ship1(s), 'fruit')).toBe(0);
  });

  it('기다리던 항로는 남는 거래가 생기면 다시 출발한다', () => {
    const { events } = run5y(good, 0);
    const resumed = events.filter((e) => e.type === 'notice' && e.shipId === 'p1' && e.text.includes('다시 남는 거래'));
    const waited = events.filter((e) => e.type === 'notice' && e.shipId === 'p1' && e.text.includes('기다렸다가'));
    if (waited.length > 0) expect(resumed.length).toBeGreaterThan(0);
  });
});
