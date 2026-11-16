import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/sim/economy/data';
import { canEnter } from '../src/sim/economy/player';
import { createEconomy } from '../src/sim/economy/setup';
import { stepMonth, totals } from '../src/sim/economy/step';
import type { EconomyContext, EconomyState, SimEvent, YearRecord } from '../src/sim/economy/types';
import { makeConfig } from '../src/sim/world/config';
import { generateWorld } from '../src/sim/world/generateWorld';

type GrowthEvent = Extract<SimEvent, { type: 'growth' }>;

interface LongRun {
  ctx: EconomyContext;
  start: EconomyState;
  end: EconomyState;
  events: GrowthEvent[];
  /** 마지막 1년 동안 상품별 (치른 값 합, 쓴 양 합) */
  paid: Record<string, [number, number]>;
  shortage: number;
  wanted: number;
  bad: number;
}

function runYears(seed: string, years: number): LongRun {
  const { world } = generateWorld(makeConfig({ seed }));
  const { ctx, state: start } = createEconomy(world, DEFAULT_ECONOMY, seed);
  let state = start;
  const events: GrowthEvent[] = [];
  const paid: Record<string, [number, number]> = {};
  let shortage = 0;
  let wanted = 0;
  let bad = 0;
  for (let m = 0; m < years * 12; m++) {
    const r = stepMonth(ctx, state);
    state = r.state;
    for (const e of r.events) if (e.type === 'growth') events.push(e);
    for (const id of ctx.cityIds) {
      const c = state.cities[id];
      for (const g of ctx.goods) {
        if (!Number.isFinite(c.price[g.id]) || !Number.isFinite(c.stock[g.id]) || c.stock[g.id] < 0 || c.price[g.id] <= 0) bad++;
        if (m >= 12) {
          shortage += c.last.shortage[g.id];
          wanted += c.last.consumed[g.id] + c.last.shortage[g.id];
        }
        if (m >= years * 12 - 12) {
          const u = c.last.consumed[g.id] + c.last.usedAsInput[g.id];
          const p = (paid[g.id] ??= [0, 0]);
          p[0] += u * c.price[g.id];
          p[1] += u;
        }
      }
      if (!Number.isFinite(c.population) || !Number.isFinite(c.income)) bad++;
    }
  }
  return { ctx, start, end: state, events, paid, shortage, wanted, bad };
}

/** 처음 3년과 마지막 3년의 순수출 부호가 뚜렷하게 바뀐 (나라, 상품) */
function tradeFlips(history: YearRecord[]): string[] {
  const head = history.slice(0, 3);
  const tail = history.slice(-3);
  const out: string[] = [];
  for (const k of Object.keys(head[0].countries)) {
    for (const g of Object.keys(head[0].countries[k].netTrade)) {
      const a = head.reduce((s, h) => s + h.countries[k].netTrade[g], 0) / head.length;
      const b = tail.reduce((s, h) => s + h.countries[k].netTrade[g], 0) / tail.length;
      const scale = Math.max(Math.abs(a), Math.abs(b));
      if (scale > 30 && Math.sign(a) !== Math.sign(b) && Math.min(Math.abs(a), Math.abs(b)) > scale * 0.15) out.push(`${k}|${g}`);
    }
  }
  return out;
}

let run: LongRun;
let other: LongRun;

beforeAll(() => {
  run = runYears('trade-world-1', 30);
  other = runYears('alpha', 30);
}, 300_000);

