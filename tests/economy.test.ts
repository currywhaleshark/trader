import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { executeBuy, executeSell, quoteBuy, quoteSell } from '../src/sim/economy/market';
import { measureBalance, type BalanceReport } from '../src/sim/economy/metrics';
import { createEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { Command, EconomyContext, EconomyState, SimEvent } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';
import type { World } from '../src/sim/world/types';

let world: World;
let ctx: EconomyContext;
let initial: EconomyState;

interface Run {
  states: EconomyState[];
  events: SimEvent[][];
}

/** months개월 진행. commandsAt[m]은 m번째 달 시작에 넣을 명령. */
function run(months: number, commandsAt: Record<number, Command[]> = {}): Run {
  let state = initial;
  const states = [state];
  const events: SimEvent[][] = [];
  for (let m = 0; m < months; m++) {
    const r = stepMonth(ctx, state, commandsAt[m] ?? []);
    state = r.state;
    states.push(state);
    events.push(r.events);
  }
  return { states, events };
}

let baseline: Run;

beforeAll(() => {
  world = generateWorld(makeConfig({ seed: DEFAULT_SEED })).world;
  const eco = createEconomy(world, DEFAULT_ECONOMY, DEFAULT_SEED);
  ctx = eco.ctx;
  initial = eco.state;
  baseline = run(120);
});

describe('초기 경제', () => {
  it('6개국 12도시 16상품으로 시작한다', () => {
    expect(ctx.cityIds).toHaveLength(12);
    expect(ctx.goods.length).toBeGreaterThanOrEqual(12);
    expect(ctx.goods.length).toBeLessThanOrEqual(16);
    expect(new Set(Object.values(ctx.countryOfCity)).size).toBe(6);
  });

  it('레시피는 존재하는 상품만 쓰고 원재료→중간재→완제품 2단계를 넘지 않는다', () => {
    const depth = (id: string): number => {
      const g = ctx.goodById[id];
      expect(g, id).toBeDefined();
      return g.recipe ? 1 + Math.max(...Object.keys(g.recipe).map(depth)) : 0;
    };
    for (const g of ctx.goods) expect(depth(g.id)).toBeLessThanOrEqual(2);
    for (const g of ctx.goods) if (g.category === 'raw') expect(g.source).toBeDefined();
  });

  it('공장은 기술 수준이 되는 나라에만, 농장·광산은 지리가 허락하는 도시에만 있다', () => {
    for (const cityId of ctx.cityIds) {
      const city = world.cities.find((c) => c.id === cityId)!;
      for (const ind of initial.cities[cityId].industries) {
        const g = ctx.goodById[ind.goodId];
        expect(ind.capacity).toBeGreaterThan(0);
        expect(ctx.data.techByCountry[city.countryId]).toBeGreaterThanOrEqual(g.techRequired);
        if (g.source?.kind === 'resource') expect(city.region.resources[g.source.id]).toBeGreaterThan(0);
        if (g.source?.kind === 'crop') expect(city.region.crops[g.source.id].arableAreaKm2).toBeGreaterThan(0);
      }
    }
    // 모든 도시가 모든 것을 만들지는 않는다
    for (const g of ctx.goods) {
      const makers = ctx.cityIds.filter((id) => initial.cities[id].industries.some((i) => i.goodId === g.id));
      expect(makers.length, g.name).toBeGreaterThan(0);
      expect(makers.length, g.name).toBeLessThan(12);
    }
  });
});

describe('시장 규칙 (§6.3 불변 조건)', () => {
  const fresh = () => structuredClone(initial);

  it('재고보다 많이 살 수 없고, 산 만큼만 재고가 준다', () => {
    const state = fresh();
    const city = state.cities.lumen;
    const before = city.stock.grain;
    const bought = executeBuy(ctx, city, 'grain', before * 10);
    expect(bought.quantity).toBeLessThanOrEqual(before);
    expect(city.stock.grain).toBeCloseTo(before - bought.quantity, 9);
    expect(city.stock.grain).toBeGreaterThanOrEqual(0);
  });

  it('같은 항구에서 사서 바로 팔면 반드시 손해다', () => {
    for (const goodId of ['grain', 'steel', 'automobiles']) {
      const state = fresh();
      const city = state.cities.orpa;
      const buy = executeBuy(ctx, city, goodId, 20);
      const sell = executeSell(ctx, city, goodId, buy.quantity, 'orden', 'orden');
      expect(sell.total).toBeLessThan(buy.total);
    }
  });

  it('사고팔기를 아무리 반복해도 돈과 상품이 생기지 않는다 (QA 9)', () => {
    const state = fresh();
    const city = state.cities.granbel;
    const stock0 = city.stock.fuel;
    let cash = 0;
    for (let k = 0; k < 200; k++) {
      const buy = executeBuy(ctx, city, 'fuel', 15);
      cash -= buy.total;
      const sell = executeSell(ctx, city, 'fuel', buy.quantity, 'velorin', 'velorin');
      cash += sell.total;
    }
    expect(cash).toBeLessThan(0);
    expect(city.stock.fuel).toBeCloseTo(stock0, 6);
    expect(city.treasury).toBeCloseTo(-cash, 6);
  });

  it('많이 살수록 단가가 오르고 많이 팔수록 단가가 내린다', () => {
    const city = fresh().cities.orpa;
    expect(quoteBuy(ctx, city, 'grain', 100).unitPrice).toBeGreaterThan(quoteBuy(ctx, city, 'grain', 10).unitPrice);
    expect(quoteSell(ctx, city, 'grain', 100).unitPrice).toBeLessThan(quoteSell(ctx, city, 'grain', 10).unitPrice);
    expect(quoteBuy(ctx, city, 'grain', 10).unitPrice).toBeGreaterThan(quoteSell(ctx, city, 'grain', 10).unitPrice);
  });
});

describe('월별 틱', () => {
  it('입력 상태를 바꾸지 않고, 같은 상태에서는 같은 결과가 나온다', () => {
    const snapshot = JSON.stringify(initial);
    const a = stepMonth(ctx, initial);
    const b = stepMonth(ctx, initial);
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.month).toBe(1);
  });

  it('상태는 JSON으로 저장했다 이어 해도 같은 길을 간다', () => {
    const mid = baseline.states[30];
    const restored = JSON.parse(JSON.stringify(mid)) as EconomyState;
    let state = restored;
    for (let m = 30; m < 42; m++) state = stepMonth(ctx, state).state;
    expect(JSON.stringify(state)).toBe(JSON.stringify(baseline.states[42]));
  });

  it('10년 자동 진행에 NaN·음수·무한대가 없다 (M1 완료 조건)', () => {
    for (const state of baseline.states) {
      for (const id of ctx.cityIds) {
        const c = state.cities[id];
        for (const g of ctx.goods) {
          expect(Number.isFinite(c.stock[g.id]) && c.stock[g.id] >= 0, `${id} ${g.id} 재고`).toBe(true);
          expect(Number.isFinite(c.price[g.id]) && c.price[g.id] > 0, `${id} ${g.id} 가격`).toBe(true);
          expect(c.price[g.id]).toBeGreaterThanOrEqual(g.basePrice * ctx.data.market.priceFloor - 1e-9);
          expect(c.price[g.id]).toBeLessThanOrEqual(g.basePrice * ctx.data.market.priceCeil + 1e-9);
        }
        expect(Number.isFinite(c.treasury)).toBe(true);
      }
      for (const company of state.companies) expect(company.cash).toBeGreaterThanOrEqual(0);
      for (const ship of state.ships) {
        let load = 0;
        for (const lot of ship.cargo) {
          expect(lot.quantity).toBeGreaterThan(0);
          load += lot.quantity * ctx.goodById[lot.goodId].volume;
        }
        expect(load).toBeLessThanOrEqual(ship.capacity + 1e-6);
      }
    }
  });

  it('상품은 생산·소비로만 늘고 준다. 운송으로 복제되지 않는다', () => {
    for (let m = 0; m < 120; m++) {
      const before = totals(ctx, baseline.states[m]).goods;
      const after = totals(ctx, baseline.states[m + 1]);
      for (const g of ctx.goods) {
        let delta = 0;
        for (const id of ctx.cityIds) {
          const l = baseline.states[m + 1].cities[id].last;
          delta += l.produced[g.id] - l.consumed[g.id] - l.usedAsInput[g.id];
        }
        expect(after.goods[g.id]).toBeCloseTo(before[g.id] + delta, 5);
      }
    }
  });

  it('돈의 총합(회사 + 도시 + 운임 지출)은 변하지 않는다', () => {
    const start = totals(ctx, baseline.states[0]).money;
    for (const m of [1, 12, 60, 120]) expect(totals(ctx, baseline.states[m]).money).toBeCloseTo(start, 3);
  });

  it('시설이 없는 도시에서는 그 상품이 생산되지 않는다 (M1 완료 조건)', () => {
    // 시설은 M3에서 공사가 끝나야 생긴다. 그 달에 시설이 없으면 생산량은 0이어야 한다.
    let checked = 0;
    for (let m = 1; m <= 120; m++) {
      for (const id of ctx.cityIds) {
        const city = baseline.states[m].cities[id];
        const made = new Set(city.industries.map((i) => i.goodId));
        for (const g of ctx.goods) {
          if (made.has(g.id)) continue;
          checked++;
          expect(city.last.produced[g.id], `${m}월 ${id} ${g.id}`).toBe(0);
        }
      }
    }
    expect(checked).toBeGreaterThan(50 * 120);
    // 새로 생긴 시설은 모두 공사 완공 사건으로만 생긴다
    const builtByEvent = new Set(
      baseline.events.flat().filter((e) => e.type === 'growth' && e.kind === 'build_done').map((e) => (e.type === 'growth' ? `${e.cityId}|${e.goodId}` : '')),
    );
    for (const id of ctx.cityIds) {
      const before = new Set(initial.cities[id].industries.map((i) => i.goodId));
      for (const ind of baseline.states[120].cities[id].industries) {
        if (!before.has(ind.goodId)) expect(builtByEvent.has(`${id}|${ind.goodId}`), `${id} ${ind.goodId}`).toBe(true);
      }
    }
    // 나라 단위로도: 솔마르에는 자동차 공장이 없으므로 자동차는 전량 수입이다
    const solmar = ctx.cityIds.filter((id) => ctx.countryOfCity[id] === 'solmar');
    let consumed = 0;
    for (let m = 1; m <= 120; m++) for (const id of solmar) consumed += baseline.states[m].cities[id].last.consumed.automobiles;
    expect(consumed).toBeGreaterThan(0);
  });

  it('경제가 굳지 않는다: 10년째에도 생산·소비·교역이 계속된다', () => {
    const lastYear = baseline.events.slice(108).flat();
    const deliveries = lastYear.filter((e) => e.type === 'delivery');
    expect(deliveries.length).toBeGreaterThan(100);
    expect(new Set(deliveries.map((e) => (e.type === 'delivery' ? e.goodId : ''))).size).toBeGreaterThanOrEqual(12);
    for (const g of ctx.goods) {
      let produced = 0;
      for (let m = 109; m <= 120; m++) for (const id of ctx.cityIds) produced += baseline.states[m].cities[id].last.produced[g.id];
      expect(produced, g.name).toBeGreaterThan(0);
    }
  });

  it('가격은 도시마다 다르다(고정 가격표가 아니다)', () => {
    const end = baseline.states[120];
    for (const goodId of ['grain', 'fuel', 'clothing']) {
      const prices = ctx.cityIds.map((id) => end.cities[id].price[goodId]);
      expect(Math.max(...prices) / Math.min(...prices)).toBeGreaterThan(1.3);
    }
  });
});

