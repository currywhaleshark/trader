import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { executeBuy, executeSell } from '../src/sim/economy/market';
import { addStock, originKey, takeStock } from '../src/sim/economy/origin';
import { applyCommand, cargoOf, PLAYER_ID } from '../src/sim/economy/player';
import { expectedSaleFactor, lotTerms, tariffRate } from '../src/sim/economy/policy';
import { createEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { Command, EconomyContext, EconomyState, Policy, SimEvent } from '../src/sim/economy/types';
import { DEFAULT_SEED, makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

let world: ReturnType<typeof generateWorld>['world'];
let ctx: EconomyContext;
let initial: EconomyState;
const fresh = () => structuredClone(initial);

type NewPolicy = Omit<Policy, 'id' | 'reviewed' | 'ended' | 'baseline'>;
const tariff = (p: Partial<NewPolicy> & Pick<NewPolicy, 'countries' | 'rate'>, from = 0, years = 5): NewPolicy => ({
  kind: 'tariff', cause: 'scenario', startMonth: from, endMonth: from + years * 12, title: '시험 관세', causes: ['시험'], effects: ['시험'], ...p,
});
const fta = (countries: string[], from = 0): NewPolicy => ({
  kind: 'fta', countries, rate: 0, cause: 'scenario', startMonth: from, endMonth: from + 120, title: '시험 협정', causes: ['시험'], effects: ['시험'],
});

interface Run {
  states: EconomyState[];
  events: SimEvent[];
}

/** months개월 진행. at[m]은 m번째 달 시작에 넣을 명령 */
function run(months: number, at: Record<number, Command[]> = {}, game = { ctx, state: initial }): Run {
  let state = game.state;
  const states = [state];
  const events: SimEvent[] = [];
  for (let m = 0; m < months; m++) {
    const r = stepMonth(game.ctx, state, at[m] ?? []);
    state = r.state;
    states.push(state);
    events.push(...r.events);
  }
  return { states, events };
}

let baseline: Run;

beforeAll(() => {
  ({ world } = generateWorld(makeConfig({ seed: DEFAULT_SEED })));
  const eco = createEconomy(world, DEFAULT_ECONOMY, DEFAULT_SEED);
  ctx = eco.ctx;
  initial = eco.state;
  // 이 파일의 실험은 저절로 생기는 정책·유행 없이, 시나리오로 건 것만 비교한다
  ctx.data = structuredClone(ctx.data);
  ctx.data.policy.protection.chance = 0;
  ctx.data.policy.fta.chance = 0;
  ctx.data.policy.conflict.chance = 0;
  ctx.data.culture.waveChance = 0;
  baseline = run(48);
}, 120_000);

describe('원산지·상표 기록', () => {
  it('도시 재고의 원산지 구성 합은 언제나 재고와 같다', () => {
    for (const m of [0, 1, 12, 30, 48]) {
      const s = baseline.states[m];
      for (const id of ctx.cityIds) {
        for (const g of ctx.goods) {
          const sum = Object.values(s.cities[id].mix[g.id] ?? {}).reduce((a, b) => a + b, 0);
          expect(sum, `${m}월 ${id} ${g.id}`).toBeCloseTo(s.cities[id].stock[g.id], 4);
        }
      }
    }
  });

  it('창고에 넣었다 빼도 원산지가 그대로다(단순 환적은 원산지를 바꾸지 않는다)', () => {
    const s = fresh();
    const city = s.cities.portabel; // 카루나
    const before = city.stock.clothing;
    executeSell(ctx, city, 'clothing', 50, 'astera', 'astera');
    const parts = takeStock(city, 'clothing', city.stock.clothing);
    const astera = parts.filter((p) => p.origin === 'astera').reduce((a, p) => a + p.quantity, 0);
    expect(astera).toBeCloseTo(50, 6);
    expect(parts.reduce((a, p) => a + p.quantity, 0)).toBeCloseTo(before + 50, 6);
  });

  it('다른 나라 원료로 만든 상품의 원산지는 만든 나라다', () => {
    const s = fresh();
    const city = s.cities.orpa; // 오르덴, 철강 시설
    city.mix.iron_ore = { [originKey('velorin', 'velorin')]: city.stock.iron_ore };
    const next = stepMonth(ctx, s).state;
    const steel = next.cities.orpa.mix.steel;
    expect(steel[originKey('orden', 'orden')]).toBeGreaterThan(0);
  });

  it('상표와 원산지는 다를 수 있다(위탁 생산)', () => {
    const s = fresh();
    const city = s.cities.soltia; // 솔마르, 아스테라 상표 의류
    expect(city.industries.find((i) => i.goodId === 'clothing')?.brandCountryId).toBe('astera');
    const next = stepMonth(ctx, s).state;
    expect(next.cities.soltia.mix.clothing[originKey('solmar', 'astera')]).toBeGreaterThan(0);
    const buy = executeBuy(ctx, next.cities.soltia, 'clothing', 5);
    expect(buy.parts.some((p) => p.origin === 'solmar' && p.brand === 'astera')).toBe(true);
  });
});

describe('관세와 협정', () => {
  it('관세는 도착 나라·상품·원산지로 정하고, 자기 나라 물건에는 붙지 않는다', () => {
    const s = fresh();
    applyCommand(ctx, s, { type: 'addPolicy', policy: tariff({ countries: ['orden'], goods: ['clothing'], rate: 0.3 }) });
    expect(tariffRate(ctx, s, 'orden', 'clothing', 'astera')).toBeCloseTo(0.3);
    expect(tariffRate(ctx, s, 'orden', 'clothing', 'orden')).toBe(0);
    expect(tariffRate(ctx, s, 'orden', 'grain', 'astera')).toBe(0);
    expect(tariffRate(ctx, s, 'miren', 'clothing', 'astera')).toBe(0);
  });

  it('협정은 회원국이 만든 물건만 혜택을 받고, 다른 나라 물건을 거쳐 와도 소용없다 (QA 6)', () => {
    const play = (origin: string) => {
      const s = fresh();
      s.player.cash = 1e7;
      // 카루나(포르타벨)·오르덴 협정, 오르덴은 의류에 30% 관세
      applyCommand(ctx, s, { type: 'addPolicy', policy: fta(['karuna', 'orden']) });
      applyCommand(ctx, s, { type: 'addPolicy', policy: tariff({ countries: ['orden'], goods: ['clothing'], rate: 0.3 }) });
      const port = s.cities.portabel;
      port.stock.clothing = 200;
      port.mix.clothing = { [originKey(origin, origin)]: 200 };
      expect(applyCommand(ctx, s, { type: 'trade', shipId: 'p1', goodId: 'clothing', side: 'buy', quantity: 30 }).ok).toBe(true);
      const ship = s.ships.find((x) => x.id === 'p1')!;
      expect(ship.cargo.every((l) => l.originCountryId === origin)).toBe(true);
      ship.from = 'orpa';
      ship.to = 'orpa'; // 도착한 것으로 둔다
      const before = s.player.lifetime.tariffs;
      expect(applyCommand(ctx, s, { type: 'trade', shipId: 'p1', goodId: 'clothing', side: 'sell', quantity: 1e9 }).ok).toBe(true);
      return { paid: s.player.lifetime.tariffs - before, sales: s.player.lifetime.sales, left: cargoOf(ship, 'clothing') };
    };
    const member = play('karuna'); // 회원국이 만든 의류
    const outsider = play('astera'); // 아스테라 의류를 카루나 항구에서 실어 감
    expect(member.paid).toBe(0);
    expect(outsider.paid).toBeCloseTo(outsider.sales * 0.3, 3);
    expect(outsider.left).toBe(0);
  });

  it('관세가 오르면 무역회사의 기대 이익(도착 원가)이 줄어든다', () => {
    const s = fresh();
    const before = expectedSaleFactor(ctx, s, 'lumen', 'electronics', 'orpa');
    applyCommand(ctx, s, { type: 'addPolicy', policy: tariff({ countries: ['orden'], goods: ['electronics'], rate: 0.4 }) });
    const after = expectedSaleFactor(ctx, s, 'lumen', 'electronics', 'orpa');
    expect(before).toBeCloseTo(1 + (ctx.reputation.premiums.astera.electronics ?? 0), 6);
    expect(after).toBeCloseTo(before * 0.6, 6);
    expect(lotTerms(ctx, s, 'orpa', 'electronics', 'astera', 'astera').tariff).toBeCloseTo(0.4);
  });

  it('갈등 관세는 협정이 있어도 붙는다', () => {
    const s = fresh();
    applyCommand(ctx, s, { type: 'addPolicy', policy: fta(['karuna', 'orden']) });
    applyCommand(ctx, s, { type: 'addPolicy', policy: tariff({ countries: ['orden'], targets: ['karuna'], goods: ['grain'], rate: 0.35, cause: 'conflict' }) });
    expect(tariffRate(ctx, s, 'orden', 'grain', 'karuna')).toBeCloseTo(0.35);
    expect(tariffRate(ctx, s, 'orden', 'fruit', 'karuna')).toBe(0);
  });

  it('관세를 매겨도 돈과 상품은 생기거나 사라지지 않는다', () => {
    const r = run(24, { 12: [{ type: 'addPolicy', policy: tariff({ countries: ['orden', 'velorin'], rate: 0.3 }, 12) }] });
    const end = r.states[24];
    expect(totals(ctx, end).money).toBeCloseTo(totals(ctx, initial).money, 3);
    const tariffs = r.states.slice(13).reduce((a, s) => a + ctx.cityIds.reduce((b, id) => b + s.cities[id].annual.tariffs, 0), 0);
    expect(tariffs).toBeGreaterThan(0);
  });
});

describe('관세의 이해관계자별 효과 (QA 5)', () => {
  it('자동차 수입 관세: 국내 생산자는 늘고, 소비자는 더 내고, 무역회사는 관세를 낸다', () => {
    // 수입 경쟁 시나리오. 벨로린의 기존 자동차 공장은 오르덴보다 작고 관세 전에도 수입 물량이 있다.
    const data = structuredClone(ctx.data);
    data.cities.granbel.factories.automobiles = 1;
    // 보호 관세 실험의 투입재 조달 조건은 철광석 3개월분으로 고정한다.
    data.goods.find((g) => g.id === 'iron_ore')!.stockMonths = 3;
    const k = 'velorin';
    const game = createEconomy(world, data, DEFAULT_SEED);
    const control = run(48, {}, game);
    const shock = run(48, { 12: [{ type: 'addPolicy', policy: tariff({ countries: [k], goods: ['automobiles'], rate: 0.5 }, 12, 4) }] }, game);
    const cities = game.ctx.cityIds.filter((id) => game.ctx.countryOfCity[id] === k);
    const sum = (r: Run, f: (s: EconomyState, id: string) => number) => {
      let v = 0;
      for (let m = 13; m <= 48; m++) for (const id of cities) v += f(r.states[m], id);
      return v;
    };
    const produced = (r: Run) => sum(r, (s, id) => s.cities[id].last.produced.automobiles);
    const paid = (r: Run) => sum(r, (s, id) => s.cities[id].price.automobiles * s.cities[id].last.consumed.automobiles) / sum(r, (s, id) => s.cities[id].last.consumed.automobiles);
    const foreign = (r: Run) => r.states[48].history.slice(1).reduce((a, h) => {
      const from = h.countries[k].importsByGood.automobiles ?? {};
      return a + Object.entries(from).filter(([o]) => o !== k).reduce((x, [, v]) => x + v, 0);
    }, 0);
    expect(produced(shock), '생산자').toBeGreaterThan(produced(control) * 1.03);
    expect(paid(shock), '소비자').toBeGreaterThan(paid(control) * 1.02);
    expect(foreign(control)).toBeGreaterThan(0);
    expect(foreign(shock), '수입').toBeLessThan(foreign(control));
    const review = shock.events.find((e) => e.type === 'policy' && e.kind === 'review');
    expect(review).toBeDefined();
    const text = review!.type === 'policy' ? review!.effects.join(' ') : '';
    expect(text).toContain('생산자');
    expect(text).toContain('소비자');
    expect(text).toContain('무역');
  });
});

describe('문화 유행과 상표 선호 (QA 4)', () => {
  it('유행하면 그 나라 상표 상품의 수입이 늘지만, 물건이 저절로 생기지는 않는다', () => {
    const wave = run(48, {
      12: [{
        type: 'addCultureWave',
        wave: { brand: 'astera', countries: ['orden'], strength: 1, startMonth: 12, endMonth: 48, title: '시험 유행', causes: ['시험'], effects: ['시험'] },
      }],
    });
    const fromAstera = (r: Run) =>
      r.states[48].history.slice(1).reduce((a, h) => a + (h.countries.orden.importsByGood.cosmetics?.astera ?? 0) + (h.countries.orden.importsByGood.clothing?.astera ?? 0), 0);
    expect(fromAstera(wave)).toBeGreaterThan(fromAstera(baseline) * 1.15);
    // 상품 보존: 생산 − 소비 − 투입 − 부패만큼만 총량이 바뀐다
    for (let m = 12; m < 48; m++) {
      const a = totals(ctx, wave.states[m]).goods.cosmetics;
      const b = totals(ctx, wave.states[m + 1]).goods.cosmetics;
      let delta = 0;
      for (const id of ctx.cityIds) {
        const l = wave.states[m + 1].cities[id].last;
        delta += l.produced.cosmetics - l.consumed.cosmetics - l.usedAsInput.cosmetics;
      }
      expect(b).toBeCloseTo(a + delta, 4);
    }
    expect(totals(ctx, wave.states[48]).money).toBeCloseTo(totals(ctx, initial).money, 3);
  });

  it('유행 상표의 물건을 팔면 웃돈을 받는다', () => {
    const s = fresh();
    applyCommand(ctx, s, { type: 'addCultureWave', wave: { brand: 'astera', countries: ['orden'], strength: 1, startMonth: 0, endMonth: 36, title: '시험', causes: ['시험'], effects: ['시험'] } });
    expect(lotTerms(ctx, s, 'orpa', 'cosmetics', 'miren', 'astera').premium).toBeGreaterThan(0.2);
    expect(lotTerms(ctx, s, 'orpa', 'cosmetics', 'astera', 'miren').premium).toBe(0);
    expect(lotTerms(ctx, s, 'orpa', 'grain', 'astera', 'astera').premium).toBe(0);
    expect(lotTerms(ctx, s, 'lumen', 'cosmetics', 'miren', 'astera').premium).toBe(0);
  });
});

describe('정책이 저절로 생길 때', () => {
  let events: Extract<SimEvent, { type: 'policy' }>[];
  let end: EconomyState;
  beforeAll(() => {
    const { world } = generateWorld(makeConfig({ seed: DEFAULT_SEED }));
    const eco = createEconomy(world, DEFAULT_ECONOMY, DEFAULT_SEED);
    let s = eco.state;
    events = [];
    for (let m = 0; m < 20 * 12; m++) {
      const r = stepMonth(eco.ctx, s);
      s = r.state;
      for (const e of r.events) if (e.type === 'policy') events.push(e);
    }
    end = s;
  }, 120_000);

  it('보호 관세·협정·갈등·문화 유행이 조건에 따라 생긴다', () => {
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has('tariff_start')).toBe(true);
    expect(kinds.has('fta_start')).toBe(true);
    expect(kinds.has('culture_start')).toBe(true);
    expect(end.policies.length).toBeGreaterThan(3);
  });

  it('정책마다 원인과 이해관계자별 영향이 붙고, 1년 뒤 실제 효과를 보고한다 (M4 완료 조건)', () => {
    for (const e of events.filter((x) => x.kind.endsWith('_start'))) {
      expect(e.causes.length, e.text).toBeGreaterThan(0);
      expect(e.effects.length, e.text).toBeGreaterThan(0);
    }
    const reviews = events.filter((e) => e.kind === 'review');
    expect(reviews.length).toBeGreaterThan(0);
    for (const r of reviews) expect(r.effects.length, r.text).toBeGreaterThan(0);
  });

  it('정책은 최소 몇 년은 유지된다(해마다 뒤집히지 않는다)', () => {
    for (const p of end.policies) {
      expect(p.endMonth - p.startMonth, p.title).toBeGreaterThanOrEqual(DEFAULT_ECONOMY.policy.minYears * 12);
    }
  });

  it('20년 동안 플레이어 회사 장부와 현금이 맞는다(관세 포함)', () => {
    const p = end.player;
    expect(p.cash).toBeGreaterThanOrEqual(0);
    expect(end.ships.some((x) => x.companyId === PLAYER_ID)).toBe(true);
  });
});

export { addStock };