describe('30년 장기 실행 (M3 완료 조건)', () => {
  it('30년 동안 NaN·음수·무한대가 없고 돈이 보존된다', () => {
    expect(run.bad).toBe(0);
    expect(totals(run.ctx, run.end).money).toBeCloseTo(totals(run.ctx, run.start).money, 3);
    expect(run.end.history.length).toBe(30);
  });

  it('수출입 구조가 바뀌는 나라가 등장한다', () => {
    const flips = tradeFlips(run.end.history);
    expect(flips.length).toBeGreaterThanOrEqual(2);
    expect(new Set(flips.map((f) => f.split('|')[0])).size).toBeGreaterThanOrEqual(2);
  });

  it('변화가 한 해에 몰린 고정 스크립트가 아니다', () => {
    const buildYears = new Set(run.events.filter((e) => e.kind === 'build_start').map((e) => Math.floor(e.month / 12)));
    expect(buildYears.size).toBeGreaterThanOrEqual(5);
    // 다른 시드의 세계에서는 다른 곳에 다른 공장이 생긴다
    const builds = (r: LongRun) => new Set(r.events.filter((e) => e.kind === 'build_start').map((e) => `${e.cityId}|${e.goodId}`));
    const a = builds(run);
    const b = builds(other);
    const same = [...a].filter((x) => b.has(x)).length;
    expect(same).toBeLessThan(Math.min(a.size, b.size));
    expect(tradeFlips(other.end.history).join()).not.toBe(tradeFlips(run.end.history).join());
  });

  it('경제가 붕괴하지도 끝없이 불어나지도 않는다', () => {
    const first = run.end.history[0];
    const last = run.end.history[run.end.history.length - 1];
    const sum = (h: YearRecord, f: (c: YearRecord['countries'][string]) => number) => Object.values(h.countries).reduce((s, c) => s + f(c), 0);
    const pop0 = sum(first, (c) => c.population);
    const pop1 = sum(last, (c) => c.population);
    expect(pop1 / pop0).toBeGreaterThan(1.05);
    expect(pop1 / pop0).toBeLessThan(2.5);
    for (const k of Object.keys(first.countries)) {
      const ratio = last.countries[k].income / first.countries[k].income;
      expect(ratio, k).toBeGreaterThan(0.7);
      expect(ratio, k).toBeLessThan(3);
    }
    // 생산은 줄지 않고(붕괴 없음), 부족은 드물다
    const prod = (h: YearRecord) => sum(h, (c) => Object.values(c.produced).reduce((s, v) => s + v, 0));
    expect(prod(last)).toBeGreaterThan(prod(first));
    expect(run.shortage / run.wanted).toBeLessThan(0.02);
    // 사람들이 치르는 값이 기준에서 크게 벗어나지 않는다
    for (const g of run.ctx.goods) {
      const [p, u] = run.paid[g.id];
      const ratio = p / u / g.basePrice;
      expect(ratio, g.name).toBeGreaterThan(0.7);
      expect(ratio, g.name).toBeLessThan(2.2);
    }
    const npc = run.end.ships.filter((s) => s.companyId !== 'player').length;
    expect(npc).toBeGreaterThanOrEqual(DEFAULT_ECONOMY.growth.npcMinShips * DEFAULT_ECONOMY.npc.companies.length);
    expect(npc).toBeLessThanOrEqual(DEFAULT_ECONOMY.growth.npcMaxShips * DEFAULT_ECONOMY.npc.companies.length);
  });

  it('모든 장기 변화에는 원인 설명이 붙는다', () => {
    expect(run.events.length).toBeGreaterThan(20);
    for (const e of run.events) {
      expect(e.text.length).toBeGreaterThan(5);
      expect(e.causes.length, e.text).toBeGreaterThan(0);
      for (const c of e.causes) expect(c.length).toBeGreaterThan(5);
    }
  });

  it('공사는 몇 년이 걸리고, 시설이 매달 생겼다 사라지지 않는다', () => {
    const starts = run.events.filter((e) => e.kind === 'build_start');
    const dones = run.events.filter((e) => e.kind === 'build_done');
    expect(dones.length).toBeGreaterThan(0);
    for (const d of dones) {
      const s = starts.find((x) => x.cityId === d.cityId && x.goodId === d.goodId && x.month < d.month);
      expect(s, `${d.cityId} ${d.goodId}`).toBeDefined();
      expect(d.month - s!.month).toBeGreaterThanOrEqual(24);
    }
    // 같은 시설이 한 해에 두 번 넘게 바뀌지 않는다
    const perYear = new Map<string, number>();
    for (const e of run.events) {
      if (!e.goodId || e.kind === 'expand_done' || e.kind === 'build_done') continue;
      const key = `${e.cityId}|${e.goodId}|${Math.floor(e.month / 12)}`;
      perYear.set(key, (perYear.get(key) ?? 0) + 1);
    }
    for (const [k, v] of perYear) expect(v, k).toBeLessThanOrEqual(1);
  });
});