describe('균형 (밸런싱 회귀 방지)', () => {
  // 2년차부터 9년 동안의 평균. 기준값은 docs/PLAN.md 7절 참조.
  let report: BalanceReport;
  beforeAll(() => {
    report = measureBalance(ctx, initial, 108, 12);
  });

  it('어떤 상품도 원하는 양의 3% 넘게 모자라지 않는다', () => {
    for (const g of ctx.goods) expect(report.goods[g.id].shortageRate, g.name).toBeLessThan(0.03);
  });

  it('사람들이 실제로 치르는 값은 기준가 근처다(운임 몫만큼 조금 높다)', () => {
    for (const g of ctx.goods) {
      const r = report.goods[g.id].paidPriceRatio;
      expect(r, g.name).toBeGreaterThan(0.85);
      // NPC 선단은 일부러 모든 틈을 메우지 않는다(플레이어가 채울 몫, M2). 벌크 원료는 운임 몫이 커서 가장 높다.
      expect(r, g.name).toBeLessThan(1.6);
    }
  });

  it('값이 상한에 붙어 버린 시장이 없다(작은 시장도 배가 들른다)', () => {
    for (const g of ctx.goods) expect(report.goods[g.id].nearCeilingShare, g.name).toBeLessThan(0.02);
  });

  it('공장이 놀지도, 모자라지도 않는다(가동률 60~95%)', () => {
    for (const g of ctx.goods) {
      const u = report.goods[g.id].utilization;
      expect(u, g.name).toBeGreaterThan(0.6);
      expect(u, g.name).toBeLessThan(0.95);
    }
  });

  it('무역회사 현금은 끝없이 불어나지 않고, 이익은 본거지로 흘러간다', () => {
    for (const ratio of report.companyCashRatio) {
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2.5);
    }
    for (const c of report.finalState.companies) {
      expect(c.paidOut).toBeGreaterThan(0);
      expect(report.finalState.cities[c.homeCityId].treasury).toBeGreaterThan(0);
    }
  });

  it('수입품은 그 도시에서 쓸 몫까지 다른 곳으로 되팔려 나가지 않는다', () => {
    const state = structuredClone(initial);
    const city = state.cities.kelda;
    city.stock.fuel = city.reserve.fuel * 0.9;
    expect(quoteBuy(ctx, city, 'fuel', 100).quantity).toBe(0);
  });
});

