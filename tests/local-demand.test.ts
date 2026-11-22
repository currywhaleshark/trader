import { beforeAll, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { addStock } from '../src/sim/economy/origin';
import { computeTargets, createEconomy } from '../src/sim/economy/setup';
import { stepMonth } from '../src/sim/economy/step';
import { explainDestination } from '../src/sim/classroom/reasons';
import { makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import { COASTAL_PORTS } from '../src/sim/world/coastalPorts';

let game: ReturnType<typeof createEconomy>;
beforeAll(() => {
  const world = generateWorld(makeConfig()).world;
  game = createEconomy(world, DEFAULT_ECONOMY, world.seed);
});

it('같은 거점의 공장을 연안항에 복제하지 않고 업종별로 나눈다', () => {
  for (const [hub, ports] of Object.entries(COASTAL_PORTS)) {
    const goods = [hub, ...ports.map((p) => p.id)].flatMap((id) => Object.keys(DEFAULT_ECONOMY.cities[id].factories));
    expect(new Set(goods).size, hub).toBe(goods.length);
  }
  expect(DEFAULT_ECONOMY.cities.portabel.factories.textiles).toBeGreaterThan(0);
  expect(DEFAULT_ECONOMY.cities.rivana.factories.clothing).toBeGreaterThan(0);
});

it('지역 수요는 목표 재고와 실제 월 소비에 같은 비율로 반영된다', () => {
  const { ctx } = game;
  const state = structuredClone(game.state);
  state.ships = [];
  state.month = 1;
  const city = state.cities.rivana;
  city.industries = [];
  city.population = 2;
  city.income = 1;
  computeTargets(ctx, city);
  const good = ctx.goodById.processed_food;
  const demand = 2 * good.demandPerMillion * 1.8;
  expect(city.target[good.id]).toBeCloseTo(demand * (good.stockMonths + ctx.data.setup.importBufferMonths));
  city.price[good.id] = good.basePrice;
  addStock(city, good.id, 1000, city.countryId, city.countryId);
  const after = stepMonth(ctx, state).state.cities[city.id];
  expect(after.last.consumed[good.id]).toBeCloseTo(demand);
  // 설정이 없는 품목에는 추가 수요를 만들지 않는다.
  expect(city.target.grain).toBeCloseTo(2 * ctx.goodById.grain.demandPerMillion * (ctx.goodById.grain.stockMonths + ctx.data.setup.importBufferMonths));
});

it('원료를 사 오는 이유와 생활 수요 차이를 거래 설명에 보여 준다', () => {
  const { ctx, state } = game;
  const input = explainDestination(ctx, state, 'rivana', 'textiles');
  expect(input.category).toBe('industry');
  expect(input.text).toContain('의류');
  expect(input.text).toContain('원료');
  const food = explainDestination(ctx, state, 'rivana', 'processed_food');
  expect(food.category).toBe('demand');
});
