import { beforeAll, describe, expect, it } from 'vitest';
import { goalProgress, scenarioById } from '../src/sim/classroom/scenarios';
import { DEFAULT_SETTINGS } from '../src/sim/classroom/settings';
import { TUTORIAL_SCRIPTS, tutorialScript } from '../src/sim/classroom/tutorialScript';
import { buildEarth } from '../src/sim/earth/buildEarth';
import { economyDataFor } from '../src/sim/modes';
import type { EconomyData } from '../src/sim/economy/data';
import type { World, WorldMode } from '../src/sim/world/types';
import { loadEarthSources } from '../scripts/earthSources';
import { suggestTrips } from '../src/sim/economy/advice';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { orderPurchasePlan } from '../src/sim/economy/orders';
import { applyCommand, estimateVoyage, isDocked, PLAYER_ID } from '../src/sim/economy/player';
import { citySpecialties, specialtyAvailable } from '../src/sim/economy/specialties';
import { createGame } from '../src/sim/economy/start';
import { stepMonth } from '../src/sim/economy/step';
import type { Command, EconomyContext, EconomyState } from '../src/sim/economy/types';
import type { TutorialView } from '../src/ui/tutorialScripted';
import { makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

/**
 * 고정 튜토리얼 대본을 처음부터 끝까지 재생한다.
 * 경제 수치를 고쳐 대본의 어느 구간이 막히거나 밑지게 되면 여기서 걸린다.
 */
/** 대본마다 그 모드의 세계와 경제 자료를 만든다 */
const WORLDS: Record<string, () => { world: World; data: EconomyData; mode: WorldMode }> = {
  tutorial: () => ({ world: generateWorld(makeConfig({ seed: TUTORIAL_SCRIPTS.tutorial.seed })).world, data: DEFAULT_ECONOMY, mode: 'virtual' }),
  'earth-tutorial': () => ({ world: buildEarth(loadEarthSources()).world, data: economyDataFor('earth'), mode: 'earth' }),
};
function newGame(id: string) {
  const def = scenarioById(id)!;
  const S = tutorialScript(id)!;
  const { world, data, mode } = WORLDS[id]();
  const settings = { ...DEFAULT_SETTINGS, ...def.settings, mode, scenarioId: def.id, seed: S.seed };
  return createGame(world, data, S.seed, settings);
}

it('모든 대본에 재생 테스트가 있다', () => {
  expect(Object.keys(TUTORIAL_SCRIPTS).sort()).toEqual(Object.keys(WORLDS).sort());
});

describe.each(Object.keys(WORLDS))('고정 튜토리얼 대본: %s', (scenarioId) => {
  const def = scenarioById(scenarioId)!;
  const S = tutorialScript(scenarioId)!;
  let ctx: EconomyContext;
  let state: EconomyState;

  const ship = () => state.ships.find((s) => s.companyId === PLAYER_ID && !s.routeId)!;
  const run = (cmd: Command) => {
    const r = applyCommand(ctx, state, cmd);
    expect(r.ok, `${cmd.type}: ${r.ok ? '' : r.error}`).toBe(true);
  };
  /** 다음 항구로 가서 도착할 때까지 달을 넘긴다 */
  const sail = (to: string) => {
    expect(estimateVoyage(ctx, ship().typeId!, ship().to, to, state).leg, `${ship().to} → ${to} 직항`).toBeTruthy();
    run({ type: 'sail', shipId: ship().id, to });
    for (let n = 0; n < 6 && !isDocked(ship()); n++) state = stepMonth(ctx, structuredClone(state)).state;
    expect(ship().to).toBe(to);
    expect(isDocked(ship())).toBe(true);
  };
  /** 짐을 모두 팔고 (받은 돈 − 산 값)을 돌려준다 */
  const sellAll = () => {
    let profit = 0;
    for (const lot of ship().cargo.map((l) => ({ ...l }))) {
      const before = state.player.cash;
      run({ type: 'trade', shipId: ship().id, goodId: lot.goodId, specialtyId: lot.specialtyId, side: 'sell', quantity: lot.quantity });
      profit += state.player.cash - before - lot.unitCost * lot.quantity;
    }
    return profit;
  };

  beforeAll(() => {
    ({ ctx, state } = newGame(scenarioId));
  });

  it('거점에서 시작하고 대본의 항구·상품이 모두 있다', () => {
    expect(ship().to).toBe(S.home);
    for (const id of [S.home, S.first.to, S.specialty.at, S.specialty.sellAt, S.pick.from, S.pick.to, S.order.sourceCityId, S.order.cityId, S.route.to]) expect(ctx.portIds, id).toContain(id);
    for (const id of [S.first.goodId, S.pick.goodId, S.order.goodId, S.store.goodId, S.route.goodId]) expect(ctx.goodById[id], id).toBeTruthy();
    // 동선이 이어진다: 앞 장이 끝난 항구에서 다음 장이 시작된다
    expect(S.specialty.at).toBe(S.first.to);
    expect(S.pick.from).toBe(S.specialty.sellAt);
    expect(S.order.sourceCityId).toBe(S.pick.to);
    expect(S.order.cityId).toBe(S.home);
  });

  it('1장: 힌트에 대본의 첫 무역이 있고, 따라 하면 남는다', () => {
    const idea = suggestTrips(ctx, state, ship(), 12).find((i) => i.to === S.first.to && i.goodId === S.first.goodId);
    expect(idea, '대본의 힌트').toBeTruthy();
    expect(idea!.profit).toBeGreaterThan(0);
    run({ type: 'trade', shipId: ship().id, goodId: S.first.goodId, side: 'buy', quantity: Math.min(S.first.quantity, idea!.quantity) });
    sail(S.first.to);
    expect(sellAll()).toBeGreaterThan(0);
  });

  it('2장: 특산품을 사서 다른 나라에 팔면 남는다', () => {
    const sp = citySpecialties(ctx, state, S.specialty.at)[0];
    expect(sp, '특산품').toBeTruthy();
    expect(specialtyAvailable(ctx, state, S.specialty.at, sp)).toBeGreaterThanOrEqual(1);
    expect(state.cities[S.specialty.sellAt].countryId).not.toBe(sp.countryId);
    run({ type: 'trade', shipId: ship().id, goodId: sp.goodId, specialtyId: sp.id, side: 'buy', quantity: S.specialty.quantity });
    expect(ship().cargo.some((l) => l.specialtyId === sp.id)).toBe(true);
    sail(S.specialty.sellAt);
    expect(sellAll()).toBeGreaterThan(0);
    expect(state.player.chronicle.some((e) => !!e.specialtyId)).toBe(true);
  });

  it('3장: 직접 고른 무역이 남는다', () => {
    run({ type: 'trade', shipId: ship().id, goodId: S.pick.goodId, side: 'buy', quantity: S.pick.quantity });
    sail(S.pick.to);
    expect(sellAll()).toBeGreaterThan(0);
  });

  it('4장: 대본 발주 전에는 무작위 발주가 없고, 대본 발주는 한 번에 채워 완납한다', () => {
    expect(state.player.orders!.items).toHaveLength(0);
    run({ type: 'tutorialOrder' });
    run({ type: 'tutorialOrder' });
    const scripted = state.player.orders!.items.filter((o) => o.scripted);
    expect(scripted).toHaveLength(1);
    const order = scripted[0];
    expect(order.sourceCityId).toBe(S.order.sourceCityId);
    expect(order.cityId).toBe(S.order.cityId);
    run({ type: 'acceptOrder', orderId: order.id });
    const plan = orderPurchasePlan(ctx, state, ship(), order);
    expect(plan.quantity, plan.reason).toBe(plan.needed);
    run({ type: 'fillOrder', orderId: order.id, shipId: ship().id });
    const cashBefore = state.player.cash + plan.total;
    sail(S.order.cityId);
    run({ type: 'deliverOrder', orderId: order.id, shipId: ship().id, quantity: order.quantity });
    expect(order.status === 'completed' || state.player.orders!.items.find((o) => o.id === order.id)!.status === 'completed').toBe(true);
    expect(state.player.cash).toBeGreaterThan(cashBefore);
  });

  it('5~8장: 창고에 맡기고, 배를 사고, 정기 항로에 맡길 수 있다', () => {
    run({ type: 'trade', shipId: ship().id, goodId: S.store.goodId, side: 'buy', quantity: S.store.quantity });
    run({ type: 'warehouseTransfer', shipId: ship().id, goodId: S.store.goodId, quantity: S.store.quantity, direction: 'store', storage: 'ambient' });
    expect(state.player.warehouse!.cargo.length).toBeGreaterThan(0);
    const small = ctx.data.shipTypes.reduce((a, b) => (a.price <= b.price ? a : b));
    expect(state.player.cash, '배 살 돈').toBeGreaterThanOrEqual(small.price);
    run({ type: 'buyShip', typeId: small.id });
    run({
      type: 'saveRoute',
      route: {
        name: '튜토리얼 항로', minMargin: 0.05, cashReserve: 0,
        stops: [
          { cityId: S.home, buy: [{ goodId: S.route.goodId, maxQuantity: 30 }], sell: [] },
          { cityId: S.route.to, buy: [], sell: [S.route.goodId] },
        ],
      },
    });
    const added = state.ships.filter((s) => s.companyId === PLAYER_ID).at(-1)!;
    run({ type: 'assignRoute', shipId: added.id, routeId: state.player.routes[0].id });
    state = stepMonth(ctx, structuredClone(state)).state;
    for (const goal of def.goals) expect(goalProgress(ctx, state, goal).ratio, goal.text).toBeGreaterThanOrEqual(1);
  });
});

/** 안내 문구(지금 상황에서 누를 곳)가 발주를 한 번에 못 채웠을 때도 끊기지 않는지 */
describe.each(Object.keys(WORLDS))('고정 튜토리얼 안내: 발주를 나눠 납품: %s', (scenarioId) => {
  it('덜 실으면 먼저 납품하게 하고, 남은 만큼은 조달처로 되돌려 보낸다', async () => {
    const { scriptedSteps } = await import('../src/ui/tutorialScripted');
    const S = tutorialScript(scenarioId)!;
    const game = newGame(scenarioId);
    const ctx = game.ctx;
    let state = game.state;
    const ship = () => state.ships.find((s) => s.companyId === PLAYER_ID)!;
    const run = (cmd: Command) => expect(applyCommand(ctx, state, cmd).ok, cmd.type).toBe(true);
    const sail = (to: string) => {
      run({ type: 'sail', shipId: ship().id, to });
      for (let n = 0; n < 6 && !isDocked(ship()); n++) state = stepMonth(ctx, structuredClone(state)).state;
    };
    const step = scriptedSteps(S).find((s) => s.id === 'orders-run')!;
    const view: TutorialView = { portOpen: true, picking: false, dest: null, win: null, companyTab: null };
    const guide = (v = view) => step.guide!({ ctx, state, playing: false } as never, v);

    sail(S.order.sourceCityId);
    run({ type: 'tutorialOrder' });
    const id = state.player.orders!.items[0].id;
    const order = () => state.player.orders!.items.find((o) => o.id === id)!;
    // 받기 전에는 발주함으로 보낸다
    expect(guide().title).toBe('발주함 열기');
    run({ type: 'acceptOrder', orderId: id });
    // 발주함이 열려 있으면 먼저 닫게 한다
    expect(guide({ ...view, portOpen: false, win: 'orders' }).title).toBe('열린 창 닫기');
    expect(guide().title).toBe('발주 물건 싣기');

    // 돈이 모자라 일부만 실린다
    const cash = state.player.cash;
    const full = orderPurchasePlan(ctx, state, ship(), order());
    state.player.cash = full.reserve + full.total * 0.5;
    const part = orderPurchasePlan(ctx, state, ship(), order());
    expect(part.quantity).toBeGreaterThan(0);
    expect(part.quantity).toBeLessThan(part.needed);
    run({ type: 'fillOrder', orderId: id, shipId: ship().id });
    // 더 살 수 없을 때까지 채운 뒤에는, 실은 만큼 먼저 납품하러 가게 한다
    for (let n = 0; n < 5 && orderPurchasePlan(ctx, state, ship(), order()).quantity > 0; n++) run({ type: 'fillOrder', orderId: id, shipId: ship().id });
    const go = guide();
    expect(go.body).toContain('개만 실었어요');
    expect(go.title).toBe('목적지 고르기');
    expect(guide({ ...view, dest: S.order.cityId }).title).toBe('출발!');

    state.player.cash = cash;
    sail(S.order.cityId);
    expect(guide().title).toBe('납품하기');
    const aboard = ship().cargo.filter((l) => l.goodId === order().goodId).reduce((n, l) => n + l.quantity, 0);
    run({ type: 'deliverOrder', orderId: id, shipId: ship().id, quantity: aboard });
    expect(order().status).toBe('accepted');
    expect(step.done!({ ctx, state, playing: false } as never, view, { trades: 0 })).toBe(false);
    // 남은 만큼은 조달처로 돌아가 다시 실어 오게 한다
    const back = guide();
    expect(back.body).toContain('아직');
    expect(back.body).toContain(ctx.cityNames[S.order.sourceCityId]);
    expect(back.lookAt).toBe(S.order.sourceCityId);

    sail(S.order.sourceCityId);
    expect(guide().title).toBe('발주 물건 싣기');
    run({ type: 'fillOrder', orderId: id, shipId: ship().id });
    sail(S.order.cityId);
    run({ type: 'deliverOrder', orderId: id, shipId: ship().id, quantity: order().quantity });
    expect(order().status).toBe('completed');
    expect(step.done!({ ctx, state, playing: false } as never, view, { trades: 0 })).toBe(true);
  });
});