describe('인과관계', () => {
  it('한 도시의 흉작이 다른 도시의 곡물값과 교역에 시차를 두고 번진다 (M1 완료 조건)', () => {
    // 3년차부터 2년 동안 최대 곡창 루멘의 곡물 생산이 10%로 준다
    const shock = run(84, {
      24: [{ type: 'addModifier', modifier: { cityId: 'lumen', goodId: 'grain', factor: 0.1, untilMonth: 47, reason: '흉작' } }],
    });
    const ratio = (cityId: string, m: number) =>
      shock.states[m].cities[cityId].price.grain / baseline.states[m].cities[cityId].price.grain;
    // 충격 전에는 완전히 같은 길
    expect(JSON.stringify(shock.states[24])).toBe(JSON.stringify(baseline.states[24]));
    const firstRise = (cityId: string) => {
      for (let m = 25; m <= 84; m++) if (ratio(cityId, m) > 1.1) return m;
      return Infinity;
    };
    const atSource = firstRise('lumen');
    expect(atSource).toBeLessThan(40);
    const others = ctx.cityIds.filter((id) => id !== 'lumen').map(firstRise);
    const affected = others.filter((m) => Number.isFinite(m));
    expect(affected.length).toBeGreaterThanOrEqual(3);
    // 충격은 한꺼번에가 아니라 도시마다 다른 시점에 닿는다(직접 수입하던 곳이 먼저, 먼 곳은 나중)
    expect(Math.min(...affected)).toBeGreaterThan(24);
    expect(Math.max(...affected) - Math.min(atSource, ...affected)).toBeGreaterThanOrEqual(2);
    // 루멘의 곡물 수출이 줄어든다
    const exported = (r: Run) => {
      let s = 0;
      for (let m = 25; m <= 48; m++) s += r.states[m].cities.lumen.last.exported.grain;
      return s;
    };
    expect(exported(shock)).toBeLessThan(exported(baseline) * 0.7);
  });

  it('전자부품이 끊기면 자동차 생산이 줄고 값이 오른다 (QA 2)', () => {
    const makers = ctx.cityIds.filter((id) => initial.cities[id].industries.some((i) => i.goodId === 'electronics'));
    const shock = run(60, {
      24: makers.map((cityId) => ({
        type: 'addModifier' as const,
        modifier: { cityId, goodId: 'electronics', factor: 0, untilMonth: 47, reason: '공장 가동 중단' },
      })),
    });
    const sum = (r: Run, pick: (s: EconomyState) => number) => {
      let s = 0;
      for (let m = 31; m <= 48; m++) s += pick(r.states[m]);
      return s;
    };
    const carOutput = (s: EconomyState) => ctx.cityIds.reduce((a, id) => a + s.cities[id].last.produced.automobiles, 0);
    const carPrice = (s: EconomyState) => ctx.cityIds.reduce((a, id) => a + s.cities[id].price.automobiles, 0);
    expect(sum(shock, carOutput)).toBeLessThan(sum(baseline, carOutput) * 0.6);
    expect(sum(shock, carPrice)).toBeGreaterThan(sum(baseline, carPrice) * 1.2);
  });

  it('남북반구의 수확기 차이가 곡물 교역량에 나타난다 (M1 완료 조건, QA 1)', () => {
    const cityLat = Object.fromEntries(world.cities.map((c) => [c.id, c.lat]));
    const north = new Array<number>(12).fill(0);
    const south = new Array<number>(12).fill(0);
    for (let m = 12; m < 120; m++) {
      for (const e of baseline.events[m]) {
        if (e.type !== 'departure' || e.goodId !== 'grain') continue;
        if (cityLat[e.from] > 33) north[m % 12] += e.quantity;
        if (cityLat[e.from] < -33) south[m % 12] += e.quantity;
      }
    }
    const window = (arr: number[], months: number[]) => months.reduce((s, m) => s + arr[m], 0);
    // 수확(북 10~11월, 남 4~5월) 뒤 값이 내리면서 수출이 늘기까지 한두 달 시차가 있다
    const afterNorthHarvest = [11, 0, 1, 2]; // 12~3월
    const afterSouthHarvest = [5, 6, 7, 8]; // 6~9월
    expect(window(north, afterNorthHarvest)).toBeGreaterThan(window(north, afterSouthHarvest) * 1.5);
    expect(window(south, afterSouthHarvest)).toBeGreaterThan(window(south, afterNorthHarvest) * 1.5);
  });
});