describe('산업 신설과 수입 대체 (QA 3)', () => {
  it('수입에 기대던 나라가 공장을 지은 뒤 수입이 준다', () => {
    const hist = run.end.history;
    const startYear = DEFAULT_ECONOMY.startYear;
    let found = 0;
    const done = run.events.filter((e) => e.kind === 'build_done' && e.goodId && run.ctx.goodById[e.goodId].recipe);
    for (const d of done) {
      const start = run.events.find((x) => x.kind === 'build_start' && x.cityId === d.cityId && x.goodId === d.goodId)!;
      const k = d.countryId!;
      const yStart = Math.floor(start.month / 12) - 1;
      const yDone = Math.floor(d.month / 12);
      const before = hist.slice(Math.max(0, yStart - 2), yStart + 1).map((h) => h.countries[k].netTrade[d.goodId!]);
      const after = hist.slice(yDone + 1, yDone + 4).map((h) => h.countries[k].netTrade[d.goodId!]);
      if (before.length < 2 || after.length < 2) continue;
      const b = before.reduce((s, v) => s + v, 0) / before.length;
      const a = after.reduce((s, v) => s + v, 0) / after.length;
      if (b < 0 && a > b + Math.abs(b) * 0.3) found++;
    }
    expect(found, `연도 ${startYear}부터의 신설 ${done.length}건`).toBeGreaterThanOrEqual(1);
  });

  it('신설 원인에는 수입 의존·값·기술이 들어 있다', () => {
    const build = run.events.find((e) => e.kind === 'build_start' && e.goodId && run.ctx.goodById[e.goodId].recipe);
    expect(build).toBeDefined();
    const text = build!.causes.join(' ');
    expect(text).toContain('사 왔어요');
    expect(text).toContain('기술 수준');
  });
});

describe('기술·항만·NPC 선단', () => {
  it('모든 나라의 기술이 오르고, 뒤처진 나라도 따라온다', () => {
    const first = run.start.tech;
    const last = run.end.tech;
    for (const k of Object.keys(first)) expect(last[k], k).toBeGreaterThan(first[k]);
    const laggard = Object.keys(first).sort((a, b) => first[a] - first[b])[0];
    expect(last[laggard] - first[laggard]).toBeGreaterThan(1.5);
    expect(Math.max(...Object.values(last))).toBeLessThanOrEqual(DEFAULT_ECONOMY.growth.techMax);
  });

  it('물동량이 많은 항구가 넓어지면 더 큰 배가 들어갈 수 있다', () => {
    const grown = run.ctx.cityIds.filter((id) => run.end.portLevel[id] > run.start.portLevel[id]);
    expect(grown.length).toBeGreaterThan(0);
    const id = grown[0];
    const bigger = run.ctx.data.shipTypes.find((t) => t.size === run.end.portLevel[id])!;
    expect(canEnter(run.ctx, run.start, bigger.id, id)).toBe(false);
    expect(canEnter(run.ctx, run.end, bigger.id, id)).toBe(true);
  });

  it('NPC 회사는 벌이에 따라 배를 늘리거나 줄인다', () => {
    const fleet = run.events.filter((e) => e.kind === 'fleet');
    expect(fleet.length).toBeGreaterThan(0);
    const n0 = run.start.ships.filter((s) => s.companyId !== 'player').length;
    const n1 = run.end.ships.filter((s) => s.companyId !== 'player').length;
    expect(n1).not.toBe(n0);
  });
});

describe('재현성 (QA 10)', () => {
  it('같은 시드로 해를 넘겨 돌리면 장기 변화까지 같다', () => {
    const a = runYears('trade-world-1', 3);
    const b = runYears('trade-world-1', 3);
    expect(JSON.stringify(a.end)).toBe(JSON.stringify(b.end));
    expect(JSON.stringify(a.end.history)).toBe(JSON.stringify(run.end.history.slice(0, 3)));
  });
});
